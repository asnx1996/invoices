-- 023:
--   أ) رفض الزبون إله خيارين
--      • p_back = false (الافتراضي = السلوك القديم): الطلب ينلغى
--      • p_back = true: الطلب يرجع لموافقة المدير (إذا مرحلة المدير مطفية يرجع للحسابات) ويحسب كإرجاع
--      السبب مطلوب بالحالتين وينكتب كتعليق على الطلب
--   ب) صلاحية جديدة rep_all "يشتغل على طلبات كل المندوبين": يسوي على طلب أي مندوب كل شي يسويه المندوب
--      على طلبه (تعديل الطلب الجديد والملف، الإرسال للحسابات، رد الزبون، طارئ). الأدمن ينطيها لدور من الإعدادات
--      وتنضاف وياها "يشوف كل الطلبات" من الواجهة. rep_mine() تجمع الفحص بمكان واحد
-- يتشغل بعد 022. آمن للتشغيل أكثر من مرة.
begin;

-- ============================================================
-- 1) الصلاحية والفحص
-- ============================================================
create or replace function public.perms_ok(p text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(x = any(array['create', 'acc', 'approve', 'cust_all', 'complete', 'move', 'urgent_all',
           'see_all', 'see_late', 'see_profit', 'reports', 'export', 'customers', 'users', 'trash', 'rep_all'])
           or x ~ '^s_[a-z0-9]{1,20}$'), true)
    from unnest(p) x
$$;

-- الطلب "مالي" كمندوب: طلبي أنا، أو عندي صلاحية طلبات كل المندوبين
create or replace function public.rep_mine(p_rep uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.perm('create') and p_rep = auth.uid()) or public.perm('rep_all')
$$;
revoke execute on function public.rep_mine(uuid) from public, anon;
grant execute on function public.rep_mine(uuid) to authenticated;

-- ============================================================
-- 2) التعديل المباشر والملفات
-- ============================================================
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (board_id = any((select public.my_boards())::bigint[]) and ((select public.has_role('admin'))
    or (public.rep_mine(rep_id) and stage = 'new')
    or ((select public.perm('acc')) and stage = 'acc')))
  with check (board_id = any((select public.my_boards())::bigint[]) and ((select public.has_role('admin'))
    or (public.rep_mine(rep_id) and stage = 'new')
    or ((select public.perm('acc')) and stage = 'acc')));

create or replace function public.invoices_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  is_admin boolean := public.has_role('admin');
  can_basic boolean := is_admin or (public.rep_mine(old.rep_id) and old.stage = 'new');
  can_terms boolean := is_admin or (public.perm('acc') and old.stage = 'acc');
  k text;
  basic text[] := array['customer','customer_id','quote_no','res_no','value','pdf_path','pdf_name','pdf_size'];
  terms text[] := array['payment','credit_days','credit_months','payer','transport_amt','unload_amt',
                        'ld','ld_pct','ld_due','from_purch','exc','exc_reason','notes','points',
                        'cust_debt','debt_amt','bal_cur','bal_iqd','bal_usd','debt_cur','debt_iqd','debt_usd'];
  nums  text[] := array['value','credit_days','transport_amt','unload_amt','ld_pct','pdf_size','points','disc_pct','debt_amt','bal_iqd','bal_usd','debt_iqd','debt_usd'];
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
        and (public.has_role('admin') or (public.rep_mine(i.rep_id) and i.stage = 'new'))
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
          and public.rep_mine(i.rep_id) and i.stage = 'new')
      or (owner_id = auth.uid()::text and public.is_active() and not exists (
            select 1 from public.invoices i where i.id::text = (storage.foldername(name))[1]))
    )
  );

-- ============================================================
-- 3) الإجراءات
-- ============================================================
create or replace function public.inv_send_to_acc(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'new' then raise exception 'الطلب مو بمرحلة طلب جديد'; end if;
  if not (public.has_role('admin') or public.rep_mine(v.rep_id)) then
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

create or replace function public.inv_customer_accept(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'cust' then raise exception 'الطلب مو بانتظار رد الزبون'; end if;
  if not (public.perm('cust_all') or public.rep_mine(v.rep_id)) then
    raise exception 'ما عندك صلاحية'; end if;

  v := public.inv_advance(p_id, 'cust');
  perform public.add_log(p_id, 'أكد موافقة الزبون');
  return v;
end $$;

drop function if exists public.inv_customer_refuse(bigint, text);

create or replace function public.inv_customer_refuse(p_id bigint, p_reason text, p_back boolean default false)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; mgr_on boolean;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'cust' then raise exception 'الطلب مو بانتظار رد الزبون'; end if;
  if not (public.perm('cust_all') or public.rep_mine(v.rep_id)) then
    raise exception 'ما عندك صلاحية'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'سبب الرفض مطلوب'; end if;

  if not coalesce(p_back, false) then
    update public.invoices set stage='cancel', sub=null, cancel_reason=p_reason, stage_at=now(), closed_at=now()
     where id=p_id returning * into v;
    perform public.add_log(p_id, 'سجل رفض الزبون وألغى الطلب');
    return v;
  end if;

  select exists (select 1 from jsonb_array_elements(public.stage_list()) e
                  where e ->> 'k' = 'mgr' and coalesce((e ->> 'on')::boolean, true))
    into mgr_on;
  if mgr_on then
    update public.invoices set stage = 'decision', sub = 'mgr', stage_at = now(), returned = returned + 1
     where id = p_id returning * into v;
  else
    update public.invoices set stage = 'acc', sub = null, stage_at = now(), returned = returned + 1
     where id = p_id returning * into v;
  end if;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'الزبون رفض — رجع ' || case when mgr_on then 'للمدير' else 'للحسابات' end || ': ' || btrim(p_reason), true, auth.uid());
  perform public.add_log(p_id, 'سجل رفض الزبون وأرجع الطلب ' || case when mgr_on then 'للمدير' else 'للحسابات' end);
  return v;
end $$;

revoke execute on function public.inv_customer_refuse(bigint, text, boolean) from public, anon;
grant execute on function public.inv_customer_refuse(bigint, text, boolean) to authenticated;

create or replace function public.inv_set_urgent(p_id bigint, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v.stage::text not in ('new', 'acc', 'decision') then raise exception 'الطلب مغلق'; end if;
  if not (public.perm('urgent_all') or public.rep_mine(v.rep_id)) then
    raise exception 'ما عندك صلاحية'; end if;
  if v.urgent = coalesce(p_on, false) then return; end if;
  update public.invoices set urgent = coalesce(p_on, false) where id = p_id;
  perform public.add_log(p_id, case when p_on then 'أشّر الطلب طارئ' else 'شال علامة طارئ' end);
end $$;

commit;
notify pgrst, 'reload schema';
