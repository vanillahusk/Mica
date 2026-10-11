package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLibraryCategoriesAndGraph(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	root := t.TempDir()
	a := newApp()
	first := filepath.Join(root, "A.md")
	second := filepath.Join(root, "B.md")
	third := filepath.Join(root, "C.md")
	os.WriteFile(first, []byte("# A\n[B](B.md)\n[[B]]\n```md\n[[C]]\n```\n"), 0600)
	os.WriteFile(second, []byte("# B"), 0600)
	os.WriteFile(third, []byte("# C"), 0600)
	for _, p := range []string{first, second, third} {
		if _, e := a.open(p); e != nil {
			t.Fatal(e)
		}
	}
	if e := a.ChangeLibrary(first, "研究", false); e != nil {
		t.Fatal(e)
	}
	a.open(first)
	docs, _ := a.Library()
	if docs[0].Category != "研究" {
		t.Fatal("reopening lost category")
	}
	g, e := a.KnowledgeGraph()
	if e != nil {
		t.Fatal(e)
	}
	links := 0
	for _, edge := range g.Edges {
		if edge.Kind == "link" {
			links++
			if edge.To != second {
				t.Fatal("code fence was treated as link")
			}
		}
	}
	if links != 1 {
		t.Fatal(g)
	}
	if e = a.ChangeLibrary(first, "", true); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(first); e != nil {
		t.Fatal("source file deleted")
	}
	docs, _ = a.Library()
	if len(docs) != 2 {
		t.Fatal(docs)
	}
	if e = a.ChangeLibraryMany([]string{second, third}, "", true); e != nil {
		t.Fatal(e)
	}
	docs, _ = a.Library()
	if len(docs) != 0 {
		t.Fatal("folder-style batch removal did not clear the shelf", docs)
	}
	if _, e = os.Stat(second); e != nil {
		t.Fatal("batch removal deleted a source file")
	}
}
