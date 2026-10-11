using System.Text.Json;
using System.IO;

namespace LightSession.Desktop;

public sealed record ReadingPosition(double Offset, ReaderAnchor? Anchor, DateTime UpdatedUtc);

public static class ReadingPositionStore
{
    private static string PathName => Environment.GetEnvironmentVariable("MICA_READING_POSITIONS_PATH")
        ?? Path.Combine(ConversationStore.AppDataDirectory, "reading-positions.json");
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static Dictionary<string, ReadingPosition> Load()
    {
        try
        {
            if (!File.Exists(PathName)) return new(StringComparer.Ordinal);
            return JsonSerializer.Deserialize<Dictionary<string, ReadingPosition>>(File.ReadAllText(PathName), Options)
                ?? new(StringComparer.Ordinal);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        { return new(StringComparer.Ordinal); }
    }

    public static void Save(string key, double offset, ReaderAnchor? anchor)
    {
        try
        {
            Directory.CreateDirectory(ConversationStore.AppDataDirectory);
            var values = Load(); values[key] = new(offset, anchor, DateTime.UtcNow);
            values = values.OrderByDescending(item => item.Value.UpdatedUtc).Take(200)
                .ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
            var temporary = PathName + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(temporary, JsonSerializer.Serialize(values, Options));
            File.Move(temporary, PathName, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }
}
