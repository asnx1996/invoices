-- 007: لوحة الإشعارات + المنشن (@) + صور الأفتار الجاهزة
--   • إشعار لصاحب الطلب (المندوب واللي أنشأه) لما تتغير مرحلة الطلب
--   • إشعار لأي شخص ينذكر بـ @الاسم بالتعليقات أو بالملاحظات
--   • كل مستخدم يختار أفتار من مجموعة جاهزة (والأدمن يكدر يغيرها لأي أحد)
-- الإشعار يوصل بس للي يكدر يشوف الطلب، وما يوصلك إشعار عن شي سويته أنت.
-- يتشغل بعد 006. آمن للتشغيل أكثر من مرة.
begin;

-- ============================================================
-- 1) الأفتار
-- ============================================================
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_chk;
alter table public.profiles add constraint profiles_avatar_chk check (avatar is null or avatar ~ '^[a-z0-9-]{1,24}$');

-- التعديل يمر من هاي الدالة (سياسة profiles تسمح التعديل للأدمن فقط)
create or replace function public.set_avatar(p_user uuid, p_avatar text)
returns void language plpgsql security definer set search_path = public as $$
declare a text := nullif(btrim(coalesce(p_avatar, '')), '');
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if p_user is distinct from auth.uid() and not public.has_role('admin') then raise exception 'ما عندك صلاحية'; end if;
  if a is not null and a !~ '^[a-z0-9-]{1,24}$' then raise exception 'صورة غير معروفة'; end if;
  update public.profiles set avatar = a where id = p_user;
  if not found then raise exception 'المستخدم غير موجود'; end if;
end $$;
revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;

-- ============================================================
-- 2) جدول الإشعارات
-- ============================================================
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invoice_id bigint references public.invoices (id) on delete cascade,
  kind text not null check (kind in ('stage', 'mention')),
  actor uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_invoice_idx on public.notifications (invoice_id);

-- كل واحد يشوف إشعاراته بس، ويأشرها مقروءة أو يمسحها. الإضافة من التريغرات فقط.
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists notifications_upd on public.notifications;
create policy notifications_upd on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists notifications_del on public.notifications;
create policy notifications_del on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- التحديث المباشر (Realtime) حتى الجرس يتحدث بدون تحديث الصفحة
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================
-- 3) دوال مساعدة (داخلية — المستخدم ما يناديها)
-- ============================================================
-- نفس منطق invoices_read بس لمستخدم معيّن (مو المستخدم الحالي)
create or replace function public.user_can_see_invoice(p_user uuid, p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invoices i join public.profiles p on p.id = p_user and p.active
     where i.id = p_id and (
       'admin' = any(p.roles) or 'mgr' = any(p.roles) or 'acc' = any(p.roles)
       or ('wh' = any(p.roles) and i.stage in ('decision', 'done'))
       or ('rep' = any(p.roles) and i.rep_id = p_user)))
$$;

-- المنشن: "@الاسم الكامل" بالنص. الأسماء الأطول تنفحص أول
-- (حتى "@علي عدنان" ما يحسب "@علي" بعد)، وبعد الاسم لازم فراغ أو علامة مو حرف.
create or replace function public.mentioned_users(p_text text)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  t text := coalesce(p_text, '');
  p record;
  pat text;
begin
  if position('@' in t) = 0 then return; end if;
  for p in
    select id, btrim(full_name) as n from public.profiles
     where active and btrim(coalesce(full_name, '')) <> ''
     order by length(btrim(full_name)) desc
  loop
    -- كل رمز مو حرف/رقم/فراغ نسبقه بـ \ حتى ينقرا حرفياً بالـ regex
    pat := '@' || regexp_replace(p.n, '([^A-Za-z0-9؀-ۿ ])', '\\\1', 'g')
               || '([^A-Za-z0-9_؀-ۿ]|$)';
    if t ~ pat then
      return next p.id;
      t := regexp_replace(t, '@' || regexp_replace(p.n, '([^A-Za-z0-9؀-ۿ ])', '\\\1', 'g'), ' ', 'g');
    end if;
  end loop;
end $$;

revoke execute on function public.user_can_see_invoice(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.mentioned_users(text) from public, anon, authenticated;

-- ============================================================
-- 4) التريغرات
-- ============================================================
-- تغيّر مرحلة الطلب ← إشعار للمندوب ولمن أنشأ الطلب
create or replace function public.notify_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage is not distinct from old.stage and new.sub is not distinct from old.sub then return null; end if;
  insert into public.notifications (user_id, invoice_id, kind, actor, data)
  select distinct u, new.id, 'stage', auth.uid(), jsonb_build_object(
           'stage', new.stage::text, 'sub', new.sub::text,
           'from_stage', old.stage::text, 'from_sub', old.sub::text,
           'customer', new.customer,
           'reason', case when new.stage::text = 'cancel' then new.cancel_reason end)
    from unnest(array[new.rep_id, new.created_by]) u
   where u is not null and u is distinct from auth.uid()
     and public.user_can_see_invoice(u, new.id);
  return null;
end $$;
drop trigger if exists notify_stage_change_trg on public.invoices;
create trigger notify_stage_change_trg after update of stage, sub on public.invoices
  for each row execute function public.notify_stage_change();

-- منشن بتعليق
create or replace function public.notify_comment_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, invoice_id, kind, actor, data)
  select m, new.invoice_id, 'mention', new.author,
         jsonb_build_object('src', 'comment', 'text', left(new.body, 160), 'customer', i.customer)
    from public.mentioned_users(new.body) m
    join public.invoices i on i.id = new.invoice_id
   where m is distinct from new.author
     and public.user_can_see_invoice(m, new.invoice_id);
  return null;
end $$;
drop trigger if exists notify_comment_mentions_trg on public.invoice_comments;
create trigger notify_comment_mentions_trg after insert on public.invoice_comments
  for each row execute function public.notify_comment_mentions();

-- منشن بالملاحظات: بس الأسماء الجديدة (اللي ما كانت مذكورة قبل التعديل)
create or replace function public.notify_notes_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.notes is not distinct from old.notes then return null; end if;
  insert into public.notifications (user_id, invoice_id, kind, actor, data)
  select m, new.id, 'mention', auth.uid(),
         jsonb_build_object('src', 'notes', 'text', left(new.notes, 160), 'customer', new.customer)
    from (select public.mentioned_users(new.notes) except select public.mentioned_users(old.notes)) x(m)
   where m is distinct from auth.uid()
     and public.user_can_see_invoice(m, new.id);
  return null;
end $$;
drop trigger if exists notify_notes_mentions_trg on public.invoices;
create trigger notify_notes_mentions_trg after update of notes on public.invoices
  for each row execute function public.notify_notes_mentions();

revoke execute on function public.notify_stage_change() from public, anon, authenticated;
revoke execute on function public.notify_comment_mentions() from public, anon, authenticated;
revoke execute on function public.notify_notes_mentions() from public, anon, authenticated;

commit;
