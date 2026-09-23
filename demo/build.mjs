// يبني صفحة النسخة التجريبية من index.html الحقيقي حتى تبقى متطابقة ويا الموقع
// الاستخدام: node demo/build.mjs  →  demo/dist/index.html
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'));
const body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>'));
const keep = head.split('\n').filter(l =>
  /fonts\.g|assets\/app\.css|xlsx/.test(l) && !/supabase/.test(l)).join('\n');
const out = `<meta charset="utf-8">
<title>فواتير المبيعات التجريبية</title>
${keep}
<link rel="stylesheet" href="demo.css">
<script src="mock.js"></script>
<script type="module" src="assets/js/main.js"></script>
${body.trim()}
`;
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/index.html', import.meta.url), out);
// نسخة كاملة بمجلد dist: نفس ملفات الموقع، بس config.js التجريبي
const u = p => new URL(p, import.meta.url);
mkdirSync(u('./dist/assets/js/'), { recursive: true });
copyFileSync(u('../assets/app.css'), u('./dist/assets/app.css'));
for (const f of readdirSync(u('../assets/js/'))) copyFileSync(u('../assets/js/' + f), u('./dist/assets/js/' + f));
copyFileSync(u('./config.js'), u('./dist/assets/js/config.js'));
copyFileSync(u('./mock.js'), u('./dist/mock.js'));
copyFileSync(u('./demo.css'), u('./dist/demo.css'));
console.log('demo/dist ready:', out.length, 'bytes index');
