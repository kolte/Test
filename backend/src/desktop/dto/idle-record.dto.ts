import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Request shape for POST /desktop/idle-records:
 * `{ sessionId, idleStartedAt, idleEndedAt, reasonCode, reasonText, autoPaused }`.
 *
 * Only sessionId (not clientSessionId) is accepted here: the idle prompt
 * fires only during an active session, so the client always has a confirmed
 * server-assigned session id by the time it reaches this endpoint.
 */
export class SubmitIdleRecordDto {
  @IsUUID()
  sessionId!: string;

  @IsDateString()
  idleStartedAt!: string;

  @IsDateString()
  idleEndedAt!: string;

  @IsString()
  @MinLength(1)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  reasonText?: string | null;

  /**
   * The client always sends this as true, but IdleRecord has no matching
   * column. Whether a pause was automatic or manual is already captured by
   * the WorkEvent.type distinction (auto_paused vs. manual_paused), so
   * persisting a second copy on IdleRecord would be redundant. Accepted
   * and ignored to avoid a validation error on a field the client sends.
   */
  @IsOptional()
  @IsBoolean()
  autoPaused?: boolean;
}
