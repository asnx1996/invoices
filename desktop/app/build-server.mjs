// يجمع السيرفر مع مكتباته بمجلد server-pack (electron-builder ما يضم node_modules بالموارد الإضافية)
import { build } from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const SRV = join(import.meta.dirname, '..', 'server');
const OUT = join(import.meta.dirname, 'server-pack');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'src'), { recursive: true });

await build({
  entryPoints: [join(SRV, 'src', 'app.js'), join(SRV, 'src', 'install.js')],
  outdir: join(OUT, 'src'), bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node22',
  external: ['msnodesqlv8'], logLevel: 'warning',
  // مكتبات CommonJS داخل حزمة ESM تحتاج require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
copyFileSync(join(SRV, 'src', 'schema.sql'), join(OUT, 'src', 'schema.sql'));
mkdirSync(join(OUT, 'vendor'), { recursive: true });
copyFileSync(join(SRV, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), join(OUT, 'vendor', 'xlsx.full.min.js'));
cpSync(join(SRV, 'node_modules', '@fontsource', 'ibm-plex-sans-arabic'), join(OUT, 'vendor', 'font'), { recursive: true });
console.log('✓ server-pack');
