-- 013: شكل البورد + التحكم بالإشعارات
--   • boards.bg / bg_custom / blur: خلفية كل بورد وضبابيتها (الأدمن يغيرها، الكل يشوفها)
--   • board_stats(): عدد الطلبات الشغالة والمتأخرة لكل بورد (لصفحة البوردات)
--   • مستوى الإشعارات: all (الكل) / important (المهمة) / mention (المنشن بس) / none (بدون)
--       - عام لكل مستخدم: profiles.notif_level  ← set_notif_level
--       - لطلب معيّن يغطي العام: invoice_notif_prefs ← set_invoice_notif (null = يرجع للعام)
--     المهمة = المنشن + "دورك" + المتأخرة + اكتمال/إلغاء/إرجاع الطلب (بدون التعليقات والنقل العادي)
--     الفلترة بتريغر قبل الإضافة، فتنطبق على الجرس وتنبيهات الموبايل سوا
-- يتشغل بعد 012. آمن للتشغيل أكثر من مرة.
begin;

-- ============================================================
-- 1) خلفية البورد
-- ============================================================
alter table public.boards add column if not exists bg text;                    -- اسم خلفية جاهزة، أو 'custom'
alter table public.boards add column if not exists bg_custom text;             -- صورة الأدمن (data:image/jpeg;base64)
alter table public.boards add column if not exists blur smallint not null default 0;
alter table public.boards drop constraint if exists boards_bg_chk;
alter table public.boards add constraint boards_bg_chk check (bg is null or bg ~ '^[a-z0-9-]{1,24}$');
alter table public.boards drop constraint if exists boards_bg_custom_chk;
alter table public.boards add constraint boards_bg_custom_chk check (
  bg_custom is null or (bg_custom ~ '^data:image/(jpeg|png|webp);base64,' and length(bg_custom) <= 2500000));
alter table public.boards drop constraint if exists boards_blur_chk;
alter table public.boards add constraint boards_blur_chk check (blur between 0 and 30);

-- عدد الطلبات بكل بورد يشوفه المستخدم (نفس صلاحيات القراءة)
create or replace function public.board_stats()
returns table (board_id bigint, active bigint, late bigint)
language sql stable security invoker set search_path = public as $$
  select i.board_id,
         count(*) filter (where i.stage in ('new', 'acc', 'decision')),
         count(*) filter (where i.stage in ('new', 'acc', 'decision') and i.stage_at < now() - interval '3 days')
    from public.invoices i
   group by i.board_id
$$;

-- ============================================================
-- 2) مستوى الإشعارات
-- ============================================================
alter table public.profiles add column if not exists notif_level text not null default 'all';
alter table public.profiles drop constraint if exists profiles_notif_level_chk;
alter table public.profiles add constraint profiles_notif_level_chk check (notif_level in ('all', 'important', 'mention', 'none'));

create table if not exists public.invoice_notif_prefs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  invoice_id bigint not null references public.invoices (id) on delete cascade,
  level text not null check (level in ('all', 'important', 'mention', 'none')),
  primary key (user_id, invoice_id)
);
create index if not exists invoice_notif_prefs_invoice_idx on public.invoice_notif_prefs (invoice_id);
alter table public.invoice_notif_prefs enable row level security;
revoke all on public.invoice_notif_prefs from anon, authenticated;
grant select on public.invoice_notif_prefs to authenticated;   -- التعديل بس عبر الدالة
drop policy if exists invoice_notif_prefs_read on public.invoice_notif_prefs;
create policy invoice_notif_prefs_read on public.invoice_notif_prefs for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.set_notif_level(p_level text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if p_level not in ('all', 'important', 'mention', 'none') then raise exception 'مستوى غير معروف'; end if;
  update public.profiles set notif_level = p_level where id = auth.uid();
end $$;

create or replace function public.set_invoice_notif(p_id bigint, p_level text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  if p_level is null then
    delete from public.invoice_notif_prefs where user_id = auth.uid() and invoice_id = p_id;
    return;
  end if;
  if p_level not in ('all', 'important', 'mention', 'none') then raise exception 'مستوى غير معروف'; end if;
  insert into public.invoice_notif_prefs (user_id, invoice_id, level) values (auth.uid(), p_id, p_level)
  on conflict (user_id, invoice_id) do update set level = excluded.level;
end $$;

-- إشعار مهم؟
create or replace function public.notif_is_important(p_kind text, d jsonb)
returns boolean language sql immutable as $$
  select p_kind in ('mention', 'turn', 'late')
      or (p_kind = 'stage' and (
            d->>'stage' in ('done', 'cancel')
         or (case d->>'stage' when 'new' then 1 when 'acc' then 2 when 'decision' then 3 else 9 end)
          < (case d->>'from_stage' when 'new' then 1 when 'acc' then 2 when 'decision' then 3 else 0 end)))
$$;

create or replace function public.notifications_level_filter()
returns trigger language plpgsql security definer set search_path = public as $$
declare lvl text;
begin
  select coalesce(
           (select level from public.invoice_notif_prefs where user_id = new.user_id and invoice_id = new.invoice_id),
           (select notif_level from public.profiles where id = new.user_id),
           'all') into lvl;
  if lvl = 'all' then return new; end if;
  if lvl = 'none' then return null; end if;
  if lvl = 'mention' then return case when new.kind = 'mention' then new end; end if;
  return case when public.notif_is_important(new.kind, new.data) then new end;  -- important
end $$;
drop trigger if exists notifications_level_filter_trg on public.notifications;
create trigger notifications_level_filter_trg before insert on public.notifications
  for each row execute function public.notifications_level_filter();

-- ============================================================
-- 3) الصلاحيات
-- ============================================================
revoke execute on function public.board_stats() from public, anon;
revoke execute on function public.set_notif_level(text) from public, anon;
revoke execute on function public.set_invoice_notif(bigint, text) from public, anon;
revoke execute on function public.notif_is_important(text, jsonb) from public, anon, authenticated;
revoke execute on function public.notifications_level_filter() from public, anon, authenticated;
grant execute on function public.board_stats() to authenticated;
grant execute on function public.set_notif_level(text) to authenticated;
grant execute on function public.set_invoice_notif(bigint, text) to authenticated;

commit;

notify pgrst, 'reload schema';
