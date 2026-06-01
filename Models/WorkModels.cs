namespace RemoteWork.Desktop.Models;

public enum WorkClientState
{
    SignedOut,
    IdleReady,
    WorkingActive,
    IdleDetected,
    AutoPaused,
    ManualPaused,
    ResumeConfirm,
    OffWork
}

public sealed record AuthUser(string Id, string OrganizationId, string Email, string Name, string[] Roles);

public sealed record LoginResponse(string AccessToken, string RefreshToken, AuthUser User);

public sealed record DeviceRegistration(string Id, string DeviceName, string Platform, string AppVersion);

public sealed record WorkSession(
    string Id,
    string UserId,
    string? ProjectId,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt,
    string Status);

public sealed record DesktopRules(WorkRule Work, IdleRule Idle, IdleReason[] IdleReasons);

public sealed record WorkRule(int TargetMinutesPerDay, bool OvertimePromptEnabled);

public sealed record IdleRule(
    int IdleThresholdSeconds,
    int PopupTimeoutSeconds,
    bool AutoPauseEnabled,
    bool ReasonRequired);

public sealed record IdleReason(string Code, string Label);

public sealed record OfflineWorkEvent(
    long LocalId,
    string ClientEventId,
    string EventType,
    DateTimeOffset OccurredAt,
    string? SessionId,
    string PayloadJson,
    bool Synced);

