// Edge Function "push": تبعث كل إشعار جديد كتنبيه للأجهزة المشتركة (Web Push).
// تنادى من التريغر notify_push (migration 008) برقم الإشعار + سر مشترك.
// الإعداد مرة وحدة: docs/PUSH.md
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@invoices.local', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

// نفس صياغة assets/js/notifications.js
const STAGE: Record<string, string> = { new: 'طلب جديد', acc: 'الحسابات', done: 'تمت', cancel: 'ملغاة' };
const SUB: Record<string, string> = { mgr: 'بانتظار موافقة المدير', cust: 'بانتظار رد الزبون', wh: 'بانتظار تحويل المخزن' };
const TURN: Record<string, string> = { acc: 'يحتاج السداد والكلفة', mgr: 'ينتظر موافقتك', cust: 'بلّغ الزبون وأشّر رده', wh: 'جاهز للتحويل لمبيعات', new: 'كمّله وأرسله للحسابات' };

// deno-lint-ignore no-explicit-any
function text(n: any, who: string): string {
  const d = n.data ?? {};
  const inv = `#${n.invoice_id}${d.customer ? ' (' + d.customer + ')' : ''}`;
  const key = d.stage === 'decision' ? d.sub : d.stage;
  switch (n.kind) {
    case 'mention': return `${who} ذكرك ${d.src === 'notes' ? 'بالملاحظات' : 'بتعليق'} على الطلب ${inv}: ${d.text ?? ''}`;
    case 'comment': return `${who} علّق على طلبك ${inv}: ${d.text ?? ''}`;
    case 'late': return `الطلب ${inv} صار له ${d.days} يوم بنفس المرحلة وينتظرك`;
    case 'turn': return d.stage === 'acc' && d.from_stage === 'decision'
      ? `${who} رجّع الطلب ${inv} للحسابات`
      : `${who} حوّل لك الطلب ${inv} — ${TURN[key] ?? ''}`;
  }
  if (d.stage === 'acc' && d.from_stage === 'decision') return `${who} رجّع الطلب ${inv} للحسابات`;
  if (d.stage === 'done') return `${who} حوّل الطلب ${inv} لمبيعات ✓`;
  if (d.stage === 'cancel') return `${who} ألغى الطلب ${inv}${d.reason ? ': ' + d.reason : ''}`;
  return `${who} نقل الطلب ${inv} إلى: ${d.stage === 'decision' ? SUB[d.sub] : STAGE[d.stage] ?? d.stage}`;
}

Deno.serve(async req => {
  if (!env('PUSH_SECRET') || req.headers.get('x-push-secret') !== env('PUSH_SECRET')) return new Response('forbidden', { status: 403 });
  const { id } = await req.json().catch(() => ({}));
  const { data: n } = await sb.from('notifications').select('*').eq('id', id).maybeSingle();
  if (!n) return new Response('gone', { status: 404 });

  const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', n.user_id);
  if (!subs?.length) return new Response('no subscriptions');

  let who = 'النظام';
  if (n.actor) {
    const { data: p } = await sb.from('profiles').select('full_name').eq('id', n.actor).maybeSingle();
    who = p?.full_name || '—';
  }
  const payload = JSON.stringify({ title: 'فواتير المبيعات', body: text(n, who).slice(0, 240), inv: n.invoice_id, tag: 'n' + n.id });

  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
      sent++;
    } catch (e) {
      // الجهاز لغى الاشتراك أو انمسح المتصفح: نشيله
      // deno-lint-ignore no-explicit-any
      const code = (e as any)?.statusCode;
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('push failed', code, (e as Error)?.message);
    }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
