-- 016: سلة المحذوفات + تفاعلات على التعليقات + خلفية متحركة للبورد
--   • حذف الطلب (inv_delete) صار ينقله للسلة: invoices.deleted_at/deleted_by
--       - المحذوف ما يطلع لأحد (RLS + can_see_invoice + الإشعارات + التقارير)
--       - أي تعديل على طلب بالسلة ينرفض (تريغر) لحد ما ينرجع
--       - الأدمن: trash_list() / inv_restore() / inv_purge() (الحذف النهائي يرجّع مسار الـ PDF)
--   • comment_reactions + comment_react(id, emoji): ضغطة تضيف، ضغطة ثانية تشيل
--   • boards.bg_anim: GIF/WebP/MP4/WebM (data URL) تشتغل بس على الحاسبة. has_anim حتى ما نحمّلها إلا وقت الحاجة
-- يتشغل بعد 015. آمن للتشغيل أكثر من مرة.
begin;

-- ============================================================
-- 1) سلة المحذوفات
-- ============================================================
alter table public.invoices add column if not exists deleted_at timestamptz;
alter table public.invoices add column if not exists deleted_by uuid;
create index if not exists invoices_deleted_idx on public.invoices (deleted_at) where deleted_at is not null;

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (
  deleted_at is null and board_id = any((select public.my_boards())::bigint[]) and (
    (select public.has_role('admin')) or (select public.has_role('mgr')) or (select public.has_role('acc'))
    or ((select public.has_role('wh')) and stage in ('decision', 'done'))
    or ((select public.has_role('rep')) and rep_id = (select auth.uid())))
);

create or replace function public.can_see_invoice(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invoices i where i.id = p_id and i.deleted_at is null and public.in_board(i.board_id) and (
      public.has_role('admin') or public.has_role('mgr') or public.has_role('acc')
      or (public.has_role('wh') and i.stage in ('decision', 'done'))
      or (public.has_role('rep') and i.rep_id = auth.uid())))
$$;

create or replace function public.user_can_see_invoice(p_user uuid, p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invoices i join public.profiles p on p.id = p_user and p.active
     where i.id = p_id and i.deleted_at is null
       and ('admin' = any(p.roles)
            or exists (select 1 from public.board_members m where m.board_id = i.board_id and m.user_id = p_user))
       and ('admin' = any(p.roles) or 'mgr' = any(p.roles) or 'acc' = any(p.roles)
            or ('wh' = any(p.roles) and i.stage in ('decision', 'done'))
            or ('rep' = any(p.roles) and i.rep_id = p_user)))
$$;
revoke execute on function public.user_can_see_invoice(uuid, bigint) from public, anon, authenticated;

-- طلب بالسلة ما يتعدل (حتى من الإجراءات). بس النقل للسلة والاسترجاع
create or replace function public.invoices_trash_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.deleted_at is not null and new.deleted_at is not null then
    raise exception 'الطلب بسلة المحذوفات — رجّعه أول';
  end if;
  return new;
end $$;
revoke execute on function public.invoices_trash_guard() from public, anon, authenticated;
drop trigger if exists invoices_trash_guard_trg on public.invoices;
create trigger invoices_trash_guard_trg before update on public.invoices
  for each row execute function public.invoices_trash_guard();

