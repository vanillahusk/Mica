const $=id=>document.getElementById(id),view=$('viewport');
let doc,task,pdf,renderTask,textLayer,generation=0,pageNumber=1,scale=1,fit=true,restoring=false,pending=Promise.resolve();
const notify=anchor=>parent.micaDocumentPosition?.(doc.path,anchor);
const error=e=>{$('error').textContent=String(e?.message||e)};
function position(){if(doc&&!restoring)notify({page:pageNumber,scale,fit,top:view.scrollTop,left:view.scrollLeft})}
function queueRender(anchor){const id=generation;renderTask?.cancel();textLayer?.cancel();pending=pending.catch(()=>{}).then(()=>id===generation?draw(anchor,id):null).catch(e=>{if(e.name!=='RenderingCancelledException'&&id===generation)error(e)});return pending}
async function draw(anchor,id){
 if(!pdf)return;restoring=true;$('error').textContent='';
 const page=await pdf.getPage(pageNumber);if(id!==generation)return;
 if(fit)scale=Math.max(.25,Math.min(3,(view.clientWidth-48)/page.getViewport({scale:1}).width));
 const viewport=page.getViewport({scale}),ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
 const sheet=$('sheet'),canvas=sheet.querySelector('canvas');sheet.style.width=viewport.width+'px';sheet.style.height=viewport.height+'px';sheet.style.setProperty('--scale-factor',scale);sheet.style.setProperty('--total-scale-factor',scale);sheet.style.setProperty('--user-unit',1);
 canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
 renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});await renderTask.promise;if(id!==generation)return;
 const content=await page.getTextContent();if(id!==generation)return;
 const layer=sheet.querySelector('.textLayer');layer.replaceChildren();const {TextLayer}=await import('./pdfjs/pdf.mjs');textLayer=new TextLayer({textContentSource:content,container:layer,viewport});await textLayer.render();
 $('page').value=pageNumber;$('total').textContent=pdf.numPages;$('page').max=pdf.numPages;$('scale').textContent=Math.round(scale*100)+'%';$('prev').disabled=pageNumber<=1;$('next').disabled=pageNumber>=pdf.numPages;
 view.scrollTop=anchor?.top||0;view.scrollLeft=anchor?.left||0;restoring=false;position();
}
async function open(next,anchor){
 const id=++generation;doc=next;restoring=true;renderTask?.cancel();textLayer?.cancel();await task?.destroy();if(id!==generation)return;pdf=null;$('error').textContent='';$('sheet').hidden=next.kind!=='pdf';$('plain').hidden=next.kind==='pdf';$('pdf-tools').hidden=next.kind!=='pdf';
 if(next.kind!=='pdf'){$('plain').textContent=next.text;pageNumber=1;view.scrollTop=anchor?.top||0;restoring=false;return}
 try{const lib=await import('./pdfjs/pdf.mjs');if(id!==generation)return;lib.GlobalWorkerOptions.workerSrc=new URL('pdfjs/pdf.worker.mjs',location.href).href;
 task=lib.getDocument({url:'/local-pdf?path='+encodeURIComponent(next.path),cMapUrl:'pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'pdfjs/standard_fonts/',wasmUrl:'pdfjs/wasm/',isEvalSupported:false,enableXfa:false});
 task.onPassword=(update,reason)=>{const password=window.prompt(reason===2?'密码不正确，请重试':'此 PDF 已加密，请输入密码');if(password===null){task.destroy();error('已取消打开加密 PDF')}else update(password)};
 const loaded=await task.promise;if(id!==generation){await loaded.destroy();return}pdf=loaded;pageNumber=Math.min(pdf.numPages,Math.max(1,anchor?.page||1));scale=anchor?.scale||1;fit=anchor?.fit!==false;await queueRender(anchor);
 }catch(e){if(id===generation)error(e)}
}
function navigate(n){if(!pdf)return;pageNumber=Math.max(1,Math.min(pdf.numPages,Math.round(n)||1));queueRender()}
$('prev').onclick=()=>navigate(pageNumber-1);$('next').onclick=()=>navigate(pageNumber+1);$('page').onchange=()=>navigate(Number($('page').value));
$('smaller').onclick=()=>{fit=false;scale=Math.max(.25,scale/1.2);queueRender()};$('larger').onclick=()=>{fit=false;scale=Math.min(4,scale*1.2);queueRender()};$('fit').onclick=()=>{fit=true;queueRender()};
view.addEventListener('scroll',position,{passive:true});let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(pdf&&fit)queueRender({top:view.scrollTop})},180)}).observe(view);
window.documentReader={open,position,close(){generation++;doc=null;pdf=null;renderTask?.cancel();textLayer?.cancel();return task?.destroy()},theme(theme,zoom){for(const [k,v]of Object.entries(theme.colors))document.documentElement.style.setProperty('--'+k,v);document.documentElement.style.colorScheme=theme.scheme;$('plain').style.fontSize=(15*zoom/100)+'px'},print(){window.print()}};
