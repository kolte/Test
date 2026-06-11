import { Body, Controller, Post } from '@nestjs/common';
import { SyncBatchDto, SyncResponseDto } from './dto/sync-event.dto';
import { SyncService } from './sync.service';

@Controller('desktop/events')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('sync')
  async sync(@Body() batch: SyncBatchDto): Promise<SyncResponseDto> {
    return this.syncService.processBatch(batch);
  }
}
