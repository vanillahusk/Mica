package main

import (
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestLibraryAndPositionSurviveRestart(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	path := filepath.Join(t.TempDir(), "本地.md")
	os.WriteFile(path, []byte("hello"), 0600)
	a := newApp()
	d, e := a.open(path)
	if e != nil {
		t.Fatal(e)
	}
	raw := `{"lastPath":"test","positions":{"test":{"top":123}}}`
	a.Preferences(raw)
	a.flushPreferences()
	b := newApp()
	docs, e := b.Library()
	if e != nil || len(docs) != 1 || docs[0].Path != d.Path {
		t.Fatal(docs, e)
	}
	if _, e = b.OpenKnown(d.Path); e != nil {
		t.Fatal(e)
	}
	restored, e := b.Preferences("")
	if e != nil || restored != raw {
		t.Fatal(restored, e)
	}
	os.Remove(path)
	docs, e = newApp().Library()
	if e != nil || !docs[0].Missing {
		t.Fatal("missing path not retained")
	}
}
func TestTextFormatsAndPDFBoundary(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	root := t.TempDir()
	a := newApp()
	for _, ext := range []string{".txt", ".log", ".json", ".yaml", ".csv", ".py"} {
		p := filepath.Join(root, "test"+ext)
		os.WriteFile(p, []byte("# not a heading"), 0600)
		d, e := a.open(p)
		if e != nil || d.Kind != "text" {
			t.Fatal(d, e)
		}
	}
	text, e := decodeText([]byte{255, 254, 0x2d, 0x4e})
	if e != nil || text != "中" {
		t.Fatal(text, e)
	}
	if _, e = decodeText([]byte{0, 1, 2}); e == nil {
		t.Fatal("binary accepted")
	}
	p := filepath.Join(root, "test.pdf")
	os.WriteFile(p, []byte("%PDF-1.7\n"), 0600)
	req := httptest.NewRequest("GET", "/local-pdf?path="+url.QueryEscape(p), nil)
	w := httptest.NewRecorder()
	a.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("unselected PDF accessible")
	}
	d, e := a.open(p)
	if e != nil || d.Kind != "pdf" || d.Text != "" {
		t.Fatal(d, e)
	}
	w = httptest.NewRecorder()
	a.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	if _, e = a.Save(d.Path, "oops", d.Revision); e == nil {
		t.Fatal("PDF overwrite accepted")
	}
}

func TestImportFilesAndFolderTree(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	root := t.TempDir()
	nested := filepath.Join(root, "项目", "设计")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	markdown := filepath.Join(nested, "架构.md")
	text := filepath.Join(root, "说明.txt")
	ignored := filepath.Join(root, "图片.bin")
	for path, body := range map[string]string{markdown: "# 架构", text: "说明", ignored: "binary"} {
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	a := newApp()
	docs, err := a.importPaths([]string{root})
	if err != nil || len(docs) != 2 {
		t.Fatal(docs, err)
	}
	foundTreePath := false
	for _, doc := range docs {
		if doc.Path == markdown && doc.Title == filepath.Join("项目", "设计", "架构.md") {
			foundTreePath = true
		}
	}
	if !foundTreePath {
		t.Fatal("folder-relative tree path was not retained", docs)
	}
	if _, err = a.OpenKnown(markdown); err != nil {
		t.Fatal("imported path was not granted", err)
	}
}
