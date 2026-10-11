import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const window = new Window({ url: 'chrome-extension://mica/popup.html' });
Object.assign(globalThis, { window, document: window.document });
document.body.innerHTML = `<span id="page-state"></span><button id="sync"></button><p id="status"></p><span id="history-count"></span><div id="history-list"></div><code id="extension-id"></code><button id="copy"></button>`;
let opened = '';
globalThis.chrome = {
  runtime: {
    id: 'mica-test-id',
    async sendMessage(message) {
      if (message.type === 'MICA_HISTORY') return { ok: true, history: [{ id: 'c1', title: '架构讨论', sourceUrl: 'https://chatgpt.com/c/c1', synced: true, messageCount: 12 }] };
      return { ok: true };
    }
  },
  tabs: {
    async query() { return [{ id: 7, url: 'https://chatgpt.com/c/current' }]; },
    async sendMessage(_id, message) { return message.type === 'MICA_PAGE_STATE' ? { ok: true, title: '当前对话', messageCount: 8 } : { ok: true, messageCount: 8 }; },
    async update(_id, options) { opened = options.url; },
    async create(options) { opened = options.url; }
  }
};
await import('./popup.js');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(document.querySelector('#page-state').textContent, '当前对话 · 8 条');
assert.equal(document.querySelector('#history-count').textContent, '1 个');
assert.equal(document.querySelector('.history-title').textContent, '架构讨论');
document.querySelector('.history-item').click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(opened, 'https://chatgpt.com/c/c1');
console.log('PASS Mica Sync: popup history and click navigation');
