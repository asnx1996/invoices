-- 011: الإرجاع بدون سبب إجباري + تعديل وحذف التعليقات
--   • inv_move / inv_return_to_rep / inv_return_to_acc: السبب صار اختياري (يُستخدم ويا السحب والإفلات)
--   • تعليقات: صاحب التعليق يعدله أو يحذفه، والأدمن يحذف أي تعليق. تعليقات النظام ما تتعدل.
-- يتشغل بعد 010. آمن للتشغيل أكثر من مرة.
begin;

-- إضافة قيمة افتراضية لمعامل تحتاج drop (create or replace ما يغيرها بكل الحالات)
drop function if exists public.inv_move(bigint, text, text);
drop function if exists public.inv_return_to_rep(bigint, text);
drop function if exists public.inv_return_to_acc(bigint, text);

create or replace function public.inv_move(p_id bigint, p_target text, p_reason text default null)
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
      cancel_reason = case when t_stage = 'cancel' then nullif(btrim(coalesce(p_reason, '')), '') else null end,
      closed_at = case when t_stage = 'cancel' then now() else null end,
      sales_no = case when v.stage::text = 'done' then null else sales_no end
   where id = p_id returning * into v;

  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'نقل من ' || coalesce(names ->> from_key, from_key) || ' إلى ' || (names ->> p_target)
          || coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
          true, auth.uid());
  perform public.add_log(p_id, 'نقل الطلب إلى ' || (names ->> p_target));
  return v;
end $$;

create or replace function public.inv_return_to_rep(p_id bigint, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage::text <> 'acc' then raise exception 'الطلب مو بمرحلة الحسابات'; end if;
  if not (public.has_role('acc') or public.has_role('admin')) then raise exception 'الإرجاع للمحاسب فقط'; end if;

  update public.invoices set stage = 'new', sub = null, stage_at = now(), returned = returned + 1
   where id = p_id returning * into v;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للمندوب' || coalesce(' — التعديلات المطلوبة: ' || nullif(btrim(coalesce(p_reason, '')), ''), ''), true, auth.uid());
  perform public.add_log(p_id, 'أرجع الطلب للمندوب');
  return v;
end $$;

create or replace function public.inv_return_to_acc(p_id bigint, p_reason text default null)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v is null then raise exception 'الطلب غير موجود'; end if;
  if v.stage <> 'decision' or v.sub <> 'mgr' then raise exception 'الطلب مو بانتظار موافقة المدير'; end if;
  if not (public.has_role('mgr') or public.has_role('admin')) then raise exception 'الإرجاع للمدير فقط'; end if;

  update public.invoices set stage='acc', sub=null, stage_at=now(), returned = returned + 1
   where id=p_id returning * into v;
  insert into public.invoice_comments (invoice_id, body, is_system, author)
  values (p_id, 'إرجاع للحسابات' || coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''), true, auth.uid());
  perform public.add_log(p_id, 'أرجع الطلب للحسابات');
  return v;
end $$;

revoke execute on function public.inv_move(bigint, text, text) from public, anon;
grant execute on function public.inv_move(bigint, text, text) to authenticated;
revoke execute on function public.inv_return_to_rep(bigint, text) from public, anon;
grant execute on function public.inv_return_to_rep(bigint, text) to authenticated;
revoke execute on function public.inv_return_to_acc(bigint, text) from public, anon;
grant execute on function public.inv_return_to_acc(bigint, text) to authenticated;

-- ---------- تعديل وحذف التعليقات ----------
alter table public.invoice_comments add column if not exists edited_at timestamptz;

create or replace function public.comment_edit(p_id bigint, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.invoice_comments;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into c from public.invoice_comments where id = p_id for update;
  if c is null or not public.can_see_invoice(c.invoice_id) then raise exception 'التعليق غير موجود'; end if;
  if c.is_system then raise exception 'تعليقات النظام ما تتعدل'; end if;
  if c.author is distinct from auth.uid() then raise exception 'تعدل تعليقك بس'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'التعليق فارغ'; end if;
  update public.invoice_comments set body = btrim(p_body), edited_at = now() where id = p_id;
end $$;

create or replace function public.comment_delete(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c public.invoice_comments;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  select * into c from public.invoice_comments where id = p_id for update;
  if c is null or not public.can_see_invoice(c.invoice_id) then raise exception 'التعليق غير موجود'; end if;
  if not (public.has_role('admin') or (not c.is_system and c.author = auth.uid())) then
    raise exception 'تحذف تعليقك بس'; end if;
  delete from public.invoice_comments where id = p_id;
end $$;

revoke execute on function public.comment_edit(bigint, text) from public, anon;
grant execute on function public.comment_edit(bigint, text) to authenticated;
revoke execute on function public.comment_delete(bigint) from public, anon;
grant execute on function public.comment_delete(bigint) to authenticated;

commit;

-- الـ API يشوف الدوال الجديدة فوراً
notify pgrst, 'reload schema';
