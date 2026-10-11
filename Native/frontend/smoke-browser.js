export async function run(api){
 const results=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(test)=>{for(let i=0;i<160;i++){if(test())return;await delay(100)}throw Error('Native DOM wait timed out')};
 const check=(value,label)=>{if(!value)throw Error(label);results.push(label)};
 const pageText=content=>content.items.map(item=>item.str).join('');
 try{
 if(document.querySelector('#title').textContent.endsWith('.pdf')){
  const frame=[...document.querySelectorAll('iframe')].find(f=>f.title==='PDF 与文本阅读区');
  await until(()=>frame.contentDocument.querySelector('#total').textContent==='14');
  await until(()=>frame.contentDocument.querySelector('[data-page-number="1"] canvas')?.width>0&&frame.contentDocument.querySelectorAll('[data-page-number="1"] .textLayer span').length>10);
  check(frame.contentDocument.querySelector('canvas').width>0,'native PDF canvas');
  frame.contentDocument.querySelector('#next').click();await until(()=>frame.contentDocument.querySelector('#page').value==='2');
  await until(()=>frame.contentDocument.querySelectorAll('[data-page-number="2"] .textLayer span').length>10);
  check(frame.contentDocument.querySelectorAll('.textLayer span').length>10,'native PDF page and text layer');
  await api.SmokeResult(JSON.stringify({ok:true,results}));return;
 }
 const reader=document.querySelector('#reader').contentWindow;
 await until(()=>reader.document.querySelector('.diagram[data-ready] svg'));
 check(reader.document.querySelector('h1')?.textContent==='原生阅读测试','startup path and Markdown');
 check([...reader.document.querySelectorAll('.flowchart-link')].some(p=>p.getAttribute('d').includes('C')),'native Dagre curves');
 document.querySelector('#outline-toggle').click();check(document.querySelectorAll('#outline button').length>0,'outline');
 document.querySelector('#edit').click();await until(()=>reader.mica.editorView());
 const view=reader.mica.editorView();view.dispatch({changes:{from:view.state.doc.length,insert:'\nNative edit verified.\n\n'+('长文导出分页验证。\n\n'.repeat(110))+'\nEXPORT-END'}});
 await until(()=>!document.querySelector('#save').disabled);document.querySelector('#save').click();await until(()=>document.querySelector('#save').disabled);
 document.querySelector('#read').click();await until(()=>reader.document.querySelector('#article').textContent.includes('Native edit verified.'));
 check(true,'edit and atomic save');
 const theme=document.querySelector('#theme');theme.value='paper';theme.dispatchEvent(new Event('change'));await delay(100);
 check(getComputedStyle(document.documentElement).colorScheme==='light','light theme');
 document.querySelector('#notes-toggle').click();document.querySelector('#add-note').click();document.querySelector('#note-text').value='原生笔记测试';document.querySelector('#note-save').click();await until(()=>document.querySelector('#notes .note'));check(true,'note save');
 document.querySelector('#note-dialog').close();
 const {prepareExport}=await import('./export.js');const cleanup=await prepareExport(reader,true);
 try{const path=await api.SmokePDF();const lib=await import('./pdfjs/pdf.mjs');lib.GlobalWorkerOptions.workerSrc=new URL('pdfjs/pdf.worker.mjs',location.href).href;const loading=lib.getDocument({url:'/local-pdf?path='+encodeURIComponent(path)});const pdf=await loading.promise;check(pdf.numPages>1,'native PDF paginates and reopens');const content=await(await pdf.getPage(1)).getTextContent();check(pageText(content).includes('原生阅读测试'),'native PDF preserves selectable Chinese');check(pageText(content).includes('即使引用内容跨越多行'),'native PDF expands long quotes');const tail=await(await pdf.getPage(pdf.numPages)).getTextContent();check(pageText(tail).includes('EXPORT-END'),'native PDF includes last paragraph');await loading.destroy()}finally{cleanup()}
 await api.SmokeResult(JSON.stringify({ok:true,results}));
 }catch(e){await api.SmokeResult(JSON.stringify({ok:false,error:String(e.stack||e),results}))}
}
