-- ============================================================
-- اختبارات الصلاحيات وقواعد الشغل
--
-- تشتغل بمكانين:
--   1) محلياً:  npm test
--   2) على Supabase: الصق الملف بـ SQL Editor وشغّله
--
-- ما تغيّر أي شي: تسوي مستخدمين وطلبات تجريبية، تفحص، وبالنهاية
-- ترمي "خطأ" فيه النتيجة فيرجع كلشي مثل ما كان (rollback).
-- النتيجة: "ALL TESTS PASSED (n)"  أو  "TESTS FAILED" مع التفاصيل
-- ============================================================

create function pg_temp.t_rec(ok boolean, label text, detail text default '') returns void language plpgsql as $$
begin
  if ok then
    perform set_config('tst.pass', (coalesce(nullif(current_setting('tst.pass', true), ''), '0')::int + 1)::text, false);
  else
    perform set_config('tst.fail', coalesce(current_setting('tst.fail', true), '') || E'\n  ✗ ' || label
      || case when coalesce(detail, '') <> '' then ' — ' || detail else '' end, false);
  end if;
end $$;

-- أخطاء تعني إن الاختبار نفسه غلط (مو رفض صلاحية)
create function pg_temp.t_broken(state text) returns boolean language sql as $$
  select state in ('42601', '42883', '42703', '42P01', '42804', '22P02')
$$;

-- لازم ينجح ويأثر على n صفوف (n = null: ما يهم)
create function pg_temp.t_ok(label text, q text, n_expected int default null) returns void language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  perform pg_temp.t_rec(n_expected is null or n = n_expected, label, 'أثّر على ' || n || ' صف');
exception when others then
  perform pg_temp.t_rec(false, label, sqlerrm);
end $$;

-- لازم يترفض: خطأ صلاحية، أو 0 صفوف
create function pg_temp.t_denied(label text, q text) returns void language plpgsql as $$
declare n bigint := 0;
begin
  begin
    execute q;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'T_UNEXPECTED_OK'; end if;
  exception when others then
    if sqlerrm = 'T_UNEXPECTED_OK' then
      perform pg_temp.t_rec(false, label, 'انسمح! (' || n || ' صف)');
    elsif pg_temp.t_broken(sqlstate) then
      perform pg_temp.t_rec(false, label, 'اختبار غلط: ' || sqlerrm);
    else
      perform pg_temp.t_rec(true, label);
    end if;
    return;
  end;
  perform pg_temp.t_rec(true, label);
end $$;

create function pg_temp.t_eq(label text, q text, expected text) returns void language plpgsql as $$
declare got text;
begin
  execute q into got;
  perform pg_temp.t_rec(got is not distinct from expected, label,
    'المتوقع ' || coalesce(expected, 'NULL') || '، وطلع ' || coalesce(got, 'NULL'));
exception when others then
  perform pg_temp.t_rec(false, label, sqlerrm);
end $$;

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

do $test$
declare
  u_admin  uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  u_rep1   uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  u_rep2   uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  u_acc    uuid := 'aaaaaaaa-0000-4000-8000-000000000004';
  u_mgr    uuid := 'aaaaaaaa-0000-4000-8000-000000000005';
  u_wh     uuid := 'aaaaaaaa-0000-4000-8000-000000000006';
  u_off    uuid := 'aaaaaaaa-0000-4000-8000-000000000007';
  u_repacc uuid := 'aaaaaaaa-0000-4000-8000-000000000008';
  c1 bigint; c2 bigint;
  i_new1 bigint; i_new2 bigint; i_new3 bigint; i_acc bigint; i_acc2 bigint; i_dec bigint; i_wh bigint;
  new_user uuid;
  msg text;
