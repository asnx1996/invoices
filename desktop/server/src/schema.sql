-- هيكل قاعدة برنامج الفواتير على SQL Server (نسخة الحاسبة، بدون Supabase).
-- القواعد والصلاحيات كلها بالسيرفر (src/rules.js و src/rpc.js)، هنا بس الجداول والقيود.
-- المعرّفات uuid تنحفظ نص صغير (char 36) حتى تطابق اللي تستخدمه الواجهة حرفياً.
-- الأوقات كلها UTC بـ datetime2.
-- الملف يتشغل مرة وحدة على قاعدة فارغة (src/setup.js)؛ الجمل مفصولة بـ GO.

create table users (
  id char(36) not null primary key,
  login nvarchar(100) not null,
  pass_hash varchar(200) not null,
  created_at datetime2(3) not null default sysutcdatetime(),
  updated_at datetime2(3) not null default sysutcdatetime()
);
create unique index users_login_uniq on users (login);
GO

create table sessions (
  token_hash char(64) not null primary key,
  user_id char(36) not null references users (id) on delete cascade,
  created_at datetime2(3) not null default sysutcdatetime(),
  last_seen datetime2(3) not null default sysutcdatetime()
);
create index sessions_user_idx on sessions (user_id);
GO

create table role_defs (
  [key] nvarchar(40) not null primary key,
  name nvarchar(40) not null,
  perms nvarchar(1000) not null default '[]',      -- مصفوفة JSON
  builtin bit not null default 0,
  created_at datetime2(3) not null default sysutcdatetime(),
  name_norm as lower(ltrim(rtrim(name))) persisted
);
create unique index role_defs_name_uniq on role_defs (name_norm);
GO

create table profiles (
  id char(36) not null primary key references users (id) on delete cascade,
  full_name nvarchar(200) not null default '',
  role varchar(10) not null default 'rep' check (role in ('rep', 'acc', 'mgr', 'wh', 'admin')),
  roles nvarchar(200) not null default '[]',       -- مصفوفة JSON
  xroles nvarchar(1000) not null default '[]',     -- مصفوفة JSON
  active bit not null default 0,
  created_at datetime2(3) not null default sysutcdatetime(),
  avatar varchar(24) null,
  avatar_chosen bit not null default 0,
  notif_level varchar(10) not null default 'all' check (notif_level in ('all', 'important', 'mention', 'none'))
);
GO

create table boards (
  id int identity(1, 1) not null primary key,
  name nvarchar(200) not null,
  created_at datetime2(3) not null default sysutcdatetime(),
  bg varchar(24) null,
  bg_custom varchar(max) null,
  blur smallint not null default 0 check (blur between 0 and 30),
  bg_fit varchar(10) not null default 'cover' check (bg_fit in ('cover', 'contain')),
  bg_anim varchar(max) null,
  has_anim bit null,
  constraint boards_name_check check (ltrim(rtrim(name)) <> '')
);
create unique index boards_name_key on boards (name);
GO

create table board_members (
  board_id int not null references boards (id) on delete cascade,
  user_id char(36) not null references profiles (id) on delete cascade,
  primary key (board_id, user_id)
);
create index board_members_user_idx on board_members (user_id);
GO

create table customers (
  id int identity(1, 1) not null primary key,
  name nvarchar(400) not null,
  phone nvarchar(100) not null default '',
  notes nvarchar(max) not null default '',
  active bit not null default 1,
  created_at datetime2(3) not null default sysutcdatetime(),
  name_norm as lower(ltrim(rtrim(name))) persisted,
  xtra_guid char(36) null,          -- الوكيل المقابل بإكسترا
  constraint customers_name_check check (ltrim(rtrim(name)) <> '')
);
create unique index customers_name_uniq on customers (name_norm);
create unique index customers_xtra_uniq on customers (xtra_guid) where xtra_guid is not null;
GO

create table app_settings (
  [key] nvarchar(100) not null primary key,
  value nvarchar(max) not null,
  updated_at datetime2(3) not null default sysutcdatetime(),
  updated_by char(36) null
);
GO

