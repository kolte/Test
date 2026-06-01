# RemoteWork Desktop — Windows Client

WPF desktop client for work tracking with idle detection and offline event caching.

## Required Tools

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 18+](https://nodejs.org/) (for the mock server)

## Run Instructions

### 1. Start the mock API server

```powershell
cd mock-server
node server.js
```

Leave this terminal open. You should see:

```
Mock API server running at http://localhost:3000
```

> The mock server sets `idleThresholdSeconds` to 30 seconds so idle detection is easy to trigger during a demo. The popup countdown is 15 seconds.

### 2. Build and run the WPF client

Open a second terminal in the `desktop-windows` folder:

```powershell
dotnet restore
dotnet build
dotnet run
```

### 3. Demo flow

1. Leave API Base URL as `http://localhost:3000`
2. Enter any email and password, click **Login**
3. Click **Start Work** — state moves to `WorkingActive`
4. Stop all mouse and keyboard input for 30 seconds
5. Idle popup appears with a countdown — choose **Still Working**, **Auto Pause**, or let it expire
6. After auto-pause, move the mouse — resume prompt appears, select an idle reason, click **Resume Work**
7. Click **Stop Work** to end the session
8. To test offline caching: stop the mock server, perform actions (Sync State shows `Sync pending`), restart the server — events sync automatically within 30 seconds

---

## Changed Files

| File | Change | Reason |
|---|---|---|
| `App.xaml.cs` | Base class changed to `System.Windows.Application` (fully qualified) | `UseWindowsForms` caused `Application` to be ambiguous |
| `Services/OfflineStore.cs` | Added `using System.IO;` | `Path` and `Directory` were not resolved when WinForms is in scope |
| `IdlePromptWindow.xaml.cs` | `SelectedReasonCode` reads `SelectedItem as IdleReason` instead of `SelectedValue` | `SelectedValue` returned the object reference, not the `Code` string |
| `MainWindow.xaml.cs` | Added `using` aliases for `MessageBox`, `MessageBoxButton`, `MessageBoxImage`, `WindowState`; qualified `WindowState.Normal` calls | WinForms/WPF name conflicts caused build errors |
| `MainWindow.xaml.cs` | `ShowResumePrompt` stop path calls `_state.StopWork()` directly and returns early | Previous code fell through to `_state.ResumeAfterIdle()` after stop, throwing `InvalidOperationException` |
| `MainWindow.xaml.cs` | `SubmitReport_Click` now uses `_api.SubmitDailyReportAsync()` | Raw `HttpClient` bypassed `_api`'s auth token management |
| `Services/ApiClient.cs` | Added `SubmitDailyReportAsync` method | Required to support the fixed `SubmitReport_Click` |
| `mock-server/server.js` | New file | Stubs all 9 API endpoints so the app can be demoed without a live backend |

---

## Compliance Note

This client collects only the minimum data required for work tracking:

- Work state events (start, pause, resume, stop)
- Idle/active status derived from system last input time
- Idle reason selected by the user
- Local device name, platform, and app version
- A local SQLite offline queue for unsynced events

**Idle detection uses exclusively the Windows `GetLastInputInfo` API** (`user32.dll`), which returns the time elapsed since the last mouse or keyboard input. No other monitoring is performed.

The client does **not** capture:

- Screenshots or screen recordings
- Keystrokes or keyboard contents
- Audio or microphone input
- Camera or video input
- Clipboard contents
- Browser history
- Files or document contents
