import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.MICA_PLAYWRIGHT_MODULE || 'playwright');
const root=resolve('dist'), output=resolve('tests/output');
await mkdir(output,{recursive:true});
const server=createServer(async (req,res)=>{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!path.startsWith(root)) {res.writeHead(403).end();return;}
  try {res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2','.woff':'font/woff','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
const page=await browser.newPage({viewport:{width:1200,height:850}});
const errors=[], requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>requests.push(r.url()));
await page.addInitScript(()=>{
  window.messages=[];
  window.chrome={webview:{postMessage:m=>window.messages.push(m),addEventListener:()=>{}}};
});
let id=0;
const fence=String.fromCharCode(96).repeat(3);
const code=(lang,text)=>fence+lang+'\n'+text+'\n'+fence;
async function render(text,key='test'){
  const current=++id;
  await page.evaluate(data=>window.mica.receive(data),{type:'render',id:current,key,text,conversation:false,offset:0});
  await page.waitForFunction(id=>window.messages.some(m=>m.type==='rendered'&&m.id===id),current);
  return await page.evaluate(id=>window.messages.find(m=>m.type==='rendered'&&m.id===id),current);
}
try {
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await page.waitForFunction(()=>window.mica);
  const fixture='# Markdown 阅读能力\n\n> [!TIP]\n> 图表、公式、代码，按需加载。\n\n'+
    code('mermaid','flowchart LR\n A[打开文档] --> B[后台解析]\n B --> C{内容类型}\n C --> D[正文]\n C --> E[图表与公式]')+
    '\n\n数学：$E=mc^2$\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n'+
    '| 项目 | 数量 |\n| :--- | ---: |\n| 图表 | 3 |\n\n1. 外层\n   - 嵌套列表\n\n- [x] 已完成\n\n'+
    '**1. 获取 Provider 生成结果**\n\nDriver 完成厂商协议处理。\n\n**2. 统一后处理**\n\n`OutputPostprocessor` 负责输出校验。\n\n'+
    '参考[^1] 与 ==重点== H~2~O。\n\n[^1]: 脚注内容\n\n<details><summary>展开详情</summary>\n\n**折叠正文**\n\n</details>\n\n'+
    code('java','public class Demo { int count = 12; }')+
    '\n\n<script>window.unsafe=true</script><img src="x" onerror="window.unsafe=true">';
  const metrics=await render(fixture);
  await page.waitForSelector('.diagram[data-ready] svg',{timeout:30000});
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().diagramEngine),'isolated','modern worker renderer is the default');
  assert.match(await page.locator('.diagram svg').textContent(), /打开文档/,'diagram labels survive SVG sanitization');
  assert(await page.locator('.diagram svg text').count()>0,'labels use visible SVG text');
  assert(await page.locator('.diagram .flowchart-link').evaluateAll(paths=>paths.some(p=>p.getAttribute('d').includes('C'))),'flowcharts have renderer-generated basis curves');
  await writeFile(output+'/diagram-fixture.svg',await page.locator('.diagram svg').evaluate(el=>el.outerHTML));
  assert.equal(await page.locator('.diagram svg text').first().evaluate(el=>getComputedStyle(el).userSelect),'none','inline diagram text is locked by default');
  await page.locator('[data-action=diagram-selection]').click();
  assert.equal(await page.locator('.diagram').evaluate(el=>el.classList.contains('selection-locked')),false,'inline diagram text can be unlocked');
  await page.locator('[data-action=diagram-selection]').click();
  await page.locator('.math').first().scrollIntoViewIfNeeded();
  await page.waitForSelector('.math[data-ready] .katex',{timeout:15000});
  assert.equal(await page.evaluate(()=>window.unsafe),undefined);
  assert.equal(await page.locator('#article script,#article [onerror]').count(),0);
  assert.equal(await page.locator('li li').count()>0,true);
  assert.equal(await page.locator('#article details').count(),1);
  assert.equal(await page.locator('input[type=checkbox]').count(),1);
  assert.equal(await page.locator('.footnotes').count(),1);
  assert.equal(await page.locator('td').last().evaluate(el=>getComputedStyle(el).textAlign),'right');
  assert.equal(await page.locator('.chat-step-title').count(),2,'ChatGPT numbered sections use step layout');
  assert.equal(await page.locator('.chat-step-title').first().evaluate(el=>getComputedStyle(el,'::before').content),'"1"');
  await page.evaluate(()=>window.mica.receive({type:'find'}));
  await page.locator('#find-input').fill('图表');
  assert.match(await page.locator('#find-count').textContent(),/1 \/ [1-9]/,'find shows current and total matches');
  assert(await page.evaluate(()=>CSS.highlights.get('mica-find-current')?.size===1),'current find result is highlighted');
  await page.locator('[data-find=next]').click();
  await page.locator('[data-find=close]').click();
  assert(await page.locator('.table-open').count(),'wide tables expose a mouse-accessible viewer');
  await page.locator('.table-open').click();await page.waitForSelector('#viewer[open] table');
  await page.locator('#viewer-more summary').click();
  await page.locator('[data-view=width]').click();const tableWidthScale=await page.evaluate(()=>window.mica.diagnostics().scale);
  await page.locator('#viewer-more summary').click();
  await page.locator('[data-view=actual]').click();assert.equal(await page.evaluate(()=>window.mica.diagnostics().scale),1);
  assert(tableWidthScale>0);await page.locator('[data-view=close]').click();
  await page.locator('[data-action=diagram-open]').click();
  await page.waitForSelector('#viewer[open] svg');
  assert(await page.locator('#stage').evaluate(el=>el.classList.contains('selection-locked')),'diagram selection is locked by default');
  await page.locator('[data-view=selection]').click();
  assert.equal(await page.locator('#stage').evaluate(el=>el.classList.contains('selection-locked')),false,'viewer can unlock text selection');
  await page.locator('[data-view=selection]').click();
  assert(await page.locator('#minimap:not([hidden])').count(),'diagram viewer exposes a minimap');
  const initial=await page.evaluate(()=>window.mica.diagnostics().scale);
  assert(initial<=1,'fit preserves the natural size of diagrams that already fit');
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().viewMode),'fit');
  await page.locator('[data-view=in]').click();
  assert((await page.evaluate(()=>window.mica.diagnostics().scale))>initial);
  await page.locator('#zoom-slider').fill('150');assert(Math.abs((await page.evaluate(()=>window.mica.diagnostics().scale))-1.5)<.01,'zoom slider controls the diagram');
  await page.locator('#viewer-more summary').click();
  await page.locator('[data-view=copy-svg]').click();assert(await page.evaluate(()=>window.messages.some(m=>m.type==='copy'&&m.text.startsWith('<svg'))),'SVG can be copied');
  await page.locator('#viewer-more summary').click();
  const svgDownload=page.waitForEvent('download');await page.locator('[data-view=export-svg]').click();assert.equal((await svgDownload).suggestedFilename(),'mica-diagram.svg');
  await page.locator('#viewer-more summary').click();
  const pngDownload=page.waitForEvent('download');await page.locator('[data-view=export-png]').click();assert.equal((await pngDownload).suggestedFilename(),'mica-diagram.png');
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().viewMode),'manual');
  await page.locator('[data-view=fullscreen]').click();
  assert(await page.locator('#viewer').evaluate(el=>el.classList.contains('fullscreen')));
  await page.locator('#viewer-more summary').click();
  await page.locator('[data-view=window]').click();
  assert(await page.evaluate(()=>window.messages.some(m=>m.type==='diagram-window')));
  await page.screenshot({path:output+'/diagram.png'});
  await page.locator('[data-view=close]').click();
  assert.equal(await page.locator('#viewer[open]').count(),0);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:output+'/reader.png'});
  const palettes=JSON.parse(await readFile(resolve('src/themes.json'),'utf8'));
  const themeFixture='# 读得清楚，也读得舒服\n\n正文有 **清晰的重点**、[参考链接](https://example.com)、`行内代码` 和 ==标记==。\n\n'+
    code('java','public class Reader {\n  // 安静地阅读，代码也要清楚\n  String theme = "Mica";\n  int progress = 42;\n}')+'\n\n'+
    code('mermaid','flowchart LR\n A[打开 Markdown] --> B[阅读与标注]\n B --> C[继续阅读]')+'\n\n'+('正文保持原位。\n\n'.repeat(20));
  await render(themeFixture,'themes');
  await page.waitForSelector('.hljs-keyword');
  const themeResults=[];
  for(const palette of palettes){
    await page.evaluate(id=>window.mica.receive({type:'theme',id}),palette.id);
    await page.waitForSelector('.diagram[data-ready] svg');
    const colors=await page.evaluate(()=>({body:getComputedStyle(document.body).color,bg:getComputedStyle(document.documentElement).backgroundColor,keyword:getComputedStyle(document.querySelector('.hljs-keyword')).color,scheme:getComputedStyle(document.documentElement).colorScheme}));
    assert.equal(colors.scheme,palette.scheme);
    assert.notEqual(colors.body,colors.keyword,'code highlighting remains visible');
    await page.screenshot({path:output+'/theme-'+palette.id+'.png'});
    themeResults.push({id:palette.id,...colors});
  }
  await page.evaluate(()=>{ window.themeHeading=document.querySelector('h1'); scrollTo(0,350); });
  const themeOffset=await page.evaluate(()=>scrollY);
  await page.evaluate(()=>window.mica.receive({type:'theme',id:'paper'}));
  assert(await page.evaluate(()=>window.themeHeading===document.querySelector('h1')),'theme switches without remounting document');
  assert.equal(await page.evaluate(()=>scrollY),themeOffset,'theme preserves reading position');
  await page.locator('[data-action=diagram-open]').click();
  await page.waitForSelector('#viewer[open] svg');
  const previousSvg=await page.locator('#drawing').innerHTML();
  await page.evaluate(()=>window.mica.receive({type:'theme',id:'warm'}));
  await page.waitForFunction(previous=>document.querySelector('#drawing').innerHTML!==previous,previousSvg);
  assert(await page.locator('#drawing svg text').count()>0,'open viewer follows theme');
  await page.locator('[data-view=close]').click();
  const annotatedText='# 阅读与笔记\n\n阅读时留下**关键想法**，稍后复习。\n\n'+('普通段落。\n\n'.repeat(25))+'## 最后\n\n唯一的定位文本。';
  await render(annotatedText,'annotations');
  await page.evaluate(()=>{
    const node=document.querySelector('strong').firstChild, range=document.createRange();
    range.setStart(node,0);range.setEnd(node,node.length);getSelection().removeAllRanges();getSelection().addRange(range);
    document.querySelector('strong').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  });
  await page.waitForSelector('#selection-tools:not([hidden])');
  await page.screenshot({path:output+'/selection-tools.png'});
  await page.locator('[data-note-action=tag]').click();
  const selectionMessage=await page.evaluate(()=>window.messages.findLast(m=>m.type==='annotation-create'));
  assert.equal(selectionMessage.action,'tag');
  assert.equal(selectionMessage.anchor.quote,'关键想法');
  const note={id:'test-note',anchor:selectionMessage.anchor};
  const htmlBefore=await page.locator('#article').innerHTML();
  await page.evaluate(data=>window.mica.receive(data),{type:'annotations',id,notes:[note]});
  await page.waitForFunction(()=>window.mica.diagnostics().annotations.matched===1);
  assert.equal(await page.locator('#article').innerHTML(),htmlBefore,'highlights do not wrap or rewrite the Markdown DOM');
  assert.equal(await page.evaluate(()=>CSS.highlights.get('mica-notes').size),1);
  await page.locator('strong').click();
  assert(await page.evaluate(()=>window.messages.some(m=>m.type==='annotation-open'&&m.noteId==='test-note')),'clicking highlight opens its note');
  await render('新增一段前言。\n\n'+annotatedText,'annotations-edited');
  await page.evaluate(data=>window.mica.receive(data),{type:'annotations',id,notes:[note]});
  await page.waitForFunction(()=>window.mica.diagnostics().annotations.matched===1);
  await page.evaluate(data=>{scrollTo(0,1000);window.mica.receive(data);},{type:'annotation-navigate',id,noteId:note.id});
  assert((await page.locator('strong').boundingBox()).y<120,'note navigation finds moved original text');
  await render('# 已删除摘录\n\n原文不存在。','annotation-missing');
  await page.evaluate(data=>window.mica.receive(data),{type:'annotations',id,notes:[note]});
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().annotations.matched),0);
  assert(await page.evaluate(()=>window.messages.findLast(m=>m.type==='annotation-state').missing.includes('test-note')),'missing quote is reported without altering note');
  await render('重复内容\n\n重复内容','annotation-ambiguous');
  await page.evaluate(data=>window.mica.receive(data),{type:'annotations',id,notes:[{id:'ambiguous',anchor:{quote:'重复内容',prefix:'',suffix:'',start:0}}]});
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().annotations.matched),0,'ambiguous repeated text is not guessed');
  await page.evaluate(data=>window.mica.receive(data),{type:'annotations',id:id-1,notes:[note]});
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().annotations.count),1,'stale annotation payload is ignored');
  const more=code('mermaid','sequenceDiagram\n Alice->>Bob: Hello\n Bob-->>Alice: Hi')+'\n\n'+
    code('mermaid','classDiagram\n Animal <|-- Duck\n Animal : +int age')+'\n\n'+
    code('mermaid','graph TD\n A[broken');
  await render(more,'more');
  await page.waitForFunction(()=>document.querySelectorAll('.diagram[data-ready]').length===2,{},{timeout:30000});
  await page.locator('.diagram').last().scrollIntoViewIfNeeded();
  await page.waitForSelector('.diagram[data-error]');
  const tall=code('mermaid','flowchart TB\n'+Array.from({length:14},(_,i)=>`N${i}[阶段${i}]-->N${i+1}`).join('\n'))+'\n\n## 图表下方的正文\n\n正文保持在原位。';
  await render(tall,'stable-diagram');
  const beforeDiagram=await page.locator('h2').evaluate(el=>el.getBoundingClientRect().top);
  await page.waitForSelector('.diagram[data-ready] svg');
  assert.equal(await page.locator('.diagram [data-mica-route]').count(),0,'routes are not rewritten after layout');
  const afterDiagram=await page.locator('h2').evaluate(el=>el.getBoundingClientRect().top);
  assert(Math.abs(afterDiagram-beforeDiagram)<1,'late diagram rendering does not displace following text');
  await page.locator('[data-action=diagram-open]').click();
  await page.waitForSelector('#viewer[open] svg');
  assert(await page.locator('#drawing svg').evaluate(el=>el.viewBox.baseVal.height>500),'full diagram remains available outside the small preview');
  await page.locator('[data-view=close]').click();
  const long=('# 长文测试\n\n正文包含 **加粗**、[链接](https://example.com) 和列表。\n\n- 项目一\n- 项目二\n\n'+code('js','const value = 42;')+'\n\n').repeat(1800);
  const longMetrics=await render(long,'long');
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight*.63));await page.waitForTimeout(120);
  const anchorMessage=await page.evaluate(()=>messages.findLast(m=>m.type==='position')?.anchor);
  assert(anchorMessage?.line>100,'reader publishes a source anchor, not only pixels');
  await page.evaluate(({text,id,anchor})=>window.mica.receive({type:'render',id,key:'anchor-restore',text,conversation:false,anchor,offset:0}),{text:long,id:++id,anchor:anchorMessage});
  await page.waitForFunction(id=>messages.some(m=>m.type==='rendered'&&m.id===id),id);
  await page.waitForTimeout(120);
  const restoredAnchor=await page.evaluate(()=>messages.findLast(m=>m.type==='position')?.anchor);
  assert(Math.abs(restoredAnchor.line-anchorMessage.line)<8,'source anchor survives rerender: '+JSON.stringify({anchorMessage,restoredAnchor}));
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:output+'/long-scrollbar.png'});
  const scrollbar=await page.evaluate(()=>({width:getComputedStyle(document.querySelector('#scroll-rail')).width,min:getComputedStyle(document.querySelector('#scroll-thumb')).minHeight}));
  assert.equal(scrollbar.width,'18px');
  assert.equal(scrollbar.min,'56px');
  // Grab well below the old tiny thumb: proves the larger thumb, not just the track, is usable.
  await page.mouse.move(1191,30);
  await page.mouse.down();
  const beforeDrag=await page.evaluate(()=>scrollY);
  assert(beforeDrag<5,'pressing the enlarged thumb does not page-scroll');
  await page.mouse.move(1191,350,{steps:12});
  const duringDrag=await page.evaluate(()=>scrollY);
  await page.mouse.up();
  assert(duringDrag>0,'article moves while scrollbar thumb remains pressed');
  await page.evaluate(()=>scrollTo(0,0));
  const scrolling=await page.evaluate(async()=>{
    const gaps=[];let previous=performance.now();
    for(let i=0;i<60;i++){window.scrollBy(0,120);await new Promise(requestAnimationFrame);const now=performance.now();gaps.push(now-previous);previous=now;}
    return {offset:scrollY,maxFrameMs:Math.max(...gaps),averageFrameMs:gaps.reduce((a,b)=>a+b)/gaps.length};
  });
  assert(scrolling.offset>0);
  await render('# 第二份文档','other');
  const cached=await render(long,'long');
  assert(cached.cached);
  await page.evaluate(({text,id})=>{window.mica.receive({type:'render',id,key:'cancel',text});window.mica.receive({type:'render',id:id+1,key:'latest',text:'# 最新文档'});},{text:long,id:++id});
  id++;
  await page.waitForFunction(()=>document.querySelector('#article h1')?.textContent==='最新文档');
  assert.equal(errors.length,0,errors.join('\n'));
  assert(!requests.some(url=>!url.startsWith('http://127.0.0.1')&&!url.startsWith('data:')&&!url.startsWith('blob:')),'offline components made no external requests');
  const compact=({outline,...rest})=>({...rest,outlineCount:outline.length});
  const report={fixture:compact(metrics),themes:themeResults,scrollbar,longCharacters:long.length,long:compact(longMetrics),cached:compact(cached),scrolling,duringDrag,errors};
  await writeFile(output+'/metrics.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  console.log('PASS: modern diagram worker, compatibility path, viewer actions, math, sanitation, long scrolling, cache, cancellation, offline.');
} finally {await browser.close();server.close();}