begin
  perform set_config('tst.pass', '0', false);
  perform set_config('tst.fail', '', false);

  -- ---------------- التجهيز (كمالك القاعدة) ----------------
  insert into auth.users (id, email, instance_id, aud, role, raw_user_meta_data)
  select x.id, 'zz-test-' || x.n || '@test.invalid', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', jsonb_build_object('full_name', 'zz ' || x.n)
    from (values (u_admin, 'admin'), (u_rep1, 'rep1'), (u_rep2, 'rep2'), (u_acc, 'acc'),
                 (u_mgr, 'mgr'), (u_wh, 'wh'), (u_off, 'off'), (u_repacc, 'repacc')) x(id, n);

  update public.profiles p set active = true, full_name = 'zz ' || x.n, roles = x.r::public.app_role[]
    from (values (u_admin, 'admin', '{admin}'), (u_rep1, 'rep1', '{rep}'), (u_rep2, 'rep2', '{rep}'),
                 (u_acc, 'acc', '{acc}'), (u_mgr, 'mgr', '{mgr}'), (u_wh, 'wh', '{wh}'),
                 (u_repacc, 'repacc', '{rep,acc}')) x(id, n, r)
   where p.id = x.id;
  update public.profiles set roles = '{mgr}', active = false where id = u_off;

  insert into public.customers (name) values ('zz-test زبون 1') returning id into c1;
  insert into public.customers (name) values ('zz-test زبون 2') returning id into c2;

  insert into public.invoices (rep_id, customer_id, quote_no, value, pdf_path)
    values (u_rep1, c1, 'Q1', 950000, 'x') returning id into i_new1;
  update public.invoices set pdf_path = i_new1 || '/a.pdf' where id = i_new1;
  insert into public.invoices (rep_id, customer_id, quote_no, value, pdf_path)
    values (u_rep2, c2, 'Q2', 100, 'p') returning id into i_new2;
  insert into public.invoices (rep_id, customer, quote_no, value, pdf_path)
    values (u_rep1, 'بدون قائمة', 'Q3', 100, 'p') returning id into i_new3;
  insert into public.invoices (rep_id, customer_id, quote_no, value, pdf_path, stage)
    values (u_rep1, c1, 'Q4', 950000, 'p', 'acc') returning id into i_acc;
  insert into public.invoices (rep_id, customer_id, quote_no, value, pdf_path, stage)
    values (u_rep2, c2, 'Q5', 100, 'p', 'acc') returning id into i_acc2;
  insert into public.invoices (rep_id, customer_id, quote_no, value, pdf_path, stage, sub, payment, payer)
    values (u_rep1, c1, 'Q6', 100, 'p', 'decision', 'mgr', 'cash', 'company') returning id into i_dec;
  insert into public.invoices (rep_id, customer_id, quote_no, value, pdf_path, stage, sub, payment, payer)
    values (u_rep2, c2, 'Q7', 100, 'p', 'decision', 'wh', 'cash', 'company') returning id into i_wh;

  -- ---------------- الزائر (بدون تسجيل دخول) ----------------
  perform pg_temp.as_anon();
  perform pg_temp.t_denied('زائر: ما يكمل طلب', format('select public.inv_complete(%s, %L)', i_wh, 'S'));
  perform pg_temp.t_denied('زائر: ما يوافق', format('select public.inv_approve(%s)', i_dec));
  perform pg_temp.t_denied('زائر: ما يقرا الطلبات', 'select * from public.invoices');
  perform pg_temp.t_denied('زائر: ما يقرا الزبائن', 'select * from public.customers');
  perform pg_temp.t_denied('زائر: ما يسوي مستخدم', $q$select public.admin_create_user('x.y', '12345678', 'x', '{admin}')$q$);

  -- ---------------- حساب موقوف ----------------
  perform pg_temp.as_user(u_off);
  perform pg_temp.t_eq('موقوف: ما يشوف طلبات', 'select count(*) from public.invoices', '0');
  perform pg_temp.t_denied('موقوف: ما يوافق', format('select public.inv_approve(%s)', i_dec));
  perform pg_temp.t_denied('موقوف: ما يطلب حذف', format('select public.inv_request_delete(%s, %L)', i_dec, 'x'));

  -- ---------------- المندوب ----------------
  perform pg_temp.as_user(u_rep1);
  perform pg_temp.t_eq('مندوب: ما يشوف طلب غيره', format('select count(*) from public.invoices where id = %s', i_new2), '0');
  perform pg_temp.t_eq('مندوب: يشوف طلبه', format('select count(*) from public.invoices where id = %s', i_new1), '1');
  perform pg_temp.t_ok('مندوب: يعدل القيمة بطلبه الجديد', format('update public.invoices set value = 950000.5 where id = %s', i_new1), 1);
  perform pg_temp.t_eq('سجل التغيير: ينحفظ تعديل القيمة',
    format($q$select (count(*) > 0)::text from public.invoice_log where invoice_id = %s and body like 'عدّل القيمة%%'$q$, i_new1), 'true');
  perform pg_temp.t_ok('مندوب: يرجع القيمة', format('update public.invoices set value = 950000 where id = %s', i_new1), 1);
  perform pg_temp.t_denied('مندوب: ما يعدل النقاط', format('update public.invoices set points = 1 where id = %s', i_new1));
  perform pg_temp.t_denied('مندوب: ما يغير المرحلة', format($q$update public.invoices set stage = 'done' where id = %s$q$, i_new1));
  perform pg_temp.t_denied('مندوب: ما يغير تاريخ المرحلة', format('update public.invoices set stage_at = now() - interval ''9 days'' where id = %s', i_new1));
  perform pg_temp.t_denied('مندوب: ما يعدل طلب مندوب ثاني', format($q$update public.invoices set customer = 'x' where id = %s$q$, i_new2));
  perform pg_temp.t_denied('مندوب: ما يكتب رقم حجز ويا عرض السعر', format($q$update public.invoices set res_no = 'R1' where id = %s$q$, i_new1));
  perform pg_temp.t_denied('مندوب: ما يحذف حتى طلبه', format('delete from public.invoices where id = %s', i_new1));
  perform pg_temp.t_denied('مندوب: ما يستخدم inv_delete', format('select public.inv_delete(%s)', i_new1));
  perform pg_temp.t_denied('مندوب: ما يطلب حذف طلب غيره', format('select public.inv_request_delete(%s, %L)', i_new2, 'x'));
  perform pg_temp.t_ok('مندوب: يطلب حذف طلبه', format('select public.inv_request_delete(%s, %L)', i_new3, 'غلط'));
  perform pg_temp.t_denied('مندوب: ما يطلب حذف مرتين', format('select public.inv_request_delete(%s, %L)', i_new3, 'غلط'));
  perform pg_temp.t_denied('مندوب: ما يسجل بسجل الحركة', format('select public.add_log(%s, %L)', i_new1, 'مزور'));
  perform pg_temp.t_denied('مندوب: ما ينشئ طلب باسم غيره', format('insert into public.invoices (rep_id) values (%L)', u_rep2));
  perform pg_temp.t_ok('مندوب: ينشئ طلب باسمه', format('insert into public.invoices (rep_id) values (%L)', u_rep1), 1);
  perform pg_temp.t_denied('مندوب: ما يضيف زبائن', $q$insert into public.customers (name) values ('zz-test هاكر')$q$);
  perform pg_temp.t_eq('مندوب: يقرا الزبائن', $q$select count(*) from public.customers where name like 'zz-test%'$q$, '2');
  perform pg_temp.t_ok('مندوب: يختار زبون من القائمة', format('update public.invoices set customer_id = %s where id = %s', c2, i_new3), 1);
  perform pg_temp.t_eq('اختيار الزبون يكتب اسمه', format('select customer from public.invoices where id = %s', i_new3), 'zz-test زبون 2');
  perform pg_temp.t_ok('مندوب: تعليق', format($q$insert into public.invoice_comments (invoice_id, body, author, is_system) values (%s, 'hi', %L, true)$q$, i_new1, u_rep2), 1);
  perform pg_temp.t_eq('التعليق ما ينزور (كاتب/نظام)',
    format($q$select author::text || '/' || is_system from public.invoice_comments where invoice_id = %s and body = 'hi'$q$, i_new1), u_rep1::text || '/false');
  perform pg_temp.t_denied('مندوب: ما يشوف الكلفة', 'select * from public.invoice_costs');
  perform pg_temp.t_eq('مندوب: ما يشوف الربح', 'select count(*) from public.inv_profits(null)', '0');
  perform pg_temp.t_denied('مندوب: ما يكتب الكلفة', format('select public.inv_set_cost(%s, 1)', i_acc));
  perform pg_temp.t_denied('مندوب: ما يوافق', format('select public.inv_approve(%s)', i_dec));
  perform pg_temp.t_denied('مندوب: ما يسوي مستخدم', $q$select public.admin_create_user('zz.hack', '12345678', 'x', '{admin}')$q$);
  perform pg_temp.t_denied('مندوب: ما يغير رمز غيره', format('select public.admin_set_password(%L, %L)', u_admin, 'hacked123'));
  perform pg_temp.t_denied('مندوب: ما يرقّي نفسه', format($q$update public.profiles set roles = '{admin}' where id = %L$q$, u_rep1));
  perform pg_temp.t_denied('مندوب: ما يشوف التقارير', 'select public.report_summary(current_date - 30, current_date)');
  perform pg_temp.t_denied('إرسال بدون زبون من القائمة',
    format('select public.inv_send_to_acc(%s)', (select id from public.invoices where rep_id = u_rep1 and customer_id is null and stage = 'new' order by id desc limit 1)));

  -- ---------------- ملفات PDF ----------------
  begin
    perform pg_temp.as_owner();
    insert into storage.objects (bucket_id, name, owner_id) values
      ('invoices', i_new1 || '/a.pdf', u_rep1::text), ('invoices', i_new2 || '/b.pdf', u_rep2::text);
    perform pg_temp.as_user(u_rep1);
    perform pg_temp.t_eq('ملفات: المندوب يشوف ملفه', format($q$select count(*) from storage.objects where name = '%s/a.pdf'$q$, i_new1), '1');
    perform pg_temp.t_eq('ملفات: المندوب ما يشوف ملف غيره', format($q$select count(*) from storage.objects where name = '%s/b.pdf'$q$, i_new2), '0');
    perform pg_temp.t_denied('ملفات: ما يرفع لطلب غيره', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('invoices', '%s/h.pdf', %L)$q$, i_new2, u_rep1));
    perform pg_temp.t_ok('ملفات: يرفع لطلبه', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('invoices', '%s/c.pdf', %L)$q$, i_new1, u_rep1), 1);
    perform pg_temp.as_user(u_wh);
    perform pg_temp.t_eq('ملفات: المخزن ما يشوف طلب جديد', format($q$select count(*) from storage.objects where name = '%s/a.pdf'$q$, i_new1), '0');
  exception when others then
    perform pg_temp.t_rec(false, 'ملفات: ما كدرت أجهز الاختبار', sqlerrm);
  end;

  -- ---------------- إرسال للحسابات ----------------
  perform pg_temp.as_user(u_rep1);
  perform pg_temp.t_ok('مندوب: يرسل للحسابات', format('select public.inv_send_to_acc(%s)', i_new1));
  perform pg_temp.t_eq('سجل المراحل: انسجلت مرحلة الحسابات',
    format($q$select count(*) from public.invoice_stage_log where invoice_id = %s and stage = 'acc'$q$, i_new1), '1');
  perform pg_temp.t_denied('مندوب: ما يعدل بعد الإرسال', format($q$update public.invoices set customer = 'x' where id = %s$q$, i_new1));

  -- ---------------- المحاسب ----------------
  perform pg_temp.as_user(u_acc);
  perform pg_temp.t_denied('محاسب: ما يعدل بيانات الطلب', format($q$update public.invoices set customer = 'x' where id = %s$q$, i_acc));
  perform pg_temp.t_denied('محاسب: ما يرسل بدون شروط', format('select public.inv_send_to_decision(%s)', i_acc));
  perform pg_temp.t_ok('محاسب: يختار صك (قديم)', format($q$update public.invoices set payment = 'cheque', payer = 'customer' where id = %s$q$, i_acc), 1);
  perform pg_temp.t_denied('محاسب: الصك مرفوض', format('select public.inv_send_to_decision(%s)', i_acc));
  perform pg_temp.t_ok('محاسب: آجل', format($q$update public.invoices set payment = 'credit' where id = %s$q$, i_acc), 1);
  perform pg_temp.t_denied('محاسب: آجل بدون أشهر مرفوض', format('select public.inv_send_to_decision(%s)', i_acc));
  perform pg_temp.t_denied('محاسب: أشهر الآجل 1-3 بس', format('update public.invoices set credit_months = 4 where id = %s', i_acc));
  perform pg_temp.t_ok('محاسب: شهرين', format('update public.invoices set credit_months = 2 where id = %s', i_acc), 1);
  perform pg_temp.t_denied('محاسب: توصيل على الزبون بدون مبلغ مرفوض', format('select public.inv_send_to_decision(%s)', i_acc));
  perform pg_temp.t_ok('محاسب: النقل والخصم والنقاط',
    format('update public.invoices set transport_amt = 50000, ld = true, ld_pct = 5, points = 2 where id = %s', i_acc), 1);
  perform pg_temp.t_denied('محاسب: ما يرسل بدون كلفة', format('select public.inv_send_to_decision(%s)', i_acc));
  perform pg_temp.t_denied('محاسب: الكلفة لازم أكبر من صفر', format('select public.inv_set_cost(%s, 0)', i_acc));
  perform pg_temp.t_ok('محاسب: يكتب الكلفة', format('select public.inv_set_cost(%s, 800000)', i_acc));
  perform pg_temp.t_eq('محاسب: ما يشوف الكلفة بعد كتابتها', 'select count(*) from public.invoice_costs', '0');
  perform pg_temp.t_eq('محاسب: ما يشوف الربح', 'select count(*) from public.inv_profits(null)', '0');
  perform pg_temp.t_denied('محاسب: ما يكتب كلفة لطلب مو بمرحلته', format('select public.inv_set_cost(%s, 5)', i_dec));
  perform pg_temp.t_ok('محاسب: يرسل للقرار', format('select public.inv_send_to_decision(%s)', i_acc));
  perform pg_temp.t_denied('محاسب: ما يعدل النقاط بعد الإرسال', format('update public.invoices set points = 9 where id = %s', i_acc));

  -- ---------------- المدير والربح ----------------
  -- مثال: 950,000 + نقل 50,000 = 1,000,000 ، كلفة 800,000 ← ربح 20% ، −5% خصم −3% نقاط = 12%
  perform pg_temp.as_user(u_mgr);
  perform pg_temp.t_eq('المعادلة: ربح 20% وصافي 12%',
    format($q$select total::bigint || ' / ' || gross_pct || ' / ' || net_pct from public.inv_profits(array[%s]::bigint[])$q$, i_acc),
    '1000000 / 20.00 / 12.00');
  perform pg_temp.t_eq('مدير: ما يشوف الكلفة', 'select count(*) from public.invoice_costs', '0');
  perform pg_temp.t_denied('مدير: ما يحذف', format('delete from public.invoices where id = %s', i_dec));
  perform pg_temp.t_ok('مدير: يوافق', format('select public.inv_approve(%s)', i_acc));
  perform pg_temp.t_eq('مدير: يشوف التقارير',
    $q$select (public.report_summary(current_date - 30, current_date) ? 'by_rep')::text$q$, 'true');

  -- ---------------- المخزن ----------------
  perform pg_temp.as_user(u_wh);
  perform pg_temp.t_eq('مخزن: ما يشوف طلب جديد', format('select count(*) from public.invoices where id = %s', i_new2), '0');
  perform pg_temp.t_eq('مخزن: يشوف القرار', format('select count(*) from public.invoices where id = %s', i_wh), '1');
  perform pg_temp.t_denied('مخزن: ما يوافق', format('select public.inv_approve(%s)', i_dec));
  perform pg_temp.t_ok('مخزن: يحول لمبيعات', format('select public.inv_complete(%s, %L)', i_wh, 'S-1'));

  -- ---------------- حساب بدورين (مندوب + محاسب) ----------------
  perform pg_temp.as_user(u_repacc);
  perform pg_temp.t_ok('دورين: ينشئ طلب كمندوب', format('insert into public.invoices (rep_id) values (%L)', u_repacc), 1);
  perform pg_temp.t_ok('دورين: يعدل الشروط كمحاسب', format('update public.invoices set points = 1 where id = %s', i_acc2), 1);
  perform pg_temp.t_denied('دورين: ما يوافق', format('select public.inv_approve(%s)', i_dec));

  -- ---------------- الأدمن ----------------
  perform pg_temp.as_user(u_admin);
  perform pg_temp.t_eq('أدمن: يشوف الكلفة', format('select cost::bigint::text from public.invoice_costs where invoice_id = %s', i_acc), '800000');
  perform pg_temp.t_eq('أدمن: يشوف الربح', format('select net_pct::text from public.inv_profits(array[%s]::bigint[])', i_acc), '12.00');
  perform pg_temp.t_ok('أدمن: يضيف زبون', $q$insert into public.customers (name) values ('zz-test زبون 3')$q$, 1);
  perform pg_temp.t_denied('زبون مكرر مرفوض', $q$insert into public.customers (name) values ('  ZZ-TEST زبون 3 ')$q$);
  perform pg_temp.t_ok('أدمن: يرفض طلب الحذف', format('select public.inv_cancel_delete_request(%s)', i_new3));
  perform pg_temp.t_ok('أدمن: يحذف طلب', format('select public.inv_delete(%s)', i_new2));
  perform pg_temp.t_eq('الحذف مسح التعليقات والسجل',
    format('select (select count(*) from public.invoices where id = %1$s) + (select count(*) from public.invoice_log where invoice_id = %1$s)', i_new2), '0');
  perform pg_temp.t_ok('أدمن: يسوي مستخدم بدورين', $q$select public.admin_create_user('zz.test.new', 'password123', 'zz جديد', '{rep,acc}')$q$);
  perform pg_temp.as_owner();
  select id into new_user from public.profiles where full_name = 'zz جديد';
  perform pg_temp.t_eq('المستخدم الجديد: مفعّل وبدورين', format('select active || %L || roles::text from public.profiles where id = %L', ' ', new_user), 'true {rep,acc}');
  perform pg_temp.t_eq('المستخدم الجديد: إيميل الدخول', format('select email from auth.users where id = %L', new_user), 'zz.test.new@invoices.local');
  perform pg_temp.as_user(u_admin);
  perform pg_temp.t_ok('أدمن: يغير رمز مستخدم', format('select public.admin_set_password(%L, %L)', new_user, 'newpass123'));
  perform pg_temp.t_denied('الرمز القصير مرفوض', format('select public.admin_set_password(%L, %L)', new_user, 'short'));
  perform pg_temp.t_ok('أدمن: يغير أدوار', format($q$update public.profiles set roles = '{wh}' where id = %L$q$, new_user), 1);
  perform pg_temp.as_owner();
  perform pg_temp.t_eq('الدور الأساسي يتحدث وحده', format('select role::text from public.profiles where id = %L', new_user), 'wh');

  -- ---------------- الإعدادات (العملة) ----------------
  perform pg_temp.as_user(u_wh);
  perform pg_temp.t_eq('الكل يقرأ العملة', $q$select value from public.app_settings where key = 'currency'$q$, 'د.ع');
  perform pg_temp.t_denied('مخزن: ما يغير العملة', $q$update public.app_settings set value = '$' where key = 'currency'$q$);
  perform pg_temp.as_user(u_mgr);
  perform pg_temp.t_denied('مدير: ما يغير العملة', $q$update public.app_settings set value = '$' where key = 'currency'$q$);
  perform pg_temp.as_user(u_admin);
  perform pg_temp.t_ok('أدمن: يغير العملة', $q$update public.app_settings set value = '$' where key = 'currency'$q$, 1);

  -- ---------------- علامة طارئ ----------------
  perform pg_temp.as_user(u_rep1);
  perform pg_temp.t_ok('مندوب: يأشر طلبه طارئ (حتى بالقرار)', format('select public.inv_set_urgent(%s, true)', i_dec));
  perform pg_temp.t_eq('طارئ: انحفظ', format('select urgent::text from public.invoices where id = %s', i_dec), 'true');
  perform pg_temp.t_denied('مندوب: ما يعدل طارئ مباشرة', format('update public.invoices set urgent = false where id = %s', i_new1));
  perform pg_temp.t_denied('مندوب: ما يأشر طلب غيره', format('select public.inv_set_urgent(%s, true)', i_acc2));
  perform pg_temp.as_user(u_acc);
  perform pg_temp.t_denied('محاسب: ما يأشر طارئ', format('select public.inv_set_urgent(%s, true)', i_acc));
  perform pg_temp.as_user(u_mgr);
  perform pg_temp.t_ok('مدير: يشيل علامة طارئ', format('select public.inv_set_urgent(%s, false)', i_dec));
  perform pg_temp.t_eq('طارئ: انشالت', format('select urgent::text from public.invoices where id = %s', i_dec), 'false');

  -- ---------------- النتيجة ----------------
  perform pg_temp.as_owner();
  msg := current_setting('tst.fail', true);
  if coalesce(msg, '') = '' then
    raise exception 'ALL TESTS PASSED (%)', current_setting('tst.pass', true);
  else
    raise exception E'TESTS FAILED (% passed)%', current_setting('tst.pass', true), msg;
  end if;
end $test$;
