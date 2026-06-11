/**
 * Response shape for GET /desktop/rules — must match the client's
 * DesktopRules model exactly, serialized as camelCase:
 *
 *   DesktopRules(WorkRule Work, IdleRule Idle, IdleReason[] IdleReasons)
 *   WorkRule(int TargetMinutesPerDay, bool OvertimePromptEnabled)
 *   IdleRule(int IdleThresholdSeconds, int PopupTimeoutSeconds,
 *            bool AutoPauseEnabled, bool ReasonRequired)
 *   IdleReason(string Code, string Label)
 *
 * The field name on IdleReason must be `label` — not `name`, `text`, or
 * `description`. The client's idle-reason picker binds with
 * DisplayMemberPath="Label" / SelectedValuePath="Code", so any other name
 * silently deserializes to null and breaks the picker without a visible error.
 */
export class IdleReasonDto {
  code!: string;
  label!: string;
}

export class WorkRuleDto {
  targetMinutesPerDay!: number;
  overtimePromptEnabled!: boolean;
}

export class IdleRuleDto {
  idleThresholdSeconds!: number;
  popupTimeoutSeconds!: number;
  autoPauseEnabled!: boolean;
  reasonRequired!: boolean;
}

export class DesktopRulesDto {
  work!: WorkRuleDto;
  idle!: IdleRuleDto;
  idleReasons!: IdleReasonDto[];
}
