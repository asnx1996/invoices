// ينزّل كل ملفات bucket "invoices" (يحتاج SUPABASE_SERVICE_KEY)
// الاستخدام: node .github/scripts/backup-storage.mjs <مجلد>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const { SUPABASE_URL, SERVICE_KEY } = process.env;
const out = process.argv[2] || 'files';
const bucket = 'invoices';
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function list(prefix) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${await r.text()}`);
    const page = await r.json();
    items.push(...page);
    if (page.length < 1000) return items;
  }
}

let n = 0, bytes = 0;
async function walk(prefix) {
  for (const it of await list(prefix)) {
    const path = prefix ? `${prefix}/${it.name}` : it.name;
    if (!it.id) { await walk(path); continue }          // مجلد
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers });
    if (!r.ok) { console.error(`skip ${path}: ${r.status}`); continue }
    const buf = Buffer.from(await r.arrayBuffer());
    const dest = join(out, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    n++; bytes += buf.length;
  }
}

await walk('');
console.log(`downloaded ${n} files, ${(bytes / 1048576).toFixed(1)} MB`);
