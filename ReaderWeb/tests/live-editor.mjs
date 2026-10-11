import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.MICA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('dist');
const server=createServer(async(req,res)=>{
  const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1120,height:840}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.messages=[];window.chrome={webview:{postMessage:m=>messages.push(m),addEventListener(){}}};});
let id=0;
async function edit(text){
  id++;
  await page.evaluate(({text,id})=>window.mica.receive({type:'render',text,id,key:'edit-'+id,conversation:false}),{text,id});
  await page.waitForFunction(id=>messages.some(m=>m.type==='rendered'&&m.id===id),id);
  await page.evaluate(({text,id})=>window.mica.receive({type:'edit',text,id}),{text,id});
  await page.waitForFunction(id=>messages.some(m=>m.type==='edit-ready'&&m.id===id),id);
}
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.waitForFunction(()=>window.mica);
  const fixture='# 在阅读中，留下想法\n\n在正文里直接编辑，**重要的文字**与 *轻柔的强调* 自然呈现。\n\n## 少一点干扰，多一点思考\n\n- 读到值得记住的地方，留下一条笔记\n- 为零散想法添加标签\n\n> 阅读是与另一个思维缓慢交谈。\n\n```java\npublic class Reader {\n    String title = "Mica";\n}\n```\n\n| 模式 | 用途 |\n| --- | --- |\n| 阅读 | 安静浏览 |\n| 编辑 | 直接修改正文 |\n\n数学 $x^2$。\n';
  await edit(fixture);
  assert.equal(await page.evaluate(()=>window.mica.editorSnapshot().text),fixture,'untouched Markdown round-trips exactly');
  assert(await page.locator('.live-h1').count(),'headings are typeset inside editable document');
  assert(await page.locator('.live-strong').count(),'bold renders in place');
  await page.waitForSelector('.live-block code .hljs-keyword');
  assert(await page.locator('.live-block table').count(),'inactive table is rendered');
  await page.locator('.live-block table td').last().click();
  assert.equal(await page.evaluate(()=>{const v=window.mica.editorView(),s=v.state.selection.main;return v.state.sliceDoc(s.from,s.to);}), '直接修改正文','clicking a preview table cell selects its Markdown cell source');
  await page.evaluate(()=>{const v=window.mica.editorView();v.dispatch({selection:{anchor:0}});});
  await page.evaluate(()=>{const v=window.mica.editorView();v.dispatch({selection:{anchor:18,head:26}});v.focus();});
  for(const theme of ['warm','paper','midnight','sepia']){
    await page.evaluate(id=>window.mica.receive({type:'theme',id}),theme);
    await page.waitForFunction(()=>getSelection()?.toString().length>0);
    const colors=await page.evaluate(()=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--selectBg)';document.body.append(probe);const expected=getComputedStyle(probe).backgroundColor;probe.remove();return {actual:getComputedStyle(document.querySelector('.cm-line'),'::selection').backgroundColor,expected};});
    assert.equal(colors.actual,colors.expected,'selected text uses '+theme+' theme rather than default pale purple');
  }
  await page.evaluate(()=>window.mica.receive({type:'theme',id:'warm'}));
  await page.screenshot({path:'tests/output/editor-selection.png'});
  await page.evaluate(()=>{const v=window.mica.editorView();v.dispatch({selection:{anchor:0}});});
  const drag=await page.evaluate(()=>{const v=window.mica.editorView();window.keptBlock=document.querySelector('.live-block');const start=v.coordsAtPos(20),box=window.keptBlock.getBoundingClientRect();return {x:start.left,y:(start.top+start.bottom)/2,endX:box.right-40,endY:box.bottom-15};});
  await page.mouse.move(drag.x,drag.y);await page.mouse.down();await page.mouse.move(drag.endX,drag.endY,{steps:18});
  assert.equal(await page.locator('.live-code-line').count(),0,'dragging across a preview does not expand its source');
  assert(await page.evaluate(()=>window.keptBlock===document.querySelector('.live-block')),'dragging preserves preview DOM identity');
  await page.mouse.up();
  assert(await page.evaluate(()=>!window.mica.editorView().state.selection.main.empty),'real mouse drag creates a selection');
  assert.equal(await page.locator('.live-code-line').count(),0,'releasing a nonempty selection preserves block layout');
  await mkdir('tests/output',{recursive:true});await page.screenshot({path:'tests/output/live-editor.png'});
  await page.locator('.live-block button').first().click();
  assert(await page.locator('.live-code-line').count(),'clicking a block edits its source in place');
  assert.equal(await page.evaluate(()=>window.mica.editorSnapshot().text),fixture,'opening a block does not rewrite it');
  await page.evaluate(()=>{const v=window.mica.editorView();v.dispatch({selection:{anchor:v.state.doc.length}});v.focus();});
  await page.keyboard.insertText('中文输入保留');
  assert((await page.evaluate(()=>window.mica.editorSnapshot().text)).endsWith('中文输入保留'));
  await page.locator('[data-format=undo]').click();
  assert.equal(await page.evaluate(()=>window.mica.editorSnapshot().text),fixture,'mouse undo works');
  await page.locator('[data-format=redo]').click();
  assert((await page.evaluate(()=>window.mica.editorSnapshot().text)).endsWith('中文输入保留'));
  await page.locator('[data-format=bold]').click();
  assert((await page.evaluate(()=>window.mica.editorSnapshot().text)).endsWith('**重点**'),'format button edits real Markdown');
  const snapshot=await page.evaluate(()=>window.mica.endEditing());
  assert(snapshot.changed);assert(snapshot.text.includes('中文输入保留'));
  assert.equal(await page.locator('#live-workspace').isVisible(),false);
  const crlf='# 文件\r\n\r\n原文[^1]\r\n\r\n[^1]: 脚注\r\n\r\n```mermaid\r\nflowchart LR\r\n A-->B\r\n```\r\n\r\n$$x^2$$\r\n';
  await edit(crlf);
  assert.equal(await page.evaluate(()=>window.mica.editorSnapshot().text),crlf,'CRLF and extended syntax are lossless');
  await page.waitForSelector('.live-diagram svg');
  await page.waitForSelector('.live-block .katex');
  await page.evaluate(()=>{const v=window.mica.editorView();v.dispatch({changes:{from:v.state.doc.length,insert:'结尾'}});});
  assert.equal(await page.evaluate(()=>window.mica.endEditing().text),crlf+'结尾','editing preserves Windows newlines');
  const long=Array.from({length:2200},(_,i)=>'## 第 '+i+' 节\n\n长文中的 **重要文字** 与正文。\n\n```java\nint n = '+i+';\n```\n\n').join('');
  const start=Date.now();await edit(long);const readyMs=Date.now()-start;
  const typingMs=await page.evaluate(()=>{const v=window.mica.editorView(),start=performance.now();for(let i=0;i<20;i++)v.dispatch({changes:{from:0,insert:'字'}});return performance.now()-start;});
  assert(await page.evaluate(()=>messages.filter(m=>m.type==='edit-change').every(m=>!('text' in m))),'keystrokes do not send full documents over the native bridge');
  await page.waitForTimeout(500);
  const selection=await page.evaluate(()=>{
    const v=window.mica.editorView(),before=window.mica.editorDiagnostics(),start=performance.now(),times=[];
    for(let i=0;i<200;i++){const time=performance.now();v.dispatch({selection:{anchor:24,head:25+i%80}});times.push(performance.now()-time);}
    times.sort((a,b)=>a-b);return {ms:performance.now()-start,p95:times[190],before,after:window.mica.editorDiagnostics()};
  });
  assert.equal(selection.before.blockScans,selection.after.blockScans,'continuous selection does not scan all blocks');
  assert.equal(selection.before.inlineBuilds,selection.after.inlineBuilds,'continuous selection does not rebuild inline decorations');
  // Synthetic composition verifies our guard; real OS IME candidate-window behavior still needs manual testing.
  await page.evaluate(()=>{const v=window.mica.editorView();v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));});
  assert(await page.evaluate(()=>window.mica.endEditing().composing),'switching cannot discard an uncommitted composition');
  assert(await page.evaluate(()=>!!window.mica.editorView()));
  await page.evaluate(()=>{const v=window.mica.editorView();v.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));});
  await page.waitForTimeout(80);
  assert(await page.locator('.cm-line').count()<300,'long document editing is viewport-virtualized');
  await page.evaluate(()=>window.mica.endEditing());
  await page.evaluate(()=>{const target=document.querySelector('[data-source-line="801"]');target.closest('.chunk').style.contentVisibility='visible';target.scrollIntoView();});
  await page.evaluate(({id,text})=>window.mica.receive({type:'edit',id,text}),{id,text:long});
  await page.waitForFunction(()=>!!window.mica.editorView());
  const restoredLine=await page.evaluate(()=>{const v=window.mica.editorView();return v.state.doc.lineAt(v.state.selection.main.head).number;});
  assert(Math.abs(restoredLine-801)<5,'reading-to-editing stays at the source paragraph: '+restoredLine);
  console.log(JSON.stringify({characters:long.length,readAndEditReadyMs:readyMs,twentyEditsMs:typingMs,selection,errors}));
  assert.deepEqual(errors,[]);
  // A late lazy import/initialization must not overwrite a newly opened document.
  await page.evaluate(()=>{window.mica.endEditing();window.mica.receive({type:'edit',id:3,text:'旧文档'});window.mica.receive({type:'render',id:99,key:'latest',text:'# 新文档',conversation:false});});
  await page.waitForFunction(()=>messages.some(m=>m.type==='rendered'&&m.id===99));
  assert.equal(await page.locator('#live-workspace').isVisible(),false);
  console.log('PASS live editing, block previews, mouse formatting, undo, Unicode, CRLF, long document and cancellation');
}finally{await browser.close();await new Promise(r=>server.close(r));}
