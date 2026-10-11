using Microsoft.Win32;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LightSession.Desktop;

public static class FileAssociations
{
    public const string ProgId = "Mica.Markdown";
    // A pure registration plan also allows testing without changing user defaults.
    public static IReadOnlyList<(string Key, string Name, string Value)> Registration(string executable)
    {
        if (!System.IO.Path.IsPathFullyQualified(executable) || executable.Contains('"')) throw new ArgumentException("无效的程序路径");
        var command = $"\"{executable}\" \"%1\"";
        return [
            (@"Software\Classes\Mica.Markdown", "", "Markdown 文档"),
            (@"Software\Classes\Mica.Markdown\DefaultIcon", "", $"\"{executable}\",0"),
            (@"Software\Classes\Mica.Markdown\shell\open\command", "", command),
            (@"Software\Classes\Applications\Mica.exe", "FriendlyAppName", "Mica"),
            (@"Software\Classes\Applications\Mica.exe\shell\open\command", "", command),
            (@"Software\Classes\Applications\Mica.exe\SupportedTypes", ".md", ""),
            (@"Software\Classes\Applications\Mica.exe\SupportedTypes", ".markdown", ""),
            (@"Software\Classes\.md\OpenWithProgids", ProgId, ""),
            (@"Software\Classes\.markdown\OpenWithProgids", ProgId, ""),
            (@"Software\Mica\Capabilities", "ApplicationName", "Mica"),
            (@"Software\Mica\Capabilities", "ApplicationDescription", "Markdown 与 ChatGPT 会话阅读器"),
            (@"Software\Mica\Capabilities\FileAssociations", ".md", ProgId),
            (@"Software\Mica\Capabilities\FileAssociations", ".markdown", ProgId),
            (@"Software\RegisteredApplications", "Mica", @"Software\Mica\Capabilities")
        ];
    }

    public static void OpenSettings()
    {
        var executable = DesktopInstallation.IntegrationExecutable;
        foreach (var entry in Registration(executable))
        {
            using var key = Registry.CurrentUser.CreateSubKey(entry.Key);
            key.SetValue(entry.Name, entry.Value, RegistryValueKind.String);
        }
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
        // Register as a candidate; only Windows/user selection changes the default.
        Process.Start(new ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=Mica") { UseShellExecute = true });
    }
    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
