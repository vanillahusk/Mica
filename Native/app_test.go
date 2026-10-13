package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveConflictsAndAtomicity(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	a := newApp()
	p := filepath.Join(t.TempDir(), "中文 文档.md")
	os.WriteFile(p, []byte("原文"), 0600)
	d, e := a.open(p)
	if e != nil {
		t.Fatal(e)
	}
	os.WriteFile(p, []byte("外部改动"), 0600)
	if _, e = a.Save(d.Path, "我的改动", d.Revision); e == nil {
		t.Fatal("external change overwritten")
	}
	b, _ := os.ReadFile(p)
	if string(b) != "外部改动" {
		t.Fatal("content lost")
	}
	d, _ = a.open(p)
	saved, e := a.Save(d.Path, "安全保存", d.Revision)
	if e != nil || saved.Text != "安全保存" {
		t.Fatal(e)
	}
	if _, e = a.Save(filepath.Join(t.TempDir(), "other.md"), "x", ""); e == nil {
		t.Fatal("unselected file accepted")
	}
}
func TestNativeSyncMergesAndFrames(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	c := Conversation{ID: "test/../id", Title: "测试", Messages: []Message{{ID: "a", Role: "user", Text: "问题"}}}
	if _, e := upsert(c); e != nil {
		t.Fatal(e)
	}
	c.Messages = []Message{{ID: "b", Role: "assistant", Text: "答案"}}
	payload, _ := json.Marshal(Envelope{Type: "syncConversation", ProtocolVersion: 1, Conversation: c})
	input := new(bytes.Buffer)
	binary.Write(input, binary.LittleEndian, uint32(len(payload)))
	input.Write(payload)
	out := new(bytes.Buffer)
	serveNative(input, out)
	var n uint32
	if e := binary.Read(out, binary.LittleEndian, &n); e != nil {
		t.Fatal(e)
	}
	if int(n) != out.Len() {
		t.Fatal("bad native frame")
	}
	var response map[string]interface{}
	json.Unmarshal(out.Bytes(), &response)
	if response["ok"] != true {
		t.Fatal(response)
	}
	saved, e := readConversation(c.ID)
	if e != nil || len(saved.Messages) != 2 {
		t.Fatal(saved, e)
	}
}

func TestConversationMarkdownRepairsChatGPTFallbackStructure(t *testing.T) {
	diagram := `flowchart TD A["统一 GenerationRequest"] --> B["能力表 + Planner"] B --> C["统一调用计划"] C --> D["Provider Driver"] D --> E["厂商专属请求格式"] E --> F["真实厂商 API"] F --> G["厂商专属响应"] G --> H["Driver 解析 + Pipeline 后处理"] H --> I["统一 GenerationOutcome"] I --> J["Worker 保存 OSS / MySQL"]`
	normalized := normalizeConversationMarkdown(diagram)
	if !strings.HasPrefix(normalized, "```mermaid\nflowchart TD\n") || !strings.Contains(normalized, "\nI --> J") {
		t.Fatalf("diagram structure was not restored: %q", normalized)
	}
	if strings.Contains(normalized, `"] B -->`) || strings.Count(normalized, "\n") < 11 {
		t.Fatalf("flat flowchart statements were not split into separate lines: %q", normalized)
	}
	for _, opener := range []string{"```", "```text", "```plaintext", "~~~plain", "```mermaid"} {
		promoted := normalizeConversationMarkdown(opener + "\n" + diagram + "\n" + strings.Repeat(string(opener[0]), 3))
		if !strings.Contains(promoted, "mermaid\nflowchart TD\n") || strings.Contains(promoted, `"] B -->`) {
			t.Fatalf("diagram fence was not promoted for %q: %q", opener, promoted)
		}
	}
	embedded := normalizeConversationMarkdown("它增加了统一接口。\n\n" + diagram + "\n\n这样，业务代码只需要表达：\n\n> 生成一张图片。")
	if !strings.Contains(embedded, "它增加了统一接口。\n\n```mermaid\nflowchart TD\n") || !strings.Contains(embedded, "\n```\n\n这样，业务代码只需要表达：") {
		t.Fatalf("embedded diagram paragraph was not restored: %q", embedded)
	}
	steps := normalizeConversationMarkdown(`**1. 获取结果** Driver 解析。 **2. 统一后处理** OutputPostprocessor 校验。`)
	if !strings.Contains(steps, "**1. 获取结果**\n\nDriver 解析。") || !strings.Contains(steps, "\n\n**2. 统一后处理**\n\n") {
		t.Fatalf("step structure was not restored: %q", steps)
	}
}

