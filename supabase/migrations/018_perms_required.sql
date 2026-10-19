-- 018: صلاحيات يتحكم بيها الأدمن + أدوار جديدة + إلزامية حقول الطلب من الإعدادات
--   • role_defs: كل دور (المندوب، المحاسب، المدير، المخزن + أدوار يسويها الأدمن) وصلاحياته (perms)
--     الأدمن خارج الجدول وعنده كلشي دائماً
--   • profiles.xroles: الأدوار الإضافية (اللي سواها الأدمن) للمستخدم
--   • perm('x'): هل المستخدم الحالي عنده الصلاحية؟ — كل فحوصات الأدوار بالدوال والسياسات صارت عليها
--   • صلاحية users: غير الأدمن يكدر يضيف حسابات ويعدلها، بس ما يلمس حسابات الأدمن ولا ينطي دور أدمن
--   • app_settings.opt_fields: الحقول اللي الأدمن خلاها اختيارية (الباقي إلزامي مثل قبل)
-- الصلاحيات الافتراضية = نفس السلوك القديم بالضبط. يتشغل بعد 017. آمن للتشغيل أكثر من مرة.
begin;

-- ============================================================
-- 1) الأدوار وصلاحياتها
-- ============================================================
create table if not exists public.role_defs (
  key text primary key,
  name text not null,
  perms text[] not null default '{}',
  builtin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.role_defs drop constraint if exists role_defs_key_chk;
alter table public.role_defs add constraint role_defs_key_chk check (key ~ '^[a-z][a-z0-9_]{1,30}$' and key <> 'admin');
alter table public.role_defs drop constraint if exists role_defs_name_chk;
alter table public.role_defs add constraint role_defs_name_chk check (btrim(name) <> '' and length(name) <= 40);
alter table public.role_defs drop constraint if exists role_defs_perms_chk;
alter table public.role_defs add constraint role_defs_perms_chk check (perms <@ array[
  'create', 'acc', 'approve', 'cust_all', 'complete', 'move', 'urgent_all',
  'see_all', 'see_late', 'see_profit', 'reports', 'export', 'customers', 'users', 'trash']::text[]);
create unique index if not exists role_defs_name_uniq on public.role_defs (lower(btrim(name)));

insert into public.role_defs (key, name, perms, builtin) values
  ('rep', 'مندوب', array['create'], true),
  ('acc', 'محاسب', array['acc', 'see_all', 'export'], true),
  ('mgr', 'مدير', array['approve', 'cust_all', 'complete', 'move', 'urgent_all', 'see_all', 'see_profit', 'reports', 'export'], true),
  ('wh', 'مخزن', array['complete', 'see_late'], true)
on conflict (key) do nothing;

alter table public.role_defs enable row level security;
revoke all on public.role_defs from anon;
grant select, insert, update, delete on public.role_defs to authenticated;
drop policy if exists role_defs_read on public.role_defs;
create policy role_defs_read on public.role_defs for select to authenticated using ((select public.is_active()));
drop policy if exists role_defs_admin_ins on public.role_defs;
create policy role_defs_admin_ins on public.role_defs for insert to authenticated
  with check ((select public.has_role('admin')) and not builtin);
drop policy if exists role_defs_admin_upd on public.role_defs;
create policy role_defs_admin_upd on public.role_defs for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
drop policy if exists role_defs_admin_del on public.role_defs;
create policy role_defs_admin_del on public.role_defs for delete to authenticated
  using ((select public.has_role('admin')) and not builtin);

-- الأدوار الإضافية للمستخدم (مفاتيح من role_defs)
alter table public.profiles add column if not exists xroles text[] not null default '{}';

-- مستخدم بدور إضافي بس (بدون مندوب/محاسب/...) ما ينضاف إله "مندوب" تلقائياً
create or replace function public.profiles_roles_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role and new.roles is not distinct from old.roles then
    new.roles := array[new.role];
  end if;
  if coalesce(cardinality(new.roles), 0) = 0 and coalesce(cardinality(new.xroles), 0) = 0 then
    new.roles := array[coalesce(new.role, 'rep'::public.app_role)];
  end if;
  new.roles := array(select distinct x from unnest(coalesce(new.roles, '{}')) x order by x);
  new.xroles := array(select distinct x from unnest(coalesce(new.xroles, '{}')) x order by x);
  new.role := case
    when 'admin' = any(new.roles) then 'admin'
    when 'mgr'   = any(new.roles) then 'mgr'
    when 'acc'   = any(new.roles) then 'acc'
    when 'wh'    = any(new.roles) then 'wh'
    else 'rep' end;
  return new;
end $$;

-- دور ينحذف ← ينشال من المستخدمين
create or replace function public.role_defs_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set xroles = array_remove(xroles, old.key) where old.key = any(xroles);
  return old;
end $$;
revoke execute on function public.role_defs_cleanup() from public, anon, authenticated;
drop trigger if exists role_defs_cleanup_trg on public.role_defs;
create trigger role_defs_cleanup_trg after delete on public.role_defs
  for each row execute function public.role_defs_cleanup();

-- صلاحية من أدوار المستخدم فقط (بدون استثناء الأدمن) — للإشعارات "دورك"
create or replace function public.role_perm(p_user uuid, p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr join public.role_defs d
      on d.key = any(pr.roles::text[]) or d.key = any(pr.xroles)
     where pr.id = p_user and pr.active and p = any(d.perms))
$$;

-- الأدمن عنده كلشي
create or replace function public.user_perm(p_user uuid, p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and active and 'admin' = any(roles))
      or public.role_perm(p_user, p)
$$;

create or replace function public.perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_perm(auth.uid(), p)
$$;

-- غير الأدمن ما يغير أدوار نفسه (حتى صاحب صلاحية المستخدمين ما يرفع صلاحياته)
-- والأدوار الإضافية لازم تكون معرّفة
create or replace function public.profiles_perm_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if exists (select 1 from unnest(new.xroles) x where not exists (select 1 from public.role_defs d where d.key = x)) then
    raise exception 'دور غير معروف'; end if;
  if public.has_role('admin') then return new; end if;
  if 'admin' = any(new.roles) or (tg_op = 'UPDATE' and 'admin' = any(old.roles)) then
    raise exception 'حسابات الأدمن يعدلها الأدمن بس'; end if;
  if tg_op = 'UPDATE' and new.id = auth.uid()
     and (new.roles is distinct from old.roles or new.xroles is distinct from old.xroles or new.active is distinct from old.active) then
    raise exception 'ما تكدر تغير أدوارك'; end if;
  return new;
end $$;
revoke execute on function public.profiles_perm_guard() from public, anon, authenticated;
drop trigger if exists profiles_perm_guard_trg on public.profiles;
create trigger profiles_perm_guard_trg before insert or update on public.profiles
  for each row execute function public.profiles_perm_guard();

drop policy if exists profiles_users_upd on public.profiles;
create policy profiles_users_upd on public.profiles for update to authenticated
  using ((select public.perm('users')) and not ('admin' = any(roles)))
  with check ((select public.perm('users')) and not ('admin' = any(roles)));

-- ============================================================
-- 2) إلزامية الحقول: opt_fields = الحقول الاختيارية (فارزة بينها)
-- ============================================================
create or replace function public.fld_req(k text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.app_settings
                      where key = 'opt_fields' and k = any(string_to_array(replace(value, ' ', ''), ',')))