-- الحذف = نقل للسلة (نفس الاسم حتى الواجهة القديمة تبقى تشتغل). يرجّع null: الملف يبقى
create or replace function public.inv_delete(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.has_role('admin') then raise exception 'الحذف للأدمن فقط'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null or v.deleted_at is not null then raise exception 'الطلب غير موجود'; end if;
  update public.invoices set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  perform public.add_log(p_id, 'نقل الطلب لسلة المحذوفات');
  return null;
end $$;

create or replace function public.inv_restore(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.has_role('admin') then raise exception 'الاسترجاع للأدمن فقط'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null or v.deleted_at is null then raise exception 'الطلب مو بسلة المحذوفات'; end if;
  update public.invoices
     set deleted_at = null, deleted_by = null, delete_req_by = null, delete_req_at = null, delete_req_reason = null
   where id = p_id;
  perform public.add_log(p_id, 'رجع الطلب من سلة المحذوفات');
end $$;

-- حذف نهائي (من السلة بس). يرجّع مسار الـ PDF حتى الواجهة تمسح الملف
create or replace function public.inv_purge(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare path text;
begin
  if not public.has_role('admin') then raise exception 'الحذف للأدمن فقط'; end if;
  select pdf_path into path from public.invoices where id = p_id and deleted_at is not null;
  if not found then raise exception 'الطلب مو بسلة المحذوفات'; end if;
  delete from public.invoice_comments where invoice_id = p_id;
  delete from public.invoice_log where invoice_id = p_id;
  delete from public.invoice_stage_log where invoice_id = p_id;
  delete from public.invoice_costs where invoice_id = p_id;
  delete from public.invoices where id = p_id;
  return path;
end $$;

create or replace function public.trash_list()
returns setof public.invoices language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then raise exception 'سلة المحذوفات للأدمن فقط'; end if;
  return query select * from public.invoices
    where deleted_at is not null and public.in_board(board_id) order by deleted_at desc;
end $$;

revoke execute on function public.inv_restore(bigint), public.inv_purge(bigint), public.trash_list() from public, anon;
grant execute on function public.inv_restore(bigint), public.inv_purge(bigint), public.trash_list() to authenticated;

-- الربح والتقارير: بدون المحذوفة
create or replace function public.inv_profits(p_ids bigint[] default null)
returns table (invoice_id bigint, total numeric, gross_pct numeric, net_pct numeric)
language sql stable security definer set search_path = public as $$
  select p.invoice_id, p.total, p.gross_pct, p.net_pct
    from public.inv_profit_rows() p
    join public.invoices i on i.id = p.invoice_id
   where (p_ids is null or p.invoice_id = any(p_ids))
     and i.deleted_at is null
     and public.in_board(i.board_id)
     and (public.has_role('admin')
          or (public.has_role('mgr') and p.stage in ('decision', 'done', 'cancel')))
$$;

create or replace function public.report_summary(p_from date, p_to date, p_board bigint default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not (public.has_role('admin') or public.has_role('mgr')) then raise exception 'التقارير للأدمن والمدير'; end if;
  if not public.in_board(p_board) then raise exception 'ما عندك صلاحية على هذا البورد'; end if;

  with inv as (
    select i.*, p.net_pct
      from public.invoices i
      left join public.inv_profit_rows() p on p.invoice_id = i.id
     where i.board_id = p_board and i.deleted_at is null and i.created_at >= p_from and i.created_at < (p_to + 1)
  ),
  seg as (
    select s.stage, s.sub,
           extract(epoch from (coalesce(lead(s.at) over w, case when i.stage in ('new','acc','decision') then now() end) - s.at)) / 86400 as days
      from public.invoice_stage_log s
      join inv i on i.id = s.invoice_id
    window w as (partition by s.invoice_id order by s.at, s.id)
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'count', count(*),
        'active', count(*) filter (where stage in ('new','acc','decision')),
        'done', count(*) filter (where stage = 'done'),
        'cancel', count(*) filter (where stage = 'cancel'),
        'done_value', coalesce(sum(value) filter (where stage = 'done'), 0),
        'late', count(*) filter (where stage in ('new','acc','decision') and stage_at < now() - interval '3 days'),
        'avg_cycle_days', round(avg(extract(epoch from (closed_at - created_at)) / 86400) filter (where stage = 'done')::numeric, 1),
        'avg_net_pct', round(avg(net_pct) filter (where stage = 'done'), 2)) from inv),
    'by_rep', coalesce((select jsonb_agg(r order by r.done_value desc) from (
        select coalesce(pr.full_name, '—') as rep, count(*) as total,
               count(*) filter (where i.stage in ('new','acc','decision')) as active,
               count(*) filter (where i.stage = 'done') as done,
               count(*) filter (where i.stage = 'cancel') as cancel,
               coalesce(sum(i.value) filter (where i.stage = 'done'), 0) as done_value,
               round(avg(extract(epoch from (i.closed_at - i.created_at)) / 86400) filter (where i.stage = 'done')::numeric, 1) as avg_cycle_days,
               round(avg(i.net_pct) filter (where i.stage = 'done'), 2) as avg_net_pct
          from inv i left join public.profiles pr on pr.id = i.rep_id
         group by pr.full_name) r), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(m order by m.month) from (
        select to_char(date_trunc('month', closed_at), 'YYYY-MM') as month,
               count(*) as done, coalesce(sum(value), 0) as value, round(avg(net_pct), 2) as avg_net_pct
          from inv where stage = 'done' group by 1) m), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(x order by x.ord) from (
        select case when stage = 'decision' then 'decision:' || coalesce(sub, '') else stage end as key,
               case stage when 'new' then 1 when 'acc' then 2 else
                 case sub when 'mgr' then 3 when 'cust' then 4 when 'wh' then 5 else 6 end end as ord,
               count(*) as n, round(avg(days)::numeric, 1) as avg_days
          from seg where stage in ('new','acc','decision') and days is not null group by 1, 2) x), '[]'::jsonb),
    'cancel_reasons', coalesce((select jsonb_agg(c) from (
        select btrim(cancel_reason) as reason, count(*) as n from inv
         where stage = 'cancel' and btrim(coalesce(cancel_reason,'')) <> ''
         group by 1 order by 2 desc limit 10) c), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ============================================================
-- 2) تفاعلات على التعليقات
-- ============================================================
create table if not exists public.comment_reactions (
  comment_id bigint not null references public.invoice_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);
alter table public.comment_reactions drop constraint if exists comment_reactions_emoji_chk;
alter table public.comment_reactions add constraint comment_reactions_emoji_chk
  check (emoji in ('👍', '❤️', '😂', '😮', '🙏', '✅'));
alter table public.comment_reactions enable row level security;
revoke all on public.comment_reactions from anon, authenticated;
grant select on public.comment_reactions to authenticated;   -- الإضافة والشيل بس عبر الدالة
drop policy if exists comment_reactions_read on public.comment_reactions;
create policy comment_reactions_read on public.comment_reactions for select to authenticated
  using (exists (select 1 from public.invoice_comments c where c.id = comment_reactions.comment_id));

-- يرجّع true إذا انضاف، false إذا انشال
create or replace function public.comment_react(p_id bigint, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare inv bigint;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select invoice_id into inv from public.invoice_comments where id = p_id;
  if inv is null or not public.can_see_invoice(inv) then raise exception 'التعليق غير موجود'; end if;
  delete from public.comment_reactions where comment_id = p_id and user_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  insert into public.comment_reactions (comment_id, user_id, emoji) values (p_id, auth.uid(), p_emoji);
  return true;
end $$;
revoke execute on function public.comment_react(bigint, text) from public, anon;
grant execute on function public.comment_react(bigint, text) to authenticated;

-- ============================================================
-- 3) خلفية متحركة للبورد (تشتغل بس على الحاسبة)
-- ============================================================
alter table public.boards add column if not exists bg_anim text;
alter table public.boards drop constraint if exists boards_bg_anim_chk;
alter table public.boards add constraint boards_bg_anim_chk check (
  bg_anim is null or (bg_anim ~ '^data:(image/(gif|webp)|video/(mp4|webm));base64,' and length(bg_anim) <= 8000000));
alter table public.boards add column if not exists has_anim boolean generated always as (bg_anim is not null) stored;

commit;

notify pgrst, 'reload schema';
