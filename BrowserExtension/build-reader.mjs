import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./src/reader/reader.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./reader/reader.js', import.meta.url)),
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', minify: true,
});
console.log('Built self-contained Mica reader (no runtime dependencies).');
