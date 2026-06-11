import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/**
 * Event types the desktop client can emit while offline and replay later.
 * Keep in sync with RemoteWork.Desktop.Services.OfflineStore event type strings.
 */
export const SYNC_EVENT_TYPES = [
  'work_started',
  'work_paused',
  'work_resumed',
  'work_stopped',
  'manual_paused',
  'auto_paused',
  'idle_resolved',
] as const;

export type SyncEventType = (typeof SYNC_EVENT_TYPES)[number];

export class SyncEventDto {
  /**
   * Stable id generated client-side (GUID) for this individual event.
   * Used as the idempotency key: (deviceId, clientEventId) is unique
   * server-side so replaying the same event in a later batch is recognized
   * and skipped rather than recorded twice.
   */
  @IsUUID()
  clientEventId!: string;

  @IsIn(SYNC_EVENT_TYPES)
  type!: SyncEventType;

  @IsDateString()
  occurredAt!: string;

  /**
   * Server-assigned session id, if the client already knows it
   * (e.g. the session was created while online).
   */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /**
   * Client-generated session id (GUID), set when the session was started
   * while offline and the server hasn't assigned a real sessionId yet.
   *
   * The first event of a session (work_started) is expected to carry this;
   * subsequent events may reference either sessionId (if known) or
   * clientSessionId so the server can resolve them to the same WorkSession.
   *
   * At least one of sessionId / clientSessionId must be present for
   * session-scoped events — enforced in SyncService rather than here,
   * since the requirement depends on the event type.
   */
  @IsOptional()
  @IsUUID()
  clientSessionId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class SyncBatchDto {
  @IsUUID()
  deviceId!: string;

  /**
   * Stable id generated client-side (GUID) for the whole batch submission.
   * (deviceId, batchId) is unique server-side — replaying an entire batch
   * after a dropped response is a safe no-op.
   */
  @IsUUID()
  batchId!: string;

  @ValidateNested({ each: true })
  @Type(() => SyncEventDto)
  events!: SyncEventDto[];
}

export class SyncEventErrorDto {
  @IsString()
  clientEventId!: string;

  @IsString()
  message!: string;
}

/**
 * Maps a client-generated session id to the server-assigned session id
 * created or reused while processing the batch. The desktop client uses
 * this to update its local cache so subsequent actions reference the real
 * sessionId.
 */
export class SessionMappingDto {
  @IsUUID()
  clientSessionId!: string;

  @IsUUID()
  sessionId!: string;
}

export class SyncResponseDto {
  /** Number of events newly recorded in this batch. */
  accepted!: number;

  /** Number of events that were already known (idempotent replay) and ignored. */
  skipped!: number;

  /**
   * True if this exact batchId was already processed for this device —
   * in that case `accepted`/`skipped`/`sessionMappings` reflect the
   * original processing result, not a re-count.
   */
  duplicateBatch!: boolean;

  sessionMappings!: SessionMappingDto[];

  errors!: SyncEventErrorDto[];
}
