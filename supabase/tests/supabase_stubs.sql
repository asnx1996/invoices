-- ============================================================
-- محاكاة بيئة Supabase داخل PGlite (للاختبار المحلي فقط)
-- auth.uid() / auth.users / storage.objects / الأدوار
-- ============================================================
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema storage;
create schema extensions;
create extension pgcrypto schema extensions;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255),
  email varchar(255), encrypted_password varchar(255), email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token varchar(255), recovery_token varchar(255), email_change_token_new varchar(255),
  email_change varchar(255), email_change_token_current varchar(255) default '',
  reauthentication_token varchar(255) default '', phone_change text default '', phone_change_token varchar(255) default ''
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users (id) on delete cascade, provider_id text,
  identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade);

create table storage.buckets (id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, owner_id text, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;

create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to authenticated, anon;

-- مثل Supabase: الدوال الجديدة تنعطى لـ anon و authenticated تلقائياً
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
