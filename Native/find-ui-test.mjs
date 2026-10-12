import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';

const {chromium}=await import(process.env.MICA_PLAYWRIGHT_MODULE||'playwright'),root=resolve('dist');console.log('find-ui: module loaded');
const server=createServer(async(req,res)=>{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));console.log('find-ui: server ready');const browser=await chromium.launch({channel:'msedge',headless:true});console.log('find-ui: browser ready');const page=await browser.newPage();page.on('pageerror',error=>console.error('PAGE',error.message));page.setDefaultTimeout(10000);
try{
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/reader.html');console.log('find-ui: reader loaded');await page.waitForFunction(()=>!!window.mica);await page.evaluate(()=>mica.receive({type:'render',id:1,key:'find-test',text:'# 查找测试\n\n完整会话可以搜索。',conversation:false}));await page.waitForSelector('h1');await page.locator('body').press('Control+f');assert(await page.locator('#find-bar').isVisible());
 await page.goto(base+'/document-view.html');console.log('find-ui: document loaded');await page.waitForFunction(()=>!!window.documentReader);await page.evaluate(()=>documentReader.open({kind:'text',path:'C:\\find.txt',text:'普通文本也可以搜索。'}));await page.locator('body').press('Control+f');assert(await page.locator('#doc-find-bar').isVisible());
 console.log('PASS find UI: Ctrl+F opens search bars in rich and plain readers');
}finally{await browser.close();server.close()}
