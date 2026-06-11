import { IsString, Matches } from 'class-validator';

const WORK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Request shape for POST /desktop/daily-reports:
 * `{ workDate, completed, blockers, tomorrowPlan, needHelp }`.
 * workDate is a local date in yyyy-MM-dd form. The four text fields are
 * always plain strings (possibly empty, never null). See DailyReportsService
 * for how empty submissions are handled.
 */
export class SubmitDailyReportDto {
  @IsString()
  @Matches(WORK_DATE_PATTERN, { message: 'workDate must be in yyyy-MM-dd form.' })
  workDate!: string;

  @IsString()
  completed!: string;

  @IsString()
  blockers!: string;

  @IsString()
  tomorrowPlan!: string;

  @IsString()
  needHelp!: string;
}
