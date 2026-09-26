// إعدادات الاتصال — من Supabase → Settings → API
export const SUPABASE_URL = 'https://ripxxnmaadnpxocixbva.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_grhdLcUbyZZilhk5WbIdxg_uIX1CME3';

// الحسابات يسويها الأدمن؛ اسم المستخدم ينحفظ كإيميل داخلي (ahmed → ahmed@invoices.local)
export const LOGIN_DOMAIN = '@invoices.local';

// تنبيهات الموبايل (Web Push): المفتاح العام بس — الخاص بأسرار الـ Edge Function (docs/PUSH.md)
export const VAPID_PUBLIC_KEY = ''; // فاضي لحد ما يتفعّل الـ Push — المفتاح بـ .claude/push-secrets.txt
