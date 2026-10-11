package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/text/encoding/simplifiedchinese"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

func documentKind(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".md", ".markdown":
		return "markdown"
	case ".pdf":
		return "pdf"
	case ".txt", ".log", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml", ".xml", ".ini", ".cfg", ".toml", ".sql", ".js", ".ts", ".css", ".html", ".py", ".go", ".java", ".c", ".h", ".cpp", ".rs", ".sh":
		return "text"
	}
	return ""
}

func decodeText(b []byte) (string, error) {
	if len(b) >= 2 && ((b[0] == 255 && b[1] == 254) || (b[0] == 254 && b[1] == 255)) {
		if len(b)%2 != 0 {
			return "", errors.New("UTF-16 文件长度无效")
		}
		var order binary.ByteOrder = binary.LittleEndian
		if b[0] == 254 {
			order = binary.BigEndian
		}
		units := make([]uint16, (len(b)-2)/2)
		for i := range units {
			units[i] = order.Uint16(b[2+i*2:])
		}
		return string(utf16.Decode(units)), nil
	}
	if strings.ContainsRune(string(b), '\x00') {
		return "", errors.New("这是二进制文件，不能按文本打开")
	}
	if utf8.Valid(b) {
		return strings.TrimPrefix(string(b), "\ufeff"), nil
	}
	decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(b)
	if err != nil {
		return "", errors.New("无法识别文本编码，请转换为 UTF-8")
	}
	return string(decoded), nil
}

// Only paths recorded by the native file chooser or launch arguments are restored.
func (a *App) Library() ([]Document, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	var docs []Document
	b, e := os.ReadFile(filepath.Join(dataDir(), "native-library.json"))
	if os.IsNotExist(e) {
		return []Document{}, nil
	}
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &docs); e != nil {
		return nil, e
	}
	for i := range docs {
		d := &docs[i]
		if documentKind(d.Path) == "" {
			continue
		}
		real, e := filepath.EvalSymlinks(d.Path)
		d.Missing = e != nil
		if e == nil {
			d.Path = real
			a.allowed[real] = true
		}
	}
	return docs, nil
}
func (a *App) remember(docs []Document) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	path := filepath.Join(dataDir(), "native-library.json")
	var old []Document
	b, _ := os.ReadFile(path)
	_ = json.Unmarshal(b, &old)
	categories := map[string]string{}
	for _, d := range old {
		categories[d.Path] = d.Category
	}
	seen := map[string]bool{}
	out := []Document{}
	for _, d := range append(docs, old...) {
		if seen[d.Path] || documentKind(d.Path) == "" || len(out) >= 5000 {
			continue
		}
		seen[d.Path] = true
		out = append(out, Document{Path: d.Path, Title: d.Title, Kind: documentKind(d.Path), Category: categories[d.Path]})
	}
	b, e := json.Marshal(out)
	if e != nil {
		return e
	}
	return atomicWrite(path, b)
}
func (a *App) ExportPDFCopy(path string) error {
	if !a.permitted(path) || documentKind(path) != "pdf" {
		return errors.New("PDF 未授权")
	}
	target, e := wr.SaveFileDialog(a.ctx, wr.SaveDialogOptions{Title: "另存 PDF", DefaultDirectory: filepath.Dir(path), DefaultFilename: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)) + " - 副本.pdf", Filters: []wr.FileFilter{{DisplayName: "PDF", Pattern: "*.pdf"}}})
	if e != nil || target == "" {
		return e
	}
	if !strings.EqualFold(filepath.Ext(target), ".pdf") {
		target += ".pdf"
	}
	if strings.EqualFold(target, path) {
		return errors.New("请选择不同的导出路径，原文件不会修改")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	return atomicWrite(target, b)
}
