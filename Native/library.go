package main

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func (a *App) ChangeLibrary(path, category string, remove bool) error {
	return a.ChangeLibraryMany([]string{path}, category, remove)
}

func (a *App) ChangeLibraryMany(paths []string, category string, remove bool) error {
	if len(category) > 120 {
		return errors.New("分类名称过长")
	}
	if len(paths) == 0 || len(paths) > 5000 {
		return errors.New("没有可整理的文档")
	}
	targets := make(map[string]bool, len(paths))
	for _, path := range paths {
		targets[path] = true
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	file := filepath.Join(dataDir(), "native-library.json")
	b, e := os.ReadFile(file)
	if e != nil {
		return e
	}
	var docs []Document
	if e = json.Unmarshal(b, &docs); e != nil {
		return e
	}
	out := []Document{}
	found := false
	for _, d := range docs {
		if targets[d.Path] {
			found = true
			if remove {
				continue
			}
			d.Category = strings.TrimSpace(category)
		}
		out = append(out, d)
	}
	if !found {
		return errors.New("书架中没有此文档")
	}
	b, e = json.Marshal(out)
	if e != nil {
		return e
	}
	return atomicWrite(file, b)
}

type GraphNode struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Group    bool   `json:"group"`
	Category string `json:"category"`
}
type GraphEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
}
type LibraryGraph struct {
	Nodes     []GraphNode `json:"nodes"`
	Edges     []GraphEdge `json:"edges"`
	Truncated bool        `json:"truncated"`
}

var wikiLink = regexp.MustCompile(`\[\[([^\]|#]+)(?:[^\]]*)\]\]`)
var mdLink = regexp.MustCompile(`\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)`)
var fencedCode = regexp.MustCompile("(?ms)^\\s*(```|~~~).*?^\\s*(?:```|~~~)[^\\n]*$")

func (a *App) KnowledgeGraph() (LibraryGraph, error) {
	docs, e := a.Library()
	g := LibraryGraph{Nodes: []GraphNode{}, Edges: []GraphEdge{}}
	if e != nil {
		return g, e
	}
	if len(docs) > 200 {
		g.Truncated = true
		docs = docs[:200]
	}
	paths := map[string]string{}
	names := map[string][]string{}
	groups := map[string]bool{}
	for _, d := range docs {
		paths[strings.ToLower(d.Path)] = d.Path
		name := strings.ToLower(strings.TrimSuffix(filepath.Base(d.Path), filepath.Ext(d.Path)))
		names[name] = append(names[name], d.Path)
		g.Nodes = append(g.Nodes, GraphNode{ID: d.Path, Label: d.Title, Category: d.Category})
		if d.Category != "" {
			id := "category:" + d.Category
			if !groups[id] {
				groups[id] = true
				g.Nodes = append(g.Nodes, GraphNode{ID: id, Label: d.Category, Group: true})
			}
			g.Edges = append(g.Edges, GraphEdge{From: d.Path, To: id, Kind: "category"})
		}
	}
	seen := map[string]bool{}
	for _, d := range docs {
		if documentKind(d.Path) != "markdown" || d.Missing {
			continue
		}
		info, e := os.Stat(d.Path)
		if e != nil || info.Size() > 2*1024*1024 {
			continue
		}
		b, e := os.ReadFile(d.Path)
		if e != nil {
			continue
		}
		source := fencedCode.ReplaceAllString(string(b), "")
		matches := append(wikiLink.FindAllStringSubmatch(source, -1), mdLink.FindAllStringSubmatch(source, -1)...)
		for _, m := range matches {
			link := strings.Split(m[1], "#")[0]
			if strings.Contains(link, "://") || link == "" {
				continue
			}
			if decoded, e := url.PathUnescape(link); e == nil {
				link = decoded
			}
			candidate := filepath.Clean(filepath.Join(filepath.Dir(d.Path), filepath.FromSlash(link)))
			target := paths[strings.ToLower(candidate)]
			if target == "" && filepath.Ext(candidate) == "" {
				target = paths[strings.ToLower(candidate+".md")]
			}
			if target == "" && !strings.ContainsAny(link, "/\\") {
				key := strings.ToLower(strings.TrimSuffix(link, filepath.Ext(link)))
				if len(names[key]) == 1 {
					target = names[key][0]
				}
			}
			key := d.Path + "\x00" + target
			if target != "" && target != d.Path && !seen[key] {
				seen[key] = true
				g.Edges = append(g.Edges, GraphEdge{From: d.Path, To: target, Kind: "link"})
			}
		}
	}
	return g, nil
}
