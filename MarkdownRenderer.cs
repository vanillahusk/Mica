using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace LightSession.Desktop;

internal static partial class MarkdownRenderer
{
    private static readonly Brush Text = Brush("#E6E6E6");
    private static readonly Brush Muted = Brush("#A5A5A5");
    private static readonly Brush Accent = Brush("#9B93FF");
    private static readonly Brush CodeText = Brush("#D7D7D7");

    public static FlowDocument Render(string markdown)
    {
        var document = new FlowDocument
        {
            Background = Brushes.Transparent,
            Foreground = Text,
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 16,
            LineHeight = 27,
            PagePadding = new Thickness(54, 42, 54, 90),
            ColumnWidth = 900,
        };

        var lines = markdown.Replace("\r\n", "\n").Split('\n');
        for (var index = 0; index < lines.Length;)
        {
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
                document.Blocks.Add(new BlockUIContainer(new Border { Height = 1, Background = Brush("#383838"), Margin = new Thickness(0, 18, 0, 18) }));
                index++;
                continue;
            }
            var heading = HeadingRegex().Match(line);
            if (heading.Success)
            {
                var level = heading.Groups[1].Value.Length;
                var paragraph = Paragraph(heading.Groups[2].Value, level == 1 ? 30 : level == 2 ? 24 : 20);
                paragraph.FontWeight = FontWeights.SemiBold;
                paragraph.Margin = new Thickness(0, level == 1 ? 16 : 24, 0, 10);
                document.Blocks.Add(paragraph);
                index++;
                continue;
            }
            if (line.StartsWith("> [!QUESTION]", StringComparison.OrdinalIgnoreCase))
            {
                var content = new List<string>();
                for (index++; index < lines.Length && lines[index].StartsWith('>'); index++) content.Add(lines[index].TrimStart('>', ' '));
                document.Blocks.Add(Callout(string.Join("\n", content)));
                continue;
            }
            if (line.StartsWith('>'))
            {
                var content = new List<string>();
                for (; index < lines.Length && lines[index].StartsWith('>'); index++) content.Add(lines[index].TrimStart('>', ' '));
                var quote = Paragraph(string.Join(" ", content), 16);
                quote.Foreground = Muted;
                quote.BorderBrush = Accent;
                quote.BorderThickness = new Thickness(3, 0, 0, 0);
                quote.Padding = new Thickness(16, 5, 10, 5);
                document.Blocks.Add(quote);
                continue;
            }
            if (ListRegex().IsMatch(line))
            {
                var list = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(20, 5, 0, 12) };
                for (; index < lines.Length; index++)
                {
                    var match = ListRegex().Match(lines[index]);
                    if (!match.Success) break;
                    var paragraph = new Paragraph();
                    AddInlineMarkdown(paragraph, match.Groups[1].Value);
                    list.ListItems.Add(new ListItem(paragraph));
                }
                document.Blocks.Add(list);
                continue;
            }

            var paragraphLines = new List<string> { line };
            for (index++; index < lines.Length && !string.IsNullOrWhiteSpace(lines[index]) && !IsBlockStart(lines[index]); index++)
                paragraphLines.Add(lines[index]);
            document.Blocks.Add(Paragraph(string.Join(" ", paragraphLines), 16));
        }
        return document;
    }

    private static bool IsBlockStart(string line) => line.StartsWith('#') || line.StartsWith('>') || line.StartsWith("```") || ListRegex().IsMatch(line);

    private static Paragraph Paragraph(string text, double size)
    {
        var paragraph = new Paragraph { FontSize = size, Margin = new Thickness(0, 4, 0, 12) };
        AddInlineMarkdown(paragraph, text);
        return paragraph;
    }

    private static void AddInlineMarkdown(Paragraph paragraph, string text)
    {
        var matches = InlineRegex().Matches(text);
        var position = 0;
        foreach (Match match in matches)
        {
            if (match.Index > position) paragraph.Inlines.Add(text[position..match.Index]);
            if (match.Groups[1].Success)
                paragraph.Inlines.Add(new Run(match.Groups[1].Value) { FontFamily = new FontFamily("Cascadia Mono, Consolas"), Background = Brush("#303030"), Foreground = Brush("#E7B86B") });
            else if (match.Groups[2].Success)
                paragraph.Inlines.Add(new Bold(new Run(match.Groups[2].Value)));
            else if (match.Groups[3].Success)
                paragraph.Inlines.Add(new Italic(new Run(match.Groups[3].Value)));
            else if (match.Groups[4].Success)
            {
                var link = new Hyperlink(new Run(match.Groups[4].Value)) { Foreground = Accent, NavigateUri = Uri.TryCreate(match.Groups[5].Value, UriKind.Absolute, out var uri) ? uri : null };
                link.RequestNavigate += (_, args) => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(args.Uri.AbsoluteUri) { UseShellExecute = true });
                paragraph.Inlines.Add(link);
            }
            position = match.Index + match.Length;
        }
        if (position < text.Length) paragraph.Inlines.Add(text[position..]);
    }

    private static BlockUIContainer CodeBlock(string code, string language)
    {
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var header = new Grid { Background = Brush("#292929"), Height = 38 };
        header.ColumnDefinitions.Add(new ColumnDefinition());
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(language) ? "代码" : language, Foreground = Muted, Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
        var copy = new Button { Content = "复制", Padding = new Thickness(10, 3, 10, 3), Margin = new Thickness(4), FontSize = 12 };
        copy.Click += (_, _) => Clipboard.SetText(code);
        Grid.SetColumn(copy, 1);
        header.Children.Add(copy);
        grid.Children.Add(header);
        var codeBox = new TextBox
        {
            Text = code,
            IsReadOnly = true,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            FontFamily = new FontFamily("Cascadia Code, Cascadia Mono, Consolas"),
            FontSize = 14,
            Foreground = CodeText,
            Background = Brush("#141414"),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(18, 15, 18, 17),
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
        };
        Grid.SetRow(codeBox, 1);
        grid.Children.Add(codeBox);
        return new BlockUIContainer(new Border { Child = grid, BorderBrush = Brush("#3A3A3A"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), ClipToBounds = true, Margin = new Thickness(0, 10, 0, 16) });
    }

    private static BlockUIContainer Callout(string content)
    {
        var panel = new StackPanel();
        panel.Children.Add(new TextBlock { Text = "你", Foreground = Accent, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 8) });
        panel.Children.Add(new TextBlock { Text = content, Foreground = Text, TextWrapping = TextWrapping.Wrap, FontSize = 16, LineHeight = 26 });
        return new BlockUIContainer(new Border { Child = panel, Background = Brush("#292938"), BorderBrush = Accent, BorderThickness = new Thickness(4, 0, 0, 0), CornerRadius = new CornerRadius(7), Padding = new Thickness(20, 16, 20, 17), Margin = new Thickness(0, 8, 0, 25) });
    }

    private static SolidColorBrush Brush(string color) => new((Color)ColorConverter.ConvertFromString(color));

    [GeneratedRegex("^(#{1,6})\\s+(.+)$")]
    private static partial Regex HeadingRegex();
    [GeneratedRegex("^\\s*(?:[-*+] |\\d+\\. )(.+)$")]
    private static partial Regex ListRegex();
    [GeneratedRegex("`([^`]+)`|\\*\\*([^*]+)\\*\\*|(?<!\\*)\\*([^*]+)\\*|\\[([^]]+)\\]\\(([^)]+)\\)")]
    private static partial Regex InlineRegex();
}
