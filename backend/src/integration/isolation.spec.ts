import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { hashPassword } from '../auth/password.util';
import { AllExceptionsFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma.service';

/**
 * #29 — Isolation/integration tests.
 *
 * Every other spec in this codebase (#20-#28) is a unit test: a service
 * wired to an in-memory `FakePrisma`, called directly. Those are the right
 * tool for "does this one service do the right thing with these inputs," and
 * each already has its own per-user-isolation cases (`WorkActionsService`,
 * `IdleRecordsService`, `TodaySummaryService`, ...).
 *
 * What none of them can see is the *whole stack working together* — does a
 * real HTTP request actually flow through `JwtAuthGuard` → `ValidationPipe`
 * → controller → service → `AllExceptionsFilter` and come out the other side
 * correctly? And, the specific cross-cutting concern #29 calls out by name:
 * can user A, armed with nothing but a valid access token and guesses at
 * other users' resource ids, ever read or act on user B's data through *any*
 * desktop endpoint?
 *
 * This suite boots the real `AppModule` (so guards/pipes/filters/routing are
 * all the genuine article) with `PrismaService` swapped for an in-memory
 * fake — same "no live Postgres in this sandbox" rationale as every other
 * `FakePrisma` here, just one shared across the whole app instead of scoped
 * to a single service — and drives it with real HTTP requests via `fetch`
 * against an ephemeral local port (no `supertest` in this scaffold's
 * dependencies).
 */

const ORG = 'org-001';
const PASSWORD = 'correct horse battery staple';

interface FakeUser {
  id: string;
  email: string;
  password: string;
  name: string | null;
  organizationId: string;
  roles: string[];
  createdAt: Date;
}

interface FakeDevice {
  id: string;
  userId: string;
  name: string;
  platform: string;
  appVersion: string | null;
  lastSeenAt: Date;
  createdAt: Date;
}

interface FakeWorkSession {
  id: string;
  userId: string;
  deviceId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  clientSessionId: string | null;
}

interface FakeWorkEvent {
  id: string;
  sessionId: string;
  deviceId: string;
  type: string;
  occurredAt: Date;
  payload: unknown;
  clientEventId: string;
}

interface FakeIdleRecord {
  id: string;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  reasonCode: string;
  reasonText: string | null;
  createdAt: Date;
}

interface FakeDailyReport {
  id: string;
  userId: string;
  workDate: string;
  completed: string;
  blockers: string;
  tomorrowPlan: string;
  needHelp: string;
  updatedAt: Date;
}

interface FakeWorkDay {
  id: string;
  userId: string;
  workDate: string;
  workedMs: number;
  idleMs: number;
  sessionCount: number;
  updatedAt: Date;
}

/**
 * One in-memory store for the whole app — every service hits the same
 * tables, exactly like a real shared database would, which is the only way
 * to meaningfully test cross-service, cross-user isolation end to end.
 * Implements only the operations the desktop/auth modules actually issue
 * (see the `this.prisma.<model>.<op>(` inventory taken from the source before
 * writing this).
 */
class FakePrisma {
  users: FakeUser[] = [];
  devices: FakeDevice[] = [];
  workSessions: FakeWorkSession[] = [];
  workEvents: FakeWorkEvent[] = [];
  idleRecords: FakeIdleRecord[] = [];
  dailyReports: FakeDailyReport[] = [];
  workDays: FakeWorkDay[] = [];

  user = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) return this.users.find((u) => u.id === where.id) ?? null;
      if (where.email) return this.users.find((u) => u.email === where.email) ?? null;
      return null;
    },
  };

  device = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId_name: { userId: string; name: string } };
      create: Omit<FakeDevice, 'id' | 'lastSeenAt' | 'createdAt'> & { lastSeenAt?: Date; createdAt?: Date };
      update: Partial<FakeDevice>;
    }) => {
      const { userId, name } = where.userId_name;
      const existing = this.devices.find((d) => d.userId === userId && d.name === name);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const device: FakeDevice = {
        id: randomUUID(),
        userId,
        name,
        platform: create.platform ?? 'windows',
        appVersion: create.appVersion ?? null,
        lastSeenAt: new Date(),
        createdAt: new Date(),
      };
      this.devices.push(device);
      return device;
    },
  };

  workSession = {
    findUnique: async ({
      where,
    }: {
      where: { id?: string; deviceId_clientSessionId?: { deviceId: string; clientSessionId: string } };
    }) => {
      if (where.id) return this.workSessions.find((s) => s.id === where.id) ?? null;
      if (where.deviceId_clientSessionId) {
        const { deviceId, clientSessionId } = where.deviceId_clientSessionId;
        return (
          this.workSessions.find((s) => s.deviceId === deviceId && s.clientSessionId === clientSessionId) ?? null
        );
      }
      return null;
    },
    create: async ({ data }: { data: Omit<FakeWorkSession, 'id'> }) => {
      const session: FakeWorkSession = { id: randomUUID(), ...data };
      this.workSessions.push(session);
      return session;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeWorkSession> }) => {
      const session = this.workSessions.find((s) => s.id === where.id);
      if (!session) throw new Error('FakePrisma.workSession.update: not found');
      Object.assign(session, data);
      return session;
    },
  };

  workEvent = {
    create: async ({ data }: { data: Omit<FakeWorkEvent, 'id'> }) => {
      const event: FakeWorkEvent = { id: randomUUID(), ...data };
      this.workEvents.push(event);
      return event;
    },
  };

  idleRecord = {
    create: async ({ data }: { data: Omit<FakeIdleRecord, 'id' | 'createdAt'> & { createdAt?: Date } }) => {
      const record: FakeIdleRecord = { id: randomUUID(), createdAt: new Date(), ...data };
      this.idleRecords.push(record);
      return record;
    },
  };

  dailyReport = {
    findUnique: async ({ where }: { where: { userId_workDate: { userId: string; workDate: string } } }) => {
      const { userId, workDate } = where.userId_workDate;
      return this.dailyReports.find((r) => r.userId === userId && r.workDate === workDate) ?? null;
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId_workDate: { userId: string; workDate: string } };
      create: Omit<FakeDailyReport, 'id' | 'updatedAt'>;
      update: Partial<FakeDailyReport>;
    }) => {
      const { userId, workDate } = where.userId_workDate;
      const existing = this.dailyReports.find((r) => r.userId === userId && r.workDate === workDate);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const report: FakeDailyReport = { id: randomUUID(), updatedAt: new Date(), ...create };
      this.dailyReports.push(report);
      return report;
    },
  };

  workDay = {
    findUnique: async ({ where }: { where: { userId_workDate: { userId: string; workDate: string } } }) => {
      const { userId, workDate } = where.userId_workDate;
      return this.workDays.find((w) => w.userId === userId && w.workDate === workDate) ?? null;
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length > 0 ? JSON.parse(text) : undefined;
}

describe('Cross-user isolation & full-stack integration (#29)', () => {
  let app: INestApplication;
  let prisma: FakePrisma;
  let baseUrl: string;

  let userA: FakeUser;
  let userB: FakeUser;
  let tokenA: string;
  let tokenB: string;
  let deviceA: { id: string; deviceName: string };
  let sessionA: { id: string };

  const occurredAt = '2026-06-08T09:00:00.000Z';

  beforeAll(async () => {
    prisma = new FakePrisma();

    // Two real, hashed-password users — login goes through the genuine
    // scrypt verify path, not a shortcut, so the access tokens used below
    // are the same kind a real client would present.
    userA = {
      id: randomUUID(),
      email: 'alice@example.com',
      password: await hashPassword(PASSWORD),
      name: 'Alice',
      organizationId: ORG,
      roles: ['employee'],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    userB = {
      id: randomUUID(),
      email: 'bob@example.com',
      password: await hashPassword(PASSWORD),
      name: 'Bob',
      organizationId: ORG,
      roles: ['employee'],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    prisma.users.push(userA, userB);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts's bootstrap exactly - the whole point is to exercise
    // the real pipe/filter stack, not a test-only stand-in for it.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : address;
    baseUrl = `http://127.0.0.1:${port}`;

    // Log both users in for real, through POST /auth/login - the access
    // tokens that follow are exactly what JwtAuthGuard will see from a real
    // client.
    const loginA = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: userA.email, password: PASSWORD }),
    });
    const loginB = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: userB.email, password: PASSWORD }),
    });
    tokenA = ((await readJson(loginA)) as { accessToken: string }).accessToken;
    tokenB = ((await readJson(loginB)) as { accessToken: string }).accessToken;

    // Register a device and start a session for Alice - the resource Bob
    // will spend the rest of this suite trying (and failing) to touch.
    const deviceRes = await authedPost('/desktop/devices/register', tokenA, {
      deviceName: "Alice's Laptop",
      platform: 'windows',
      appVersion: '1.0.0',
    });
    deviceA = (await readJson(deviceRes)) as { id: string; deviceName: string };

    const startRes = await authedPost('/desktop/work/start', tokenA, {
      deviceId: deviceA.id,
      occurredAt,
    });
    sessionA = (await readJson(startRes)) as { id: string };
  });

  afterAll(async () => {
    await app.close();
  });

  function authedPost(path: string, token: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  function authedGet(path: string, token: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  }

  // ---------------------------------------------------------------------
  // Baseline: the full stack works end to end for the resource's owner.
  // ---------------------------------------------------------------------

  describe('baseline — the owning user can act on their own session', () => {
    it('let Alice pause, resume, and stop the session she started, getting 204s', async () => {
      const pause = await authedPost('/desktop/work/pause', tokenA, { deviceId: deviceA.id, sessionId: sessionA.id, occurredAt });
      expect(pause.status).toBe(204);

      const resume = await authedPost('/desktop/work/resume', tokenA, { deviceId: deviceA.id, sessionId: sessionA.id, occurredAt });
      expect(resume.status).toBe(204);

      const stop = await authedPost('/desktop/work/stop', tokenA, { deviceId: deviceA.id, sessionId: sessionA.id, occurredAt });
      expect(stop.status).toBe(204);

      const stored = prisma.workSessions.find((s) => s.id === sessionA.id);
      expect(stored?.status).toBe('stopped');
      expect(stored?.endedAt).not.toBeNull();
      // start + pause + resume + stop = 4 recorded events, all on Alice's session.
      expect(prisma.workEvents.filter((e) => e.sessionId === sessionA.id)).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------
  // The core of #29: can Bob ever read or act on Alice's resources?
  // ---------------------------------------------------------------------

  describe('isolation — Bob cannot read or act on Alice’s WorkSession via /desktop/work/*', () => {
    it('returns 404 WORK_SESSION_NOT_FOUND (not 403, not Alice’s data) when Bob tries to pause Alice’s session by id', async () => {
      const res = await authedPost('/desktop/work/pause', tokenB, { deviceId: deviceA.id, sessionId: sessionA.id, occurredAt });

      expect(res.status).toBe(404);
      expect(await readJson(res)).toEqual({
        statusCode: 404,
        code: 'WORK_SESSION_NOT_FOUND',
        message: 'No matching work session was found for this account.',
      });
    });

    it('responds identically (404 WORK_SESSION_NOT_FOUND) for "exists but is someone else’s" and "does not exist at all"', async () => {
      // This is the account-enumeration-style masking WorkActionsService.resolveSession
      // documents - a session reference is an opaque token, and the response
      // must not let a caller distinguish "not yours" from "doesn't exist."
      const othersSession = await authedPost('/desktop/work/resume', tokenB, { deviceId: deviceA.id, sessionId: sessionA.id, occurredAt });
      const nonexistentSession = await authedPost('/desktop/work/resume', tokenB, {
        deviceId: deviceA.id,
        sessionId: randomUUID(),
        occurredAt,
      });

      expect(othersSession.status).toBe(nonexistentSession.status);
      expect(await readJson(othersSession)).toEqual(await readJson(nonexistentSession));
    });

    it('does not let Bob stop (mutate) Alice’s session - her row is untouched after his attempt', async () => {
      const before = { ...prisma.workSessions.find((s) => s.id === sessionA.id) };

      const res = await authedPost('/desktop/work/stop', tokenB, { deviceId: deviceA.id, sessionId: sessionA.id, occurredAt });
      expect(res.status).toBe(404);

      const after = prisma.workSessions.find((s) => s.id === sessionA.id);
      expect(after).toEqual(before);
    });
  });

  describe('isolation — Bob cannot submit an idle record against Alice’s session', () => {
    it('returns 404 WORK_SESSION_NOT_FOUND and creates neither an IdleRecord nor a WorkEvent', async () => {
      const idleCountBefore = prisma.idleRecords.length;
      const eventCountBefore = prisma.workEvents.length;

      const res = await authedPost('/desktop/idle-records', tokenB, {
        sessionId: sessionA.id,
        idleStartedAt: occurredAt,
        idleEndedAt: '2026-06-08T09:10:00.000Z',
        reasonCode: 'meeting',
      });

      expect(res.status).toBe(404);
      expect(await readJson(res)).toMatchObject({ code: 'WORK_SESSION_NOT_FOUND' });
      // Same masking as /desktop/work/* - IdleRecordsService.submit reuses
      // resolveSession's "session ref is opaque" reasoning (#25).
      expect(prisma.idleRecords).toHaveLength(idleCountBefore);
      expect(prisma.workEvents).toHaveLength(eventCountBefore);
    });
  });

  describe('isolation — daily reports and today-summary are strictly per-caller, with no id to even guess at', () => {
    const workDate = '2026-06-08';

    it('lets each user submit their own daily report without colliding, and keeps GET .../today-summary scoped to the caller', async () => {
      const aliceSubmit = await authedPost('/desktop/daily-reports', tokenA, {
        workDate,
        completed: 'Shipped the isolation tests',
        blockers: '',
        tomorrowPlan: 'Write more',
        needHelp: '',
      });
      const bobSubmit = await authedPost('/desktop/daily-reports', tokenB, {
        workDate,
        completed: 'Reviewed PRs',
        blockers: 'Blocked on Alice',
        tomorrowPlan: '',
        needHelp: '',
      });
      expect(aliceSubmit.status).toBe(204);
      expect(bobSubmit.status).toBe(204);

      // Two distinct rows - the (userId, workDate) upsert key (#26) keeps
      // them from colliding or overwriting one another.
      const reportsForDay = prisma.dailyReports.filter((r) => r.workDate === workDate);
      expect(reportsForDay).toHaveLength(2);
      expect(reportsForDay.find((r) => r.userId === userA.id)?.completed).toBe('Shipped the isolation tests');
      expect(reportsForDay.find((r) => r.userId === userB.id)?.completed).toBe('Reviewed PRs');

      // today-summary takes no id at all - it can only ever describe "me."
      // Seed a WorkDay row for each user on the same date and confirm each
      // caller sees only their own.
      prisma.workDays.push(
        { id: randomUUID(), userId: userA.id, workDate, workedMs: 111_000, idleMs: 1_000, sessionCount: 1, updatedAt: new Date() },
        { id: randomUUID(), userId: userB.id, workDate, workedMs: 222_000, idleMs: 2_000, sessionCount: 2, updatedAt: new Date() },
      );

      const summaryA = (await readJson(await authedGet('/desktop/today-summary', tokenA))) as { workedMs: number; reportSubmitted: boolean };
      const summaryB = (await readJson(await authedGet('/desktop/today-summary', tokenB))) as { workedMs: number; reportSubmitted: boolean };

      expect(summaryA.workedMs).toBe(111_000);
      expect(summaryA.reportSubmitted).toBe(true);
      expect(summaryB.workedMs).toBe(222_000);
      expect(summaryB.reportSubmitted).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Auth boundary + standardized error shape, exercised through real HTTP -
  // #28's filter is only meaningfully tested by seeing what actually lands
  // on the wire for each failure family.
  // ---------------------------------------------------------------------

  describe('auth boundary — every guarded route rejects a missing/invalid token the same standardized way', () => {
    it.each([
      ['POST /desktop/work/start', () => fetch(`${baseUrl}/desktop/work/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })],
      ['GET /desktop/today-summary', () => fetch(`${baseUrl}/desktop/today-summary`)],
      ['POST /desktop/idle-records', () => fetch(`${baseUrl}/desktop/idle-records`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })],
    ])('%s with no Authorization header → 401 MISSING_ACCESS_TOKEN', async (_label, makeRequest) => {
      const res = await makeRequest();
      expect(res.status).toBe(401);
      expect(await readJson(res)).toEqual({
        statusCode: 401,
        code: 'MISSING_ACCESS_TOKEN',
        message: 'Authorization: Bearer <token> header is required.',
      });
    });

    it('rejects a syntactically-valid-looking but bogus bearer token with 401 INVALID_ACCESS_TOKEN', async () => {
      const res = await authedGet('/desktop/today-summary', 'not-a-real-jwt.definitely.not');
      expect(res.status).toBe(401);
      expect(await readJson(res)).toEqual({
        statusCode: 401,
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Access token is invalid or expired.',
      });
    });

    it("rejects login with the wrong password using the same INVALID_CREDENTIALS the unknown-email path uses (no enumeration)", async () => {
      const wrongPassword = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: userA.email, password: 'definitely-wrong' }),
      });
      const unknownEmail = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody-by-this-name@example.com', password: 'whatever' }),
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);

      const wrongPasswordBody = await readJson(wrongPassword);
      const unknownEmailBody = await readJson(unknownEmail);
      const expected = { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' };

      expect(wrongPasswordBody).toEqual(expected);
      expect(unknownEmailBody).toEqual(expected);
    });
  });

  describe('validation boundary — malformed bodies come back as the standardized VALIDATION_ERROR shape (#28)', () => {
    it('returns 400 VALIDATION_ERROR with a single joined message when required fields are missing/malformed', async () => {
      // Missing `deviceId` (required, @IsUUID) and `occurredAt` (required,
      // @IsDateString) - exactly the kind of malformed body ValidationPipe
      // rejects before the controller ever runs.
      const res = await authedPost('/desktop/work/start', tokenA, { occurredAt: 'not-a-real-date' });

      expect(res.status).toBe(400);
      const body = (await readJson(res)) as { statusCode: number; code: string; message: string };
      expect(body.statusCode).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      // Flattened to one string (ValidationPipe's per-field array joined by
      // '; ') - never an array the caller has to branch on.
      expect(typeof body.message).toBe('string');
      expect(body.message).toContain('deviceId');
      expect(body.message).toContain('occurredAt');
    });

    it('returns 400 VALIDATION_ERROR for a daily-report submission with a malformed workDate', async () => {
      const res = await authedPost('/desktop/daily-reports', tokenA, {
        workDate: '06/08/2026', // not yyyy-MM-dd - @Matches rejects it
        completed: 'x',
        blockers: 'x',
        tomorrowPlan: 'x',
        needHelp: 'x',
      });

      expect(res.status).toBe(400);
      expect(await readJson(res)).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });
  });

  describe('unmapped routes — Nest’s own 404 also comes back in the standardized shape (#28)', () => {
    it('codes an unmapped route as NOT_FOUND, derived from Nest’s own "Not Found" phrase', async () => {
      const res = await authedGet('/desktop/this-route-does-not-exist', tokenA);

      expect(res.status).toBe(404);
      const body = (await readJson(res)) as { statusCode: number; code: string; message: string };
      expect(body.statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(typeof body.message).toBe('string');
    });
  });
});
