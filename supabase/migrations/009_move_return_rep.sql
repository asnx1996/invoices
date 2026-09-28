-- 009: نقل الطلب بين المراحل + إرجاع الحسابات للمندوب
--   • inv_move: الأدمن والمدير فقط ينقلون الطلب لأي مرحلة (مثلاً الملغاة ترجع، أو اللي عند المدير ترجع للطلب الجديد)
--     "تمت" مو هدف للنقل — التحويل لمبيعات يبقى بإجراء المخزن (يحتاج رقم المبيعات).
--   • inv_return_to_rep: المحاسب (أو الأدمن) يرجع الطلب من الحسابات للمندوب مع التعديلات المطلوبة
-- السبب ينكتب تعليق نظام على الطلب ويوصل إشعار (تريغرات 007/008).
-- يتشغل بعد 008. آمن للتشغيل أكثر من مرة.

create or replace function public.inv_move(p_id bigint, p_target text, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare
  v public.invoices;
  t_stage text := split_part(coalesce(p_target, ''), ':', 1);
  t_sub text := nullif(split_part(coalesce(p_target, ''), ':', 2), '');
  ord_from int; ord_to int;
  names jsonb := '{"new":"طلب جديد","acc":"الحسابات","decision:mgr":"موافقة المدير","decision:cust":"رد الزبون","decision:wh":"المخزن","cancel":"ملغاة","done":"تمت"}';
  from_key text;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not (public.has_role('admin') or public.has_role('mgr')) then
    raise exception 'نقل الطلب للأدمن والمدير فقط'; end if;
  if p_target not in ('new', 'acc', 'decision:mgr', 'decision:cust', 'decision:wh', 'cancel') then
    raise exception 'مرحلة غير معروفة'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب النقل مطلوب'; end if;

  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  from_key := v.stage::text || coalesce(':' || v.sub::text, '');
  if from_key = p_target then raise exception 'الطلب أصلاً بهاي المرحلة'; end if;

  -- الترتيب: لمعرفة إذا النقل رجوع (يتحسب بعدد الإرجاعات). إحياء ملغاة/مكتملة ما يتحسب إرجاع.
  ord_from := case from_key when 'new' then 1 when 'acc' then 2 when 'decision:mgr' then 3
                when 'decision:cust' then 4 when 'decision:wh' then 5 else 0 end;
  ord_to := case p_target when 'new' then 1 when 'acc' then 2 when 'decision:mgr' then 3
                when 'decision:cust' then 4 when 'decision:wh' then 5 else 6 end;

  update public.invoices set
      stage = t_stage::public.inv_stage, sub = t_sub::public.inv_sub, stage_at = now(),
      returned = returned + case when ord_to < ord_from then 1 else 0 end,
      cancel_reason = case when t_stage = 'cancel' then btrim(p_reason) else null end,
      closed_at = case when t_stage = 'cancel' then now() else null end,
      sales_no = case when v.stage::text = 'done' then null else sales_no end
   where id = p_id returning * into v;

  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'نقل من ' || coalesce(names ->> from_key, from_key) || ' إلى ' || (names ->> p_target) || ': ' || btrim(p_reason),
          true, auth.uid());
  perform public.add_log(p_id, 'نقل الطلب إلى ' || (names ->> p_target));
  return v;
end $$;

create or replace function public.inv_return_to_rep(p_id bigint, p_reason text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage::text <> 'acc' then raise exception 'الطلب مو بمرحلة الحسابات'; end if;
  if not (public.has_role('acc') or public.has_role('admin')) then raise exception 'الإرجاع للمحاسب فقط'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'اكتب التعديلات المطلوبة'; end if;

  update public.invoices set stage = 'new', sub = null, stage_at = now(), returned = returned + 1
   where id = p_id returning * into v;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للمندوب — التعديلات المطلوبة: ' || btrim(p_reason), true, auth.uid());
  perform public.add_log(p_id, 'أرجع الطلب للمندوب');
  return v;
end $$;

revoke execute on function public.inv_move(bigint, text, text) from public, anon;
grant execute on function public.inv_move(bigint, text, text) to authenticated;
revoke execute on function public.inv_return_to_rep(bigint, text) from public, anon;
grant execute on function public.inv_return_to_rep(bigint, text) to authenticated;
