-- 024: رقم عرض السعر ورقم الحجز ما يتكررون
--   إذا الرقم مكتوب بطلب ثاني (غير المحذوفات) القاعدة ترفضه وتكول بأي طلب
--   المقارنة بدون فراغات الأطراف وبدون فرق الحروف الكبيرة والصغيرة
--   الطلبات القديمة المكررة تبقى مثل ما هي، الفحص بس لما ينكتب أو يتغير الرقم
-- يتشغل بعد 023. آمن للتشغيل أكثر من مرة.
begin;

-- security definer حتى يشوف طلبات كل المندوبين مو بس اللي يشوفها المستخدم
create or replace function public.invoices_ref_unique()
returns trigger language plpgsql security definer set search_path = public as $$
declare d bigint;
begin
  if btrim(coalesce(new.quote_no, '')) <> ''
     and (tg_op = 'INSERT' or lower(btrim(coalesce(new.quote_no, ''))) <> lower(btrim(coalesce(old.quote_no, '')))) then
    select id into d from public.invoices
     where id <> new.id and deleted_at is null and lower(btrim(quote_no)) = lower(btrim(new.quote_no)) limit 1;
    if d is not null then raise exception 'رقم عرض السعر % مكرر — مكتوب بالطلب #%', btrim(new.quote_no), d; end if;
  end if;
  if btrim(coalesce(new.res_no, '')) <> ''
     and (tg_op = 'INSERT' or lower(btrim(coalesce(new.res_no, ''))) <> lower(btrim(coalesce(old.res_no, '')))) then
    select id into d from public.invoices
     where id <> new.id and deleted_at is null and lower(btrim(res_no)) = lower(btrim(new.res_no)) limit 1;
    if d is not null then raise exception 'رقم الحجز % مكرر — مكتوب بالطلب #%', btrim(new.res_no), d; end if;
  end if;
  return new;
end $$;
revoke execute on function public.invoices_ref_unique() from public, anon, authenticated;

drop trigger if exists invoices_ref_unique_trg on public.invoices;
create trigger invoices_ref_unique_trg before insert or update of quote_no, res_no on public.invoices
  for each row execute function public.invoices_ref_unique();

create index if not exists invoices_quote_no_idx on public.invoices (lower(btrim(quote_no))) where deleted_at is null;
create index if not exists invoices_res_no_idx on public.invoices (lower(btrim(res_no))) where deleted_at is null;

commit;
