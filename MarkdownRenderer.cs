using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Threading;

namespace LightSession.Desktop;

internal sealed record MarkdownOutlineItem(string Title, int Level, Block Target, int Turn = 0)
{
    public string DisplayTitle => Turn > 0 ? $"{Turn:00}   {Title}" : $"{new string('　', Math.Max(0, Level - 1))}{Title}";
    public override string ToString() => DisplayTitle;
}

internal sealed record MarkdownRenderResult(FlowDocument Document, IReadOnlyList<MarkdownOutlineItem> Outline);

internal static partial class MarkdownRenderer
{
    private static readonly Brush Text = Brush("#DDD8CE");
    private static readonly Brush Strong = Brush("#EEE9DF");
    private static readonly Brush Muted = Brush("#A49F94");
    private static readonly Brush Accent = Brush("#C9B38D");
    private static readonly FontFamily ReadingFont = new("Microsoft YaHei UI, Segoe UI");
    private static readonly FontFamily MonoFont = new("Cascadia Code, Cascadia Mono, Consolas");

    public static FlowDocument Render(string markdown) => RenderWithOutline(markdown).Document;

    public static MarkdownRenderResult RenderWithOutline(string markdown, bool conversation = false)
        => RenderCoreAsync(markdown, conversation, false, CancellationToken.None).GetAwaiter().GetResult();

    public static Task<MarkdownRenderResult> RenderWithOutlineAsync(string markdown, bool conversation, CancellationToken cancellation)
        => RenderCoreAsync(markdown, conversation, true, cancellation);

    private static async Task<MarkdownRenderResult> RenderCoreAsync(string markdown, bool conversation, bool cooperative, CancellationToken cancellation)
    {
        var budget = Stopwatch.StartNew();
        var outline = new List<MarkdownOutlineItem>();
        var turn = 0;
        var document = new FlowDocument
        {
            Background = Brushes.Transparent,
            Foreground = Text,
            FontFamily = ReadingFont,
            FontSize = 15.5,
            LineHeight = 28,
            PagePadding = new Thickness(30, 44, 30, 100),
            ColumnWidth = double.PositiveInfinity,
            TextAlignment = TextAlignment.Left,
        };

        var lines = markdown.Replace("\r\n", "\n").Split('\n');
        for (var index = 0; index < lines.Length;)
        {
            cancellation.ThrowIfCancellationRequested();
            if (cooperative && budget.ElapsedMilliseconds >= 12)
            {
                await Dispatcher.Yield(DispatcherPriority.Background);
                cancellation.ThrowIfCancellationRequested();
                budget.Restart();
            }
            var line = lines[index];
            if (line.StartsWith("```"))
            {
                var language = line[3..].Trim();
                var code = new List<string>();
                for (index++; index < lines.Length && !lines[index].StartsWith("```"); index++) code.Add(lines[index]);
                if (index < lines.Length) index++;
                document.Blocks.Add(CodeBlock(string.Join(Environment.NewLine, code), language));
                continue;
            }
            if (string.IsNullOrWhiteSpace(line)) { index++; continue; }
            if (line.Trim() is "---" or "***")
            {
                document.Blocks.Add(new BlockUIContainer(new Border { Height = 1, Background = Brush("#2C3038"), Margin = new Thickness(0, 22, 0, 22) }));
                index++;
                continue;
            }
            if (index + 1 < lines.Length && TableSeparatorRegex().IsMatch(lines[index + 1]) && line.Contains('|'))
            {
                document.Blocks.Add(TableBlock(lines, ref index));
                continue;
            }
            var heading = HeadingRegex().Match(line);
            if (heading.Success)
            {
                var title = heading.Groups[2].Value;
                var level = heading.Groups[1].Value.Length;
                var block = Heading(title, level);
                document.Blocks.Add(block);
                if (!conversation && level <= 3 && !title.Equals("ChatGPT", StringComparison.OrdinalIgnoreCase))
                    outline.Add(new MarkdownOutlineItem(PlainText(title), level, block));
                index++;
                continue;
            }
            if (line.StartsWith("> [!QUESTION]", StringComparison.OrdinalIgnoreCase))
            {
                var content = new List<string>();
                for (index++; index < lines.Length && lines[index].StartsWith('>'); index++) content.Add(lines[index].TrimStart('>', ' '));
                var question = string.Join("\n", content);
                var block = QuestionCard(question, ++turn);
                document.Blocks.Add(block);
                outline.Add(new MarkdownOutlineItem(Regex.Replace(question, "\\s+", " ").Trim(), 1, block, turn));
                continue;
            }
            if (line.StartsWith('>'))
            {
                var content = new List<string>();
                for (; index < lines.Length && lines[index].StartsWith('>'); index++) content.Add(lines[index].TrimStart('>', ' '));
                var quote = Paragraph(string.Join(" ", content));
                quote.Foreground = Muted;
                quote.Background = Brush("#2B2925");
                quote.BorderBrush = Brush("#968161");
                quote.BorderThickness = new Thickness(3, 0, 0, 0);
                quote.Padding = new Thickness(18, 12, 16, 12);
                quote.Margin = new Thickness(0, 8, 0, 20);
                document.Blocks.Add(quote);
                continue;
            }
            var listMatch = ListRegex().Match(line);
            if (listMatch.Success)
            {
                var ordered = listMatch.Groups[1].Success;
                var list = new List
                {
                    MarkerStyle = ordered ? TextMarkerStyle.Decimal : TextMarkerStyle.Disc,
                    MarkerOffset = 8,
                    Padding = new Thickness(8, 0, 0, 0),
                    Margin = new Thickness(18, 5, 0, 18),
                };
                for (; index < lines.Length; index++)
                {
                    var match = ListRegex().Match(lines[index]);
                    if (!match.Success || match.Groups[1].Success != ordered) break;
                    var value = match.Groups[2].Value;
                    var task = TaskRegex().Match(value);
                    var paragraph = new Paragraph { Margin = new Thickness(0, 2, 0, 5), LineHeight = 27 };
                    if (task.Success)
                    {
                        paragraph.Inlines.Add(new Run(task.Groups[1].Value.Equals("x", StringComparison.OrdinalIgnoreCase) ? "☑  " : "☐  ") { Foreground = Accent });
                        value = task.Groups[2].Value;
                    }
                    AddInlineMarkdown(paragraph.Inlines, value);
                    list.ListItems.Add(new ListItem(paragraph));
                }
                document.Blocks.Add(list);
                continue;
            }

            var paragraphLines = new List<string> { line };
            for (index++; index < lines.Length && !string.IsNullOrWhiteSpace(lines[index]) && !IsBlockStart(lines, index); index++)
                paragraphLines.Add(lines[index]);
            document.Blocks.Add(Paragraph(string.Join(" ", paragraphLines)));
        }
        return new MarkdownRenderResult(document, outline);
    }

