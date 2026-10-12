package main

// ExampleConversation gives a first-time reader the complete Mica experience
// before they install the browser extension. It is stored like a normal local
// conversation so outlines, notes, tags, search and reading position all work.
func (a *App) ExampleConversation() (*Document, error) {
	c := Conversation{
		ID: "mica-welcome-example-v1", Title: "把一次对话变成可重读的知识", SourceURL: "mica://welcome-example",
		Messages: []Message{
			{ID: "example-q1", Role: "user", Format: "markdown", Text: "Mica 和普通 Markdown 阅读器有什么不同？"},
			{ID: "example-a1", Role: "assistant", Format: "markdown", Text: "## 阅读不是信息的终点\n\nMica 把长对话和技术文档整理成适合重读的材料：\n\n- 按问题生成清晰目录；\n- 保留代码、表格与图表；\n- 记住阅读位置；\n- 高亮原文，并留下笔记或标签。\n\n```go\ntype Reading struct {\n    Source string\n    Insight string\n}\n```"},
			{ID: "example-q2", Role: "user", Format: "markdown", Text: "能用一张图说明完整对话如何进入 Mica 吗？"},
			{ID: "example-a2", Role: "assistant", Format: "markdown", Text: "## 从对话到书架\n\n```mermaid\nflowchart LR\n  A[ChatGPT 完整对话] --> B[Mica Sync]\n  B --> C[本机保存]\n  C --> D[问题目录]\n  C --> E[笔记与标签]\n  C --> F[再次阅读]\n```\n\n同步读取的是**完整会话原文**，不会用当前屏幕中可见的一小段代替。"},
			{ID: "example-q3", Role: "user", Format: "markdown", Text: "第一次使用时，我可以先做什么？"},
			{ID: "example-a3", Role: "assistant", Format: "markdown", Text: "## 现在就试试看\n\n1. 打开右侧的“目录”，在三个问题之间跳转。\n2. 选中一句正文，添加高亮、笔记或标签。\n3. 点击图表进入大图查看。\n4. 按 `Ctrl + F` 搜索“完整会话”。\n\n> 这些体验都只保存在你的电脑上，不需要注册 Mica 账号。"},
		},
	}
	if _, err := upsert(c); err != nil {
		return nil, err
	}
	doc, err := a.Conversation(c.ID)
	if doc != nil {
		doc.Sample = true
	}
	return doc, err
}