$$;

-- ============================================================
-- 3) من يشوف الطلب
-- ============================================================
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (
  deleted_at is null and board_id = any((select public.my_boards())::bigint[]) and (
    (select public.perm('see_all'))
    or ((select public.perm('see_late')) and stage in ('decision', 'done'))
    or rep_id = (select auth.uid()))
);

create or replace function public.can_see_invoice(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invoices i where i.id = p_id and i.deleted_at is null and public.in_board(i.board_id) and (
      public.perm('see_all')
      or (public.perm('see_late') and i.stage in ('decision', 'done'))
      or i.rep_id = auth.uid()))
$$;

create or replace function public.user_can_see_invoice(p_user uuid, p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invoices i join public.profiles p on p.id = p_user and p.active
     where i.id = p_id and i.deleted_at is null
       and ('admin' = any(p.roles)
            or exists (select 1 from public.board_members m where m.board_id = i.board_id and m.user_id = p_user))
       and (public.user_perm(p_user, 'see_all')
            or (public.user_perm(p_user, 'see_late') and i.stage in ('decision', 'done'))
            or i.rep_id = p_user))
$$;
revoke execute on function public.user_can_see_invoice(uuid, bigint) from public, anon, authenticated;

-- منو دوره بهاي المرحلة (المخزن: صاحب صلاحية التحويل اللي مو مدير)
create or replace function public.turn_users(p_stage text, p_sub text, p_rep uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_rep where p_rep is not null and (p_stage = 'new' or (p_stage = 'decision' and p_sub = 'cust'))
  union
  select p.id from public.profiles p
   where p.active and (
         (p_stage = 'acc' and public.role_perm(p.id, 'acc'))
      or (p_stage = 'decision' and p_sub = 'mgr' and public.role_perm(p.id, 'approve'))
      or (p_stage = 'decision' and p_sub = 'wh' and public.role_perm(p.id, 'complete')
          and not public.role_perm(p.id, 'approve')))
$$;
revoke execute on function public.turn_users(text, text, uuid) from public, anon, authenticated;

-- ============================================================
-- 4) الإنشاء والتعديل المباشر والملفات
-- ============================================================
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated with check (
  stage = 'new' and board_id = any((select public.my_boards())::bigint[]) and ((select public.has_role('admin'))
    or ((select public.perm('create')) and rep_id = (select auth.uid())))
);

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (board_id = any((select public.my_boards())::bigint[]) and ((select public.has_role('admin'))
    or ((select public.perm('create')) and rep_id = (select auth.uid()) and stage = 'new')
    or ((select public.perm('acc')) and stage = 'acc')))
  with check (board_id = any((select public.my_boards())::bigint[]) and ((select public.has_role('admin'))
    or ((select public.perm('create')) and rep_id = (select auth.uid()) and stage = 'new')
    or ((select public.perm('acc')) and stage = 'acc')));

