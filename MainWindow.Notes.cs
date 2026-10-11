using Microsoft.Win32;
using System.IO;
using System.Windows;
using System.Windows.Controls;

namespace LightSession.Desktop;

public partial class MainWindow
{
    private readonly ReadingNoteStore noteStore = new();
    private readonly Dictionary<string, ReadingNote> noteDrafts = [];
    private List<ReadingNote> savedNotes = [];
    private HashSet<string> missingNotes = [];
    private ReadingNote? selectedNote;
    private string notesDocument = "";
    private bool notesVisible, changingNotes, notesReady, savingNote;

    private void InitializeNotes()
    {
        Preview.AnnotationRequested += AnnotationRequested;
        Preview.AnnotationStateChanged += (_, missing) =>
        {
            missingNotes = missing.ToHashSet();
            if (selectedNote is not null && !noteDrafts.ContainsKey(selectedNote.Id)) UpdateNoteStatus();
        };
    }
    private void ResetNotesDocument()
    {
        notesDocument = ReadingNoteStore.DocumentKey(currentPath, currentConversationId);
        notesReady = false; selectedNote = null; savedNotes = []; missingNotes.Clear();
        changingNotes = true; NoteList.ItemsSource = null; NoteFilter.Clear(); changingNotes = false;
        NoteEditorPanel.Visibility = Visibility.Collapsed; NotesEmpty.Visibility = Visibility.Visible;
        NoteCollection.Visibility = NoteSearchArea.Visibility = Visibility.Visible;
        NoteStatus.Text = "正在加载笔记…";
    }
    private async Task LoadNotesAsync(CancellationToken cancellation)
    {
        var document = notesDocument;
        try
        {
            var notes = await noteStore.LoadAsync(document);
            if (document != notesDocument || cancellation.IsCancellationRequested) return;
            savedNotes = notes; notesReady = true; RefreshNotes();
            NoteStatus.Text = "独立保存，不改原文";
            Preview.ShowAnnotations(CurrentNotes());
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            if (document == notesDocument) NoteStatus.Text = "笔记读取失败（未覆盖原笔记）：" + error.Message;
        }
    }
    private List<ReadingNote> CurrentNotes() => savedNotes.Where(note => !noteDrafts.ContainsKey(note.Id))
        .Concat(noteDrafts.Values.Where(note => note.Document == notesDocument)).OrderBy(note => note.Created).ToList();

