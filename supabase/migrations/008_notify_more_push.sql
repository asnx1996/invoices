-- 008: إشعارات أكثر + تنبيهات الموبايل (Web Push)
--   1) تعليق على طلبك ← إشعار لصاحب الطلب (حتى بدون منشن)
--   2) "دورك": الطلب يوصل لمرحلتك ← إشعار (المحاسبين، المدير، المخزن، أو المندوب)
--   3) تذكير يومي (8 الصبح بغداد) باللي متأخر 3 أيام+ وينتظرك — pg_cron
--   4) Web Push: كل إشعار ينبعث للموبايل/الكمبيوتر حتى لو الموقع مسكّر
--      (يحتاج Edge Function "push" + إعداد مرة وحدة — شوف docs/PUSH.md)
-- يتشغل بعد 007. آمن للتشغيل أكثر من مرة.
begin;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('stage', 'mention', 'comment', 'turn', 'late'));

-- ============================================================
-- منو دوره بهاي المرحلة
-- ============================================================
create or replace function public.turn_users(p_stage text, p_sub text, p_rep uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_rep where p_rep is not null and (p_stage = 'new' or (p_stage = 'decision' and p_sub = 'cust'))
  union
  select p.id from public.profiles p
   where p.active and (
         (p_stage = 'acc' and 'acc' = any(p.roles))
      or (p_stage = 'decision' and p_sub = 'mgr' and 'mgr' = any(p.roles))
      or (p_stage = 'decision' and p_sub = 'wh' and 'wh' = any(p.roles)))
$$;
revoke execute on function public.turn_users(text, text, uuid) from public, anon, authenticated;

-- ============================================================
-- 2) تغيّر المرحلة: أصحاب الطلب (stage) + اللي صار دوره (turn)
-- ============================================================
create or replace function public.notify_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owners uuid[] := array_remove(array[new.rep_id, new.created_by], null);
  d jsonb;
begin
  if new.stage is not distinct from old.stage and new.sub is not distinct from old.sub then return null; end if;
  d := jsonb_build_object(
         'stage', new.stage::text, 'sub', new.sub::text,
         'from_stage', old.stage::text, 'from_sub', old.sub::text,
         'customer', new.customer,
         'reason', case when new.stage::text = 'cancel' then new.cancel_reason end);

  insert into public.notifications (user_id, invoice_id, kind, actor, data)
  select distinct u, new.id, 'stage', auth.uid(), d
    from unnest(owners) u
   where u is distinct from auth.uid() and public.user_can_see_invoice(u, new.id);

  insert into public.notifications (user_id, invoice_id, kind, actor, data)
  select u, new.id, 'turn', auth.uid(), d
    from public.turn_users(new.stage::text, new.sub::text, new.rep_id) u
   where u is distinct from auth.uid() and not (u = any(owners))
     and public.user_can_see_invoice(u, new.id);
  return null;
end $$;

-- ============================================================
-- 1) تعليق: المنشن (مثل قبل) + صاحب الطلب إذا ما انذكر
-- ============================================================
create or replace function public.notify_comment_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  i public.invoices;
  m uuid[];
begin
  select * into i from public.invoices where id = new.invoice_id;
  if i.id is null then return null; end if;
  m := array(select public.mentioned_users(new.body));

  insert into public.notifications (user_id, invoice_id, kind, actor, data)
  select u, new.invoice_id, 'mention', new.author,
         jsonb_build_object('src', 'comment', 'text', left(new.body, 160), 'customer', i.customer)
    from unnest(m) u
   where u is distinct from new.author and public.user_can_see_invoice(u, new.invoice_id);

  -- تعليقات النظام (سبب الإرجاع) صاحب الطلب يوصله عنها إشعار المرحلة
  if not new.is_system then
    insert into public.notifications (user_id, invoice_id, kind, actor, data)
    select distinct u, new.invoice_id, 'comment', new.author,
           jsonb_build_object('text', left(new.body, 160), 'customer', i.customer)
      from unnest(array_remove(array[i.rep_id, i.created_by], null)) u
     where u is distinct from new.author and not (u = any(m))
       and public.user_can_see_invoice(u, new.invoice_id);
  end if;
  return null;
end $$;

-- ============================================================
-- 3) تذكير يومي بالمتأخرة (3 أيام أو أكثر بنفس المرحلة)
-- ============================================================
create or replace function public.notify_late()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.notifications (user_id, invoice_id, kind, actor, data)
  select u, i.id, 'late', null, jsonb_build_object(
           'stage', i.stage::text, 'sub', i.sub::text, 'customer', i.customer,
           'days', floor(extract(epoch from now() - i.stage_at) / 86400)::int)
    from public.invoices i
   cross join lateral public.turn_users(i.stage::text, i.sub::text, i.rep_id) u
   where i.stage::text in ('new', 'acc', 'decision')
     and i.stage_at <= now() - interval '3 days'
     and public.user_can_see_invoice(u, i.id)
     -- مرة وحدة باليوم لكل طلب
     and not exists (select 1 from public.notifications x
                      where x.user_id = u and x.invoice_id = i.id and x.kind = 'late'
                        and x.created_at > now() - interval '20 hours');
  get diagnostics n = row_count;
  -- تنظيف: المقروءة الأقدم من 90 يوم
  delete from public.notifications where read_at is not null and created_at < now() - interval '90 days';
  return n;
end $$;
revoke execute on function public.notify_late() from public, anon, authenticated;

-- الجدولة: كل يوم 5:00 UTC = 8:00 بغداد (يحتاج pg_cron — موجود بـ Supabase)
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron مو متوفر هنا — التذكير اليومي ما انجدول';
    return;
  end;
  execute $q$select cron.schedule('invoices-late-reminders', '0 5 * * *', 'select public.notify_late()')$q$;
end $$;

-- ============================================================
-- 4) Web Push
-- ============================================================
-- اشتراكات الأجهزة (كل متصفح/موبايل إله endpoint)
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  ua text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;  -- بس عبر الدوال تحت

-- نفس الجهاز ممكن ينتقل لمستخدم ثاني (تسجيل خروج ودخول): الاشتراك ينتقل وياه
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'اشتراك غير صالح'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, ua)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_ua, ''), 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke execute on function public.push_subscribe(text, text, text, text) from public, anon;
revoke execute on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- رابط الـ Edge Function والسر: جدول خاص محد يوصله من المتصفح.
-- يتعبى مرة وحدة يدوياً (docs/PUSH.md) — مو بالـ git.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table if not exists app_private.push_config (
  id int primary key default 1 check (id = 1),
  url text not null,
  secret text not null
);
revoke all on app_private.push_config from public, anon, authenticated;

-- كل إشعار جديد ← نداء للـ Edge Function برقم الإشعار بس (هي تقرا الباقي)
create or replace function public.notify_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare c app_private.push_config;
begin
  select * into c from app_private.push_config where id = 1;
  if c.url is null then return null; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return null; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using c.url, jsonb_build_object('id', new.id),
            jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.secret);
  exception when others then
    raise warning 'push: %', sqlerrm;  -- فشل الإرسال ما يوقف الإشعار نفسه
  end;
  return null;
end $$;
revoke execute on function public.notify_push() from public, anon, authenticated;
drop trigger if exists notify_push_trg on public.notifications;
create trigger notify_push_trg after insert on public.notifications
  for each row execute function public.notify_push();

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net مو متوفر هنا — Web Push ما يشتغل';
end $$;

commit;
