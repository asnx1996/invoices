# تنبيهات الموبايل (Web Push) — إعداد مرة وحدة

كل إشعار بالجرس ينبعث كتنبيه للموبايل أو الكمبيوتر، حتى لو الموقع مسكّر.

```
إشعار جديد بالقاعدة ← تريغر notify_push (008) ← Edge Function "push" ← الأجهزة المشتركة
```

## المفاتيح

- **المفتاح العام** (`VAPID_PUBLIC_KEY`) بـ `assets/js/config.js`، وهذا عادي لأن المتصفح يحتاجه.
- **المفتاح الخاص والسر** ما ينرفعون على GitHub أبداً. انولدوا بملف محلي `.claude/push-secrets.txt`، وهذا المجلد مستثنى من git.
  إذا ضاع الملف: ولّد مفاتيح جديدة بـ `npx web-push generate-vapid-keys`، وبدّل العام بـ `config.js`، والأجهزة تشترك من جديد وحدها.

## الخطوات

1. **شغّل `supabase/migrations/008_notify_more_push.sql`** بالـ SQL Editor. يفعّل `pg_cron` و `pg_net` وحده.
   إذا طلع خطأ عن الإضافات: Database ← Extensions ← فعّل **pg_cron** و **pg_net** وأعد التشغيل.

2. **الـ Edge Function:** Supabase ← Edge Functions ← Deploy a new function ← **Via Editor**
   - الاسم: `push` (بالضبط)
   - الصق محتوى `supabase/functions/push/index.ts` ← Deploy
   - من إعدادات الدالة (Details): **طفّي "Enforce JWT Verification"**، لأن الحماية بالسر `x-push-secret`.

3. **الأسرار:** Edge Functions ← Secrets ← أضف الأربعة من `.claude/push-secrets.txt`:
   `VAPID_PUBLIC_KEY`، `VAPID_PRIVATE_KEY`، `VAPID_SUBJECT`، `PUSH_SECRET`

4. **اربط القاعدة بالدالة:** الصق جملة الـ `insert into app_private.push_config ...` اللي بنفس الملف بالـ SQL Editor.

5. ارفع الموقع. كل موظف يفتح الجرس ويضغط **"فعّل تنبيهات الجهاز"**.

## ملاحظات

- **آيفون:** التنبيهات تشتغل بس إذا الموقع مثبّت على الشاشة الرئيسية (iOS 16.4+): مشاركة ← إضافة إلى الشاشة الرئيسية، وبعدها يفتحه من الأيقونة ويفعّل.
- **أندرويد والكمبيوتر:** تشتغل من المتصفح مباشرة (Chrome / Edge / Firefox).
- **تسجيل الخروج** يلغي تنبيهات ذاك الجهاز.
- **فحص:** Edge Functions ← push ← Logs. كل إشعار يطلع `{"sent": n}`.
- **التذكير اليومي بالمتأخرة:** كل يوم 8 الصبح بتوقيت بغداد. للتأكد:
  `select * from cron.job;` ولتشغيله يدوياً: `select public.notify_late();`
