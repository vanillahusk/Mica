import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://chatgpt.com/g/custom-gpt/c/mica-test' });
Object.assign(globalThis, {
  window,
  document: window.document,
  location: window.location,
  Node: window.Node,
  HTMLElement: window.HTMLElement,
});

await import('./markdown.js');
document.title = '架构讨论 - ChatGPT';
document.body.innerHTML = `<main>
  <article data-testid="conversation-turn-0" data-turn-id-container="u1"><div data-message-id="nested-u1"><div class="user-message-bubble-color"><div class="whitespace-pre-wrap"><p>解释生成流程</p></div></div></div></article>
  <article data-testid="conversation-turn-1" data-turn-id-container="a1"><div data-message-id="nested-a1"><div class="markdown-new-styling">
    <div class="group/copyable-code-block"><header class="code-header">mermaid</header><code>flowchart TD A[请求] --&gt; B[Driver] B --&gt; C[结果]</code></div>
    <p><strong>1. 获取结果</strong></p><p>Driver 负责处理。</p>
    <ol><li>保存 OSS</li><li>记录 MySQL</li></ol>
    <p>flowchart TD X[统一接口] --&gt; Y[Provider Driver]</p>
  </div></div></article>
</main>`;

const result = globalThis.MicaMarkdown.collect(document);
assert.equal(result.id, 'mica-test');
assert.equal(result.title, '架构讨论');
assert.equal(result.messages.length, 2);
assert.match(result.messages[1].text, /```mermaid\nflowchart TD A\[请求\] --> B\[Driver\] B --> C\[结果\]\n```/);
assert.match(result.messages[1].text, /```mermaid\nflowchart TD X\[统一接口\] --> Y\[Provider Driver\]\n```/);
assert.match(result.messages[1].text, /\*\*1\. 获取结果\*\*\n\nDriver 负责处理。/);
assert.match(result.messages[1].text, /1\. 保存 OSS\n2\. 记录 MySQL/);
console.log('PASS Mica Sync: ChatGPT DOM -> structured Markdown');
