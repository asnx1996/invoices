-- ============================================================
-- تحصين قاعدة البيانات — مبني على نتيجة 01-audit.sql الفعلية
-- شغّله مرة وحدة بـ SQL Editor. كله داخل transaction: إذا فشل أي سطر ما يتغير شي.
-- ============================================================
begin;

-- ============================================================
-- 🔴 1) دوال الإجراءات: الزائر والحساب المعطّل كانوا يعبرون فحص الدور
--    my_role() ترجع NULL لهم، و (NULL not in (...)) ما يرمي خطأ.
--    تأكدنا فعلياً: inv_complete بدون تسجيل دخول عبر فحص الدور.
-- ============================================================

-- أ) الزائر (anon) ما يحتاج ينادي أي دالة
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
-- المستخدم المسجل يحتاجها (السياسات تستخدم my_role/is_admin/is_active)
grant execute on all functions in schema public to authenticated, service_role;

-- add_log تنادى بس من داخل دوال الإجراءات — المستخدم ما يكدر يزوّر سجل حركة
revoke execute on function public.add_log(bigint, text) from authenticated;

-- ب) كل دالة إجراء: ارفض إذا الدور NULL (معطّل/غير مسجل)
create or replace function public.inv_send_to_acc(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; r public.app_role := public.my_role();
begin
  if r is null then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'new' then raise exception 'الطلب مو بمرحلة طلب جديد'; end if;
  if not (r = 'admin' or (r = 'rep' and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;

  if btrim(v.customer) = '' then raise exception 'اسم الزبون مطلوب'; end if;
  if btrim(v.quote_no) = '' and btrim(v.res_no) = '' then
    raise exception 'رقم عرض السعر أو رقم الحجز مطلوب'; end if;
  if v.value <= 0 then raise exception 'قيمة الفاتورة مطلوبة'; end if;
  if v.pdf_path is null then raise exception 'ملف الـ PDF مطلوب'; end if;

  update public.invoices set stage='acc', sub=null, stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للحسابات');
  return v;
end $$;

create or replace function public.inv_send_to_decision(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; r public.app_role := public.my_role();
begin
  if r is null then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'acc' then raise exception 'الطلب مو بمرحلة الحسابات'; end if;
  if r not in ('acc','admin') then raise exception 'ما عندك صلاحية'; end if;

  if v.payment is null then raise exception 'طريقة السداد مطلوبة'; end if;
  if v.payment = 'credit' and coalesce(v.credit_days,0) <= 0 then
    raise exception 'عدد أيام الآجل مطلوب'; end if;
  if v.payer is null then raise exception 'حدد منو يتحمل النقل'; end if;
  if v.payer <> 'none' and coalesce(v.transport_amt,0) <= 0 then
    raise exception 'مبلغ أجور النقل مطلوب'; end if;
  if v.ld and (coalesce(v.ld_pct,0) <= 0 or v.ld_due is null) then
    raise exception 'نسبة وتاريخ استحقاق الخصم اللاحق مطلوبة'; end if;
  if v.exc and btrim(v.exc_reason) = '' then
    raise exception 'سبب الخصم الاستثنائي مطلوب'; end if;

  update public.invoices set stage='decision', sub='mgr', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للقرار');
  return v;
end $$;

create or replace function public.inv_approve(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; r public.app_role := public.my_role();
begin
  if r is null then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'mgr' then raise exception 'الطلب مو بانتظار موافقة المدير'; end if;
  if r not in ('mgr','admin') then raise exception 'الموافقة للمدير فقط'; end if;

  update public.invoices set sub='cust', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'وافق المدير على الشروط');
  return v;
end $$;

create or replace function public.inv_return_to_acc(p_id bigint, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; r public.app_role := public.my_role();
begin
  if r is null then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'mgr' then raise exception 'الطلب مو بانتظار موافقة المدير'; end if;
  if r not in ('mgr','admin') then raise exception 'الإرجاع للمدير فقط'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'سبب الإرجاع مطلوب'; end if;

  update public.invoices
     set stage='acc', sub=null, stage_at=now(), returned = returned + 1
   where id=p_id returning * into v;

  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للحسابات: ' || p_reason, true, auth.uid());
  perform public.add_log(p_id, 'أرجع الطلب للحسابات');
  return v;
end $$;

create or replace function public.inv_customer_accept(p_id bigint)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; r public.app_role := public.my_role();
begin
  if r is null then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'cust' then raise exception 'الطلب مو بانتظار رد الزبون'; end if;
  if not (r in ('mgr','admin') or (r='rep' and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;

  update public.invoices set sub='wh', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أكد موافقة الزبون');
  return v;
end $$;

create or replace function public.inv_customer_refuse(p_id bigint, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; r public.app_role := public.my_role();
begin
  if r is null then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'cust' then raise exception 'الطلب مو بانتظار رد الزبون'; end if;
  if not (r in ('mgr','admin') or (r='rep' and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'سبب الرفض مطلوب'; end if;

  update public.invoices
     set stage='cancel', sub=null, cancel_reason=p_reason, stage_at=now(), closed_at=now()
   where id=p_id returning * into v;
  perform public.add_log(p_id, 'سجل رفض الزبون وألغى الطلب');
  return v;
end $$;

create or replace function public.inv_complete(p_id bigint, p_sales_no text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices; r public.app_role := public.my_role();
begin
  if r is null then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'wh' then raise exception 'الطلب مو بانتظار المخزن'; end if;
  if r not in ('wh','mgr','admin') then raise exception 'التحويل للمخزن أو المدير'; end if;
  if btrim(coalesce(p_sales_no,'')) = '' then raise exception 'رقم المبيعات مطلوب'; end if;

  update public.invoices
     set stage='done', sub=null, sales_no=btrim(p_sales_no), stage_at=now(), closed_at=now()
   where id=p_id returning * into v;
  perform public.add_log(p_id, 'حول الطلب لمبيعات برقم ' || btrim(p_sales_no));
  return v;
end $$;

-- ============================================================
-- 🟠 2) التعديل المباشر على invoices
--    الحارس الحالي ما يمنع حقول سير العمل: المندوب/المحاسب يكدر يغير
--    stage_at (يخفي التأخير)، sub، sales_no، returned، cancel_reason...
--    الحارس الجديد: كل حقل بمرحلته، وحقول سير العمل بس عبر دوال الإجراءات.
--    صار security invoker حتى يميّز: دوال الإجراءات تشتغل كـ postgres فتعبر،
--    والطلبات المباشرة من المتصفح (authenticated) تنفحص.
-- ============================================================
create or replace function public.invoices_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  r   public.app_role := public.my_role();
  uid uuid := auth.uid();
  k   text;
  basic text[] := array['customer','quote_no','res_no','value','pdf_path','pdf_name','pdf_size'];
  terms text[] := array['payment','credit_days','payer','transport_amt','unload_amt',
                        'ld','ld_pct','ld_due','from_purch','exc','exc_reason','notes'];
  nums  text[] := array['value','credit_days','transport_amt','unload_amt','ld_pct','pdf_size'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if r is null then raise exception 'الحساب غير مفعّل'; end if;

  for k in
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
  loop
    if k = any(basic) then
      if not (r = 'admin' or (r = 'rep' and old.rep_id = uid and old.stage = 'new')) then
        raise exception 'ما عندك صلاحية تعديل %', k; end if;
    elsif k = any(terms) then
      if not (r = 'admin' or (r = 'acc' and old.stage = 'acc')) then
        raise exception 'ما عندك صلاحية تعديل %', k; end if;
    elsif k = 'rep_id' then
      if not (r = 'admin' and old.stage = 'new') then
        raise exception 'تغيير المندوب للأدمن فقط وبمرحلة الطلب الجديد'; end if;
    else
      raise exception 'الحقل % يتغير فقط عبر الإجراءات', k;
    end if;
    if k = any(nums) and coalesce((to_jsonb(new) ->> k)::numeric, 0) < 0 then
      raise exception 'القيمة % ما تكون سالبة', k; end if;
  end loop;
  if new.ld_pct is distinct from old.ld_pct and new.ld_pct > 100 then
    raise exception 'نسبة الخصم ما تتجاوز 100'; end if;
  return new;
end $$;
-- التريغر invoices_guard_trg موجود أصلاً على UPDATE ويستخدم هاي الدالة

-- ============================================================
-- 🟡 3) التعليقات: كان المستخدم يكدر يكتب تعليق "نظام" مزوّر أو يغير وقته
-- ============================================================
create or replace function public.comments_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.author := auth.uid();
    new.is_system := false;
    new.at := now();
  end if;
  return new;
end $$;
drop trigger if exists comments_guard_trg on public.invoice_comments;
create trigger comments_guard_trg before insert on public.invoice_comments
  for each row execute function public.comments_guard();

-- ============================================================
-- 🟠 4) ملفات PDF: أي مستخدم مفعّل كان يكدر يشوف وينزّل PDF كل الطلبات
--    (المندوب يشوف فواتير غيره، المخزن يشوف طلبات ما وصلته)،
--    ويرفع ملفات لأي طلب. والمندوب ما كان يكدر يمسح ملفه القديم
--    لما يبدله أو يحذف الطلب (تبقى ملفات يتيمة).
--    المسار: <رقم الطلب>/<ملف>
-- ============================================================
drop policy if exists inv_files_read on storage.objects;
create policy inv_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'invoices' and public.is_active()
    -- RLS على invoices تنطبق هنا: تشوف الملف بس إذا تشوف الطلب
    and exists (select 1 from public.invoices i where i.id::text = (storage.foldername(name))[1])
  );

drop policy if exists inv_files_upload on storage.objects;
create policy inv_files_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'invoices' and exists (
      select 1 from public.invoices i
      where i.id::text = (storage.foldername(name))[1]
        and (public.is_admin() or (public.my_role() = 'rep' and i.rep_id = auth.uid() and i.stage = 'new'))
    )
  );

drop policy if exists inv_files_delete on storage.objects;
create policy inv_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'invoices' and (
      public.is_admin()
      or exists (
        select 1 from public.invoices i
        where i.id::text = (storage.foldername(name))[1]
          and public.my_role() = 'rep' and i.rep_id = auth.uid() and i.stage = 'new')
      -- ملف طلب انحذف: اللي رفعه يكدر يمسحه
      or (owner_id = auth.uid()::text and public.is_active() and not exists (
            select 1 from public.invoices i where i.id::text = (storage.foldername(name))[1]))
    )
  );

-- ============================================================
-- 🟡 5) صلاحيات جداول ما لها داعي (TRUNCATE يتجاوز RLS)
-- ============================================================
revoke all on public.invoices, public.profiles, public.invoice_comments, public.invoice_log from anon;
revoke truncate, trigger, references
  on public.invoices, public.profiles, public.invoice_comments, public.invoice_log from authenticated;

commit;
