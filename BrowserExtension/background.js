const HISTORY_KEY = 'micaConversationHistory';
const readHistory = async () => (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] || [];
const mergeHistory = async (items) => {
  const existing = await readHistory();
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of items) {
    if (!item?.id || !item?.sourceUrl) continue;
    const old = byId.get(item.id) || {};
    byId.set(item.id, {
      ...old,
      ...item,
      title: item.title || old.title || '未命名对话',
      updatedAt: item.synced ? item.updatedAt : old.updatedAt || item.updatedAt,
      messageCount: item.messageCount ?? old.messageCount,
      synced: old.synced === true || item.synced === true
    });
  }
  const history = [...byId.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 100);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  return history;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'MICA_OPEN_READER') {
    (async () => {
      const conversation = message.conversation;
      if (!conversation?.id || !Array.isArray(conversation.messages) || !conversation.messages.length ||
          !conversation.messages.every(r => typeof r.id === 'string' && typeof r.text === 'string' && ['user', 'assistant'].includes(r.role))) {
        throw Error('没有可阅读的完整会话，请重新加载目录');
      }
      if (message.messageId && !conversation.messages.some(r => r.role === 'user' && r.id === message.messageId)) {
        throw Error('目标提问不在当前会话中，请重新加载目录');
      }
      const snapshot = {
        version: 1, conversationId: conversation.id, title: conversation.title || 'ChatGPT 对话',
        sourceUrl: conversation.sourceUrl, signature: String(Date.now()),
        records: conversation.messages.map(r => ({ id: r.id, role: r.role, text: r.text, time: typeof r.time === 'number' ? r.time : null }))
      };
      // Save before opening: the reader must never race an incomplete snapshot.
      await chrome.storage.local.set({ ['mica_reader_conversation_' + conversation.id]: snapshot });
      const query = new URLSearchParams({ conversation: conversation.id });
      if (message.messageId) query.set('target', message.messageId);
      await chrome.tabs.create({ url: chrome.runtime.getURL('reader/reader.html?' + query) });
      return { ok: true };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'MICA_HISTORY') {
    readHistory().then((history) => sendResponse({ ok: true, history })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'MICA_DISCOVER_HISTORY') {
    mergeHistory(message.items || []).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== 'MICA_SYNC') return;
  chrome.runtime.sendNativeMessage('com.mica.desktop', {
    type: 'syncConversation', protocolVersion: 1, open: message.open !== false, conversation: message.conversation
  }).then(async (result) => {
    if (result?.ok !== true) throw new Error(result?.error || 'Mica 拒绝了同步请求');
    let warning;
    try { await mergeHistory([{
      id: message.conversation.id,
      title: message.conversation.title,
      sourceUrl: message.conversation.sourceUrl,
      updatedAt: message.conversation.updatedAt,
      messageCount: result.messageCount ?? message.conversation.messages.length,
      synced: true
    }]); } catch { warning = '桌面端已保存，但插件历史记录保存失败'; }
    sendResponse({ ok: true, messageCount: result.messageCount, ...(warning ? {warning} : {}) });
  }).catch((error) => sendResponse({ ok: false, error: error?.message || '未连接到 Mica' }));
  return true;
});
