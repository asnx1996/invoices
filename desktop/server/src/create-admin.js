// أول حساب أدمن (أو تغيير رمزه إذا موجود).
// الاستخدام: npm run create-admin -- <اسم-المستخدم> <الرمز> [الاسم الكامل]
import { close } from './db.js';
import { createAdmin } from './install.js';

const [name, password, ...full] = process.argv.slice(2);
if (!name || !password) { console.log('الاستخدام: npm run create-admin -- <اسم-المستخدم> <الرمز> [الاسم الكامل]'); process.exit(1) }
const r = await createAdmin(name, password, full.join(' ') || name);
console.log(r.existed ? '✓ الحساب موجود: تغيّر الرمز وصار أدمن' : '✓ انشأ حساب الأدمن: ' + name);
await close();
