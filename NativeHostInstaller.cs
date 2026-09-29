using Microsoft.Win32;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LightSession.Desktop;

internal static partial class NativeHostInstaller
{
    public const string HostName = "com.mica.desktop";
    private static string ManifestPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Mica", "native-host", HostName + ".json");

    public static bool IsRegistered()
    {
        if (!File.Exists(ManifestPath)) return false;
        using var key = Registry.CurrentUser.OpenSubKey($@"Software\Google\Chrome\NativeMessagingHosts\{HostName}");
        return string.Equals(key?.GetValue(null) as string, ManifestPath, StringComparison.OrdinalIgnoreCase);
    }

    public static IReadOnlyList<string> DiscoverExtensionIds()
    {
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var root in new[]
        {
            Path.Combine(local, "Google", "Chrome", "User Data"),
            Path.Combine(local, "Microsoft", "Edge", "User Data"),
        })
        {
            if (!Directory.Exists(root)) continue;
            foreach (var profile in Directory.EnumerateDirectories(root).Where(path =>
                Path.GetFileName(path) == "Default" || Path.GetFileName(path).StartsWith("Profile ", StringComparison.Ordinal)))
            {
                foreach (var fileName in new[] { "Preferences", "Secure Preferences" })
                    ReadIds(Path.Combine(profile, fileName), ids);
            }
        }
        return ids.OrderBy(id => id).ToList();
    }

    public static void Install(string extensionId)
    {
        extensionId = extensionId.Trim().ToLowerInvariant();
        if (!ExtensionIdRegex().IsMatch(extensionId))
            throw new InvalidDataException("扩展 ID 应为 32 位小写字母。请从 chrome://extensions 复制。");

        var directory = Path.GetDirectoryName(ManifestPath)!;
        Directory.CreateDirectory(directory);
        var manifest = new
        {
            name = HostName,
            description = "Mica desktop conversation sync host",
            path = Environment.ProcessPath ?? throw new InvalidOperationException("无法确定 Mica 程序路径。"),
            type = "stdio",
            allowed_origins = new[] { $"chrome-extension://{extensionId}/" },
        };
        File.WriteAllText(ManifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));

        foreach (var browser in new[] { "Google\\Chrome", "Microsoft\\Edge" })
        {
            using var key = Registry.CurrentUser.CreateSubKey($@"Software\{browser}\NativeMessagingHosts\{HostName}");
            key.SetValue(null, ManifestPath);
        }
    }

    private static void ReadIds(string path, HashSet<string> ids)
    {
        if (!File.Exists(path)) return;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            if (!document.RootElement.TryGetProperty("extensions", out var extensions) ||
                !extensions.TryGetProperty("settings", out var settings)) return;
            foreach (var entry in settings.EnumerateObject())
            {
                if (!ExtensionIdRegex().IsMatch(entry.Name)) continue;
                var raw = entry.Value.GetRawText();
                if (raw.Contains("LightSession", StringComparison.OrdinalIgnoreCase) ||
                    raw.Contains("light-session", StringComparison.OrdinalIgnoreCase)) ids.Add(entry.Name);
            }
        }
        catch (JsonException) { }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    [GeneratedRegex("^[a-p]{32}$")]
    private static partial Regex ExtensionIdRegex();
}
