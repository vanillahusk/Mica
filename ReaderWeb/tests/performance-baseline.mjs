import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.MICA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('dist'),output=resolve('tests/output');
const server=createServer(async(req,res)=>{const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true,ignoreDefaultArgs:['--hide-scrollbars']}),page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{window.messages=[];window.chrome={webview:{postMessage:m=>window.messages.push(m),addEventListener(){}}};});
const paragraph='这是一段用于验证长文档阅读性能的正文。Mica keeps scrolling stable while Markdown mounts progressively.\n\n';
function documentOf(target){let text='# 长文性能基线\n\n',i=0;while(text.length<target){text+=`## 章节 ${i++}\n\n${paragraph.repeat(4)}- 第一项\n- 第二项\n\n`;}return text.slice(0,target);}
try{
  await mkdir(output,{recursive:true});await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.waitForFunction(()=>window.mica);
  const results=[];let id=0;
  for(const characters of [100_000,500_000,1_000_000]){
    const text=documentOf(characters),started=performance.now();id++;
    await page.evaluate(({id,text})=>window.mica.receive({type:'render',id,key:'perf-'+id,text,conversation:false}),{id,text});
    await page.waitForFunction(id=>window.messages.some(message=>(message.type==='rendered'||message.type==='error')&&message.id===id),id,{timeout:60000});
    const metrics=await page.evaluate(id=>window.messages.find(message=>(message.type==='rendered'||message.type==='error')&&message.id===id),id);assert.equal(metrics.type,'rendered',metrics.error);
    const scroll=await page.evaluate(async()=>{const frames=[];let before=performance.now();for(let i=0;i<80;i++){scrollBy(0,160);await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-before);before=now;}const ordered=[...frames].sort((a,b)=>a-b);return{maxFrameMs:Math.max(...frames),p95FrameMs:ordered[Math.floor((ordered.length-1)*.95)],averageFrameMs:frames.reduce((a,b)=>a+b,0)/frames.length,offset:scrollY};});
    results.push({characters,wallMs:performance.now()-started,firstPaintMs:metrics.firstPaintMs,totalMs:metrics.totalMs,parseMs:metrics.parseMs,...scroll});
    assert(metrics.firstPaintMs<800,`${characters} first paint ${metrics.firstPaintMs}ms`);assert(scroll.p95FrameMs<80,`${characters} p95 scroll frame ${scroll.p95FrameMs}ms`);assert(scroll.maxFrameMs<400,`${characters} frozen scroll frame ${scroll.maxFrameMs}ms`);
  }
  const richMessages=Array.from({length:500},(_,index)=>({id:'perf-'+index,role:'assistant',text:`<card><title level="3">卡片 ${index+1}</title><text>正文 **加粗** 与 [链接](https://example.com/${index}).</text><row><col>左列</col><col>右列</col></row></card>`})),rich=richMessages.map(message=>message.text).join('\n');id++;
  await page.evaluate(({id,text,messages})=>window.mica.receive({type:'render',id,key:'perf-rich',text,conversation:true,messages}),{id,text:rich,messages:richMessages});
  await page.waitForFunction(id=>window.messages.some(message=>(message.type==='rendered'||message.type==='error')&&message.id===id),id,{timeout:60000});
  const richMetrics=await page.evaluate(id=>window.messages.find(message=>(message.type==='rendered'||message.type==='error')&&message.id===id),id);assert.equal(richMetrics.type,'rendered',richMetrics.error);results.push({kind:'gpt-rich',characters:rich.length,firstPaintMs:richMetrics.firstPaintMs,totalMs:richMetrics.totalMs,parseMs:richMetrics.parseMs});
  assert(richMetrics.richText.detected);assert(richMetrics.parseMs<1000,`rich parse ${richMetrics.parseMs}ms`);assert(richMetrics.firstPaintMs<1500,`rich first paint ${richMetrics.firstPaintMs}ms`);
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'performance-baseline.json'),JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
