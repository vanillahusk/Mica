const $=(selector)=>document.querySelector(selector);
let activeTab=null;
$('#extension-id').textContent=chrome.runtime.id;
$('#copy').onclick=async()=>{await navigator.clipboard.writeText(chrome.runtime.id);$('#copy').textContent='已复制';setTimeout(()=>$('#copy').textContent='复制扩展 ID',1200)};
const askPage=async()=>{
  [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!activeTab?.id)return {ok:false,error:'没有活动标签页'};
  try{return await chrome.tabs.sendMessage(activeTab.id,{type:'MICA_PAGE_STATE'});}catch{return {ok:false,error:'请打开或刷新一个 ChatGPT 页面'};}
};
const renderHistory=async()=>{
  const result=await chrome.runtime.sendMessage({type:'MICA_HISTORY'});
  const history=result?.history||[],list=$('#history-list');
  $('#history-count').textContent=history.length?`${history.length} 个`:'';
  if(!history.length){list.innerHTML='<p class="empty">打开过的 ChatGPT 会话会显示在这里。</p>';return;}
  list.replaceChildren(...history.map((item)=>{
    const button=document.createElement('button');button.className='history-item';button.dataset.url=item.sourceUrl;
    const title=document.createElement('span');title.className='history-title';title.textContent=item.title||'未命名对话';
    const meta=document.createElement('small');meta.textContent=item.synced?`已同步${item.messageCount?` · ${item.messageCount} 条`:''}`:'ChatGPT 会话';
    button.append(title,meta);button.onclick=async()=>{if(activeTab?.id)await chrome.tabs.update(activeTab.id,{url:item.sourceUrl});else await chrome.tabs.create({url:item.sourceUrl});window.close();};
    return button;
  }));
};
$('#sync').onclick=async()=>{const status=$('#status');status.textContent='正在同步…';try{const state=await askPage();if(!state?.ok)throw Error(state?.error||'当前不是对话页面');const result=await chrome.tabs.sendMessage(activeTab.id,{type:'MICA_TRIGGER_SYNC'});if(!result?.ok)throw Error(result?.error||'同步失败');status.textContent=`已同步 ${result.messageCount??state.messageCount} 条消息，Mica 已打开。`;await renderHistory();}catch(error){status.textContent=error?.message||'同步失败';}};
(async()=>{const state=await askPage();$('#page-state').textContent=state?.ok?`${state.title} · ${state.messageCount} 条`:state?.error||'当前不是对话页面';$('#sync').disabled=!state?.ok;await renderHistory();})();
