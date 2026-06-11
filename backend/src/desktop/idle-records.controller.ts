import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubmitIdleRecordDto } from './dto/idle-record.dto';
import { IdleRecordsService } from './idle-records.service';

/**
 * POST /desktop/idle-records (guarded — an IdleRecord always belongs, via
 * its WorkSession, to the authenticated user). Returns 204 No Content;
 * the client only checks whether the call throws.
 */
@Controller('desktop/idle-records')
@UseGuards(JwtAuthGuard)
export class IdleRecordsController {
  constructor(private readonly idleRecordsService: IdleRecordsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async submit(@CurrentUser() user: User, @Body() dto: SubmitIdleRecordDto): Promise<void> {
    await this.idleRecordsService.submit(user, dto);
  }
}
