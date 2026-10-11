import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.MICA_PLAYWRIGHT_MODULE||'playwright');
let browser;for(let i=0;i<30;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19381');break}catch(e){if(i===29)console.error(e);await new Promise(r=>setTimeout(r,500))}}
if(!browser)throw Error('Native WebView2 debug endpoint did not start');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('wails'))||browser.contexts()[0].pages()[0];
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.waitForFunction(()=>window.go?.main?.App,{timeout:20000});
 await page.waitForFunction(()=>document.querySelector('#title')?.textContent.includes('native-smoke'),{timeout:20000});
 const reader=page.frameLocator('#reader');
 await reader.locator('#article h1').waitFor();
 await reader.locator('.diagram[data-ready] svg').waitFor({timeout:20000});
 assert.equal(await reader.locator('h1').textContent(),'原生阅读测试');
 await page.locator('#outline-toggle').click();assert(await page.locator('#outline button').count()>0);
 await page.locator('#edit').click();await reader.locator('.cm-editor').waitFor();
 const text=await reader.locator('.cm-content').textContent();assert(text.includes('原生阅读测试'));
 await reader.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.type('\nNative edit verified.');
 await page.locator('#save:not([disabled])').waitFor();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#save').disabled);
 await page.locator('#read').click();await reader.locator('#article h1').waitFor();
 await page.locator('#theme').selectOption('paper');await page.locator('#notes-toggle').click();await page.locator('#add-note').click();await page.locator('#note-text').fill('原生笔记测试');await page.locator('#note-save').click();await page.locator('#notes .note').waitFor();
 await page.screenshot({path:resolve('build/native-smoke.png')});
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS native WebView2: launch argument, render, curved diagram, outline, edit, save, theme, notes');
}finally{await browser.close()}
