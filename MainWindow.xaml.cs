using Microsoft.Win32;
using System.Collections.ObjectModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace LightSession.Desktop;

public partial class MainWindow : Window
{
    private readonly ConversationStore store = new();
    private readonly ObservableCollection<DocumentItem> conversations = [];
    private readonly ObservableCollection<DocumentItem> documents = [];
    private readonly List<DocumentItem> allConversations = [];
    private readonly List<DocumentItem> allDocuments = [];
    private readonly string? initialConversationId;
    private readonly string? initialDocumentPath;
    private FileSystemWatcher? watcher;
    private string? currentPath;
    private string? currentConversationId;
    private string? currentCacheKey;
    private string currentText = "";
    private bool editorLoaded;
    private IReadOnlyList<ReaderOutlineItem> currentOutline = [];
    private readonly DispatcherTimer previewTimer;
    private bool changingOutlineSelection;
    private bool loading;
    private bool filtering;
    private bool libraryVisible;
    private bool outlinePreference;
    private bool diagramFullscreen;
    private bool previewDirty;
    private string currentMode = "read";
    private int loadVersion;
    private readonly Dictionary<string, string> drafts = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, double> readingOffsets = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ReaderAnchor> readingAnchors = new(StringComparer.Ordinal);
    private CancellationTokenSource? renderCancellation;
    private bool rendering;
    private bool changingMode, checkingClose;

    public MainWindow(string? openConversationId, string? documentPath = null)
    {
        ThemeManager.Initialize();
        InitializeComponent();
        foreach (var (key, value) in ReadingPositionStore.Load())
        {
            readingOffsets[key] = value.Offset;
            if (value.Anchor is not null) readingAnchors[key] = value.Anchor;
        }
        initialConversationId = documentPath is null ? openConversationId : null;
        initialDocumentPath = documentPath;
        ThemeManager.Changed += ThemeChanged;
        UpdateThemeButtons();
        ConversationList.ItemsSource = conversations;
        DocumentList.ItemsSource = documents;
        previewTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(280) };
        previewTimer.Tick += async (_, _) =>
        {
            previewTimer.Stop();
            if (currentMode == "split") await RenderEditorPreview();
        };
        Preview.ReadingStateChanged += (_, _) => UpdateReadingState();
        Preview.EditChanged += (_, _) =>
        {
            if (currentMode != "edit" || rendering || currentPath is null || SaveButton.IsEnabled) return;
            // The WebView owns live text. Capture it at save/navigation boundaries, not every keystroke.
            SaveButton.IsEnabled = true; previewDirty = true;
            DocumentTitle.Text = Path.GetFileName(currentPath) + "  •";
            StatusText.Text = "未保存 · 切换文档会保留草稿";
        };
        Preview.EditFailed += (_, error) => { StatusText.Text = "实时编辑加载失败，可使用源码分栏：" + error; SetMode("split"); };
        InitializeNotes();
        Preview.FullscreenChanged += (_, full) =>
        {
            diagramFullscreen = full;
            TitleRow.Height = new GridLength(full ? 0 : 54);
            StatusRow.Height = new GridLength(full ? 0 : 26);
            SetLibraryVisible(libraryVisible);
            UpdateOutlineVisibility();
            EditorColumn.Width = !full && currentMode == "split" ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
            EditingToolbar.Visibility = !full && currentMode == "split" ? Visibility.Visible : Visibility.Collapsed;
            System.Windows.Shell.WindowChrome.GetWindowChrome(this).CaptionHeight = full ? 0 : 54;
        };
        Closing += async (_, args) =>
        {
            if (currentMode == "edit" && !checkingClose)
            {
                args.Cancel = true;
                try { await CaptureLiveEditAsync(); checkingClose = true; Close(); }
                catch (Exception error) { StatusText.Text = "无法确认编辑内容，已取消关闭：" + error.Message; }
                finally { checkingClose = false; }
                return;
            }
            if (savingNote) { args.Cancel = true; NoteStatus.Text = "笔记正在保存，请稍后关闭。"; return; }
            RememberReadingOffset();
            if (drafts.Count == 0 && noteDrafts.Count == 0) return;
            args.Cancel = MessageBox.Show(this,
                $"还有 {drafts.Count} 份文档、{noteDrafts.Count} 条笔记未保存。关闭将丢弃这些修改。\n\n确定关闭吗？",
                "未保存的修改", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes;
        };
        SourceInitialized += (_, _) =>
        {
            if (PresentationSource.FromVisual(this) is HwndSource source) source.AddHook(WindowProc);
        };
        StateChanged += (_, _) => MaximizeButton.Content = WindowState == WindowState.Maximized ? "❐" : "□";
        Loaded += async (_, _) => await InitializeAsync();
        Closed += (_, _) =>
        {
            previewTimer.Stop();
            renderCancellation?.Cancel();
            watcher?.Dispose();
            ThemeManager.Changed -= ThemeChanged;
            Preview.Dispose();
        };
    }

