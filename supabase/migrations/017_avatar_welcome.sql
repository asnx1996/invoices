-- الحسابات الموجودة ما تطلع إلها نافذة البداية. الجديدة تختار مرة واحدة.
begin;
alter table public.profiles add column if not exists avatar_chosen boolean not null default true;
alter table public.profiles alter column avatar_chosen set default false;

create or replace function public.set_avatar(p_user uuid, p_avatar text)
returns void language plpgsql security definer set search_path = public as $$
declare a text := nullif(btrim(coalesce(p_avatar, '')), '');
begin
  if not public.is_active() then raise exception 'الحساب غير مفعّل'; end if;
  if p_user is distinct from auth.uid() and not public.has_role('admin') then raise exception 'ما عندك صلاحية'; end if;
  if a is not null and a !~ '^((people|pixel|robot|animal|space)-(10|[1-9])|[mf]([1-9]|1[0-2]))$' then
    raise exception 'صورة غير معروفة';
  end if;
  update public.profiles set avatar = a,
    avatar_chosen = case when p_user = auth.uid() then true else avatar_chosen end
    where id = p_user;
  if not found then raise exception 'المستخدم غير موجود'; end if;
end $$;
revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;
commit;
notify pgrst, 'reload schema';
