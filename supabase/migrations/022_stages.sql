-- 022: مراحل الطلب يتحكم بيها الأدمن من الإعدادات
--   • app_settings.stages: خطوات مرحلة القرار بالترتيب (JSON) — كل خطوة: k المفتاح، n الاسم، on مفعّلة؟، back يرجع للحسابات؟
--     الأساسية: mgr (موافقة المدير)، cust (رد الزبون)، wh (المخزن) — تنطفي بس ما تنحذف
--     الإضافية: s_xxxx (مثل التدقيق) — الأدمن يضيفها ويحذفها، وصلاحيتها بنفس مفتاحها (تنعطى للأدوار من الصلاحيات)
--   • invoices.sub صار text حتى يقبل الخطوات الإضافية
--   • كل إجراء ينقل الطلب للخطوة المفعّلة اللي بعدها (stage_next)، وإذا ماكو يكتمل الطلب
--   • inv_step_pass / inv_step_back: إجراءات الخطوات الإضافية. stage_counts: عدد الطلبات بكل خطوة (للأدمن)
-- بدون إعداد = نفس السلوك القديم بالضبط (المدير ← الزبون ← المخزن). يتشغل بعد 021. آمن للتشغيل أكثر من مرة.
begin;

-- ============================================================
-- 1) invoices.sub نص بدل enum (التريغرات اللي على العمود تنشال وترجع)
-- ============================================================
drop trigger if exists invoices_stage_track_trg on public.invoices;
drop trigger if exists notify_stage_change_trg on public.invoices;
alter table public.invoices alter column sub type text using sub::text;
alter table public.invoices drop constraint if exists invoices_sub_chk;
alter table public.invoices add constraint invoices_sub_chk check (sub is null or sub ~ '^(mgr|cust|wh|s_[a-z0-9]{1,20})$');
create trigger invoices_stage_track_trg after insert or update of stage, sub on public.invoices
  for each row execute function public.invoices_stage_track();
create trigger notify_stage_change_trg after update of stage, sub on public.invoices
  for each row execute function public.notify_stage_change();

-- ============================================================
-- 2) قائمة الخطوات
-- ============================================================
create or replace function public.stage_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select value::jsonb from public.app_settings where key = 'stages'),
    '[{"k":"mgr","on":true},{"k":"cust","on":true},{"k":"wh","on":true}]'::jsonb)
$$;

-- الخطوة المفعّلة اللي بعد p_cur (null = أول خطوة). null = ماكو ← الطلب يكتمل
create or replace function public.stage_next(p_cur text)
returns text language sql stable security definer set search_path = public as $$
  with s as (
    select e ->> 'k' as k, coalesce((e ->> 'on')::boolean, true) as on_, o
      from jsonb_array_elements(public.stage_list()) with ordinality t(e, o))
  select k from s
   where on_ and o > coalesce((select o from s where k = p_cur), 0)
   order by o limit 1
$$;

create or replace function public.stage_name(p_k text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(e ->> 'n'), '') from jsonb_array_elements(public.stage_list()) e where e ->> 'k' = p_k),
    case p_k when 'mgr' then 'موافقة المدير' when 'cust' then 'رد الزبون' when 'wh' then 'المخزن' else p_k end)
$$;

create or replace function public.stage_back_ok(p_k text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (e ->> 'back')::boolean from jsonb_array_elements(public.stage_list()) e where e ->> 'k' = p_k), false)
$$;

