// أول حساب أدمن (أو تغيير رمزه إذا موجود).
// الاستخدام: npm run create-admin -- <اسم-المستخدم> <الرمز> [الاسم الكامل]
import { randomUUID } from 'node:crypto';
import { db, close, sql } from './db.js';
import { hashPassword, loginEmail } from './auth.js';

const [name, password, ...full] = process.argv.slice(2);
if (!name || !password) { console.log('الاستخدام: npm run create-admin -- <اسم-المستخدم> <الرمز> [الاسم الكامل]'); process.exit(1) }
if (password.length < 8) { console.log('الرمز لازم 8 أحرف على الأقل'); process.exit(1) }

const r = await db();
const login = loginEmail(name);
const ex = await r.one(sql`select id from users where login = ${login}`);
if (ex) {
  await r.exec(sql`update users set pass_hash = ${await hashPassword(password)}, updated_at = sysutcdatetime() where id = ${ex.id}`);
  await r.exec(sql`update profiles set active = 1, role = 'admin', roles = '["admin"]' where id = ${ex.id}`);
  console.log('✓ الحساب موجود: تغيّر الرمز وصار أدمن');
} else {
  const id = randomUUID();
  await r.exec(sql`insert into users (id, login, pass_hash) values (${id}, ${login}, ${await hashPassword(password)})`);
  await r.exec(sql`insert into profiles (id, full_name, role, roles, active) values (${id}, ${full.join(' ') || name}, 'admin', '["admin"]', 1)`);
  console.log('✓ انشأ حساب الأدمن:', name);
}
await close();
