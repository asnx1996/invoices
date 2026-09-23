-- 005: إعدادات عامة (عملة الموقع يحددها الأدمن) + النقل صار "على الزبون" أو "بدون"
-- يتشغل بعد 004. آمن للتشغيل أكثر من مرة.

-- ---------- الإعدادات ----------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
grant select, insert, update on public.app_settings to authenticated;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated
  using ((select public.is_active()));
drop policy if exists app_settings_admin_ins on public.app_settings;
create policy app_settings_admin_ins on public.app_settings for insert to authenticated
  with check ((select public.has_role('admin')));
drop policy if exists app_settings_admin_upd on public.app_settings;
create policy app_settings_admin_upd on public.app_settings for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

insert into public.app_settings (key, value) values ('currency', 'د.ع') on conflict (key) do nothing;

-- ---------- النقل: على الزبون (مع المبلغ) أو بدون ----------
-- 'company' يبقى مقبول للطلبات القديمة بس الواجهة ما تعرضه للجديدة
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
  if v.payer is null or v.payer::text not in ('customer', 'none', 'company') then
    raise exception 'حدد النقل: على الزبون أو بدون'; end if;
  if v.payer::text = 'customer' and coalesce(v.transport_amt, 0) <= 0 then
    raise exception 'اكتب مبلغ أجور النقل'; end if;
  if v.ld and (coalesce(v.ld_pct, 0) <= 0 or v.ld_pct > 100) then
    raise exception 'اكتب نسبة الخصم اللاحق'; end if;
  if not v.cost_set then raise exception 'اكتب سعر الكلفة'; end if;

  update public.invoices set stage='decision', sub='mgr', stage_at=now() where id=p_id returning * into v;
  perform public.add_log(p_id, 'أرسل الطلب للقرار');
  return v;
end $$;
revoke all on function public.inv_send_to_decision(bigint) from public, anon;
grant execute on function public.inv_send_to_decision(bigint) to authenticated;
