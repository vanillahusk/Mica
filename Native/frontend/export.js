export async function prepareExport(source,markdown){
 document.querySelector('#mica-print')?.remove();
 if(markdown)await source.mica.preparePrint();
 const root=document.createElement('section');root.id='mica-print';
 const article=markdown?source.document.querySelector('#article').cloneNode(true):document.createElement('main');
 if(!markdown){article.id='article';const pre=document.createElement('pre');pre.textContent=source.document.querySelector('#plain').textContent;article.append(pre)}
 // The print tree is top-level, not an iframe viewport: long content paginates fully.
 article.classList.add('print-article');
 // Reading uses containment and nested scrollers for speed. A print snapshot must be
 // fully expanded or Chromium faithfully prints those scrollbars and clipped areas.
 for(const el of article.querySelectorAll('.chunk,blockquote,.table-shell,.table-wrap,.diagram-canvas,pre')){
  el.style.contentVisibility='visible';el.style.contain='none';el.style.maxHeight='none';el.style.overflow='visible';
 }
 for(const image of article.querySelectorAll('img'))image.src=new URL(image.getAttribute('src'),source.location.href).href;
 root.append(article);document.body.append(root);
 // The root stays hidden on screen; @page and the print stylesheet own all paper
 // colours. Never mutate html/body here: the native Save dialog is asynchronous
 // and the application must not flash to the print palette while it is open.
 root.style.setProperty('background','#fff','important');root.style.setProperty('color-scheme','light','important');
 const links=[];
 for(const name of ['reader.css','katex.min.css']){const link=document.createElement('link');link.rel='stylesheet';link.media='print';link.href=name;links.push(link);document.head.append(link)}
 const cleanup=()=>{root.remove();links.forEach(el=>el.remove())};
 try{await Promise.all(links.map(link=>new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(Error('PDF 排版样式加载失败'))})));await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));return cleanup}catch(e){cleanup();throw e}
}
