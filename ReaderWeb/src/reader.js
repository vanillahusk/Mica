import DOMPurify from 'dompurify';
import themes from './themes.json';
import { createAnnotations } from './annotations.js';
import { DiagramClient } from './diagram-client.js';
import { createScrollRail } from './scroll-rail.js';
import { diagramConfig } from './diagram-theme.js';
import { alignStateLabels } from './state-labels.js';
const diagramClient=new DiagramClient();
let diagramEngine='isolated',diagramGeneration=0;
function cancelDiagrams(){diagramGeneration++;diagramClient.cancel();}
let theme = themes[0], appearanceRevision = 0;
const article = document.querySelector('#article'), status = document.querySelector('#status');
const viewer = document.querySelector('#viewer'), stage = document.querySelector('#stage'), drawing = document.querySelector('#drawing');
const zoomSlider=document.querySelector('#zoom-slider'),minimap=document.querySelector('#minimap'),minimapContent=document.querySelector('#minimap-content'),minimapViewport=document.querySelector('#minimap-viewport');
let worker, workerBusy = false, currentId = 0, outline = [], diagrams = new Map(), active = -1, message = null;
let mountedId=null;
let mermaidPromise, katexPromise, highlightPromise, serial = Promise.resolve(), svgSequence = 0;
let display = null, scale = 1, x = 0, y = 0, dragging = null, viewMode='fit';
let viewerSelectionLocked=true;
const parsedCache = new Map(), svgCache = new Map();
const send = data => {
  if(window.parent!==window && typeof window.parent.micaNative==='function')window.parent.micaNative(data);
  else window.chrome?.webview?.postMessage(data);
};
const annotations = createAnnotations(article,send,()=>currentId,status);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
let liveEditor=null, editGeneration=0;
let returnToSource=null;
const liveWorkspace=document.querySelector('#live-workspace');
const findBar=document.querySelector('#find-bar'),findInput=document.querySelector('#find-input'),findCount=document.querySelector('#find-count');
let findRanges=[],findIndex=-1,lastAnchor=null,layoutWidth=0,restoringAnchor=false,anchorRestoreGeneration=0;
let scrollTakenOver=false;
const scrollRail=createScrollRail(document.querySelector('#scroll-rail'),document.querySelector('#scroll-thumb'),()=>{scrollTakenOver=true;});
scrollRail.attach(document.documentElement,article);
addEventListener('wheel',()=>{scrollTakenOver=true;},{passive:true});
addEventListener('touchmove',()=>{scrollTakenOver=true;},{passive:true});
function readingLine() {
  let line=1;
  for(const el of article.querySelectorAll('[data-source-line]')) {
    if(el.getBoundingClientRect().top>40)break;
    line=Number(el.dataset.sourceLine)||line;
  }
  return line;
}
function navigateSourceLine(line) {
  let target=null;
  for(const el of article.querySelectorAll('[data-source-line]')) {
    if(Number(el.dataset.sourceLine)>line)break;
    target=el;
  }
  if(target){const chunk=target.closest('.chunk');if(chunk)chunk.style.contentVisibility='visible';target.scrollIntoView({block:'start'});window.scrollBy(0,-24);}
}
function readingAnchor(){
  let target=null;
  for(const el of article.querySelectorAll('[data-source-line]')){
    const top=el.getBoundingClientRect().top;if(top>28&&target)break;if(top<innerHeight)target=el;
  }
  return target?{line:Number(target.dataset.sourceLine)||1,delta:24-target.getBoundingClientRect().top}:null;
}
function restoreAnchor(anchor,flash=false){
  if(!anchor)return false;let target=null;
  for(const el of article.querySelectorAll('[data-source-line]')){if(Number(el.dataset.sourceLine)>anchor.line)break;target=el;}
  if(!target)return false;
  restoringAnchor=true;target.scrollIntoView({block:'start'});scrollBy(0,Number(anchor.delta)||-24);
  requestAnimationFrame(()=>{restoringAnchor=false;publishPosition();});
  if(flash){target.classList.remove('navigation-flash');void target.offsetWidth;target.classList.add('navigation-flash');setTimeout(()=>target.classList.remove('navigation-flash'),1200);}
  return true;
}
function endEditing() {
  editGeneration++;
  const snapshot=liveEditor?.snapshot();
  if(snapshot?.composing)return {id:currentId,...snapshot};
  if(liveEditor)cancelDiagrams();
  liveEditor?.destroy();liveEditor=null;
  liveWorkspace.hidden=true;article.hidden=false;document.body.classList.remove('editing');
  scrollRail.attach(document.documentElement,article);
  annotations.mounted();
  for(const el of article.querySelectorAll('.diagram:not([data-ready])'))observer.observe(el);
  if(snapshot){returnToSource=snapshot;navigateSourceLine(snapshot.line);}
  return snapshot ? {id:currentId,...snapshot} : null;
}
async function beginEditing(data) {
  const generation=++editGeneration,id=currentId;
  const sourceLine=readingLine();
  if(workerBusy){newWorker();workerBusy=false;}
  status.textContent='正在准备编辑器…';
  try {
    const {createLiveEditor}=await import('./live-editor.js');
    if(generation!==editGeneration||id!==currentId)return;
    cancelDiagrams();
    liveEditor?.destroy(); annotations.reset();
    liveWorkspace.hidden=false;article.hidden=true;document.body.classList.add('editing');window.scrollTo(0,0);
    liveEditor=createLiveEditor(document.querySelector('#live-editor'),data.text,
      ()=>send({type:'edit-change',id}),{svg:svgFor,highlight,math:renderMath,imageBase:message.imageBase,revision:()=>appearanceRevision});
    liveEditor.goToLine(sourceLine);
    scrollRail.attach(liveEditor.view.scrollDOM,liveEditor.view.contentDOM);
    liveEditor.view.focus();status.textContent='';send({type:'edit-ready',id});
  } catch(error) { if(generation===editGeneration){endEditing();status.textContent='编辑器未能加载';send({type:'edit-error',id,error:String(error.message||error)});} }
}
document.querySelector('#format-bar').addEventListener('mousedown',e=>e.preventDefault());
document.querySelector('#format-bar').addEventListener('click',e=>{const action=e.target.closest('[data-format]')?.dataset.format;if(action)liveEditor?.command(action);});
const idle = callback => (window.requestIdleCallback || (f => setTimeout(f, 20)))(callback, { timeout: 300 });
// Generated toolbars and task checkboxes are added by the trusted parser. Raw HTML is cleaned separately below.
const safe = html => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style','script','iframe','object','embed','form','link','meta','base'], FORBID_ATTR: ['style'], ADD_ATTR: ['target'] });
function newWorker() {
  worker?.terminate();
  worker = new Worker(new URL('./parser.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.id !== currentId) return;
    workerBusy = false;
    if (data.error) { status.textContent = '解析失败：' + data.error; send({ type:'error', id:currentId, error:data.error }); return; }
    if (message.text.length < 2_000_000) {
      parsedCache.set(message.key, { text: message.text, conversation: message.conversation, result: data.result });
      while (parsedCache.size > 4) parsedCache.delete(parsedCache.keys().next().value);
    }
    void mount(data.result, data.parseMs, false);
  };
  worker.onerror = e => { status.textContent = '解析失败，请重新打开文档'; send({ type:'error', id:currentId, error:e.message }); };
}
newWorker();

async function mount(result, parseMs, cached) {
  const id = currentId, start = performance.now(), request = message;
  observer.disconnect(); article.replaceChildren(); outline = result.outline; active = -1;
  diagrams = new Map(result.diagrams.map(item => [item.id, item.source]));
  document.documentElement.scrollTop = 0;
  let firstPaintMs = 0, index = 0;
  // Work within a frame budget; show the first screen before preparing the rest.
  while (index < result.chunks.length) {
    const frameStart = performance.now(), fragment = document.createDocumentFragment();
    do {
      const section = document.createElement('section'); section.className = 'chunk';
      section.innerHTML = safe(result.chunks[index++]);
      for (const input of section.querySelectorAll('input')) {
        if (input.type !== 'checkbox') input.remove(); else input.disabled = true;
      }
      for (const link of section.querySelectorAll('a')) { link.rel = 'noreferrer noopener'; }
      for (const image of section.querySelectorAll('img')) {
        const src = image.getAttribute('src') || '';
        if (src && !/^(https:|data:image\/|blob:)/i.test(src)) {
          image.src = request.imageBase ? new URL(src.replaceAll('\\','/'), request.imageBase).href : '';
        }
        image.addEventListener('error', () => { image.alt = '图片无法加载：' + image.alt; });
      }
      for (const table of [...section.querySelectorAll('table')]) {
        const shell=document.createElement('div');shell.className='table-shell';
        const wrap = document.createElement('div'); wrap.className = 'table-wrap'; table.replaceWith(shell);shell.append(wrap); wrap.append(table);
        const open=document.createElement('button');open.className='table-open';open.dataset.action='table-open';open.textContent='展开表格';shell.append(open);
      }
      fragment.append(section);
    } while (index < result.chunks.length && performance.now() - frameStart < 8);
    article.append(fragment);
    if (!firstPaintMs) { await nextFrame(); firstPaintMs = performance.now() - request.started; status.textContent = ''; }
    if (id !== currentId || liveEditor) return;
    if (index < result.chunks.length) await nextFrame();
  }
  if (id !== currentId || liveEditor) return;
  for (const el of article.querySelectorAll('.diagram,.math,pre code')) observer.observe(el);
  status.textContent = '';
  if (request.anchor&&!scrollTakenOver)restoreAnchor(request.anchor);
  else if (request.offset&&!scrollTakenOver) window.scrollTo(0, request.offset);
  if(returnToSource?.text===request.text&&!scrollTakenOver)navigateSourceLine(returnToSource.line);
  returnToSource=null;
  annotations.mounted();
  updateFind();
  mountedId=id;
  send({ type:'rendered', id, outline, parseMs, firstPaintMs, totalMs: performance.now()-request.started, mountMs:performance.now()-start, cached });
  publishPosition();
  scrollRail.refresh();
}

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    observer.unobserve(entry.target); const el = entry.target, id = currentId;
    idle(async () => {
      if (!el.isConnected || id !== currentId || liveEditor) return;
      if (el.matches('.diagram')) await renderDiagram(el, id);
      else if (el.matches('.math')) await renderMath(el);
      else await highlight(el);
    });
  }
}, { rootMargin:'400px' });

