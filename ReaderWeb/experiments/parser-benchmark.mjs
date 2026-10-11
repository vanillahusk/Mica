import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import MarkdownIt from 'markdown-it';
import {markdownToHtml} from 'satteri';
import {markdown} from './fixtures.mjs';
import {parseMarkdown} from '../src/parser.js';
const md=new MarkdownIt({html:true}),runs=20;
const fixtures={simple:'# Hello\n\nWorld **bold**.',nested:'1. One\n   - Nested\n\n> Quote\n\n```java\nint a=1;\n```',gfm:'| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] Done',micaExtensions:'==高亮== H~2~O x^2^\n\n> [!QUESTION]\n> 为什么？\n\n$E=mc^2$'};
const result={scope:'Node.js native Satteri versus Node.js markdown-it, Markdown-to-HTML only. No WebView IPC, sanitization, DOM layout or WASM cost; not full Mica equivalence.',characters:markdown.length,fixtures:{},timings:{}};
for(const [name,text]of Object.entries(fixtures))result.fixtures[name]={markdownIt:md.render(text),mica:parseMarkdown(text).chunks.join(''),satteri:markdownToHtml(text).html};
for(const [name,render]of Object.entries({markdownIt:t=>md.render(t),satteri:t=>markdownToHtml(t).html,mica:t=>parseMarkdown(t).chunks.join('')})){
  render(markdown);const times=[];let bytes=0;
  for(let n=0;n<runs;n++){const started=performance.now();bytes=render(markdown).length;times.push(performance.now()-started);}
  times.sort((a,b)=>a-b);result.timings[name]={medianMs:times[Math.floor(runs/2)],p95Ms:times[Math.ceil(runs*.95)-1],outputCharacters:bytes,runs};
}
await mkdir('output',{recursive:true});await writeFile('output/parser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.timings,null,2));
