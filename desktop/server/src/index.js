// تشغيل السيرفر من سطر الأوامر: npm start
import { start } from './app.js';

const s = await start();
console.log(`سيرفر الفواتير شغال على المنفذ ${s.port}`);
console.log(`  هاي الحاسبة:    http://localhost:${s.port}`);
for (const ip of s.addresses) console.log(`  من الشبكة:      http://${ip}:${s.port}`);