-- فحص إعداد المراحل قبل الحفظ + ما تنحذف خطوة بيها طلبات شغالة
create or replace function public.app_settings_stages_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j jsonb; e jsonb; keys text[] := '{}'; k text; gone text; n bigint;
begin
  if new.key <> 'stages' then return new; end if;
  begin j := new.value::jsonb; exception when others then raise exception 'إعداد المراحل غير صالح'; end;
  if jsonb_typeof(j) <> 'array' or jsonb_array_length(j) > 20 then raise exception 'إعداد المراحل غير صالح'; end if;
  for e in select * from jsonb_array_elements(j) loop
    k := e ->> 'k';
    if jsonb_typeof(e) <> 'object' or k is null or k !~ '^(mgr|cust|wh|s_[a-z0-9]{1,20})$' or k = any(keys) then
      raise exception 'مرحلة غير صالحة: %', coalesce(k, '?'); end if;
    if e ? 'n' and (jsonb_typeof(e -> 'n') <> 'string' or length(e ->> 'n') > 30) then
      raise exception 'اسم المرحلة لازم 30 حرف أو أقل'; end if;
    if k like 's\_%' and btrim(coalesce(e ->> 'n', '')) = '' then raise exception 'المرحلة الجديدة تحتاج اسم'; end if;
    if e ? 'on' and jsonb_typeof(e -> 'on') <> 'boolean' then raise exception 'إعداد المراحل غير صالح'; end if;
    if e ? 'back' and jsonb_typeof(e -> 'back') <> 'boolean' then raise exception 'إعداد المراحل غير صالح'; end if;
    keys := keys || k;
  end loop;
  if not (keys @> array['mgr', 'cust', 'wh']) then raise exception 'المراحل الأساسية تنطفي بس ما تنحذف'; end if;

  if tg_op = 'UPDATE' then
    for gone in
      select x ->> 'k' from jsonb_array_elements(case when old.value ~ '^\s*\[' then old.value::jsonb else '[]' end) x
       where not ((x ->> 'k') = any(keys))
    loop
      select count(*) into n from public.invoices where stage = 'decision' and sub = gone and deleted_at is null;
      if n > 0 then
        raise exception 'ما تكدر تحذف مرحلة "%" — بيها % طلب. انقلها لمرحلة ثانية أو طفّي المرحلة بدل الحذف',
          coalesce((select nullif(btrim(x ->> 'n'), '') from jsonb_array_elements(old.value::jsonb) x where x ->> 'k' = gone), gone), n;
      end if;
    end loop;
  end if;
  new.value := j::text;
  return new;
end $$;
revoke execute on function public.app_settings_stages_guard() from public, anon, authenticated;
drop trigger if exists app_settings_stages_guard_trg on public.app_settings;
create trigger app_settings_stages_guard_trg before insert or update on public.app_settings
  for each row execute function public.app_settings_stages_guard();

-- صلاحيات الخطوات المحذوفة تنشال من الأدوار
create or replace function public.app_settings_stages_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key <> 'stages' then return null; end if;
  update public.role_defs d
     set perms = array(select p from unnest(d.perms) p
                        where p !~ '^s_' or exists (select 1 from jsonb_array_elements(new.value::jsonb) e where e ->> 'k' = p))
   where exists (select 1 from unnest(d.perms) p
                  where p ~ '^s_' and not exists (select 1 from jsonb_array_elements(new.value::jsonb) e where e ->> 'k' = p));
  return null;
end $$;
revoke execute on function public.app_settings_stages_cleanup() from public, anon, authenticated;
drop trigger if exists app_settings_stages_cleanup_trg on public.app_settings;
create trigger app_settings_stages_cleanup_trg after insert or update on public.app_settings
  for each row execute function public.app_settings_stages_cleanup();

-- ============================================================
-- 3) صلاحيات الخطوات الإضافية = مفتاح الخطوة نفسه (s_xxxx)
-- ============================================================
create or replace function public.perms_ok(p text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(x = any(array['create', 'acc', 'approve', 'cust_all', 'complete', 'move', 'urgent_all',
           'see_all', 'see_late', 'see_profit', 'reports', 'export', 'customers', 'users', 'trash']) or x ~ '^s_[a-z0-9]{1,20}$'), true)
    from unnest(p) x
$$;
alter table public.role_defs drop constraint if exists role_defs_perms_chk;
alter table public.role_defs add constraint role_defs_perms_chk check (public.perms_ok(perms));

