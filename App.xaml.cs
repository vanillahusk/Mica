using System.Windows;

namespace LightSession.Desktop;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (NativeMessagingHost.ShouldRun(e.Args))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            // Native messaging is a blocking stdio protocol. Running it away from
            // WPF's dispatcher avoids an async continuation deadlock on startup.
            Task.Run(NativeMessagingHost.RunAsync).GetAwaiter().GetResult();
            Shutdown();
            return;
        }

        var openConversation = CommandLine.Value(e.Args, "--open");
        var window = new MainWindow(openConversation, CommandLine.DocumentPath(e.Args));
        MainWindow = window;
        window.Show();
    }
}

public static class CommandLine
{
    public static string? DocumentPath(string[] args)
    {
        var named = Value(args, "--file");
        if (!string.IsNullOrWhiteSpace(named)) return named;
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] is "--open" or "--file") { i++; continue; }
            if (!args[i].StartsWith("-", StringComparison.Ordinal) &&
                System.IO.Path.GetExtension(args[i]).ToLowerInvariant() is ".md" or ".markdown" or ".txt") return args[i];
        }
        return null;
    }
    public static string? Value(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
