import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SyncService } from './sync.service';
import { SyncBatchDto, SyncEventDto } from './dto/sync-event.dto';

/**
 * In-memory stand-in for the slice of PrismaClient / Prisma.TransactionClient
 * that SyncService touches. There's no live Postgres instance available in
 * this environment (see README "Migration note"), so these tests exercise the
 * *real* SyncService logic — session resolution, idempotency, error isolation,
 * and work-day recalculation — against a tiny in-memory data store that
 * mirrors the query shapes the service issues (findUnique by composite unique
 * key, findMany with date-range + relation filters, upsert, etc).
 *
 * IDs are generated as `${prefix}-${n}` from a per-prefix counter, so the
 * first WorkSession created in a test is always "session-1", the second
 * "session-2" (independent of how many WorkEvents/WorkDays/etc were created
 * in between) — tests rely on this to pre-seed related rows (e.g.
 * IdleRecords) that reference a session before it has been created.
 */
class FakeTx {
  devices: Array<{ id: string; userId: string }> = [];
  workSessions: Array<{
    id: string;
    userId: string;
    deviceId: string;
    clientSessionId: string | null;
    startedAt: Date;
    status: string;
  }> = [];
  workEvents: Array<{
    id: string;
    sessionId: string;
    deviceId: string;
    type: string;
    occurredAt: Date;
    clientEventId: string;
    payload?: unknown;
  }> = [];
  idleRecords: Array<{ id: string; sessionId: string; startedAt: Date; endedAt: Date }> = [];
  workDays: Array<{
    id: string;
    userId: string;
    workDate: string;
    workedMs: number;
    idleMs: number;
    sessionCount: number;
  }> = [];
  syncBatches: Array<{ id: string; deviceId: string; batchId: string; acceptedCount: number; skippedCount: number }> = [];

  /** Set to a clientSessionId to simulate a DB-level failure creating that session (tests #16 error isolation). */
  failSessionCreateFor: string | null = null;

  private idCounters: Record<string, number> = {};
  /** Per-prefix counter, so the first WorkSession created is always "session-1", the first WorkEvent "event-1", etc. */
  private nextId(prefix: string): string {
    const next = (this.idCounters[prefix] ?? 0) + 1;
    this.idCounters[prefix] = next;
    return prefix + '-' + next;
  }

  device = {
    findUnique: async ({ where: { id } }: { where: { id: string } }) =>
      this.devices.find((d) => d.id === id) ?? null,
  };

  workSession = {
    findUnique: async ({
      where: { deviceId_clientSessionId },
    }: {
      where: { deviceId_clientSessionId: { deviceId: string; clientSessionId: string } };
    }) => {
      const { deviceId, clientSessionId } = deviceId_clientSessionId;
      return (
        this.workSessions.find((s) => s.deviceId === deviceId && s.clientSessionId === clientSessionId) ?? null
      );
    },
    create: async ({ data }: { data: { userId: string; deviceId: string; clientSessionId: string; startedAt: Date; status: string } }) => {
      if (this.failSessionCreateFor && data.clientSessionId === this.failSessionCreateFor) {
        throw new Error('simulated unique constraint violation creating WorkSession');
      }
      const session = { id: this.nextId('session'), ...data };
      this.workSessions.push(session);
      return session;
    },
  };

  workEvent = {
    findUnique: async ({
      where: { deviceId_clientEventId },
    }: {
      where: { deviceId_clientEventId: { deviceId: string; clientEventId: string } };
    }) => {
      const { deviceId, clientEventId } = deviceId_clientEventId;
      return this.workEvents.find((e) => e.deviceId === deviceId && e.clientEventId === clientEventId) ?? null;
    },
    create: async ({
      data,
    }: {
      data: { sessionId: string; deviceId: string; type: string; occurredAt: Date; clientEventId: string; payload?: unknown };
    }) => {
      const event = { id: this.nextId('event'), ...data };
      this.workEvents.push(event);
      return event;
    },
    findMany: async ({
      where,
    }: {
      where: { occurredAt: { gte: Date; lt: Date }; session: { userId: string } };
    }) => {
      const { gte, lt } = where.occurredAt;
      const userId = where.session.userId;
      const userSessionIds = new Set(this.workSessions.filter((s) => s.userId === userId).map((s) => s.id));
      return this.workEvents
        .filter((e) => userSessionIds.has(e.sessionId) && e.occurredAt >= gte && e.occurredAt < lt)
        .slice()
        .sort((a, b) =>
          a.sessionId === b.sessionId
            ? a.occurredAt.getTime() - b.occurredAt.getTime()
            : a.sessionId.localeCompare(b.sessionId),
        );
    },
  };

