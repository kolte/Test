import { BadRequestException, NotFoundException } from '@nestjs/common';
import { User, WorkEvent, WorkSession } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { StartWorkDto, WorkActionDto } from './dto/work-action.dto';
import { WorkActionsService } from './work-actions.service';

/**
 * Minimal in-memory stand-in for the slice of PrismaClient WorkActionsService
 * touches - same rationale as the other `FakePrisma`s in this scaffold (see
 * devices.service.spec.ts, sync.service.spec.ts): no live Postgres in this
 * sandbox, so the fake runs the *real* service logic against scripted tables,
 * including the `(deviceId, clientSessionId)` lookup the live reuse path
 * (mirroring `SyncService.resolveSessionId`, #14) depends on.
 */
class FakePrisma {
  sessions: WorkSession[] = [];
  events: WorkEvent[] = [];
  private nextSessionId = 1;
  private nextEventId = 1;

  workSession = {
    findUnique: async ({ where }: { where: { id?: string; deviceId_clientSessionId?: { deviceId: string; clientSessionId: string } } }) => {
      if (where.id) {
        return this.sessions.find((s) => s.id === where.id) ?? null;
      }
      const { deviceId, clientSessionId } = where.deviceId_clientSessionId!;
      return this.sessions.find((s) => s.deviceId === deviceId && s.clientSessionId === clientSessionId) ?? null;
    },
    create: async ({ data }: { data: Omit<WorkSession, 'id' | 'endedAt'> & { endedAt?: Date | null } }) => {
      const created: WorkSession = {
        id: `session-${this.nextSessionId++}`,
        endedAt: null,
        ...data,
      } as WorkSession;
      this.sessions.push(created);
      return created;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<WorkSession> }) => {
      const session = this.sessions.find((s) => s.id === where.id);
      if (!session) throw new Error(`No session ${where.id}`);
      Object.assign(session, data);
      return session;
    },
  };

  workEvent = {
    create: async ({ data }: { data: Omit<WorkEvent, 'id' | 'payload'> & { payload?: unknown } }) => {
      const created = { id: `event-${this.nextEventId++}`, payload: null, ...data } as WorkEvent;
      this.events.push(created);
      return created;
    },
  };
}

