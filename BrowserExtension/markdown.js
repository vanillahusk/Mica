(() => {
  const trim = (value) => value.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const diagramStart = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/i;
  const language = (pre) => {
    const code = pre.querySelector('code') || pre;
    if (pre.dataset.language || code.dataset.language) return (pre.dataset.language || code.dataset.language).toLowerCase();
    for (const name of [...Array.from(pre.classList), ...Array.from(code.classList)]) {
      const match = /^(?:language|lang)-(.+)$/i.exec(name);
      if (match) return match[1].toLowerCase();
    }
    const label = pre.querySelector('[data-language],header,[class*="code-header"],[class*="codeHeader"]')?.textContent?.trim().toLowerCase();
    if (label && /^(mermaid|javascript|typescript|python|java|go|rust|json|yaml|bash|shell|text)$/.test(label)) return label;
    return diagramStart.test((code.textContent || '').trim()) ? 'mermaid' : '';
  };
  const codeBlock = (node) => {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'pre') return node;
    if (tag === 'code' && !node.closest('pre') && (diagramStart.test((node.textContent || '').trim()) || (node.textContent || '').includes('\n'))) return node;
    if (node.matches?.('[data-testid*="code-block"],[data-testid*="codeBlock"],[class*="code-block"],[class*="codeBlock"],[class*="copyable-code"]')) {
      return node.querySelector('code') ? node : null;
    }
    return null;
  };
  const fenced = (block) => {
    const code = block.querySelector?.('code') || block;
    const source = (code.textContent || '').replace(/\n$/, '');
    const fence = source.includes('```') ? '````' : '```';
    return `\n\n${fence}${language(block)}\n${source}\n${fence}\n\n`;
  };
  const render = (node, depth = 0) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement) || node.matches('button,svg,[aria-hidden="true"],.sr-only')) return '';
    const tag = node.tagName.toLowerCase();
    const block = codeBlock(node);
    if (block) return fenced(block);
    const children = (nextDepth = depth) => Array.from(node.childNodes).map((child) => render(child, nextDepth)).join('');
    const body = () => children().trim();
    if (tag === 'br') return '\n';
    if (tag === 'code') return `\`${node.textContent || ''}\``;
    if (tag === 'strong' || tag === 'b') return `**${body()}**`;
    if (tag === 'em' || tag === 'i') return `*${body()}*`;
    if (tag === 'del' || tag === 's') return `~~${body()}~~`;
    if (tag === 'a') {
      const text = body(), href = node.getAttribute('href') || '';
      return href && href !== text ? `[${text}](${href})` : text || href;
    }
    if (tag === 'img') return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${body()}\n\n`;
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'blockquote') return `\n\n${body().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    if (tag === 'li') {
      const ordered = node.parentElement?.tagName.toLowerCase() === 'ol';
      const index = ordered ? Array.from(node.parentElement.children).indexOf(node) + 1 : 0;
      return `${'  '.repeat(depth)}${ordered ? `${index}.` : '-'} ${children(depth + 1).trim()}\n`;
    }
    if (tag === 'ul' || tag === 'ol') return `\n${Array.from(node.children).map((child) => render(child, depth)).join('')}\n`;
    if (tag === 'p') return `\n\n${body()}\n\n`;
    const content = children();
    return ['div', 'section', 'article'].includes(tag) ? `${content}\n` : content;
  };
  const repairDiagramParagraphs = (value) => value.split(/\n\n/).map((part) => {
    const text = part.trim();
    return diagramStart.test(text) ? `\`\`\`mermaid\n${text}\n\`\`\`` : part;
  }).join('\n\n');
  const markdown = (element) => trim(repairDiagramParagraphs(render(element)));
  const hostOf = (node) => node.closest('article,[data-testid^="conversation-turn"]') || node.closest('[data-turn-id-container],[data-message-id]') || node;
  const contentOf = (host, role) => role === 'user'
    ? host.querySelector('.user-message-bubble-color .whitespace-pre-wrap,.user-message-bubble-color,[data-turn="user"] .whitespace-pre-wrap,[data-message-content]') || host
    : host.querySelector('.markdown-new-styling,.markdown.prose,.markdown,[data-message-content]') || host;
  const hash = (value) => {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  };
  const conversationId = (root, messages) => {
    const paths = [location.pathname, root.querySelector('link[rel="canonical"]')?.href || '', root.querySelector('meta[property="og:url"]')?.content || ''];
    for (const value of paths) {
      const match = value.match(/(?:^|\/)c\/([^/?#]+)/) || value.match(/(?:^|\/)share\/([^/?#]+)/);
      if (match) return match[1];
    }
    const marked = root.querySelector('[data-conversation-id]')?.dataset.conversationId;
    if (marked) return marked;
    return `local-${hash(`${location.origin}${location.pathname}|${document.title}|${messages[0]?.text || ''}`)}`;
  };
  // Candidate discovery adapted from LightSession (MIT).
  const candidates = (root = document) => {
    const scope = root.querySelector('main') || root, result = [], seen = new Set();
    const add = (role, element) => {
      const host = hostOf(element);
      if (seen.has(host)) return;
      seen.add(host); result.push({ role, host, content: contentOf(host, role) });
    };
    for (const node of scope.querySelectorAll('[data-message-author-role="user"],[data-message-author-role="assistant"],[data-turn="user"],[data-turn="assistant"]')) add(node.dataset.messageAuthorRole || node.dataset.turn, node);
    for (const node of scope.querySelectorAll('.user-message-bubble-color')) add('user', node);
    for (const node of scope.querySelectorAll('.markdown.prose,.markdown-new-styling,.markdown')) {
      if (!node.closest('.user-message-bubble-color') && !node.parentElement?.closest('.markdown,.markdown-new-styling')) add('assistant', node);
    }
    result.sort((a,b) => a.host.compareDocumentPosition(b.host) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    return result;
  };
  const collect = (root = document) => {
    const seen = new Set(), messages = [];
    for (const {host, role, content} of candidates(root)) {
      if (seen.has(host)) continue;
      if (role !== 'user' && role !== 'assistant') continue;
      seen.add(host);
      const text = markdown(content);
      if (!text) continue;
      const markedId = host.querySelector('[data-message-id]')?.dataset.messageId || host.querySelector('[data-turn-id]')?.dataset.turnId;
      const id = markedId || host.dataset.messageId || host.dataset.turnIdContainer || `${role}-${hash(text)}-${messages.length}`;
      messages.push({ id, role, text, time: null });
    }
    if (!messages.length) throw new Error('当前页面还没有可同步的对话消息');
    return {
      version: 1,
      id: conversationId(root, messages),
      title: document.title.replace(/\s*[|—-]\s*ChatGPT\s*$/i, '').replace(/^ChatGPT$/i, '').trim() || root.querySelector('nav a[aria-current="page"],aside a[aria-current="page"]')?.textContent?.trim() || 'ChatGPT 对话',
      sourceUrl: location.href,
      updatedAt: new Date().toISOString(),
      messages
    };
  };
  globalThis.MicaMarkdown = { markdown, collect, conversationId, candidates };
})();