create or replace function public.invoices_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  is_admin boolean := public.has_role('admin');
  can_basic boolean := is_admin or (public.perm('create') and old.rep_id = uid and old.stage = 'new');
  can_terms boolean := is_admin or (public.perm('acc') and old.stage = 'acc');
  k text;
  basic text[] := array['customer','customer_id','quote_no','res_no','value','pdf_path','pdf_name','pdf_size'];
  terms text[] := array['payment','credit_days','credit_months','payer','transport_amt','unload_amt',
                        'ld','ld_pct','ld_due','from_purch','exc','exc_reason','notes','points'];
  nums  text[] := array['value','credit_days','transport_amt','unload_amt','ld_pct','pdf_size','points','disc_pct'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;

  for k in
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
  loop
    if k in ('value', 'disc_req', 'disc_pct') then
      if not (can_basic or can_terms) then raise exception 'ما عندك صلاحية تعديل %', k; end if;
    elsif k = any(basic) then
      if not can_basic then raise exception 'ما عندك صلاحية تعديل %', k; end if;
    elsif k = any(terms) then
      if not can_terms then raise exception 'ما عندك صلاحية تعديل %', k; end if;
    elsif k = 'rep_id' then
      if not (is_admin and old.stage = 'new') then
        raise exception 'تغيير المندوب للأدمن فقط وبمرحلة الطلب الجديد'; end if;
    else
      raise exception 'الحقل % يتغير فقط عبر الإجراءات', k;
    end if;
    if k = any(nums) and coalesce((to_jsonb(new) ->> k)::numeric, 0) < 0 then
      raise exception 'القيمة % ما تكون سالبة', k; end if;
  end loop;

  if new.ld_pct is distinct from old.ld_pct and new.ld_pct > 100 then
    raise exception 'نسبة الخصم ما تتجاوز 100'; end if;
  if new.disc_pct is distinct from old.disc_pct and new.disc_pct > 100 then
    raise exception 'نسبة طلب الخصم ما تتجاوز 100'; end if;
  if (new.quote_no, new.res_no) is distinct from (old.quote_no, old.res_no)
     and btrim(coalesce(new.quote_no, '')) <> '' and btrim(coalesce(new.res_no, '')) <> '' then
    raise exception 'اكتب رقم عرض السعر أو رقم الحجز، مو الاثنين';
  end if;
  return new;
end $$;

drop policy if exists inv_files_upload on storage.objects;
create policy inv_files_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'invoices' and exists (
      select 1 from public.invoices i
      where i.id::text = (storage.foldername(name))[1]
        and (public.has_role('admin') or (public.perm('create') and i.rep_id = auth.uid() and i.stage = 'new'))
    )
  );

