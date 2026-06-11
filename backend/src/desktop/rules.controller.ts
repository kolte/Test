import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DesktopRulesDto } from './dto/rules.dto';
import { RulesService } from './rules.service';

/**
 * GET /desktop/rules — returns the org-wide work/idle policy the desktop
 * client applies locally (target hours, idle thresholds, idle-reason picker
 * contents). Guarded: an unauthenticated caller should not be able to probe
 * the org's policy.
 */
@Controller('desktop/rules')
@UseGuards(JwtAuthGuard)
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getRules(): DesktopRulesDto {
    return this.rulesService.getRules();
  }
}
