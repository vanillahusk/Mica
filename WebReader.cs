using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;

namespace LightSession.Desktop;

public sealed record ReaderOutlineItem(string Title, int Level, string Id, int Turn)
{
    public string DisplayTitle => Turn > 0 ? $"{Turn:00}   {Title}" : $"{new string('　', Math.Clamp(Level - 1, 0, 5))}{Title}";
}
public sealed record ReaderAnchor(int Line, double Delta);

public sealed class WebReader : WebView2
{
    private const string Origin = "https://mica-reader.local/";
    private Task? initialization;
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private TaskCompletionSource<IReadOnlyList<ReaderOutlineItem>>? pending;
    private long revision;
    private string? imageDirectory;
    private string imageToken = "";
    private WindowState? previousWindowState;
    private WindowStyle previousWindowStyle;
    private ResizeMode previousResizeMode;
    private readonly bool diagramWindow;
    public double VerticalOffset { get; private set; }
    public double ScrollableHeight { get; private set; }
    public int ActiveIndex { get; private set; }
    public ReaderAnchor? CurrentAnchor { get; private set; }
    public double ReadingZoom { get; private set; } = 100;
    public string LastMetrics { get; private set; } = "";
    public bool IsolatedDiagramsEnabled { get; private set; } = true;
    public void SetDiagramEngine(bool isolated) { IsolatedDiagramsEnabled = isolated; Post(new { type = "diagram-engine", isolated }); }
    public event EventHandler? ReadingStateChanged;
    public event EventHandler<bool>? FullscreenChanged;
    public event EventHandler<AnnotationRequest>? AnnotationRequested;
    public event EventHandler<IReadOnlyList<string>>? AnnotationStateChanged;
    public event EventHandler? EditChanged;
    public event EventHandler<string>? EditFailed;
    public void BeginEditing(string text) => Post(new { type = "edit", id = revision, text });
    public async Task<string?> CaptureEditAsync(bool stop = false)
    {
        if (CoreWebView2 is null) return null;
        var json = await CoreWebView2.ExecuteScriptAsync(stop ? "window.mica.endEditing()" : "window.mica.editorSnapshot()");
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Object || doc.RootElement.GetProperty("id").GetInt64() != revision) return null;
        if (doc.RootElement.TryGetProperty("composing", out var composing) && composing.GetBoolean())
            throw new InvalidOperationException("请先确认中文输入法中的文字，再保存或切换文档。");
        return doc.RootElement.GetProperty("text").GetString();
    }

    public WebReader() : this(false) { }
    public WebReader(bool diagramWindow)
    {
        this.diagramWindow = diagramWindow;
        UpdateTheme(null, EventArgs.Empty);
        ThemeManager.Changed += UpdateTheme;
    }

    private void UpdateTheme(object? sender, EventArgs e)
    {
        DefaultBackgroundColor = System.Drawing.ColorTranslator.FromHtml(ThemeManager.Current.Colors["bg"]);
        Post(new { type = "theme", id = ThemeManager.Current.Id });
    }

    public new void Dispose()
    {
        ThemeManager.Changed -= UpdateTheme;
        base.Dispose();
    }

    public Task PrepareAsync() => initialization ??= InitializeReaderAsync();
    private async Task InitializeReaderAsync()
    {
        var assets = Path.Combine(AppContext.BaseDirectory, "ReaderAssets");
        if (!File.Exists(Path.Combine(assets, "index.html")))
            throw new FileNotFoundException("缺少离线阅读组件，请使用完整发布目录。");
        var data = Environment.GetEnvironmentVariable("MICA_WEBVIEW_DATA_DIR")
            ?? Path.Combine(ConversationStore.AppDataDirectory, "webview");
        var environment = await CoreWebView2Environment.CreateAsync(null, data);
        await EnsureCoreWebView2Async(environment);
        var core = CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.SetVirtualHostNameToFolderMapping("mica-reader.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
        core.AddWebResourceRequestedFilter("https://mica-images.local/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += LocalImageRequested;
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(Origin, StringComparison.Ordinal)) e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.WebMessageReceived += Receive;
        core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) ready.TrySetException(new IOException("阅读组件加载失败：" + e.WebErrorStatus));
        };
        core.Navigate(Origin + "index.html");
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
        UpdateTheme(null, EventArgs.Empty);
        SetDiagramEngine(IsolatedDiagramsEnabled);
    }

    public async Task<IReadOnlyList<ReaderOutlineItem>> RenderAsync(string text, string key, bool conversation,
        string? filePath, double offset, CancellationToken cancellation, ReaderAnchor? anchor = null)
    {
        await PrepareAsync().WaitAsync(cancellation);
        pending?.TrySetCanceled();
        var completion = new TaskCompletionSource<IReadOnlyList<ReaderOutlineItem>>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending = completion;
        var id = ++revision;
        imageDirectory = filePath is null ? null : Path.GetDirectoryName(Path.GetFullPath(filePath));
        imageToken = Guid.NewGuid().ToString("N");
        using var registration = cancellation.Register(() => completion.TrySetCanceled(cancellation));
        Post(new { type = "render", id, key, text, conversation, offset, anchor,
            imageBase = imageDirectory is null ? null : $"https://mica-images.local/{imageToken}/" });
        return await completion.Task.WaitAsync(TimeSpan.FromSeconds(90), cancellation);
    }

    public void NavigateTo(string id) => Post(new { type = "navigate", id });
    public void OpenFind() => Post(new { type = "find" });
    public void ShowAnnotations(IEnumerable<ReadingNote> notes) => Post(new { type = "annotations", id = revision,
        notes = notes.Select(note => new { id = note.Id, anchor = new { quote = note.Anchor.Quote,
            prefix = note.Anchor.Prefix, suffix = note.Anchor.Suffix, start = note.Anchor.Start } }) });
    public void NavigateToAnnotation(string noteId) => Post(new { type = "annotation-navigate", id = revision, noteId });
    public void ScrollTo(double offset) => Post(new { type = "scroll", offset });
    public void SetReadingZoom(double value)
    {
        ReadingZoom = Math.Clamp(value, 80, 150);
        Post(new { type = "zoom", value = ReadingZoom });
    }
    private void Post(object value)
    {
        if (CoreWebView2 is not null) CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(value));
    }
    private void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(Origin, StringComparison.Ordinal)) return;
        try
        {
            using var json = JsonDocument.Parse(args.WebMessageAsJson);
            var root = json.RootElement;
            var type = root.GetProperty("type").GetString();
            if (type == "ready") { ready.TrySetResult(); return; }
            if (type is "rendered" or "position" or "error" or "annotation-create" or "annotation-open" or "annotation-state" or "edit-change" or "edit-ready" or "edit-error")
                if (!root.TryGetProperty("id", out var id) || id.GetInt64() != revision) return;
            switch (type)
            {
                case "edit-change": EditChanged?.Invoke(this, EventArgs.Empty); break;
                case "edit-error": EditFailed?.Invoke(this, root.GetProperty("error").GetString() ?? "编辑组件加载失败"); break;
                case "annotation-create":
                    var anchor = root.GetProperty("anchor").Deserialize<NoteAnchor>(new JsonSerializerOptions(JsonSerializerDefaults.Web));
                    var action = root.GetProperty("action").GetString();
                    if (anchor?.Quote is { Length: > 0 and <= 8000 } && anchor.Prefix is { Length: <= 64 } &&
                        anchor.Suffix is { Length: <= 64 } && anchor.Start >= 0 && action is "highlight" or "note" or "tag")
                        AnnotationRequested?.Invoke(this, new(action, anchor, null));
                    break;
                case "annotation-open":
                    AnnotationRequested?.Invoke(this, new("open", null, root.GetProperty("noteId").GetString()));
                    break;
                case "annotation-state":
                    AnnotationStateChanged?.Invoke(this, root.GetProperty("missing").Deserialize<string[]>() ?? []);
                    break;
                case "rendered":
                    var outline = JsonSerializer.Deserialize<List<ReaderOutlineItem>>(root.GetProperty("outline").GetRawText(),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
                    LastMetrics = $"首屏 {root.GetProperty("firstPaintMs").GetDouble():0} ms · 解析 {root.GetProperty("parseMs").GetDouble():0} ms · 完成 {root.GetProperty("totalMs").GetDouble():0} ms";
                    pending?.TrySetResult(outline);
                    break;
                case "position":
                    VerticalOffset = root.GetProperty("offset").GetDouble();
                    ScrollableHeight = root.GetProperty("max").GetDouble();
                    ActiveIndex = root.GetProperty("active").GetInt32();
                    if (root.TryGetProperty("anchor", out var positionAnchor) && positionAnchor.ValueKind == JsonValueKind.Object)
                        CurrentAnchor = new(positionAnchor.GetProperty("line").GetInt32(), positionAnchor.GetProperty("delta").GetDouble());
                    ReadingStateChanged?.Invoke(this, EventArgs.Empty);
                    break;
                case "error": pending?.TrySetException(new InvalidDataException(root.GetProperty("error").GetString())); break;
                case "copy":
                    var text = root.GetProperty("text").GetString();
                    if (text is { Length: <= 8_000_000 }) Clipboard.SetText(text);
                    break;
                case "link":
                    if (Uri.TryCreate(root.GetProperty("url").GetString(), UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                    break;
                case "diagram-window":
                    var source = root.GetProperty("source").GetString();
                    if (source is { Length: > 0 and <= 100000 }) OpenDiagramWindow(source,root.TryGetProperty("engine",out var engine)&&engine.GetString()=="isolated");
                    break;
                case "fullscreen": SetFullscreen(root.GetProperty("value").GetBoolean()); break;
                case "close-window": if (diagramWindow) Window.GetWindow(this)?.Close(); break;
            }
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or System.Runtime.InteropServices.COMException)
        { Debug.WriteLine(exception); }
    }

    private void LocalImageRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        try
        {
            var uri = new Uri(args.Request.Uri);
            var segments = uri.AbsolutePath.TrimStart('/').Split('/', 2);
            if (imageDirectory is null || segments.Length != 2 || segments[0] != imageToken) throw new IOException();
            var relative = Uri.UnescapeDataString(segments[1]).Replace('/', Path.DirectorySeparatorChar);
            var path = Path.GetFullPath(Path.Combine(imageDirectory, relative));
            var root = Path.TrimEndingDirectorySeparator(imageDirectory) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException();
            var mime = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif",
                ".webp" => "image/webp", ".svg" => "image/svg+xml", ".bmp" => "image/bmp", _ => null
            };
            if (mime is null || !File.Exists(path) || new FileInfo(path).Length > 40_000_000) throw new IOException();
            // No junction/symlink may redirect image reads outside the document directory.
            for (var entry = new FileInfo(path) as FileSystemInfo; entry is not null && entry.FullName.Length >= imageDirectory.Length;
                entry = entry is FileInfo file ? file.Directory : ((DirectoryInfo)entry).Parent)
                if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException();
            var stream = new MemoryStream(File.ReadAllBytes(path));
            args.Response = CoreWebView2.Environment.CreateWebResourceResponse(stream, 200, "OK",
                $"Content-Type: {mime}\r\nAccess-Control-Allow-Origin: https://mica-reader.local\r\nCache-Control: private, max-age=3600");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            args.Response = CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
        }
    }
    private void OpenDiagramWindow(string source, bool isolated)
    {
        var view = new WebReader(true);
        view.SetDiagramEngine(isolated);
        var window = new Window { Title = "Mica · 图表", Width = 1100, Height = 760, MinWidth = 600, MinHeight = 420,
            Content = view, WindowStartupLocation = WindowStartupLocation.CenterScreen };
        window.Loaded += async (_, _) =>
        {
            try { await view.PrepareAsync(); view.Post(new { type = "diagram", source }); }
            catch (Exception e) { MessageBox.Show(window, e.Message, "图表加载失败"); }
        };
        window.Closed += (_, _) => view.Dispose();
        window.Show();
    }
    private void SetFullscreen(bool enabled)
    {
        FullscreenChanged?.Invoke(this, enabled);
        var window = Window.GetWindow(this);
        if (window is null) return;
        if (enabled && previousWindowState is null)
        {
            previousWindowState = window.WindowState;
            previousWindowStyle = window.WindowStyle; previousResizeMode = window.ResizeMode;
            window.WindowState = WindowState.Normal; window.WindowStyle = WindowStyle.None;
            window.ResizeMode = ResizeMode.NoResize; window.WindowState = WindowState.Maximized;
        }
        else if (!enabled && previousWindowState is { } state)
        {
            window.WindowState = WindowState.Normal; window.WindowStyle = previousWindowStyle;
            window.ResizeMode = previousResizeMode; window.WindowState = state; previousWindowState = null;
        }
    }
}

public sealed record AnnotationRequest(string Action, NoteAnchor? Anchor, string? NoteId);
