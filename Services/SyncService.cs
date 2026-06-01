using RemoteWork.Desktop.Models;

namespace RemoteWork.Desktop.Services;

public sealed class SyncService
{
    private readonly ApiClient _api;
    private readonly OfflineStore _store;

    public SyncService(ApiClient api, OfflineStore store)
    {
        _api = api;
        _store = store;
    }

    public async Task<int> SyncPendingAsync(string? deviceId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return 0;

        IReadOnlyList<OfflineWorkEvent> pending = await _store.GetPendingAsync();
        if (pending.Count == 0) return 0;

        await _api.SyncEventsAsync(deviceId, Guid.NewGuid().ToString("N"), pending, cancellationToken);
        await _store.MarkSyncedAsync(pending.Select(item => item.LocalId));
        return pending.Count;
    }
}

