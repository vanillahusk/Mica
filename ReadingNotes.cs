using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LightSession.Desktop;

public sealed record NoteAnchor(string Quote = "", string Prefix = "", string Suffix = "", int Start = 0);
public sealed record ReadingNote(string Id, string Document, NoteAnchor Anchor, string Text, string[] Tags,
    DateTimeOffset Created, DateTimeOffset Updated, int Revision = 0, bool Deleted = false)
{
    [JsonIgnore] public string Summary => (Anchor.Quote.Length > 0 ? Anchor.Quote : Text.Length > 0 ? Text : "全文笔记").Replace('\n', ' ');
    [JsonIgnore] public string TagLabel => string.Join("  ", Tags.Select(tag => "#" + tag));
    [JsonIgnore] public string BodyPreview => Anchor.Quote.Length > 0 ? Text : "";
    [JsonIgnore] public string KindLabel => Revision == 0 ? "草稿" : Anchor.Quote.Length == 0 ? "全文笔记" : Text.Length > 0 ? "摘录 · 想法" : "高亮摘录";
    [JsonIgnore] public string DateLabel => Updated.ToLocalTime().ToString("MM.dd  HH:mm");
}

public sealed class ReadingNoteStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public static string DirectoryPath => Environment.GetEnvironmentVariable("MICA_NOTES_DIRECTORY")
        ?? Path.Combine(ConversationStore.AppDataDirectory, "notes");
    public static string DocumentKey(string? file, string? conversation) => file is not null
        ? "file:" + Path.GetFullPath(file).ToUpperInvariant() : "conversation:" + conversation;
    private static string Folder(string document) => Path.Combine(DirectoryPath,
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(document))));
    public static string[] ParseTags(string value) => value.Split([' ', '\t', '\r', '\n', ',', '，', ';', '；'], StringSplitOptions.RemoveEmptyEntries)
        .Select(tag => tag.TrimStart('#')).Where(tag => tag.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(20).Select(tag => tag[..Math.Min(tag.Length, 40)]).ToArray();

    public Task<List<ReadingNote>> LoadAsync(string document) => Task.Run(() =>
    {
        var folder = Folder(document);
        if (!Directory.Exists(folder)) return new List<ReadingNote>();
        var result = new List<ReadingNote>();
        foreach (var file in Directory.EnumerateFiles(folder, "*.json"))
        {
            var note = JsonSerializer.Deserialize<ReadingNote>(File.ReadAllText(file), Json)
                ?? throw new InvalidDataException("笔记文件为空：" + file);
            if (note.Document != document) throw new InvalidDataException("笔记文档标识不匹配。");
            if (!note.Deleted) result.Add(note);
        }
        return result.OrderBy(note => note.Created).ToList();
    });

    public Task<ReadingNote> SaveAsync(ReadingNote note) => Task.Run(() =>
    {
        if (!Guid.TryParseExact(note.Id, "N", out _) || note.Document.Length is 0 or > 32768 ||
            note.Text.Length > 100000 || note.Anchor.Quote.Length > 8000 || note.Anchor.Prefix.Length > 64 ||
            note.Anchor.Suffix.Length > 64 || note.Anchor.Start < 0 || note.Tags.Length > 20)
            throw new InvalidDataException("笔记内容超出限制。");
        var folder = Folder(note.Document);
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, note.Id + ".json");
        // Serialize writers across windows; never overwrite a newer note with an old editor draft.
        var lockId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(file.ToUpperInvariant())));
        using var mutex = new Mutex(false, "Local\\MicaNote-" + lockId);
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(5)); } catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("笔记正在另一个窗口保存，请稍后重试。");
            var previous = File.Exists(file) ? JsonSerializer.Deserialize<ReadingNote>(File.ReadAllText(file), Json) : null;
            if ((previous?.Revision ?? 0) != note.Revision)
                throw new IOException("这条笔记已在另一窗口修改。请先复制当前内容，重新打开文档后再编辑。");
            var saved = note with { Updated = DateTimeOffset.UtcNow, Revision = note.Revision + 1 };
            var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { File.WriteAllText(temporary, JsonSerializer.Serialize(saved, Json)); File.Move(temporary, file, true); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return saved;
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    });

    public static string Export(string title, IEnumerable<ReadingNote> notes)
    {
        var text = new StringBuilder("# " + title.Replace('\n', ' ') + " · 阅读笔记\n\n");
        foreach (var note in notes.Where(n => !n.Deleted))
        {
            text.Append("## ").AppendLine(note.Anchor.Quote.Length > 0 ? "摘录" : "全文笔记").AppendLine();
            if (note.Anchor.Quote.Length > 0)
                foreach (var line in note.Anchor.Quote.Split('\n')) text.Append("> ").AppendLine(line);
            text.AppendLine().AppendLine(note.Text).AppendLine();
            if (note.Tags.Length > 0) text.AppendLine(note.TagLabel).AppendLine();
        }
        return text.ToString();
    }
}