async function mermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: lib }) => lib);
  return mermaidPromise;
}
function svgFor(source,{signal,engine=diagramEngine}={}) {
  if(signal?.aborted)return Promise.reject(new DOMException('绘图已取消','AbortError'));
  const palette = theme, generation=diagramGeneration,key = engine+':'+palette.id + ':' + source;
  const check=()=>{if(generation!==diagramGeneration||signal?.aborted)throw new DOMException('绘图已取消','AbortError');};
  const clean=svg=>{
    check();
    let cleaned=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','script']});
    if(engine==='isolated'&&cleaned.includes('statediagram'))cleaned=alignStateLabels(cleaned);
    if(cleaned.length<500000){svgCache.set(key,cleaned);while(svgCache.size>16)svgCache.delete(svgCache.keys().next().value);}
    return cleaned;
  };
  if (svgCache.has(key)) return Promise.resolve(svgCache.get(key));
  if(engine==='isolated')return diagramClient.run(source,palette,{signal}).then(clean);
  const compatible = () => serial.then(async () => {
    check();
    const lib = await mermaid();
    check();
    lib.initialize({ startOnLoad:false, securityLevel:'strict', suppressErrorRendering:true,
      ...diagramConfig(palette),maxTextSize:100000 });
    const { svg } = await lib.render('mica-svg-' + (++svgSequence), source);
    return clean(svg);
  });
  const work = compatible();
  serial = work.catch(() => {});
  return work;
}
async function renderDiagram(el, id) {
  const appearance = appearanceRevision;
  const source = diagrams.get(el.dataset.diagram);
  if (!source || source.length > 100000) { el.querySelector('.diagram-canvas').textContent = '图表过大，请查看源码'; return; }
  try {
    const svg = await svgFor(source,{engine:el.dataset.engine||diagramEngine});
    if (!el.isConnected || id !== currentId || appearance !== appearanceRevision) return;
    el.querySelector('.diagram-canvas').innerHTML = svg;
    el.dataset.ready = 'true';
  } catch (error) {
    if(error.name==='AbortError')return;
    if (!el.isConnected || id !== currentId || appearance !== appearanceRevision) return;
    const canvas=el.querySelector('.diagram-canvas');canvas.replaceChildren();
    const detail=document.createElement('div');detail.textContent='图表未完成：'+String(error.message||error).slice(0,180);canvas.append(detail);
    const retry=document.createElement('button');retry.dataset.action='diagram-retry';retry.textContent='重试';canvas.append(retry);
    if(diagramEngine==='isolated'&&el.dataset.engine!=='compatible'){
      const fallback=document.createElement('button');fallback.dataset.action='diagram-compatible';fallback.textContent='兼容绘图（可能短暂卡顿）';canvas.append(fallback);
    }
    el.dataset.error = 'true';
  }
}
async function renderMath(el) {
  try {
    katexPromise ??= import('katex');
    const { default: katex } = await katexPromise;
    if (!el.isConnected) return;
    katex.render(el.dataset.source, el, { displayMode:el.classList.contains('math-block'), throwOnError:false, trust:false, maxExpand:1000 });
    el.dataset.ready = 'true';
  } catch { el.classList.add('math-error'); }
}
async function highlight(el) {
  const language = el.dataset.language;
  if (!language || ['text','plaintext','txt'].includes(language) || el.textContent.length > 100000) return;
  highlightPromise ??= import('highlight.js/lib/common');
  const { default: hljs } = await highlightPromise;
  if (!el.isConnected || !hljs.getLanguage(language)) return;
  el.innerHTML = hljs.highlight(el.textContent, { language, ignoreIllegals:true }).value;
}

