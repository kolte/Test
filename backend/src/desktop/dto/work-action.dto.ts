import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * The live work-action endpoints accept clientSessionId as well as sessionId
 * for the same reason the offline-sync pipeline does: the client generates
 * a session id locally before it knows whether the server is reachable, so
 * any action sent before the server has confirmed a real id can only address
 * the session by its client-generated id. sessionId is preferred when
 * present — see WorkActionsService.resolveSession.
 */
export class StartWorkDto {
  @IsUUID()
  deviceId!: string;

  /**
   * Optional project association. Currently unused (no project picker exists),
   * but accepted and echoed back in the response to keep the client model
   * consistent.
   */
  @IsOptional()
  @IsString()
  projectId?: string | null;

  @IsOptional()
  @IsUUID()
  clientSessionId?: string;

  @IsDateString()
  occurredAt!: string;
}

/**
 * Shared shape for pause / resume / stop: all three identify an existing
 * session by sessionId and/or clientSessionId and record when the action
 * occurred. At least one session reference must be present — enforced in
 * WorkActionsService.resolveSession rather than here, since the “at least
 * one of two optional fields” rule cannot be expressed with a single
 * class-validator decorator.
 */
export class WorkActionDto {
  @IsUUID()
  deviceId!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  clientSessionId?: string;

  @IsDateString()
  occurredAt!: string;
}

/**
 * Response shape for the start action — matches the client's WorkSession
 * model: id, userId, projectId?, startedAt, endedAt?, status. Serialized
 * as camelCase over the wire.
 */
export class WorkSessionDto {
  id!: string;
  userId!: string;
  projectId!: string | null;
  startedAt!: string;
  endedAt!: string | null;
  status!: string;
}
