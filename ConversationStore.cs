using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.IO;

namespace LightSession.Desktop;

public sealed class ConversationStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static string AppDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Mica"
    );

    public static string ConversationsDirectory { get; } = Path.Combine(AppDataDirectory, "conversations");

    public ConversationStore() => Directory.CreateDirectory(ConversationsDirectory);

    public async Task<ConversationRecord> UpsertAsync(ConversationRecord incoming)
    {
        Validate(incoming);
        var path = PathFor(incoming.Id);
        var previous = await ReadAsync(path);
        var byId = (previous?.Messages ?? []).ToDictionary(message => message.Id, StringComparer.Ordinal);
        var order = (previous?.Messages ?? []).Select((message, index) => (message.Id, index))
            .ToDictionary(item => item.Id, item => item.index, StringComparer.Ordinal);
        var nextOrder = order.Count;
        foreach (var message in incoming.Messages)
        {
            byId[message.Id] = message;
            if (!order.ContainsKey(message.Id)) order[message.Id] = nextOrder++;
        }

        incoming.Messages = byId.Values
            .OrderBy(message => message.Time ?? double.MaxValue)
            .ThenBy(message => order[message.Id])
            .ToList();
        incoming.UpdatedAt = DateTimeOffset.Now;

        var json = JsonSerializer.Serialize(incoming, JsonOptions);
        var temporary = path + ".tmp";
        await File.WriteAllTextAsync(temporary, json, new UTF8Encoding(false));
        File.Move(temporary, path, true);
        return incoming;
    }

    public async Task<IReadOnlyList<ConversationRecord>> ListAsync()
    {
        var result = new List<ConversationRecord>();
        foreach (var path in Directory.EnumerateFiles(ConversationsDirectory, "*.json"))
        {
            var conversation = await ReadAsync(path);
            if (conversation is not null) result.Add(conversation);
        }
        return result.OrderByDescending(item => item.UpdatedAt).ToList();
    }

    public Task<ConversationRecord?> GetAsync(string id) => ReadAsync(PathFor(id));

    private static async Task<ConversationRecord?> ReadAsync(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<ConversationRecord>(stream, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string PathFor(string id)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id))).ToLowerInvariant();
        return Path.Combine(ConversationsDirectory, hash + ".json");
    }

    private static void Validate(ConversationRecord conversation)
    {
        if (conversation.Id.Length is < 1 or > 300) throw new InvalidDataException("Invalid conversation id.");
        if (conversation.Messages.Count > 100_000) throw new InvalidDataException("Conversation is too large.");
        foreach (var message in conversation.Messages)
        {
            if (message.Id.Length is < 1 or > 500) throw new InvalidDataException("Invalid message id.");
            if (message.Role is not ("user" or "assistant")) throw new InvalidDataException("Invalid message role.");
            if (message.Text.Length > 8_000_000) throw new InvalidDataException("Message is too large.");
        }
    }
}
