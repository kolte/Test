using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using RemoteWork.Desktop.Models;
using RemoteWork.Desktop.Services;
using Forms = System.Windows.Forms;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;
using WindowState = System.Windows.WindowState;

namespace RemoteWork.Desktop;

public partial class MainWindow : Window
{
    private readonly WorkStateMachine _state = new();
    private readonly ActivityMonitor _activityMonitor = new();
    private readonly OfflineStore _offlineStore = new();
    private readonly DispatcherTimer _activityTimer = new();
    private readonly DispatcherTimer _syncTimer = new();
    private ApiClient _api = new("http://localhost:3000");
    private SyncService? _syncService;
    private Forms.NotifyIcon? _trayIcon;
    private DesktopRules _rules = new(new WorkRule(600, true), new IdleRule(300, 60, true, true), []);
    private string? _deviceId;
    private string? _sessionId;
    private DateTimeOffset? _idleStartedAt;
    private bool _promptOpen;

    public MainWindow()
    {
        InitializeComponent();
        _state.StateChanged += (_, next) => RenderState(next);
        _activityTimer.Interval = TimeSpan.FromSeconds(5);
        _activityTimer.Tick += ActivityTimer_Tick;
        _syncTimer.Interval = TimeSpan.FromSeconds(30);
        _syncTimer.Tick += SyncTimer_Tick;
    }

