import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMarkdown,parseConversationSource} from '../src/parser.js';
import {adaptGptRichText} from '../src/gpt-richtext/index.js';
test('CommonMark nesting, tables, reference links, tasks and footnotes', () => {
  const doc = '# 标题\n\n## 标题\n\n1. 第一项\n   - 嵌套 **加粗**\n\n- [x] 完成\n\n| 名称 | 值 |\n| :--- | ---: |\n| a | 1 |\n\n[引用][site] 和脚注[^1]\n\n[site]: https://example.com\n[^1]: 脚注内容\n\n~~删除~~ ==标记== H~2~O x^2^\n\n<details><summary>展开</summary>内容</details>';
  const result=parseMarkdown(doc), html=result.chunks.join('');
  assert.match(html,/<ol\b[^>]*>/);assert.match(html,/<ul\b[^>]*>/);assert.match(html,/<table\b[^>]*>/);
  assert.match(html,/<h2 data-source-line="3"/);
  assert.match(html,/data-align="right"/);assert.match(html,/checkbox/);assert.match(html,/footnote/);
  assert.match(html,/<mark>/);assert.match(html,/<sub>/);assert.match(html,/<sup>/);
  assert.match(html,/<details>/);assert.equal(result.outline[1].id,'标题-1');
});
test('fences collect Mermaid without injecting its source into markup', () => {
  const fence=String.fromCharCode(96).repeat(3);
  const result=parseMarkdown(fence+'mermaid\nflowchart LR\n A-->B\n'+fence+'\n\n~~~js\nconst x = 1;\n~~~');
  assert.equal(result.diagrams.length,1);
  assert.match(result.diagrams[0].source,/A-->B/);
  assert.match(result.chunks.join(''),/data-action="diagram-window"/);
  assert.match(result.chunks.join(''),/data-language="js"/);
});

test('bold numbered ChatGPT sections receive stable step styling', () => {
  const result=parseMarkdown('**1. 获取 Provider 结果**\n\n正文。\n\n**2. 统一后处理**\n\n更多正文。',true);
  const html=result.chunks.join('');
  assert.match(html,/class="chat-step-title"/);
  assert.match(html,/data-step="1"/);
  assert.match(html,/data-step="2"/);
});
test('questions and markdown headings have distinct outlines', () => {
  const result=parseMarkdown('# Title\n\n> [!QUESTION]\n> 为什么？\n\n## 答案标题\n\n> [!TIP]\n> 提示',true);
  assert.deepEqual(result.outline.map(x=>x.title),['为什么？']);
  assert.match(result.chunks.join(''),/提问 01/);
});
test('both dollar and bracket math are retained for lazy typesetting', () => {
  const html=parseMarkdown('Inline $x^2$ and \\(y\\).\n\n$$\n\\frac{1}{2}\n$$\n\n\\[\nz^2\n\\]').chunks.join('');
  assert.equal((html.match(/data-source=/g)||[]).length,4);
  assert.match(html,/math-block/);
});
test('unclosed and nested fences remain code, not headings or executable HTML', () => {
  const fence=String.fromCharCode(96).repeat(3);
  const result=parseMarkdown(fence+'js\n# not a heading\n<script>alert(1)</script>');
  assert.equal(result.outline.length,0);
  assert.match(result.chunks.join(''),/&lt;script&gt;/);
  const nested=parseMarkdown('> '+fence+'text\n> # also code\n> '+fence);
  assert.equal(nested.outline.length,0);
  assert.match(nested.chunks.join(''),/<blockquote\b[^>]*>/);
});

