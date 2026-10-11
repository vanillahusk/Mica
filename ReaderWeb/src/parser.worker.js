import { parseMarkdown } from './parser.js';
self.onmessage = ({ data }) => {
  try {
    const start = performance.now();
    const result = parseMarkdown(data.text, data.conversation);
    self.postMessage({ id: data.id, result, parseMs: performance.now() - start });
  } catch (error) { self.postMessage({ id: data.id, error: String(error.message || error) }); }
};
