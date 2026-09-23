-- ============================================================
-- 004: قواعد الشغل الجديدة
--   • أكثر من دور للمستخدم (مثلاً مندوب + محاسب)
--   • الحذف للأدمن فقط + طلبات حذف
--   • رقم عرض السعر أو رقم الحجز (واحد فقط)
--   • المحاسب: نقدي/آجل (1-3 أشهر)، التوصيل، النقاط، سعر الكلفة (مخفي)، الخصم اللاحق
--   • الربح وصافي الربح (للأدمن والمدير)
--   • جدول الزبائن
--   • سجل تغيير الحقول + سجل المراحل (للتقارير)
--   • تقرير ملخص
-- شغّله مرة وحدة بـ SQL Editor. كله داخل transaction.
-- ============================================================
begin;

-- ============================================================
-- 1) أكثر من دور للمستخدم
-- ============================================================
alter table public.profiles add column if not exists roles public.app_role[] not null default '{}';
update public.profiles set roles = array[role] where cardinality(roles) = 0 and role is not null;

-- role يبقى "الدور الأعلى" للعرض والتوافق؛ roles هو المرجع
create or replace function public.profiles_roles_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role and new.roles is not distinct from old.roles then
    new.roles := array[new.role];
  end if;
  if new.roles is null or cardinality(new.roles) = 0 then
    new.roles := array[coalesce(new.role, 'rep'::public.app_role)];
  end if;
  new.roles := array(select distinct x from unnest(new.roles) x order by x);
  new.role := case
    when 'admin' = any(new.roles) then 'admin'
    when 'mgr'   = any(new.roles) then 'mgr'
    when 'acc'   = any(new.roles) then 'acc'
    when 'wh'    = any(new.roles) then 'wh'
    else 'rep' end;
  return new;
end $$;
drop trigger if exists profiles_roles_sync_trg on public.profiles;
create trigger profiles_roles_sync_trg before insert or update on public.profiles
  for each row execute function public.profiles_roles_sync();

create or replace function public.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and r = any(roles))
$$;

create or replace function public.my_roles()
returns public.app_role[] language sql stable security definer set search_path = public as $$
  select roles from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin')
$$;

-- ============================================================
-- 2) أعمدة جديدة
-- ============================================================
create table if not exists public.customers (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  phone text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists customers_name_uniq on public.customers (lower(btrim(name)));

alter table public.invoices
  add column if not exists points numeric not null default 0,
  add column if not exists credit_months smallint,
  add column if not exists customer_id bigint references public.customers (id) on delete set null,
  add column if not exists cost_set boolean not null default false,
  add column if not exists delete_req_by uuid,
  add column if not exists delete_req_at timestamptz,
  add column if not exists delete_req_reason text;

alter table public.invoices drop constraint if exists invoices_points_chk;
alter table public.invoices add constraint invoices_points_chk check (points >= 0 and points <= 100);
alter table public.invoices drop constraint if exists invoices_credit_months_chk;
alter table public.invoices add constraint invoices_credit_months_chk check (credit_months is null or credit_months between 1 and 3);

-- الأعمدة اللي المستخدم يعدلها مباشرة (الباقي عبر الدوال فقط)
grant update (points, credit_months, customer_id) on public.invoices to authenticated;

-- سعر الكلفة بجدول منفصل: محد يقراه غير الأدمن
create table if not exists public.invoice_costs (
  invoice_id bigint primary key references public.invoices (id) on delete cascade,
  cost numeric not null check (cost > 0),
  set_by uuid,
  set_at timestamptz not null default now()
);
alter table public.invoice_costs enable row level security;
revoke all on public.invoice_costs from anon, authenticated;
grant select on public.invoice_costs to authenticated;
drop policy if exists costs_admin_read on public.invoice_costs;
create policy costs_admin_read on public.invoice_costs for select to authenticated
  using ((select public.has_role('admin')));

-- ============================================================
-- 3) الزبائن: الكل يقرأ (للبحث)، الأدمن يضيف ويعدل
-- ============================================================
alter table public.customers enable row level security;
revoke all on public.customers from anon;
grant select, insert, update, delete on public.customers to authenticated;
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated using ((select public.is_active()));
drop policy if exists customers_admin_ins on public.customers;
create policy customers_admin_ins on public.customers for insert to authenticated with check ((select public.has_role('admin')));
drop policy if exists customers_admin_upd on public.customers;
create policy customers_admin_upd on public.customers for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
drop policy if exists customers_admin_del on public.customers;
create policy customers_admin_del on public.customers for delete to authenticated using ((select public.has_role('admin')));

