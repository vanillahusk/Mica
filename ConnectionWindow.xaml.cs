using System.Windows;

namespace LightSession.Desktop;

public partial class ConnectionWindow : Window
{
    public ConnectionWindow()
    {
        InitializeComponent();
        var ids = NativeHostInstaller.DiscoverExtensionIds();
        if (ids.Count == 1) ExtensionIdBox.Text = ids[0];
    }

    private void Connect_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            NativeHostInstaller.Install(ExtensionIdBox.Text);
            DialogResult = true;
        }
        catch (Exception exception)
        {
            ErrorText.Text = exception.Message;
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
