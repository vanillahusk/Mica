const $=id=>document.getElementById(id),view=$('viewport'),findBar=$('doc-find-bar'),findInput=$('doc-find-input');
let doc,task,pdf,viewer,events,links,findController,generation=0,restoring=false,fit=true;
const error=e=>{$('error').textContent=String(e?.message||e)};
function position(){if(!doc||restoring)return;const page=pdf?viewer.currentPageNumber:1;parent.micaDocumentPosition?.(doc.path,{version:2,page,scale:viewer?.currentScale||1,fit,offset:pdf?view.scrollTop-viewer.getPageView(page-1).div.offsetTop:0,top:view.scrollTop,left:view.scrollLeft})}
function update(){if(!pdf)return;$('page').value=viewer.currentPageNumber;$('total').textContent=pdf.numPages;$('page').max=pdf.numPages;$('prev').disabled=viewer.currentPageNumber===1;$('next').disabled=viewer.currentPageNumber===pdf.numPages;$('scale').textContent=Math.round(viewer.currentScale*100)+'%';position()}
async function init(){if(viewer)return;const lib=await import('./pdfjs/pdf.mjs');globalThis.pdfjsLib=lib;lib.GlobalWorkerOptions.workerSrc=new URL('pdfjs/pdf.worker.mjs',location.href).href;
 const ui=await import('./pdfjs/pdf_viewer.mjs');events=new ui.EventBus();links=new ui.PDFLinkService({eventBus:events});findController=new ui.PDFFindController({eventBus:events,linkService:links});
 viewer=new ui.PDFViewer({container:view,viewer:$('sheet'),eventBus:events,linkService:links,findController,annotationMode:0,enableAutoLinking:false,maxCanvasPixels:4000000,imageResourcesPath:'pdfjs/images/'});links.setViewer(viewer);events.on('pagechanging',update);events.on('scalechanging',update);
}
async function open(next,anchor){const id=++generation;restoring=true;doc=next;viewer?.setDocument(null);links?.setDocument(null);await task?.destroy();if(id!==generation)return;pdf=null;task=null;$('error').textContent='';$('sheet').hidden=next.kind!=='pdf';$('plain').hidden=next.kind==='pdf';$('pdf-tools').hidden=next.kind!=='pdf';document.body.classList.toggle('pdf-mode',next.kind==='pdf');
 if(next.kind!=='pdf'){$('plain').textContent=next.text;view.scrollTop=anchor?.top||0;restoring=false;return}
 for(const button of $('pdf-tools').querySelectorAll('button'))button.disabled=true;
 try{await init();if(id!==generation)return;task=globalThis.pdfjsLib.getDocument({url:'/local-pdf?path='+encodeURIComponent(next.path),cMapUrl:'pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'pdfjs/standard_fonts/',wasmUrl:'pdfjs/wasm/',isEvalSupported:false,enableXfa:false});
 task.onPassword=(reply,reason)=>{const value=prompt(reason===2?'密码不正确，请重试':'请输入 PDF 密码');if(value===null){task.destroy();error('已取消打开')}else reply(value)};
 pdf=await task.promise;if(id!==generation)return;
 await new Promise(resolve=>{const ready=()=>{events.off('pagesinit',ready);resolve()};events.on('pagesinit',ready);links.setDocument(pdf);viewer.setDocument(pdf)});
 if(id!==generation)return;fit=anchor?.fit!==false;viewer.currentScaleValue=fit?'page-width':String(anchor?.scale||1);
 const page=Math.min(pdf.numPages,Math.max(1,anchor?.page||1));viewer.currentPageNumber=page;viewer.scrollPageIntoView({pageNumber:page});
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(id!==generation)return;
 view.scrollTop=viewer.getPageView(page-1).div.offsetTop+(anchor?.version===2?anchor.offset||0:anchor?.top||0);view.scrollLeft=anchor?.left||0;restoring=false;for(const button of $('pdf-tools').querySelectorAll('button'))button.disabled=false;update();
 }catch(e){if(id===generation){restoring=false;error(e)}}
}
function navigate(n){if(pdf){viewer.currentPageNumber=Math.min(pdf.numPages,Math.max(1,Math.round(n)||1));viewer.scrollPageIntoView({pageNumber:viewer.currentPageNumber});update()}}
$('prev').onclick=()=>navigate(viewer.currentPageNumber-1);$('next').onclick=()=>navigate(viewer.currentPageNumber+1);$('page').onchange=()=>navigate(Number($('page').value));
$('smaller').onclick=()=>{fit=false;viewer.currentScale=Math.max(.25,viewer.currentScale/1.2)};$('larger').onclick=()=>{fit=false;viewer.currentScale=Math.min(4,viewer.currentScale*1.2)};$('fit').onclick=()=>{fit=true;viewer.currentScaleValue='page-width'};
function runFind(direction=0){const query=findInput.value.trim();if(!query)return;if(pdf)events?.dispatch('find',{source:window,type:direction?'again':'',query,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:direction<0});else window.find(query,false,direction<0,true)}
function openFind(query){findBar.hidden=false;if(typeof query==='string')findInput.value=query;findInput.focus();findInput.select();if(findInput.value)runFind()}
function closeFind(){findBar.hidden=true;findInput.blur()}
findInput.oninput=()=>runFind();findInput.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();runFind(event.shiftKey?-1:1)}else if(event.key==='Escape'){event.preventDefault();closeFind()}};
findBar.onclick=event=>{const action=event.target.closest('[data-find]')?.dataset.find;if(action==='prev')runFind(-1);else if(action==='next')runFind(1);else if(action==='close')closeFind()};
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();openFind()}else if(event.key==='Escape'&&!findBar.hidden){event.preventDefault();closeFind()}},true);
view.addEventListener('scroll',position,{passive:true});let timer;new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{if(pdf&&fit)viewer.currentScaleValue='page-width'},200)}).observe(view);
window.micaOpenFind=openFind;
window.documentReader={open,position,find:openFind,close(){generation++;doc=null;pdf=null;viewer?.setDocument(null);links?.setDocument(null);return task?.destroy()},theme(theme,zoom){for(const[k,v]of Object.entries(theme.colors))document.documentElement.style.setProperty('--'+k,v);document.documentElement.style.colorScheme=theme.scheme;$('plain').style.fontSize=(15*zoom/100)+'px'}};
