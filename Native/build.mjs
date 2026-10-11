import {cp,mkdir,rename,readdir,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=import.meta.dirname;
execFileSync(process.execPath,['build.mjs'],{cwd:resolve(root,'../ReaderWeb'),stdio:'inherit'});
await mkdir(resolve(root,'dist'),{recursive:true});
await cp(resolve(root,'../ReaderWeb/dist'),resolve(root,'dist'),{recursive:true});
await rename(resolve(root,'dist/index.html'),resolve(root,'dist/reader.html'));
await cp(resolve(root,'frontend'),resolve(root,'dist'),{recursive:true});
// Superseded single-page prototype is not shipped; document-view.html uses continuous-view.js.
await unlink(resolve(root,'dist/document-view.js')).catch(e=>{if(e.code!=='ENOENT')throw e});
const pdfRoot=resolve(root,'../ReaderWeb/node_modules/pdfjs-dist');
await mkdir(resolve(root,'dist/pdfjs'),{recursive:true});
for(const name of ['pdf','pdf.worker'])await cp(resolve(pdfRoot,'build',name+'.min.mjs'),resolve(root,'dist/pdfjs',name+'.mjs'));
await cp(resolve(pdfRoot,'web/pdf_viewer.css'),resolve(root,'dist/pdfjs/pdf_viewer.css'));
await cp(resolve(pdfRoot,'web/pdf_viewer.mjs'),resolve(root,'dist/pdfjs/pdf_viewer.mjs'));
await cp(resolve(pdfRoot,'web/images'),resolve(root,'dist/pdfjs/images'),{recursive:true});
for(const name of ['cmaps','standard_fonts','wasm'])await cp(resolve(pdfRoot,name),resolve(root,'dist/pdfjs',name),{recursive:true});
const live=new Set(await readdir(resolve(root,'../ReaderWeb/dist/chunks')));
for(const file of await readdir(resolve(root,'dist/chunks'))){if(!live.has(file)&&/^[\w-]+-[A-Z0-9]{8}\.js(?:\.LEGAL\.txt)?$/.test(file))await unlink(resolve(root,'dist/chunks',file))}
if(!process.argv.includes('--smoke'))await unlink(resolve(root,'dist/smoke-browser.js')).catch(e=>{if(e.code!=='ENOENT')throw e});
console.log('Native frontend prepared. Build with node native-build.mjs (includes the native PDF bridge).');
