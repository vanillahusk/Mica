import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {diagrams,heavy} from '../experiments/fixtures.mjs';
const {chromium}=await import(process.env.MICA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('dist');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/test/client.js'){res.setHeader('Content-Type','text/javascript');return res.end(await readFile('src/diagram-client.js'));}
  // Fault injection is served by this test only; it is never packaged into ReaderAssets.
  if(path==='/test/stall.js'){res.setHeader('Content-Type','text/javascript');return res.end('onmessage=({data})=>{if(data.source==="busy"){const end=performance.now()+5000;while(performance.now()<end){}}postMessage({id:data.id,svg:"recovered"});}');}
  const file=resolve(root,'.'+path);if(!file.startsWith(root+sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1120,height:840}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.addInitScript(()=>{window.messages=[];window.chrome={webview:{postMessage:m=>messages.push(m),addEventListener(){}}};});
let id=0;
async function render(source){
  await page.evaluate(({id,source})=>window.mica.receive({type:'render',id,key:'isolated-'+id,text:'# 图表\n\n```mermaid\n'+source+'\n```',conversation:false}),{id:++id,source});
  await page.waitForFunction(id=>messages.some(m=>m.type==='rendered'&&m.id===id),id);
  await page.waitForFunction(()=>document.querySelector('.diagram[data-ready],.diagram[data-error]'),null,{timeout:20000});
}
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.waitForFunction(()=>window.mica);
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().diagramEngine),'isolated','modern worker renderer is the default');
  await render('stateDiagram-v2\n [*] --> PENDING\n PENDING --> SENDING: 条件抢占\n SENDING --> RETRY: 可恢复失败\n RETRY --> SENDING: 到达 nextRetryTime\n SENDING --> SENT: Broker确认成功\n SENDING --> DEAD: 超过最大重试\n SENDING --> PENDING: 超时后重新抢占');
  await mkdir('tests/output',{recursive:true});
  await writeFile('tests/output/state.svg',await page.locator('.diagram svg').evaluate(el=>el.outerHTML));
  await page.screenshot({path:'tests/output/state.png'});
  for(const theme of ['warm','paper','sepia','midnight']){
    await page.evaluate(id=>window.mica.receive({type:'theme',id}),theme);
    await page.waitForSelector('.diagram[data-ready] svg');
    const boxes=await page.locator('.diagram .node.statediagram-state').evaluateAll(nodes=>nodes.map(node=>{
      const a=node.querySelector('rect.basic').getBoundingClientRect(),b=node.querySelector('text').getBoundingClientRect();
      return {inside:b.left>=a.left&&b.right<=a.right,offset:Math.abs((a.left+a.right-b.left-b.right)/2)};
    }));
    assert.equal(boxes.length,5);assert(boxes.every(b=>b.inside&&b.offset<1),theme+' state labels stay centered inside nodes');
  }
  for(const fixture of diagrams){
    await render(fixture.source);
    if(fixture.invalid){assert(await page.locator('[data-action=diagram-compatible]').count());continue;}
    assert.equal(await page.locator('.diagram[data-error]').count(),0,await page.locator('.diagram').textContent());
    const labels=await page.locator('.diagram svg').textContent();
    for(const label of fixture.labels)assert(labels.includes(label),fixture.name+': '+label);
    assert.equal(await page.locator('.diagram script,.diagram foreignObject,.diagram [onload]').count(),0);
    console.log('PASS isolated '+fixture.name);
  }
  const entities='erDiagram\n USER ||--o{ DEVICE : owns\n DEVICE ||--o{ DEVICE_ENTITLEMENT : has\n TEMPLATE ||--o{ TEMPLATE_VERSION : versions\n PROMPT_OPTIMIZATION_PROFILE ||--o{ IMAGE_JOB : configures\n DEVICE ||--o{ BATCH_JOB : submits\n BATCH_JOB ||--o{ IMAGE_JOB : contains\n IMAGE_JOB ||--o{ ENTITLEMENT_LEDGER : records\n IMAGE_JOB ||--o{ OUTBOX_MESSAGE : triggers';
  const branch='flowchart TD\n A[收到 eventId] --> B{原子抢占}\n B -->|不存在| C[写 PROCESSING 并执行业务]\n B -->|COMPLETED| D[直接跳过]\n B -->|PROCESSING| E[抛出可重试异常]\n C --> F{业务成功?}\n F -->|是| G[标记 COMPLETED]\n F -->|否| H[释放占用并抛异常]';
  const generation='flowchart TD\nA["统一 GenerationRequest"] --> B["能力表 + Planner"]\nB --> C["统一调用计划"]\nC --> D["Provider Driver"]\nD --> E["厂商专属请求格式"]\nE --> F["真实厂商 API"]\nF --> G["厂商专属响应"]\nG --> H["Driver 解析 + Pipeline 后处理"]\nH --> I["统一 GenerationOutcome"]\nI --> J["Worker 保存 OSS / MySQL"]';
  await render(generation);
  assert.equal(await page.locator('.diagram[data-error]').count(),0,await page.locator('.diagram').textContent());
  for(const label of ['统一 GenerationRequest','能力表 + Planner','Provider Driver','统一 GenerationOutcome','Worker 保存 OSS / MySQL'])assert((await page.locator('.diagram svg').textContent()).includes(label),'generation flowchart renders '+label);
  assert.equal(await page.locator('.diagram .node').count(),10,'generation flowchart keeps all ten nodes');
  for(const theme of ['warm','paper']){
    await page.evaluate(id=>window.mica.receive({type:'theme',id}),theme);
    await render(branch);
    await page.locator('[data-action=diagram-open]').click();
    await page.waitForSelector('#viewer[open] svg');
    assert(await page.locator('#drawing .flowchart-link').evaluateAll(paths=>paths.some(p=>p.getAttribute('d').includes('C'))),'branch routing uses native basis curves');
    await page.screenshot({path:'tests/output/branch-'+theme+'.png'});
    await page.locator('[data-view=close]').click();
  }
  const architecture=(await readFile('../samples/架构曲线验证.md','utf8')).split('```mermaid\n')[1].split('```')[0];
  await page.evaluate(()=>window.mica.receive({type:'theme',id:'warm'}));
  await page.setViewportSize({width:1700,height:960});
  await render(architecture);await page.locator('[data-action=diagram-open]').click();await page.waitForSelector('#viewer[open] svg');
  assert(await page.locator('#drawing .flowchart-link').evaluateAll(paths=>paths.filter(p=>p.getAttribute('d').includes('C')).length>15),'dense architecture has native smooth curves');
  await page.screenshot({path:'tests/output/architecture-curves.png'});await page.locator('[data-view=close]').click();
  await page.setViewportSize({width:1120,height:840});
  for(const engine of ['isolated','compatible']){
    await page.evaluate(engine=>window.mica.receive({type:'diagram-engine',isolated:engine==='isolated'}),engine);
    await render(entities);
    await page.locator('[data-action=diagram-open]').click();await page.waitForSelector('#viewer[open] svg');
    const labels=await page.locator('#drawing svg text').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,lines:[...n.querySelectorAll('tspan')].map(t=>t.textContent)})));
    for(const name of ['PROMPT_OPTIMIZATION_PROFILE','DEVICE_ENTITLEMENT','OUTBOX_MESSAGE']){
      const label=labels.find(n=>n.text===name);assert(label,engine+' preserves '+name);
      assert(label.lines.every(line=>line===name),engine+' does not break long entity identifiers');
    }
    console.log('PASS '+engine+' ER long identifiers');
    await page.screenshot({path:'tests/output/entities-'+engine+'.png'});
    await page.locator('[data-view=close]').click();
  }
  await page.evaluate(()=>window.mica.receive({type:'diagram-engine',isolated:true}));
  await render(diagrams[0].source);
  await page.locator('[data-action=diagram-open]').click();await page.waitForSelector('#viewer[open] svg');
  await page.locator('[data-view=in]').click();await page.locator('#viewer-more summary').click();await page.locator('[data-view=window]').click();
  assert(await page.evaluate(()=>messages.some(m=>m.type==='diagram-window'&&m.engine==='isolated')),'separate window preserves engine');
  await page.locator('[data-view=close]').click();
  for(const theme of ['paper','midnight','sepia','warm']){
    await page.evaluate(id=>window.mica.receive({type:'theme',id}),theme);await page.waitForSelector('.diagram[data-ready] svg');
    await mkdir('tests/output',{recursive:true});await page.screenshot({path:'tests/output/isolated-'+theme+'.png'});
  }
  await render(heavy);
  assert(await page.locator('.diagram[data-ready] svg').count(),'Dagre renders the dense graph within the worker deadline');
  await render('flowchart TD\n A[broken');
  assert(await page.locator('[data-action=diagram-compatible]').isVisible(),'failure offers explicit fallback');
  await page.waitForTimeout(150);assert.equal(await page.locator('.diagram svg').count(),0,'no silent fallback to main thread');
  const watchdog=await page.evaluate(async()=>{
    const {DiagramClient}=await import('/test/client.js');const client=new DiagramClient({workerFactory:()=>new Worker('/test/stall.js'),timeoutMs:1000});
    await client.run('warm',{});client.timeoutMs=150;let ticks=0;const timer=setInterval(()=>ticks++,10),start=performance.now();let error;
    try{await client.run('busy',{});}catch(e){error=e.message;}
    const elapsed=performance.now()-start;clearInterval(timer);client.timeoutMs=1000;const recovered=await client.run('ok',{});
    const one=client.run('busy',{}).catch(e=>e.name),two=client.run('queued',{}).catch(e=>e.name);client.cancel();
    return {error,elapsed,ticks,recovered,cancelled:await one,queuedCancelled:await two};
  });
  assert.match(watchdog.error,/超时/);assert(watchdog.elapsed<1500);assert(watchdog.ticks>3);assert.equal(watchdog.recovered,'recovered');assert.equal(watchdog.cancelled,'AbortError');assert.equal(watchdog.queuedCancelled,'AbortError');
  await page.evaluate(source=>{window.mica.receive({type:'render',id:999,key:'pending',text:'```mermaid\n'+source+'\n```'});},heavy);
  await page.waitForFunction(()=>window.mica.diagnostics().diagramWorker.active);
  await page.evaluate(()=>window.mica.receive({type:'render',id:1000,key:'latest',text:'# 新文档'}));
  await page.waitForFunction(()=>messages.some(m=>m.type==='rendered'&&m.id===1000));
  assert.equal(await page.evaluate(()=>window.mica.diagnostics().diagramWorker.active),false);
  assert.equal(await page.locator('#article h1').textContent(),'新文档');
  assert.deepEqual(errors,[]);assert(!requests.some(url=>!url.startsWith('http://127.0.0.1')&&!url.startsWith('data:')));
  await writeFile('tests/output/isolated-diagrams.json',JSON.stringify({watchdog,errors,fixtures:diagrams.length},null,2));
  console.log(JSON.stringify(watchdog));console.log('PASS isolated diagrams, labels, themes, resource guards, manual fallback, timeout recovery, cancellation, offline');
}finally{await browser.close();await new Promise(r=>server.close(r));}
