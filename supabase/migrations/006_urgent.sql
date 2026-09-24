-- 006: علامة "طارئ" على الطلب
-- يأشرها/يشيلها: الأدمن، المدير، أو مندوب الطلب نفسه — بس والطلب شغال (مو مكتمل أو ملغى).
-- يتشغل بعد 005. آمن للتشغيل أكثر من مرة.

alter table public.invoices add column if not exists urgent boolean not null default false;

-- التعديل يمر من هاي الدالة فقط (حارس invoices_guard يرفض تعديل urgent المباشر)
create or replace function public.inv_set_urgent(p_id bigint, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v.stage::text not in ('new', 'acc', 'decision') then raise exception 'الطلب مغلق'; end if;
  if not (public.has_role('admin') or public.has_role('mgr')
          or (public.has_role('rep') and v.rep_id = auth.uid())) then
    raise exception 'ما عندك صلاحية'; end if;
  if v.urgent = coalesce(p_on, false) then return; end if;
  update public.invoices set urgent = coalesce(p_on, false) where id = p_id;
  perform public.add_log(p_id, case when p_on then 'أشّر الطلب طارئ' else 'شال علامة طارئ' end);
end $$;

revoke execute on function public.inv_set_urgent(bigint, boolean) from public, anon;
grant execute on function public.inv_set_urgent(bigint, boolean) to authenticated;
