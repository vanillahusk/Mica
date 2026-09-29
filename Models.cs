using System.Text.Json.Serialization;

namespace LightSession.Desktop;

public sealed class MessageRecord
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("role")] public string Role { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("time")] public double? Time { get; set; }
    [JsonPropertyName("voice")] public bool Voice { get; set; }
}

public sealed class ConversationRecord
{
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "ChatGPT 对话";
    [JsonPropertyName("sourceUrl")] public string SourceUrl { get; set; } = "";
    [JsonPropertyName("updatedAt")] public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.Now;
    [JsonPropertyName("messages")] public List<MessageRecord> Messages { get; set; } = [];
}

public sealed class SyncEnvelope
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; }
    [JsonPropertyName("open")] public bool Open { get; set; }
    [JsonPropertyName("conversation")] public ConversationRecord? Conversation { get; set; }
}

public sealed record DocumentItem(string Title, string Path, bool IsConversation, string? ConversationId)
{
    public override string ToString() => Title;
}
