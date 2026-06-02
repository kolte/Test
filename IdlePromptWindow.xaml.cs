using System.Windows;
using System.Windows.Threading;
using RemoteWork.Desktop.Models;

namespace RemoteWork.Desktop;

public enum IdlePromptMode
{
    ConfirmStillWorking,
    ResumeAfterIdle
}

public enum IdlePromptResult
{
    StillWorking,
    AutoPause,
    ResumeWork,
    StopWork
}

public partial class IdlePromptWindow : Window
{
    private readonly DispatcherTimer _timer = new();
    private int _remainingSeconds;

    public IdlePromptWindow(IdlePromptMode mode, int timeoutSeconds, IdleReason[] reasons)
    {
        InitializeComponent();
        ReasonComboBox.ItemsSource = reasons;
        ReasonComboBox.SelectedIndex = reasons.Length > 0 ? 0 : -1;

        if (mode == IdlePromptMode.ConfirmStillWorking)
        {
            Result = IdlePromptResult.AutoPause;
            _remainingSeconds = timeoutSeconds;
            TitleText.Text = "No mouse or keyboard activity was detected.";
            CountdownText.Text = $"Timer will auto pause in {_remainingSeconds} seconds.";
            _timer.Interval = TimeSpan.FromSeconds(1);
            _timer.Tick += Timer_Tick;
            _timer.Start();
        }
        else
        {
            Result = IdlePromptResult.ResumeWork;
            TitleText.Text = "Welcome back.";
            CountdownText.Text = "Please select an idle reason before continuing.";
            ReasonPanel.Visibility = Visibility.Visible;
            ConfirmButtons.Visibility = Visibility.Collapsed;
            ResumeButtons.Visibility = Visibility.Visible;
        }
    }

    public IdlePromptResult Result { get; private set; }

    public string? SelectedReasonCode => (ReasonComboBox.SelectedItem as IdleReason)?.Code;

    public string? ReasonText => string.IsNullOrWhiteSpace(ReasonTextBox.Text) ? null : ReasonTextBox.Text.Trim();

    private void Timer_Tick(object? sender, EventArgs e)
    {
        _remainingSeconds--;
        var label = _remainingSeconds == 1 ? "second" : "seconds";
        CountdownText.Text = _remainingSeconds > 0
            ? $"Auto pausing in {_remainingSeconds} {label}."
            : "Auto pausing now.";
        if (_remainingSeconds <= 0)
        {
            _timer.Stop();
            Result = IdlePromptResult.AutoPause;
            Close();
        }
    }

    private void StillWorking_Click(object sender, RoutedEventArgs e)
    {
        _timer.Stop();
        Result = IdlePromptResult.StillWorking;
        Close();
    }

    private void AutoPause_Click(object sender, RoutedEventArgs e)
    {
        _timer.Stop();
        Result = IdlePromptResult.AutoPause;
        Close();
    }

    private void Resume_Click(object sender, RoutedEventArgs e)
    {
        if (ReasonPanel.Visibility == Visibility.Visible && ReasonComboBox.SelectedItem is null)
        {
            System.Windows.MessageBox.Show(
                this,
                "Please select an idle reason before resuming.",
                "Reason required",
                System.Windows.MessageBoxButton.OK,
                System.Windows.MessageBoxImage.Warning);
            return;
        }

        Result = IdlePromptResult.ResumeWork;
        Close();
    }

    private void Stop_Click(object sender, RoutedEventArgs e)
    {
        Result = IdlePromptResult.StopWork;
        Close();
    }
}
