package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Anchor struct {
	Quote  string `json:"quote"`
	Prefix string `json:"prefix"`
	Suffix string `json:"suffix"`
	Start  int    `json:"start"`
}
type Note struct {
	ID       string    `json:"id"`
	Document string    `json:"document"`
	Kind     string    `json:"kind,omitempty"`
	Anchor   Anchor    `json:"anchor"`
	Text     string    `json:"text"`
	Tags     []string  `json:"tags"`
	Created  time.Time `json:"created"`
	Updated  time.Time `json:"updated"`
	Revision int       `json:"revision"`
	Deleted  bool      `json:"deleted"`
}

func (a *App) documentKey(p string) (string, error) {
	if strings.HasPrefix(p, "conversation:") {
		_, e := readConversation(strings.TrimPrefix(p, "conversation:"))
		return p, e
	}
	if !a.permitted(p) {
		return "", errors.New("文档未授权")
	}
	return "file:" + strings.ToUpper(p), nil
}
func noteFolder(key string) string {
	return filepath.Join(dataDir(), "notes", strings.ToUpper(digest([]byte(key))))
}
func (a *App) Notes(p string) ([]Note, error) {
	key, e := a.documentKey(p)
	if e != nil {
		return nil, e
	}
	out := []Note{}
	files, e := filepath.Glob(filepath.Join(noteFolder(key), "*.json"))
	if e != nil {
		return nil, e
	}
	for _, f := range files {
		b, e := os.ReadFile(f)
		if e != nil {
			return nil, e
		}
		var n Note
		if e = json.Unmarshal(b, &n); e != nil {
			return nil, e
		}
		if n.Document == key && !n.Deleted {
			out = append(out, n)
		}
	}
	return out, nil
}
func (a *App) SaveNote(p string, n Note) (Note, error) {
	key, e := a.documentKey(p)
	if e != nil {
		return n, e
	}
	if !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(n.ID) || len(n.Text) > 100000 || len(n.Anchor.Quote) > 32000 || len(n.Tags) > 20 {
		return n, errors.New("笔记无效")
	}
	if n.Kind == "" {
		if n.Text != "" {
			n.Kind = "note"
		} else if len(n.Tags) > 0 {
			n.Kind = "tag"
		} else {
			n.Kind = "highlight"
		}
	}
	if n.Kind != "highlight" && n.Kind != "note" && n.Kind != "tag" {
		return n, errors.New("标注类型无效")
	}
	n.Document = key
	file := filepath.Join(noteFolder(key), n.ID+".json")
	e = withLock(file, func() error {
		var prev Note
		b, e := os.ReadFile(file)
		if e != nil && !os.IsNotExist(e) {
			return e
		}
		if e == nil {
			if e = json.Unmarshal(b, &prev); e != nil {
				return e
			}
		}
		if prev.Revision != n.Revision {
			return errors.New("笔记已在其他窗口修改，请重新打开")
		}
		n.Revision++
		n.Updated = time.Now().UTC()
		if n.Created.IsZero() {
			n.Created = n.Updated
		}
		b, e = json.MarshalIndent(n, "", "  ")
		if e != nil {
			return e
		}
		return atomicWrite(file, b)
	})
	return n, e
}
