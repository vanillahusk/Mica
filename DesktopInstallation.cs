using System.IO;
using Microsoft.Win32;

namespace LightSession.Desktop;

public static class DesktopInstallation
{
    public static string InstalledExecutable
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Mica");
            var directory = key?.GetValue("InstallDirectory") as string;
            return !string.IsNullOrWhiteSpace(directory) && Path.IsPathFullyQualified(directory)
                ? Path.Combine(directory, "app", "Mica.exe") : "";
        }
    }

    // A portable copy must not replace a stable installation's integration paths.
    public static string IntegrationExecutable => ResolveExecutable(InstalledExecutable,
        Environment.ProcessPath ?? throw new InvalidOperationException("无法获取 Mica 路径。"));

    public static string ResolveExecutable(string installed, string current) =>
        File.Exists(installed) ? installed : current;
}
