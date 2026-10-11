package main

import (
	"errors"
	"os"
	"strings"
	"unicode/utf8"
)

type SearchResult struct {
	Kind    string `json:"kind"`
	Path    string `json:"path"`
	Title   string `json:"title"`
	Detail  string `json:"detail,omitempty"`
	Snippet string `json:"snippet,omitempty"`
	Message int    `json:"message,omitempty"`
}

const maxSearchResults = 120

// Search scans the existing file-backed library and synchronized conversations.
// It deliberately does not create another index, so the source files remain the
// only source of truth and deleting Mica's data cannot affect user documents.
func (a *App) Search(query string) ([]SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []SearchResult{}, nil
	}
	if utf8.RuneCountInString(query) > 200 {
		return nil, errors.New("搜索内容过长")
	}
	needle := strings.ToLower(query)
	results := make([]SearchResult, 0, 24)

	documents, err := a.Library()
	if err != nil {
		return nil, err
	}
	for _, document := range documents {
		if len(results) >= maxSearchResults {
			break
		}
		if strings.Contains(strings.ToLower(document.Title), needle) {
			results = append(results, SearchResult{Kind: "document", Path: document.Path, Title: document.Title, Detail: document.Category})
			continue
		}
		if document.Missing || document.Kind == "pdf" {
			continue
		}
		info, statErr := os.Stat(document.Path)
		if statErr != nil || info.Size() > 8*1024*1024 {
			continue
		}
		data, readErr := os.ReadFile(document.Path)
		if readErr != nil {
			continue
		}
		text, decodeErr := decodeText(data)
		if decodeErr != nil {
			continue
		}
		if index := strings.Index(strings.ToLower(text), needle); index >= 0 {
			results = append(results, SearchResult{Kind: "document", Path: document.Path, Title: document.Title, Detail: document.Category, Snippet: searchSnippet(text, index, len(query))})
		}
	}

	conversations, err := listConversations()
	if err != nil {
		return nil, err
	}
	for _, summary := range conversations {
		if len(results) >= maxSearchResults {
			break
		}
		if strings.Contains(strings.ToLower(summary.Title), needle) {
			results = append(results, SearchResult{Kind: "conversation", Path: "conversation:" + summary.ID, Title: summary.Title, Detail: "ChatGPT 会话"})
		}
		conversation, readErr := readConversation(summary.ID)
		if readErr != nil {
			continue
		}
		matches := 0
		for index, message := range conversation.Messages {
			if len(results) >= maxSearchResults || matches >= 3 {
				break
			}
			if position := strings.Index(strings.ToLower(message.Text), needle); position >= 0 {
				role := "回答"
				if message.Role == "user" {
					role = "提问"
				}
				results = append(results, SearchResult{Kind: "conversation", Path: "conversation:" + summary.ID, Title: summary.Title, Detail: role, Snippet: searchSnippet(message.Text, position, len(query)), Message: index + 1})
				matches++
			}
		}
	}
	return results, nil
}

func searchSnippet(text string, byteIndex, queryBytes int) string {
	start := byteIndex - 100
	if start < 0 {
		start = 0
	}
	end := byteIndex + queryBytes + 160
	if end > len(text) {
		end = len(text)
	}
	for start > 0 && !utf8.RuneStart(text[start]) {
		start--
	}
	for end < len(text) && !utf8.RuneStart(text[end]) {
		end++
	}
	snippet := strings.Join(strings.Fields(text[start:end]), " ")
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(text) {
		snippet += "…"
	}
	return snippet
}
