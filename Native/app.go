package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Document struct {
	Path         string `json:"path"`
	Title        string `json:"title"`
	Text         string `json:"text"`
	Revision     string `json:"revision"`
	Conversation bool   `json:"conversation"`
	Kind         string `json:"kind"`
	Missing      bool   `json:"missing,omitempty"`
	Category     string `json:"category,omitempty"`
	SyncedAt     string `json:"syncedAt,omitempty"`
	MessageCount int    `json:"messageCount,omitempty"`
	Messages     []Message `json:"messages,omitempty"`
	Sample       bool     `json:"sample,omitempty"`
	Warnings     []ContentWarning `json:"warnings,omitempty"`
}
type ContentWarning struct {
	Kind    string `json:"kind"`
	Message int    `json:"message"`
	Summary string `json:"summary"`
}
type App struct {
	ctx             context.Context
	mu              sync.Mutex
	allowed         map[string]bool
	dirty           bool
	current         string
	preferences     string
	preferenceTimer *time.Timer
}

func newApp() *App { return &App{allowed: map[string]bool{}} }
func (a *App) grantArgs(args []string, base string) {
	for i, p := range args {
		if documentKind(p) != "" {
			if !filepath.IsAbs(p) && base != "" {
				p = filepath.Join(base, p)
			}
			if real, e := a.grant(p); e == nil {
				args[i] = real
			}
		}
	}
}
func dataDir() string {
	if p := os.Getenv("MICA_DATA_DIRECTORY"); p != "" {
		return p
	}
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Mica")
}
func digest(b []byte) string { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
func atomicWrite(path string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".mica-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp, path)
}
func (a *App) grant(path string) (string, error) {
	p, e := filepath.Abs(path)
	if e != nil {
		return "", e
	}
	p = filepath.Clean(p)
	real, e := filepath.EvalSymlinks(p)
	if e != nil {
		return "", e
	}
	a.mu.Lock()
	a.allowed[pathIdentity(real)] = true
	a.mu.Unlock()
	return p, nil
}

// pathIdentity is used only for comparisons and permissions. Keep the absolute
// path selected by the user in Document.Path: EvalSymlinks can expand Windows
// 8.3 names, which otherwise changes a document's public identity between APIs.
func pathIdentity(path string) string {
	p, e := filepath.Abs(path)
	if e != nil {
		p = filepath.Clean(path)
	}
	if real, err := filepath.EvalSymlinks(p); err == nil {
		p = real
	}
	return strings.ToLower(filepath.Clean(p))
}

func (a *App) permitted(path string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.allowed[pathIdentity(path)]
}
func (a *App) open(path string) (*Document, error) {
	p, e := a.grant(path)
	if e != nil {
		return nil, e
	}
	kind := documentKind(p)
	if kind == "" {
		return nil, errors.New("请选择 Markdown、PDF 或常见文本文件")
	}
	info, e := os.Stat(p)
	if e != nil {
		return nil, e
	}
	limit := int64(32 * 1024 * 1024)
	if kind == "pdf" {
		limit = 256 * 1024 * 1024
	}
	if info.IsDir() || info.Size() > limit {
		return nil, errors.New("文件无效或过大（文本上限 32 MB，PDF 上限 256 MB）")
	}
	if kind == "pdf" {
		d := &Document{Path: p, Title: filepath.Base(p), Kind: kind}
		if e = a.remember([]Document{*d}); e != nil {
			return nil, e
		}
		return d, nil
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return nil, e
	}
	a.mu.Lock()
	a.current = p
	a.mu.Unlock()
	text, e := decodeText(b)
	if e != nil {
		return nil, e
	}
	d := &Document{Path: p, Title: filepath.Base(p), Text: text, Revision: digest(b), Kind: kind}
	if e = a.remember([]Document{*d}); e != nil {
		return nil, e
	}
	return d, nil
}
func (a *App) OpenFile() (*Document, error) {
	p, e := wr.OpenFileDialog(a.ctx, wr.OpenDialogOptions{Title: "打开文档", Filters: []wr.FileFilter{{DisplayName: "文档和文本", Pattern: "*.md;*.markdown;*.pdf;*.txt;*.log;*.json;*.jsonl;*.csv;*.tsv;*.yaml;*.yml;*.xml;*.ini;*.cfg;*.toml;*.sql;*.js;*.ts;*.css;*.html;*.py;*.go;*.java;*.c;*.h;*.cpp;*.rs;*.sh"}}})
	if e != nil || p == "" {
		return nil, e
	}
	return a.open(p)
}
func (a *App) OpenFiles() ([]Document, error) {
	paths, e := wr.OpenMultipleFilesDialog(a.ctx, wr.OpenDialogOptions{Title: "打开一个或多个文档", Filters: []wr.FileFilter{{DisplayName: "文档和文本", Pattern: "*.md;*.markdown;*.pdf;*.txt;*.log;*.json;*.jsonl;*.csv;*.tsv;*.yaml;*.yml;*.xml;*.ini;*.cfg;*.toml;*.sql;*.js;*.ts;*.css;*.html;*.py;*.go;*.java;*.c;*.h;*.cpp;*.rs;*.sh"}}})
	if e != nil || len(paths) == 0 {
		return nil, e
	}
	return a.importPaths(paths)
}
func (a *App) OpenKnown(p string) (*Document, error) {
	if !a.permitted(p) {
		return nil, errors.New("请先从打开文件或文件夹选择文档")
	}
	return a.open(p)
}
func (a *App) OpenFolder() ([]Document, error) {
	root, e := wr.OpenDirectoryDialog(a.ctx, wr.OpenDialogOptions{Title: "打开文档文件夹"})
	if e != nil || root == "" {
		return nil, e
	}
	return a.importPaths([]string{root})
}
func (a *App) importPaths(paths []string) ([]Document, error) {
	out := []Document{}
	addFile := func(p, title string) {
		if documentKind(p) == "" || len(out) >= 5000 {
			return
		}
		if real, err := a.grant(p); err == nil {
			out = append(out, Document{Path: real, Title: title, Kind: documentKind(real)})
		}
	}
	for _, input := range paths {
		info, err := os.Stat(input)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			addFile(input, filepath.Base(input))
			continue
		}
		root := input
		err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if len(out) >= 5000 {
				return filepath.SkipAll
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if documentKind(p) != "" {
				title, _ := filepath.Rel(root, p)
				addFile(p, title)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		if len(out) >= 5000 {
			break
		}
	}
	if len(out) == 0 {
		return out, nil
	}
	return out, a.remember(out)
}
func (a *App) Startup() ([]string, error) { return os.Args[1:], nil }
func (a *App) OpenArgument(p string) (*Document, error) {
	// Only process launch arguments, never arbitrary renderer-provided paths.
	for _, arg := range os.Args[1:] {
		if p == arg {
			return a.open(p)
		}
	}
	return nil, errors.New("不是启动文件")
}
func (a *App) Save(path, text, revision string) (*Document, error) {
	if documentKind(path) != "markdown" {
		return nil, errors.New("此格式仅支持阅读，请另存为 Markdown 后编辑")
	}
	if !a.permitted(path) {
		return nil, errors.New("文件未授权")
	}
	if len(text) > 32*1024*1024 {
		return nil, errors.New("文档过大")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	if digest(b) != revision {
		return nil, errors.New("文件已被其他程序修改，请另存为，避免覆盖")
	}
	if e = atomicWrite(path, []byte(text)); e != nil {
		return nil, e
	}
	a.dirty = false
	return &Document{Path: path, Title: filepath.Base(path), Text: text, Revision: digest([]byte(text)), Kind: "markdown"}, nil
}
func (a *App) SaveAs(text string) (*Document, error) {
	p, e := wr.SaveFileDialog(a.ctx, wr.SaveDialogOptions{Title: "另存为 Markdown", DefaultFilename: "未命名.md", Filters: []wr.FileFilter{{DisplayName: "Markdown", Pattern: "*.md"}}})
	if e != nil || p == "" {
		return nil, e
	}
	if e = atomicWrite(p, []byte(text)); e != nil {
		return nil, e
	}
	return a.open(p)
}
func (a *App) Dirty(d bool) { a.mu.Lock(); a.dirty = d; a.mu.Unlock() }
func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	d := a.dirty
	a.mu.Unlock()
	if !d {
		a.flushPreferences()
		return false
	}
	result, _ := wr.MessageDialog(ctx, wr.MessageDialogOptions{Type: wr.WarningDialog, Title: "未保存的修改", Message: "关闭会丢失当前修改。返回后可点击保存。", Buttons: []string{"返回", "放弃并关闭"}, DefaultButton: "返回", CancelButton: "返回"})
	if result == "放弃并关闭" {
		a.flushPreferences()
		return false
	}
	return true
}
func (a *App) Link(raw string) {
	u, e := url.Parse(raw)
	if e == nil && (u.Scheme == "https" || u.Scheme == "http") {
		wr.BrowserOpenURL(a.ctx, raw)
	}
}
func (a *App) Copy(text string) {
	if len(text) <= 8_000_000 {
		wr.ClipboardSetText(a.ctx, text)
	}
}
func (a *App) Fullscreen(on bool) {
	if on {
		wr.WindowFullscreen(a.ctx)
	} else {
		wr.WindowUnfullscreen(a.ctx)
	}
}
func (a *App) Quit() { wr.Quit(a.ctx) }
func (a *App) DiagramWindow(source, theme string) error {
	if len(source) > 100000 {
		return errors.New("图表过大")
	}
	folder := filepath.Join(dataDir(), "diagram-windows")
	if e := os.MkdirAll(folder, 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(folder, "diagram-*.json")
	if e != nil {
		return e
	}
	b, _ := json.Marshal(map[string]string{"source": source, "theme": theme})
	_, e = f.Write(b)
	f.Close()
	if e != nil {
		return e
	}
	ex, e := os.Executable()
	if e != nil {
		return e
	}
	return exec.Command(ex, "--diagram", f.Name()).Start()
}
func (a *App) DiagramArgument() (map[string]string, error) {
	for i, arg := range os.Args {
		if arg == "--diagram" && i+1 < len(os.Args) {
			p := os.Args[i+1]
			root := filepath.Join(dataDir(), "diagram-windows")
			if filepath.Dir(p) != root {
				return nil, errors.New("无效图表参数")
			}
			b, e := os.ReadFile(p)
			if e != nil {
				return nil, e
			}
			var v map[string]string
			e = json.Unmarshal(b, &v)
			if e == nil {
				os.Remove(p)
			}
			return v, e
		}
	}
	return nil, errors.New("没有图表参数")
}
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/local-pdf" {
		p := r.URL.Query().Get("path")
		if !a.permitted(p) || documentKind(p) != "pdf" {
			http.Error(w, "Forbidden", 403)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		http.ServeFile(w, r, p)
		return
	}
	// Relative local images are scoped to the currently opened document folder.
	if !strings.HasPrefix(r.URL.Path, "/local-image/") {
		http.NotFound(w, r)
		return
	}
	a.mu.Lock()
	current := a.current
	a.mu.Unlock()
	if current == "" {
		http.NotFound(w, r)
		return
	}
	root := filepath.Dir(current)
	relative := strings.TrimPrefix(r.URL.Path, "/local-image/")
	p, e := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(relative)))
	if e != nil {
		http.NotFound(w, r)
		return
	}
	rel, e := filepath.Rel(root, p)
	if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		http.Error(w, "Forbidden", 403)
		return
	}
	switch strings.ToLower(filepath.Ext(p)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp":
	default:
		http.Error(w, "Forbidden", 403)
		return
	}
	http.ServeFile(w, r, p)
}
func (a *App) Preferences(raw string) (string, error) {
	p := filepath.Join(dataDir(), "native-preferences.json")
	if raw != "" {
		if len(raw) > 1000000 || !json.Valid([]byte(raw)) {
			return "", errors.New("偏好设置无效")
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		a.preferences = raw
		if a.preferenceTimer != nil {
			a.preferenceTimer.Stop()
		}
		a.preferenceTimer = time.AfterFunc(650*time.Millisecond, a.flushPreferences)
		return raw, nil
	}
	a.mu.Lock()
	pending := a.preferences
	a.mu.Unlock()
	if pending != "" {
		return pending, nil
	}
	b, e := os.ReadFile(p)
	if os.IsNotExist(e) {
		return "{}", nil
	}
	return string(b), e
}
func (a *App) flushPreferences() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.preferenceTimer != nil {
		a.preferenceTimer.Stop()
	}
	if a.preferences != "" {
		if atomicWrite(filepath.Join(dataDir(), "native-preferences.json"), []byte(a.preferences)) == nil {
			a.preferences = ""
		}
	}
}
func (a *App) Connect(extension string) error         { return installNativeHost(extension) }
func (a *App) Conversations() ([]Conversation, error) { return listConversations() }
func (a *App) ConversationSource(id string) ([]Message, error) {
	c, err := readConversation(id)
	if err != nil {
		return nil, err
	}
	return c.Messages, nil
}
func (a *App) Conversation(id string) (*Document, error) {
	c, e := readConversation(id)
	if e != nil {
		return nil, e
	}
	var b strings.Builder
	renderMessages := make([]Message, 0, len(c.Messages))
	warnings := []ContentWarning{}
	for index, m := range c.Messages {
		text := m.Text
		if m.Role == "assistant" && m.Format != "markdown" {
			normalized := normalizeConversationMarkdown(text)
			if normalized != strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")) && strings.Contains(normalized, "```mermaid") {
				warnings = append(warnings, ContentWarning{Kind: "mermaid", Message: index + 1, Summary: "疑似 Mermaid 已增强显示，保存的同步原文未修改"})
			}
			text = normalized
		}
		renderMessage := m
		renderMessage.Text = text
		renderMessages = append(renderMessages, renderMessage)
		if m.Role == "user" {
			b.WriteString("> [!QUESTION]\n")
			for _, line := range strings.Split(text, "\n") {
				fmt.Fprintf(&b, "> %s\n", line)
			}
			b.WriteString("\n")
		} else if m.Role == "assistant" {
			b.WriteString(text + "\n\n")
		}
	}
	a.mu.Lock()
	a.current = ""
	a.mu.Unlock()
	return &Document{Path: "conversation:" + id, Title: c.Title, Text: b.String(), Conversation: true, SyncedAt: c.UpdatedAt.Local().Format("2006-01-02 15:04"), MessageCount: len(c.Messages), Messages: renderMessages, Warnings: warnings}, nil
}
