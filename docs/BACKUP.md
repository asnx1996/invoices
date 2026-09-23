# النسخ الاحتياطي

عندك طريقتين:

| | زر "نسخة احتياطية الآن" | النسخة الأسبوعية (GitHub Actions) |
|---|---|---|
| وين | صفحة المستخدمين (للأدمن) | تلقائي كل جمعة 3 الصبح + زر يدوي |
| شنو بيها | كل الجداول بملف Excel | القاعدة كاملة + حسابات الدخول + ملفات PDF |
| ينفع للاسترجاع؟ | للقراءة والمراجعة | ✅ استرجاع كامل |
| وين تنحفظ | جهازك | GitHub (90 يوم)، مشفّرة |

## إعداد النسخة الأسبوعية (مرة وحدة)

بالريبو على GitHub: **Settings ← Secrets and variables ← Actions ← New repository secret**، وضيف:

1. **`SUPABASE_DB_URL`**: رابط الاتصال بالقاعدة
   - Supabase ← زر **Connect** فوق ← **Session pooler** (مو Direct، لأن GitHub ما يدعم IPv6)
   - انسخ الرابط وبدّل `[YOUR-PASSWORD]` بكلمة سر القاعدة
     (إذا ناسيها: Project Settings ← Database ← Reset database password)
   - شكله: `postgresql://postgres.ripxxnmaadnpxocixbva:PASSWORD@aws-0-xx.pooler.supabase.com:5432/postgres`

2. **`BACKUP_PASSPHRASE`**: كلمة سر طويلة **من اختيارك** يتشفر بيها الملف.
   ⚠️ احفظها بمكان آمن. بدونها ما تكدر تفتح النسخة، والريبو عام فالتشفير ضروري.

3. **`SUPABASE_SERVICE_KEY`** (اختياري، لنسخ ملفات PDF):
   Supabase ← Project Settings ← API Keys ← **secret** key.
   ⚠️ هذا مفتاح كامل الصلاحيات. يبقى بس بـ GitHub Secrets، لا تحطه بالكود أبداً.

بعدها جرّب: تبويب **Actions ← Weekly backup ← Run workflow**.

## تنزيل النسخة وفتحها

1. **Actions ← Weekly backup** ← آخر تشغيل ناجح ← **Artifacts** ← نزّل الملف
2. فك الضغط (zip) يطلع ملف `invoices-backup-YYYY-MM-DD.tar.gz.gpg`
3. فك التشفير (Git Bash على ويندوز، أو أي لينكس/ماك):

```bash
gpg --decrypt invoices-backup-2026-09-26.tar.gz.gpg | tar xzf -
```

يطلع مجلد `backup/` بيه:
- `public.sql`: الجداول والدوال والسياسات والبيانات
- `auth_users.sql`: حسابات الدخول
- `storage_meta.sql`: بيانات الملفات
- `files/`: ملفات PDF نفسها

## الاسترجاع (بحالة كارثة)

على مشروع Supabase **جديد**:

```bash
psql "$NEW_DB_URL" -f backup/auth_users.sql
psql "$NEW_DB_URL" -f backup/public.sql
psql "$NEW_DB_URL" -f backup/storage_meta.sql
```

بعدها ارفع مجلد `files/` لـ bucket اسمه `invoices`، وبدّل الرابط والمفتاح بـ `assets/js/config.js`.
