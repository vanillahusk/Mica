using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using LightSession.Desktop;
using Microsoft.Web.WebView2.Core;

internal static class Program
{
    private sealed class TestApp : App { protected override void OnStartup(StartupEventArgs e) { } }
    private static readonly BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    private static MainWindow window = null!;
    private static WebReader reader = null!;
    [STAThread]
    private static int Main()
    {
        Environment.SetEnvironmentVariable("MICA_SETTINGS_PATH", Path.Combine(AppContext.BaseDirectory, "test-preferences.json"));
        Environment.SetEnvironmentVariable("MICA_READING_POSITIONS_PATH", Path.Combine(AppContext.BaseDirectory, "test-reading-positions-" + Guid.NewGuid().ToString("N") + ".json"));
        Environment.SetEnvironmentVariable("MICA_NOTES_DIRECTORY", Path.Combine(AppContext.BaseDirectory, "notes-test-" + Guid.NewGuid().ToString("N")));
        if (Environment.GetEnvironmentVariable("MICA_WEBVIEW_DATA_DIR") is null)
            Environment.SetEnvironmentVariable("MICA_WEBVIEW_DATA_DIR", Path.Combine(AppContext.BaseDirectory, "webview-test-profile"));
        var app = new TestApp { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var theme = System.Xml.Linq.XDocument.Load(Path.Combine(AppContext.BaseDirectory, "TestTheme.xaml"));
        var resources = theme.Root!.Elements().Single();
        resources.Name = System.Xml.Linq.XName.Get("ResourceDictionary", "http://schemas.microsoft.com/winfx/2006/xaml/presentation");
        resources.SetAttributeValue(System.Xml.Linq.XNamespace.Xmlns + "x", "http://schemas.microsoft.com/winfx/2006/xaml");
        app.Resources = (ResourceDictionary)System.Windows.Markup.XamlReader.Parse(resources.ToString());
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
        var startupPath = Path.Combine(AppContext.BaseDirectory, "含空格 阅读测试.MD");
        File.WriteAllText(startupPath, "# 从文件直接打开\n\n默认应用打开测试。");
        Assert(CommandLine.DocumentPath([startupPath]) == startupPath, "direct file argument keeps Chinese and spaces");
        Assert(CommandLine.DocumentPath(["--open", "conversation.md"]) is null, "sync conversation ID is not mistaken for a document");
        Assert(CommandLine.DocumentPath(["--file", startupPath]) == startupPath, "explicit file option");
        var associations = FileAssociations.Registration(@"C:\Program Files\Mica\Mica.exe");
        Assert(associations.Where(item => item.Key.EndsWith(@"open\command")).All(item => item.Value == "\"C:\\Program Files\\Mica\\Mica.exe\" \"%1\""), "file association quotes executable and document paths");
        Assert(!associations.Any(item => item.Key.Contains("UserChoice")), "registration never changes user default choice");
        Assert(DesktopInstallation.ResolveExecutable(startupPath, "portable.exe") == startupPath, "installed path wins over a portable executable");
        Assert(DesktopInstallation.ResolveExecutable(Path.Combine(AppContext.BaseDirectory, "missing-app.exe"), "portable.exe") == "portable.exe", "portable fallback works when not installed");
        window = new MainWindow(null, startupPath) { Width = 1200, Height = 850, Left = 40, Top = 40, ShowActivated = false, ShowInTaskbar = false };
        reader = (WebReader)window.FindName("Preview");
        reader.CoreWebView2InitializationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) { Console.WriteLine(e.InitializationException); return; }
            reader.CoreWebView2.NavigationCompleted += async (_, args) => Console.WriteLine("Navigation " + args.IsSuccess + " " + await Script("JSON.stringify({url:location.href,mica:!!window.mica,body:document.body?.innerText})"));
        };
        window.Show();
        var test = Run();
        var frame = new DispatcherFrame();
        test.ContinueWith(_ => window.Dispatcher.BeginInvoke(() => frame.Continue = false));
        Dispatcher.PushFrame(frame);
        try { test.GetAwaiter().GetResult(); Console.WriteLine("PASS native WebView2 integration"); return 0; }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
        finally
        {
            ((System.Collections.IDictionary)Field("drafts").GetValue(window)!).Clear();
            ((System.Collections.IDictionary)Field("noteDrafts").GetValue(window)!).Clear();
            foreach (Window item in app.Windows.Cast<Window>().ToArray()) item.Close();
        }
    }
    private static async Task Run()
    {
        Assert(window.Icon is not null, "main window loads embedded application icon");
        using (var iconStream = Application.GetResourceStream(new Uri("pack://application:,,,/Mica;component/Assets/mica.ico")).Stream)
        {
            var decoder = System.Windows.Media.Imaging.BitmapDecoder.Create(iconStream,
                System.Windows.Media.Imaging.BitmapCreateOptions.PreservePixelFormat, System.Windows.Media.Imaging.BitmapCacheOption.OnLoad);
            Assert(decoder.Frames.Select(frame => frame.PixelWidth).SequenceEqual(new[] { 16, 20, 24, 32, 40, 48, 64, 128, 256 }), "embedded ICO provides all nine native sizes");
        }
        var cold = Stopwatch.StartNew();
        Console.WriteLine("Preparing native reader...");
        await reader.PrepareAsync().WaitAsync(TimeSpan.FromSeconds(45));
        Console.WriteLine($"WebView initialization: {cold.ElapsedMilliseconds} ms (test profile)");
        await Until("document.querySelector('#article h1')?.textContent === '从文件直接打开'");
        Assert(((Border)window.FindName("EmptyState")).Visibility == Visibility.Collapsed, "startup document opens directly without welcome screen");
        foreach (var palette in ThemeManager.Themes)
        {
            ThemeManager.Select(palette.Id);
            await Until($"document.documentElement.dataset.theme === '{palette.Id}'");
            Assert(ThemeManager.ReadSavedTheme() == palette.Id, palette.Name + " selection persists");
            Assert(((System.Windows.Media.SolidColorBrush)window.Background).Color.ToString().EndsWith(palette.Colors["bg"][1..], StringComparison.OrdinalIgnoreCase), "native shell follows theme");
        }
        ThemeManager.Select("warm");
        for (var attempt=0;attempt<100 && !(bool)Field("notesReady").GetValue(window)!;attempt++) await Task.Delay(20);
        var startupPath = (string)Field("currentPath").GetValue(window)!;
        var notesDocument = ReadingNoteStore.DocumentKey(startupPath, null);
        var noteStore = new ReadingNoteStore();
        Invoke("AnnotationRequested", reader, new AnnotationRequest("note", new NoteAnchor("默认应用打开测试。"), null));
        Assert(((Border)window.FindName("NotesPanel")).Visibility == Visibility.Visible, "selection opens notes beside the article");
        ((TextBox)window.FindName("NoteTags")).Text = "复习，产品 #复习";
        ((TextBox)window.FindName("NoteText")).Text = "这是独立保存的阅读想法。";
        await (Task)Invoke("SaveSelectedNoteAsync")!;
        var notes = await noteStore.LoadAsync(notesDocument);
        Assert(notes.Count == 1 && notes[0].Tags.SequenceEqual(new[] { "复习", "产品" }), "selection note and normalized tags persist");
        await Until("window.mica.diagnostics().annotations.matched === 1");
        Assert((await File.ReadAllTextAsync(startupPath)).Contains("默认应用打开测试。") && !(await File.ReadAllTextAsync(startupPath)).Contains("独立保存"), "notes do not modify source Markdown");
        var stale = notes[0];
        ((TextBox)window.FindName("NoteText")).Text = "切换文档也保留的草稿。";
        Field("currentPath").SetValue(window, Path.Combine(AppContext.BaseDirectory, "another.md"));
        await Load("# 另一份文档", "another-note-fixture", true);
        Assert(((ListBox)window.FindName("NoteList")).Items.Count == 0, "notes are isolated by document");
        Field("currentPath").SetValue(window, startupPath);
        await Load("# 从文件直接打开\n\n默认应用打开测试。", "reopened-note-fixture", true);
        ((ListBox)window.FindName("NoteList")).SelectedIndex = 0;
        Assert(((TextBox)window.FindName("NoteText")).Text.Contains("保留的草稿"), "unsaved note draft survives document switching");
        await (Task)Invoke("SaveSelectedNoteAsync")!;
        var conflict = false;
        try { await noteStore.SaveAsync(stale with { Text = "stale overwrite" }); } catch (IOException) { conflict = true; }
        Assert(conflict, "stale window cannot overwrite a newer saved note");
        notes = await noteStore.LoadAsync(notesDocument);
        Assert(notes[0].Revision == 2, "reopen/save preserves note identity and revision");
        ((TextBox)window.FindName("NoteFilter")).Text = "#产品";
        Assert(((ListBox)window.FindName("NoteList")).Items.Count == 1, "tag filters notes");
        ((TextBox)window.FindName("NoteFilter")).Text = "不存在的标签";
        Assert(((ListBox)window.FindName("NoteList")).Items.Count == 0, "unmatched tag produces empty list");
        ((TextBox)window.FindName("NoteFilter")).Clear();
        Assert(ReadingNoteStore.Export("文档",notes).Contains("#产品"), "Markdown export includes tags");
        Invoke("SetMode", "edit");
        await Until("!!window.mica.editorView()");
        Assert(((Border)window.FindName("NotesPanel")).Visibility == Visibility.Visible && reader.Visibility == Visibility.Visible, "notes remain usable alongside live editing mode");
        Invoke("SetMode", "read");
        await Until("!window.mica.editorView()");
        await Task.Delay(80);
        window.UpdateLayout();
        // WPF shell capture verifies the layout independently of the separately captured WebView surface.
        var shellImage = new System.Windows.Media.Imaging.RenderTargetBitmap((int)window.ActualWidth,(int)window.ActualHeight,96,96,System.Windows.Media.PixelFormats.Pbgra32);
        shellImage.Render(window);
        var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder(); encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(shellImage));
        using (var file = File.Create(Path.Combine(AppContext.BaseDirectory,"notes-shell.png"))) encoder.Save(file);
        window.Width = 900; window.Height = 580;
        await Task.Delay(80); window.UpdateLayout();
        var exportButton = ((StackPanel)((TextBlock)window.FindName("NoteStatus")).Parent).Children.OfType<Button>().Single();
        var exportBottom = exportButton.TranslatePoint(new Point(0,exportButton.ActualHeight),window).Y;
        Assert(exportBottom < window.ActualHeight - 20, "note controls remain reachable at minimum window size");
        window.Width = 1200; window.Height = 850;
        await noteStore.SaveAsync(notes[0] with { Deleted = true });
        Assert((await noteStore.LoadAsync(notesDocument)).Count == 0, "deletion tombstone hides note while retaining recovery data");
        Invoke("ToggleNotes_Click", window, new RoutedEventArgs());
        Field("currentPath").SetValue(window, null);
        const string fixture = "# 阅读测试\n\n> [!QUESTION]\n> 如何阅读图表？\n\n```mermaid\nflowchart LR\n A[打开文档] --> B[舒适阅读]\n```\n\n$x^2$\n\n";
        reader.SetDiagramEngine(true);
        await Until("window.mica.diagnostics().diagramEngine === 'isolated'");
        var conversation = fixture + string.Concat(Enumerable.Repeat("正文 **重点**。\n\n", 80)) + "> [!QUESTION]\n> 如何准确定位？\n\n回答正文。";
        Field("currentConversationId").SetValue(window, "ui-test");
        await Load(conversation, "test-conversation", false);
        Assert(((ColumnDefinition)window.FindName("LibraryColumn")).Width.Value == 0, "reader starts with library collapsed");
        Assert(((Border)window.FindName("EditingToolbar")).Visibility == Visibility.Collapsed, "editing toolbar hidden in read mode");
        var outlines = (IReadOnlyList<ReaderOutlineItem>)Field("currentOutline").GetValue(window)!;
        Assert(outlines.Count == 2, "question-only native outline");
        await Until("window.mica.diagnostics().diagrams === 1");
        Assert((await Script("document.querySelector('.diagram svg').textContent")).Contains("打开文档"), "Chinese Mermaid labels in native WebView");
        reader.SetReadingZoom(120);
        await Until("getComputedStyle(document.documentElement).getPropertyValue('--size') === '19.2px'");
        reader.SetReadingZoom(100);
        reader.NavigateTo(outlines[1].Id);
        await Until("scrollY > 500");
        Assert(await Boolean("Math.abs(document.getElementById('question-2').getBoundingClientRect().top - 24) < 3 || Math.abs(scrollY - document.documentElement.scrollHeight + innerHeight) < 3"), "outline scrolls to visible target");
        await Script("document.querySelector('[data-action=diagram-open]').click()");
        await Until("window.mica.diagnostics().viewerOpen");
        Invoke("SetLibraryVisible", true);
        Invoke("ToggleOutline_Click", window, new RoutedEventArgs());
        await Script("document.querySelector('[data-view=fullscreen]').click()");
        await Task.Delay(250);
        Assert(window.WindowState == WindowState.Maximized && ((RowDefinition)window.FindName("TitleRow")).Height.Value == 0, "fullscreen hides shell and maximizes native window");
        Assert(((ColumnDefinition)window.FindName("OutlineColumn")).Width.Value == 0 && ((ColumnDefinition)window.FindName("LibraryColumn")).Width.Value == 0, "fullscreen keeps both sidebars hidden during window resize");
        await Script("document.querySelector('[data-view=fullscreen]').click()");
        await Task.Delay(250);
        Assert(((RowDefinition)window.FindName("TitleRow")).Height.Value == 54, "fullscreen restores reader shell");
        Assert(((ColumnDefinition)window.FindName("OutlineColumn")).Width.Value > 0, "fullscreen restores outline preference");
        await Script("document.querySelector('[data-view=window]').click()");
        var deadline = Stopwatch.StartNew();
        while (Application.Current.Windows.Count < 2 && deadline.ElapsedMilliseconds < 15000) await Task.Delay(50);
        var diagram = Application.Current.Windows.Cast<Window>().Single(w => w != window);
        Assert(diagram.Icon is not null, "separate diagram window inherits application icon");
        var diagramReader = (WebReader)diagram.Content;
        await diagramReader.PrepareAsync();
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if (await diagramReader.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('#viewer[open] svg text')") == "true") break;
            await Task.Delay(100);
        }
        Assert(await diagramReader.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('#viewer[open] svg text')") == "true", "separate native diagram window renders labels");
        Assert(await diagramReader.CoreWebView2.ExecuteScriptAsync("window.mica.diagnostics().diagramEngine === 'isolated'") == "true", "separate window uses isolated engine without silently falling back");
        diagram.Close();
        await Script("document.querySelector('[data-view=close]').click()");
        reader.SetDiagramEngine(false);
        Field("currentConversationId").SetValue(window, null);
        Field("currentPath").SetValue(window, Path.Combine(AppContext.BaseDirectory, "fixture.md"));
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "fixture.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"16\" height=\"16\" fill=\"green\"/></svg>");
        await Load("# 图片\n\n![本地](fixture.svg)\n\n![越界](../outside.svg)", "image-fixture", true);
        await Until("document.querySelector('img[alt=本地]')?.naturalWidth === 16");
        await Until("document.querySelectorAll('#article img')[1]?.complete");
        Assert(await Boolean("document.querySelectorAll('#article img')[1].naturalWidth === 0"), "relative image loads but parent-directory image is blocked");
        await Load("# 文档\n\n正文。", "edit-fixture", true);
        Invoke("SetMode", "edit");
        await Until("!!window.mica.editorView()");
        Assert(((ColumnDefinition)window.FindName("EditorColumn")).Width.Value == 0, "default editing is not the source textbox");
        await Script("window.mica.editorView().dispatch({changes:{from:window.mica.editorView().state.doc.length,insert:'\\n\\n## 修改后的标题\\n\\n新内容。'}})");
        Invoke("SetMode", "read");
        await Until("document.querySelector('#article h2')?.textContent === '修改后的标题'");
        Assert(((System.Collections.IDictionary)Field("drafts").GetValue(window)!).Count == 1, "editing preserves an unsaved draft");
        Invoke("SetMode", "edit");
        await Until("!!window.mica.editorView()");
        await Script("window.mica.editorView().dispatch({changes:{from:window.mica.editorView().state.doc.length,insert:'最后一个字'}})");
        Invoke("Save_Click",window,new RoutedEventArgs());
        var savedPath=(string)Field("currentPath").GetValue(window)!;
        for(var i=0;i<100;i++){if(File.Exists(savedPath)&&(await File.ReadAllTextAsync(savedPath)).EndsWith("最后一个字"))break;await Task.Delay(30);}
        Assert((await File.ReadAllTextAsync(savedPath)).EndsWith("最后一个字"),"save captures the latest live edit, not a stale textbox");
        await Script("window.mica.editorView().dispatch({changes:{from:0,insert:'临时草稿\\n'}})");
        await (Task)Invoke("OpenDocumentAsync",startupPath)!;
        var savedDrafts=(System.Collections.Generic.Dictionary<string,string>)Field("drafts").GetValue(window)!;
        Assert(savedDrafts[savedPath].StartsWith("临时草稿"),"opening another file flushes the last live change into its own draft");
        var longText = string.Concat(Enumerable.Range(0, 1800).Select(i => $"## 第 {i} 节\n\n正文包含 **重点**，用于测试长文阅读。\n\n```java\nint value = {i};\n```\n\n"));
        var watch = Stopwatch.StartNew();
        await Load(longText, "long-fixture", true);
        Console.WriteLine($"Native long document {longText.Length} characters: {watch.ElapsedMilliseconds} ms end-to-end; {reader.LastMetrics}");
        await Script("scrollTo(0,5000)");
        await Until("scrollY > 4000");
        var pending = Load(longText + "extra", "old-fixture", true);
        await Load("# 最新文档", "latest-fixture", true);
        await pending;
        await Until("document.querySelector('#article h1')?.textContent === '最新文档'");
        Assert((string?)Field("currentCacheKey").GetValue(window) == "latest-fixture", "cancelled request cannot replace current document");
        await using var screenshot = File.Create(Path.Combine(AppContext.BaseDirectory, "native-reader.png"));
        await reader.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
    }
    private static FieldInfo Field(string name) => typeof(MainWindow).GetField(name, Private)!;
    private static object? Invoke(string name, params object[] args) => typeof(MainWindow).GetMethod(name, Private)!.Invoke(window, args);
    private static Task Load(string text, string key, bool editable) => (Task)Invoke("LoadText", text, key, editable, key)!;
    private static async Task<string> Script(string code) => await reader.CoreWebView2.ExecuteScriptAsync(code);
    private static async Task<bool> Boolean(string code) => await Script(code) == "true";
    private static async Task Until(string code)
    {
        var watch = Stopwatch.StartNew();
        while (!await Boolean(code)) { if (watch.ElapsedMilliseconds > 20000) throw new Exception("Timeout: " + code); await Task.Delay(40); }
    }
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); Console.WriteLine("PASS " + message); }
}
