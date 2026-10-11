// Adapted from LightSession's readerMessageText/readerRecords/loadReaderConversation.
// MIT attribution is included in THIRD-PARTY-NOTICES.txt.
(() => {
  const textOf = (message) => {
    const content = message.content;
    if (!content || !['text', 'multimodal_text'].includes(content.content_type ?? 'text')) return '';
    const text = (content.parts || []).map(part => typeof part === 'string' ? part :
      typeof part?.text === 'string' ? part.text : part?.content_type?.includes('image') ? '[图片]' : '').filter(Boolean).join('\n').trim();
    const references = new Map((message.metadata?.content_references || []).filter(r => typeof r?.matched_text === 'string' && typeof r?.alt === 'string').map(r => [r.matched_text, r.alt.trim()]));
    return text.replace(/[ \t]*(\ue200[^\ue201]*\ue201)/g, (_, marker) => references.has(marker) ? ` ${references.get(marker)}` : '');
  };
  const recordsOf = (messages) => messages.filter(m => m && typeof m.id === 'string' && ['user', 'assistant'].includes(m.author?.role) &&
    (!m.recipient || m.recipient === 'all') && m.metadata?.is_visually_hidden_from_conversation !== true && (!m.channel || m.channel === 'final')).map(m => ({
      id: m.id, role: m.author.role, text: textOf(m), format: 'markdown', time: typeof m.create_time === 'number' ? m.create_time : null,
      ...(m.metadata?.voice_mode_message === true ? { voice: true } : {})
    })).filter(m => m.text);
  const mappingMessages = (page) => {
    const messages = [], seen = new Set();
    let id = page.current_node;
    while (id && page.mapping?.[id] && !seen.has(id)) {
      seen.add(id); const node = page.mapping[id];
      if (node.message) messages.unshift(node.message);
      id = node.parent;
    }
    return messages;
  };
  const load = async (fetchPage, origin, id, options = {}) => {
    let before = null, records = [], title = '', complete = false;
    const seen = new Set();
    for (let index = 0; index < 100; index++) {
      const url = new URL(`/backend-api/conversations/${encodeURIComponent(id)}${before ? '/messages' : ''}`, origin);
      if (before) url.searchParams.set('before', before);
      url.searchParams.set('include_has_versions', 'true'); url.searchParams.set('num_turns', '100');
      let response = await fetchPage(url, options);
      if (response.status === 422) { url.searchParams.set('num_turns', '10'); response = await fetchPage(url, options); }
      if (index === 0 && response.status === 404) response = await fetchPage(new URL(`/backend-api/conversation/${encodeURIComponent(id)}`, origin), options);
      if (!response.ok) throw Error(`读取原始会话失败（HTTP ${response.status}），请刷新 ChatGPT 后重试`);
      const page = await response.json();
      if (page.mapping && page.current_node) return { title: page.title || '', records: recordsOf(mappingMessages(page)) };
      if (!Array.isArray(page.messages)) throw Error('原始会话接口格式不受支持，请使用“同步当前可见内容”');
      title ||= typeof page.title === 'string' ? page.title : '';
      records = [...recordsOf(page.messages), ...records];
      if (page.page_info?.has_previous_page !== true) { complete = true; break; }
      const cursor = page.page_info.start_cursor;
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw Error('历史消息分页中断，尚未取得完整会话');
      seen.add(cursor); before = cursor;
    }
    if (!complete) throw Error('会话超过分页限制，尚未取得完整会话');
    return { title, records: [...new Map(records.map(r => [r.id, r])).values()] };
  };
  globalThis.MicaConversationAPI = { load, recordsOf, mappingMessages };
})();
