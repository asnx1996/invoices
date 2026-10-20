// الدخول: رمز مخزّن بـ scrypt، وجلسة = توكن عشوائي (ينحفظ الـ hash مالته بس)
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { sql } from './db.js';
import { fail } from './rules.js';

const scryptAsync = promisify(scrypt);
export const LOGIN_DOMAIN = '@invoices.local';

// admin_login_email: اسم المستخدم ينحفظ كإيميل داخلي (ahmed → ahmed@invoices.local)
export function loginEmail(name) {
  const u = String(name ?? '').trim().toLowerCase();
  if (u.includes('@')) return u;
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) fail('اسم المستخدم: حروف إنجليزية صغيرة وأرقام و . _ - فقط (3 إلى 30)');
  return u + LOGIN_DOMAIN;
}

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(pw), salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(String(pw), Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

const tokenHash = t => createHash('sha256').update(String(t)).digest('hex');

export async function login(r, email, password) {
  const u = await r.one(sql`select id, login, pass_hash from users where login = ${String(email || '').trim().toLowerCase()}`);
  if (!u || !await checkPassword(password, u.pass_hash)) fail('Invalid login credentials', 400);
  const token = randomBytes(32).toString('base64url');
  await r.exec(sql`insert into sessions (token_hash, user_id) values (${tokenHash(token)}, ${u.id})`);
  return { token, user: { id: u.id, email: u.login } };
}

export async function logout(r, token) {
  if (token) await r.exec(sql`delete from sessions where token_hash = ${tokenHash(token)}`);
}

// من التوكن للمستخدم (أو null). last_seen يتحدث مرة بالدقيقة بالكثير
export async function sessionUser(r, token) {
  if (!token) return null;
  const s = await r.one(sql`select s.user_id, s.last_seen, u.login from sessions s join users u on u.id = s.user_id where s.token_hash = ${tokenHash(token)}`);
  if (!s) return null;
  if (Date.now() - s.last_seen > 60000) await r.exec(sql`update sessions set last_seen = sysutcdatetime() where token_hash = ${tokenHash(token)}`);
  return { id: s.user_id, email: s.login };
}

export async function changeOwnPassword(r, uid, password) {
  if (String(password || '').length < 8) fail('الرمز لازم 8 أحرف على الأقل');
  await r.exec(sql`update users set pass_hash = ${await hashPassword(password)}, updated_at = sysutcdatetime() where id = ${uid}`);
}