const USER: User = {
  id: 'user-1',
  email: 'demo@example.com',
  password: 'hashed',
  name: 'Demo User',
  organizationId: 'org-001',
  roles: ['employee'],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const OTHER_USER: User = { ...USER, id: 'user-2', email: 'other@example.com' };

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const OCCURRED_AT = '2026-06-08T09:00:00.000Z';

function startDto(overrides: Partial<StartWorkDto> = {}): StartWorkDto {
  return { deviceId: DEVICE_ID, occurredAt: OCCURRED_AT, ...overrides };
}

function actionDto(overrides: Partial<WorkActionDto> = {}): WorkActionDto {
  return { deviceId: DEVICE_ID, occurredAt: OCCURRED_AT, ...overrides };
}

describe('WorkActionsService (#24)', () => {
  let prisma: FakePrisma;
  let service: WorkActionsService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new WorkActionsService(prisma as unknown as PrismaService);
  });

  describe('start', () => {
    it('creates a new active session, records a work_started event, and returns the WorkSession shape', async () => {
      const result = await service.start(USER, startDto({ clientSessionId: CLIENT_SESSION_ID, projectId: null }));

      expect(result).toEqual({
        id: 'session-1',
        userId: 'user-1',
        projectId: null,
        startedAt: OCCURRED_AT,
        endedAt: null,
        status: 'active',
      });
      expect(prisma.sessions).toHaveLength(1);
      expect(prisma.sessions[0]).toMatchObject({ deviceId: DEVICE_ID, clientSessionId: CLIENT_SESSION_ID, status: 'active' });
      expect(prisma.events).toHaveLength(1);
      expect(prisma.events[0]).toMatchObject({ sessionId: 'session-1', deviceId: DEVICE_ID, type: 'work_started' });
      expect(typeof prisma.events[0].clientEventId).toBe('string');
      expect(prisma.events[0].clientEventId.length).toBeGreaterThan(0);
    });

    it('echoes back the projectId it was given without persisting a Project subsystem', async () => {
      const result = await service.start(USER, startDto({ projectId: 'proj-77' }));
      expect(result.projectId).toBe('proj-77');
    });

    it('is idempotent on (deviceId, clientSessionId): a retried start reuses the existing session instead of creating a duplicate', async () => {
      const first = await service.start(USER, startDto({ clientSessionId: CLIENT_SESSION_ID }));
      const second = await service.start(USER, startDto({ clientSessionId: CLIENT_SESSION_ID }));

      expect(second.id).toBe(first.id);
      expect(prisma.sessions).toHaveLength(1);
      // No second work_started should be recorded for the replayed start.
      expect(prisma.events).toHaveLength(1);
    });

    it('creates a session without a clientSessionId when the client omits one (legacy/online-only flow)', async () => {
      const result = await service.start(USER, startDto());

      expect(prisma.sessions[0].clientSessionId).toBeNull();
      expect(result.status).toBe('active');
    });
  });

  describe('pause / resume / stop', () => {
    async function startSession(): Promise<string> {
      const session = await service.start(USER, startDto({ clientSessionId: CLIENT_SESSION_ID }));
      return session.id;
    }

    it('pauses a session by sessionId, updates status, and records a work_paused event', async () => {
      const sessionId = await startSession();

      await service.pause(USER, actionDto({ sessionId, occurredAt: '2026-06-08T09:30:00.000Z' }));

      expect(prisma.sessions[0].status).toBe('paused');
      expect(prisma.events.at(-1)).toMatchObject({ sessionId, type: 'work_paused' });
    });

    it('resolves by clientSessionId when sessionId is absent (the brief offline-confirmation window)', async () => {
      const sessionId = await startSession();

      await service.pause(USER, actionDto({ sessionId: undefined, clientSessionId: CLIENT_SESSION_ID }));

      expect(prisma.sessions[0].id).toBe(sessionId);
      expect(prisma.sessions[0].status).toBe('paused');
    });

    it('resumes a paused session back to active', async () => {
      const sessionId = await startSession();
      await service.pause(USER, actionDto({ sessionId }));

      await service.resume(USER, actionDto({ sessionId }));

      expect(prisma.sessions[0].status).toBe('active');
      expect(prisma.events.at(-1)).toMatchObject({ sessionId, type: 'work_resumed' });
    });

    it('stops a session, setting status to stopped and recording endedAt from occurredAt', async () => {
      const sessionId = await startSession();

      await service.stop(USER, actionDto({ sessionId, occurredAt: '2026-06-08T17:00:00.000Z' }));

      expect(prisma.sessions[0].status).toBe('stopped');
      expect(prisma.sessions[0].endedAt).toEqual(new Date('2026-06-08T17:00:00.000Z'));
      expect(prisma.events.at(-1)).toMatchObject({ sessionId, type: 'work_stopped' });
    });

    it('rejects a request with neither sessionId nor clientSessionId', async () => {
      await expect(service.pause(USER, actionDto())).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.pause(USER, actionDto())).rejects.toMatchObject({
        response: { code: 'ACTION_MISSING_SESSION_REFERENCE' },
      });
    });

    it('returns 404-equivalent for an unknown session id', async () => {
      await expect(service.pause(USER, actionDto({ sessionId: 'session-does-not-exist' }))).rejects.toBeInstanceOf(NotFoundException);
    });

    it("does not let one user act on another user's session (same not-found response as a missing session)", async () => {
      const sessionId = await startSession();

      await expect(service.pause(OTHER_USER, actionDto({ sessionId }))).rejects.toMatchObject({
        response: { code: 'WORK_SESSION_NOT_FOUND' },
      });
      // Confirm it really didn't mutate the other user's session.
      expect(prisma.sessions[0].status).toBe('active');
    });
  });
});
