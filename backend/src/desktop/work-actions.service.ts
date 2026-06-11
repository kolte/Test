import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { User, WorkSession } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { StartWorkDto, WorkActionDto, WorkSessionDto } from './dto/work-action.dto';

/**
 * WorkEvent type values produced by live (online) work actions. The idle
 * flow produces additional types (auto_paused, manual_paused, idle_resolved)
 * handled by IdleRecordsService. See SESSION_SCOPED_EVENT_TYPES in
 * sync.service.ts for the full set the sync pipeline understands.
 */
const ACTION_EVENT_TYPES = {
  start: 'work_started',
  pause: 'work_paused',
  resume: 'work_resumed',
  stop: 'work_stopped',
} as const;

type Action = keyof typeof ACTION_EVENT_TYPES;

/**
 * Implements POST /desktop/work/{start,pause,resume,stop} — the live
 * counterparts to the offline-sync pipeline. When the client is online it
 * calls these directly for an immediate response instead of queuing events
 * for a later batch. Both paths write to the same WorkSession/WorkEvent
 * tables and respect the same (deviceId, clientSessionId) /
 * (deviceId, clientEventId) uniqueness constraints, so a session can be
 * started live and later touched via offline events without creating
 * duplicate rows.
 */
@Injectable()
export class WorkActionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starts a new work session. If clientSessionId is present and already
   * known — e.g. a retried request after a dropped response, or the client
   * started offline and is now confirming online — the existing session is
   * returned rather than creating a duplicate. This mirrors the
   * (deviceId, clientSessionId) idempotency guarantee in SyncService.
   */
  async start(user: User, dto: StartWorkDto): Promise<WorkSessionDto> {
    const occurredAt = new Date(dto.occurredAt);

    if (dto.clientSessionId) {
      const existing = await this.prisma.workSession.findUnique({
        where: { deviceId_clientSessionId: { deviceId: dto.deviceId, clientSessionId: dto.clientSessionId } },
      });
      if (existing) {
        return this.toWorkSessionDto(existing, dto.projectId ?? null);
      }
    }

    const session = await this.prisma.workSession.create({
      data: {
        userId: user.id,
        deviceId: dto.deviceId,
        clientSessionId: dto.clientSessionId ?? null,
        startedAt: occurredAt,
        status: 'active',
      },
    });

    await this.recordEvent(session.id, dto.deviceId, 'start', occurredAt);

    return this.toWorkSessionDto(session, dto.projectId ?? null);
  }

  async pause(user: User, dto: WorkActionDto): Promise<void> {
    await this.applyAction(user, dto, 'pause', { status: 'paused' });
  }

  async resume(user: User, dto: WorkActionDto): Promise<void> {
    await this.applyAction(user, dto, 'resume', { status: 'active' });
  }

  async stop(user: User, dto: WorkActionDto): Promise<void> {
    await this.applyAction(user, dto, 'stop', (occurredAt) => ({ status: 'stopped', endedAt: occurredAt }));
  }

  /**
   * Shared resolve → authorize → update → record-event flow for `pause` /
   * `resume` / `stop`. `patch` is either a fixed set of columns to update, or
   * a function of `occurredAt` (only `stop` needs the timestamp itself, to
   * close out `endedAt`).
   */
  private async applyAction(
    user: User,
    dto: WorkActionDto,
    action: Exclude<Action, 'start'>,
    patch: Partial<Pick<WorkSession, 'status' | 'endedAt'>> | ((occurredAt: Date) => Partial<Pick<WorkSession, 'status' | 'endedAt'>>),
  ): Promise<void> {
    const occurredAt = new Date(dto.occurredAt);
    const session = await this.resolveSession(user, dto);

    const data = typeof patch === 'function' ? patch(occurredAt) : patch;
    await this.prisma.workSession.update({ where: { id: session.id }, data });
    await this.recordEvent(session.id, dto.deviceId, action, occurredAt);
  }

  /**
   * Resolves and authorizes the WorkSession for a pause/resume/stop request.
   * Mirrors the session-resolution logic in SyncService, but without the
   * "create on first sight" branch — a live action always refers to a session
   * that already exists. sessionId is preferred when present; clientSessionId
   * is the fallback for the window before the client has received the
   * server-assigned id.
   */
  private async resolveSession(user: User, dto: WorkActionDto): Promise<WorkSession> {
    if (!dto.sessionId && !dto.clientSessionId) {
      throw new BadRequestException({
        code: 'ACTION_MISSING_SESSION_REFERENCE',
        message: 'Request must include sessionId or clientSessionId.',
      });
    }

    const session = dto.sessionId
      ? await this.prisma.workSession.findUnique({ where: { id: dto.sessionId } })
      : await this.prisma.workSession.findUnique({
          where: { deviceId_clientSessionId: { deviceId: dto.deviceId, clientSessionId: dto.clientSessionId! } },
        });

    // Return the same error for "not found" and "belongs to another user" —
    // confirming whether a session id belongs to someone else would leak
    // information for no benefit (same reasoning as account enumeration
    // resistance in AuthService).
    if (!session || session.userId !== user.id) {
      throw new NotFoundException({
        code: 'WORK_SESSION_NOT_FOUND',
        message: 'No matching work session was found for this account.',
      });
    }

    return session;
  }

  private async recordEvent(sessionId: string, deviceId: string, action: Action, occurredAt: Date): Promise<void> {
    await this.prisma.workEvent.create({
      data: {
        sessionId,
        deviceId,
        type: ACTION_EVENT_TYPES[action],
        occurredAt,
        // Live actions have no client-supplied idempotency key, so a fresh
        // random id is used to satisfy the (deviceId, clientEventId) unique
        // constraint without colliding with offline sync events.
        clientEventId: randomUUID(),
      },
    });
  }

  private toWorkSessionDto(session: WorkSession, projectId: string | null): WorkSessionDto {
    return {
      id: session.id,
      userId: session.userId,
      projectId,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      status: session.status,
    };
  }
}
