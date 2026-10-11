import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdown} from '../src/parser.js';
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
