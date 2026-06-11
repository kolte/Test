import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TodaySummaryDto } from './dto/today-summary.dto';

/**
 * Implements GET /desktop/today-summary by reading the WorkDay and
 * DailyReport rollups rather than recomputing from raw events.
 */
@Injectable()
export class TodaySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `now` defaults to the real clock but can be injected in tests to pin
   * "today" to a fixed instant without racing a UTC day boundary.
   *
   * "Today" is the UTC calendar day, computed as
   * `toISOString().slice(0, 10)` — the same key used by the WorkDay rollup.
   * Using the user's local date instead would risk this endpoint and the
   * rollup disagreeing about which day "today" is near midnight in any
   * timezone other than UTC.
   */
  async getSummary(user: User, now: Date = new Date()): Promise<TodaySummaryDto> {
    const workDate = now.toISOString().slice(0, 10);

    const [workDay, report] = await Promise.all([
      this.prisma.workDay.findUnique({ where: { userId_workDate: { userId: user.id, workDate } } }),
      this.prisma.dailyReport.findUnique({ where: { userId_workDate: { userId: user.id, workDate } } }),
    ]);

    return {
      workDate,
      // No WorkDay row means no activity has been recalculated yet — zeros
      // are the right default, not an error.
      workedMs: workDay?.workedMs ?? 0,
      idleMs: workDay?.idleMs ?? 0,
      sessionCount: workDay?.sessionCount ?? 0,
      reportSubmitted: report !== null,
    };
  }
}
