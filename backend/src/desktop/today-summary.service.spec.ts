import { DailyReport, User, WorkDay } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TodaySummaryService } from './today-summary.service';

/**
 * Minimal in-memory stand-in for the slice of PrismaClient
 * TodaySummaryService touches - a read-only pair of `(userId, workDate)`
 * lookups against `WorkDay` (#17's rollup) and `DailyReport` (#26). Same
 * `FakePrisma` rationale as elsewhere (no live Postgres in this sandbox).
 */
class FakePrisma {
  workDays: WorkDay[];
  reports: DailyReport[];

  constructor(workDays: WorkDay[] = [], reports: DailyReport[] = []) {
    this.workDays = workDays;
    this.reports = reports;
  }

  workDay = {
    findUnique: async ({ where }: { where: { userId_workDate: { userId: string; workDate: string } } }) => {
      const { userId, workDate } = where.userId_workDate;
      return this.workDays.find((w) => w.userId === userId && w.workDate === workDate) ?? null;
    },
  };

  dailyReport = {
    findUnique: async ({ where }: { where: { userId_workDate: { userId: string; workDate: string } } }) => {
      const { userId, workDate } = where.userId_workDate;
      return this.reports.find((r) => r.userId === userId && r.workDate === workDate) ?? null;
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

// Fixed "now" so tests don't race the system clock across a UTC day
// boundary - see TodaySummaryService.getSummary's `now` parameter doc.
const NOW = new Date('2026-06-08T15:30:00.000Z');
const TODAY = '2026-06-08';

function workDay(overrides: Partial<WorkDay> = {}): WorkDay {
  return {
    id: 'workday-1',
    userId: 'user-1',
    workDate: TODAY,
    workedMs: 4 * 60 * 60 * 1000,
    idleMs: 15 * 60 * 1000,
    sessionCount: 2,
    updatedAt: NOW,
    ...overrides,
  };
}

function dailyReport(overrides: Partial<DailyReport> = {}): DailyReport {
  return {
    id: 'report-1',
    userId: 'user-1',
    workDate: TODAY,
    completed: 'Did stuff',
    blockers: null,
    tomorrowPlan: null,
    needHelp: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('TodaySummaryService (#27)', () => {
  it('returns the (userId, today) WorkDay totals and reportSubmitted: true when both rows exist', async () => {
    const prisma = new FakePrisma([workDay()], [dailyReport()]);
    const service = new TodaySummaryService(prisma as unknown as PrismaService);

    const summary = await service.getSummary(USER, NOW);

    expect(summary).toEqual({
      workDate: TODAY,
      workedMs: 4 * 60 * 60 * 1000,
      idleMs: 15 * 60 * 1000,
      sessionCount: 2,
      reportSubmitted: true,
    });
  });

  it('defaults the rollup fields to zero (not null/error) when no WorkDay row exists yet for today', async () => {
    const prisma = new FakePrisma([], []);
    const service = new TodaySummaryService(prisma as unknown as PrismaService);

    const summary = await service.getSummary(USER, NOW);

    expect(summary).toEqual({
      workDate: TODAY,
      workedMs: 0,
      idleMs: 0,
      sessionCount: 0,
      reportSubmitted: false,
    });
  });

  it('reports reportSubmitted: false when a report exists for a different day', async () => {
    const prisma = new FakePrisma([workDay()], [dailyReport({ workDate: '2026-06-07' })]);
    const service = new TodaySummaryService(prisma as unknown as PrismaService);

    const summary = await service.getSummary(USER, NOW);

    expect(summary.reportSubmitted).toBe(false);
    // ...but the WorkDay totals for today are still surfaced correctly.
    expect(summary.workedMs).toBe(workDay().workedMs);
  });

  it('keys "today" off the UTC calendar day, matching SyncService.workDateKey (#17) - not the local date', async () => {
    const prisma = new FakePrisma([workDay({ workDate: '2026-06-09' })], []);
    const service = new TodaySummaryService(prisma as unknown as PrismaService);

    // 2026-06-08T23:30Z is still 2026-06-08 in UTC (and in many western
    // timezones already 2026-06-09 locally) - the UTC day's WorkDay row
    // (keyed '2026-06-08', absent here) should be what's consulted, not the
    // '2026-06-09' row that exists.
    const lateUtc = new Date('2026-06-08T23:30:00.000Z');
    const summary = await service.getSummary(USER, lateUtc);

    expect(summary.workDate).toBe('2026-06-08');
    expect(summary.workedMs).toBe(0);
    expect(summary.sessionCount).toBe(0);
  });

  it('only ever returns the calling user\'s own rows', async () => {
    const otherUsersWorkDay = workDay({ id: 'workday-2', userId: 'user-2' });
    const prisma = new FakePrisma([otherUsersWorkDay], []);
    const service = new TodaySummaryService(prisma as unknown as PrismaService);

    const summary = await service.getSummary(USER, NOW);

    expect(summary.workedMs).toBe(0);
    expect(summary.sessionCount).toBe(0);
  });
});
