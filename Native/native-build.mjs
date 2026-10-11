import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,cp,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const go=process.env.MICA_GO||'go';
const moduleDir=name=>execFileSync(go,['list','-m','-f','{{.Dir}}',name],{encoding:'utf8'}).trim();
await mkdir('build',{recursive:true});const replacements={};let mod=await readFile('go.mod','utf8');
for(const [name,target,source]of [['github.com/wailsapp/go-webview2','pkg/edge/mica_pdf_windows.go','webview_pdf.go.txt'],['github.com/wailsapp/wails/v2','internal/frontend/desktop/windows/mica_pdf_windows.go','wails_pdf.go.txt']]){
 const original=moduleDir(name),copy=resolve('build/deps',original.split(/[\\/]/).pop());
 try{await access(join(copy,'go.mod'))}catch{await cp(original,copy,{recursive:true})}
 mod+='\nreplace '+name+' => '+JSON.stringify(copy.replaceAll('\\','/'))+'\n';
 replacements[join(copy,target)]=resolve('platform',source);
}
await writeFile('build/native.mod',mod);await cp('go.sum','build/native.sum');
await writeFile('build/native-overlay.json',JSON.stringify({Replace:replacements}));
execFileSync(go,['build','-modfile',resolve('build/native.mod'),'-overlay',resolve('build/native-overlay.json'),'-tags',process.argv.includes('--smoke')?'production,smoke':'production','-trimpath','-ldflags','-s -w -H windowsgui','-o',process.argv.includes('--smoke')?'build/Mica-smoke.exe':'Mica.exe','.'],{stdio:'inherit'});
