import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SubmitDailyReportDto } from './dto/daily-report.dto';

/**
 * Implements POST /desktop/daily-reports.
 *
 * Reports are upserted on (userId, workDate) so the form can be submitted
 * multiple times during the day — each submission replaces the previous
 * report rather than accumulating duplicate rows.
 */
@Injectable()
export class DailyReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: User, dto: SubmitDailyReportDto): Promise<void> {
    // Text fields are stored verbatim. An empty string (submitted but blank)
    // and a missing report (no row) are meaningfully distinct states, so no
    // empty-string → null normalization is applied. The nullable schema
    // columns exist so a joined row without a report reads as nulls, not to
    // coerce submitted-but-blank content.
    const fields = {
      completed: dto.completed,
      blockers: dto.blockers,
      tomorrowPlan: dto.tomorrowPlan,
      needHelp: dto.needHelp,
    };

    await this.prisma.dailyReport.upsert({
      where: { userId_workDate: { userId: user.id, workDate: dto.workDate } },
      update: fields,
      create: { userId: user.id, workDate: dto.workDate, ...fields },
    });
  }
}