drop policy if exists inv_files_delete on storage.objects;
create policy inv_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'invoices' and (
      public.has_role('admin')
      -- الحذف النهائي من السلة يمسح الملف
      or (public.perm('trash') and exists (
            select 1 from public.invoices i where i.id::text = (storage.foldername(name))[1] and i.deleted_at is not null))
      or exists (
        select 1 from public.invoices i
        where i.id::text = (storage.foldername(name))[1]
          and public.perm('create') and i.rep_id = auth.uid() and i.stage = 'new')
      or (owner_id = auth.uid()::text and public.is_active() and not exists (
            select 1 from public.invoices i where i.id::text = (storage.foldername(name))[1]))
    )
  );

-- ============================================================
-- 5) الإجراءات
-- ============================================================
create or replace function public.inv_send_to_acc(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'new' then raise exception 'الطلب مو بمرحلة طلب جديد'; end if;
  if not (public.has_role('admin') or (public.perm('create') and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;

  if public.fld_req('customer') and v.customer_id is null then raise exception 'اختار الزبون من القائمة'; end if;
  if btrim(coalesce(v.quote_no,'')) <> '' and btrim(coalesce(v.res_no,'')) <> '' then
    raise exception 'اكتب رقم عرض السعر أو رقم الحجز (واحد منهم فقط)'; end if;
  if public.fld_req('ref') and btrim(coalesce(v.quote_no,'')) = '' and btrim(coalesce(v.res_no,'')) = '' then
    raise exception 'اكتب رقم عرض السعر أو رقم الحجز (واحد منهم فقط)'; end if;
  if public.fld_req('value') and coalesce(v.value, 0) <= 0 then raise exception 'قيمة الفاتورة مطلوبة'; end if;
  if public.fld_req('pdf') and v.pdf_path is null then raise exception 'ملف الـ PDF مطلوب'; end if;

  update public.invoices set stage='acc', sub=null, stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للحسابات');
  return v;
end $$;

create or replace function public.inv_send_to_decision(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'acc' then raise exception 'الطلب مو بمرحلة الحسابات'; end if;
  if not public.perm('acc') then raise exception 'ما عندك صلاحية'; end if;

  if public.fld_req('payment') and (v.payment is null or v.payment::text not in ('cash', 'credit')) then
    raise exception 'طريقة السداد: نقدي أو آجل'; end if;
  if v.payment::text = 'credit' and v.credit_months is null then
    raise exception 'حدد عدد أشهر الآجل'; end if;
  if public.fld_req('payer') and (v.payer is null or v.payer::text not in ('customer', 'none', 'company')) then
    raise exception 'حدد النقل: على الزبون أو بدون'; end if;
  if v.payer::text = 'customer' and coalesce(v.transport_amt, 0) <= 0 then
    raise exception 'اكتب مبلغ أجور النقل'; end if;
  if v.ld and (coalesce(v.ld_pct, 0) <= 0 or v.ld_pct > 100) then
    raise exception 'اكتب نسبة الخصم اللاحق'; end if;
  if public.fld_req('cost') and not v.cost_set then raise exception 'اكتب سعر الكلفة'; end if;

  update public.invoices set stage='decision', sub='mgr', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للقرار');
  return v;
end $$;

create or replace function public.inv_set_cost(p_id bigint, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices; had boolean;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if not (public.has_role('admin') or (public.perm('acc') and v.stage = 'acc')) then
    raise exception 'سعر الكلفة يكتبه المحاسب بمرحلة الحسابات'; end if;
  if coalesce(p_cost, 0) <= 0 then raise exception 'سعر الكلفة لازم أكبر من صفر'; end if;

  had := v.cost_set;
  insert into public.invoice_costs (invoice_id, cost, set_by, set_at) values (p_id, p_cost, auth.uid(), now())
  on conflict (invoice_id) do update set cost = excluded.cost, set_by = excluded.set_by, set_at = excluded.set_at;
  update public.invoices set cost_set = true where id = p_id;
  perform public.add_log(p_id, case when had then 'عدّل سعر الكلفة' else 'سجّل سعر الكلفة' end);
end $$;

create or replace function public.inv_return_to_rep(p_id bigint, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage::text <> 'acc' then raise exception 'الطلب مو بمرحلة الحسابات'; end if;
  if not public.perm('acc') then raise exception 'الإرجاع للمحاسب فقط'; end if;

  update public.invoices set stage = 'new', sub = null, stage_at = now(), returned = returned + 1
   where id = p_id returning * into v;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للمندوب' || coalesce(' — التعديلات المطلوبة: ' || nullif(btrim(coalesce(p_reason, '')), ''), ''), true, auth.uid());
  perform public.add_log(p_id, 'أرجع الطلب للمندوب');
  return v;
end $$;

create or replace function public.inv_approve(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'mgr' then raise exception 'الطلب مو بانتظار موافقة المدير'; end if;
  if not public.perm('approve') then raise exception 'الموافقة للمدير فقط'; end if;

  update public.invoices set sub='cust', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'وافق المدير على الشروط');
  return v;
end $$;

create or replace function public.inv_return_to_acc(p_id bigint, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'mgr' then raise exception 'الطلب مو بانتظار موافقة المدير'; end if;
  if not public.perm('approve') then raise exception 'الإرجاع للمدير فقط'; end if;

  update public.invoices set stage='acc', sub=null, stage_at=now(), returned = returned + 1
   where id=p_id returning * into v;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للحسابات' || coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''), true, auth.uid());
  perform public.add_log(p_id, 'أرجع الطلب للحسابات');
  return v;
end $$;

create or replace function public.inv_customer_accept(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'cust' then raise exception 'الطلب مو بانتظار رد الزبون'; end if;
  if not (public.perm('cust_all') or (public.perm('create') and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;

  update public.invoices set sub='wh', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أكد موافقة الزبون');
  return v;
end $$;

create or replace function public.inv_customer_refuse(p_id bigint, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'cust' then raise exception 'الطلب مو بانتظار رد الزبون'; end if;
  if not (public.perm('cust_all') or (public.perm('create') and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'سبب الرفض مطلوب'; end if;

  update public.invoices set stage='cancel', sub=null, cancel_reason=p_reason, stage_at=now(), closed_at=now()
   where id=p_id returning * into v;
  perform public.add_log(p_id, 'سجل رفض الزبون وألغى الطلب');
  return v;
end $$;

create or replace function public.inv_complete(p_id bigint, p_sales_no text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'wh' then raise exception 'الطلب مو بانتظار المخزن'; end if;
  if not public.perm('complete') then raise exception 'التحويل للمخزن أو المدير'; end if;
  if btrim(coalesce(p_sales_no,'')) = '' then raise exception 'رقم المبيعات مطلوب'; end if;

  update public.invoices set stage='done', sub=null, sales_no=btrim(p_sales_no), stage_at=now(), closed_at=now()
   where id=p_id returning * into v;
  perform public.add_log(p_id, 'حول الطلب لمبيعات برقم ' || btrim(p_sales_no));
  return v;
end $$;

create or replace function public.inv_move(p_id bigint, p_target text, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare
  v public.invoices;
  t_stage text := split_part(coalesce(p_target, ''), ':', 1);
  t_sub text := nullif(split_part(coalesce(p_target, ''), ':', 2), '');
  ord_from int; ord_to int;
  names jsonb := '{"new":"طلب جديد","acc":"الحسابات","decision:mgr":"موافقة المدير","decision:cust":"رد الزبون","decision:wh":"المخزن","cancel":"ملغاة","done":"تمت"}';
  from_key text;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.perm('move') then raise exception 'ما عندك صلاحية نقل الطلب'; end if;
  if p_target not in ('new', 'acc', 'decision:mgr', 'decision:cust', 'decision:wh', 'cancel') then
    raise exception 'مرحلة غير معروفة'; end if;

  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  from_key := v.stage::text || coalesce(':' || v.sub::text, '');
  if from_key = p_target then raise exception 'الطلب أصلاً بهاي المرحلة'; end if;

  ord_from := case from_key when 'new' then 1 when 'acc' then 2 when 'decision:mgr' then 3
                when 'decision:cust' then 4 when 'decision:wh' then 5 else 0 end;
  ord_to := case p_target when 'new' then 1 when 'acc' then 2 when 'decision:mgr' then 3
                when 'decision:cust' then 4 when 'decision:wh' then 5 else 6 end;

  update public.invoices set
      stage = t_stage::public.inv_stage, sub = t_sub::public.inv_sub, stage_at = now(),
      returned = returned + case when ord_to < ord_from then 1 else 0 end,
      cancel_reason = case when t_stage = 'cancel' then btrim(coalesce(p_reason, '')) else '' end,
      closed_at = case when t_stage = 'cancel' then now() else null end,
      sales_no = case when v.stage::text = 'done' then '' else sales_no end
   where id = p_id returning * into v;

  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'نقل من ' || coalesce(names ->> from_key, from_key) || ' إلى ' || (names ->> p_target)
          || coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
          true, auth.uid());
  perform public.add_log(p_id, 'نقل الطلب إلى ' || (names ->> p_target));
  return v;
end $$;

create or replace function public.inv_set_urgent(p_id bigint, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v.stage::text not in ('new', 'acc', 'decision') then raise exception 'الطلب مغلق'; end if;
  if not (public.perm('urgent_all') or (public.perm('create') and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;
  if v.urgent = coalesce(p_on, false) then return; end if;
  update public.invoices set urgent = coalesce(p_on, false) where id = p_id;
  perform public.add_log(p_id, case when p_on then 'أشّر الطلب طارئ' else 'شال علامة طارئ' end);
end $$;

-- الربح: صاحب see_profit من مرحلة القرار وبعدها (الأدمن: كلها)
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
          or (public.perm('see_profit') and p.stage in ('decision', 'done', 'cancel')))
$$;

-- ============================================================
-- 6) سلة المحذوفات
-- ============================================================
create or replace function public.inv_delete(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.perm('trash') then raise exception 'ما عندك صلاحية الحذف'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null or v.deleted_at is not null or not public.in_board(v.board_id) then raise exception 'الطلب غير موجود'; end if;
  update public.invoices set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  perform public.add_log(p_id, 'نقل الطلب لسلة المحذوفات');
  return null;
end $$;

create or replace function public.inv_restore(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.perm('trash') then raise exception 'ما عندك صلاحية الاسترجاع'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null or v.deleted_at is null or not public.in_board(v.board_id) then raise exception 'الطلب مو بسلة المحذوفات'; end if;
  update public.invoices
     set deleted_at = null, deleted_by = null, delete_req_by = null, delete_req_at = null, delete_req_reason = null
   where id = p_id;
  perform public.add_log(p_id, 'رجع الطلب من سلة المحذوفات');
end $$;

create or replace function public.inv_purge(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare path text;
begin
  if not public.perm('trash') then raise exception 'ما عندك صلاحية الحذف'; end if;
  select pdf_path into path from public.invoices where id = p_id and deleted_at is not null and public.in_board(board_id);
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
  if not public.perm('trash') then raise exception 'ما عندك صلاحية سلة المحذوفات'; end if;
  return query select * from public.invoices
    where deleted_at is not null and public.in_board(board_id) order by deleted_at desc;
end $$;

-- ============================================================
-- 7) الزبائن
-- ============================================================
drop policy if exists customers_admin_ins on public.customers;
create policy customers_admin_ins on public.customers for insert to authenticated with check ((select public.perm('customers')));
drop policy if exists customers_admin_upd on public.customers;
create policy customers_admin_upd on public.customers for update to authenticated
  using ((select public.perm('customers'))) with check ((select public.perm('customers')));
drop policy if exists customers_admin_del on public.customers;
create policy customers_admin_del on public.customers for delete to authenticated using ((select public.perm('customers')));

-- ============================================================
-- 8) المستخدمين: صاحب صلاحية users (غير الأدمن) ما يلمس الأدمن
-- ============================================================
drop policy if exists board_members_admin_ins on public.board_members;
create policy board_members_admin_ins on public.board_members for insert to authenticated with check (
  (select public.has_role('admin')) or ((select public.perm('users')) and user_id <> (select auth.uid())));
drop policy if exists board_members_admin_del on public.board_members;
create policy board_members_admin_del on public.board_members for delete to authenticated using (
  (select public.has_role('admin')) or ((select public.perm('users')) and user_id <> (select auth.uid())));

drop function if exists public.admin_create_user(text, text, text, public.app_role[], bigint[]);
create or replace function public.admin_create_user(
  p_username text, p_password text, p_full_name text, p_roles public.app_role[],
  p_boards bigint[] default null, p_xroles text[] default '{}')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := gen_random_uuid();
  em  text := public.admin_login_email(p_username);
begin
  if not public.perm('users') then raise exception 'ما عندك صلاحية إضافة حسابات'; end if;
  if 'admin' = any(coalesce(p_roles, '{}')) and not public.has_role('admin') then
    raise exception 'دور الأدمن ينطيه الأدمن بس'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'الرمز لازم 8 أحرف على الأقل'; end if;
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'الاسم الكامل مطلوب'; end if;
  if coalesce(cardinality(p_roles), 0) + coalesce(cardinality(p_xroles), 0) = 0 then
    raise exception 'اختار دور واحد على الأقل'; end if;
  if exists (select 1 from unnest(coalesce(p_xroles, '{}')) x where not exists (select 1 from public.role_defs d where d.key = x)) then
    raise exception 'دور غير معروف'; end if;
  if exists (select 1 from auth.users where lower(email) = em) then
    raise exception 'اسم المستخدم موجود، اختار غيره'; end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token)
  values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', btrim(p_full_name)), now(), now(),
    '', '', '', '', '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
          'email', now(), now(), now());

  -- بدون دور أساسي: "مندوب" يبقى بـ roles للتوافق، بس صلاحياته تجي من الأدوار الإضافية
  insert into public.profiles (id, full_name, roles, xroles, active)
  values (uid, btrim(p_full_name), coalesce(p_roles, '{}'), coalesce(p_xroles, '{}'), true)
  on conflict (id) do update set full_name = excluded.full_name, roles = excluded.roles, xroles = excluded.xroles, active = true;

  insert into public.board_members (board_id, user_id)
  select b.id, uid from public.boards b
   where b.id = any(case when coalesce(cardinality(p_boards), 0) = 0 then array[1::bigint] else p_boards end)
  on conflict do nothing;
  return uid;
end $$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.perm('users') then raise exception 'ما عندك صلاحية'; end if;
  if not public.has_role('admin') and exists (select 1 from public.profiles where id = p_user and 'admin' = any(roles)) then
    raise exception 'رمز الأدمن يغيره الأدمن بس'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'الرمز لازم 8 أحرف على الأقل'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then raise exception 'المستخدم غير موجود'; end if;
  if p_user <> auth.uid() then delete from auth.sessions where user_id = p_user; end if;
end $$;

create or replace function public.admin_list_logins()
returns table (id uuid, login text) language sql stable security definer set search_path = public as $$
  select u.id, replace(u.email, '@invoices.local', '')
  from auth.users u where public.perm('users')
$$;

create or replace function public.set_avatar(p_user uuid, p_avatar text)
returns void language plpgsql security definer set search_path = public as $$
declare a text := nullif(btrim(coalesce(p_avatar, '')), '');
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if p_user is distinct from auth.uid() and not public.perm('users') then raise exception 'ما عندك صلاحية'; end if;
  if a is not null and a !~ '^((people|pixel|robot|animal|space)-(10|[1-9])|[mf]([1-9]|1[0-2]))$' then
    raise exception 'صورة غير معروفة';
  end if;
  update public.profiles set avatar = a,
    avatar_chosen = case when p_user = auth.uid() then true else avatar_chosen end
    where id = p_user;
  if not found then raise exception 'المستخدم غير موجود'; end if;
end $$;

-- ============================================================
-- 9) التقارير
-- ============================================================
create or replace function public.report_summary(p_from date, p_to date, p_board bigint default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.perm('reports') then raise exception 'ما عندك صلاحية التقارير'; end if;
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
-- 10) صلاحيات الدوال
-- ============================================================
revoke execute on function public.role_perm(uuid, text), public.user_perm(uuid, text) from public, anon, authenticated;
revoke execute on function public.perm(text), public.fld_req(text) from public, anon;
grant execute on function public.perm(text), public.fld_req(text) to authenticated;
revoke execute on function public.admin_create_user(text, text, text, public.app_role[], bigint[], text[]) from public, anon;
grant execute on function public.admin_create_user(text, text, text, public.app_role[], bigint[], text[]) to authenticated;

commit;

notify pgrst, 'reload schema';
