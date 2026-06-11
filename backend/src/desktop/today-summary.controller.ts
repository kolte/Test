import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TodaySummaryDto } from './dto/today-summary.dto';
import { TodaySummaryService } from './today-summary.service';

/**
 * GET /desktop/today-summary (guarded — the summary is always the caller's
 * own, derived from their WorkDay and DailyReport rows; no per-request input
 * is accepted).
 */
@Controller('desktop/today-summary')
@UseGuards(JwtAuthGuard)
export class TodaySummaryController {
  constructor(private readonly todaySummaryService: TodaySummaryService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getSummary(@CurrentUser() user: User): Promise<TodaySummaryDto> {
    return this.todaySummaryService.getSummary(user);
  }
}
