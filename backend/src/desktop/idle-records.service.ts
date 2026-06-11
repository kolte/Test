import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SubmitIdleRecordDto } from './dto/idle-record.dto';

/**
 * Implements POST /desktop/idle-records — the live counterpart to the
 * idle_resolved offline-sync event. When the client is online and an idle
 * prompt resolves, it submits the idle interval directly here (and then
 * calls resume) instead of queuing events for a later batch.
 *
 * Both paths produce the same result: an IdleRecord row and an idle_resolved
 * WorkEvent with the same { reasonCode } payload, so the event history and
 * the WorkDay rollup are identical regardless of whether the client was
 * online when the prompt resolved.
 */
@Injectable()
export class IdleRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: User, dto: SubmitIdleRecordDto): Promise<void> {
    const session = await this.prisma.workSession.findUnique({ where: { id: dto.sessionId } });

    // Return the same error for "not found" and "belongs to another user" —
    // same account-enumeration-resistant pattern as WorkActionsService.
    if (!session || session.userId !== user.id) {
      throw new NotFoundException({
        code: 'WORK_SESSION_NOT_FOUND',
        message: 'No matching work session was found for this account.',
      });
    }

    await this.prisma.idleRecord.create({
      data: {
        sessionId: session.id,
        startedAt: new Date(dto.idleStartedAt),
        endedAt: new Date(dto.idleEndedAt),
        reasonCode: dto.reasonCode,
        reasonText: dto.reasonText ?? null,
      },
    });

    await this.prisma.workEvent.create({
      data: {
        sessionId: session.id,
        deviceId: session.deviceId,
        type: 'idle_resolved',
        occurredAt: new Date(dto.idleEndedAt),
        payload: { reasonCode: dto.reasonCode },
        // Live path has no client-supplied idempotency key — a fresh random
        // id satisfies the (deviceId, clientEventId) unique constraint
        // without colliding with anything the offline queue produces.
        clientEventId: randomUUID(),
      },
    });
  }
}
