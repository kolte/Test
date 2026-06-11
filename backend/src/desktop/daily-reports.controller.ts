import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubmitDailyReportDto } from './dto/daily-report.dto';
import { DailyReportsService } from './daily-reports.service';

/**
 * POST /desktop/daily-reports (guarded — a DailyReport always belongs to
 * the authenticated user; no userId is accepted from the client). Returns
 * 204 No Content; the client only checks whether the call throws.
 */
@Controller('desktop/daily-reports')
@UseGuards(JwtAuthGuard)
export class DailyReportsController {
  constructor(private readonly dailyReportsService: DailyReportsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async submit(@CurrentUser() user: User, @Body() dto: SubmitDailyReportDto): Promise<void> {
    await this.dailyReportsService.submit(user, dto);
  }
}
