import {execFileSync} from 'node:child_process';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const go=process.argv[2]||'go';
const modules=[...new Set(execFileSync(go,['list','-tags','production','-deps','-f','{{if .Module}}{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}{{end}}','.'],{encoding:'utf8'}).trim().split(/\r?\n/))];
let text='# Mica Native third-party notices\n\n';
for(const line of modules){const [name,version,dir]=line.split('|');if(!version||!dir)continue;text+='\n## '+name+' '+version+'\n';for(const file of await readdir(dir)){if(/^(license|copying|notice)(\.|$)/i.test(file))text+='\n'+await readFile(join(dir,file),'utf8')+'\n'}}
text+='\n'+await readFile('dist/THIRD-PARTY-NOTICES.txt','utf8');
const pdfMeta=JSON.parse(await readFile('../ReaderWeb/node_modules/pdfjs-dist/package.json','utf8'));
text+='\n## pdfjs-dist '+pdfMeta.version+'\n'+await readFile('../ReaderWeb/node_modules/pdfjs-dist/LICENSE','utf8');
for(const dir of ['wasm','standard_fonts','cmaps'])for(const file of await readdir('../ReaderWeb/node_modules/pdfjs-dist/'+dir)){if(/^license/i.test(file))text+='\n### PDF.js '+dir+'/'+file+'\n'+await readFile('../ReaderWeb/node_modules/pdfjs-dist/'+dir+'/'+file,'utf8')}
await writeFile('build/THIRD-PARTY-NOTICES.txt',text);