create table invoices (
  id int identity(1, 1) not null primary key,
  board_id int not null default 1 references boards (id),
  customer nvarchar(400) null default '',
  customer_id int null references customers (id) on delete set null,
  quote_no nvarchar(100) not null default '',
  res_no nvarchar(100) not null default '',
  rep_id char(36) null references profiles (id),
  value decimal(20, 4) null default 0,
  pdf_path nvarchar(400) null,
  pdf_name nvarchar(400) null,
  pdf_size int null,
  stage varchar(10) null default 'new' check (stage in ('new', 'acc', 'decision', 'done', 'cancel')),
  sub varchar(10) null check (sub in ('mgr', 'cust', 'wh')),
  payment varchar(10) null check (payment in ('cash', 'credit', 'cheque', 'transfer')),
  credit_days int null,
  credit_months smallint null check (credit_months between 1 and 3),
  payer varchar(10) null check (payer in ('none', 'company', 'customer')),
  transport_amt decimal(20, 4) null default 0,
  unload_amt decimal(20, 4) null default 0,
  ld bit null default 0,
  ld_pct decimal(9, 4) null,
  ld_due date null,
  from_purch bit null default 0,
  exc bit null default 0,
  exc_reason nvarchar(max) null default '',
  notes nvarchar(max) not null default '',
  sales_no nvarchar(100) not null default '',
  cancel_reason nvarchar(max) not null default '',
  returned int null default 0,
  points decimal(9, 4) not null default 0 check (points between 0 and 100),
  cost_set bit not null default 0,
  urgent bit not null default 0,
  disc_req bit not null default 0,
  disc_pct decimal(9, 4) null,
  cust_debt bit null,
  debt_amt decimal(20, 4) null,
  bal_cur varchar(4) null check (bal_cur in ('iqd', 'usd', 'both')),
  bal_iqd decimal(20, 4) null,
  bal_usd decimal(20, 4) null,
  debt_cur varchar(4) null check (debt_cur in ('iqd', 'usd', 'both')),
  debt_iqd decimal(20, 4) null,
  debt_usd decimal(20, 4) null,
  delete_req_by char(36) null,
  delete_req_at datetime2(3) null,
  delete_req_reason nvarchar(max) null,
  deleted_at datetime2(3) null,
  deleted_by char(36) null,
  created_by char(36) null,
  created_at datetime2(3) null default sysutcdatetime(),
  stage_at datetime2(3) null default sysutcdatetime(),
  closed_at datetime2(3) null
);
create index invoices_board_idx on invoices (board_id);
create index invoices_stage_idx on invoices (stage, closed_at);
create index invoices_deleted_idx on invoices (deleted_at) where deleted_at is not null;
GO

create table invoice_costs (
  invoice_id int not null primary key references invoices (id) on delete cascade,
  cost decimal(20, 4) not null check (cost > 0),
  set_by char(36) null,
  set_at datetime2(3) not null default sysutcdatetime()
);
GO

create table invoice_log (
  id int identity(1, 1) not null primary key,
  invoice_id int null references invoices (id) on delete cascade,
  actor char(36) null,
  body nvarchar(max) null,
  at datetime2(3) null default sysutcdatetime()
);
create index invoice_log_inv_idx on invoice_log (invoice_id);
GO

create table invoice_stage_log (
  id int identity(1, 1) not null primary key,
  invoice_id int not null references invoices (id) on delete cascade,
  stage varchar(10) not null,
  sub varchar(10) null,
  at datetime2(3) not null default sysutcdatetime()
);
create index invoice_stage_log_inv on invoice_stage_log (invoice_id, at);
GO

create table invoice_comments (
  id int identity(1, 1) not null primary key,
  invoice_id int null references invoices (id) on delete cascade,
  author char(36) null,
  body nvarchar(max) null,
  is_system bit null default 0,
  at datetime2(3) null default sysutcdatetime(),
  edited_at datetime2(3) null
);
create index invoice_comments_inv_idx on invoice_comments (invoice_id);
GO

-- بدون cascade على المستخدم: SQL Server يرفض أكثر من مسار cascade لنفس الجدول؛ السيرفر يحذفها قبل حذف المستخدم
create table comment_reactions (
  comment_id int not null references invoice_comments (id) on delete cascade,
  user_id char(36) not null references profiles (id),
  emoji nvarchar(10) not null,
  at datetime2(3) not null default sysutcdatetime(),
  primary key (comment_id, user_id, emoji)
);
GO

create table invoice_notif_prefs (
  user_id char(36) not null references profiles (id),
  invoice_id int not null references invoices (id) on delete cascade,
  level varchar(10) not null check (level in ('all', 'important', 'mention', 'none')),
  primary key (user_id, invoice_id)
);
create index invoice_notif_prefs_invoice_idx on invoice_notif_prefs (invoice_id);
GO

create table notifications (
  id int identity(1, 1) not null primary key,
  user_id char(36) not null references profiles (id),
  invoice_id int null references invoices (id) on delete cascade,
  kind varchar(10) not null check (kind in ('stage', 'mention', 'comment', 'turn', 'late')),
  actor char(36) null,
  data nvarchar(max) not null default '{}',       -- JSON
  created_at datetime2(3) not null default sysutcdatetime(),
  read_at datetime2(3) null
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_invoice_idx on notifications (invoice_id);
GO

-- القيم الأولية: نفس اللي بالـ migrations
insert into boards (name) values (N'المنطقة الوسطى');
insert into role_defs ([key], name, perms, builtin) values
  ('rep', N'مندوب', '["create"]', 1),
  ('acc', N'محاسب', '["acc","see_all","export"]', 1),
  ('mgr', N'مدير', '["approve","cust_all","complete","move","urgent_all","see_all","see_profit","reports","export"]', 1),
  ('wh', N'مخزن', '["complete","see_late"]', 1);
insert into app_settings ([key], value) values ('currency', N'$');   -- قيمة الفاتورة تنحفظ بالدولار
GO
