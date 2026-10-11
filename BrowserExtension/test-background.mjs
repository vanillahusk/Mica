import assert from 'node:assert/strict';

let listener;
const state = {};
const opened = [];
globalThis.chrome = {
  tabs: { async create(tab) { assert(state.mica_reader_conversation_c1, 'snapshot saved before tab opens'); opened.push(tab); } },
  storage: { local: {
    async get(key) { return { [key]: state[key] }; },
    async set(value) { Object.assign(state, value); }
  } },
  runtime: {
    getURL: path => 'chrome-extension://test/' + path,
    onMessage: { addListener(fn) { listener = fn; } },
    async sendNativeMessage(_host, request) {
      assert.equal(request.type, 'syncConversation');
      return { ok: true, messageCount: request.conversation.messages.length };
    }
  }
};

await import('./background.js');
const send = (message) => new Promise((resolve) => {
  const pending = listener(message, {}, resolve);
  if (pending !== true) resolve(undefined);
});
const conversation = { id: 'c1', title: '统一调用方案', sourceUrl: 'https://chatgpt.com/c/c1', updatedAt: '2026-10-09T01:00:00Z', messages: [{ role: 'user', text: 'x' }] };
assert.deepEqual(await send({ type: 'MICA_SYNC', conversation }), { ok: true, messageCount: 1 });
await send({ type: 'MICA_DISCOVER_HISTORY', items: [{ id: 'c1', title: '统一调用方案', sourceUrl: conversation.sourceUrl, updatedAt: '2026-10-09T02:00:00Z', synced: false }, { id: 'c2', title: '另一个会话', sourceUrl: 'https://chatgpt.com/c/c2', updatedAt: '2026-10-09T02:00:00Z', synced: false }] });
const history = (await send({ type: 'MICA_HISTORY' })).history;
assert.equal(history.length, 2);
assert.equal(history.find((item) => item.id === 'c1').synced, true);
assert.equal(history.find((item) => item.id === 'c1').messageCount, 1);
console.log('PASS Mica Sync: local history and native sync state');
conversation.messages = [{id:'q/?中文',role:'user',text:'历史提问'}, {id:'a1',role:'assistant',text:'完整回答'}];
assert.deepEqual(await send({type:'MICA_OPEN_READER',conversation,messageId:'q/?中文'}),{ok:true});
const url = new URL(opened[0].url);
assert.equal(url.searchParams.get('target'),'q/?中文');
assert.equal(url.searchParams.get('conversation'),'c1');
assert.equal(state.mica_reader_conversation_c1.records[1].text,'完整回答');
assert.equal((await send({type:'MICA_OPEN_READER',conversation,messageId:'missing'})).ok,false);
assert.equal(opened.length,1);
chrome.storage.local.set = async () => { throw Error('storage full'); };
assert.match((await send({type:'MICA_OPEN_READER',conversation})).error,/storage full/);
assert.equal(opened.length,1,'storage failure must not open an empty reader');
console.log('PASS reader: save before opening, encoded target, invalid target and storage failure');
