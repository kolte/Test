import { DailyReport, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SubmitDailyReportDto } from './dto/daily-report.dto';
import { DailyReportsService } from './daily-reports.service';

/**
 * Minimal in-memory stand-in for the slice of PrismaClient that
 * DailyReportsService touches (`prisma.dailyReport.upsert` keyed on the
 * `(userId, workDate)` composite unique constraint). Lets the real service
 * logic run against scripted data without a live Postgres instance.
 */
class FakePrisma {
  reports: DailyReport[] = [];
  private nextId = 1;

  dailyReport = {
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { userId_workDate: { userId: string; workDate: string } };
      update: Partial<DailyReport>;
      create: Omit<DailyReport, 'id' | 'updatedAt'>;
    }) => {
      const { userId, workDate } = where.userId_workDate;
      const existing = this.reports.find((r) => r.userId === userId && r.workDate === workDate);

      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date('2026-06-08T18:00:00.000Z') });
        return existing;
      }

      const created: DailyReport = {
        id: `report-${this.nextId++}`,
        updatedAt: new Date('2026-06-08T18:00:00.000Z'),
        ...create,
      } as DailyReport;
      this.reports.push(created);
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

function makeDto(overrides: Partial<SubmitDailyReportDto> = {}): SubmitDailyReportDto {
  return {
    workDate: '2026-06-08',
    completed: 'Shipped the auth module',
    blockers: 'None',
    tomorrowPlan: 'Start on idle records',
    needHelp: '',
    ...overrides,
  };
}

describe('DailyReportsService (#26)', () => {
  let prisma: FakePrisma;
  let service: DailyReportsService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new DailyReportsService(prisma as unknown as PrismaService);
  });

  it('creates a new report on first submission for the day', async () => {
    await service.submit(USER, makeDto());

    expect(prisma.reports).toHaveLength(1);
    expect(prisma.reports[0]).toMatchObject({
      userId: 'user-1',
      workDate: '2026-06-08',
      completed: 'Shipped the auth module',
      blockers: 'None',
      tomorrowPlan: 'Start on idle records',
      needHelp: '',
    });
  });

  it('upserts in place on resubmission for the same (userId, workDate) instead of creating a duplicate', async () => {
    await service.submit(USER, makeDto({ completed: 'First draft' }));
    const firstId = prisma.reports[0].id;

    await service.submit(USER, makeDto({ completed: 'Final version', blockers: 'Waiting on review' }));

    expect(prisma.reports).toHaveLength(1);
    expect(prisma.reports[0].id).toBe(firstId);
    expect(prisma.reports[0].completed).toBe('Final version');
    expect(prisma.reports[0].blockers).toBe('Waiting on review');
  });

  it('keeps separate reports per day for the same user', async () => {
    await service.submit(USER, makeDto({ workDate: '2026-06-08' }));
    await service.submit(USER, makeDto({ workDate: '2026-06-09' }));

    expect(prisma.reports).toHaveLength(2);
    expect(new Set(prisma.reports.map((r) => r.id)).size).toBe(2);
  });

  it('keeps separate reports per user for the same day', async () => {
    await service.submit(USER, makeDto({ workDate: '2026-06-08' }));
    await service.submit(OTHER_USER, makeDto({ workDate: '2026-06-08' }));

    expect(prisma.reports).toHaveLength(2);
    expect(new Set(prisma.reports.map((r) => r.userId))).toEqual(new Set(['user-1', 'user-2']));
  });

  it('stores blank fields verbatim as empty strings rather than coercing them to null', async () => {
    await service.submit(USER, makeDto({ blockers: '', needHelp: '' }));

    expect(prisma.reports[0].blockers).toBe('');
    expect(prisma.reports[0].needHelp).toBe('');
    // Distinct from "no report submitted" - which simply has no row at all,
    // not a row full of nulls.
    expect(prisma.reports[0].blockers).not.toBeNull();
  });
});