-- منو دوره بهاي الخطوة
create or replace function public.turn_users(p_stage text, p_sub text, p_rep uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_rep where p_rep is not null and (p_stage = 'new' or (p_stage = 'decision' and p_sub = 'cust'))
  union
  select p.id from public.profiles p
   where p.active and (
         (p_stage = 'acc' and public.role_perm(p.id, 'acc'))
      or (p_stage = 'decision' and p_sub = 'mgr' and public.role_perm(p.id, 'approve'))
      or (p_stage = 'decision' and p_sub = 'wh' and public.role_perm(p.id, 'complete')
          and not public.role_perm(p.id, 'approve'))
      or (p_stage = 'decision' and p_sub ~ '^s_' and public.role_perm(p.id, p_sub)))
$$;
revoke execute on function public.turn_users(text, text, uuid) from public, anon, authenticated;

-- ============================================================
-- 4) الإجراءات
-- ============================================================
-- ينقل الطلب من خطوة القرار p_from للخطوة المفعّلة اللي بعدها، أو يكمله (داخلية)
create or replace function public.inv_advance(p_id bigint, p_from text, p_sales_no text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; nx text := public.stage_next(p_from);
begin
  if nx is null then
    update public.invoices set stage = 'done', sub = null, stage_at = now(), closed_at = now(),
           sales_no = coalesce(btrim(p_sales_no), sales_no)
     where id = p_id returning * into v;
  else
    update public.invoices set stage = 'decision', sub = nx, stage_at = now(),
           sales_no = coalesce(btrim(p_sales_no), sales_no)
     where id = p_id returning * into v;
  end if;
  return v;
end $$;
revoke execute on function public.inv_advance(bigint, text, text) from public, anon, authenticated;

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

  if v.cust_debt then
    if v.debt_cur is null then raise exception 'حدد عملة دين الزبون'; end if;
    if v.debt_cur in ('iqd', 'both') and coalesce(v.debt_iqd, 0) <= 0 then raise exception 'اكتب دين الزبون بالدينار'; end if;
    if v.debt_cur in ('usd', 'both') and coalesce(v.debt_usd, 0) <= 0 then raise exception 'اكتب دين الزبون بالدولار'; end if;
  end if;
  if public.fld_on('cust') then
    if v.cust_debt is null then raise exception 'حدد إذا على الزبون دين (نعم أو لا)'; end if;
    if v.bal_cur is null then raise exception 'حدد عملة رصيد الزبون'; end if;
    if v.bal_cur in ('iqd', 'both') and v.bal_iqd is null then raise exception 'اكتب رصيد الزبون بالدينار'; end if;
    if v.bal_cur in ('usd', 'both') and v.bal_usd is null then raise exception 'اكتب رصيد الزبون بالدولار'; end if;
  end if;

  v := public.inv_advance(p_id, null);
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
  if not public.perm('approve') then raise exception 'الموافقة للمدير فقط'; end if;

  v := public.inv_advance(p_id, 'mgr');
  perform public.add_log(p_id, 'وافق المدير على الشروط');
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

  v := public.inv_advance(p_id, 'cust');
  perform public.add_log(p_id, 'أكد موافقة الزبون');
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

  v := public.inv_advance(p_id, 'wh', p_sales_no);
  perform public.add_log(p_id, 'حول الطلب لمبيعات برقم ' || btrim(p_sales_no));
  return v;
end $$;

-- الخطوات الإضافية: "تم" ينقلها للي بعدها، و"إرجاع" للحسابات (إذا الأدمن سمح)
create or replace function public.inv_step_pass(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; k text;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  k := v.sub;
  if v.stage::text <> 'decision' or coalesce(k, '') !~ '^s_' then raise exception 'الطلب مو بهاي المرحلة'; end if;
  if not public.perm(k) then raise exception 'ما عندك صلاحية مرحلة %', public.stage_name(k); end if;

  v := public.inv_advance(p_id, k);
  perform public.add_log(p_id, 'أكمل مرحلة ' || public.stage_name(k));
  return v;
end $$;

create or replace function public.inv_step_back(p_id bigint, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; k text;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  k := v.sub;
  if v.stage::text <> 'decision' or coalesce(k, '') !~ '^s_' then raise exception 'الطلب مو بهاي المرحلة'; end if;
  if not public.stage_back_ok(k) then raise exception 'هاي المرحلة ما ترجع للحسابات'; end if;
  if not public.perm(k) then raise exception 'ما عندك صلاحية مرحلة %', public.stage_name(k); end if;

  update public.invoices set stage = 'acc', sub = null, stage_at = now(), returned = returned + 1
   where id = p_id returning * into v;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للحسابات من ' || public.stage_name(k) || coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''), true, auth.uid());
  perform public.add_log(p_id, 'أرجع الطلب للحسابات من ' || public.stage_name(k));
  return v;
end $$;

create or replace function public.inv_move(p_id bigint, p_target text, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare
  v public.invoices;
  t_stage text := split_part(coalesce(p_target, ''), ':', 1);
  t_sub text := nullif(split_part(coalesce(p_target, ''), ':', 2), '');
  from_key text; ord_from int; ord_to int;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.perm('move') then raise exception 'ما عندك صلاحية نقل الطلب'; end if;
  if not (p_target in ('new', 'acc', 'cancel')
          or (t_stage = 'decision' and exists (select 1 from jsonb_array_elements(public.stage_list()) e where e ->> 'k' = t_sub))) then
    raise exception 'مرحلة غير معروفة'; end if;

  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  from_key := v.stage::text || coalesce(':' || v.sub, '');
  if from_key = p_target then raise exception 'الطلب أصلاً بهاي المرحلة'; end if;

  -- الترتيب: جديد 1، حسابات 2، خطوات القرار 3.. بالترتيب، وبعدها المغلقة
  select case from_key when 'new' then 1 when 'acc' then 2 else coalesce(
           (select o + 2 from jsonb_array_elements(public.stage_list()) with ordinality t(e, o) where 'decision:' || (e ->> 'k') = from_key), 0) end
    into ord_from;
  select case p_target when 'new' then 1 when 'acc' then 2 when 'cancel' then 99 else
           (select o + 2 from jsonb_array_elements(public.stage_list()) with ordinality t(e, o) where e ->> 'k' = t_sub) end
    into ord_to;

  update public.invoices set
      stage = t_stage::public.inv_stage, sub = t_sub, stage_at = now(),
      returned = returned + case when ord_to < ord_from then 1 else 0 end,
      cancel_reason = case when t_stage = 'cancel' then btrim(coalesce(p_reason, '')) else '' end,
      closed_at = case when t_stage = 'cancel' then now() else null end,
      sales_no = case when v.stage::text = 'done' then '' else sales_no end
   where id = p_id returning * into v;

  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'نقل من ' || public.stage_label(from_key) || ' إلى ' || public.stage_label(p_target)
          || coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
          true, auth.uid());
  perform public.add_log(p_id, 'نقل الطلب إلى ' || public.stage_label(p_target));
  return v;
end $$;

-- اسم أي مكان بالبورد: new / acc / decision:k / done / cancel
create or replace function public.stage_label(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select case p_key when 'new' then 'طلب جديد' when 'acc' then 'الحسابات' when 'done' then 'تمت' when 'cancel' then 'ملغاة'
    else public.stage_name(split_part(p_key, ':', 2)) end
$$;

-- عدد الطلبات الشغالة بكل خطوة بكل البوردات (صفحة الإعدادات — للأدمن)
create or replace function public.stage_counts()
returns table (k text, n bigint) language sql stable security definer set search_path = public as $$
  select sub, count(*) from public.invoices
   where stage = 'decision' and deleted_at is null and public.has_role('admin')
   group by sub
$$;

revoke execute on function public.inv_step_pass(bigint) from public, anon;
revoke execute on function public.inv_step_back(bigint, text) from public, anon;
revoke execute on function public.stage_counts() from public, anon;
grant execute on function public.inv_step_pass(bigint) to authenticated;
grant execute on function public.inv_step_back(bigint, text) to authenticated;
grant execute on function public.stage_counts() to authenticated;

commit;
notify pgrst, 'reload schema';
