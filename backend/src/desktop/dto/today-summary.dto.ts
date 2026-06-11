/**
 * Response shape for GET /desktop/today-summary.
 *
 * Combines two things a "how's my day going" panel needs:
 *
 *   - workedMs / idleMs / sessionCount: read from the WorkDay rollup
 *     maintained by recalculateWorkDay per (userId, workDate).
 *   - reportSubmitted: whether today's DailyReport exists yet.
 *
 * workDate is included so the client can display which UTC calendar day the
 * numbers describe without recomputing it. See TodaySummaryService for why
 * UTC is used rather than the user's local date.
 */
export class TodaySummaryDto {
  workDate!: string;
  workedMs!: number;
  idleMs!: number;
  sessionCount!: number;
  reportSubmitted!: boolean;
}
