using System.IO;
using Microsoft.Data.Sqlite;
using RemoteWork.Desktop.Models;

namespace RemoteWork.Desktop.Services;

public sealed class OfflineStore
{
    private readonly string _dbPath;

    public OfflineStore()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RemoteWorkTimekeeper");
        Directory.CreateDirectory(dir);
        _dbPath = Path.Combine(dir, "offline-cache.db");
    }

    public async Task InitializeAsync()
    {
        await using var connection = Open();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS offline_events (
              local_id INTEGER PRIMARY KEY AUTOINCREMENT,
              client_event_id TEXT NOT NULL UNIQUE,
              event_type TEXT NOT NULL,
              occurred_at TEXT NOT NULL,
              session_id TEXT,
              payload_json TEXT NOT NULL DEFAULT '{}',
              synced INTEGER NOT NULL DEFAULT 0
            );
            """;
        await command.ExecuteNonQueryAsync();
    }

    public async Task AddEventAsync(string eventType, string? sessionId, string payloadJson = "{}")
    {
        await using var connection = Open();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT OR IGNORE INTO offline_events
              (client_event_id, event_type, occurred_at, session_id, payload_json, synced)
            VALUES
              ($client_event_id, $event_type, $occurred_at, $session_id, $payload_json, 0);
            """;
        command.Parameters.AddWithValue("$client_event_id", Guid.NewGuid().ToString("N"));
        command.Parameters.AddWithValue("$event_type", eventType);
        command.Parameters.AddWithValue("$occurred_at", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$session_id", (object?)sessionId ?? DBNull.Value);
        command.Parameters.AddWithValue("$payload_json", payloadJson);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<IReadOnlyList<OfflineWorkEvent>> GetPendingAsync(int limit = 200)
    {
        var result = new List<OfflineWorkEvent>();
        await using var connection = Open();
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT local_id, client_event_id, event_type, occurred_at, session_id, payload_json, synced
            FROM offline_events
            WHERE synced = 0
            ORDER BY local_id
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", limit);

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new OfflineWorkEvent(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                DateTimeOffset.Parse(reader.GetString(3)),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetString(5),
                reader.GetInt32(6) == 1));
        }

        return result;
    }

    public async Task MarkSyncedAsync(IEnumerable<long> ids)
    {
        var idList = ids.ToArray();
        if (idList.Length == 0) return;

        await using var connection = Open();
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        foreach (var id in idList)
        {
            var command = connection.CreateCommand();
            command.Transaction = (SqliteTransaction)transaction;
            command.CommandText = "UPDATE offline_events SET synced = 1 WHERE local_id = $id;";
            command.Parameters.AddWithValue("$id", id);
            await command.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
    }

    private SqliteConnection Open() => new($"Data Source={_dbPath}");
}

