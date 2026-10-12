(() => {
  if (globalThis.__micaContent) return;
  globalThis.__micaContent = true;
  let panel, status, list, lastURL = '', records = [], readerTitle = '', pending, updateTimer, indexTimer, rawTimer;
  const currentID = () => location.pathname.match(/\/c\/([^/?#]+)/)?.[1];
  const say = text => { if (status) status.textContent = text; };
  const loadRaw = () => {
    const id = currentID();
    if (!id) return Promise.reject(Error('当前地址还不是已保存的对话，暂时无法读取完整内容'));
    if (pending?.id === id) return pending.promise;
    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); window.removeEventListener('mica-reader-result', handler); };
      const handler = event => {
        let result; try { result = JSON.parse(event.detail); } catch { return; }
        if (result.requestId !== requestId || result.conversationId !== id) return;
        finish();
        if (currentID() !== id) { reject(Error('页面已切换，请重新同步')); return; }
        if (result.error) { reject(Error(result.error)); return; }
        if (!Array.isArray(result.records) || !result.records.length) { reject(Error('原始会话尚无可同步消息，请等待回复完成后重试')); return; }
        records = result.records; readerTitle = result.title || document.title; renderOutline();
        resolve({ version: 1, id, title: result.title || document.title, sourceUrl: location.href, updatedAt: new Date().toISOString(), complete: true, messages: records });
      };
      const timer = setTimeout(() => { finish(); reject(Error('原文读取未响应，请刷新 ChatGPT 页面后重试')); }, 48000);
      window.addEventListener('mica-reader-result', handler);
      window.dispatchEvent(new CustomEvent('mica-reader-request', { detail: JSON.stringify({ requestId, conversationId: id }) }));
    });
    pending = { id, promise };
    promise.finally(() => { if (pending?.promise === promise) pending = null; }).catch(() => {});
    return promise;
  };
  let syncing = false;
  const sync = async () => {
    if (syncing) throw Error('正在同步，请稍候');
    syncing = true;
    say('正在读取完整原文…');
    try {
      const conversation = await loadRaw();
      const result = await chrome.runtime.sendMessage({ type: 'MICA_SYNC', conversation, open: true });
      if (!result?.ok) throw Error(result?.error || '桌面端没有确认同步');
      say('已同步 ' + (result.messageCount ?? conversation.messages.length) + ' 条完整消息' + (result.warning ? '；'+result.warning : ''));
      return result;
    } catch (error) { say(error.message); throw error; }
    finally { syncing = false; }
  };
  let openingReader = false;
  const openReader = async messageId => {
    if (openingReader) return;
    openingReader = true;
    say('正在打开完整对话阅读页…');
    try {
      const conversation = records.length && lastURL === location.href ? { id: currentID(), title: readerTitle || document.title, sourceUrl: location.href, messages: records } : await loadRaw();
      const result = await chrome.runtime.sendMessage({ type: 'MICA_OPEN_READER', conversation, messageId });
      if (!result?.ok) throw Error(result?.error || '阅读页未能打开');
      say(messageId ? '已在新阅读页定位到该提问' : '已打开完整对话阅读页');
    } catch (error) { say(error.message); }
    finally { openingReader = false; }
  };
  const jump = record => {
    const candidate = MicaMarkdown.candidates(document).find(c => c.role === 'user' && (
      c.host.dataset.messageId === record.id || c.host.dataset.turnIdContainer === record.id ||
      [...c.host.querySelectorAll('[data-message-id]')].some(n => n.dataset.messageId === record.id) ||
      c.content.textContent.replace(/\s+/g,' ').trim() === record.text.replace(/\s+/g,' ').trim()));
    if (!candidate) { void openReader(record.id); return; }
    candidate.host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    candidate.host.animate?.([{ outline: '2px solid #a695df' }, { outline: '2px solid transparent' }], { duration: 1400 });
    say('已定位到原消息');
  };
  function renderOutline() {
    if (!list) return;
    let visible = [];
    try { visible = MicaMarkdown.collect(document).messages.filter(r => r.role === 'user'); } catch {}
    const entries = [...records.filter(r => r.role === 'user')];
    const known = new Set(entries.flatMap(r => [r.id, r.text.replace(/\s+/g,' ').trim()]));
    for (const record of visible) if (!known.has(record.id) && !known.has(record.text.replace(/\s+/g,' ').trim())) entries.push(record);
    const signature = JSON.stringify(entries.map(r => [r.id,r.text]));
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.replaceChildren(...entries.map((record,index) => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = (index+1) + '. ' + record.text.replace(/\s+/g,' ').slice(0,120);
      button.title = record.text.slice(0,500); button.onclick = () => jump(record);
      return button;
    }));
  }
  let historySignature = '';
  const discover = () => {
    const items = [...document.querySelectorAll('nav a[href*="/c/"],aside a[href*="/c/"]')].map(link => {
      const url = new URL(link.href,location.href), id = url.pathname.match(/\/c\/([^/?#]+)/)?.[1];
      return { id, title: link.textContent.trim(), sourceUrl: url.href };
    }).filter(i => i.id && i.title);
    const signature = JSON.stringify(items);
    if (items.length && signature !== historySignature) {
      historySignature = signature;
      chrome.runtime.sendMessage({type:'MICA_DISCOVER_HISTORY',items:items.map(i=>({...i,updatedAt:new Date().toISOString()}))}).catch(()=>{historySignature='';});
    }
  };
  const scheduleRawRefresh = (delay = 900) => {
    const id = currentID(); if (!id) return;
    clearTimeout(rawTimer);
    rawTimer = setTimeout(() => {
      if (currentID() !== id) return;
      const before = JSON.stringify(records.map(r => [r.id,r.text]));
      loadRaw().then(() => {
        if (!syncing && before !== JSON.stringify(records.map(r => [r.id,r.text]))) say('对话已实时更新');
      }).catch(error => { if (!records.length && !syncing) say(error.message); });
    }, delay);
  };
  function refresh() {
    if (!panel?.isConnected) {
      panel = document.createElement('aside'); panel.id = 'mica-reader-sidebar';
      panel.innerHTML = '<header><strong>Mica · 提问目录</strong><button type="button" aria-label="收起目录">−</button></header><div class="mica-actions"><button type="button" id="mica-sync-button">同步完整对话</button><button type="button" data-mica-index>加载完整目录</button></div><p role="status"></p><nav aria-label="当前对话提问目录"></nav>';
      document.body.append(panel); status = panel.querySelector('p'); list = panel.querySelector('nav');
      const readerButton = document.createElement('button');
      readerButton.type = 'button'; readerButton.textContent = '在新页阅读'; readerButton.dataset.micaReader = '';
      readerButton.onclick = () => { void openReader(); };
      panel.querySelector('.mica-actions').append(readerButton);
      panel.querySelector('header button').onclick = event => { panel.classList.toggle('collapsed'); event.target.textContent = panel.classList.contains('collapsed') ? '+' : '−'; };
      panel.querySelector('#mica-sync-button').onclick = () => { void sync().catch(()=>{}); };
      panel.querySelector('[data-mica-index]').onclick = () => { say('正在加载历史提问…'); loadRaw().then(()=>say('完整目录已加载')).catch(e=>say(e.message)); };
    }
    if (lastURL !== location.href) {
      lastURL = location.href; records = []; readerTitle = ''; say('点击提问定位；未加载的历史提问将在新阅读页打开');
      clearTimeout(indexTimer);
      if (currentID()) indexTimer = setTimeout(() => {
        loadRaw().then(() => { if (!syncing) say('历史提问已加载，点击可定位'); }).catch(error => { if (!syncing) say(error.message); });
      }, 250);
    }
    renderOutline(); discover(); scheduleRawRefresh();
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply) => {
    if (message?.type === 'MICA_PAGE_STATE') {
      let count=0; try{count=MicaMarkdown.collect(document).messages.length;}catch{}
      const id=currentID(); reply({ok:!!id || count>0,id,title:document.title,messageCount:count,url:location.href,error:!id && !count?'请打开一个 ChatGPT 对话':undefined}); return;
    }
    if (message?.type === 'MICA_TRIGGER_SYNC') { sync().then(reply).catch(e=>reply({ok:false,error:e.message})); return true; }
  });
  refresh();
  new MutationObserver(changes => {
    if(changes.every(change=>panel?.contains(change.target)))return;
    clearTimeout(updateTimer); updateTimer=setTimeout(refresh,500);
  }).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',refresh);
  window.addEventListener('hashchange',refresh);
  window.navigation?.addEventListener('navigate',()=>setTimeout(refresh,0));
  setInterval(()=>{if(location.href!==lastURL)refresh();},400);
})();