  idleRecord = {
    findMany: async ({
      where,
    }: {
      where: { session: { userId: string }; startedAt: { lt: Date }; endedAt: { gt: Date } };
    }) => {
      const userId = where.session.userId;
      const beforeEnd = where.startedAt.lt;
      const afterStart = where.endedAt.gt;
      const userSessionIds = new Set(this.workSessions.filter((s) => s.userId === userId).map((s) => s.id));
      return this.idleRecords.filter(
        (r) => userSessionIds.has(r.sessionId) && r.startedAt < beforeEnd && r.endedAt > afterStart,
      );
    },
  };

  workDay = {
    upsert: async ({
      where: { userId_workDate },
      create,
      update,
    }: {
      where: { userId_workDate: { userId: string; workDate: string } };
      create: { userId: string; workDate: string; workedMs: number; idleMs: number; sessionCount: number };
      update: { workedMs: number; idleMs: number; sessionCount: number };
    }) => {
      const { userId, workDate } = userId_workDate;
      const existing = this.workDays.find((d) => d.userId === userId && d.workDate === workDate);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const created = { id: this.nextId('workday'), ...create };
      this.workDays.push(created);
      return created;
    },
  };

  syncBatch = {
    findUnique: async ({
      where: { deviceId_batchId },
    }: {
      where: { deviceId_batchId: { deviceId: string; batchId: string } };
    }) => {
      const { deviceId, batchId } = deviceId_batchId;
      return this.syncBatches.find((b) => b.deviceId === deviceId && b.batchId === batchId) ?? null;
    },
    create: async ({
      data,
    }: {
      data: { deviceId: string; batchId: string; acceptedCount: number; skippedCount: number };
    }) => {
      const batch = { id: this.nextId('batch'), ...data };
      this.syncBatches.push(batch);
      return batch;
    },
  };
}

class FakePrismaService {
  readonly tx = new FakeTx();
  async $transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    return fn(this.tx);
  }
}

const USER_ID = 'user-1';
const DEVICE_ID = 'device-1';

function makeService(): { service: SyncService; tx: FakeTx } {
  const fakePrisma = new FakePrismaService();
  fakePrisma.tx.devices.push({ id: DEVICE_ID, userId: USER_ID });
  const service = new SyncService(fakePrisma as unknown as PrismaService);
  return { service, tx: fakePrisma.tx };
}

function event(overrides: Partial<SyncEventDto> & Pick<SyncEventDto, 'clientEventId' | 'type' | 'occurredAt'>): SyncEventDto {
  return overrides as SyncEventDto;
}

function batch(batchId: string, events: SyncEventDto[]): SyncBatchDto {
  return { deviceId: DEVICE_ID, batchId, events } as SyncBatchDto;
}

