using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;

namespace LightSession.Desktop;

public sealed record ReaderTheme(string Id, string Name, string Scheme, Dictionary<string, string> Colors);

public static class ThemeManager
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    public static IReadOnlyList<ReaderTheme> Themes { get; } = JsonSerializer.Deserialize<List<ReaderTheme>>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "ReaderAssets", "themes.json")), JsonOptions)!;
    public static string SettingsPath => Environment.GetEnvironmentVariable("MICA_SETTINGS_PATH")
        ?? Path.Combine(ConversationStore.AppDataDirectory, "preferences.json");
    public static ReaderTheme Current { get; private set; } = Themes[0];
    public static event EventHandler? Changed;
    private static bool loaded;

    public static string ReadSavedTheme()
    {
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(SettingsPath));
            var id = json.RootElement.GetProperty("theme").GetString();
            return Themes.Any(t => t.Id == id) ? id! : "warm";
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or KeyNotFoundException or InvalidOperationException)
        { return "warm"; }
    }

    public static void Initialize()
    {
        if (loaded) return;
        loaded = true;
        Select(ReadSavedTheme(), false);
    }

    public static void Select(string id, bool persist = true)
    {
        var selected = Themes.FirstOrDefault(t => t.Id == id) ?? Themes[0];
        var changed = selected != Current;
        Current = selected;
        var keys = new Dictionary<string, string>
        {
            ["WindowBackground"]="bg", ["PanelBackground"]="sidebar", ["RaisedBackground"]="panel", ["CardBackground"]="selection",
            ["BorderBrush"]="line", ["TextBrush"]="text", ["MutedBrush"]="muted", ["AccentBrush"]="accent",
            ["HoverBrush"]="hover", ["PrimaryBackground"]="button", ["PrimaryForeground"]="buttonText", ["ScrollThumbBrush"]="scroll"
        };
        foreach (var (key, token) in keys)
            Application.Current.Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(selected.Colors[token]));
        Changed?.Invoke(null, EventArgs.Empty);
        if (!persist || (!changed && File.Exists(SettingsPath) && ReadSavedTheme() == selected.Id)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(SettingsPath))!);
        var temporary = SettingsPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(new { theme = selected.Id }));
            File.Move(temporary, SettingsPath, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
