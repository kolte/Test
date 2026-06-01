using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using RemoteWork.Desktop.Models;

namespace RemoteWork.Desktop.Services;

public sealed class ApiClient
{
    private readonly HttpClient _http;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    public ApiClient(string baseUrl)
    {
        _http = new HttpClient { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };
    }

    public string? AccessToken { get; set; }

    public async Task<LoginResponse> LoginAsync(string email, string password, CancellationToken cancellationToken)
    {
        var response = await _http.PostAsJsonAsync("auth/login", new { email, password }, cancellationToken);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LoginResponse>(_jsonOptions, cancellationToken))!;
    }

    public async Task<DeviceRegistration> RegisterDeviceAsync(string deviceName, string appVersion, CancellationToken cancellationToken)
    {
        var response = await SendAsync(HttpMethod.Post, "desktop/devices/register", new
        {
            deviceName,
            platform = "windows",
            appVersion
        }, cancellationToken);
        return (await response.Content.ReadFromJsonAsync<DeviceRegistration>(_jsonOptions, cancellationToken))!;
    }

    public async Task<DesktopRules> GetRulesAsync(CancellationToken cancellationToken)
    {
        var response = await SendAsync(HttpMethod.Get, "desktop/rules", null, cancellationToken);
        return (await response.Content.ReadFromJsonAsync<DesktopRules>(_jsonOptions, cancellationToken))!;
    }

    public async Task<WorkSession> StartWorkAsync(string? projectId, string deviceId, CancellationToken cancellationToken)
    {
        var response = await SendAsync(HttpMethod.Post, "desktop/work/start", new
        {
            projectId,
            deviceId,
            occurredAt = DateTimeOffset.UtcNow
        }, cancellationToken);
        return (await response.Content.ReadFromJsonAsync<WorkSession>(_jsonOptions, cancellationToken))!;
    }

    public Task PauseWorkAsync(string? sessionId, string deviceId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, "desktop/work/pause", new { sessionId, deviceId, occurredAt = DateTimeOffset.UtcNow }, cancellationToken);

    public Task ResumeWorkAsync(string? sessionId, string deviceId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, "desktop/work/resume", new { sessionId, deviceId, occurredAt = DateTimeOffset.UtcNow }, cancellationToken);

    public Task StopWorkAsync(string? sessionId, string deviceId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, "desktop/work/stop", new { sessionId, deviceId, occurredAt = DateTimeOffset.UtcNow }, cancellationToken);

    public Task SubmitIdleRecordAsync(
        string? sessionId,
        DateTimeOffset idleStartedAt,
        DateTimeOffset idleEndedAt,
        string reasonCode,
        string? reasonText,
        CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, "desktop/idle-records", new
        {
            sessionId,
            idleStartedAt,
            idleEndedAt,
            reasonCode,
            reasonText,
            autoPaused = true
        }, cancellationToken);

    public Task SubmitDailyReportAsync(
        string workDate,
        string completed,
        string blockers,
        string tomorrowPlan,
        string needHelp,
        CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, "desktop/daily-reports", new
        {
            workDate,
            completed,
            blockers,
            tomorrowPlan,
            needHelp
        }, cancellationToken);

    public Task SyncEventsAsync(string deviceId, string batchId, IEnumerable<OfflineWorkEvent> events, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, "desktop/events/sync", new
        {
            deviceId,
            batchId,
            events = events.Select(item => new
            {
                item.SessionId,
                item.EventType,
                item.OccurredAt,
                item.ClientEventId,
                payload = JsonSerializer.Deserialize<JsonElement>(item.PayloadJson)
            })
        }, cancellationToken);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, path);
        if (!string.IsNullOrWhiteSpace(AccessToken))
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", AccessToken);
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        var response = await _http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return response;
    }
}

