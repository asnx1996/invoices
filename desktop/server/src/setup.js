// تهيئة أول مرة من سطر الأوامر على الحاسبة الرئيسية.
// الاستخدام: npm run setup-db [-- --instance TEW_SQLEXPRESS --database InvoicesApp]
import { config } from './config.js';
import { close } from './db.js';
import { installDb } from './install.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
await installDb({ instance: arg('instance', config.sql.instanceName), database: arg('database', config.sql.database) });
await close();
