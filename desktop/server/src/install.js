// تهيئة الحاسبة الرئيسية: إيجاد SQL Server، إنشاء القاعدة والمستخدم والجداول، وأول أدمن.
// يستخدمها سطر الأوامر (setup.js / create-admin.js) وشاشة الإعداد بالبرنامج.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { config, saveConfig, SERVER_DIR } from './config.js';
import { connect, close, raw, runner, db, sql } from './db.js';
import { hashPassword, loginEmail } from './auth.js';

// نسخ SQL Server المنصبة على هاي الحاسبة (من الريجستري)
export function listInstances() {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL'], { encoding: 'utf8' });
    return out.split(/\r?\n/).map(l => l.trim().split(/\s+REG_SZ\s+/)[0]).filter(n => n && !n.startsWith('HKEY'))
      .map(n => n.trim()).filter(Boolean);
  } catch (e) { return [] }
}

export function hasSqlcmd() {
  try { execFileSync('sqlcmd', ['-?'], { stdio: 'ignore' }); return true } catch (e) { return false }
}

export async function installDb({ instance = config.sql.instanceName, database = config.sql.database, log = console.log } = {}) {
  const login = config.sql.user || 'invoices_app';
  if (!/^[A-Za-z0-9_]+$/.test(database) || !/^[A-Za-z0-9_]+$/.test(login)) throw new Error('اسم قاعدة/مستخدم غير صالح');
  if (instance && !/^[A-Za-z0-9_$]+$/.test(instance)) throw new Error('اسم نسخة SQL Server غير صالح');
  const target = instance && instance !== 'MSSQLSERVER' ? `.\\${instance}` : '.';
  const password = config.sql.password || randomBytes(18).toString('base64url') + 'a1!';
  const q = password.replace(/'/g, "''");
  const sqlcmd = text => execFileSync('sqlcmd', ['-S', target, '-E', '-b', '-l', '15', '-Q', text], { encoding: 'utf8' });

  log(`SQL Server: ${target}  القاعدة: ${database}`);
  // الدخول بالرمز لازم يكون مفعّل بالنسخة (Mixed Mode)
  const mixed = sqlcmd(`SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS int)`).replace(/[^01]/g, '');
  if (mixed.endsWith('1')) throw new Error('نسخة SQL Server هاي تقبل دخول ويندوز بس. فعّل "SQL Server and Windows Authentication mode" من SQL Server Management Studio وأعد تشغيل الخدمة.');
  sqlcmd(`IF DB_ID('${database}') IS NULL CREATE DATABASE [${database}];
IF SUSER_ID('${login}') IS NULL CREATE LOGIN [${login}] WITH PASSWORD = '${q}', CHECK_POLICY = OFF, DEFAULT_DATABASE = [${database}];
ELSE ALTER LOGIN [${login}] WITH PASSWORD = '${q}';`);
  sqlcmd(`USE [${database}];
IF USER_ID('${login}') IS NULL CREATE USER [${login}] FOR LOGIN [${login}];
ALTER ROLE db_owner ADD MEMBER [${login}];`);
  log('✓ القاعدة والمستخدم جاهزين');

  config.sql = { ...config.sql, instanceName: instance === 'MSSQLSERVER' ? '' : instance, database, user: login, password };
  saveConfig();
  await close();
  const pool = await connect();
  const r = runner(pool);
  if (await r.one(raw(`select 1 x from sys.tables where name = 'invoices'`))) log('• الجداول موجودة أصلاً — ما تغيّر شي');
  else {
    const parts = readFileSync(join(SERVER_DIR, 'src', 'schema.sql'), 'utf8').split(/^\s*GO\s*$/m).map(s => s.trim()).filter(Boolean);
    for (const p of parts) await pool.request().batch(p);
    log(`✓ انشأت الجداول (${parts.length} مقطع)`);
  }
}

export async function hasUsers() {
  const r = await db();
  return !!await r.one(sql`select top 1 1 x from users`);
}

export async function createAdmin(name, password, fullName) {
  if (String(password || '').length < 8) throw new Error('الرمز لازم 8 أحرف على الأقل');
  const r = await db();
  const login = loginEmail(name);
  const ex = await r.one(sql`select id from users where login = ${login}`);
  if (ex) {
    await r.exec(sql`update users set pass_hash = ${await hashPassword(password)}, updated_at = sysutcdatetime() where id = ${ex.id}`);
    await r.exec(sql`update profiles set active = 1, role = 'admin', roles = '["admin"]' where id = ${ex.id}`);
    return { id: ex.id, existed: true };
  }
  const id = randomUUID();
  await r.exec(sql`insert into users (id, login, pass_hash) values (${id}, ${login}, ${await hashPassword(password)})`);
  await r.exec(sql`insert into profiles (id, full_name, role, roles, active) values (${id}, ${String(fullName || name).trim()}, 'admin', '["admin"]', 1)`);
  return { id, existed: false };
}
