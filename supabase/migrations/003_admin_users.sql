-- ============================================================
-- إدارة المستخدمين من التطبيق (الأدمن فقط)
--   admin_create_user : يسوي حساب باسم مستخدم + رمز + دور، مفعّل مباشرة
--   admin_set_password: يغير رمز أي مستخدم ويطلعه من كل أجهزته
--   admin_list_logins : أسماء الدخول (للعرض بصفحة المستخدمين)
--
-- اسم المستخدم ينحفظ كإيميل داخلي: ahmed → ahmed@invoices.local
-- (ما ينبعث له أي إيميل؛ Supabase يحتاج إيميل للدخول بكلمة سر)
-- ============================================================
begin;

create or replace function public.admin_login_email(p_username text)
returns text language plpgsql immutable as $$
declare u text := lower(btrim(coalesce(p_username, '')));
begin
  if position('@' in u) > 0 then return u; end if;
  if u !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'اسم المستخدم: حروف إنجليزية صغيرة وأرقام و . _ - فقط (3 إلى 30)';
  end if;
  return u || '@invoices.local';
end $$;

create or replace function public.admin_create_user(
  p_username text, p_password text, p_full_name text, p_role public.app_role)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := gen_random_uuid();
  em  text := public.admin_login_email(p_username);
begin
  if not coalesce(public.is_admin(), false) then raise exception 'للأدمن فقط'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'الرمز لازم 8 أحرف على الأقل'; end if;
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'الاسم الكامل مطلوب'; end if;
  if exists (select 1 from auth.users where lower(email) = em) then
    raise exception 'اسم المستخدم موجود، اختار غيره';
  end if;

  -- الحقول النصية لازم '' مو NULL، وإلا الدخول يفشل
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token)
  values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', btrim(p_full_name)), now(), now(),
    '', '', '', '', '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
          'email', now(), now(), now());

  -- on_auth_user_created سوّى الـ profile معطّل؛ نفعّله بالدور المطلوب
  insert into public.profiles (id, full_name, role, active)
  values (uid, btrim(p_full_name), p_role, true)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, active = true;

  return uid;
end $$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'للأدمن فقط'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'الرمز لازم 8 أحرف على الأقل'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then raise exception 'المستخدم غير موجود'; end if;
  -- يطلع من كل الأجهزة (إلا إذا الأدمن يغير رمزه هو)
  if p_user <> auth.uid() then delete from auth.sessions where user_id = p_user; end if;
end $$;

create or replace function public.admin_list_logins()
returns table (id uuid, login text) language sql stable security definer set search_path = public as $$
  select u.id, replace(u.email, '@invoices.local', '')
  from auth.users u where coalesce(public.is_admin(), false)
$$;

revoke execute on function public.admin_login_email(text) from public, anon;
revoke execute on function public.admin_create_user(text, text, text, public.app_role) from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
revoke execute on function public.admin_list_logins() from public, anon;
grant execute on function public.admin_create_user(text, text, text, public.app_role) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_list_logins() to authenticated;

-- الحساب اللي ينوقف: يطلع من كل أجهزته فوراً
create or replace function public.profiles_kick_inactive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.active and not new.active then delete from auth.sessions where user_id = new.id; end if;
  return new;
end $$;
revoke execute on function public.profiles_kick_inactive() from public, anon, authenticated;
drop trigger if exists profiles_kick_inactive_trg on public.profiles;
create trigger profiles_kick_inactive_trg after update of active on public.profiles
  for each row execute function public.profiles_kick_inactive();

commit;