    protected override async void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);
        await _offlineStore.InitializeAsync();
        _syncService = new SyncService(_api, _offlineStore);
        CreateTrayIcon();
        RenderState(_state.State);
    }

    protected override void OnClosed(EventArgs e)
    {
        _trayIcon?.Dispose();
        base.OnClosed(e);
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _api = new ApiClient(ApiBaseTextBox.Text);
            _syncService = new SyncService(_api, _offlineStore);
            var login = await _api.LoginAsync(EmailTextBox.Text, PasswordBox.Password, CancellationToken.None);
            _api.AccessToken = login.AccessToken;
            var device = await _api.RegisterDeviceAsync(Environment.MachineName, "0.1.0", CancellationToken.None);
            _deviceId = device.Id;
            _rules = await _api.GetRulesAsync(CancellationToken.None);
            _state.MarkSignedIn();
            LoginPanel.Visibility = Visibility.Collapsed;
            WorkPanel.Visibility = Visibility.Visible;
            ReportPanel.Visibility = Visibility.Visible;
            _activityTimer.Start();
            _syncTimer.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Login failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void Start_Click(object sender, RoutedEventArgs e)
    {
        _state.StartWork();
        try
        {
            var session = await _api.StartWorkAsync(null, _deviceId!, CancellationToken.None);
            _sessionId = session.Id;
            SyncValueText.Text = "Synced";
        }
        catch
        {
            await _offlineStore.AddEventAsync("work_started", _sessionId);
            SyncValueText.Text = "Sync pending";
        }
    }

    private async void Pause_Click(object sender, RoutedEventArgs e)
    {
        _state.PauseManually();
        await TryRemoteOrCache("manual_paused", () => _api.PauseWorkAsync(_sessionId, _deviceId!, CancellationToken.None));
    }

    private async void Resume_Click(object sender, RoutedEventArgs e)
    {
        if (_state.State == WorkClientState.ManualPaused)
        {
            _state.ResumeFromManualPause();
        }
        else if (_state.State == WorkClientState.ResumeConfirm)
        {
            _state.ResumeAfterIdle();
        }

        await TryRemoteOrCache("work_resumed", () => _api.ResumeWorkAsync(_sessionId, _deviceId!, CancellationToken.None));
    }

    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        _state.StopWork();
        await TryRemoteOrCache("work_stopped", () => _api.StopWorkAsync(_sessionId, _deviceId!, CancellationToken.None));
        _sessionId = null;
    }

    private async void SubmitReport_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await _api.SubmitDailyReportAsync(
                DateTimeOffset.Now.ToString("yyyy-MM-dd"),
                CompletedTextBox.Text,
                BlockersTextBox.Text,
                TomorrowTextBox.Text,
                NeedHelpTextBox.Text,
                CancellationToken.None);
            MessageBox.Show(this, "Daily report submitted.", "Done", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Submit failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void ActivityTimer_Tick(object? sender, EventArgs e)
    {
        if (_promptOpen) return;

        var idleDuration = _activityMonitor.GetIdleDuration();
        if (_state.State == WorkClientState.WorkingActive && idleDuration.TotalSeconds >= _rules.Idle.IdleThresholdSeconds)
        {
            _idleStartedAt = DateTimeOffset.UtcNow - idleDuration;
            _state.DetectIdle();
            await ShowIdleDetectedPrompt();
        }
        else if (_state.State == WorkClientState.AutoPaused && idleDuration.TotalSeconds < 3)
        {
            _state.RequireResumeConfirmation();
            await ShowResumePrompt();
        }
    }

    private async Task ShowIdleDetectedPrompt()
    {
        _promptOpen = true;
        var prompt = new IdlePromptWindow(IdlePromptMode.ConfirmStillWorking, _rules.Idle.PopupTimeoutSeconds, _rules.IdleReasons)
        {
            Owner = this
        };
        prompt.ShowDialog();
        _promptOpen = false;

        if (prompt.Result == IdlePromptResult.StillWorking)
        {
            _state.ConfirmStillWorking();
            return;
        }

        _state.AutoPause();
        await _offlineStore.AddEventAsync("auto_paused", _sessionId);
        SyncValueText.Text = "Sync pending";
    }

    private async Task ShowResumePrompt()
    {
        _promptOpen = true;
        var prompt = new IdlePromptWindow(IdlePromptMode.ResumeAfterIdle, 0, _rules.IdleReasons)
        {
            Owner = this
        };
        prompt.ShowDialog();
        _promptOpen = false;

        if (prompt.Result == IdlePromptResult.StopWork)
        {
            _state.StopWork();
            await TryRemoteOrCache("work_stopped", () => _api.StopWorkAsync(_sessionId, _deviceId!, CancellationToken.None));
            _sessionId = null;
            _idleStartedAt = null;
            return;
        }

        var endedAt = DateTimeOffset.UtcNow;
        var startedAt = _idleStartedAt ?? endedAt;
        var reason = prompt.SelectedReasonCode ?? "other";
        try
        {
            await _api.SubmitIdleRecordAsync(_sessionId, startedAt, endedAt, reason, prompt.ReasonText, CancellationToken.None);
            await _api.ResumeWorkAsync(_sessionId, _deviceId!, CancellationToken.None);
            SyncValueText.Text = "Synced";
        }
        catch
        {
            await _offlineStore.AddEventAsync("idle_resolved", _sessionId, JsonSerializer.Serialize(new { reasonCode = reason }));
            await _offlineStore.AddEventAsync("work_resumed", _sessionId);
            SyncValueText.Text = "Sync pending";
        }

        _state.ResumeAfterIdle();
        _idleStartedAt = null;
    }

    private async void SyncTimer_Tick(object? sender, EventArgs e)
    {
        if (_syncService is null) return;
        try
        {
            var count = await _syncService.SyncPendingAsync(_deviceId, CancellationToken.None);
            SyncValueText.Text = count > 0 ? $"Synced {count}" : "Synced";
        }
        catch
        {
            SyncValueText.Text = "Sync pending";
        }
    }

    private async Task TryRemoteOrCache(string eventType, Func<Task> remote)
    {
        try
        {
            await remote();
            SyncValueText.Text = "Synced";
        }
        catch
        {
            await _offlineStore.AddEventAsync(eventType, _sessionId);
            SyncValueText.Text = "Sync pending";
        }
    }

    private void RenderState(WorkClientState state)
    {
        StatusText.Text = state.ToString();
        StateValueText.Text = state.ToString();
        if (_trayIcon is not null)
        {
            _trayIcon.Text = $"Timekeeper - {state}";
        }

        StartButton.IsEnabled = state is WorkClientState.IdleReady or WorkClientState.OffWork;
        PauseButton.IsEnabled = state == WorkClientState.WorkingActive;
        ResumeButton.IsEnabled = state is WorkClientState.ManualPaused or WorkClientState.ResumeConfirm;
        StopButton.IsEnabled = state is WorkClientState.WorkingActive or WorkClientState.ManualPaused or WorkClientState.AutoPaused or WorkClientState.ResumeConfirm;
    }

    private void CreateTrayIcon()
    {
        _trayIcon = new Forms.NotifyIcon
        {
            Text = "Timekeeper",
            Visible = true,
            Icon = System.Drawing.SystemIcons.Application,
            ContextMenuStrip = new Forms.ContextMenuStrip()
        };
        _trayIcon.ContextMenuStrip.Items.Add("Open", null, (_, _) =>
        {
            Show();
            WindowState = System.Windows.WindowState.Normal;
            Activate();
        });
        _trayIcon.ContextMenuStrip.Items.Add("Exit", null, (_, _) => Close());
        _trayIcon.DoubleClick += (_, _) =>
        {
            Show();
            WindowState = System.Windows.WindowState.Normal;
            Activate();
        };
    }
}