    private static Paragraph Heading(string text, int level)
    {
        var sizes = new[] { 29d, 23d, 19d, 16d, 15d, 14d };
        var paragraph = new Paragraph
        {
            FontSize = sizes[Math.Clamp(level - 1, 0, sizes.Length - 1)],
            FontWeight = level <= 3 ? FontWeights.SemiBold : FontWeights.Medium,
            Foreground = Strong,
            LineHeight = level == 1 ? 44 : double.NaN,
            Margin = new Thickness(0, level == 1 ? 6 : 28, 0, level == 1 ? 24 : 12),
            KeepWithNext = true,
        };
        AddInlineMarkdown(paragraph.Inlines, text);
        if (text == "ChatGPT")
        {
            paragraph.FontSize = 11;
            paragraph.Foreground = Muted;
            paragraph.Margin = new Thickness(0, 6, 0, 16);
        }
        if (level == 1)
        {
            paragraph.Padding = new Thickness(0, 0, 0, 10);
        }
        return paragraph;
    }

    private static Paragraph Paragraph(string text)
    {
        var paragraph = new Paragraph
        {
            FontSize = 15.5,
            LineHeight = 28,
            Margin = new Thickness(0, 0, 0, 16),
            Foreground = Text,
        };
        AddInlineMarkdown(paragraph.Inlines, text);
        return paragraph;
    }

