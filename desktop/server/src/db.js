// الاتصال بـ SQL Server + أدوات صغيرة للاستعلام.
// sql`select * from x where id = ${id}` → استعلام بمعاملات (@p0, @p1...) بدون حقن.
import mssql from 'mssql';
import { config } from './config.js';

let pool = null;

export async function connect() {
  if (pool) return pool;
  const c = config.sql;
  pool = await new mssql.ConnectionPool({
    server: c.server || 'localhost',
    port: c.port || undefined,
    database: c.database,
    user: c.user,
    password: c.password,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: { instanceName: c.port ? undefined : c.instanceName, encrypt: false, trustServerCertificate: true, useUTC: true },
  }).connect();
  return pool;
}

export async function close() { if (pool) { await pool.close(); pool = null } }

// قطعة SQL: نص + قيم. تتركب داخل بعضها
export class Frag {
  constructor(strings, values) { this.strings = strings; this.values = values }
}
export const sql = (strings, ...values) => new Frag([...strings], values);
// نص خام (أسماء أعمدة موثوقة فقط — مو من المستخدم)
export const raw = s => new Frag([String(s)], []);
export const join = (frags, sep = ', ') => {
  if (!frags.length) return raw('');
  const strings = [''], values = [];
  frags.forEach((f, i) => {
    if (i) strings[strings.length - 1] += sep;
    const fr = f instanceof Frag ? f : sql`${f}`;
    strings[strings.length - 1] += fr.strings[0];
    for (let k = 0; k < fr.values.length; k++) { values.push(fr.values[k]); strings.push(fr.strings[k + 1]) }
  });
  return new Frag(strings, values);
};

function build(frag, req) {
  let text = '', n = 0;
  const walk = f => {
    for (let i = 0; i < f.strings.length; i++) {
      text += f.strings[i];
      if (i < f.values.length) {
        const v = f.values[i];
        if (v instanceof Frag) walk(v);
        else if (Array.isArray(v)) {
          if (!v.length) { text += 'null' ; continue }  // in (null) = ماكو تطابق
          text += v.map(x => { const p = 'p' + n++; bind(req, p, x); return '@' + p }).join(', ');
        } else { const p = 'p' + n++; bind(req, p, v); text += '@' + p }
      }
    }
  };
  walk(frag);
  return text;
}

function bind(req, name, v) {
  if (v === undefined || v === null) return req.input(name, mssql.NVarChar, null);
  if (typeof v === 'boolean') return req.input(name, mssql.Bit, v);
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2 ** 31
    ? req.input(name, mssql.Int, v) : req.input(name, mssql.Decimal(28, 8), v);
  if (v instanceof Date) return req.input(name, mssql.DateTime2(3), v);
  if (Buffer.isBuffer(v)) return req.input(name, mssql.VarBinary(mssql.MAX), v);
  return req.input(name, mssql.NVarChar(mssql.MAX), String(v));
}

// منفّذ: إما الـ pool أو transaction مفتوحة
export function runner(target) {
  const run = async frag => {
    const req = target.request();
    const text = build(frag, req);
    try { return await req.query(text) }
    catch (e) { e.sqlText = text; throw e }
  };
  return {
    query: async frag => (await run(frag)).recordset || [],
    one: async frag => ((await run(frag)).recordset || [])[0] || null,
    exec: async frag => (await run(frag)).rowsAffected.reduce((a, b) => a + b, 0),
  };
}

export async function db() { return runner(await connect()) }

// كل شي داخل fn ينفذ بمعاملة وحدة؛ أي خطأ يرجّع كلشي
export async function tx(fn) {
  const p = await connect();
  const t = new mssql.Transaction(p);
  await t.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const r = await fn(runner(t));
    await t.commit();
    return r;
  } catch (e) {
    try { await t.rollback() } catch (_) { }
    throw e;
  }
}
