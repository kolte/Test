import { NotFoundException } from '@nestjs/common';
import { IdleRecord, User, WorkEvent, WorkSession } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SubmitIdleRecordDto } from './dto/idle-record.dto';
import { IdleRecordsService } from './idle-records.service';

/**
 * Minimal in-memory stand-in for the slice of PrismaClient IdleRecordsService
 * touches - same rationale as the other `FakePrisma`s (devices/work-actions/
 * sync .service.spec.ts): no live Postgres in this sandbox, so the real
 * service logic runs against scripted tables.
 */
class FakePrisma {
  sessions: WorkSession[];
  idleRecords: IdleRecord[] = [];
  events: WorkEvent[] = [];
  private nextRecordId = 1;
  private nextEventId = 1;

  constructor(sessions: WorkSession[]) {
    this.sessions = sessions;
  }

  workSession = {
    findUnique: async ({ where }: { where: { id: string } }) => this.sessions.find((s) => s.id === where.id) ?? null,
  };

  idleRecord = {
    create: async ({ data }: { data: Omit<IdleRecord, 'id' | 'createdAt'> }) => {
      const created: IdleRecord = { id: `idle-${this.nextRecordId++}`, createdAt: new Date('2026-06-08T00:00:00.000Z'), ...data } as IdleRecord;
      this.idleRecords.push(created);
      return created;
    },
  };

  workEvent = {
    create: async ({ data }: { data: Omit<WorkEvent, 'id'> }) => {
      const created = { id: `event-${this.nextEventId++}`, ...data } as WorkEvent;
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

const SESSION: WorkSession = {
  id: 'session-1',
  userId: 'user-1',
  deviceId: 'device-1',
  startedAt: new Date('2026-06-08T09:00:00.000Z'),
  endedAt: null,
  status: 'active',
  clientSessionId: null,
};

function makeDto(overrides: Partial<SubmitIdleRecordDto> = {}): SubmitIdleRecordDto {
  return {
    sessionId: SESSION.id,
    idleStartedAt: '2026-06-08T10:00:00.000Z',
    idleEndedAt: '2026-06-08T10:05:00.000Z',
    reasonCode: 'meeting',
    reasonText: null,
    autoPaused: true,
    ...overrides,
  };
}

describe('IdleRecordsService (#25)', () => {
  let prisma: FakePrisma;
  let service: IdleRecordsService;

  beforeEach(() => {
    prisma = new FakePrisma([{ ...SESSION }]);
    service = new IdleRecordsService(prisma as unknown as PrismaService);
  });

  it('records an IdleRecord with the submitted interval and reason', async () => {
    await service.submit(USER, makeDto({ reasonText: 'Standup ran long' }));

    expect(prisma.idleRecords).toHaveLength(1);
    expect(prisma.idleRecords[0]).toMatchObject({
      sessionId: 'session-1',
      startedAt: new Date('2026-06-08T10:00:00.000Z'),
      endedAt: new Date('2026-06-08T10:05:00.000Z'),
      reasonCode: 'meeting',
      reasonText: 'Standup ran long',
    });
  });

  it('falls back to null when reasonText is omitted', async () => {
    await service.submit(USER, makeDto({ reasonText: undefined }));
    expect(prisma.idleRecords[0].reasonText).toBeNull();
  });

  it('also records an idle_resolved WorkEvent mirroring the offline-queued shape, with a generated clientEventId', async () => {
    await service.submit(USER, makeDto({ reasonCode: 'phone' }));

    expect(prisma.events).toHaveLength(1);
    const event = prisma.events[0];
    expect(event).toMatchObject({
      sessionId: 'session-1',
      deviceId: 'device-1',
      type: 'idle_resolved',
      occurredAt: new Date('2026-06-08T10:05:00.000Z'),
      payload: { reasonCode: 'phone' },
    });
    expect(typeof event.clientEventId).toBe('string');
    expect(event.clientEventId.length).toBeGreaterThan(0);
  });

  it('ignores autoPaused (no matching column - the auto/manual distinction lives on WorkEvent.type)', async () => {
    await service.submit(USER, makeDto({ autoPaused: true }));
    const stored = prisma.idleRecords[0] as unknown as Record<string, unknown>;
    expect('autoPaused' in stored).toBe(false);
  });

  it('rejects an unknown sessionId as not found', async () => {
    await expect(service.submit(USER, makeDto({ sessionId: 'session-does-not-exist' }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.submit(USER, makeDto({ sessionId: 'session-does-not-exist' }))).rejects.toMatchObject({
      response: { code: 'WORK_SESSION_NOT_FOUND' },
    });
  });

  it("does not let one user submit an idle record against another user's session", async () => {
    await expect(service.submit(OTHER_USER, makeDto())).rejects.toMatchObject({
      response: { code: 'WORK_SESSION_NOT_FOUND' },
    });
    expect(prisma.idleRecords).toHaveLength(0);
    expect(prisma.events).toHaveLength(0);
  });
});