describe('SyncService', () => {
  describe('batch-level validation (#11)', () => {
    it('rejects a batch where a session-scoped event has neither sessionId nor clientSessionId', async () => {
      const { service } = makeService();
      const bad = batch('batch-bad', [
        event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z' }),
      ]);

      await expect(service.processBatch(bad)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a batch for an unknown device', async () => {
      const { service } = makeService();
      const unknownDeviceBatch: SyncBatchDto = {
        deviceId: 'no-such-device',
        batchId: 'batch-1',
        events: [event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-1' })],
      } as SyncBatchDto;

      await expect(service.processBatch(unknownDeviceBatch)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('session resolution and idempotency (#14, #15)', () => {
    it('creates a session on first sight, persists new events, and returns a clientSessionId -> sessionId mapping', async () => {
      const { service, tx } = makeService();
      const result = await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-2', type: 'work_paused', occurredAt: '2026-06-08T10:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );

      expect(result.duplicateBatch).toBe(false);
      expect(result.accepted).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.sessionMappings).toHaveLength(1);
      expect(result.sessionMappings[0].clientSessionId).toBe('cs-A');

      expect(tx.workSessions).toHaveLength(1);
      expect(tx.workSessions[0].clientSessionId).toBe('cs-A');
      expect(tx.workEvents).toHaveLength(2);

      const [mapping] = result.sessionMappings;
      expect(tx.workSessions[0].id).toBe(mapping.sessionId);
    });

    it('reuses an existing session mapping for subsequent events referencing the same clientSessionId', async () => {
      const { service, tx } = makeService();
      await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );

      const result = await service.processBatch(
        batch('batch-2', [
          event({ clientEventId: 'evt-2', type: 'work_paused', occurredAt: '2026-06-08T09:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );

      expect(tx.workSessions).toHaveLength(1); // no second session created
      expect(result.sessionMappings).toEqual([{ clientSessionId: 'cs-A', sessionId: tx.workSessions[0].id }]);
    });

    it('skips a previously-seen clientEventId without reprocessing it (#15 per-event replay)', async () => {
      const { service, tx } = makeService();
      await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );
      expect(tx.workEvents).toHaveLength(1);

      // Replays evt-1 (e.g. the client never saw batch-1's response) alongside one new event in a new batch.
      const result = await service.processBatch(
        batch('batch-2', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-2', type: 'work_paused', occurredAt: '2026-06-08T09:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );

      expect(result.duplicateBatch).toBe(false);
      expect(result.accepted).toBe(1);
      expect(result.skipped).toBe(1);
      expect(tx.workEvents).toHaveLength(2); // evt-1 was not duplicated
      expect(tx.workEvents.filter((e) => e.clientEventId === 'evt-1')).toHaveLength(1);
    });

    it('returns the original counts and re-derived mappings for a replayed batchId without reprocessing (#13 whole-batch replay)', async () => {
      const { service, tx } = makeService();
      const original = await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-2', type: 'work_paused', occurredAt: '2026-06-08T10:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );
      const eventCountAfterFirst = tx.workEvents.length;
      const sessionCountAfterFirst = tx.workSessions.length;
      const workDaySnapshot = JSON.parse(JSON.stringify(tx.workDays));

      const replay = await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-2', type: 'work_paused', occurredAt: '2026-06-08T10:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );

      expect(replay.duplicateBatch).toBe(true);
      expect(replay.accepted).toBe(original.accepted);
      expect(replay.skipped).toBe(original.skipped);
      expect(replay.sessionMappings).toEqual(original.sessionMappings);
      // Nothing was reprocessed: no new rows, no rollup recomputation.
      expect(tx.workEvents).toHaveLength(eventCountAfterFirst);
      expect(tx.workSessions).toHaveLength(sessionCountAfterFirst);
      expect(tx.workDays).toEqual(workDaySnapshot);
      expect(tx.syncBatches).toHaveLength(1);
    });
  });

  describe('per-event error isolation (#16)', () => {
    it('records a failure for one event without blocking the rest of the batch', async () => {
      const { service, tx } = makeService();
      tx.failSessionCreateFor = 'cs-broken';

      const result = await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-broken' }),
          event({ clientEventId: 'evt-2', type: 'work_started', occurredAt: '2026-06-08T09:00:00.000Z', clientSessionId: 'cs-ok' }),
        ]),
      );

      expect(result.duplicateBatch).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].clientEventId).toBe('evt-1');
      expect(result.errors[0].message).toMatch(/simulated unique constraint violation/);

      // The good event was still accepted and mapped.
      expect(result.accepted).toBe(1);
      expect(result.sessionMappings).toEqual([{ clientSessionId: 'cs-ok', sessionId: tx.workSessions[0]?.id }]);
      expect(tx.workEvents).toHaveLength(1);
      expect(tx.workEvents[0].clientEventId).toBe('evt-2');

      // The failed event counts toward neither accepted nor skipped.
      expect(result.accepted + result.skipped + result.errors.length).toBe(2);
    });
  });

  describe('work-day recalculation (#17)', () => {
    it('recomputes worked time (including a dangling open interval), clipped idle time, and session count for the touched day', async () => {
      const { service, tx } = makeService();

      // Pre-seed an idle record for the session that will be created first
      // ("session-1", per FakeTx's deterministic id counter) — fully inside
      // the UTC day window, so it should be counted in full.
      tx.idleRecords.push({
        id: 'idle-1',
        sessionId: 'session-1',
        startedAt: new Date('2026-06-08T09:30:00.000Z'),
        endedAt: new Date('2026-06-08T10:30:00.000Z'),
      });

      const result = await service.processBatch(
        batch('batch-1', [
          // session-1: a closed 2-hour interval (08:00 - 10:00).
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-2', type: 'work_paused', occurredAt: '2026-06-08T10:00:00.000Z', clientSessionId: 'cs-A' }),
          // session-2: an interval left open at day's end (23:00 - 24:00 = 1 hour).
          event({ clientEventId: 'evt-3', type: 'work_started', occurredAt: '2026-06-08T23:00:00.000Z', clientSessionId: 'cs-B' }),
        ]),
      );

      expect(result.errors).toEqual([]);
      expect(tx.workSessions.map((s) => s.id)).toEqual(['session-1', 'session-2']);

      expect(tx.workDays).toHaveLength(1);
      const [workDay] = tx.workDays;
      expect(workDay.userId).toBe(USER_ID);
      expect(workDay.workDate).toBe('2026-06-08');
      expect(workDay.workedMs).toBe(3 * 60 * 60 * 1000); // 2h closed interval + 1h dangling interval
      expect(workDay.idleMs).toBe(1 * 60 * 60 * 1000); // the fully-contained idle record
      expect(workDay.sessionCount).toBe(2);
    });

    it('clips idle time that straddles the day boundary to the UTC day window', async () => {
      const { service, tx } = makeService();

      // Idle record spans midnight: only the portion on 2026-06-08 should count
      // toward that day's rollup (90 of its 120 minutes fall before 00:00 on the 9th).
      tx.idleRecords.push({
        id: 'idle-1',
        sessionId: 'session-1',
        startedAt: new Date('2026-06-08T22:30:00.000Z'),
        endedAt: new Date('2026-06-09T00:30:00.000Z'),
      });

      const result = await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-2', type: 'work_stopped', occurredAt: '2026-06-08T08:30:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );

      expect(result.errors).toEqual([]);
      const [workDay] = tx.workDays;
      expect(workDay.idleMs).toBe(90 * 60 * 1000); // clipped to [22:30, 24:00)
    });

    it('upserts the same (userId, workDate) row in place when the day is touched again, refreshing totals', async () => {
      const { service, tx } = makeService();

      await service.processBatch(
        batch('batch-1', [
          event({ clientEventId: 'evt-1', type: 'work_started', occurredAt: '2026-06-08T08:00:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-2', type: 'work_paused', occurredAt: '2026-06-08T09:00:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );
      expect(tx.workDays).toHaveLength(1);
      expect(tx.workDays[0].workedMs).toBe(1 * 60 * 60 * 1000);
      const rowId = tx.workDays[0].id;

      // A later batch extends the same session's interval on the same day.
      await service.processBatch(
        batch('batch-2', [
          event({ clientEventId: 'evt-3', type: 'work_resumed', occurredAt: '2026-06-08T09:30:00.000Z', clientSessionId: 'cs-A' }),
          event({ clientEventId: 'evt-4', type: 'work_stopped', occurredAt: '2026-06-08T11:30:00.000Z', clientSessionId: 'cs-A' }),
        ]),
      );

      expect(tx.workDays).toHaveLength(1); // refreshed in place, not duplicated
      expect(tx.workDays[0].id).toBe(rowId);
      expect(tx.workDays[0].workedMs).toBe(3 * 60 * 60 * 1000); // 08:00-09:00 + 09:30-11:30
      expect(tx.workDays[0].sessionCount).toBe(1);
    });
  });
});
