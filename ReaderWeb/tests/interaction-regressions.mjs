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
const browser=await chromium.launch({channel:'msedge',headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
const page=await browser.newPage({viewport:{width:1120,height:840}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.messages=[];window.chrome={webview:{postMessage:m=>messages.push(m),addEventListener(){}}};});
let id=0;
async function render(text,edit=false){
  id++;
  await page.evaluate(({text,id})=>window.mica.receive({type:'render',text,id,key:'interaction-'+id,conversation:false}),{text,id});
  await page.waitForFunction(id=>messages.some(m=>m.type==='rendered'&&m.id===id),id);
  if(edit){await page.evaluate(({text,id})=>window.mica.receive({type:'edit',text,id}),{text,id});await page.waitForFunction(id=>messages.some(m=>m.type==='edit-ready'&&m.id===id),id);}
}
try{
  await mkdir('tests/output',{recursive:true});
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.waitForFunction(()=>window.mica);
  const fixture='# 文本选择回归\n\n- 已完成节点是否需要重新执行。\n\n这些属于项目中 Contract Orchestrator 的职责。\n\n> 这是一份可独立阅读的架构快照，正文已经包含系统拓扑、核心代码、设计原因、故障边界、验证结果和面试口径，不要求读者打开其他项目文档。内容已同步截至最新完成的社区链路。\n\n下一段正文。\n';
  await render(fixture,true);
  // Target actual painted glyph bounds, not coordsAtPos (which could share the same bug).
  for(const width of [1120,700])for(const zoom of [100,125,150]){
    await page.setViewportSize({width,height:840});
    await page.evaluate(value=>window.mica.receive({type:'zoom',value}),zoom);
    await page.waitForTimeout(100);
    const dots=await page.evaluate(()=>{
      const v=window.mica.editorView(),nodes=[];
      const walk=document.createTreeWalker(v.contentDOM,NodeFilter.SHOW_TEXT);
      while(walk.nextNode()){
        const node=walk.currentNode;
        for(let i=0;i<node.length;i++)if(node.data[i]==='。'){
          const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);
          const b=r.getBoundingClientRect();
          if(b.top>60&&b.bottom<innerHeight-20)nodes.push({from:v.posAtDOM(node,i),to:v.posAtDOM(node,i+1),x:b.x,y:b.y,w:b.width,h:b.height,mapped:v.posAtCoords({x:b.x+.2,y:b.y+b.height/2}),lineHeight:v.defaultLineHeight,block:v.lineBlockAt(v.posAtDOM(node,i)),documentTop:v.documentTop});
        }
      }
      return nodes;
    });
    for(const dot of dots){
      await page.mouse.move(dot.x+.2,dot.y+dot.h/2);await page.mouse.down();
      await page.mouse.move(dot.x+dot.w-.2,dot.y+dot.h/2,{steps:5});await page.mouse.up();
      const selected=await page.evaluate(()=>{const v=window.mica.editorView(),s=v.state.selection.main;return {from:s.from,to:s.to,text:v.state.sliceDoc(s.from,s.to)};});
      assert.equal(selected.text,'。',JSON.stringify({width,zoom,dot,selected}));
    }
  }
  await page.setViewportSize({width:1120,height:840});
  await page.evaluate(()=>window.mica.receive({type:'zoom',value:100}));
  console.log('PASS punctuation selection across widths and font zoom');
  const luminance=c=>{
    const [r,g,b]=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
    return .2126*r+.7152*g+.0722*b;
  };
  for(const theme of ['warm','paper','sepia','midnight']){
    await page.evaluate(id=>{
      window.mica.receive({type:'theme',id});const v=window.mica.editorView();
      const from=v.state.doc.toString().indexOf('这是一份'),to=v.state.doc.toString().indexOf('下一段');
      v.dispatch({selection:{anchor:from,head:to-2}});v.focus();
    },theme);
    await page.waitForFunction(()=>getSelection()?.toString().includes('这是一份'));
    const colors=await page.locator('.live-quote').first().evaluate(el=>{const s=getComputedStyle(el,'::selection');return {fg:s.color,bg:s.backgroundColor};});
    const a=luminance(colors.fg),b=luminance(colors.bg),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert(contrast>=4.5,theme+' quote selection contrast '+contrast);
    assert.equal(await page.locator('.cm-selectionLayer').count(),0,'no layer behind opaque quote backgrounds');
    await page.screenshot({path:'tests/output/quote-selection-'+theme+'.png'});
  }
  console.log('PASS native quote selection with contrasting foreground/background in all four themes');
  const long=Array.from({length:2000},(_,i)=>`## 章节 ${i}\n\n${'中英文混排 with a longer paragraph，测试滚动轨道。'.repeat(i%9+1)}\n\n\`\`\`java\nint n = ${i};\n\`\`\`\n\n`).join('');
  const start=Date.now();await render(long);const loadMs=Date.now()-start;
  async function dragTest(editing){
    const rail=page.locator('#scroll-rail'),thumb=page.locator('#scroll-thumb');
    await rail.waitFor({state:'visible'});await page.waitForTimeout(100);
    const track=await rail.boundingBox(),handle=await thumb.boundingBox(),grab=handle.height/2,x=handle.x+handle.width/2;
    await page.mouse.move(x,handle.y+grab);await page.mouse.down();
    const results=[];
    for(const fraction of [.15,.5,.85,.32,.7]){
      const y=track.y+grab+fraction*(track.height-handle.height);
      await page.mouse.move(x,y,{steps:5});await page.waitForTimeout(100);
      // Simulate a document-height change while the pointer is held, without another move.
      if(fraction===.5){await page.evaluate(()=>window.mica.receive({type:'zoom',value:125}));await page.waitForTimeout(120);}
      const state=await page.evaluate(editing=>{
        const s=editing?window.mica.editorView().scrollDOM:document.documentElement;
        const b=document.querySelector('#scroll-thumb').getBoundingClientRect();
        return {top:b.top,ratio:s.scrollTop/(s.scrollHeight-s.clientHeight)};
      },editing);
      assert(Math.abs(state.top+grab-y)<2,'thumb follows held mouse '+JSON.stringify({fraction,y,state}));
      assert(Math.abs(state.ratio-fraction)<.008,'document follows thumb '+JSON.stringify({fraction,state}));results.push(state);
    }
    await page.mouse.up();await page.evaluate(()=>window.mica.receive({type:'zoom',value:100}));return results;
  }
  const readingDrag=await dragTest(false);
  // After a distant first visit there are no estimated text chunk heights to correct.
  const fullHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);
  assert(Math.abs(fullHeight-await page.evaluate(()=>document.documentElement.scrollHeight))<2);
  await page.evaluate(({id,text})=>window.mica.receive({type:'edit',id,text}),{id,text:long});
  await page.waitForFunction(id=>messages.some(m=>m.type==='edit-ready'&&m.id===id),id);
  const editingDrag=await dragTest(true);
  console.log(JSON.stringify({characters:long.length,loadMs,readingDrag,editingDrag}));
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
