-- 015: "طلب خصم" من المندوب — نسبة تنطرح من صافي الربح (مثل الخصم اللاحق)
-- المندوب يحددها بالطلب الجديد، والمحاسب يكدر يعدلها بمرحلة الحسابات. يتشغل بعد 014. آمن للتشغيل أكثر من مرة.

alter table public.invoices add column if not exists disc_req boolean not null default false;
alter table public.invoices add column if not exists disc_pct numeric;
grant update (disc_req, disc_pct) on public.invoices to authenticated;

-- نفس حارس 010 + حقلين طلب الخصم (مثل value: المندوب بالجديد أو المحاسب بالحسابات)
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
  nums  text[] := array['value','credit_days','transport_amt','unload_amt','ld_pct','pdf_size','points','disc_pct'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;

  for k in
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
  loop
    if k in ('value', 'disc_req', 'disc_pct') then
      -- المندوب بالطلب الجديد، أو المحاسب بمرحلة الحسابات
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

-- الصافي % = الربح − الخصم اللاحق − طلب الخصم − (النقاط × 1.5)
create or replace function public.inv_profit_rows()
returns table (invoice_id bigint, stage text, total numeric, gross_pct numeric, net_pct numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.stage::text, t.total,
         round((1 - c.cost / nullif(t.total, 0)) * 100, 2),
         round((1 - c.cost / nullif(t.total, 0)) * 100
               - case when i.ld then coalesce(i.ld_pct, 0) else 0 end
               - case when i.disc_req then coalesce(i.disc_pct, 0) else 0 end
               - coalesce(i.points, 0) * 1.5, 2)
    from public.invoices i
    join public.invoice_costs c on c.invoice_id = i.id
    cross join lateral (select coalesce(i.value, 0)
      + case when i.payer::text = 'customer' then coalesce(i.transport_amt, 0) else 0 end as total) t
$$;
revoke execute on function public.inv_profit_rows() from public, anon, authenticated;

-- سجل الحركة يذكر طلب الخصم هم
create or replace function public.invoices_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  labels jsonb := '{"customer":"الزبون","quote_no":"رقم عرض السعر","res_no":"رقم الحجز","value":"القيمة",
    "rep_id":"المندوب","pdf_name":"ملف PDF","payment":"طريقة السداد","credit_months":"أشهر الآجل",
    "payer":"التوصيل","transport_amt":"أجور النقل","unload_amt":"أجور التفريغ","ld":"خصم لاحق",
    "ld_pct":"نسبة الخصم اللاحق","points":"النقاط","notes":"الملاحظات",
    "disc_req":"طلب خصم","disc_pct":"نسبة طلب الخصم"}';
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

notify pgrst, 'reload schema';
