-- ============================================================
-- فحص أمني (قراءة فقط — ما يغيّر شي)
-- شغّله بـ Supabase → SQL Editor. يطلع صف واحد (JSON) — انسخه كامل
-- ============================================================
select jsonb_pretty(jsonb_build_object(

  -- 1) الجداول: هل RLS مفعّل؟ (لازم كلها true)
  'rls', (select jsonb_agg(jsonb_build_object('table', c.relname, 'rls_on', c.relrowsecurity) order by c.relname)
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'),

  -- 2) السياسات على public و storage
  'policies', (select jsonb_agg(jsonb_build_object(
                 'table', schemaname || '.' || tablename, 'name', policyname, 'permissive', permissive,
                 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check) order by schemaname, tablename, policyname)
               from pg_policies where schemaname in ('public', 'storage')),

  -- 3) الدوال: security definer؟ search_path؟ منو يكدر يناديها؟ + كودها
  'functions', (select jsonb_agg(jsonb_build_object(
                  'name', p.proname, 'args', pg_get_function_arguments(p.oid),
                  'security_definer', p.prosecdef, 'settings', p.proconfig,
                  'callable_by', array(select r.rolname from pg_roles r
                                       where r.rolname in ('anon', 'authenticated')
                                         and has_function_privilege(r.oid, p.oid, 'execute')),
                  'body', p.prosrc) order by p.proname)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'),

  -- 4) الـ Triggers
  'triggers', (select jsonb_agg(jsonb_build_object(
                 'table', event_object_table, 'name', trigger_name, 'timing', action_timing,
                 'event', event_manipulation, 'action', action_statement) order by event_object_table, trigger_name)
               from information_schema.triggers where trigger_schema in ('public', 'auth')),

  -- 5) الأعمدة (حتى نتأكد أسماء الحقول بملف التحصين مطابقة)
  'columns', (select jsonb_object_agg(table_name, cols) from (
                select table_name, jsonb_agg(column_name || ' ' || data_type || coalesce(' default ' || column_default, '') order by ordinal_position) cols
                from information_schema.columns where table_schema = 'public' group by table_name) t),

  -- 6) الـ buckets (لازم public=false، حد حجم، و PDF فقط)
  'buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public,
                'size_limit', file_size_limit, 'mime', allowed_mime_types)) from storage.buckets),

  -- 7) صلاحيات الجداول لـ anon و authenticated
  'grants', (select jsonb_object_agg(grantee || '.' || table_name, privs) from (
               select grantee, table_name, jsonb_agg(privilege_type order by privilege_type) privs
               from information_schema.role_table_grants
               where grantee in ('anon', 'authenticated') and table_schema = 'public'
               group by grantee, table_name) g),

  -- 8) Realtime: الجداول المنشورة
  'realtime', (select jsonb_agg(schemaname || '.' || tablename) from pg_publication_tables where pubname = 'supabase_realtime')

)) as audit;