async function showDiagram(source, fullscreen = false,engine=diagramEngine) {
  const id = currentId, appearance = appearanceRevision;
  try {
    status.textContent = '正在准备图表…';
    const svg = await svgFor(source,{engine});
    if (id !== currentId || appearance !== appearanceRevision) return;
    await showViewer({ kind:'diagram', source, svg,engine }, fullscreen);
    status.textContent = '';
  } catch (error) { if (id === currentId && appearance === appearanceRevision) status.textContent = '图表无法解析：' + String(error.message || error).slice(0,150); }
}

function applyPalette() {
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.scheme;
  for (const [key, value] of Object.entries(theme.colors)) document.documentElement.style.setProperty('--' + key, value);
}
function setTheme(id) {
  const selected = themes.find(item => item.id === id);
  if (!selected || selected === theme) return;
  theme = selected; appearanceRevision++; cancelDiagrams();applyPalette();liveEditor?.refreshPreviews();
  // Text and code keep their DOM, scroll position and selection. Only SVG needs recoloring.
  for (const el of article.querySelectorAll('.diagram')) {
    delete el.dataset.ready; delete el.dataset.error;
    observer.observe(el);
  }
  if (viewer.open && display?.kind === 'diagram') void recolorViewer(display);
}
function textNodesForFind(){
  const nodes=[],walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT,{acceptNode(node){
    const el=node.parentElement;if(!node.data.trim()||el?.closest('.block-toolbar,button,script,style'))return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});while(walker.nextNode())nodes.push(walker.currentNode);return nodes;
}
function updateFind(){
  findRanges=[];findIndex=-1;CSS.highlights?.delete('mica-find');CSS.highlights?.delete('mica-find-current');
  const query=findInput.value.trim().toLocaleLowerCase();
  if(query&&CSS.highlights)for(const node of textNodesForFind()){
    const value=node.data.toLocaleLowerCase();let at=0;
    while((at=value.indexOf(query,at))>=0&&findRanges.length<2000){const range=new Range();range.setStart(node,at);range.setEnd(node,at+query.length);findRanges.push(range);at+=Math.max(1,query.length);}
  }
  if(findRanges.length)CSS.highlights.set('mica-find',new Highlight(...findRanges));
  findCount.textContent=findRanges.length?'0 / '+findRanges.length:'0 / 0';
}
function moveFind(step){
  if(!findRanges.length)return;findIndex=(findIndex+step+findRanges.length)%findRanges.length;
  const range=findRanges[findIndex];CSS.highlights.delete('mica-find-current');CSS.highlights.set('mica-find-current',new Highlight(range));
  const el=range.startContainer.parentElement;el?.scrollIntoView({block:'center'});findCount.textContent=(findIndex+1)+' / '+findRanges.length;
}
function openFind(query){findBar.hidden=false;if(typeof query==='string')findInput.value=query;findInput.focus();findInput.select();if(findInput.value){updateFind();if(findRanges.length)moveFind(1);}}
function closeFind(){findBar.hidden=true;CSS.highlights?.delete('mica-find');CSS.highlights?.delete('mica-find-current');findRanges=[];findIndex=-1;}
findInput.addEventListener('input',()=>{updateFind();if(findRanges.length)moveFind(1);});
findBar.addEventListener('click',e=>{const action=e.target.closest('[data-find]')?.dataset.find;if(action==='next')moveFind(1);if(action==='prev')moveFind(-1);if(action==='close')closeFind();});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();openFind();}
  else if(event.key==='Escape'&&!findBar.hidden){event.preventDefault();closeFind();}
},true);
async function recolorViewer(item) {
  const appearance = appearanceRevision;
  try {
    const svg = await svgFor(item.source,{engine:item.engine||diagramEngine});
    if (appearance !== appearanceRevision || !viewer.open || display !== item) return;
    item.svg = svg; drawing.innerHTML = svg;
    const size = dimensions(), child = drawing.firstElementChild;
    child.style.width = size.width + 'px'; child.style.height = size.height + 'px';
    transform();
  } catch { /* Preserve the existing usable diagram on an appearance-only failure. */ }
}
async function showViewer(item, fullscreen = false) {
  display = item; drawing.replaceChildren();drawing.classList.toggle('viewer-table',item.kind==='table');
  if (item.kind === 'diagram') drawing.innerHTML = item.svg;
  else if(item.kind==='table')drawing.append(item.table.cloneNode(true));
  else {
    const image = new Image(); image.src = item.src; image.alt = item.alt || '';
    await image.decode().catch(() => {}); drawing.append(image);
  }
  document.querySelector('#viewer-title').textContent = item.kind === 'diagram' ? '图表' : item.kind==='table'?'表格':(item.alt || '图片');
  document.querySelector('[data-view=window]').disabled = item.kind !== 'diagram';
  for(const action of ['copy-svg','export-svg','export-png','selection'])document.querySelector(`[data-view=${action}]`).hidden=item.kind!=='diagram';
  setViewerSelection(true);
  minimap.hidden=item.kind!=='diagram';
  minimapContent.replaceChildren();
  if(item.kind==='diagram'){
    // An image keeps SVG ID-scoped styles and markers intact without duplicate DOM IDs.
    const thumbnail=new Image();thumbnail.alt='';thumbnail.setAttribute('aria-hidden','true');
    thumbnail.style.cssText='width:100%;height:100%;object-fit:contain';
    thumbnail.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(item.svg);
    minimapContent.append(thumbnail);
  }
  viewer.classList.toggle('fullscreen', fullscreen);
  if (!viewer.open) viewer.showModal();
  await nextFrame(); fit();
  if (fullscreen) send({ type:'fullscreen', value:true });
}
function dimensions() {
  const svg = drawing.querySelector('svg');
  if (svg) { const vb = svg.viewBox.baseVal; return { width:vb.width || 800, height:vb.height || 500 }; }
  const img = drawing.querySelector('img');if(img)return {width:img.naturalWidth||800,height:img.naturalHeight||500};
  return {width:Math.max(1,drawing.scrollWidth),height:Math.max(1,drawing.scrollHeight)};
}
function transform() {
  drawing.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  document.querySelector('#scale').textContent = Math.round(scale*100) + '%';
  zoomSlider.value=String(Math.round(scale*100));
  updateMinimap();
}
function setViewerSelection(locked){
  viewerSelectionLocked=locked;stage.classList.toggle('selection-locked',locked);
  const button=document.querySelector('[data-view=selection]');button.textContent=locked?'解锁选择':'锁定选择';
  document.querySelector('#viewer-hint').textContent=locked?'已锁定文字选择 · 滚轮缩放 · 拖动平移':'已解锁文字选择 · 可框选并复制图中文字';
  if(locked)getSelection()?.removeAllRanges();
}
function updateMinimap(){
  if(minimap.hidden||!display||display.kind!=='diagram')return;
  const size=dimensions(),box={width:minimap.clientWidth-14,height:minimap.clientHeight-14};
  if(!box.width||!box.height)return;
  const ratio=Math.min(box.width/size.width,box.height/size.height),left=7+(box.width-size.width*ratio)/2,top=7+(box.height-size.height*ratio)/2;
  const worldLeft=-x/scale,worldTop=-y/scale,worldWidth=stage.clientWidth/scale,worldHeight=stage.clientHeight/scale;
  const rectLeft=Math.max(left,left+worldLeft*ratio),rectTop=Math.max(top,top+worldTop*ratio);
  const rectRight=Math.min(left+size.width*ratio,left+(worldLeft+worldWidth)*ratio),rectBottom=Math.min(top+size.height*ratio,top+(worldTop+worldHeight)*ratio);
  minimapViewport.style.left=rectLeft+'px';minimapViewport.style.top=rectTop+'px';
  minimapViewport.style.width=Math.max(8,rectRight-rectLeft)+'px';minimapViewport.style.height=Math.max(8,rectBottom-rectTop)+'px';
}
function fit() {
  const size = dimensions();
  drawing.style.width = size.width + 'px'; drawing.style.height = size.height + 'px';
  const child = drawing.firstElementChild;
  if (child) { child.style.width = size.width+'px'; child.style.height=size.height+'px'; }
  // A small diagram should remain crisp at its authored size. "Fit" only
  // shrinks content that cannot fit; it never enlarges it to fill the window.
  viewMode='fit';
  scale = Math.min((stage.clientWidth-48)/size.width, (stage.clientHeight-48)/size.height, 1);
  scale = Math.max(.05, scale); x = (stage.clientWidth-size.width*scale)/2; y=(stage.clientHeight-size.height*scale)/2; transform();
}
function fitWidth(){const size=dimensions();viewMode='width';scale=Math.max(.05,Math.min(1,(stage.clientWidth-48)/size.width));x=(stage.clientWidth-size.width*scale)/2;y=24;transform();}
function actual(){const size=dimensions();viewMode='actual';scale=1;x=(stage.clientWidth-size.width)/2;y=24;transform();}
function zoom(factor, cx=stage.clientWidth/2, cy=stage.clientHeight/2) {
  viewMode='manual';
  const next = Math.max(.05,Math.min(12,scale*factor)), ratio=next/scale;
  x=cx-(cx-x)*ratio; y=cy-(cy-y)*ratio; scale=next; transform();
}
stage.addEventListener('wheel', e => { e.preventDefault(); const rect=stage.getBoundingClientRect(); zoom(e.deltaY<0?1.12:1/1.12,e.clientX-rect.left,e.clientY-rect.top); }, {passive:false});
stage.addEventListener('pointerdown', e => { if(!viewerSelectionLocked)return;viewMode='manual';dragging={x:e.clientX,y:e.clientY}; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); });
stage.addEventListener('pointermove', e => { if (!dragging) return; x+=e.clientX-dragging.x; y+=e.clientY-dragging.y; dragging={x:e.clientX,y:e.clientY}; transform(); });
stage.addEventListener('pointerup', () => { dragging=null; stage.classList.remove('dragging'); });
stage.addEventListener('lostpointercapture', () => { dragging=null; stage.classList.remove('dragging'); });
zoomSlider.addEventListener('input',()=>{const next=Number(zoomSlider.value)/100;if(!Number.isFinite(next)||next<=0)return;zoom(next/scale);});
minimap.addEventListener('pointerdown',e=>{
  if(!display||display.kind!=='diagram')return;e.preventDefault();const rect=minimap.getBoundingClientRect(),size=dimensions(),box={width:minimap.clientWidth-14,height:minimap.clientHeight-14};
  const ratio=Math.min(box.width/size.width,box.height/size.height),left=7+(box.width-size.width*ratio)/2,top=7+(box.height-size.height*ratio)/2;
  const worldX=Math.max(0,Math.min(size.width,(e.clientX-rect.left-left)/ratio)),worldY=Math.max(0,Math.min(size.height,(e.clientY-rect.top-top)/ratio));
  viewMode='manual';x=stage.clientWidth/2-worldX*scale;y=stage.clientHeight/2-worldY*scale;transform();
});
viewer.addEventListener('close', () => { send({type:'fullscreen',value:false}); if(document.body.classList.contains('diagram-only')) send({type:'close-window'}); });
new ResizeObserver(() => {
  if(!viewer.open)return;
  if(viewMode==='fit')fit();
  else if(viewMode==='width')fitWidth();
}).observe(stage);