    private async Task InitializeAsync()
    {
        UpdateConnectionStatus();
        if (initialDocumentPath is not null) await OpenDocumentAsync(initialDocumentPath);
        await ReloadConversationsAsync();
        watcher = new FileSystemWatcher(ConversationStore.ConversationsDirectory, "*.json")
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
            EnableRaisingEvents = true,
        };
        watcher.Changed += StoreChanged;
        watcher.Created += StoreChanged;
        watcher.Renamed += StoreChanged;
        try { await Preview.PrepareAsync(); }
        catch (Exception error) { StatusText.Text = "阅读组件未就绪：" + error.Message; }
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
        filtering = true;
        var query = SearchBox.Text.Trim();
        conversations.Clear();
        foreach (var item in allConversations.Where(item => item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase))) conversations.Add(item);
        documents.Clear();
        foreach (var item in allDocuments.Where(item => item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase))) documents.Add(item);
        ConversationCount.Text = conversations.Count.ToString();
        DocumentCount.Text = documents.Count.ToString();
        ConversationList.SelectedItem = conversations.FirstOrDefault(item => item.ConversationId == currentConversationId);
        DocumentList.SelectedItem = documents.FirstOrDefault(item => item.Path == currentPath);
        LibraryHint.Visibility = documents.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        LibraryHint.Text = query.Length > 0 ? "没有匹配的本地文档" : "打开文件，或拖入 Markdown 文档";
        filtering = false;
    }

    private async void ConversationList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (filtering || ConversationList.SelectedItem is not DocumentItem item || item.ConversationId is null) return;
        var version = ++loadVersion;
        DocumentList.SelectedItem = null;
        StatusText.Text = "正在打开会话…";
        var record = await store.GetAsync(item.ConversationId);
        if (record is null || version != loadVersion) return;
        try { await CaptureLiveEditAsync(true); }
        catch (Exception error) { StatusText.Text = error.Message; return; }
        if (version != loadVersion) return;
        RememberReadingOffset();
        currentPath = null;
        currentConversationId = record.Id;
        await LoadText(ConversationMarkdown(record), record.Title, false, $"conversation:{record.Id}:{record.UpdatedAt.UtcTicks}");
    }

    private async void DocumentList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (filtering || DocumentList.SelectedItem is not DocumentItem item) return;
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
                builder.AppendLine("#### ChatGPT").AppendLine();
                builder.AppendLine(message.Text).AppendLine();
            }
        }
        return builder.ToString();
    }

    private async Task OpenDocumentAsync(string path)
    {
        var version = ++loadVersion;
        try
        {
            StatusText.Text = "正在打开文档…";
            var text = await File.ReadAllTextAsync(path);
            if (version != loadVersion) return;
            await CaptureLiveEditAsync(true);
            if (version != loadVersion) return;
            RememberReadingOffset();
            currentPath = path;
            currentConversationId = null;
            if (drafts.TryGetValue(path, out var draft)) text = draft;
            if (!allDocuments.Any(item => item.Path.Equals(path, StringComparison.OrdinalIgnoreCase)))
                allDocuments.Add(new DocumentItem(Path.GetFileName(path), path, false, null));
            ApplyFilter();
            await LoadText(text, Path.GetFileName(path), true, $"file:{path}:{File.GetLastWriteTimeUtc(path).Ticks}");
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, exception.Message, "无法打开文档", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async Task LoadText(string text, string title, bool editable, string cacheKey)
    {
        currentMode = "read";
        renderCancellation?.Cancel();
        renderCancellation?.Dispose();
        renderCancellation = new CancellationTokenSource();
        var cancellation = renderCancellation.Token;
        previewTimer.Stop();
        loading = true;
        if (editorLoaded) Editor.Clear();
        currentText = text;
        editorLoaded = false;
        loading = false;
        currentCacheKey = cacheKey;
        rendering = true;
        ResetNotesDocument();
        ReadingModeButton.IsEnabled = EditingModeButton.IsEnabled = NotesToggle.IsEnabled = SaveCopyButton.IsEnabled = FindButton.IsEnabled = false;
        EditMenuButton.IsEnabled = false;
        LoadingOverlay.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Collapsed;
        Preview.Visibility = Visibility.Visible;
        OutlineList.IsEnabled = false;
        ReadButton.IsEnabled = SplitButton.IsEnabled = EditButton.IsEnabled = SaveButton.IsEnabled = false;
        StatusText.Text = "正在排版…";
        DocumentTitle.Text = title;
        try
        {
            var result = await Preview.RenderAsync(text, cacheKey, !editable, currentPath,
                readingOffsets.GetValueOrDefault(ReadingKey), cancellation, readingAnchors.GetValueOrDefault(ReadingKey));
            cancellation.ThrowIfCancellationRequested();
            ApplyOutline(result);
            await LoadNotesAsync(cancellation);
            cancellation.ThrowIfCancellationRequested();
        }
        catch (OperationCanceledException) { return; }
        catch (Exception error)
        {
            Preview.Visibility = Visibility.Hidden;
            EmptyState.Visibility = Visibility.Visible;
            StatusText.Text = "无法显示文档：" + error.Message;
            return;
        }
        finally
        {
            if (!cancellation.IsCancellationRequested)
            {
                rendering = false;
                LoadingOverlay.Visibility = Visibility.Collapsed;
                OutlineList.IsEnabled = true;
                ReadButton.IsEnabled = true;
            }
        }
        DocumentTitle.Text = title + (currentPath is not null && drafts.ContainsKey(currentPath) ? "  •" : "");
        DocumentKind.Text = editable ? "本地文档 / Markdown" : "ChatGPT / 同步会话";
        StatusText.Text = currentPath is not null && drafts.ContainsKey(currentPath) ? "未保存 · 切换文档会保留草稿" : "已打开 · " + text.Length.ToString("N0") + " 字符";
        EmptyState.Visibility = Visibility.Collapsed;
        ReadButton.Visibility = Visibility.Visible;
        SplitButton.Visibility = editable ? Visibility.Visible : Visibility.Collapsed;
        EditButton.Visibility = editable ? Visibility.Visible : Visibility.Collapsed;
        SaveButton.Visibility = editable ? Visibility.Visible : Visibility.Collapsed;
        SaveButton.IsEnabled = editable && currentPath is not null && drafts.ContainsKey(currentPath);
        EditMenuButton.IsEnabled = editable;
        ReadingModeButton.IsEnabled = NotesToggle.IsEnabled = SaveCopyButton.IsEnabled = FindButton.IsEnabled = true;
        EditingModeButton.IsEnabled = editable;
        previewDirty = false;
        SetMode("read");
        UpdateReadingState();
    }

    private void UpdateConnectionStatus()
    {
        var connected = NativeHostInstaller.IsRegistered();
        ConnectionDot.Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString(connected ? "#63D6A2" : "#E9A15B"));
        ConnectionLabel.Text = connected ? "同步已配置" : "连接 ChatGPT";
        ConnectionHint.Text = connected ? "从扩展发送会话到这里" : "将会话保存在本机";
        HeroConnectButton.Content = connected ? "查看同步方法" : "连接扩展";
    }

    private void ConnectChatGpt_Click(object sender, RoutedEventArgs e)
    {
        MorePopup.IsOpen = false;
        var dialog = new ConnectionWindow { Owner = this };
        if (dialog.ShowDialog() == true)
        {
            UpdateConnectionStatus();
            MessageBox.Show(this, "连接完成。\n\n现在重新加载 LightSession 扩展，打开 ChatGPT 对话，然后点击右侧目录中的“同步到 Mica”。", "Mica 已连接", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    private void OpenFile_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "Markdown 文档|*.md;*.markdown;*.txt|所有文件|*.*" };
        if (dialog.ShowDialog(this) == true) _ = OpenDocumentAsync(dialog.FileName);
    }

    private async void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        MorePopup.IsOpen = false;
        var dialog = new OpenFolderDialog { Title = "选择 Markdown 文件夹" };
        if (dialog.ShowDialog(this) != true) return;
        StatusText.Text = "正在读取文件夹…";
        try
        {
            var items = await Task.Run(() => Directory.EnumerateFiles(dialog.FolderName, "*.*",
                    new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true })
                .Where(path => path.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
                .Take(5000)
                .Select(path => new DocumentItem(Path.GetRelativePath(dialog.FolderName, path), path, false, null)).ToList());
            allDocuments.Clear();
            allDocuments.AddRange(items);
            ApplyFilter();
            SetLibraryVisible(true);
            StatusText.Text = $"已载入 {items.Count} 份文档";
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
            await CaptureLiveEditAsync();
            var path = currentPath;
            var content = currentText;
            if (path is null) return;
            await File.WriteAllTextAsync(path, content, new UTF8Encoding(false));
            if (drafts.GetValueOrDefault(path) == content) drafts.Remove(path);
            if (currentPath != path || currentText != content) return;
            currentCacheKey = $"file:{path}:{File.GetLastWriteTimeUtc(path).Ticks}";
            SaveButton.IsEnabled = false;
            DocumentTitle.Text = Path.GetFileName(path);
            StatusText.Text = "已保存到本地";
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, exception.Message, "保存失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Editor_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (loading || !editorLoaded || EmptyState.Visibility == Visibility.Visible) return;
        currentText = Editor.Text;
        if (currentPath is not null) drafts[currentPath] = currentText;
        previewDirty = true;
        SaveButton.IsEnabled = currentPath is not null;
        StatusText.Text = "未保存 · 切换文档会保留草稿";
        previewTimer.Stop();
        previewTimer.Start();
        if (currentPath is not null) DocumentTitle.Text = Path.GetFileName(currentPath) + "  •";
    }

    private async Task RenderEditorPreview()
    {
        if (!previewDirty) return;
        var text = currentText;
        var key = currentCacheKey;
        try
        {
            var outline = await Preview.RenderAsync(text, key ?? "draft", false, currentPath,
                Preview.VerticalOffset, renderCancellation?.Token ?? CancellationToken.None);
            if (key != currentCacheKey || text != currentText) return;
            ApplyOutline(outline);
            Preview.ShowAnnotations(CurrentNotes());
            previewDirty = false;
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { StatusText.Text = "预览失败：" + error.Message; }
    }

    private void EnsureEditorLoaded()
    {
        if (editorLoaded) return;
        loading = true;
        Editor.Text = currentText;
        editorLoaded = true;
        loading = false;
    }

    private void AcceptLiveText(string text)
    {
        if (text == currentText || currentPath is null) return;
        currentText = text; drafts[currentPath] = text;
        editorLoaded = false; previewDirty = true; SaveButton.IsEnabled = true;
        DocumentTitle.Text = Path.GetFileName(currentPath) + "  •";
        StatusText.Text = "未保存 · 切换文档会保留草稿";
    }
    private async Task CaptureLiveEditAsync(bool stop = false)
    {
        if (currentMode != "edit") return;
        var path = currentPath;
        var text = await Preview.CaptureEditAsync(stop);
        if (path != currentPath) return;
        if (text is not null) AcceptLiveText(text);
        if (stop) currentMode = "read";
    }

    private void ApplyOutline(IReadOnlyList<ReaderOutlineItem> result)
    {
        changingOutlineSelection = true;
        currentOutline = result;
        OutlineFilter.Text = "";
        OutlineList.ItemsSource = currentOutline;
        OutlineCount.Text = currentOutline.Count.ToString();
        OutlineHeading.Text = currentConversationId is not null ? "对话目录" : "本文目录";
        OutlineToggle.IsEnabled = currentOutline.Count > 0;
        UpdateOutlineVisibility();
        if (currentOutline.Count > 0)
        {
            OutlineList.SelectedIndex = 0;
        }
        changingOutlineSelection = false;
    }

    private void UpdateOutlineVisibility()
    {
        if (OutlinePanel is null) return;
        var showNotes = !diagramFullscreen && notesVisible;
        var visible = !showNotes && !diagramFullscreen && currentOutline.Count > 0 && currentMode != "edit" && outlinePreference;
        OutlinePanel.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        NotesPanel.Visibility = showNotes ? Visibility.Visible : Visibility.Collapsed;
        OutlineDivider.Visibility = visible || showNotes ? Visibility.Visible : Visibility.Collapsed;
        OutlineColumn.Width = new GridLength(showNotes ? 320 : visible ? 222 : 0);
        OutlineToggle.SetResourceReference(Control.ForegroundProperty, visible ? "AccentBrush" : "MutedBrush");
        NotesToggle.SetResourceReference(Control.ForegroundProperty, showNotes ? "AccentBrush" : "MutedBrush");
        ResizeReadingPage();
    }

    private void Window_SizeChanged(object sender, SizeChangedEventArgs e) => UpdateOutlineVisibility();

    private void ResizeReadingPage() { /* CSS handles the actual viewport width. */ }

    private void ToggleLibrary_Click(object sender, RoutedEventArgs e)
    {
        SetLibraryVisible(!libraryVisible);
    }

    private void SetLibraryVisible(bool visible)
    {
        libraryVisible = visible;
        LibraryColumn.Width = new GridLength(libraryVisible && !diagramFullscreen ? 238 : 0);
        LibraryPanel.Visibility = LibraryDivider.Visibility = libraryVisible && !diagramFullscreen ? Visibility.Visible : Visibility.Collapsed;
        ResizeReadingPage();
    }

    private void TypeSettings_Click(object sender, RoutedEventArgs e) => TypePopup.IsOpen = !TypePopup.IsOpen;
    private void More_Click(object sender, RoutedEventArgs e) => MorePopup.IsOpen = !MorePopup.IsOpen;
    private void DiagramEngine_Click(object sender, RoutedEventArgs e)
    {
        Preview.SetDiagramEngine(!Preview.IsolatedDiagramsEnabled);
        DiagramEngineButton.Content = Preview.IsolatedDiagramsEnabled ? "现代绘图：开启" : "现代绘图：关闭";
        MorePopup.IsOpen = false;
        StatusText.Text = Preview.IsolatedDiagramsEnabled ? "已使用现代绘图 · 独立排版，不阻塞阅读" : "已使用 Mermaid 兼容绘图";
    }

    private void ThemeChanged(object? sender, EventArgs e) => UpdateThemeButtons();
    private void UpdateThemeButtons()
    {
        foreach (var button in ThemeChoices.Children.OfType<Button>())
        {
            var selected = (string)button.Tag == ThemeManager.Current.Id;
            button.SetResourceReference(Control.BackgroundProperty, selected ? "CardBackground" : "PanelBackground");
            button.SetResourceReference(Control.BorderBrushProperty, selected ? "AccentBrush" : "BorderBrush");
            button.FontWeight = selected ? FontWeights.SemiBold : FontWeights.Normal;
        }
    }
    private void Theme_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string id }) return;
        try { ThemeManager.Select(id); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { StatusText.Text = "主题已切换，但偏好保存失败：" + error.Message; }
    }
    private void DefaultApp_Click(object sender, RoutedEventArgs e)
    {
        MorePopup.IsOpen = false;
        try
        {
            FileAssociations.OpenSettings();
            StatusText.Text = "在 Windows 设置中将 .md / .markdown 的默认应用选为 Mica";
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "无法打开默认应用设置。也可以右键 Markdown 文件 → 打开方式 → 选择 Mica.exe。\n\n" + error.Message, "默认打开 Markdown");
        }
    }
    private void SmallerType_Click(object sender, RoutedEventArgs e) => SetReadingZoom(Preview.ReadingZoom - 10);
    private void LargerType_Click(object sender, RoutedEventArgs e) => SetReadingZoom(Preview.ReadingZoom + 10);
    private void ResetType_Click(object sender, RoutedEventArgs e) => SetReadingZoom(100);
    private void SetReadingZoom(double zoom)
    {
        Preview.SetReadingZoom(zoom);
        TypeScale.Text = $"{Preview.ReadingZoom:0}%";
        ResizeReadingPage();
    }

    private void ToggleOutline_Click(object sender, RoutedEventArgs e)
    {
        notesVisible = false;
        outlinePreference = OutlinePanel.Visibility != Visibility.Visible;
        UpdateOutlineVisibility();
    }

    private void Find_Click(object sender, RoutedEventArgs e) => Preview.OpenFind();

    private void OutlineFilter_Changed(object sender, TextChangedEventArgs e)
    {
        if (OutlineFilterHint is null || OutlineList is null) return;
        var query = OutlineFilter.Text.Trim();
        OutlineFilterHint.Visibility = query.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        OutlineList.ItemsSource = query.Length == 0 ? currentOutline : currentOutline
            .Where(item => item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase)).ToArray();
        OutlineCount.Text = query.Length == 0 ? currentOutline.Count.ToString() : $"{OutlineList.Items.Count}/{currentOutline.Count}";
    }

    private void BackToTop_Click(object sender, RoutedEventArgs e) => Preview.ScrollTo(0);

    private string ReadingKey => currentPath ?? ("conversation:" + currentConversationId);
    private void RememberReadingOffset()
    {
        if (!rendering && currentCacheKey is not null)
        {
            readingOffsets[ReadingKey] = Preview.VerticalOffset;
            if (Preview.CurrentAnchor is { } anchor) readingAnchors[ReadingKey] = anchor;
            ReadingPositionStore.Save(ReadingKey, Preview.VerticalOffset, Preview.CurrentAnchor);
        }
    }

    private void OutlineList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (changingOutlineSelection || OutlineList.SelectedItem is not ReaderOutlineItem item) return;
        NavigateTo(item);
    }

    private void OutlineList_MouseUp(object sender, MouseButtonEventArgs e)
    {
        if (ItemsControl.ContainerFromElement(OutlineList, e.OriginalSource as DependencyObject) is ListBoxItem row &&
            row.DataContext is ReaderOutlineItem item && !changingOutlineSelection) NavigateTo(item);
    }

    private void NavigateTo(ReaderOutlineItem item) => Preview.NavigateTo(item.Id);

    private void UpdateReadingState()
    {
        if (rendering || currentCacheKey is null) return;
        var progress = Preview.ScrollableHeight <= 0 ? 100 : 100 * Preview.VerticalOffset / Preview.ScrollableHeight;
        ProgressText.Text = $"阅读进度  {Math.Clamp(progress, 0, 100):0}%";
        if (changingOutlineSelection || currentOutline.Count == 0) return;
        var active = currentOutline[Math.Clamp(Preview.ActiveIndex, 0, currentOutline.Count - 1)];
        if (ReferenceEquals(OutlineList.SelectedItem, active)) return;
        changingOutlineSelection = true;
        OutlineList.SelectedItem = active;
        OutlineList.ScrollIntoView(active);
        changingOutlineSelection = false;
    }

    private void ReadMode_Click(object sender, RoutedEventArgs e) => SetMode("read");
    private void SplitMode_Click(object sender, RoutedEventArgs e) { MorePopup.IsOpen = false; SetMode("split"); }
    private void EditMode_Click(object sender, RoutedEventArgs e)
    {
        MorePopup.IsOpen = false;
        SetMode("edit");
    }

    private async void SetMode(string mode)
    {
        if (changingMode) return;
        changingMode = true;
        try { await SetModeAsync(mode); }
        catch (Exception error) { StatusText.Text = "切换失败，草稿已保留：" + error.Message; }
        finally { changingMode = false; }
    }
    private async Task SetModeAsync(string mode)
    {
        var version = loadVersion;
        if (mode != "read" && currentPath is null) mode = "read";
        if (currentMode == "edit" && mode != "edit") await CaptureLiveEditAsync(true);
        if (version != loadVersion) return;
        if (mode == "split") EnsureEditorLoaded();
        var beginEdit = mode == "edit" && currentMode != "edit";
        currentMode = mode;
        EditingToolbar.Visibility = mode == "split" ? Visibility.Visible : Visibility.Collapsed;
        previewTimer.Stop();
        if (mode != "edit" && previewDirty) await RenderEditorPreview();
        else if (mode != "edit") Preview.ShowAnnotations(CurrentNotes());
        if (version != loadVersion) return;
        if (beginEdit)
        {
            renderCancellation?.Cancel();
            renderCancellation = new CancellationTokenSource();
            Preview.BeginEditing(currentText);
        }
        Preview.Visibility = Visibility.Visible;
        EditorColumn.Width = mode == "split" ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        PreviewColumn.Width = new GridLength(1, GridUnitType.Star);
        DocumentKind.Text = mode == "edit" ? "实时编辑" : "Markdown 源码 / 预览";
        PreviewBorder.SetResourceReference(Border.BorderBrushProperty, "BorderBrush");
        PreviewBorder.BorderThickness = mode == "split" ? new Thickness(1, 0, 0, 0) : new Thickness(0);
        foreach (var (button, buttonMode) in new[] { (ReadButton, "read"), (SplitButton, "split"), (EditButton, "edit"), (ReadingModeButton, "read"), (EditingModeButton, mode == "split" ? "split" : "edit") })
        {
            if (mode == buttonMode) button.SetResourceReference(Control.BackgroundProperty, "CardBackground");
            else button.Background = Brushes.Transparent;
            button.SetResourceReference(Control.ForegroundProperty, mode == buttonMode ? "AccentBrush" : "MutedBrush");
        }
        SplitButton.IsEnabled = currentPath is not null;
        EditButton.IsEnabled = currentPath is not null;
        UpdateOutlineVisibility();
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        SearchHint.Visibility = string.IsNullOrEmpty(SearchBox.Text) ? Visibility.Visible : Visibility.Collapsed;
        ApplyFilter();
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Maximize_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
    }
    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private void Window_DragOver(object sender, DragEventArgs e) => e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;

    private async void Window_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is not string[] paths || paths.Length == 0) return;
        if (File.Exists(paths[0])) await OpenDocumentAsync(paths[0]);
    }

    private IntPtr WindowProc(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int wmGetMinMaxInfo = 0x0024;
        if (message != wmGetMinMaxInfo) return IntPtr.Zero;
        var info = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        var monitor = MonitorFromWindow(window, 2);
        if (monitor != IntPtr.Zero)
        {
            var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
            if (GetMonitorInfo(monitor, ref monitorInfo))
            {
                var bounds = diagramFullscreen ? monitorInfo.Monitor : monitorInfo.Work;
                info.MaxPosition.X = Math.Abs(bounds.Left - monitorInfo.Monitor.Left);
                info.MaxPosition.Y = Math.Abs(bounds.Top - monitorInfo.Monitor.Top);
                info.MaxSize.X = Math.Abs(bounds.Right - bounds.Left);
                info.MaxSize.Y = Math.Abs(bounds.Bottom - bounds.Top);
            }
        }
        Marshal.StructureToPtr(info, lParam, true);
        handled = true;
        return IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect Work;
        public uint Flags;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo monitorInfo);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
}
