# RemoteWork Desktop — Windows Client

WPF desktop client for work tracking with idle detection and offline event caching.

## Required Tools

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 18+](https://nodejs.org/) (for the mock server)

## Run Instructions

### 1. Start the mock API server

Open a terminal in the `desktop-windows` folder:

```powershell
cd mock-server
node server.js
```

Leave this terminal open. You should see:

```
Mock API  http://localhost:3000
Mode      online
Idle threshold  30s  |  popup timeout  15s
```

> `idleThresholdSeconds` is set to 30 seconds so idle detection is easy to trigger during a demo. The popup countdown is 15 seconds.

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
3. Click **Start Work** — state moves to **Working**
4. Stop all mouse and keyboard input for 30 seconds
5. Idle popup appears with a countdown — choose **Still Working**, **Auto Pause**, or let it expire
6. After auto-pause, move the mouse — resume prompt appears, select an idle reason, click **Resume Work**
7. Click **Stop Work** to end the session

### 4. Testing offline caching

Toggle the mock server offline without stopping it:

```powershell
curl -X POST http://localhost:3000/mock/offline
```

Perform actions in the app — the sync panel shows **Pending** (amber) with the exact event count and a **Sync Now** button. Bring the server back:

```powershell
curl -X POST http://localhost:3000/mock/online
```

Click **Sync Now** or wait up to 30 seconds for the automatic sync timer. The panel turns green and shows the last synced time.

Alternatively, start the server in offline mode from the beginning:

```powershell
node server.js --offline
```

---

## Changed Files

| File | Change | Reason |
|---|---|---|
| `.gitignore` | New file | Excludes `bin/`, `obj/`, `*.exe`, `*.dll`, `*.pdb`, `*.db`, `*.zip` from version control |
| `App.xaml.cs` | Base class qualified as `System.Windows.Application` | `UseWindowsForms` made `Application` ambiguous |
| `Services/OfflineStore.cs` | Added `using System.IO;` and `GetPendingCountAsync()` | `Path`/`Directory` unresolved with WinForms in scope; count query needed for sync UI |
| `Services/ApiClient.cs` | Added `SubmitDailyReportAsync` | Required to support the fixed report submission |
| `IdlePromptWindow.xaml.cs` | `SelectedReasonCode` reads `SelectedItem as IdleReason` | `SelectedValue` returned the object, not the `Code` string |
| `IdlePromptWindow.xaml.cs` | Countdown text fixed ("1 second" / "N seconds") | Plural bug |
| `IdlePromptWindow.xaml.cs` | Resume validates reason is selected | Prevented submitting without a reason when reasons are required |
| `MainWindow.xaml` | Added `x:Name="LoginButton"` to login button; added sync detail panel (pending count, last synced time, Sync Now button) | Enable/disable login button during async; richer sync visibility |
| `MainWindow.xaml.cs` | Added WinForms/WPF `using` aliases; qualified `WindowState.Normal` | Build errors from ambiguous type names |
| `MainWindow.xaml.cs` | `_state.StartWork()` moved to after API call | State no longer advances before session ID is confirmed |
| `MainWindow.xaml.cs` | `_busy` flag gates all buttons during async ops | Prevents double-fire from rapid clicks |
| `MainWindow.xaml.cs` | Login validates email/password before calling API | Avoids unnecessary network call on empty fields |
| `MainWindow.xaml.cs` | Timers stopped in `OnClosed` | Timer ticks no longer fire after window is closed |
| `MainWindow.xaml.cs` | `ShowResumePrompt` stop path returns early before `ResumeAfterIdle` | Previous code threw `InvalidOperationException` after stop |
| `MainWindow.xaml.cs` | `SubmitReport_Click` uses `_api.SubmitDailyReportAsync` | Raw `HttpClient` bypassed auth token management |
| `MainWindow.xaml.cs` | `ActivityTimer_Tick` wrapped in try/catch | Unhandled exceptions previously killed the timer silently |
| `MainWindow.xaml.cs` | `_promptOpen` reset in `finally` blocks | Flag could get stuck if dialog threw, permanently disabling idle detection |
| `MainWindow.xaml.cs` | `UpdateSyncStatusAsync` drives all sync UI | Replaced scattered text assignments with a single method that queries the real DB count |
| `MainWindow.xaml.cs` | Human-readable state labels in `RenderState` | Raw enum names ("WorkingActive") replaced with readable labels ("Working") |
| `mock-server/server.js` | Timestamps, detailed logs, query string stripping, runtime offline toggle, `--offline` flag | Easier to follow demo flow; offline testing without restarting the server |

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
