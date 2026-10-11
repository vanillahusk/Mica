import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.MICA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('dist');
const server=createServer(async(req,res)=>{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 if(window.parent!==window)return;
 window.actions=[];
 const document={path:'conversation:test',title:'调研判断与方案修正',conversation:true,text:'> [!QUESTION]\n> Mermaid 的成熟度和美观度怎么样？\n\n## 图表与阅读\n\n好的阅读体验需要清晰的层次、适当的留白，以及稳定的交互。\n\n'+('这是用于检查阅读排版的正文。\n\n'.repeat(12))+'\n> [!QUESTION]\n> D2 可以渲染 Markdown 吗？\n\nMarkdown 与绘图语言负责不同的事情。'};
 document.text+='\n\n'+('用于验证目录跳转和滚动高亮的正文。\n\n'.repeat(20));
 window.go={main:{App:{Preferences:async()=>'{"theme":"warm","zoom":110}',Conversations:async()=>[{id:'test',title:document.title}],Startup:async()=>['--open','test'],Conversation:async()=>document,Notes:async()=>[],Dirty:()=>{},Quit:async()=>actions.push('close')}}};
 window.runtime={EventsOn:()=>{},WindowMinimise:()=>actions.push('minimize'),WindowToggleMaximise:()=>actions.push('maximize')};
});
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
 await page.waitForFunction(()=>document.querySelectorAll('#outline .turn-number').length===2);
 assert.deepEqual(await page.locator('.turn-number').allTextContents(),['1','2']);
 await page.locator('#outline-toggle').click();
 await page.locator('#outline button').nth(1).click();
 await page.waitForFunction(()=>document.querySelector('#outline button:nth-child(2)').classList.contains('active'));
 await page.locator('#appearance summary').click();
 assert.equal(await page.locator('#zoom-value').textContent(),'110%');
 await mkdir('build/ui',{recursive:true});
 for(const theme of ['warm','paper','sepia','midnight']){
  await page.locator('#theme').selectOption(theme);await page.waitForTimeout(150);
  await page.screenshot({path:`build/ui/${theme}.png`});
  const color=await page.locator('header').evaluate(el=>getComputedStyle(el).getPropertyValue('--wails-draggable').trim());assert.equal(color,'drag');
 }
 await page.locator('#more summary').click();await page.waitForFunction(()=>!document.querySelector('#appearance').open);
 await page.locator('#title').dblclick();await page.locator('#minimize').click();await page.locator('#maximize').click();await page.locator('#close').click();
 assert.deepEqual(await page.evaluate(()=>actions),['maximize','minimize','maximize','close']);
 await page.setViewportSize({width:760,height:520});
 assert(await page.locator('#close').isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no header overflow at minimum window size');
 assert.deepEqual(errors,[]);console.log('PASS UI: numbered conversation navigation, appearance, four themes, window actions, 760px layout');
}finally{await browser.close();server.close()}
