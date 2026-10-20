// تهيئة أول مرة على الحاسبة الرئيسية:
// 1) ينشئ قاعدة InvoicesApp ومستخدم SQL خاص بالبرنامج (عن طريق sqlcmd بصلاحيات ويندوز)
// 2) يحفظ الاتصال بـ config.json
// 3) ينشئ الجداول من schema.sql
// الاستخدام: npm run setup-db [-- --instance TEW_SQLEXPRESS --database InvoicesApp]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config, saveConfig, SERVER_DIR } from './config.js';
import { connect, close, raw, runner } from './db.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const instance = arg('instance', config.sql.instanceName);
const database = arg('database', config.sql.database);
const login = config.sql.user || 'invoices_app';
const target = instance ? `.\\${instance}` : '.';

if (!/^[A-Za-z0-9_]+$/.test(database) || !/^[A-Za-z0-9_]+$/.test(login)) throw new Error('اسم قاعدة/مستخدم غير صالح');

const password = config.sql.password || randomBytes(18).toString('base64url') + 'a1!';
const sqlcmd = q => execFileSync('sqlcmd', ['-S', target, '-E', '-b', '-l', '10', '-Q', q], { encoding: 'utf8' });

console.log(`SQL Server: ${target}  القاعدة: ${database}`);
sqlcmd(`
IF DB_ID('${database}') IS NULL CREATE DATABASE [${database}];
IF SUSER_ID('${login}') IS NULL CREATE LOGIN [${login}] WITH PASSWORD = '${password.replace(/'/g, "''")}', CHECK_POLICY = OFF, DEFAULT_DATABASE = [${database}];
ELSE ALTER LOGIN [${login}] WITH PASSWORD = '${password.replace(/'/g, "''")}';
`);
sqlcmd(`USE [${database}];
IF USER_ID('${login}') IS NULL CREATE USER [${login}] FOR LOGIN [${login}];
ALTER ROLE db_owner ADD MEMBER [${login}];`);
console.log('✓ القاعدة والمستخدم جاهزين');

config.sql = { ...config.sql, instanceName: instance, database, user: login, password };
saveConfig();
console.log('✓ انحفظت الإعدادات');

const pool = await connect();
const r = runner(pool);
const exists = await r.one(raw(`select 1 x from sys.tables where name = 'invoices'`));
if (exists) console.log('• الجداول موجودة أصلاً — ما تغيّر شي');
else {
  const parts = readFileSync(join(SERVER_DIR, 'src', 'schema.sql'), 'utf8').split(/^\s*GO\s*$/m).map(s => s.trim()).filter(Boolean);
  for (const p of parts) await pool.request().batch(p);
  console.log(`✓ انشأت الجداول (${parts.length} مقطع)`);
}
await close();
