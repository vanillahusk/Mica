import { parseMarkdown,parseConversationSource } from './parser.js';
self.onmessage = ({ data }) => {
  try {
    const start = performance.now();
    const result = data.richMode==='source' ? parseConversationSource(data.rawMessages) : parseMarkdown(data.text, data.conversation, data.richMode || 'rich');
    self.postMessage({ id: data.id, result, parseMs: performance.now() - start });
  } catch (error) { self.postMessage({ id: data.id, error: String(error.message || error) }); }
};
