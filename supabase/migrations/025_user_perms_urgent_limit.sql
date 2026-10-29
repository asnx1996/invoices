-- 025: صلاحيات لكل حساب + حد يومي للطارئ + آخر خصم للزبون
--   أ) profiles.xperms / nperms: صلاحيات تنضاف أو تنشال من حساب واحد فوگ صلاحيات أدواره
--      مثلاً محاسب ينطى "يشوف كل الطلبات" ومحاسب ثاني تنشال منه. الأدمن عنده كلشي دائماً
--   ب) حد يومي للطارئ: app_settings.urgent_daily = كم طلب يكدر كل مستخدم يأشره طارئ باليوم (فارغ أو 0 = بلا حد)
--      الأدمن ما ينحسب عليه. الطلب ينحسب مرة وحدة باليوم حتى لو انشالت علامته ورجعت
--      urgent_left() = كم باقي للمستخدم اليوم (null = بلا حد)
--   ج) cust_last_disc(زبون): آخر طلب خصم وآخر خصم لاحق انعطى لنفس الزبون (حتى من طلبات غيرك)
-- يتشغل بعد 024. آمن للتشغيل أكثر من مرة.
begin;

-- ---------------------------------------------------------------- أ) صلاحيات لكل حساب
alter table public.profiles add column if not exists xperms text[] not null default '{}';
alter table public.profiles add column if not exists nperms text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_xperms_chk;
alter table public.profiles add constraint profiles_xperms_chk check (public.perms_ok(xperms) and public.perms_ok(nperms));

create or replace function public.role_perm(p_user uuid, p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
     where pr.id = p_user and pr.active and not (p = any(pr.nperms))
       and (p = any(pr.xperms) or exists (
         select 1 from public.role_defs d
          where (d.key = any(pr.roles::text[]) or d.key = any(pr.xroles)) and p = any(d.perms))))
$$;

-- غير الأدمن ما يغير أدوار ولا صلاحيات نفسه
create or replace function public.profiles_perm_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if exists (select 1 from unnest(new.xroles) x where not exists (select 1 from public.role_defs d where d.key = x)) then
    raise exception 'دور غير معروف'; end if;
  if public.has_role('admin') then return new; end if;
  if 'admin' = any(new.roles) or (tg_op = 'UPDATE' and 'admin' = any(old.roles)) then
    raise exception 'حسابات الأدمن يعدلها الأدمن بس'; end if;
  if tg_op = 'UPDATE' and new.id = auth.uid()
     and (new.roles is distinct from old.roles or new.xroles is distinct from old.xroles or new.active is distinct from old.active
          or new.xperms is distinct from old.xperms or new.nperms is distinct from old.nperms) then
    raise exception 'ما تكدر تغير أدوارك'; end if;
  return new;
end $$;
revoke execute on function public.profiles_perm_guard() from public, anon, authenticated;

-- نفس الصلاحية ما تكون مضافة ومشالة سوا، والمرتبة بدون تكرار
create or replace function public.profiles_perms_tidy()
returns trigger language plpgsql as $$
begin
  new.xperms := array(select distinct x from unnest(coalesce(new.xperms, '{}')) x order by x);
  new.nperms := array(select distinct x from unnest(coalesce(new.nperms, '{}')) x where not (x = any(new.xperms)) order by x);
  return new;
end $$;
revoke execute on function public.profiles_perms_tidy() from public, anon, authenticated;
drop trigger if exists profiles_perms_tidy_trg on public.profiles;
create trigger profiles_perms_tidy_trg before insert or update of xperms, nperms on public.profiles
  for each row execute function public.profiles_perms_tidy();

-- ---------------------------------------------------------------- ب) حد يومي للطارئ
alter table public.invoices add column if not exists urgent_at timestamptz;
alter table public.invoices add column if not exists urgent_by uuid references auth.users (id) on delete set null;

-- بداية اليوم بتوقيت بغداد
create or replace function public.day_start()
returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad'
$$;

create or replace function public.urgent_limit()
returns int language sql stable security definer set search_path = public as $$
  select case when public.has_role('admin') then null
    else nullif((select case when btrim(value) ~ '^[0-9]{1,4}$' then btrim(value)::int end from public.app_settings where key = 'urgent_daily'), 0) end
$$;

-- كم طلب يكدر يأشره طارئ اليوم بعد (null = بلا حد)
create or replace function public.urgent_left()
returns int language sql stable security definer set search_path = public as $$
  select case when public.urgent_limit() is null then null else greatest(0, public.urgent_limit() - (
    select count(*)::int from public.invoices where urgent_by = auth.uid() and urgent_at >= public.day_start())) end
$$;
revoke execute on function public.urgent_left() from public, anon;
grant execute on function public.urgent_left() to authenticated;

create or replace function public.inv_set_urgent(p_id bigint, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices; lim int := public.urgent_limit(); n int;
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if not public.can_see_invoice(p_id) then raise exception 'الطلب غير موجود'; end if;
  select * into v from public.invoices where id = p_id for update;
  if v.stage::text not in ('new', 'acc', 'decision') then raise exception 'الطلب مغلق'; end if;
  if not (public.perm('urgent_all') or public.rep_mine(v.rep_id)) then
    raise exception 'ما عندك صلاحية'; end if;
  if v.urgent = coalesce(p_on, false) then return; end if;
  if p_on then
    -- نفس الطلب اليوم ما ينحسب مرتين
    if lim is not null and not coalesce(v.urgent_by = auth.uid() and v.urgent_at >= public.day_start(), false) then
      select count(*) into n from public.invoices where urgent_by = auth.uid() and urgent_at >= public.day_start();
      if n >= lim then raise exception 'وصلت الحد اليومي للطلبات الطارئة (%) — حاول باچر أو راجع الأدمن', lim; end if;
    end if;
    update public.invoices set urgent = true, urgent_at = now(), urgent_by = auth.uid() where id = p_id;
  else
    update public.invoices set urgent = false where id = p_id;
  end if;
  perform public.add_log(p_id, case when p_on then 'أشّر الطلب طارئ' else 'شال علامة طارئ' end);
end $$;

-- ---------------------------------------------------------------- ج) آخر خصم للزبون
-- يشوف كل الطلبات (مو بس اللي يشوفها المستخدم) بس يرجّع النسبة ورقم الطلب وتاريخه فقط
create or replace function public.cust_last_disc(p_customer bigint, p_except bigint default null)
returns table (kind text, pct numeric, invoice_id bigint, at timestamptz)
language sql stable security definer set search_path = public as $$
  (select 'disc', i.disc_pct, i.id, i.created_at from public.invoices i
    where public.is_active() and i.customer_id = p_customer and i.id is distinct from p_except
      and i.deleted_at is null and i.stage::text <> 'cancel' and i.disc_req and coalesce(i.disc_pct, 0) > 0
    order by i.created_at desc, i.id desc limit 1)
  union all
  (select 'ld', i.ld_pct, i.id, i.created_at from public.invoices i
    where public.is_active() and i.customer_id = p_customer and i.id is distinct from p_except
      and i.deleted_at is null and i.stage::text <> 'cancel' and i.ld and coalesce(i.ld_pct, 0) > 0
    order by i.created_at desc, i.id desc limit 1)
$$;
revoke execute on function public.cust_last_disc(bigint, bigint) from public, anon;
grant execute on function public.cust_last_disc(bigint, bigint) to authenticated;

commit;
notify pgrst, 'reload schema';
