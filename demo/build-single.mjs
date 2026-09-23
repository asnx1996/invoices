// ملف واحد للنسخة التجريبية ينفتح بدبل كلك (بدون سيرفر): كل الـ CSS والكود داخل الملف
// الاستخدام: node demo/build.mjs && node demo/build-single.mjs  →  demo/dist/فواتير-تجريبي.html
// يحتاج إنترنت أول مرة لتحميل esbuild عن طريق npx
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const u = p => new URL(p, import.meta.url);
const bundle = fileURLToPath(u('./dist/app.bundle.js'));
execSync(`npx --yes esbuild@0.24.0 "${fileURLToPath(u('./dist/assets/js/main.js'))}" --bundle --format=iife --target=es2020 --charset=utf8 --outfile="${bundle}"`, { stdio: 'inherit' });

const src = readFileSync(u('../index.html'), 'utf8');
const body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>')).trim();
// "</script" داخل الكود يسكّر الوسم بالغلط
const js = f => readFileSync(f, 'utf8').replace(/<\/script/gi, '<\\/script');

const out = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>فواتير المبيعات التجريبية</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" integrity="sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw" crossorigin="anonymous"></script>
<style>
${readFileSync(u('../assets/app.css'), 'utf8')}
${readFileSync(u('./demo.css'), 'utf8')}
</style>
</head>
<body>
${body}
<script>
${js(u('./mock.js'))}
</script>
<script>
${js(bundle)}
</script>
</body>
</html>
`;
writeFileSync(u('./dist/فواتير-تجريبي.html'), out);
console.log('demo/dist/فواتير-تجريبي.html', Math.round(out.length / 1024), 'KB');