function diagramSvg(){
  const svg=drawing.querySelector('svg');if(!svg)return null;
  const copy=svg.cloneNode(true);copy.setAttribute('xmlns','http://www.w3.org/2000/svg');return new XMLSerializer().serializeToString(copy);
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function exportSvg(){const svg=diagramSvg();if(svg)downloadBlob(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),'mica-diagram.svg');}
async function exportPng(){
  const svg=diagramSvg();if(!svg)return;const size=dimensions(),ratio=Math.min(2,8192/size.width,8192/size.height),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(size.width*ratio));canvas.height=Math.max(1,Math.round(size.height*ratio));const context=canvas.getContext('2d');context.fillStyle=theme.colors.bg;context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)downloadBlob(blob,'mica-diagram.png');}
  finally{URL.revokeObjectURL(url);}
}

document.addEventListener('click', async e => {
  const button=e.target.closest('button');
  if (button?.dataset.view) {
    const action=button.dataset.view;
    button.closest('details')?.removeAttribute('open');
    if(action==='in') zoom(1.25); if(action==='out') zoom(.8); if(action==='fit') fit();if(action==='width')fitWidth();if(action==='actual')actual();
    if(action==='selection')setViewerSelection(!viewerSelectionLocked);
    if(action==='copy-svg'){const svg=diagramSvg();if(svg){send({type:'copy',text:svg});button.textContent='已复制';setTimeout(()=>button.textContent='复制 SVG',1200);}}
    if(action==='export-svg')exportSvg();if(action==='export-png')await exportPng();
    if(action==='close') viewer.close();
    if(action==='fullscreen') { const full=!viewer.classList.contains('fullscreen'); viewer.classList.toggle('fullscreen',full); send({type:'fullscreen',value:full}); await nextFrame(); fit(); }
    if(action==='window' && display?.kind==='diagram') send({type:'diagram-window',source:display.source,engine:display.engine||diagramEngine});
    return;
  }
  const figure=e.target.closest('.diagram');
  if(figure) {
    const source=diagrams.get(figure.dataset.diagram); if(!source) return;
    const action=button?.dataset.action;
    if(action==='diagram-selection'){
      const locked=figure.classList.toggle('selection-locked');button.textContent=locked?'解锁选择':'锁定选择';if(locked)getSelection()?.removeAllRanges();
    }
    else if(action==='diagram-window') send({type:'diagram-window',source,engine:figure.dataset.engine||diagramEngine});
    else if(action==='diagram-compatible'||action==='diagram-retry'){
      if(action==='diagram-compatible')figure.dataset.engine='compatible';
      delete figure.dataset.error;delete figure.dataset.ready;figure.querySelector('.diagram-canvas').textContent='正在绘制…';await renderDiagram(figure,currentId);
    }
    else if(action==='diagram-source') {
      let code=figure.querySelector('pre');
      if(code) code.remove(); else { code=document.createElement('pre'); code.textContent=source; figure.append(code); }
    } else if(action==='diagram-open'||action==='diagram-full'||(figure.classList.contains('selection-locked')&&e.target.closest('svg'))) await showDiagram(source,action==='diagram-full',figure.dataset.engine||diagramEngine);
    return;
  }
  if(button?.dataset.action==='table-open'){
    const table=button.closest('.table-shell')?.querySelector('table');if(table)await showViewer({kind:'table',table});return;
  }
  if(button?.dataset.action==='copy-code') {
    const text=button.closest('.code-block')?.querySelector('code')?.textContent;
    if(text !== undefined) { send({type:'copy',text}); button.textContent='已复制'; setTimeout(()=>button.textContent='复制代码',1200); }
  }
  const image=e.target.closest('#article img'); if(image) { await showViewer({kind:'image',src:image.src,alt:image.alt}); return; }
  const link=e.target.closest('a');
  if(link) {
    e.preventDefault();
    const href=link.getAttribute('href');
    if(href?.startsWith('#')) navigate(decodeURIComponent(href.slice(1)));
    else if(/^https?:\/\//i.test(href||'')) send({type:'link',url:href});
  }
});
function navigate(id) {
  const target=document.getElementById(id); if(!target) return;
  anchorRestoreGeneration++;
  const chunk=target.closest('.chunk'); if(chunk) chunk.style.contentVisibility='visible';
  target.scrollIntoView({block:'start',behavior:'instant'});target.classList.remove('navigation-flash');void target.offsetWidth;target.classList.add('navigation-flash');setTimeout(()=>target.classList.remove('navigation-flash'),1200);publishPosition();
}
let scrollFrame=false, lastSent=0;
function publishPosition() {
  const max=Math.max(0,document.documentElement.scrollHeight-innerHeight);
  let low=0,high=outline.length-1,index=0;
  while(low<=high) {
    const mid=(low+high)>>1, el=document.getElementById(outline[mid].id);
    if(el && el.getBoundingClientRect().top<=90) {index=mid;low=mid+1;} else high=mid-1;
  }
  active=index;
  lastAnchor=readingAnchor();
  send({type:'position',id:currentId,offset:scrollY,max,active:index,progress:max?scrollY/max:1,anchor:lastAnchor});
}
addEventListener('scroll', () => {
  if(!restoringAnchor)anchorRestoreGeneration++;
  if(scrollFrame)return; scrollFrame=true;
  requestAnimationFrame(()=>{scrollFrame=false;if(performance.now()-lastSent>80){lastSent=performance.now();publishPosition();}});
}, {passive:true});
addEventListener('scrollend',publishPosition);
window.mica = {
  receive(data) {
    if(data.type==='render') {
      cancelDiagrams();
      endEditing();
      annotations.reset();
      anchorRestoreGeneration++;currentId=data.id; message={...data,started:performance.now()};scrollTakenOver=false;lastAnchor=data.anchor||null;closeFind();
      if(viewer.open)viewer.close();
      document.body.classList.remove('diagram-only');
      status.textContent='正在排版…';
      if(workerBusy) newWorker(); // Cancel active parsing without restarting an idle, warm worker.
      workerBusy=false;
      const cached=parsedCache.get(data.key);
      if(cached && cached.text===data.text && cached.conversation===data.conversation) void mount(cached.result,0,true);
      else {workerBusy=true;worker.postMessage({id:data.id,text:data.text,conversation:data.conversation});}
    } else if(data.type==='edit' && data.id===currentId) void beginEditing(data);
    else if(data.type==='navigate') navigate(data.id);
    else if(data.type==='scroll') {window.scrollTo(0,data.offset);publishPosition();}
    else if(data.type==='zoom') {const anchor=liveEditor?null:readingAnchor(),generation=++anchorRestoreGeneration;document.documentElement.style.setProperty('--size',(16*data.value/100)+'px');liveEditor?.refreshLayout();if(anchor)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(generation===anchorRestoreGeneration)restoreAnchor(anchor);}));}
    else if(data.type==='find') openFind();
    else if(data.type==='find-query') openFind(data.query||'');
    else if(data.type==='theme') setTheme(data.id);
    else if(data.type==='diagram-engine') {
      const engine=data.isolated?'isolated':'compatible';if(engine===diagramEngine)return;
      diagramEngine=engine;appearanceRevision++;cancelDiagrams();liveEditor?.refreshPreviews();
      for(const el of article.querySelectorAll('.diagram')){delete el.dataset.ready;delete el.dataset.error;delete el.dataset.engine;observer.observe(el);}
      if(viewer.open&&display?.kind==='diagram'){display.engine=engine;void recolorViewer(display);}
    }
    else if(data.type==='annotations' || data.type==='annotation-navigate') annotations.receive(data);
    else if(data.type==='diagram') {document.body.classList.add('diagram-only');void showDiagram(data.source);}
  },
  async preparePrint(){
    const id=currentId;
    // Wait for a read-mode render that may have just replaced an editor.
    for(let n=0;(workerBusy||mountedId!==id)&&n<600;n++)await new Promise(r=>setTimeout(r,50));
    if(workerBusy||mountedId!==id)throw Error('文档尚未排版完成，请稍后导出');
    for(const el of article.querySelectorAll('.diagram:not([data-ready]),.math:not([data-ready]),code[data-language]')){
      if(id!==currentId)throw Error('文档已切换，请重新导出');
      if(el.matches('.diagram'))await renderDiagram(el,id);else if(el.matches('.math'))await renderMath(el);else await highlight(el);
    }
    if(article.querySelector('.diagram:not([data-ready])'))throw Error('部分图表尚未成功渲染，请修复或重试后导出');
    await document.fonts.ready;
    await Promise.race([Promise.all([...article.querySelectorAll('img')].map(img=>img.decode().catch(()=>{}))),new Promise((_,reject)=>setTimeout(()=>reject(Error('图片加载较慢，请加载完成后重试导出')),15000))]);
  },
  endEditing,
  editorSnapshot:()=>liveEditor?{id:currentId,...liveEditor.snapshot()}:null,
  editorView:()=>liveEditor?.view,
  editorDiagnostics:()=>liveEditor?.diagnostics(),
  diagnostics:()=>({ id:currentId,diagramEngine,diagramWorker:diagramClient.diagnostics(),viewMode,diagrams:article.querySelectorAll('.diagram[data-ready]').length,errors:article.querySelectorAll('.diagram[data-error]').length,math:article.querySelectorAll('.math[data-ready]').length,outline,scale,viewerOpen:viewer.open,annotations:annotations.diagnostics() })
};
new ResizeObserver(entries=>{
  const width=entries[0]?.contentRect.width||0;if(!layoutWidth){layoutWidth=width;return;}if(Math.abs(width-layoutWidth)<2)return;layoutWidth=width;
  if(!liveEditor&&!restoringAnchor&&!scrollRail.dragging&&lastAnchor){const generation=++anchorRestoreGeneration;requestAnimationFrame(()=>{if(generation===anchorRestoreGeneration)restoreAnchor(lastAnchor);});}
}).observe(article);
window.chrome?.webview?.addEventListener('message',e=>window.mica.receive(e.data));
applyPalette();
send({type:'ready'});
