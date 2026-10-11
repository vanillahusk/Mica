import { build } from 'esbuild';
import { mkdir, cp, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/reader.js', 'src/parser.worker.js','src/diagram.worker.js'], bundle: true, splitting: true,
  external:['/merman/*'],
  format: 'esm', outdir: 'dist', minify: true, target: 'chrome120',
  entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', legalComments: 'linked',
  metafile: true,
});
// Remove only obsolete esbuild-generated hashed chunks, not user files or entire directories.
const outputs=new Set(Object.keys(result.metafile.outputs).map(path=>resolve(path)));
for(const file of await readdir('dist/chunks',{withFileTypes:true})) {
  if(!file.isFile()||!/^[\w-]+-[A-Z0-9]{8}\.js(?:\.LEGAL\.txt)?$/.test(file.name))continue;
  const path=resolve('dist/chunks',file.name),owner=path.replace(/\.LEGAL\.txt$/,'');
  if(!outputs.has(path)&&!outputs.has(owner))await unlink(path);
}
for (const name of ['index.html', 'reader.css', 'themes.json']) await cp('src/' + name, 'dist/' + name);
await cp('node_modules/katex/dist/katex.min.css', 'dist/katex.min.css');
await cp('node_modules/katex/dist/fonts', 'dist/fonts', { recursive: true });
await cp('node_modules/@mermanjs/web-render','dist/merman',{recursive:true,dereference:true});
// Collect licenses for the packages actually included, not just direct dependencies.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let dir = dirname(input);
  while (dir !== '.' && dir !== dirname(dir)) {
    try {
      const meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (meta.name && meta.version) { packages.set(dir, meta); break; }
    } catch { /* File belongs to a nested package directory. */ }
    dir = dirname(dir);
  }
}
const katexMeta = JSON.parse(await readFile('node_modules/katex/package.json', 'utf8'));
packages.set('node_modules/katex', katexMeta);
packages.set('node_modules/@mermanjs/web-render',JSON.parse(await readFile('node_modules/@mermanjs/web-render/package.json','utf8')));
let notices = '# Mica bundled third-party notices\n\n';
const included = new Set();
for (const [dir, meta] of packages) {
  const identity = meta.name + '@' + meta.version;
  if (included.has(identity)) continue;
  included.add(identity);
  notices += '\n## ' + identity + '\nLicense: ' + JSON.stringify(meta.license) + '\n';
  for (const f of await readdir(dir)) if (/^licen[sc]e/i.test(f))
    notices += '\n' + await readFile(dir + '/' + f, 'utf8') + '\n';
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices);
console.log('Offline reader assets built.');