-- اختيار الزبون من القائمة يكتب اسمه بالطلب
create or replace function public.invoices_customer_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    select name into new.customer from public.customers where id = new.customer_id;
  end if;
  return new;
end $$;
drop trigger if exists invoices_customer_sync_trg on public.invoices;
create trigger invoices_customer_sync_trg before insert or update of customer_id on public.invoices
  for each row execute function public.invoices_customer_sync();

-- ============================================================
-- 4) سياسات الطلبات والملفات (تدعم أكثر من دور)
-- ============================================================
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (
  (select public.has_role('admin')) or (select public.has_role('mgr')) or (select public.has_role('acc'))
  or ((select public.has_role('wh')) and stage in ('decision', 'done'))
  or ((select public.has_role('rep')) and rep_id = (select auth.uid()))
);

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated with check (
  stage = 'new' and ((select public.has_role('admin'))
    or ((select public.has_role('rep')) and rep_id = (select auth.uid())))
);

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using ((select public.has_role('admin'))
    or ((select public.has_role('rep')) and rep_id = (select auth.uid()) and stage = 'new')
    or ((select public.has_role('acc')) and stage = 'acc'))
  with check ((select public.has_role('admin'))
    or ((select public.has_role('rep')) and rep_id = (select auth.uid()) and stage = 'new')
    or ((select public.has_role('acc')) and stage = 'acc'));

-- الحذف للأدمن فقط
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices for delete to authenticated using ((select public.has_role('admin')));

drop policy if exists inv_files_upload on storage.objects;
create policy inv_files_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'invoices' and exists (
      select 1 from public.invoices i
      where i.id::text = (storage.foldername(name))[1]
        and (public.has_role('admin') or (public.has_role('rep') and i.rep_id = auth.uid() and i.stage = 'new'))
    )
  );

drop policy if exists inv_files_delete on storage.objects;
create policy inv_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'invoices' and (
      public.has_role('admin')
      or exists (
        select 1 from public.invoices i
        where i.id::text = (storage.foldername(name))[1]
          and public.has_role('rep') and i.rep_id = auth.uid() and i.stage = 'new')
      or (owner_id = auth.uid()::text and public.is_active() and not exists (
            select 1 from public.invoices i where i.id::text = (storage.foldername(name))[1]))
    )
  );

-- نفس منطق invoices_read — للدوال اللي تشتغل كـ definer
create or replace function public.can_see_invoice(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invoices i where i.id = p_id and (
      public.has_role('admin') or public.has_role('mgr') or public.has_role('acc')
      or (public.has_role('wh') and i.stage in ('decision', 'done'))
      or (public.has_role('rep') and i.rep_id = auth.uid())))
$$;

