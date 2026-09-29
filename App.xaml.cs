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
            NativeMessagingHost.RunAsync().GetAwaiter().GetResult();
            Shutdown();
            return;
        }

        var openConversation = CommandLine.Value(e.Args, "--open");
        var window = new MainWindow(openConversation);
        MainWindow = window;
        window.Show();
    }
}

internal static class CommandLine
{
    public static string? Value(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
