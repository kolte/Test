using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using RemoteWork.Desktop.Models;
using RemoteWork.Desktop.Services;
using Forms = System.Windows.Forms;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;
using WindowState = System.Windows.WindowState;
using Color = System.Windows.Media.Color;

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
    private bool _busy;
    private DateTimeOffset? _lastSyncedAt;

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
        await UpdateSyncStatusAsync();
    }

    protected override void OnClosed(EventArgs e)
    {
        _activityTimer.Stop();
        _syncTimer.Stop();
        _trayIcon?.Dispose();
        base.OnClosed(e);
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        var email = EmailTextBox.Text.Trim();
        var password = PasswordBox.Password;

        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
        {
            MessageBox.Show(this, "Email and password are required.", "Login failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        SetBusy(true);
        try
        {
            _api = new ApiClient(ApiBaseTextBox.Text.Trim());
            _syncService = new SyncService(_api, _offlineStore);
            var login = await _api.LoginAsync(email, password, CancellationToken.None);
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
            SetBusy(false);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Login failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            SetBusy(false);
        }
    }

    private async void Start_Click(object sender, RoutedEventArgs e)
    {
        if (_busy || _deviceId is null) return;
        SetBusy(true);
        try
        {
            var session = await _api.StartWorkAsync(null, _deviceId, CancellationToken.None);
            _sessionId = session.Id;
            _state.StartWork();
            SyncValueText.Text = "Synced";
        }
        catch
        {
            _sessionId = null;
            _state.StartWork();
            await _offlineStore.AddEventAsync("work_started", _sessionId);
            SyncValueText.Text = "Sync pending";
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void Pause_Click(object sender, RoutedEventArgs e)
    {
        if (_busy || _deviceId is null) return;
        SetBusy(true);
        _state.PauseManually();
        await TryRemoteOrCache("manual_paused", () => _api.PauseWorkAsync(_sessionId, _deviceId, CancellationToken.None));
        SetBusy(false);
    }

    private async void Resume_Click(object sender, RoutedEventArgs e)
    {
        if (_busy || _deviceId is null) return;
        SetBusy(true);
        if (_state.State == WorkClientState.ManualPaused)
            _state.ResumeFromManualPause();
        else if (_state.State == WorkClientState.ResumeConfirm)
            _state.ResumeAfterIdle();
        await TryRemoteOrCache("work_resumed", () => _api.ResumeWorkAsync(_sessionId, _deviceId, CancellationToken.None));
        SetBusy(false);
    }

    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        if (_busy || _deviceId is null) return;
        SetBusy(true);
        _state.StopWork();
        await TryRemoteOrCache("work_stopped", () => _api.StopWorkAsync(_sessionId, _deviceId, CancellationToken.None));
        _sessionId = null;
        SetBusy(false);
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

        try
        {
            var idleDuration = _activityMonitor.GetIdleDuration();

            if (_state.State == WorkClientState.WorkingActive
                && idleDuration.TotalSeconds >= _rules.Idle.IdleThresholdSeconds)
            {
                _idleStartedAt = DateTimeOffset.UtcNow - idleDuration;
                _state.DetectIdle();
                await ShowIdleDetectedPrompt();
            }
            else if (_state.State == WorkClientState.AutoPaused
                && idleDuration.TotalSeconds < 3)
            {
                _state.RequireResumeConfirmation();
                await ShowResumePrompt();
            }
        }
        catch (Exception ex)
        {
            _promptOpen = false;
            SyncValueText.Text = $"Error: {ex.Message}";
        }
    }

    private async Task ShowIdleDetectedPrompt()
    {
        _promptOpen = true;
        IdlePromptResult result;
        try
        {
            var prompt = new IdlePromptWindow(
                IdlePromptMode.ConfirmStillWorking,
                _rules.Idle.PopupTimeoutSeconds,
                _rules.IdleReasons)
            { Owner = this };
            prompt.ShowDialog();
            result = prompt.Result;
        }
        finally
        {
            _promptOpen = false;
        }

        if (result == IdlePromptResult.StillWorking)
        {
            _state.ConfirmStillWorking();
            return;
        }

        _state.AutoPause();
        await _offlineStore.AddEventAsync("auto_paused", _sessionId);
        await UpdateSyncStatusAsync();
    }

    private async Task ShowResumePrompt()
    {
        _promptOpen = true;
        IdlePromptResult result;
        string? reasonCode;
        string? reasonText;
        try
        {
            var prompt = new IdlePromptWindow(
                IdlePromptMode.ResumeAfterIdle,
                0,
                _rules.IdleReasons)
            { Owner = this };
            prompt.ShowDialog();
            result = prompt.Result;
            reasonCode = prompt.SelectedReasonCode;
            reasonText = prompt.ReasonText;
        }
        finally
        {
            _promptOpen = false;
        }

        if (result == IdlePromptResult.StopWork)
        {
            _state.StopWork();
            await TryRemoteOrCache("work_stopped", () => _api.StopWorkAsync(_sessionId, _deviceId!, CancellationToken.None));
            _sessionId = null;
            _idleStartedAt = null;
            return;
        }

        var endedAt = DateTimeOffset.UtcNow;
        var startedAt = _idleStartedAt ?? endedAt;
        var reason = reasonCode ?? "other";
        try
        {
            await _api.SubmitIdleRecordAsync(_sessionId, startedAt, endedAt, reason, reasonText, CancellationToken.None);
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

    private async void SyncNow_Click(object sender, RoutedEventArgs e)
    {
        SyncNowButton.IsEnabled = false;
        await RunSyncAsync();
        await UpdateSyncStatusAsync();
    }

    private async void SyncTimer_Tick(object? sender, EventArgs e)
    {
        await RunSyncAsync();
        await UpdateSyncStatusAsync();
    }

    private async Task RunSyncAsync()
    {
        if (_syncService is null) return;
        try
        {
            await _syncService.SyncPendingAsync(_deviceId, CancellationToken.None);
            _lastSyncedAt = DateTimeOffset.Now;
        }
        catch
        {
            // server unavailable — pending count will reflect this
        }
    }

    private async Task TryRemoteOrCache(string eventType, Func<Task> remote)
    {
        try
        {
            await remote();
            _lastSyncedAt = DateTimeOffset.Now;
        }
        catch
        {
            await _offlineStore.AddEventAsync(eventType, _sessionId);
        }

        await UpdateSyncStatusAsync();
    }

    private async Task UpdateSyncStatusAsync()
    {
        var pending = await _offlineStore.GetPendingCountAsync();
        var label = pending == 1 ? "event" : "events";
        PendingCountText.Text = pending > 0 ? $"{pending} {label} pending" : "All events synced";

        LastSyncedText.Text = _lastSyncedAt.HasValue
            ? $"Last synced {_lastSyncedAt.Value:HH:mm:ss}"
            : "Never synced";

        if (pending > 0)
        {
            SyncValueText.Text = "Pending";
            SyncValueText.Foreground = new SolidColorBrush(Color.FromRgb(0xD9, 0x77, 0x06)); // amber
            SyncNowButton.IsEnabled = true;
        }
        else
        {
            SyncValueText.Text = "Synced";
            SyncValueText.Foreground = new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A)); // green
            SyncNowButton.IsEnabled = false;
        }
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        LoginButton.IsEnabled = !busy;
        RenderState(_state.State);
    }

    private void RenderState(WorkClientState state)
    {
        StatusText.Text = state switch
        {
            WorkClientState.SignedOut    => "Signed out",
            WorkClientState.IdleReady   => "Ready",
            WorkClientState.WorkingActive => "Working",
            WorkClientState.IdleDetected  => "Idle detected",
            WorkClientState.AutoPaused    => "Auto paused",
            WorkClientState.ManualPaused  => "Paused",
            WorkClientState.ResumeConfirm => "Resume needed",
            WorkClientState.OffWork       => "Off work",
            _                             => state.ToString()
        };
        StateValueText.Text = StatusText.Text;

        if (_trayIcon is not null)
            _trayIcon.Text = $"Timekeeper - {StatusText.Text}";

        var idle = !_busy;
        StartButton.IsEnabled  = idle && state is WorkClientState.IdleReady or WorkClientState.OffWork;
        PauseButton.IsEnabled  = idle && state == WorkClientState.WorkingActive;
        ResumeButton.IsEnabled = idle && state is WorkClientState.ManualPaused or WorkClientState.ResumeConfirm;
        StopButton.IsEnabled   = idle && state is WorkClientState.WorkingActive or WorkClientState.ManualPaused or WorkClientState.AutoPaused or WorkClientState.ResumeConfirm;
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
