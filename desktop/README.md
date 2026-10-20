# نسخة الحاسبة (بدون إنترنت)

برنامج `Invoices-Setup.exe` يتنصب على كل حاسبة بالشبكة. البيانات كلها على **حاسبة رئيسية** وحدة بـ SQL Server.

## التنصيب

**الحاسبة الرئيسية** (لازم يكون عليها SQL Server، والـ Express المجاني يكفي، ويكون الدخول بالرمز مفعّل "Mixed Mode"):
1. نصّب `Invoices-Setup-x.y.z.exe`. التنصيب يفتح المنفذ 8787 بالجدار الناري للشبكة الخاصة.
2. افتح البرنامج ← **هاي الحاسبة الرئيسية** ← اختار نسخة SQL Server واكتب حساب الأدمن.
3. من قائمة البرنامج ← **عناوين الشبكة** تلكى العنوان اللي تنطيه لباقي الحاسبات.
4. البرنامج لازم يبقى شغال على هاي الحاسبة. السكر يخليه بالخلفية، أيقونته جنب الساعة.

**كل حاسبة ثانية:** نصّب نفس الملف ← **حاسبة فرعية** ← اكتب عنوان الحاسبة الرئيسية.

## وين البيانات
- القاعدة: `InvoicesApp` على SQL Server (الجداول بـ `server/src/schema.sql`).
- ملفات الـ PDF والإعدادات: `%APPDATA%\فواتير المبيعات\` على الحاسبة الرئيسية.
- النسخ الاحتياطي: انسخ قاعدة `InvoicesApp` (Backup من SQL Server Management Studio) ومجلد `data\files`.

## للمطوّر
```
cd desktop/server && npm install
npm run setup-db                       # قاعدة + مستخدم SQL + الجداول (config.json)
npm run create-admin -- admin <الرمز>   # أول أدمن
npm start                              # http://localhost:8787

cd desktop/app && npm install
npm start                              # البرنامج (Electron) بوضع التطوير
npm run dist                           # يبني dist/Invoices-Setup-x.y.z.exe
```
- `server/src/rules.js` و `rpc.js`: كل قواعد البرنامج وصلاحياته (منقولة من `supabase/migrations`). أي قاعدة جديدة بـ migration لازم تنضاف هنا كذلك.
- الواجهة نفسها مال الموقع؛ `assets/js/local-client.js` يبدّل Supabase بالسيرفر المحلي.
