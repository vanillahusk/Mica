package main

import (
	"regexp"
	"strings"
)

var (
	bareDiagramStart = regexp.MustCompile(`(?i)^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b`)
	flowDirection    = regexp.MustCompile(`(?i)^(flowchart|graph)\s+(TD|TB|BT|RL|LR)\s+`)
	flowStatement    = regexp.MustCompile(`\s+([A-Za-z_][A-Za-z0-9_-]*)\s+(-->|---|-.->|==>)`)
	stepHeading      = regexp.MustCompile(`\s*(\*\*([0-9]+)[.)、]\s*[^*]+\*\*)\s*`)
	extraBlankLines  = regexp.MustCompile(`\n{3,}`)
)

// normalizeConversationMarkdown repairs structure lost by ChatGPT DOM fallbacks.
// It only touches unmistakable diagram-only messages and bold numbered headings.
func normalizeConversationMarkdown(value string) string {
	text := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n"))
	if text == "" {
		return ""
	}
	text = promoteDiagramFences(text)
	if !strings.Contains(text, "```") && !strings.Contains(text, "~~~") && bareDiagramStart.MatchString(text) {
		text = expandFlatFlowchart(text)
		return "```mermaid\n" + text + "\n```"
	}
	text = promoteDiagramParagraphs(text)
	if stepHeading.MatchString(text) {
		text = stepHeading.ReplaceAllString(text, "\n\n$1\n\n")
		text = extraBlankLines.ReplaceAllString(text, "\n\n")
	}
	return strings.TrimSpace(text)
}

// promoteDiagramParagraphs repairs code blocks that recent ChatGPT pages expose as
// ordinary paragraphs inside an otherwise normal assistant answer.
func promoteDiagramParagraphs(text string) string {
	parts := strings.Split(text, "\n\n")
	for i, part := range parts {
		trimmed := strings.TrimSpace(part)
		if bareDiagramStart.MatchString(trimmed) {
			parts[i] = "```mermaid\n" + expandFlatFlowchart(trimmed) + "\n```"
		}
	}
	return strings.Join(parts, "\n\n")
}

func expandFlatFlowchart(text string) string {
	if direction := flowDirection.FindStringSubmatchIndex(text); direction != nil {
		head := strings.TrimSpace(text[:direction[1]])
		rest := text[direction[1]:]
		rest = flowStatement.ReplaceAllString(rest, "\n$1 $2")
		return head + "\n" + strings.TrimSpace(rest)
	}
	return text
}

func promoteDiagramFences(text string) string {
	lines := strings.Split(text, "\n")
	for i := 0; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if len(trimmed) < 3 || (trimmed[0] != '`' && trimmed[0] != '~') {
			continue
		}
		markerByte := trimmed[0]
		markerLength := 0
		for markerLength < len(trimmed) && trimmed[markerLength] == markerByte {
			markerLength++
		}
		if markerLength < 3 {
			continue
		}
		info := strings.ToLower(strings.TrimSpace(trimmed[markerLength:]))
		if info != "" && info != "text" && info != "plain" && info != "plaintext" && info != "mermaid" {
			continue
		}
		end := i + 1
		for ; end < len(lines); end++ {
			closing := strings.TrimSpace(lines[end])
			if len(closing) >= markerLength && strings.Trim(closing, string(markerByte)) == "" {
				break
			}
		}
		if end >= len(lines) {
			continue
		}
		body := strings.TrimSpace(strings.Join(lines[i+1:end], "\n"))
		if bareDiagramStart.MatchString(body) {
			indent := lines[i][:len(lines[i])-len(strings.TrimLeft(lines[i], " \t"))]
			if info != "mermaid" {
				lines[i] = indent + strings.Repeat(string(markerByte), markerLength) + "mermaid"
			}
			expanded := strings.Split(expandFlatFlowchart(body), "\n")
			rebuilt := append([]string{}, lines[:i+1]...)
			rebuilt = append(rebuilt, expanded...)
			rebuilt = append(rebuilt, lines[end:]...)
			lines = rebuilt
			end = i + 1 + len(expanded)
		}
		i = end
	}
	return strings.Join(lines, "\n")
}
