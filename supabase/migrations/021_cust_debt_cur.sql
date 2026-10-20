-- 021: حالة الزبون صارت قسم وحده: "على الزبون دين؟" نعم/لا (فارغ = ما انجاوب)،
-- وإذا نعم: عملة الدين (دينار/دولار/الاثنين) ومبلغ كل عملة. الرصيد يبقى مثل 019.
-- debt_amt (019) ينقل للعملة الجديدة ويبقى عمود قديم. يتشغل بعد 020. آمن للتشغيل أكثر من مرة.

alter table public.invoices add column if not exists debt_cur text;
alter table public.invoices add column if not exists debt_iqd numeric;
alter table public.invoices add column if not exists debt_usd numeric;
alter table public.invoices drop constraint if exists invoices_debt_cur_chk;
alter table public.invoices add constraint invoices_debt_cur_chk check (debt_cur is null or debt_cur in ('iqd', 'usd', 'both'));
grant update (debt_cur, debt_iqd, debt_usd) on public.invoices to authenticated;

-- نعم/لا: الفارغ يعني المحاسب بعده ما جاوب
alter table public.invoices alter column cust_debt drop not null;
alter table public.invoices alter column cust_debt drop default;

-- البيانات القديمة — بدون ما تنكتب بسجل الحركة، وتشمل الطلبات اللي بسلة المحذوفات
alter table public.invoices disable trigger invoices_history_trg;
alter table public.invoices disable trigger invoices_trash_guard_trg;
update public.invoices set cust_debt = null
 where cust_debt = false and stage::text in ('new', 'acc') and debt_amt is null;
update public.invoices i
   set debt_cur = c.k,
       debt_iqd = case when c.k = 'iqd' then i.debt_amt end,
       debt_usd = case when c.k = 'usd' then i.debt_amt end
  from (select case when exists (select 1 from public.app_settings where key = 'currency' and value ~* '(usd|\$|دولار)')
                    then 'usd' else 'iqd' end as k) c
 where i.debt_amt > 0 and i.debt_cur is null;
alter table public.invoices enable trigger invoices_history_trg;
alter table public.invoices enable trigger invoices_trash_guard_trg;

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

create or replace function public.inv_fmt(k text, v jsonb)
returns text language sql stable security definer set search_path = public as $$
  select case
    when v is null or v = 'null'::jsonb or v #>> '{}' = '' then '—'
    when k = 'payment' then coalesce(case v #>> '{}' when 'cash' then 'نقدي' when 'credit' then 'آجل'
                                     when 'cheque' then 'صك' when 'transfer' then 'تحويل' end, v #>> '{}')
    when k = 'payer' then coalesce(case v #>> '{}' when 'customer' then 'على الزبون'
                                   when 'company' then 'على الشركة' when 'none' then 'بدون' end, v #>> '{}')
    when k in ('bal_cur', 'debt_cur') then coalesce(case v #>> '{}' when 'iqd' then 'دينار' when 'usd' then 'دولار'
                                     when 'both' then 'دينار ودولار' end, v #>> '{}')
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
    "ld_pct":"نسبة الخصم اللاحق","points":"النقاط","notes":"الملاحظات",
    "disc_req":"طلب خصم","disc_pct":"نسبة طلب الخصم",
    "cust_debt":"على الزبون دين","debt_amt":"مبلغ الدين","bal_cur":"عملة الرصيد",
    "bal_iqd":"الرصيد بالدينار","bal_usd":"الرصيد بالدولار",
    "debt_cur":"عملة الدين","debt_iqd":"الدين بالدينار","debt_usd":"الدين بالدولار"}';
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

  -- الدين: إذا "نعم" لازم العملة والمبلغ. وإذا الأدمن خلى حالة الزبون إلزامية: الجواب والرصيد
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

  update public.invoices set stage='decision', sub='mgr', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للقرار');
  return v;
end $$;

notify pgrst, 'reload schema';
