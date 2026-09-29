using Microsoft.Win32;
using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;

namespace LightSession.Desktop;

public partial class MainWindow : Window
{
    private readonly ConversationStore store = new();
    private readonly ObservableCollection<DocumentItem> conversations = [];
    private readonly ObservableCollection<DocumentItem> documents = [];
    private readonly List<DocumentItem> allConversations = [];
    private readonly List<DocumentItem> allDocuments = [];
    private readonly string? initialConversationId;
    private FileSystemWatcher? watcher;
    private string? currentPath;
    private string? currentConversationId;
    private bool loading;

    public MainWindow(string? openConversationId)
    {
        InitializeComponent();
        initialConversationId = openConversationId;
        ConversationList.ItemsSource = conversations;
        DocumentList.ItemsSource = documents;
        Loaded += async (_, _) => await InitializeAsync();
        Closed += (_, _) => watcher?.Dispose();
    }

    private async Task InitializeAsync()
    {
        await ReloadConversationsAsync();
        watcher = new FileSystemWatcher(ConversationStore.ConversationsDirectory, "*.json")
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
            EnableRaisingEvents = true,
        };
        watcher.Changed += StoreChanged;
        watcher.Created += StoreChanged;
        watcher.Renamed += StoreChanged;
    }

    private void StoreChanged(object sender, FileSystemEventArgs args) => Dispatcher.BeginInvoke(async () => await ReloadConversationsAsync());

    private async Task ReloadConversationsAsync()
    {
        var records = await store.ListAsync();
        allConversations.Clear();
        allConversations.AddRange(records.Select(record => new DocumentItem(record.Title, "", true, record.Id)));
        ApplyFilter();
        if (initialConversationId is not null && currentConversationId is null)
        {
            var item = conversations.FirstOrDefault(item => item.ConversationId == initialConversationId);
            if (item is not null) ConversationList.SelectedItem = item;
        }
    }

    private void ApplyFilter()
    {
        var query = SearchBox.Text.Trim();
        conversations.Clear();
        foreach (var item in allConversations.Where(item => item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase))) conversations.Add(item);
        documents.Clear();
        foreach (var item in allDocuments.Where(item => item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase))) documents.Add(item);
        ConversationCount.Text = conversations.Count.ToString();
        DocumentCount.Text = documents.Count.ToString();
    }

    private async void ConversationList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ConversationList.SelectedItem is not DocumentItem item || item.ConversationId is null) return;
        DocumentList.SelectedItem = null;
        var record = await store.GetAsync(item.ConversationId);
        if (record is null) return;
        currentPath = null;
        currentConversationId = record.Id;
        LoadText(ConversationMarkdown(record), record.Title, false);
    }

    private async void DocumentList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DocumentList.SelectedItem is not DocumentItem item) return;
        ConversationList.SelectedItem = null;
        await OpenDocumentAsync(item.Path);
    }

    private static string ConversationMarkdown(ConversationRecord conversation)
    {
        var builder = new StringBuilder();
        builder.AppendLine($"# {conversation.Title}").AppendLine();
        foreach (var message in conversation.Messages)
        {
            if (message.Role == "user")
            {
                builder.AppendLine("> [!QUESTION]");
                foreach (var line in message.Text.Split('\n')) builder.Append("> ").AppendLine(line);
                builder.AppendLine();
            }
            else
            {
                builder.AppendLine(message.Text).AppendLine();
            }
        }
        return builder.ToString();
    }

    private async Task OpenDocumentAsync(string path)
    {
        try
        {
            var text = await File.ReadAllTextAsync(path);
            currentPath = path;
            currentConversationId = null;
            LoadText(text, Path.GetFileName(path), true);
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, exception.Message, "无法打开文档", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void LoadText(string text, string title, bool editable)
    {
        loading = true;
        Editor.Text = text;
        loading = false;
        Preview.Document = MarkdownRenderer.Render(text);
        DocumentTitle.Text = title;
        EmptyState.Visibility = Visibility.Collapsed;
        SaveButton.IsEnabled = editable;
        SetMode("read");
    }

    private void OpenFile_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "Markdown 文档|*.md;*.markdown;*.txt|所有文件|*.*" };
        if (dialog.ShowDialog(this) == true) _ = OpenDocumentAsync(dialog.FileName);
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "选择 Markdown 文件夹" };
        if (dialog.ShowDialog(this) != true) return;
        allDocuments.Clear();
        try
        {
            allDocuments.AddRange(Directory.EnumerateFiles(dialog.FolderName, "*.*", SearchOption.AllDirectories)
                .Where(path => path.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
                .Take(5000)
                .Select(path => new DocumentItem(Path.GetRelativePath(dialog.FolderName, path), path, false, null)));
            ApplyFilter();
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, exception.Message, "无法读取文件夹", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (currentPath is null) return;
        try
        {
            await File.WriteAllTextAsync(currentPath, Editor.Text, new UTF8Encoding(false));
            Preview.Document = MarkdownRenderer.Render(Editor.Text);
            DocumentTitle.Text = Path.GetFileName(currentPath);
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, exception.Message, "保存失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Editor_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (loading || EmptyState.Visibility == Visibility.Visible) return;
        if (PreviewColumn.Width.Value > 0) Preview.Document = MarkdownRenderer.Render(Editor.Text);
        if (currentPath is not null) DocumentTitle.Text = Path.GetFileName(currentPath) + "  •";
    }

    private void ReadMode_Click(object sender, RoutedEventArgs e) => SetMode("read");
    private void SplitMode_Click(object sender, RoutedEventArgs e) => SetMode("split");
    private void EditMode_Click(object sender, RoutedEventArgs e) => SetMode("edit");

    private void SetMode(string mode)
    {
        if (mode != "read" && currentPath is null) mode = "read";
        EditorColumn.Width = mode switch { "edit" => new GridLength(1, GridUnitType.Star), "split" => new GridLength(1, GridUnitType.Star), _ => new GridLength(0) };
        PreviewColumn.Width = mode switch { "edit" => new GridLength(0), "split" => new GridLength(1, GridUnitType.Star), _ => new GridLength(1, GridUnitType.Star) };
        PreviewBorder.BorderBrush = (System.Windows.Media.Brush)FindResource("BorderBrush");
        PreviewBorder.BorderThickness = mode == "split" ? new Thickness(1, 0, 0, 0) : new Thickness(0);
        ReadButton.Background = mode == "read" ? (System.Windows.Media.Brush)FindResource("AccentBrush") : (System.Windows.Media.Brush)FindResource("RaisedBackground");
        SplitButton.Background = mode == "split" ? (System.Windows.Media.Brush)FindResource("AccentBrush") : (System.Windows.Media.Brush)FindResource("RaisedBackground");
        EditButton.Background = mode == "edit" ? (System.Windows.Media.Brush)FindResource("AccentBrush") : (System.Windows.Media.Brush)FindResource("RaisedBackground");
        SplitButton.IsEnabled = currentPath is not null;
        EditButton.IsEnabled = currentPath is not null;
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => ApplyFilter();

    private void Window_DragOver(object sender, DragEventArgs e) => e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;

    private async void Window_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is not string[] paths || paths.Length == 0) return;
        if (File.Exists(paths[0])) await OpenDocumentAsync(paths[0]);
    }
}