func TestRawConversationPreservesMarkdownAndReplacesDOMFallback(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	old := Conversation{ID: "raw-test", Messages: []Message{{ID: "fallback", Role: "assistant", Text: "broken flowchart"}}}
	if _, err := upsert(old); err != nil {
		t.Fatal(err)
	}
	raw := "说明\n\n```mermaid\nflowchart TD\n A[\"保留 A --> B\"] --> B[\"结果\"]\n\n B --> C\n```\n\n**1. 获取结果** 原样保留。"
	c := Conversation{ID: "raw-test", Complete: true, Messages: []Message{{ID: "real-q", Role: "user", Text: "问题", Format: "markdown"}, {ID: "real-a", Role: "assistant", Text: raw, Format: "markdown"}}}
	if _, err := upsert(c); err != nil {
		t.Fatal(err)
	}
	saved, err := readConversation(c.ID)
	if err != nil || len(saved.Messages) != 2 || saved.Messages[1].Text != raw {
		t.Fatal(saved, err)
	}
	if _, err = os.Stat(conversationPath(c.ID) + ".before-sync.bak"); err != nil {
		t.Fatal(err)
	}
	doc, err := newApp().Conversation(c.ID)
	if err != nil || !strings.Contains(doc.Text, raw) || strings.Contains(doc.Text, "broken flowchart") || len(doc.Messages) != 2 || doc.Messages[1].Text != raw {
		t.Fatal(doc, err)
	}
	source, err := newApp().ConversationSource(c.ID)
	if err != nil || len(source) != 2 || source[1].Text != raw {
		t.Fatal("source mode did not return exact stored messages", source, err)
	}
	c.Messages = nil
	if _, err = upsert(c); err == nil {
		t.Fatal("empty snapshot overwrote conversation")
	}
}
func TestNotesRevision(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	p := filepath.Join(t.TempDir(), "note.md")
	os.WriteFile(p, []byte("test"), 0600)
	a := newApp()
	d, _ := a.open(p)
	n := Note{ID: "0123456789abcdef0123456789abcdef", Text: "笔记", Tags: []string{}}
	saved, e := a.SaveNote(d.Path, n)
	if e != nil {
		t.Fatal(e)
	}
	if saved.Revision != 1 || saved.Kind != "note" {
		t.Fatal(saved)
	}
	if _, e = a.SaveNote(d.Path, n); e == nil {
		t.Fatal("stale revision accepted")
	}
	notes, e := a.Notes(d.Path)
	if e != nil || len(notes) != 1 {
		t.Fatal(notes, e)
	}
	deleted, e := a.DeleteNote(d.Path, saved)
	if e != nil || !deleted.Deleted {
		t.Fatal(deleted, e)
	}
	if notes, e = a.Notes(d.Path); e != nil || len(notes) != 0 {
		t.Fatal(notes, e)
	}
	restored, e := a.RestoreNote(d.Path, deleted)
	if e != nil || restored.Deleted {
		t.Fatal(restored, e)
	}
}

func TestSearchDocumentsAndConversationMessages(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	a := newApp()
	path := filepath.Join(t.TempDir(), "architecture.md")
	if err := os.WriteFile(path, []byte("# 架构\n统一调用计划由 Provider Driver 执行。"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.open(path); err != nil {
		t.Fatal(err)
	}
	conversation := Conversation{ID: "search-conversation", Title: "图片生成", Messages: []Message{{ID: "one", Role: "assistant", Text: "Worker 保存 OSS / MySQL"}}}
	if _, err := upsert(conversation); err != nil {
		t.Fatal(err)
	}
	results, err := a.Search("Provider Driver")
	if err != nil || len(results) != 1 || results[0].Kind != "document" || results[0].Snippet == "" {
		t.Fatal(results, err)
	}
	results, err = a.Search("Worker 保存")
	if err != nil || len(results) != 1 || results[0].Kind != "conversation" || results[0].Message != 1 {
		t.Fatal(results, err)
	}
}

func TestExampleConversationSupportsReaderFeatures(t *testing.T) {
	t.Setenv("MICA_DATA_DIRECTORY", t.TempDir())
	a := newApp()
	doc, err := a.ExampleConversation()
	if err != nil || !doc.Sample || !doc.Conversation || doc.MessageCount != 6 {
		t.Fatal(doc, err)
	}
	if !strings.Contains(doc.Text, "```mermaid") || !strings.Contains(doc.Text, "```go") || !strings.Contains(doc.Text, "[!QUESTION]") {
		t.Fatal("example does not exercise the reader")
	}
	if _, err = a.Notes(doc.Path); err != nil {
		t.Fatal("example must support local notes", err)
	}
}
