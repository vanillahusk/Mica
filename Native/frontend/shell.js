'use strict';
const $=id=>document.getElementById(id),frame=$('reader');
const documentFrame=document.createElement('iframe');documentFrame.hidden=true;documentFrame.title='PDF 与文本阅读区';documentFrame.src='document-view.html';frame.after(documentFrame);
const documentReady=new Promise(resolve=>documentFrame.onload=resolve);
const richDoc=()=>!doc?.kind||doc.kind==='markdown';
const api=()=>window.go.main.App;
let doc=null,rev=0,dirty=false,editing=false,notes=[],noteDraft=null,noteMissing=new Set(),prefs={theme:'warm',zoom:100,gptMode:'rich',positions:{},recent:[]},files=[],conversations=[],ready=false,transientWindow=false,pendingFind='',lastDeletedNote=null,searchTimer=0;
const gptModeField=document.createElement('label'),gptMode=document.createElement('select');gptModeField.id='gpt-mode-field';gptModeField.hidden=true;gptModeField.append('会话显示',gptMode);for(const [value,label]of [['rich','富文本'],['compact','简洁'],['source','原文']]){const option=document.createElement('option');option.value=value;option.textContent=label;gptMode.append(option)}document.querySelector('.appearance-menu').append(gptModeField);
const report=e=>{$('notice').textContent=String(e?.message||e);console.error(e)};
const call=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(report);
const send=m=>frame.contentWindow.mica?.receive(m);
const snapshot=()=>frame.contentWindow.mica?.editorSnapshot();
let shelf=null;
const oldShowLists=showLists;
async function openRecorded(item){if(!await leave())return;await open(item.path.startsWith('conversation:')?await api().Conversation(item.path.slice(13)):await api().OpenKnown(item.path))}
function renderLibraryMeta(){
 const recent=(prefs.recent||[]).filter(item=>item?.path&&item?.title),current=recent[0],card=$('continue-reading');
 if(current){const position=prefs.positions?.[current.path]||{},progress=Number(position.progress);card.hidden=false;card.querySelector('strong').textContent=current.title;card.querySelector('span').textContent=current.conversation?'ChatGPT 对话':'本地文档';card.querySelector('small').textContent=Number.isFinite(progress)?Math.round(progress*100)+'%':position.page?'第 '+position.page+' 页':'继续';card.querySelector('i').style.setProperty('--reading-progress',Number.isFinite(progress)?Math.round(progress*100)+'%':'0%');card.onclick=call(()=>openRecorded(current))}else card.hidden=true;
 $('recent-list').replaceChildren(...recent.slice(1,6).map(item=>{const row=button(item.title,()=>openRecorded(item),'recent-item');const kind=document.createElement('small');kind.textContent=item.conversation?'对话':'文档';row.append(kind);return row}));
 $('conversation-count').textContent=String(conversations.length);
}
showLists=()=>{if(!shelf)return oldShowLists();const q=$('filter').value.toLocaleLowerCase();shelf.render(files,q);$('conversations').replaceChildren(...conversations.filter(c=>c.title.toLocaleLowerCase().includes(q)).map(c=>button(c.title,async()=>{if(await leave())await open(await api().Conversation(c.id))})));renderLibraryMeta()};
import('./library-ui-v2.js').then(({createLibrary})=>{shelf=createLibrary({api,report,open:async d=>{if(await leave())await open(await api().OpenKnown(d.path))},changed:async()=>{files=await api().Library();showLists()},categories:()=>[...new Set([...(prefs.categories||[]),...files.map(f=>f.category).filter(Boolean)])],saveCategories:async names=>{prefs.categories=names;await persist()},removed:path=>{if(prefs.lastPath===path)delete prefs.lastPath;delete prefs.positions?.[path];persist()}});showLists()}).catch(report);
function setDirty(value){dirty=value;api().Dirty(value);$('save').disabled=!value;$('title').textContent=(doc?.title||'打开文档')+(value?' · 未保存':'')}
let preferenceWrites=Promise.resolve();
function persist(){if(transientWindow)return Promise.resolve();const raw=JSON.stringify(prefs);preferenceWrites=preferenceWrites.catch(()=>{}).then(()=>api().Preferences(raw)).catch(report);return preferenceWrites}
window.micaDocumentPosition=(path,anchor)=>{if(doc?.path!==path)return;prefs.positions??={};prefs.positions[path]=anchor;if(doc.kind==='pdf')$('progress').textContent='第 '+anchor.page+' 页';persist()};
function button(text,fn,cls='item'){const el=document.createElement('button');el.className=cls;el.textContent=text;el.onclick=call(fn);return el}
function showLists(){const q=$('filter').value.toLocaleLowerCase();$('files').replaceChildren(...files.filter(f=>f.title.toLocaleLowerCase().includes(q)).map(f=>{const b=button(f.title+(f.missing?' · 文件已移动':''),async()=>{if(await leave())await open(await api().OpenKnown(f.path))});b.title=f.path;return b}));$('conversations').replaceChildren(...conversations.filter(c=>c.title.toLocaleLowerCase().includes(q)).map(c=>button(c.title,async()=>{if(await leave())await open(await api().Conversation(c.id))})));}
async function refresh(){conversations=await api().Conversations();showLists()}
function confirmLeave(){return new Promise(resolve=>{const d=$('confirm');d.showModal();d.oncancel=()=>resolve('cancel');d.querySelectorAll('button').forEach(b=>b.onclick=()=>{d.close();resolve(b.dataset.confirm)})})}
async function leave(){if(!dirty)return true;const answer=await confirmLeave();if(answer==='cancel')return false;if(answer==='save')return await save();return true}
async function save(){if(!doc)return false;const state=snapshot();if(state?.composing)throw Error('请先完成中文输入');const text=state?.text??doc.text;const saved=doc.conversation?await api().SaveAs(text):await api().Save(doc.path,text,doc.revision);if(!saved)return false;doc=saved;setDirty(false);return true}
async function open(next){
 if(!next)return;await documentReady;documentFrame.contentWindow.documentReader?.position();if(editing){frame.contentWindow.mica.endEditing();editing=false}doc=next;setDirty(false);$('welcome').hidden=true;frame.hidden=!richDoc();documentFrame.hidden=richDoc();
 prefs.lastPath=doc.path;prefs.recent=[{path:doc.path,title:doc.title,conversation:!!doc.conversation,at:Date.now()},...(prefs.recent||[]).filter(item=>item.path!==doc.path)].slice(0,12);await persist();renderLibraryMeta();
 if(!doc.conversation&&!files.some(f=>f.path===doc.path)){files.push({path:doc.path,title:doc.title});showLists()}
 $('read').setAttribute('aria-pressed','true');$('edit').setAttribute('aria-pressed','false');$('edit').disabled=doc.conversation||!richDoc();
 $('save-as').textContent=doc.conversation?'另存为可编辑副本':'另存为';$('delete-conversation').hidden=!doc.conversation;gptModeField.hidden=!doc.conversation;gptMode.value=prefs.gptMode||'rich';const state=$('source-state');state.hidden=!doc.conversation;state.classList.toggle('warning',!!doc.warnings?.length);state.textContent=doc.sample?'内置示例 · 可体验目录、图表与笔记':doc.conversation?(doc.warnings?.length?'图表增强 '+doc.warnings.length+' · 原文未修改':'同步原件 · 只读 · '+(doc.messageCount||0)+' 条')+(doc.syncedAt?' · '+doc.syncedAt:''):'';
 if(!richDoc()) {++rev;$('outline').replaceChildren();$('outline-panel').querySelector('h3').textContent=doc.kind==='pdf'?'PDF · 使用正文上方页码跳转':'纯文本';await documentFrame.contentWindow.documentReader.open(doc,prefs.positions?.[doc.path]);await palette();notes=await api().Notes(doc.path);showNotes();$('notice').textContent=doc.kind==='pdf'?'PDF · 按页加载，可选择文字':'纯文本 · 只读（保留原始编码）';return}
 await documentFrame.contentWindow.documentReader?.close();
 const renderId=++rev;await renderCurrent(renderId,prefs.positions?.[doc.path]);
 const loaded=await api().Notes(doc.path);if(rev===renderId){notes=loaded;showNotes()}
}
async function renderCurrent(renderId=++rev,anchor=prefs.positions?.[doc?.path]){if(!doc||!richDoc())return;const richMode=doc.conversation?(prefs.gptMode||'rich'):'rich',rawMessages=doc.conversation&&richMode==='source'?await api().ConversationSource(doc.path.slice(13)):undefined;send({type:'render',id:renderId,key:doc.path,text:doc.text,conversation:doc.conversation,richMode,messages:doc.conversation?doc.messages:undefined,rawMessages,imageBase:doc.conversation?null:new URL('/local-image/',location.href).href,anchor,offset:0})}
async function addDocuments(added,openFirst=false){if(!added?.length)return;files=await api().Library();showLists();$('library').hidden=false;if(openFirst&&await leave())await open(await api().OpenKnown(added[0].path));$('notice').textContent='已添加 '+added.length+' 个文档'}
async function chooseFile(){await addDocuments(await api().OpenFiles(),true)}
async function chooseFolder(){await addDocuments(await api().OpenFolder(),false)}
function findCurrent(){
 if(!doc)return;
 if(richDoc())send({type:'find'});
 else documentFrame.contentWindow.micaOpenFind?.();
}
function recentResults(){return (prefs.recent||[]).map(item=>({kind:item.conversation?'conversation':'document',path:item.path,title:item.title,detail:'最近阅读'}))}
function renderSearchResults(results,query=''){
 const host=$('search-results');if(!results.length){const empty=document.createElement('div');empty.className='search-empty';empty.textContent=query?'没有找到匹配内容':'还没有最近阅读记录';host.replaceChildren(empty);return}
 host.replaceChildren(...results.map(result=>{const el=document.createElement('button');el.className='search-result';el.setAttribute('role','option');const kind=document.createElement('small');kind.textContent=result.kind==='conversation'?'会话':'文档';const title=document.createElement('b');title.textContent=result.title;const detail=document.createElement('span');detail.textContent=result.snippet||result.detail||result.path;el.append(kind,title,detail);el.onclick=call(()=>openSearchResult(result,query));return el}))
}
async function openSearch(){clearTimeout(searchTimer);$('global-search-input').value='';renderSearchResults(recentResults());$('search-help').textContent='输入内容搜索正文；留空显示最近阅读。';$('search-dialog').showModal();setTimeout(()=>$('global-search-input').focus(),0)}
async function runSearch(){const query=$('global-search-input').value.trim();$('search-help').textContent=query?'正在搜索本地文档与会话…':'输入内容搜索正文；留空显示最近阅读。';const results=query?await api().Search(query):recentResults();if(query!==$('global-search-input').value.trim())return;renderSearchResults(results,query);$('search-help').textContent=query?'找到 '+results.length+' 项':'输入内容搜索正文；留空显示最近阅读。'}
async function openSearchResult(result,query){if(!await leave())return;$('search-dialog').close();const next=result.path.startsWith('conversation:')?await api().Conversation(result.path.slice(13)):await api().OpenKnown(result.path);pendingFind=query;await open(next);if(query&&!richDoc()){documentFrame.contentWindow.documentReader.find(query);pendingFind=''}}
async function setMode(edit){if(!doc||!richDoc()||edit===editing||edit&&doc.conversation)return;const state=snapshot();if(state?.composing)throw Error('请先完成中文输入');if(state)doc.text=state.text;
 if(edit){send({type:'edit',id:rev,text:doc.text});editing=true}else{frame.contentWindow.mica.endEditing();editing=false;send({type:'render',id:++rev,key:doc.path,text:doc.text,conversation:doc.conversation,imageBase:doc.conversation?null:new URL('/local-image/',location.href).href,anchor:prefs.positions?.[doc.path]})}
 $('read').setAttribute('aria-pressed',String(!edit));$('edit').setAttribute('aria-pressed',String(edit));
}
async function palette(){const themes=await(await fetch('themes.json')).json(),theme=themes.find(t=>t.id===prefs.theme)||themes[0];for(const [k,v]of Object.entries(theme.colors))document.documentElement.style.setProperty('--'+k,v);document.documentElement.style.colorScheme=theme.scheme;$('theme').value=theme.id;$('zoom').value=prefs.zoom||100;$('zoom-value').textContent=$('zoom').value+'%';send({type:'theme',id:theme.id});send({type:'zoom',value:prefs.zoom||100});await documentReady;documentFrame.contentWindow.documentReader?.theme(theme,prefs.zoom||100);persist()}
function showNotes(sync=true){
 if(sync)send({type:'annotations',id:rev,notes});$('notes-context').textContent=doc?'当前文档 · '+doc.title+' · 仅保存在本机':'';
 const ordered=[...notes].sort((a,b)=>String(b.updated||'').localeCompare(String(a.updated||'')));
 if(!ordered.length){const empty=document.createElement('p');empty.className='quiet';empty.textContent='还没有笔记。选中文字可高亮、加笔记或标签。';$('notes').replaceChildren(empty);return}
 $('notes').replaceChildren(...ordered.map(n=>{
  const anchored=!!n.anchor?.quote,kind=n.kind||(n.text?'note':n.tags?.length?'tag':'highlight'),names={highlight:'高亮',note:'笔记',tag:'标签'},el=document.createElement('article');el.className='note note-'+kind+(noteMissing.has(n.id)?' missing':'');el.tabIndex=0;el.title=anchored?'点击回到原文位置':'全文笔记';
  const head=document.createElement('div');head.className='note-head';const type=document.createElement('b');type.className='note-kind';type.textContent=names[kind]||'笔记';const location=document.createElement('span');location.textContent=anchored?'原文位置':'全文';const edit=document.createElement('button');edit.textContent='编辑';edit.title='编辑这条'+(names[kind]||'笔记');edit.onclick=e=>{e.stopPropagation();editNote(n,kind)};head.append(type,location,edit);el.append(head);
  if(anchored){const quote=document.createElement('div');quote.className='note-quote';quote.textContent='“'+n.anchor.quote.slice(0,220)+'”';el.append(quote)}
  if(n.text){const body=document.createElement('div');body.className='note-body';body.textContent=n.text.slice(0,260);el.append(body)}
  const tags=document.createElement('small');tags.textContent=(n.tags||[]).map(t=>'#'+t).join(' ');if(tags.textContent)el.append(tags);
  const activate=()=>anchored?navigateNote(n):editNote(n);el.onclick=activate;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate()}};return el
 }))
}
function navigateNote(n){if(!richDoc()||!n.anchor?.quote)return editNote(n);send({type:'annotation-navigate',id:rev,noteId:n.id});$('notice').textContent='已定位到笔记原文'}
function editNote(n,requestedKind='note'){
 noteDraft=structuredClone(n||{id:crypto.randomUUID().replaceAll('-',''),kind:requestedKind,anchor:{quote:'',prefix:'',suffix:'',start:0},text:'',tags:[],revision:0});noteDraft.kind??=noteDraft.text?'note':noteDraft.tags?.length?'tag':'highlight';
 const tagOnly=noteDraft.kind==='tag';$('note-dialog-title').textContent=tagOnly?'添加标签':noteDraft.kind==='highlight'?'高亮摘录':'阅读笔记';$('quote').textContent=noteDraft.anchor.quote;$('quote').hidden=!noteDraft.anchor.quote;$('note-text-field').hidden=tagOnly;$('note-tags-field').hidden=noteDraft.kind==='highlight';$('note-text').value=noteDraft.text||'';$('note-tags').value=(noteDraft.tags||[]).join(' ');$('note-kind-help').textContent=tagOnly?'标签是简短的分类词，用于归类和筛选，不承载长篇内容。':noteDraft.kind==='highlight'?'高亮只标记原文，不附加笔记或标签。':'笔记记录你的理解、疑问或结论；标签只负责分类。';$('note-delete').hidden=!n;$('note-dialog').showModal();setTimeout(()=>$(tagOnly?'note-tags':'note-text').focus(),0)
}
async function saveNote(){noteDraft.text=noteDraft.kind==='tag'||noteDraft.kind==='highlight'?'':$('note-text').value;noteDraft.tags=noteDraft.kind==='highlight'?[]:[...new Set($('note-tags').value.split(/[\s,，;；]+/).map(s=>s.replace(/^#/, '')).filter(Boolean))].slice(0,20);if(noteDraft.kind==='tag'&&!noteDraft.tags.length)throw Error('请至少输入一个标签');const n=await api().SaveNote(doc.path,noteDraft);notes=notes.filter(x=>x.id!==n.id);notes.push(n);showNotes();$('note-dialog').close();noteDraft=null;api().Dirty(dirty)}
async function deleteNote(){if(!noteDraft)return;const removed=await api().DeleteNote(doc.path,noteDraft);notes=notes.filter(item=>item.id!==removed.id);lastDeletedNote={path:doc.path,note:removed};showNotes();$('note-dialog').close();noteDraft=null;showNoteUndo()}
function showNoteUndo(){let undo=$('undo-note');if(!undo){undo=document.createElement('button');undo.id='undo-note';document.querySelector('footer').prepend(undo)}undo.hidden=false;undo.textContent='笔记已删除 · 撤销';undo.onclick=call(async()=>{if(!lastDeletedNote)return;const restored=await api().RestoreNote(lastDeletedNote.path,lastDeletedNote.note);if(doc?.path===lastDeletedNote.path){notes.push(restored);showNotes()}lastDeletedNote=null;undo.hidden=true;$('notice').textContent='笔记已恢复'});setTimeout(()=>{if(lastDeletedNote?.note.id===removedId){lastDeletedNote=null;undo.hidden=true}},10000);const removedId=lastDeletedNote.note.id}
window.micaNative=async data=>{try{
 if(data.type==='ready'){ready=true;return boot()}
 if(data.id!=null&&data.id!==rev)return;
 if(data.type==='rendered'){$('outline-panel').querySelector('h3').textContent=doc?.conversation?'对话目录 · '+data.outline.length+' 轮':'文档目录';$('outline-filter').value='';window.MicaOutline.render($('outline'),data.outline,{conversation:!!doc?.conversation,navigate:id=>send({type:'navigate',id})});showNotes();$('notice').textContent=doc?.conversation?(doc.warnings?.length?'同步原件 · '+doc.warnings[0].summary:'同步原件 · 只读'):'本地阅读';if(pendingFind){send({type:'find-query',query:pendingFind});pendingFind=''}}
 if(data.type==='position'&&doc&&richDoc()){$('progress').textContent=Math.round(data.progress*100)+'%';prefs.positions??={};prefs.positions[doc.path]={...data.anchor,progress:data.progress};const keys=Object.keys(prefs.positions);while(keys.length>200)delete prefs.positions[keys.shift()];persist();renderLibraryMeta();window.MicaOutline.setActive(data.active)}
 if(data.type==='edit-change')setDirty(true);
 if(data.type==='copy')await api().Copy(data.text);
 if(data.type==='link')await api().Link(data.url);
 if(data.type==='fullscreen')await api().Fullscreen(data.value);
 if(data.type==='close-window')await api().Quit();
 if(data.type==='diagram-window')await api().DiagramWindow(data.source,prefs.theme);
 if(data.type==='error'||data.type==='edit-error')report(data.error);
 if(data.type==='annotation-create'&&doc){const n={id:crypto.randomUUID().replaceAll('-',''),kind:data.action,anchor:data.anchor,text:'',tags:[],revision:0};if(data.action==='highlight'){notes.push(await api().SaveNote(doc.path,n));showNotes()}else editNote(n,data.action)}
 if(data.type==='annotation-open'){const n=notes.find(n=>n.id===data.noteId);if(n)editNote(n)}
 if(data.type==='annotation-state'){noteMissing=new Set(data.missing||[]);showNotes(false)}
 }catch(e){report(e)}};
async function argumentsOpen(args){const index=args.indexOf('--open');if(index>=0&&args[index+1]){if(await leave())await open(await api().Conversation(args[index+1]));return}const diagram=args.indexOf('--diagram');if(diagram>=0){const value=await api().DiagramArgument();$('welcome').hidden=true;frame.hidden=false;send({type:'theme',id:value.theme});send({type:'diagram',source:value.source});return}
 const file=args.find(a=>/\.(md|markdown|pdf|txt|log|jsonl?|csv|tsv|ya?ml|xml|ini|cfg|toml|sql|js|ts|css|html|py|go|java|c|h|cpp|rs|sh)$/i.test(a));if(file&&await leave())await open(await api().OpenKnown(file));}
function enableFileDrop(){window.runtime?.OnFileDrop?.(()=>{},false);const target=$('drop-target');let depth=0;document.addEventListener('dragenter',event=>{if(!event.dataTransfer?.types?.includes('Files'))return;depth++;target.classList.add('wails-drop-target-active')});document.addEventListener('dragleave',()=>{depth=Math.max(0,depth-1);if(!depth)target.classList.remove('wails-drop-target-active')});document.addEventListener('drop',()=>{depth=0;target.classList.remove('wails-drop-target-active')})}
async function boot(){if(!window.go?.main?.App){setTimeout(boot,50);return}enableFileDrop();const args=await api().Startup();transientWindow=args.includes('--diagram');prefs={...prefs,...JSON.parse(await api().Preferences(''))};if(!['rich','compact','source'].includes(prefs.gptMode))prefs.gptMode='rich';files=await api().Library?.()||[];await palette();await refresh();await argumentsOpen(args);if(!args.length&&!prefs.lastPath)$('library').hidden=true;if(!args.length&&prefs.lastPath){try{await open(prefs.lastPath.startsWith('conversation:')?await api().Conversation(prefs.lastPath.slice(13)):await api().OpenKnown(prefs.lastPath))}catch(e){$('notice').textContent='上次文档无法打开（可能已移动或删除），路径仍保留在书架中。'}}window.runtime?.EventsOn('open-args',call(argumentsOpen));window.runtime?.EventsOn('files-dropped',call(async(added,error)=>{if(error)throw Error(error);await addDocuments(added,true)}));if(api().SmokeResult)(await import('./smoke-browser.js')).run(api());}
$('open-files').onclick=$('welcome-open').onclick=call(chooseFile);$('folder').onclick=$('welcome-folder').onclick=call(chooseFolder);$('save').onclick=call(save);$('save-as').onclick=call(async()=>{if(doc){if(doc.kind==='pdf')return api().ExportPDFCopy(doc.path);const s=richDoc()?snapshot():null;if(s?.composing)throw Error('请先完成中文输入');await open(await api().SaveAs(s?.text??doc.text))}});
$('read').onclick=call(()=>setMode(false));$('edit').onclick=call(()=>setMode(true));$('find').onclick=findCurrent;$('theme').onchange=call(async()=>{prefs.theme=$('theme').value;await palette()});$('zoom').oninput=()=>{prefs.zoom=Number($('zoom').value);send({type:'zoom',value:prefs.zoom});persist()};$('filter').oninput=showLists;$('refresh').onclick=call(refresh);
$('outline-filter').oninput=event=>window.MicaOutline.filter(event.target.value);
$('library-toggle').onclick=()=>$('library').hidden=!$('library').hidden;
$('library-close').onclick=()=>$('library').hidden=true;$('sidebar-global-search').onclick=call(openSearch);$('sidebar-add').onclick=call(chooseFile);
function closePanel(){$('right').hidden=true;document.body.classList.remove('side-panel-open')}
function panel(name){$('right').hidden=false;document.body.classList.add('side-panel-open');$('outline-panel').hidden=name!=='outline';$('notes-panel').hidden=name!=='notes'}
$('outline-toggle').onclick=()=>{if(!$('right').hidden&&!$('outline-panel').hidden)closePanel();else panel('outline')};$('notes-toggle').onclick=()=>{if(!$('right').hidden&&!$('notes-panel').hidden)closePanel();else panel('notes')};$('add-note').onclick=()=>{if(doc)editNote()};$('note-save').onclick=call(saveNote);$('note-delete').onclick=call(deleteNote);$('note-cancel').onclick=()=>$('note-dialog').close();$('note-text').oninput=$('note-tags').oninput=()=>api().Dirty(true);$('note-dialog').onclose=()=>api().Dirty(dirty);
$('right-close').onclick=closePanel;
$('global-search').onclick=call(openSearch);$('global-search-input').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>call(runSearch)(),180)};
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();call(openSearch)()}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();findCurrent()}if(event.key==='Escape'){if($('search-dialog').open)$('search-dialog').close();else closePanel()}});
$('connect').onclick=$('sync-help').onclick=()=>$('connection').showModal();$('connection-cancel').onclick=()=>$('connection').close();$('connection-save').onclick=call(async()=>{await api().Connect($('extension-id').value);$('connection').close();$('notice').textContent='已连接：请在 ChatGPT 点击“同步到 Mica”'});
$('welcome-connect').onclick=()=>$('connection').showModal();$('welcome-example').onclick=call(async()=>{if(await leave()){await open(await api().ExampleConversation());await refresh()}});$('extension-download').onclick=()=>window.runtime?.BrowserOpenURL?.('https://github.com/vanillahusk/Mica/releases/latest');
$('delete-conversation').onclick=call(async()=>{if(!doc?.conversation||!confirm('删除当前同步会话？可以从“更多”中恢复最近删除的一条。'))return;await api().DeleteConversation(doc.path.slice(13));prefs.recent=(prefs.recent||[]).filter(item=>item.path!==doc.path);delete prefs.lastPath;await persist();await refresh();doc=null;$('welcome').hidden=false;frame.hidden=true;$('title').textContent='打开文档';$('source-state').hidden=true;$('delete-conversation').hidden=true;$('notice').textContent='会话已移到可恢复区'});
$('restore-conversation').onclick=call(async()=>{const restored=await api().RestoreLastConversation();await refresh();$('notice').textContent='已恢复会话：'+restored.title});
$('export-notes').onclick=call(async()=>{if(!doc)return;const path=await api().ExportNotes(doc.path,doc.title);if(path)$('notice').textContent='笔记已导出：'+path});
$('more-menu').append(button('注册文件打开方式',async()=>{await api().RegisterOpenWith();$('notice').textContent='已注册：右键 .md → 打开方式 → Mica，可设为默认应用。请保留程序当前位置。'},''));
$('minimize').onclick=()=>window.runtime?.WindowMinimise();
$('maximize').onclick=()=>window.runtime?.WindowToggleMaximise();
$('close').onclick=call(async()=>{documentFrame.contentWindow.documentReader?.position();await persist();await api().Quit()});
document.querySelector('header').ondblclick=event=>{if(!event.target.closest('button,details,input,select'))window.runtime?.WindowToggleMaximise()};
for(const menu of document.querySelectorAll('header details'))menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll('header details'))if(other!==menu)other.open=false});
document.addEventListener('pointerdown',event=>{for(const menu of document.querySelectorAll('header details'))if(!menu.contains(event.target))menu.open=false});
window.addEventListener('blur',()=>{if(document.activeElement===frame)for(const menu of document.querySelectorAll('header details'))menu.open=false});
$('zoom').addEventListener('input',()=>{$('zoom-value').textContent=$('zoom').value+'%'});
$('zoom').addEventListener('change',call(palette));
gptMode.onchange=call(async()=>{prefs.gptMode=gptMode.value;await persist();if(doc?.conversation){if(editing)await setMode(false);await renderCurrent()}});
const exportButton=button('导出 PDF…',async()=>{
 if(!doc)return;
 if(doc.kind==='pdf')return api().ExportPDFCopy(doc.path);
 exportButton.disabled=true;$('more').open=false;
 try{
  if(editing)await setMode(false);
  $('notice').textContent='正在准备导出…';
  const target=richDoc()?frame.contentWindow:documentFrame.contentWindow;
  const {prepareExport}=await import('./export.js');const cleanup=await prepareExport(target,richDoc());
  try{const path=await api().ExportPDF(doc.path,doc.title);$('notice').textContent=path?'PDF 已导出：'+path:'已取消导出'}finally{cleanup()}
 }finally{exportButton.disabled=false}
},'');
$('more-menu').prepend(exportButton);
// Iframe may have completed before shell.js; normal ready events take the first path.
if(frame.contentWindow.mica&&!ready){ready=true;call(boot)()}
