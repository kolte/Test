import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { IdleRecordsController } from './idle-records.controller';
import { IdleRecordsService } from './idle-records.service';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { TodaySummaryController } from './today-summary.controller';
import { TodaySummaryService } from './today-summary.service';
import { WorkActionsController } from './work-actions.controller';
import { WorkActionsService } from './work-actions.service';

/**
 * Houses the desktop/* endpoints that aren't part of the offline-sync
 * pipeline (SyncModule): device registration, rules, live work actions,
 * idle records, daily reports, and the today-summary.
 */
@Module({
  // AuthModule exports JwtAuthGuard (and the AuthService it depends on) -
  // every controller here is guarded, since `desktop/*` always acts on
  // behalf of an authenticated user (see JwtAuthGuard's doc comment).
  imports: [AuthModule],
  controllers: [
    DevicesController,
    RulesController,
    WorkActionsController,
    IdleRecordsController,
    DailyReportsController,
    TodaySummaryController,
  ],
  providers: [
    DevicesService,
    RulesService,
    WorkActionsService,
    IdleRecordsService,
    DailyReportsService,
    TodaySummaryService,
    PrismaService,
  ],
})
export class DesktopModule {}
