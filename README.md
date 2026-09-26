# لوحة فواتير المبيعات

متابعة طلبات المبيعات: المندوب ← الحسابات ← موافقة المدير ← رد الزبون ← المخزن.
موقع ثابت (GitHub Pages) + Supabase (قاعدة البيانات، الدخول، الملفات). يتثبت كتطبيق على الموبايل والكمبيوتر.

## الهيكل

```
index.html               الصفحة
assets/app.css           التصميم
assets/js/
  config.js              رابط Supabase والمفتاح العام
  main.js                نقطة البداية: التبويبات والتطبيق
  auth.js                تسجيل الدخول
  api.js                 الاتصال بالقاعدة والتحديث المباشر
  state.js               الحالة المشتركة والثوابت
  can.js                 الصلاحيات (نسخة من قواعد القاعدة للواجهة)
  actions.js             الإجراءات (إرسال، موافقة، حذف...)
  board.js / drawer.js   اللوحة وتفاصيل الطلب
  users.js / customers.js / reports.js / export.js / backup.js
  notifications.js       جرس الإشعارات (تغيّر المرحلة + المنشن)
  mentions.js            @ بالتعليقات والملاحظات
  avatars.js             الأفتارات الجاهزة (مرسومة SVG بالكود)
sw.js, manifest.webmanifest, icons/   تطبيق (PWA)
supabase/
  migrations/            تعديلات القاعدة بالترتيب
  functions/push/        Edge Function تبعث تنبيهات الموبايل
  scripts/audit.sql      فحص أمني (قراءة فقط)
  tests/                 اختبارات الصلاحيات
tests/run-db-tests.mjs   يشغّل الاختبارات على Postgres محلي
```

## الأمان

**الحماية الحقيقية بقاعدة البيانات** (RLS + triggers + دوال `SECURITY DEFINER`).
الواجهة (`can.js`) بس تخفي الأزرار. أي قاعدة جديدة لازم تنضاف بالقاعدة **وبالاختبارات**.

- سعر الكلفة بجدول منفصل (`invoice_costs`)، محد يقراه غير الأدمن
- حقول سير العمل (المرحلة، رقم المبيعات...) تتغير بس عبر دوال `inv_*`
- الحذف للأدمن فقط، والباقين يرسلون طلب حذف

## تعديلات القاعدة

الملفات بـ `supabase/migrations/` تنشغل **بالترتيب ومرة وحدة** بـ Supabase ← SQL Editor:

| الملف | الحالة |
|---|---|
| `000_baseline.sql` | الأساس الأصلي. للتوثيق والاختبار فقط، لا تشغله |
| `002_hardening.sql` | ✅ منفّذ |
| `003_admin_users.sql` | ✅ منفّذ |
| `004_business_rules.sql` | قواعد الشغل الجديدة |
| `005_settings_transport.sql` | العملة + النقل |
| `006_urgent.sql` | ✅ منفّذ — علامة طارئ |
| `007_notifications_avatars.sql` | الإشعارات + المنشن + الأفتار |
| `008_notify_more_push.sql` | إشعار التعليق + "دورك" + التذكير اليومي + Web Push (شوف `docs/PUSH.md`) |

## الاختبارات

```bash
npm install
npm test
```

تشغّل كل التعديلات على Postgres محلي (PGlite) وبعدها ~150 اختبار صلاحيات: الزائر، الحساب الموقوف، وكل دور، ومعادلة الربح...
وتشتغل وحدها على GitHub مع كل push (تبويب Actions).

تكدر تشغّل `supabase/tests/security.test.sql` على القاعدة الحقيقية من SQL Editor. ما يغير شي لأن كل التعديلات ترجع بالنهاية.

## التشغيل المحلي

```bash
python -m http.server 8765
```
وافتح http://localhost:8765

## النسخ الاحتياطي

شوف [docs/BACKUP.md](docs/BACKUP.md).