test('GPT rich components become safe readable structures without changing fenced source', async () => {
  const source=await readFile(new URL('./fixtures/gpt-rich-content.md',import.meta.url),'utf8');
  const adapted=adaptGptRichText(source),result=parseMarkdown(source,true),html=result.chunks.join('');
  assert.equal(adapted.detected,true);assert.equal(adapted.compatVersion,2);
  assert.match(html,/gpt-box/);assert.match(html,/gpt-row/);assert.match(html,/gpt-col/);
  assert.match(html,/<strong>可发布<\/strong>/);assert.match(html,/<em>等待复核<\/em>/);assert.match(html,/<hr>/);
  assert.match(html,/href="https:\/\/example\.com\/runbook"/);assert.doesNotMatch(html,/<img[^>]+javascript:/i);
  assert.match(html,/未知组件中的正文仍然可读/);assert.doesNotMatch(html,/<\/?(?:box|text|row|col|MysteryWidget)\b/i);
  assert.doesNotMatch(adapted.markdown,/javascript:/i);assert.match(adapted.markdown,/危险链接只保留文字/);
  assert.match(html,/&lt;box onclick=&quot;alert\(1\)&quot;&gt;代码示例必须保持原样&lt;\/box&gt;/);
});

test('GPT adapter tolerates malformed and deeply nested components', () => {
  const malformed=parseMarkdown('<box><row><col>仍然可读</box>',true).chunks.join('');
  assert.match(malformed,/仍然可读/);assert.doesNotMatch(malformed,/<\/?box\b/);
  const deep='<box>'.repeat(40)+'末端内容'+'</box>'.repeat(40),adapted=adaptGptRichText(deep);
  assert.equal(adapted.degraded,true);assert.match(adapted.markdown,/末端内容/);assert.doesNotMatch(adapted.markdown,/<\/?box>/);
});

test('GPT layout indentation is removed without losing Markdown semantics', () => {
  const source='<box>\n    **Success**\n\n    [GitHub](https://github.com/vanillahusk/Mica)\n\n    - 第一项\n        - 嵌套项\n</box>';
  const html=parseMarkdown(source,true).chunks.join('');
  assert.match(html,/<strong>Success<\/strong>/);
  assert.match(html,/<a href="https:\/\/github\.com\/vanillahusk\/Mica">GitHub<\/a>/);
  assert.match(html,/<li[^>]*>第一项\s*<ul/);assert.doesNotMatch(html,/<pre>/);
  const compact=parseMarkdown(source,true,'compact').chunks.join('');
  assert.match(compact,/<strong>Success<\/strong>/);assert.match(compact,/href="https:\/\/github\.com\/vanillahusk\/Mica"/);
  assert.doesNotMatch(compact,/<pre>/);
});

test('GPT layout keeps safe attributes, real indented code and removes empty shells', () => {
  const source='<box><grid columns={2} gap={3}>\n  <card>Alpha</card>\n  <card>Beta</card>\n  <card>Gamma</card>\n</grid></box>\n<box><icon name="not-supported" /></box>\n<box><icon name="book-open" /></box>\n<card>\n    正文\n\n        const realCode = true;\n</card>';
  const html=parseMarkdown(source,true).chunks.join('');
  assert.match(html,/class="gpt-component gpt-grid gpt-gap-3"[^>]+data-columns="2"/);
  assert.equal((html.match(/gpt-card/g)||[]).length,4);assert.equal((html.match(/gpt-box/g)||[]).length,2);
  assert.match(html,/📖/);assert.match(html,/<pre><code>const realCode = true;/);
});

test('ordinary Markdown bypasses GPT compatibility unchanged', () => {
  const source='# 普通文档\n\n**加粗**与[链接](https://example.com)。';
  const adapted=adaptGptRichText(source);
  assert.equal(adapted.detected,false);assert.equal(adapted.markdown,source);
});

test('source mode escapes exact stored messages instead of interpreting them', () => {
  const raw='<box onclick="run()">**保持原样**</box><script>bad()</script>',result=parseConversationSource([{id:'q',role:'user',text:raw},{id:'a',role:'assistant',text:'answer'}]),html=result.chunks.join('');
  assert.match(html,/&lt;box onclick=&quot;run\(\)&quot;&gt;\*\*保持原样\*\*/);assert.doesNotMatch(html,/<script>/);
  assert.equal(result.outline.length,1);assert.equal(result.richText.source,true);
});
