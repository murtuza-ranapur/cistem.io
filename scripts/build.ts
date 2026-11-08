// Production build with Bun: bundles index.html (scripts, CSS, lazy chunks) into dist/ with hashed names,
// then copies public/ alongside. Type-checking is a separate step (`bun run typecheck`).
import { rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';

await rm('dist', { recursive: true, force: true });
const res = await Bun.build({
  entrypoints: ['./index.html'],
  outdir: './dist',
  minify: true,
  splitting: true,
  publicPath: '/',
  naming: { entry: '[name].[ext]', chunk: 'assets/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!res.success) { for (const l of res.logs) console.error(l); process.exit(1); }
if (existsSync('public')) await cp('public', 'dist', { recursive: true });
for (const o of res.outputs) console.log(`${o.path.replace(process.cwd() + '/', '').padEnd(48)} ${(o.size / 1024).toFixed(1)} kB`);
