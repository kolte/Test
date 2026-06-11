import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkSession } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  SessionMappingDto,
  SyncBatchDto,
  SyncEventDto,
  SyncEventErrorDto,
  SyncResponseDto,
} from './dto/sync-event.dto';

/**
 * Event types that are scoped to a work session and must carry either
 * sessionId (already known server-side) or clientSessionId (generated
 * client-side for offline sessions) so the server can attach the event
 * to the correct WorkSession.
 */
const SESSION_SCOPED_EVENT_TYPES = new Set<SyncEventDto['type']>([
  'work_started',
  'work_paused',
  'work_resumed',
  'work_stopped',
  'manual_paused',
  'auto_paused',
  'idle_resolved',
]);

type Tx = Prisma.TransactionClient;

/**
 * Event types that open or close an active work interval within a session.
 * Used to compute worked time per day. Idle time is tracked separately via
 * IdleRecord and is not derived from these intervals.
 */
const ACTIVE_INTERVAL_START_TYPES = new Set<SyncEventDto['type']>(['work_started', 'work_resumed']);
const ACTIVE_INTERVAL_END_TYPES = new Set<SyncEventDto['type']>([
  'work_paused',
  'work_stopped',
  'manual_paused',
  'auto_paused',
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates that all session-scoped events carry at least one session
   * reference (sessionId or clientSessionId). The rest of the sync pipeline
   * depends on this — without it the server has no way to associate an
   * offline event with a WorkSession.
   */
  private assertEventsAreAddressable(events: SyncEventDto[]): void {
    const unaddressable = events.filter(
      (event) =>
        SESSION_SCOPED_EVENT_TYPES.has(event.type) &&
        !event.sessionId &&
        !event.clientSessionId,
    );

    if (unaddressable.length > 0) {
      throw new BadRequestException({
        code: 'EVENT_MISSING_SESSION_REFERENCE',
        message:
          'Session-scoped events must include sessionId or clientSessionId.',
        clientEventIds: unaddressable.map((e) => e.clientEventId),
      });
    }
  }

  /**
   * Resolves a session-scoped event to a real server-side WorkSession id,
   * creating one on first sight if necessary, and records the
   * clientSessionId → sessionId mapping for the response.
   *
   * Resolution order:
   *   1. event.sessionId is already a real id — use it directly. No mapping
   *      is recorded because the client already knows this id.
   *   2. event.clientSessionId was resolved earlier in this batch (e.g.
   *      work_started followed by work_paused before the transaction
   *      commits) — reuse the in-memory resolved map.
   *   3. event.clientSessionId maps to an existing WorkSession from a prior
   *      sync — the unique (deviceId, clientSessionId) index makes this
   *      lookup exact and idempotent.
   *   4. Otherwise this is the first time the server has seen this session —
   *      create it. Expected to happen on work_started; if a different event
   *      arrives first, the session is still created so the rest of the batch
   *      is not blocked, but the anomaly is logged.
   */
  private async resolveSessionId(
    tx: Tx,
    userId: string,
    deviceId: string,
    event: SyncEventDto,
    resolved: Map<string, string>,
    mappings: SessionMappingDto[],
  ): Promise<string> {
    if (event.sessionId) {
      return event.sessionId;
    }

    const clientSessionId = event.clientSessionId;
    if (!clientSessionId) {
      // Unreachable in practice — assertEventsAreAddressable guarantees
      // session-scoped events carry at least one reference — but kept as a
      // type-safe guard.
      throw new BadRequestException({
        code: 'EVENT_MISSING_SESSION_REFERENCE',
        message: 'Event has neither sessionId nor clientSessionId.',
        clientEventIds: [event.clientEventId],
      });
    }

    const fromThisBatch = resolved.get(clientSessionId);
    if (fromThisBatch) {
      return fromThisBatch;
    }

    const existing = await tx.workSession.findUnique({
      where: { deviceId_clientSessionId: { deviceId, clientSessionId } },
    });
    if (existing) {
      resolved.set(clientSessionId, existing.id);
      this.recordMapping(mappings, clientSessionId, existing.id);
      return existing.id;
    }

    const created = await this.createSessionFor(tx, userId, deviceId, clientSessionId, event);
    resolved.set(clientSessionId, created.id);
    this.recordMapping(mappings, clientSessionId, created.id);
    return created.id;
  }

  private async createSessionFor(
    tx: Tx,
    userId: string,
    deviceId: string,
    clientSessionId: string,
    event: SyncEventDto,
  ): Promise<WorkSession> {
    if (event.type !== 'work_started') {
      // A session should always be created by its work_started event. If a
      // different event arrives first, the work_started was likely lost in
      // transit. The session is created anyway to avoid blocking the rest of
      // the batch, but the anomaly is logged for review.
      // eslint-disable-next-line no-console
      console.warn(
        '[sync] session ' + clientSessionId + ' on device ' + deviceId +
          ' was first observed via a "' + event.type + '" event - work_started appears to be missing.',
      );
    }

    return tx.workSession.create({
      data: {
        userId,
        deviceId,
        clientSessionId,
        startedAt: new Date(event.occurredAt),
        status: 'active',
      },
    });
  }

  /** De-duplicates mappings - a session can be referenced by many events in a batch. */
  private recordMapping(mappings: SessionMappingDto[], clientSessionId: string, sessionId: string): void {
    if (!mappings.some((m) => m.clientSessionId === clientSessionId)) {
      mappings.push({ clientSessionId, sessionId });
    }
  }

  /** Looks up the device + owning user, raising a clear error if the device is unknown. */
  private async loadDeviceOwner(tx: Tx, deviceId: string): Promise<{ userId: string }> {
    const device = await tx.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_FOUND',
        message: 'No device registered with id ' + deviceId + '.',
      });
    }
    return { userId: device.userId };
  }

  /**
   * Persists an event as a WorkEvent row unless (deviceId, clientEventId)
   * already exists. The unique index makes replaying an event from a
   * partially-acknowledged batch a safe no-op rather than a duplicate.
   *
   * Returns true if a new row was written (counts toward `accepted`),
   * false if it was a recognized replay (counts toward `skipped`).
   */
  private async persistEventIfNew(
    tx: Tx,
    deviceId: string,
    sessionId: string | undefined,
    event: SyncEventDto,
  ): Promise<boolean> {
    const existing = await tx.workEvent.findUnique({
      where: { deviceId_clientEventId: { deviceId, clientEventId: event.clientEventId } },
    });
    if (existing) {
      return false;
    }

    if (!sessionId) {
      // Guard: every WorkEvent must belong to a session.
      throw new BadRequestException({
        code: 'EVENT_MISSING_SESSION_REFERENCE',
        message: 'Unable to resolve a session for this event.',
        clientEventIds: [event.clientEventId],
      });
    }

    await tx.workEvent.create({
      data: {
        sessionId,
        deviceId,
        type: event.type,
        occurredAt: new Date(event.occurredAt),
        clientEventId: event.clientEventId,
        payload: event.payload as Prisma.InputJsonValue | undefined,
      },
    });
    return true;
  }

  /** Returns the UTC calendar-day key (yyyy-MM-dd) for a given timestamp. */
  private workDateKey(occurredAt: Date): string {
    return occurredAt.toISOString().slice(0, 10);
  }

  /**
   * Recomputes the WorkDay rollup (worked time, idle time, session count)
   * for one (userId, workDate) pair from the raw WorkEvent and IdleRecord
   * rows for that UTC calendar day. Recomputing from scratch rather than
   * incrementally adjusting a running total means replays, out-of-order
   * delivery, and edits all converge on the same correct totals. The
   * @@unique([userId, workDate]) constraint makes the upsert safe to repeat.
   *
   * Active work time is derived by pairing interval-opening events
   * (work_started / work_resumed) with the next interval-closing event
   * (work_paused / work_stopped / manual_paused / auto_paused) in
   * chronological order. An interval left open at day's end is counted
   * through midnight so time is not silently lost.
   *
   * Idle time is summed from IdleRecord rows clipped to the day window. It
   * is not subtracted from the active-interval total: an idle period that
   * interrupts an open interval already split it via its bounding
   * idle_resolved / auto_paused events.
   */
  private async recalculateWorkDay(tx: Tx, userId: string, workDate: string): Promise<void> {
    const dayStart = new Date(workDate + 'T00:00:00.000Z');
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

    const events = await tx.workEvent.findMany({
      where: {
        occurredAt: { gte: dayStart, lt: dayEnd },
        session: { userId },
      },
      orderBy: [{ sessionId: 'asc' }, { occurredAt: 'asc' }],
    });

    let workedMs = 0;
    const touchedSessionIds = new Set<string>();
    let openIntervalStart: Date | null = null;
    let currentSessionId: string | null = null;

    const closeDanglingInterval = () => {
      if (openIntervalStart) {
        workedMs += dayEnd.getTime() - openIntervalStart.getTime();
        openIntervalStart = null;
      }
    };

    for (const event of events as Array<{ sessionId: string; type: string; occurredAt: Date }>) {
      if (event.sessionId !== currentSessionId) {
        // Session boundary — close any open interval from the previous session.
        closeDanglingInterval();
        currentSessionId = event.sessionId;
      }

      touchedSessionIds.add(event.sessionId);

      if (ACTIVE_INTERVAL_START_TYPES.has(event.type as SyncEventDto['type'])) {
        // A second start without an intervening end replaces the open
        // interval's start to prevent double-counting malformed sequences.
        openIntervalStart = event.occurredAt;
      } else if (
        ACTIVE_INTERVAL_END_TYPES.has(event.type as SyncEventDto['type']) &&
        openIntervalStart
      ) {
        workedMs += event.occurredAt.getTime() - openIntervalStart.getTime();
        openIntervalStart = null;
      }
    }
    closeDanglingInterval();

    const idleRecords = await tx.idleRecord.findMany({
      where: {
        session: { userId },
        startedAt: { lt: dayEnd },
        endedAt: { gt: dayStart },
      },
    });

    let idleMs = 0;
    for (const idle of idleRecords as Array<{ startedAt: Date; endedAt: Date }>) {
      const start = idle.startedAt > dayStart ? idle.startedAt : dayStart;
      const end = idle.endedAt < dayEnd ? idle.endedAt : dayEnd;
      idleMs += Math.max(0, end.getTime() - start.getTime());
    }

    await tx.workDay.upsert({
      where: { userId_workDate: { userId, workDate } },
      create: { userId, workDate, workedMs, idleMs, sessionCount: touchedSessionIds.size },
      update: { workedMs, idleMs, sessionCount: touchedSessionIds.size },
    });
  }

  /**
   * Entry point for POST /desktop/events/sync. Returns
   * `{ accepted, skipped, duplicateBatch, sessionMappings, errors }`.
   *
   *   1. Whole-batch replay guard — if a SyncBatch row already exists for
   *      (deviceId, batchId), the batch was already processed (e.g. the
   *      client retried after a dropped response). Sessions are re-resolved
   *      to rebuild sessionMappings, but no rows are written. The stored
   *      accepted/skipped counts are returned with `duplicateBatch: true`.
   *   2. Session resolution — every session-scoped event is mapped to a real
   *      WorkSession id, creating one on first sight. The resulting
   *      clientSessionId → sessionId pairs are returned as `sessionMappings`.
   *   3. Per-event replay guard — each event is persisted as a WorkEvent
   *      unless (deviceId, clientEventId) already exists, in which case it
   *      is counted as `skipped`. This makes it safe to resend a
   *      partially-acknowledged batch.
   *   4. Per-event error isolation — if resolving or persisting a single
   *      event throws, the failure is caught, logged, and returned in
   *      `errors` rather than aborting the batch. Batch-level problems
   *      (unknown device, missing session references) are still thrown
   *      outright because they indicate a bad request.
   *   5. WorkDay recalculation — every UTC calendar day that gained at least
   *      one newly-accepted event has its rollup recomputed so the
   *      today-summary endpoint always reflects this batch.
   *   6. The final accepted/skipped counts are recorded against this batchId
   *      so future replays can take the fast path in step 1.
   */
  async processBatch(batch: SyncBatchDto): Promise<SyncResponseDto> {
    this.assertEventsAreAddressable(batch.events);

    const sessionMappings: SessionMappingDto[] = [];
    const errors: SyncEventErrorDto[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      const { userId } = await this.loadDeviceOwner(tx, batch.deviceId);

      // (deviceId, batchId) is the whole-batch idempotency key. The client
      // uses the same batchId on retry, so a row here means the batch was
      // already processed and should not be reapplied.
      const existingBatch = await tx.syncBatch.findUnique({
        where: { deviceId_batchId: { deviceId: batch.deviceId, batchId: batch.batchId } },
      });

      const resolved = new Map<string, string>();
      // Track which UTC calendar days gained a new WorkEvent so their
      // WorkDay rollup can be recomputed. Dates with only replayed events
      // are already correct and don't need recalculation.
      const touchedWorkDates = new Set<string>();
      let accepted = 0;
      let skipped = 0;

      for (const event of batch.events) {
        try {
          let sessionId: string | undefined = event.sessionId;
          if (SESSION_SCOPED_EVENT_TYPES.has(event.type)) {
            sessionId = await this.resolveSessionId(tx, userId, batch.deviceId, event, resolved, sessionMappings);
          }

          if (existingBatch) {
            // Replay path: session resolution above re-derives mappings, but
            // no rows are written and no rollups are touched. The stored
            // counts are authoritative.
            continue;
          }

          const wasNew = await this.persistEventIfNew(tx, batch.deviceId, sessionId, event);
          if (wasNew) {
            accepted += 1;
            touchedWorkDates.add(this.workDateKey(new Date(event.occurredAt)));
          } else {
            skipped += 1;
          }
        } catch (err) {
          // Isolate the failure to this event — log it and surface it via
          // `errors` rather than rolling back the rest of the batch.
          const message = err instanceof Error ? err.message : 'Failed to process event.';
          // eslint-disable-next-line no-console
          console.warn(
            '[sync] event ' + event.clientEventId + ' on device ' + batch.deviceId +
              ' failed to process and was recorded as an error: ' + message,
          );
          errors.push({ clientEventId: event.clientEventId, message });
        }
      }

      if (existingBatch) {
        return {
          accepted: existingBatch.acceptedCount,
          skipped: existingBatch.skippedCount,
          duplicateBatch: true,
        };
      }

      // Recalculate WorkDay totals for every date that gained a new event,
      // before recording the batch. This ensures replays short-circuit to
      // correct totals, and that a retry after partial failure is safe
      // (recalculation is idempotent).
      for (const workDate of touchedWorkDates) {
        await this.recalculateWorkDay(tx, userId, workDate);
      }

      await tx.syncBatch.create({
        data: {
          deviceId: batch.deviceId,
          batchId: batch.batchId,
          acceptedCount: accepted,
          skippedCount: skipped,
        },
      });

      return { accepted, skipped, duplicateBatch: false };
    });

    return {
      accepted: result.accepted,
      skipped: result.skipped,
      duplicateBatch: result.duplicateBatch,
      sessionMappings,
      errors,
    };
  }
}