-- ============================================================
-- 5) حارس التعديل المباشر
-- ============================================================
create or replace function public.invoices_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  is_admin boolean := public.has_role('admin');
  can_basic boolean := is_admin or (public.has_role('rep') and old.rep_id = uid and old.stage = 'new');
  can_terms boolean := is_admin or (public.has_role('acc') and old.stage = 'acc');
  k text;
  basic text[] := array['customer','customer_id','quote_no','res_no','value','pdf_path','pdf_name','pdf_size'];
  terms text[] := array['payment','credit_days','credit_months','payer','transport_amt','unload_amt',
                        'ld','ld_pct','ld_due','from_purch','exc','exc_reason','notes','points'];
  nums  text[] := array['value','credit_days','transport_amt','unload_amt','ld_pct','pdf_size','points'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;

  for k in
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
  loop
    if k = any(basic) then
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
  if (new.quote_no, new.res_no) is distinct from (old.quote_no, old.res_no)
     and btrim(coalesce(new.quote_no, '')) <> '' and btrim(coalesce(new.res_no, '')) <> '' then
    raise exception 'اكتب رقم عرض السعر أو رقم الحجز، مو الاثنين';
  end if;
  return new;
end $$;

-- ============================================================
-- 6) سجل تغيير الحقول (منو غيّر شنو، من شكد إلى شكد)
-- ============================================================
create or replace function public.inv_fmt(k text, v jsonb)
returns text language sql stable security definer set search_path = public as $$
  select case
    when v is null or v = 'null'::jsonb or v #>> '{}' = '' then '—'
    when k = 'payment' then coalesce(case v #>> '{}' when 'cash' then 'نقدي' when 'credit' then 'آجل'
                                     when 'cheque' then 'صك' when 'transfer' then 'تحويل' end, v #>> '{}')
    when k = 'payer' then coalesce(case v #>> '{}' when 'customer' then 'على الزبون'
                                   when 'company' then 'على الشركة' when 'none' then 'بدون' end, v #>> '{}')
    when k = 'rep_id' then coalesce((select full_name from public.profiles where id = (v #>> '{}')::uuid), '—')
    when jsonb_typeof(v) = 'boolean' then case when v = 'true'::jsonb then 'نعم' else 'لا' end
    when jsonb_typeof(v) = 'number' then rtrim(to_char((v #>> '{}')::numeric, 'FM999,999,999,999,990.##'), '.')
    else left(v #>> '{}', 80)
  end
$$;

create or replace function public.invoices_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  labels jsonb := '{"customer":"الزبون","quote_no":"رقم عرض السعر","res_no":"رقم الحجز","value":"القيمة",
    "rep_id":"المندوب","pdf_name":"ملف PDF","payment":"طريقة السداد","credit_months":"أشهر الآجل",
    "payer":"التوصيل","transport_amt":"أجور النقل","unload_amt":"أجور التفريغ","ld":"خصم لاحق",
    "ld_pct":"نسبة الخصم اللاحق","points":"النقاط","notes":"الملاحظات"}';
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
  body text;
begin
  select string_agg((labels ->> k) || ': ' || public.inv_fmt(k, o -> k) || ' ← ' || public.inv_fmt(k, n -> k), '، ')
    into body
    from jsonb_object_keys(labels) k
   where (o -> k) is distinct from (n -> k);
  if body is not null then
    insert into public.invoice_log (invoice_id, actor, body) values (new.id, auth.uid(), 'عدّل ' || body);
  end if;
  return null;
end $$;
drop trigger if exists invoices_history_trg on public.invoices;
create trigger invoices_history_trg after update on public.invoices
  for each row execute function public.invoices_history();

-- ============================================================
-- 7) سجل المراحل (حتى نحسب كم يوم يقعد الطلب بكل مرحلة)
-- ============================================================
create table if not exists public.invoice_stage_log (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices (id) on delete cascade,
  stage text not null,
  sub text,
  at timestamptz not null default now()
);
create index if not exists invoice_stage_log_inv on public.invoice_stage_log (invoice_id, at);
alter table public.invoice_stage_log enable row level security;
revoke all on public.invoice_stage_log from anon, authenticated;
grant select on public.invoice_stage_log to authenticated;
drop policy if exists stage_log_read on public.invoice_stage_log;
create policy stage_log_read on public.invoice_stage_log for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_stage_log.invoice_id));

create or replace function public.invoices_stage_track()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage or new.sub is distinct from old.sub then
    insert into public.invoice_stage_log (invoice_id, stage, sub, at)
    values (new.id, new.stage::text, new.sub::text, coalesce(new.stage_at, now()));
  end if;
  return null;
end $$;
drop trigger if exists invoices_stage_track_trg on public.invoices;
create trigger invoices_stage_track_trg after insert or update of stage, sub on public.invoices
  for each row execute function public.invoices_stage_track();

-- تعبئة تقريبية للطلبات الموجودة
insert into public.invoice_stage_log (invoice_id, stage, sub, at)
select i.id, 'new', null, i.created_at from public.invoices i
 where not exists (select 1 from public.invoice_stage_log s where s.invoice_id = i.id);
insert into public.invoice_stage_log (invoice_id, stage, sub, at)
select i.id, i.stage::text, i.sub::text, i.stage_at from public.invoices i
 where i.stage <> 'new' and (select count(*) from public.invoice_stage_log s where s.invoice_id = i.id) = 1;

-- ============================================================
-- 8) دوال الإجراءات (أكثر من دور + القواعد الجديدة)
-- ============================================================
create or replace function public.inv_send_to_acc(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'new' then raise exception 'الطلب مو بمرحلة طلب جديد'; end if;
  if not (public.has_role('admin') or (public.has_role('rep') and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;

  if v.customer_id is null then raise exception 'اختار الزبون من القائمة'; end if;
  if (btrim(coalesce(v.quote_no,'')) = '') = (btrim(coalesce(v.res_no,'')) = '') then
    raise exception 'اكتب رقم عرض السعر أو رقم الحجز (واحد منهم فقط)'; end if;
  if coalesce(v.value, 0) <= 0 then raise exception 'قيمة الفاتورة مطلوبة'; end if;
  if v.pdf_path is null then raise exception 'ملف الـ PDF مطلوب'; end if;

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
  if not (public.has_role('acc') or public.has_role('admin')) then raise exception 'ما عندك صلاحية'; end if;

  if v.payment is null or v.payment::text not in ('cash', 'credit') then
    raise exception 'طريقة السداد: نقدي أو آجل'; end if;
  if v.payment::text = 'credit' and v.credit_months is null then
    raise exception 'حدد عدد أشهر الآجل'; end if;
  if v.payer is null or v.payer::text not in ('customer', 'company') then
    raise exception 'حدد التوصيل: على الزبون أو على الشركة'; end if;
  if v.payer::text = 'customer' and coalesce(v.transport_amt, 0) <= 0 then
    raise exception 'اكتب مبلغ أجور النقل'; end if;
  if v.ld and (coalesce(v.ld_pct, 0) <= 0 or v.ld_pct > 100) then
    raise exception 'اكتب نسبة الخصم اللاحق'; end if;
  if not v.cost_set then raise exception 'اكتب سعر الكلفة'; end if;

  update public.invoices set stage='decision', sub='mgr', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للقرار');
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
  if not (public.has_role('mgr') or public.has_role('admin')) then raise exception 'الموافقة للمدير فقط'; end if;

  update public.invoices set sub='cust', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'وافق المدير على الشروط');
  return v;
end $$;

create or replace function public.inv_return_to_acc(p_id bigint, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'mgr' then raise exception 'الطلب مو بانتظار موافقة المدير'; end if;
  if not (public.has_role('mgr') or public.has_role('admin')) then raise exception 'الإرجاع للمدير فقط'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'سبب الإرجاع مطلوب'; end if;

  update public.invoices set stage='acc', sub=null, stage_at=now(), returned = returned + 1
   where id=p_id returning * into v;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للحسابات: ' || p_reason, true, auth.uid());
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
  if not (public.has_role('mgr') or public.has_role('admin') or (public.has_role('rep') and v.rep_id = auth.uid())) then
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
  if not (public.has_role('mgr') or public.has_role('admin') or (public.has_role('rep') and v.rep_id = auth.uid())) then
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
  if not (public.has_role('wh') or public.has_role('mgr') or public.has_role('admin')) then
    raise exception 'التحويل للمخزن أو المدير'; end if;
  if btrim(coalesce(p_sales_no,'')) = '' then raise exception 'رقم المبيعات مطلوب'; end if;

  update public.invoices set stage='done', sub=null, sales_no=btrim(p_sales_no), stage_at=now(), closed_at=now()
   where id=p_id returning * into v;
  perform public.add_log(p_id, 'حول الطلب لمبيعات برقم ' || btrim(p_sales_no));
  return v;
end $$;

-- ---------- سعر الكلفة: المحاسب يكتبه ومحد يشوفه غير الأدمن ----------
create or replace function public.inv_set_cost(p_id bigint, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices; had boolean;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if not (public.has_role('admin') or (public.has_role('acc') and v.stage = 'acc')) then
    raise exception 'سعر الكلفة يكتبه المحاسب بمرحلة الحسابات'; end if;
  if coalesce(p_cost, 0) <= 0 then raise exception 'سعر الكلفة لازم أكبر من صفر'; end if;

  had := v.cost_set;
  insert into public.invoice_costs (invoice_id, cost, set_by, set_at) values (p_id, p_cost, auth.uid(), now())
  on conflict (invoice_id) do update set cost = excluded.cost, set_by = excluded.set_by, set_at = excluded.set_at;
  update public.invoices set cost_set = true where id = p_id;
  perform public.add_log(p_id, case when had then 'عدّل سعر الكلفة' else 'سجّل سعر الكلفة' end);
end $$;

-- ---------- الربح ----------
-- الإجمالي = القيمة + النقل (إذا على الزبون)
-- الربح % = (1 − الكلفة ÷ الإجمالي) × 100
-- الصافي % = الربح − نسبة الخصم اللاحق − (النقاط × 1.5)
create or replace function public.inv_profit_rows()
returns table (invoice_id bigint, stage text, total numeric, gross_pct numeric, net_pct numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.stage::text, t.total,
         round((1 - c.cost / nullif(t.total, 0)) * 100, 2),
         round((1 - c.cost / nullif(t.total, 0)) * 100
               - case when i.ld then coalesce(i.ld_pct, 0) else 0 end
               - coalesce(i.points, 0) * 1.5, 2)
    from public.invoices i
    join public.invoice_costs c on c.invoice_id = i.id
    cross join lateral (select coalesce(i.value, 0)
      + case when i.payer::text = 'customer' then coalesce(i.transport_amt, 0) else 0 end as total) t
$$;
revoke execute on function public.inv_profit_rows() from public, anon, authenticated;

-- الأدمن: كل الطلبات. المدير: من مرحلة القرار وبعدها (بدون سعر الكلفة)
create or replace function public.inv_profits(p_ids bigint[] default null)
returns table (invoice_id bigint, total numeric, gross_pct numeric, net_pct numeric)
language sql stable security definer set search_path = public as $$
  select p.invoice_id, p.total, p.gross_pct, p.net_pct
    from public.inv_profit_rows() p
   where (p_ids is null or p.invoice_id = any(p_ids))
     and (public.has_role('admin')
          or (public.has_role('mgr') and p.stage in ('decision', 'done', 'cancel')))
$$;

-- ---------- الحذف وطلبات الحذف ----------
create or replace function public.inv_request_delete(p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الحذف مطلوب'; end if;
  update public.invoices
     set delete_req_by = auth.uid(), delete_req_at = now(), delete_req_reason = btrim(p_reason)
   where id = p_id and delete_req_at is null;
  if not found then raise exception 'أكو طلب حذف سابق على هذا الطلب'; end if;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'طلب حذف: ' || btrim(p_reason), true, auth.uid());
  perform public.add_log(p_id, 'طلب حذف الطلب');
end $$;

create or replace function public.inv_cancel_delete_request(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null or v.delete_req_at is null then raise exception 'ماكو طلب حذف'; end if;
  if not (public.has_role('admin') or v.delete_req_by = auth.uid()) then raise exception 'ما عندك صلاحية'; end if;
  update public.invoices set delete_req_by = null, delete_req_at = null, delete_req_reason = null where id = p_id;
  perform public.add_log(p_id, case when public.has_role('admin') and v.delete_req_by <> auth.uid()
                                    then 'رفض الأدمن طلب الحذف' else 'ألغى طلب الحذف' end);
end $$;

-- يرجّع مسار الـ PDF حتى الواجهة تمسح الملف من التخزين
create or replace function public.inv_delete(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare path text;
begin
  if not public.has_role('admin') then raise exception 'الحذف للأدمن فقط'; end if;
  select pdf_path into path from public.invoices where id = p_id;
  if not found then raise exception 'الطلب غير موجود'; end if;
  delete from public.invoice_comments where invoice_id = p_id;
  delete from public.invoice_log where invoice_id = p_id;
  delete from public.invoice_stage_log where invoice_id = p_id;
  delete from public.invoice_costs where invoice_id = p_id;
  delete from public.invoices where id = p_id;
  return path;
end $$;

-- ============================================================
-- 9) إدارة المستخدمين: أكثر من دور
-- ============================================================
drop function if exists public.admin_create_user(text, text, text, public.app_role);
create or replace function public.admin_create_user(
  p_username text, p_password text, p_full_name text, p_roles public.app_role[])
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := gen_random_uuid();
  em  text := public.admin_login_email(p_username);
begin
  if not public.has_role('admin') then raise exception 'للأدمن فقط'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'الرمز لازم 8 أحرف على الأقل'; end if;
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'الاسم الكامل مطلوب'; end if;
  if coalesce(cardinality(p_roles), 0) = 0 then raise exception 'اختار دور واحد على الأقل'; end if;
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

  insert into public.profiles (id, full_name, roles, active)
  values (uid, btrim(p_full_name), p_roles, true)
  on conflict (id) do update set full_name = excluded.full_name, roles = excluded.roles, active = true;
  return uid;
end $$;

-- ============================================================
-- 10) تقرير ملخص (الأدمن والمدير)
-- ============================================================
create or replace function public.report_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not (public.has_role('admin') or public.has_role('mgr')) then raise exception 'التقارير للأدمن والمدير'; end if;

  with inv as (
    select i.*, p.net_pct
      from public.invoices i
      left join public.inv_profit_rows() p on p.invoice_id = i.id
     where i.created_at >= p_from and i.created_at < (p_to + 1)
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

  -- المدير يشوف نسب الربح بس، والأدمن نفس الشي هنا (الكلفة ما تطلع بالتقرير)
  return res;
end $$;

-- ============================================================
-- 11) الصلاحيات على الدوال الجديدة
-- ============================================================
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.add_log(bigint, text) from authenticated;
revoke execute on function public.inv_profit_rows() from authenticated;
revoke execute on function public.profiles_kick_inactive() from authenticated;
revoke execute on function public.admin_login_email(text) from authenticated;

commit;
