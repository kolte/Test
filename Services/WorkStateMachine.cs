using RemoteWork.Desktop.Models;

namespace RemoteWork.Desktop.Services;

public sealed class WorkStateMachine
{
    public WorkClientState State { get; private set; } = WorkClientState.SignedOut;

    public event EventHandler<WorkClientState>? StateChanged;

    public void MarkSignedIn() => Move(WorkClientState.IdleReady);
    public void MarkSignedOut() => Move(WorkClientState.SignedOut);
    public void StartWork()
    {
        if (State is WorkClientState.IdleReady or WorkClientState.OffWork)
        {
            Move(WorkClientState.WorkingActive);
            return;
        }

        throw new InvalidOperationException($"Cannot start work from {State}.");
    }
    public void PauseManually() => RequireThenMove(WorkClientState.WorkingActive, WorkClientState.ManualPaused);
    public void ResumeFromManualPause() => RequireThenMove(WorkClientState.ManualPaused, WorkClientState.WorkingActive);
    public void DetectIdle() => RequireThenMove(WorkClientState.WorkingActive, WorkClientState.IdleDetected);
    public void ConfirmStillWorking() => RequireThenMove(WorkClientState.IdleDetected, WorkClientState.WorkingActive);
    public void AutoPause() => RequireThenMove(WorkClientState.IdleDetected, WorkClientState.AutoPaused);
    public void RequireResumeConfirmation() => RequireThenMove(WorkClientState.AutoPaused, WorkClientState.ResumeConfirm);
    public void ResumeAfterIdle() => RequireThenMove(WorkClientState.ResumeConfirm, WorkClientState.WorkingActive);

    public void StopWork()
    {
        if (State is WorkClientState.WorkingActive or WorkClientState.ManualPaused or WorkClientState.ResumeConfirm or WorkClientState.AutoPaused)
        {
            Move(WorkClientState.OffWork);
            return;
        }

        throw new InvalidOperationException($"Cannot stop work from {State}.");
    }

    private void RequireThenMove(WorkClientState required, WorkClientState next)
    {
        if (State != required)
        {
            throw new InvalidOperationException($"Cannot move from {State} to {next}.");
        }

        Move(next);
    }

    private void Move(WorkClientState next)
    {
        State = next;
        StateChanged?.Invoke(this, State);
    }
}
