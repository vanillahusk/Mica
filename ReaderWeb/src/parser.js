import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import tasks from 'markdown-it-task-lists';
import deflist from 'markdown-it-deflist';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })
  .use(footnote).use(tasks, { enabled: false }).use(deflist).use(mark).use(sub).use(sup);
const esc = md.utils.escapeHtml;
for (const tag of ['th_open', 'td_open']) md.renderer.rules[tag] = (tokens, i, options, env, self) => {
  const token = tokens[i], align = /text-align:(left|right|center)/.exec(token.attrGet('style') || '');
  if (align) token.attrSet('data-align', align[1]);
  if (token.attrs) token.attrs = token.attrs.filter(([name]) => name !== 'style');
  return self.renderToken(tokens, i, options);
};
md.inline.ruler.before('escape', 'mica_math', (state, silent) => {
  const rest = state.src.slice(state.pos);
  const start = rest.startsWith('\\(') ? '\\(' : rest.startsWith('$') && !rest.startsWith('$$') ? '$' : null;
  if (!start || (start === '$' && /\s/.test(rest[1] || ' '))) return false;
  const end = start === '$' ? '$' : '\\)';
  let close = rest.indexOf(end, start.length);
  while (close > 0 && rest[close - 1] === '\\') close = rest.indexOf(end, close + end.length);
  if (close <= start.length || (start === '$' && /\s/.test(rest[close - 1]))) return false;
  if (!silent) { const token = state.push('mica_math', 'span', 0); token.content = rest.slice(start.length, close); }
  state.pos += close + end.length;
  return true;
});
md.block.ruler.before('fence', 'mica_math_block', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
  const opener = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
  if (!opener) return false;
  const closer = opener === '$$' ? '$$' : '\\]';
  let text = first.slice(2), next = start + 1;
  if (text.endsWith(closer)) text = text.slice(0, -2);
  else {
    let found = false;
    for (; next < end; next++) {
      const line = state.src.slice(state.bMarks[next], state.eMarks[next]);
      if (line.trimEnd().endsWith(closer)) { text += '\n' + line.trimEnd().slice(0, -2); next++; found = true; break; }
      text += '\n' + line;
    }
    if (!found) return false;
  }
  if (!silent) { const token = state.push('mica_math_block', 'div', 0); token.content = text.trim(); token.map = [start, next]; }
  state.line = next;
  return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.renderer.rules.mica_math = (tokens, i) => '<span class="math" data-source="' + esc(tokens[i].content) + '">' + esc(tokens[i].content) + '</span>';
md.renderer.rules.mica_math_block = (tokens, i) => '<div class="math math-block" data-source-line="' + (tokens[i].map[0]+1) + '" data-source="' + esc(tokens[i].content) + '">' + esc(tokens[i].content) + '</div>';
md.renderer.rules.fence = (tokens, i, options, env) => {
  const token = tokens[i], lang = token.info.trim().split(/\s+/)[0].toLowerCase();
  if (lang === 'mermaid') {
    const id = 'diagram-' + env.diagrams.length;
    env.diagrams.push({ id, source: token.content });
    return '<figure class="diagram selection-locked" data-source-line="' + (token.map[0]+1) + '" data-diagram="' + id + '"><div class="block-toolbar"><span>MERMAID</span><button data-action="diagram-selection">解锁选择</button><button data-action="diagram-open">查看图表</button><button data-action="diagram-full">全屏</button><button data-action="diagram-window">新窗口</button><button data-action="diagram-source">源码</button></div><div class="diagram-canvas">图表即将加载…</div></figure>';
  }
  return '<figure class="code-block" data-source-line="' + (token.map[0]+1) + '"><div class="block-toolbar"><span>' + esc(lang || 'text') + '</span><button data-action="copy-code">复制代码</button></div><pre><code data-language="' + esc(lang) + '">' + esc(token.content) + '</code></pre></figure>';
};
const originalImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, i, options, env, self) => {
  const token = tokens[i];
  token.attrSet('loading', 'lazy'); token.attrSet('decoding', 'async');
  return originalImage(tokens, i, options, env, self);
};
const originalQuote = md.renderer.rules.blockquote_open;
md.renderer.rules.blockquote_open = (tokens, i, options, env, self) =>
  (originalQuote ? originalQuote(tokens, i, options, env, self) : self.renderToken(tokens, i, options)) +
  (tokens[i].meta?.label ? '<div class="callout-label">' + esc(tokens[i].meta.label) + '</div>' : '');

export function parseMarkdown(text, conversation = false) {
  const env = { diagrams: [] };
  const tokens = md.parse(text, env), outline = [], used = new Map();
  let turn = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if(t.map && t.nesting===1) t.attrSet('data-source-line',String(t.map[0]+1));
    if (t.type === 'paragraph_open' && tokens[i + 1]?.type === 'inline') {
      const step = /^\*\*([0-9]+)[.)、]\s+/.exec(tokens[i + 1].content);
      if (step) { t.attrJoin('class', 'chat-step-title'); t.attrSet('data-step', step[1]); }
    }
    if (t.type === 'heading_open') {
      const title = tokens[i + 1]?.content || '';
      const slug = title.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'heading';
      const count = used.get(slug) || 0; used.set(slug, count + 1);
      const id = slug + (count ? '-' + count : '');
      t.attrSet('id', id);
      if (!conversation) outline.push({ title, level: Number(t.tag.slice(1)), id, turn: 0 });
    }
    if (t.type === 'blockquote_open' && tokens[i + 2]?.type === 'inline') {
      const inline = tokens[i + 2];
      const match = /^\[!(QUESTION|NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)/i.exec(inline.content);
      if (!match) continue;
      const kind = match[1].toUpperCase();
      const content = inline.content.replace(/^\[![A-Z]+\]\s*/i, '');
      inline.content = content; inline.children = [];
      md.inline.parse(content, md, env, inline.children);
      t.attrSet('class', 'callout ' + kind.toLowerCase());
      const labels = { NOTE: '备注', TIP: '提示', IMPORTANT: '重要', WARNING: '注意', CAUTION: '警告' };
      if (kind === 'QUESTION') {
        const id = 'question-' + (++turn);
        t.attrSet('id', id); t.meta = { label: '提问 ' + String(turn).padStart(2, '0') };
        outline.push({ title: content.replace(/\s+/g, ' ').trim(), level: 1, id, turn });
      } else t.meta = { label: labels[kind] };
    }
  }
  // Render balanced top-level groups. Never split nested lists, tables, quotes or footnotes.
  const chunks = [];
  let group = [], depth = 0, buffer = '';
  for (const token of tokens) {
    group.push(token); depth += token.nesting;
    if (depth !== 0) continue;
    buffer += md.renderer.render(group, md.options, env); group = [];
    if (buffer.length >= 6000) { chunks.push(buffer); buffer = ''; }
  }
  if (group.length) buffer += md.renderer.render(group, md.options, env);
  if (buffer) chunks.push(buffer);
  return { chunks, outline, diagrams: env.diagrams };
}
