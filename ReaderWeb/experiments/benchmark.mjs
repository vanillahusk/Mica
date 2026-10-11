import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {cpus,release} from 'node:os';
import assert from 'node:assert/strict';
import {diagrams,heavy,medium,markdown} from './fixtures.mjs';
const {chromium}=await import(process.env.MICA_PLAYWRIGHT_MODULE||'playwright');
const output=resolve('output');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),reader=url.pathname.startsWith('/reader/');
  const root=resolve(reader?'../dist':'dist'),file=resolve(root,'.'+(reader?url.pathname.slice(7):url.pathname));
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const stats=values=>{const n=[...values].sort((a,b)=>a-b);return {median:n[Math.floor(n.length/2)],min:n[0],max:n.at(-1),samples:n.length};};
async function bounded(promise,ms=20000){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Experiment renderer exceeded host deadline')),ms);})]);}
  finally{clearTimeout(timer);}
}
function workingSet(pid){
  if(process.platform!=='win32')return null;
  try{
    const script=`$ErrorActionPreference='Stop'; $taskRows=Get-CimInstance Win32_Process; $taskIds=[System.Collections.Generic.HashSet[int]]::new(); [void]$taskIds.Add(${Number(pid)}); do { $taskChanged=$false; foreach($taskRow in $taskRows) { if($taskIds.Contains([int]$taskRow.ParentProcessId) -and $taskIds.Add([int]$taskRow.ProcessId)) { $taskChanged=$true } } } while($taskChanged); $taskBytes=0; foreach($taskId in $taskIds) { $taskProc=Get-Process -Id $taskId -ErrorAction SilentlyContinue; if($taskProc) {$taskBytes += $taskProc.WorkingSet64} }; $taskBytes`;
    return Number(execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true}).trim());
  }catch{return null;}
}
const report={date:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,os:release(),versions:{mermaid:'12.0.0',merman:'0.8.0-alpha.7',satteri:'0.10.5'},diagrams:{},notes:['Five warm samples per engine; one cold sample. Headless timer gaps are not physical display FPS.','Working sets sum the isolated browser process tree; shared pages can be counted more than once. Not unique physical memory.','Merman uses its worker-compatible text metrics, not a browser DOM text-measurement callback. Visual parity must be reviewed.']};
try{
  for(const engine of ['mermaid-main','merman-main','merman-worker','merman-worker-safe']){
    const instance=await chromium.launchServer({channel:'msedge',headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
    const browser=await chromium.connect(instance.wsEndpoint());
    report.browser=browser.version();
    try{
      const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(20000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/index.html');await page.waitForFunction(()=>window.experiment);
      const row={workingSetBefore:workingSet(instance.process().pid),cases:[],errors};
      const render=source=>bounded(page.evaluate(({engine,source})=>window.experiment.render(engine,source),{engine,source}));
      row.cold=await render(diagrams[0].source);
      for(const fixture of diagrams){
        const result=await render(fixture.source);
        result.name=fixture.name;
        result.pass=fixture.invalid?!!result.error:result.valid&&fixture.labels.every(label=>(result.labels||'').replace(/\s/g,'').includes(label.replace(/\s/g,'')));
        row.cases.push(result);
        if(!fixture.invalid)await page.screenshot({path:output+'/'+engine+'-'+fixture.name+'.png'});
      }
      const mediumSamples=[];
      for(let n=0;n<5;n++)mediumSamples.push(await render(medium));
      row.mediumSamples=mediumSamples;
      const accepted=mediumSamples.filter(s=>!s.error);
      row.medium=accepted.length?{renderMs:stats(accepted.map(s=>s.renderMs)),displayMs:stats(accepted.map(s=>s.displayMs)),maxTimerGapMs:stats(accepted.map(s=>s.maxTimerGapMs))}:{error:mediumSamples[0].error};
      row.workingSetAfterMedium=workingSet(instance.process().pid);
      const samples=[];
      for(let n=0;n<5;n++)samples.push(await render(heavy));
      row.heavySamples=samples;
      const good=samples.filter(s=>!s.error);
      row.heavy=good.length?{renderMs:stats(good.map(s=>s.renderMs)),displayMs:stats(good.map(s=>s.displayMs)),maxTimerGapMs:stats(good.map(s=>s.maxTimerGapMs))}:{error:samples[0].error};
      row.workingSetAfter=workingSet(instance.process().pid);
      if(engine==='merman-worker'){row.watchdog=await page.evaluate(()=>window.experiment.watchdog());assert.match(row.watchdog.result,/deadline/);assert(row.watchdog.ticks>0);assert(row.watchdog.recovered);assert.equal(row.watchdog.cancelResult,'document switched');}
      report.diagrams[engine]=row;
      console.log(engine,JSON.stringify({cold:row.cold.displayMs,passed:row.cases.filter(c=>c.pass).length,total:row.cases.length,heavy:row.heavy,medium:row.medium,workingSetAfter:row.workingSetAfter,watchdog:row.watchdog}));
    }finally{await browser.close();await instance.close();}
  }
  // Compare current chunk skipping against eager layout, without changing production CSS.
  const browser=await chromium.launch({channel:'msedge',headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
  try{
    report.longDocument={characters:markdown.length,variants:{}};
    for(const variant of ['current-auto','eager-layout']){
      const page=await browser.newPage({viewport:{width:1200,height:900}});
      await page.addInitScript(()=>{window.messages=[];window.chrome={webview:{postMessage:m=>window.messages.push(m),addEventListener:()=>{}}};});
      await page.goto(base+'/reader/index.html');await page.waitForFunction(()=>window.mica);
      if(variant==='eager-layout')await page.addStyleTag({content:'.chunk{content-visibility:visible!important}'});
      const runs=[];
      for(let n=1;n<=5;n++){
        await page.evaluate(({text,id})=>window.mica.receive({type:'render',id,key:'long-'+id,text,conversation:false}),{text:markdown,id:n});
        await page.waitForFunction(id=>window.messages.some(m=>m.type==='rendered'&&m.id===id),n);
        const timing=await page.evaluate(id=>{const {outline,...m}=window.messages.find(m=>m.type==='rendered'&&m.id===id);return m;},n);
        const stability=await page.evaluate(async()=>{
          const target=document.querySelectorAll('#article h1')[900];window.mica.receive({type:'navigate',id:target.id});
          const before=target.getBoundingClientRect().top,heightBefore=document.documentElement.scrollHeight;
          await new Promise(r=>setTimeout(r,400));
          return {anchorDelta:target.getBoundingClientRect().top-before,heightDelta:document.documentElement.scrollHeight-heightBefore,targetTop:target.getBoundingClientRect().top};
        });
        runs.push({...timing,...stability});
      }
      report.longDocument.variants[variant]={firstPaintMs:stats(runs.map(r=>r.firstPaintMs)),totalMs:stats(runs.map(r=>r.totalMs)),maxAnchorDelta:Math.max(...runs.map(r=>Math.abs(r.anchorDelta))),runs};
      await page.close();
    }
    report.lateDiagram={};
    for(const variant of ['legacy-auto-height','reserved-height']){
      const page=await browser.newPage({viewport:{width:1200,height:900}});
      await page.addInitScript(()=>{window.messages=[];window.chrome={webview:{postMessage:m=>window.messages.push(m),addEventListener:()=>{}}};});
      await page.goto(base+'/reader/index.html');await page.waitForFunction(()=>window.mica);
      if(variant==='reserved-height')await page.addStyleTag({content:'.diagram-canvas{height:280px;min-height:280px}.diagram-canvas svg{max-height:240px;width:auto}'});
      else await page.addStyleTag({content:'.diagram-canvas{height:auto;min-height:190px}.diagram-canvas svg{max-height:none;width:100%}'});
      const fence=String.fromCharCode(96).repeat(3);
      const source='# 图表与正文\n\n'+fence+'mermaid\nflowchart TB\n'+Array.from({length:14},(_,i)=>`N${i}[阶段${i}]-->N${i+1}`).join('\n')+'\n'+fence+'\n\n## 继续阅读\n\n'+('后续正文内容。\n\n').repeat(40);
      await page.evaluate(text=>window.mica.receive({type:'render',id:1,key:'late',text}),source);
      await page.waitForFunction(()=>window.messages.some(m=>m.type==='rendered'));
      const before=await page.locator('h2').evaluate(el=>el.getBoundingClientRect().top);
      await page.waitForSelector('.diagram[data-ready] svg');
      await page.waitForTimeout(300);
      const after=await page.locator('h2').evaluate(el=>el.getBoundingClientRect().top);
      report.lateDiagram[variant]={before,after,displacement:after-before};
      await page.screenshot({path:output+'/late-'+variant+'.png'});await page.close();
    }
  }finally{await browser.close();}
  report.mermanWasmBytes=(await stat('node_modules/@mermanjs/web-render/artifacts/wasm/merman_wasm_bg.wasm')).size;
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally{await writeFile(output+'/results.json',JSON.stringify(report,null,2));server.close();console.log('Saved output/results.json');}
