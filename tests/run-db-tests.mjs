// يشغّل كل الـ migrations على Postgres محلي (PGlite) ثم ملفات الاختبار.
// الاستخدام: npm test
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const read = p => readFileSync(join(root, p), 'utf8');
const list = (dir, re) => readdirSync(join(root, dir)).filter(f => re.test(f)).sort().map(f => `${dir}/${f}`);

const db = new PGlite({ extensions: { pgcrypto } });
let failed = false;

async function step(label, sql) {
  try { await db.exec(sql); console.log(`  ✓ ${label}`); }
  catch (e) { failed = true; console.log(`  ✗ ${label}\n    ${e.message}${e.where ? `\n    ${e.where.split('\n')[0]}` : ''}`); }
}

console.log('Migrations:');
await step('supabase stubs', read('tests/supabase_stubs.sql'));
for (const f of list('migrations', /\.sql$/)) await step(f, read(f));

console.log('\nTests:');
for (const f of list('tests', /\.test\.sql$/)) {
  // ملف الاختبار ينتهي دائماً بـ raise exception (حتى يرجّع كل شي على Supabase)
  try { await db.exec(read(f)); failed = true; console.log(`  ✗ ${f}: finished without a result`); }
  catch (e) {
    const ok = e.message.startsWith('ALL TESTS PASSED');
    if (!ok) failed = true;
    console.log(`  ${ok ? '✓' : '✗'} ${f}\n    ${e.message.replace(/\n/g, '\n    ')}`);
  }
}

await db.close();
process.exitCode = failed ? 1 : 0;