    private void RefreshNotes()
    {
        if (NoteList is null) return;
        var query = NoteFilter.Text.Trim().TrimStart('#');
        var notes = CurrentNotes().Where(note => query.Length == 0 || note.Anchor.Quote.Contains(query, StringComparison.OrdinalIgnoreCase)
            || note.Text.Contains(query, StringComparison.OrdinalIgnoreCase) || note.Tags.Any(tag => tag.Contains(query, StringComparison.OrdinalIgnoreCase))).ToList();
        changingNotes = true;
        NoteList.ItemsSource = notes; NoteList.SelectedItem = notes.FirstOrDefault(note => note.Id == selectedNote?.Id);
        changingNotes = false;
        NotesEmpty.Text = query.Length > 0 ? "没有匹配的笔记或标签" : "选中文字，记下你的想法。\n也可以新建一条全文笔记。";
        NotesEmpty.Visibility = notes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        NotesToggle.Content = CurrentNotes().Count == 0 ? "笔记" : $"笔记 {CurrentNotes().Count}";
    }
    private void ShowNote(ReadingNote note, bool navigate = false)
    {
        selectedNote = noteDrafts.GetValueOrDefault(note.Id) ?? note;
        changingNotes = true;
        NoteQuote.Text = note.Anchor.Quote.Length > 0 ? note.Anchor.Quote : "全文笔记 · 不绑定某一段文字";
        NoteTags.Text = string.Join(" ", selectedNote.Tags.Select(tag => "#" + tag)); NoteText.Text = selectedNote.Text;
        NoteEditorPanel.Visibility = Visibility.Visible;
        NoteCollection.Visibility = NoteSearchArea.Visibility = Visibility.Collapsed;
        NoteTextHint.Visibility = string.IsNullOrEmpty(NoteText.Text) ? Visibility.Visible : Visibility.Collapsed;
        changingNotes = false; UpdateNoteStatus();
        if (navigate && note.Anchor.Quote.Length > 0 && currentMode != "edit") Preview.NavigateToAnnotation(note.Id);
    }
    private void UpdateNoteStatus()
    {
        var dirty = selectedNote is not null && noteDrafts.ContainsKey(selectedNote.Id);
        SaveNoteButton.IsEnabled = dirty && !savingNote;
        NoteStatus.Text = dirty ? "未保存 · 点击保存笔记" : selectedNote is not null && missingNotes.Contains(selectedNote.Id)
            ? "原文已变化，暂无法定位；摘录与笔记仍保留" : "已保存到本机 · 不改原文";
    }
    private void ToggleNotes_Click(object sender, RoutedEventArgs e)
    {
        notesVisible = !notesVisible; UpdateOutlineVisibility();
    }
    private void NoteFilter_Changed(object sender, TextChangedEventArgs e)
    {
        if (NoteSearchHint is not null) NoteSearchHint.Visibility = string.IsNullOrEmpty(NoteFilter.Text) ? Visibility.Visible : Visibility.Collapsed;
        if (!changingNotes && NoteList is not null) RefreshNotes();
    }
    private void NotesBack_Click(object sender, RoutedEventArgs e)
    {
        NoteEditorPanel.Visibility = Visibility.Collapsed;
        NoteCollection.Visibility = NoteSearchArea.Visibility = Visibility.Visible;
        selectedNote = null; RefreshNotes();
        NoteStatus.Text = noteDrafts.Values.Any(n => n.Document == notesDocument) ? "包含未保存草稿 · 点击卡片继续编辑" : "独立保存，不改原文";
    }
    private void NoteTag_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is Button { Tag: string tag }) { NotesBack_Click(sender, e); NoteFilter.Text = "#" + tag; }
    }
    private void NoteList_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (!changingNotes && NoteList.SelectedItem is ReadingNote note) ShowNote(note, true);
    }
    private void NoteEditor_Changed(object sender, TextChangedEventArgs e)
    {
        if (NoteTextHint is not null) NoteTextHint.Visibility = string.IsNullOrEmpty(NoteText.Text) ? Visibility.Visible : Visibility.Collapsed;
        if (changingNotes || selectedNote is null || savingNote) return;
        selectedNote = selectedNote with { Text = NoteText.Text, Tags = ReadingNoteStore.ParseTags(NoteTags.Text) };
        noteDrafts[selectedNote.Id] = selectedNote;
        UpdateNoteStatus();
    }
    private ReadingNote CreateNote(NoteAnchor anchor)
    {
        var note = new ReadingNote(Guid.NewGuid().ToString("N"), notesDocument, anchor, "", [], DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        noteDrafts[note.Id] = note;
        return note;
    }
    private void NewNote_Click(object sender, RoutedEventArgs e)
    {
        if (!notesReady || savingNote) return;
        var note = CreateNote(new()); ShowNote(note); RefreshNotes(); NoteText.Focus();
    }
    private async void AnnotationRequested(object? sender, AnnotationRequest request)
    {
        if (!notesReady || rendering || savingNote) return;
        if (request.Action == "open")
        {
            var existing = CurrentNotes().FirstOrDefault(note => note.Id == request.NoteId);
            if (existing is null) return;
            notesVisible = true; UpdateOutlineVisibility(); ShowNote(existing); RefreshNotes(); return;
        }
        if (request.Anchor is null) return;
        var note = CurrentNotes().FirstOrDefault(n => n.Anchor == request.Anchor) ?? CreateNote(request.Anchor);
        ShowNote(note); RefreshNotes(); Preview.ShowAnnotations(CurrentNotes());
        if (request.Action == "highlight")
        {
            await SaveSelectedNoteAsync();
            StatusText.Text = noteDrafts.ContainsKey(note.Id) ? "高亮未保存，请在笔记栏重试" : "已保存高亮 · 点击高亮可添加笔记";
        }
        else
        {
            notesVisible = true; UpdateOutlineVisibility();
            if (request.Action == "tag") NoteTags.Focus(); else NoteText.Focus();
        }
    }
    private async Task SaveSelectedNoteAsync()
    {
        if (selectedNote is null || savingNote || !noteDrafts.TryGetValue(selectedNote.Id, out var note)) return;
        savingNote = true; NoteEditorPanel.IsEnabled = false;
        try
        {
            var saved = await noteStore.SaveAsync(note);
            if (noteDrafts.GetValueOrDefault(note.Id) == note) noteDrafts.Remove(note.Id);
            if (notesDocument != saved.Document) return;
            savedNotes.RemoveAll(n => n.Id == note.Id); savedNotes.Add(saved);
            if (selectedNote?.Id == note.Id) ShowNote(saved);
            RefreshNotes(); Preview.ShowAnnotations(CurrentNotes());
        }
        catch (Exception error) { NoteStatus.Text = "保存失败，草稿已保留：" + error.Message; }
        finally { savingNote = false; NoteEditorPanel.IsEnabled = true; SaveNoteButton.IsEnabled = selectedNote is not null && noteDrafts.ContainsKey(selectedNote.Id); }
    }
    private async void SaveNote_Click(object sender, RoutedEventArgs e) => await SaveSelectedNoteAsync();
    private async void DeleteNote_Click(object sender, RoutedEventArgs e)
    {
        var note = selectedNote;
        if (note is null || savingNote) return;
        if (MessageBox.Show(this, "删除这条摘录及笔记？原文不会改变。", "删除笔记", MessageBoxButton.YesNo,
            MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        savingNote = true; NoteEditorPanel.IsEnabled = false;
        try
        {
            if (note.Revision > 0) await noteStore.SaveAsync(note with { Deleted = true });
            noteDrafts.Remove(note.Id);
            if (notesDocument != note.Document) return;
            savedNotes.RemoveAll(n => n.Id == note.Id); selectedNote = null;
            NotesBack_Click(this, new RoutedEventArgs()); Preview.ShowAnnotations(CurrentNotes());
            NoteStatus.Text = "已删除笔记 · 原文未改变";
        }
        catch (Exception error) { NoteStatus.Text = "删除失败：" + error.Message; }
        finally { savingNote = false; NoteEditorPanel.IsEnabled = true; }
    }
    private async void LocateNote_Click(object sender, RoutedEventArgs e)
    {
        if (selectedNote is null) return;
        try { if (currentMode == "edit") await SetModeAsync("read"); }
        catch (Exception error) { StatusText.Text = error.Message; return; }
        Preview.NavigateToAnnotation(selectedNote.Id);
    }
    private async void ExportNotes_Click(object sender, RoutedEventArgs e)
    {
        var notes = CurrentNotes(); if (notes.Count == 0) { NoteStatus.Text = "还没有可导出的笔记"; return; }
        var title = DocumentTitle.Text.TrimEnd(' ', '•');
        var dialog = new SaveFileDialog { Title = "导出本篇阅读笔记（包含当前草稿）", Filter = "Markdown|*.md", FileName = "阅读笔记.md" };
        if (dialog.ShowDialog(this) != true) return;
        if (currentPath is not null && Path.GetFullPath(dialog.FileName).Equals(Path.GetFullPath(currentPath), StringComparison.OrdinalIgnoreCase))
        { MessageBox.Show(this, "请另选文件名，避免覆盖正在阅读的原文。", "导出笔记"); return; }
        try { await File.WriteAllTextAsync(dialog.FileName, ReadingNoteStore.Export(title, notes)); NoteStatus.Text = "笔记已导出为 Markdown"; }
        catch (Exception error) { NoteStatus.Text = "导出失败：" + error.Message; }
    }
    private async void SaveCopy_Click(object sender, RoutedEventArgs e)
    {
        MorePopup.IsOpen = false;
        try { await CaptureLiveEditAsync(); }
        catch (Exception error) { StatusText.Text = error.Message; return; }
        var text = currentText;
        var dialog = new SaveFileDialog { Title = "另存为可编辑的 Markdown", Filter = "Markdown|*.md", FileName = "文档副本.md" };
        if (dialog.ShowDialog(this) != true) return;
        try { await File.WriteAllTextAsync(dialog.FileName, text); await OpenDocumentAsync(dialog.FileName); }
        catch (Exception error) { MessageBox.Show(this, error.Message, "另存失败"); }
    }
}
