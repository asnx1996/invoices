-- 020: "حالة الزبون" بقائمة الحقول الإلزامية
-- الحقول القديمة إلزامية والأدمن يخليها اختيارية (opt_fields). حالة الزبون بالعكس: اختيارية من الأصل
-- وتصير إلزامية إذا الأدمن أشّرها (req_fields) — حتى ما يتغير شي على أحد قبل ما يختار.
-- يتشغل بعد 019. آمن للتشغيل أكثر من مرة.

create or replace function public.fld_on(k text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_settings
                  where key = 'req_fields' and k = any(string_to_array(replace(value, ' ', ''), ',')))
$$;
revoke execute on function public.fld_on(text) from public, anon;
grant execute on function public.fld_on(text) to authenticated;

-- نفس 018 + فحص حالة الزبون
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

  if v.cust_debt and coalesce(v.debt_amt, 0) <= 0 then raise exception 'اكتب مبلغ دين الزبون'; end if;
  if public.fld_on('cust') then
    if v.bal_cur is null then raise exception 'حدد عملة رصيد الزبون'; end if;
    if v.bal_cur in ('iqd', 'both') and v.bal_iqd is null then raise exception 'اكتب رصيد الزبون بالدينار'; end if;
    if v.bal_cur in ('usd', 'both') and v.bal_usd is null then raise exception 'اكتب رصيد الزبون بالدولار'; end if;
  end if;

  update public.invoices set stage='decision', sub='mgr', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للقرار');
  return v;
end $$;

notify pgrst, 'reload schema';
