import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StartWorkDto, WorkActionDto, WorkSessionDto } from './dto/work-action.dto';
import { WorkActionsService } from './work-actions.service';

/**
 * POST /desktop/work/{start,pause,resume,stop} — the live counterparts to
 * the offline-sync pipeline. Guarded: a WorkSession always belongs to the
 * authenticated user.
 *
 * start returns the created WorkSession (200); pause/resume/stop return
 * 204 No Content.
 */
@Controller('desktop/work')
@UseGuards(JwtAuthGuard)
export class WorkActionsController {
  constructor(private readonly workActionsService: WorkActionsService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  async start(@CurrentUser() user: User, @Body() dto: StartWorkDto): Promise<WorkSessionDto> {
    return this.workActionsService.start(user, dto);
  }

  @Post('pause')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pause(@CurrentUser() user: User, @Body() dto: WorkActionDto): Promise<void> {
    await this.workActionsService.pause(user, dto);
  }

  @Post('resume')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resume(@CurrentUser() user: User, @Body() dto: WorkActionDto): Promise<void> {
    await this.workActionsService.resume(user, dto);
  }

  @Post('stop')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stop(@CurrentUser() user: User, @Body() dto: WorkActionDto): Promise<void> {
    await this.workActionsService.stop(user, dto);
  }
}
