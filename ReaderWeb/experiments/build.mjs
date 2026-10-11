import {build} from 'esbuild';
import {mkdir,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/bench.js','src/engine-worker.js'],outdir:'dist',bundle:true,splitting:true,format:'esm',target:'chrome120',minify:true,external:['/merman/*']});
await cp('node_modules/@mermanjs/web-render','dist/merman',{recursive:true,dereference:true});
await cp('src/index.html','dist/index.html');
console.log('Experimental assets only; production ReaderAssets unchanged.');
