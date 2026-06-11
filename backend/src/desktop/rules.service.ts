import { Injectable } from '@nestjs/common';
import { DesktopRulesDto } from './dto/rules.dto';

/**
 * Static, organization-wide desktop policy returned by GET /desktop/rules.
 * Per-organization configuration is out of scope — there is one organization
 * in this scaffold — so these are hardcoded constants.
 *
 * Field names (especially idleReasons[].label) are load-bearing: they must
 * match the shape defined in DesktopRulesDto exactly.
 */
const RULES: DesktopRulesDto = {
  work: {
    targetMinutesPerDay: 480,
    overtimePromptEnabled: true,
  },
  idle: {
    idleThresholdSeconds: 300,
    popupTimeoutSeconds: 60,
    autoPauseEnabled: true,
    reasonRequired: true,
  },
  idleReasons: [
    { code: 'meeting', label: 'Meeting' },
    { code: 'phone', label: 'Phone' },
    { code: 'away', label: 'Away from computer' },
    { code: 'learning', label: 'Learning' },
    { code: 'other', label: 'Other' },
  ],
};

@Injectable()
export class RulesService {
  getRules(): DesktopRulesDto {
    return RULES;
  }
}