    private static void AddInlineMarkdown(InlineCollection inlines, string text)
    {
        var matches = InlineRegex().Matches(text);
        var position = 0;
        foreach (Match match in matches)
        {
            if (match.Index > position) inlines.Add(new Run(text[position..match.Index]));
            if (match.Groups[1].Success)
                inlines.Add(new Run(match.Groups[1].Value) { FontFamily = MonoFont, FontSize = 14, Background = Brush("#242730"), Foreground = Brush("#E7B978") });
            else if (match.Groups[2].Success)
                inlines.Add(new Bold(new Run(match.Groups[2].Value) { Foreground = Strong }));
            else if (match.Groups[3].Success)
                inlines.Add(new Italic(new Run(match.Groups[3].Value)) { Foreground = Brush("#C6C9D2") });
            else if (match.Groups[4].Success)
                inlines.Add(new Run(match.Groups[4].Value) { TextDecorations = TextDecorations.Strikethrough, Foreground = Muted });
            else if (match.Groups[5].Success)
            {
                var link = new Hyperlink(new Run(match.Groups[5].Value)) { Foreground = Accent, TextDecorations = TextDecorations.Underline };
                if (Uri.TryCreate(match.Groups[6].Value, UriKind.Absolute, out var uri))
                {
                    link.NavigateUri = uri;
                    link.RequestNavigate += (_, args) => Process.Start(new ProcessStartInfo(args.Uri.AbsoluteUri) { UseShellExecute = true });
                }
                inlines.Add(link);
            }
            position = match.Index + match.Length;
        }
        if (position < text.Length) inlines.Add(new Run(text[position..]));
    }

