import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://chatgpt.com/c/one' });
Object.assign(globalThis, {
  window, document: window.document, location: window.location,
  Node: window.Node, HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver, CustomEvent: window.CustomEvent,
});
let interval;
globalThis.setInterval = callback => { interval = callback; return 1; };
let pageListener;
globalThis.chrome = {
  runtime: {
    onMessage: { addListener(callback) { pageListener = callback; } },
    async sendMessage() { return { ok: true }; }
  }
};
const conversations = {
  one: [{ id: 'one-q1', role: 'user', text: '第一个会话问题' }, { id: 'one-a1', role: 'assistant', text: '回答' }],
  two: [{ id: 'two-q1', role: 'user', text: '第二个会话问题' }, { id: 'two-a1', role: 'assistant', text: '回答' }]
};
const paint = (id, extra = '') => {
  document.body.innerHTML = `<main><article data-testid="conversation-turn-0" data-turn-id-container="${id}-visible"><div class="user-message-bubble-color"><div class="whitespace-pre-wrap"><p>${id === 'one' ? '第一个会话问题' : '第二个会话问题'}</p></div></div></article>${extra}</main>`;
};
paint('one');
window.addEventListener('mica-reader-request', event => {
  const request = JSON.parse(event.detail), id = location.pathname.split('/').pop();
  queueMicrotask(() => window.dispatchEvent(new CustomEvent('mica-reader-result', { detail: JSON.stringify({
    requestId: request.requestId, conversationId: id, title: id, records: conversations[id]
  }) })));
});

await import('./markdown.js');
await import('./content.js');
await new Promise(resolve => setTimeout(resolve, 350));
assert.equal(document.querySelectorAll('#mica-reader-sidebar nav button').length, 1);
assert.equal(document.querySelector('[data-mica-visible]'), null, 'partial-sync action must not exist');

window.history.pushState({}, '', '/c/two');
paint('two'); interval();
await new Promise(resolve => setTimeout(resolve, 350));
assert.match(document.querySelector('#mica-reader-sidebar nav button').textContent, /第二个会话问题/);

document.querySelector('main').insertAdjacentHTML('beforeend', '<article data-testid="conversation-turn-2" data-turn-id-container="two-q2"><div class="user-message-bubble-color"><div class="whitespace-pre-wrap"><p>继续追问的新问题</p></div></div></article>');
await new Promise(resolve => setTimeout(resolve, 650));
assert.equal(document.querySelectorAll('#mica-reader-sidebar nav button').length, 2);
assert.match(document.querySelector('#mica-reader-sidebar nav button:last-child').textContent, /继续追问的新问题/);

let reply;
await new Promise(resolve => { pageListener({ type: 'MICA_PAGE_STATE' }, {}, value => { reply = value; resolve(); }); });
assert.equal(reply.id, 'two');
console.log('PASS Mica Sync: live route and appended-turn updates, complete-sync-only UI');