    private static BlockUIContainer CodeBlock(string code, string language)
    {
        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var header = new Grid { Background = Brush("#2C2B28"), Height = 34 };
        header.ColumnDefinitions.Add(new ColumnDefinition());
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(new TextBlock
        {
            Text = string.IsNullOrWhiteSpace(language) ? "CODE" : language.ToUpperInvariant(),
            Foreground = Brush("#777E8D"), FontFamily = MonoFont, FontSize = 11, FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(15, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center,
        });
        var copy = new Button { Content = "复制代码", Padding = new Thickness(10, 3, 10, 3), Margin = new Thickness(5), FontSize = 11 };
        copy.Click += async (_, _) =>
        {
            try { Clipboard.SetText(code); copy.Content = "已复制"; }
            catch (System.Runtime.InteropServices.COMException) { copy.Content = "请重试"; }
            await Task.Delay(1400);
            copy.Content = "复制代码";
        };
        Grid.SetColumn(copy, 1);
        header.Children.Add(copy);
        root.Children.Add(header);

        var codeText = new TextBlock
        {
            FontFamily = MonoFont, FontSize = 13.5, Foreground = Brush("#D7DAE0"),
            Background = Brushes.Transparent, Padding = new Thickness(17, 15, 17, 17),
            LineHeight = 23, TextWrapping = TextWrapping.NoWrap,
        };
        if (language.Equals("text", StringComparison.OrdinalIgnoreCase) ||
            language.Equals("plaintext", StringComparison.OrdinalIgnoreCase))
            codeText.Inlines.Add(new Run(code));
        else AddHighlightedCode(codeText.Inlines, code);
        var codeScroll = new ScrollViewer
        {
            Content = codeText, Background = Brush("#1C1D1C"),
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        Grid.SetRow(codeScroll, 1);
        root.Children.Add(codeScroll);
        return new BlockUIContainer(new Border
        {
            Child = root, Background = Brush("#1C1D1C"), BorderBrush = Brush("#393730"), BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(5), ClipToBounds = true, Margin = new Thickness(0, 8, 0, 22),
        });
    }

    private static void AddHighlightedCode(InlineCollection inlines, string code)
    {
        var matches = CodeTokenRegex().Matches(code);
        var position = 0;
        foreach (Match match in matches)
        {
            if (match.Index > position) inlines.Add(new Run(code[position..match.Index]));
            var color = match.Groups["comment"].Success ? "#6A9955"
                : match.Groups["string"].Success ? "#CE9178"
                : match.Groups["keyword"].Success ? "#C586C0"
                : match.Groups["number"].Success ? "#B5CEA8"
                : match.Groups["function"].Success ? "#DCDCAA"
                : "#7CC8FF";
            inlines.Add(new Run(match.Value) { Foreground = Brush(color) });
            position = match.Index + match.Length;
        }
        if (position < code.Length) inlines.Add(new Run(code[position..]));
    }

    private static BlockUIContainer QuestionCard(string content, int turn)
    {
        var panel = new StackPanel();
        panel.Children.Add(new TextBlock { Text = $"提问 {turn:00}", Foreground = Accent, FontWeight = FontWeights.SemiBold, FontSize = 10.5, Margin = new Thickness(0, 0, 0, 10) });
        var text = new TextBlock { Foreground = Strong, TextWrapping = TextWrapping.Wrap, FontFamily = ReadingFont, FontSize = 16.5, LineHeight = 28 };
        text.Inlines.Add(content);
        panel.Children.Add(text);
        return new BlockUIContainer(new Border
        {
            Child = panel, Background = Brush("#2E2B25"), BorderBrush = Brush("#A18A63"), BorderThickness = new Thickness(2, 0, 0, 0),
            CornerRadius = new CornerRadius(3), Padding = new Thickness(20, 17, 20, 19), Margin = new Thickness(0, 20, 0, 24),
        });
    }

    private static Table TableBlock(string[] lines, ref int index)
    {
        var headers = SplitTableRow(lines[index]);
        index += 2;
        var rows = new List<string[]>();
        while (index < lines.Length && lines[index].Contains('|') && !string.IsNullOrWhiteSpace(lines[index])) rows.Add(SplitTableRow(lines[index++]));
        var table = new Table { CellSpacing = 0, Margin = new Thickness(0, 9, 0, 22), BorderBrush = Brush("#343842"), BorderThickness = new Thickness(1) };
        foreach (var _ in headers) table.Columns.Add(new TableColumn());
        var group = new TableRowGroup();
        var headerRow = new TableRow { Background = Brush("#20232A") };
        foreach (var value in headers) headerRow.Cells.Add(TableCell(value, true));
        group.Rows.Add(headerRow);
        foreach (var row in rows)
        {
            var tableRow = new TableRow();
            for (var column = 0; column < headers.Length; column++) tableRow.Cells.Add(TableCell(column < row.Length ? row[column] : "", false));
            group.Rows.Add(tableRow);
        }
        table.RowGroups.Add(group);
        return table;
    }

    private static TableCell TableCell(string value, bool header)
    {
        var paragraph = new Paragraph { Margin = new Thickness(0), FontWeight = header ? FontWeights.SemiBold : FontWeights.Normal, Foreground = header ? Strong : Text };
        AddInlineMarkdown(paragraph.Inlines, value);
        return new TableCell(paragraph) { Padding = new Thickness(12, 9, 12, 9), BorderBrush = Brush("#343842"), BorderThickness = new Thickness(0, 0, 1, 1) };
    }

    private static string[] SplitTableRow(string line) => line.Trim().Trim('|').Split('|').Select(value => value.Trim()).ToArray();
    private static string PlainText(string text) => Regex.Replace(text, "[`*_~\\[\\]()]", "").Trim();
    private static string CompactTitle(string text)
    {
        var compact = Regex.Replace(text, "\\s+", " ").Trim();
        return compact.Length > 42 ? compact[..42] + "…" : compact;
    }
    private static bool IsBlockStart(string[] lines, int index) => lines[index].StartsWith('#') || lines[index].StartsWith('>') || lines[index].StartsWith("```") || ListRegex().IsMatch(lines[index]) || (index + 1 < lines.Length && TableSeparatorRegex().IsMatch(lines[index + 1]));
    private static SolidColorBrush Brush(string color)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
        brush.Freeze();
        return brush;
    }

    [GeneratedRegex("^(#{1,6})\\s+(.+)$")]
    private static partial Regex HeadingRegex();
    [GeneratedRegex("^\\s*(?:(\\d+)\\.|[-*+])\\s+(.+)$")]
    private static partial Regex ListRegex();
    [GeneratedRegex("^\\[([ xX])\\]\\s+(.+)$")]
    private static partial Regex TaskRegex();
    [GeneratedRegex("^\\s*\\|?\\s*:?-{3,}:?\\s*(?:\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$")]
    private static partial Regex TableSeparatorRegex();
    [GeneratedRegex("`([^`]+)`|\\*\\*([^*]+)\\*\\*|(?<!\\*)\\*([^*]+)\\*|~~([^~]+)~~|\\[([^]]+)\\]\\(([^)]+)\\)")]
    private static partial Regex InlineRegex();
    [GeneratedRegex("(?<comment>//.*$|/\\*[\\s\\S]*?\\*/)|(?<string>\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')|(?<keyword>\\b(?:abstract|as|async|await|break|case|catch|class|const|continue|def|default|do|else|enum|export|extends|false|finally|for|foreach|from|function|if|implements|import|in|interface|let|namespace|new|null|override|package|private|protected|public|return|static|struct|switch|this|throw|true|try|type|typeof|using|var|void|while|yield)\\b)|(?<number>\\b\\d+(?:\\.\\d+)?\\b)|(?<function>\\b[A-Za-z_$][\\w$]*(?=\\s*\\())|(?<type>\\b[A-Z][A-Za-z0-9_]*\\b)", RegexOptions.Multiline)]
    private static partial Regex CodeTokenRegex();
}
