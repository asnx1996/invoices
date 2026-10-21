// قواعد البرنامج: الصلاحيات، مواصفات الجداول، وما كان triggers بـ Postgres.
// منقولة من supabase/migrations (الشكل النهائي بعد 022) — نفس الرسائل ونفس الشروط.
import { sql, raw, join } from './db.js';

export class AppError extends Error { constructor(msg, status = 400) { super(msg); this.status = status } }
export const fail = (msg, status) => { throw new AppError(msg, status) };

export const ALL_PERMS = ['create', 'acc', 'approve', 'cust_all', 'complete', 'move', 'urgent_all', 'see_all', 'see_late',
  'see_profit', 'reports', 'export', 'customers', 'users', 'trash'];
const ACTIVE_STAGES = ['new', 'acc', 'decision'];
const STEP_KEY = /^(mgr|cust|wh|s_[a-z0-9]{1,20})$/;
const permOk = x => ALL_PERMS.includes(x) || /^s_[a-z0-9]{1,20}$/.test(x);   // s_xxxx = صلاحية خطوة إضافية (022)

// ---------------------------------------------------------------- مراحل القرار (022)
// app_settings.stages: [{k, n, on, back}] بالترتيب. بدونه: المدير ← الزبون ← المخزن
const DEFAULT_STEPS = [{ k: 'mgr', on: true }, { k: 'cust', on: true }, { k: 'wh', on: true }];
const STEP_NAMES = { mgr: 'موافقة المدير', cust: 'رد الزبون', wh: 'المخزن' };
export async function stageList(r) {
  const row = await r.one(sql`select value from app_settings where [key] = 'stages'`);
  try { const j = row && JSON.parse(row.value); if (Array.isArray(j)) return j } catch (e) { }
  return DEFAULT_STEPS;
}
// الخطوة المفعّلة اللي بعد cur (null = أول خطوة). null = ماكو ← الطلب يكتمل
export function stageNext(list, cur) {
  const at = cur == null ? -1 : list.findIndex(e => e.k === cur);
  return (list.slice(at + 1).find(e => e.on !== false) || {}).k || null;
}
export const stageName = (list, k) => String((list.find(e => e.k === k) || {}).n || '').trim() || STEP_NAMES[k] || k;
export const stageLabel = (list, key) => ({ new: 'طلب جديد', acc: 'الحسابات', done: 'تمت', cancel: 'ملغاة' })[key] || stageName(list, String(key).split(':')[1]);
export const stageBackOk = (list, k) => !!(list.find(e => e.k === k) || {}).back;

// app_settings_stages_guard: فحص الإعداد + ما تنحذف خطوة بيها طلبات شغالة. يرجّع النص المرتب
export async function stagesGuard(r, value, oldValue) {
  let j;
  try { j = JSON.parse(value) } catch (e) { fail('إعداد المراحل غير صالح') }
  if (!Array.isArray(j) || j.length > 20) fail('إعداد المراحل غير صالح');
  const keys = [];
  for (const e of j) {
    if (!e || typeof e !== 'object' || !STEP_KEY.test(e.k || '') || keys.includes(e.k)) fail('مرحلة غير صالحة: ' + ((e && e.k) || '?'));
    if ('n' in e && (typeof e.n !== 'string' || e.n.length > 30)) fail('اسم المرحلة لازم 30 حرف أو أقل');
    if (e.k.startsWith('s_') && !String(e.n || '').trim()) fail('المرحلة الجديدة تحتاج اسم');
    if (('on' in e && typeof e.on !== 'boolean') || ('back' in e && typeof e.back !== 'boolean')) fail('إعداد المراحل غير صالح');
    keys.push(e.k);
  }
  if (!['mgr', 'cust', 'wh'].every(k => keys.includes(k))) fail('المراحل الأساسية تنطفي بس ما تنحذف');
  let old = [];
  try { old = oldValue ? JSON.parse(oldValue) : [] } catch (e) { }
  for (const x of Array.isArray(old) ? old : []) {
    if (keys.includes(x.k)) continue;
    const c = await r.one(sql`select count(*) n from invoices where stage = 'decision' and sub = ${x.k} and deleted_at is null`);
    if (c.n > 0) fail(`ما تكدر تحذف مرحلة "${stageName(old, x.k)}" — بيها ${c.n} طلب. انقلها لمرحلة ثانية أو طفّي المرحلة بدل الحذف`);
  }
  return JSON.stringify(j);
}

// app_settings_stages_cleanup: صلاحيات الخطوات المحذوفة تنشال من الأدوار
export async function stagesCleanup(r, value) {
  const keys = JSON.parse(value).map(e => e.k);
  for (const d of await r.query(sql`select [key], perms from role_defs`)) {
    const p = JSON.parse(d.perms), keep = p.filter(x => !x.startsWith('s_') || keys.includes(x));
    if (keep.length !== p.length) await r.exec(sql`update role_defs set perms = ${JSON.stringify(keep)} where [key] = ${d.key}`);
  }
  dropDefsCache();
}

// ---------------------------------------------------------------- مواصفات الجداول
// cols: الأعمدة اللي تطلع للواجهة. dt: أوقات، date: تاريخ بدون وقت، json: مصفوفات/كائنات، bool: نعم/لا
const T = {
  invoices: {
    pk: 'id',
    cols: ['id', 'board_id', 'customer', 'customer_id', 'quote_no', 'res_no', 'rep_id', 'value', 'pdf_path', 'pdf_name', 'pdf_size',
      'stage', 'sub', 'payment', 'credit_days', 'credit_months', 'payer', 'transport_amt', 'unload_amt', 'ld', 'ld_pct', 'ld_due',
      'from_purch', 'exc', 'exc_reason', 'notes', 'sales_no', 'cancel_reason', 'returned', 'points', 'cost_set', 'urgent',
      'disc_req', 'disc_pct', 'cust_debt', 'debt_amt', 'bal_cur', 'bal_iqd', 'bal_usd', 'debt_cur', 'debt_iqd', 'debt_usd',
      'delete_req_by', 'delete_req_at', 'delete_req_reason', 'deleted_at', 'deleted_by', 'created_by', 'created_at', 'stage_at', 'closed_at'],
    dt: ['delete_req_at', 'deleted_at', 'created_at', 'stage_at', 'closed_at'], date: ['ld_due'],
    bool: ['ld', 'from_purch', 'exc', 'cost_set', 'urgent', 'disc_req', 'cust_debt'],
    upd: ['disc_pct', 'credit_months', 'points', 'debt_usd', 'bal_iqd', 'quote_no', 'debt_iqd', 'credit_days', 'rep_id', 'debt_cur',
      'value', 'res_no', 'debt_amt', 'transport_amt', 'ld_pct', 'ld_due', 'customer_id', 'notes', 'ld', 'bal_usd', 'payer', 'from_purch',
      'customer', 'payment', 'exc_reason', 'bal_cur', 'pdf_name', 'exc', 'cust_debt', 'pdf_path', 'disc_req', 'unload_amt', 'pdf_size'],
  },
  invoice_costs: { pk: 'invoice_id', cols: ['invoice_id', 'cost', 'set_by', 'set_at'], dt: ['set_at'] },
  invoice_log: { pk: 'id', cols: ['id', 'invoice_id', 'actor', 'body', 'at'], dt: ['at'] },
  invoice_stage_log: { pk: 'id', cols: ['id', 'invoice_id', 'stage', 'sub', 'at'], dt: ['at'] },
  invoice_comments: { pk: 'id', cols: ['id', 'invoice_id', 'author', 'body', 'is_system', 'at', 'edited_at'], dt: ['at', 'edited_at'], bool: ['is_system'] },
  comment_reactions: { pk: 'comment_id', cols: ['comment_id', 'user_id', 'emoji', 'at'], dt: ['at'] },
  invoice_notif_prefs: { pk: 'invoice_id', cols: ['user_id', 'invoice_id', 'level'] },
  notifications: { pk: 'id', cols: ['id', 'user_id', 'invoice_id', 'kind', 'actor', 'data', 'created_at', 'read_at'], dt: ['created_at', 'read_at'], json: ['data'], upd: ['read_at'] },
  customers: { pk: 'id', cols: ['id', 'name', 'phone', 'notes', 'active', 'created_at', 'xtra_guid'], dt: ['created_at'], bool: ['active'],
    ins: ['name', 'phone', 'notes', 'active'], upd: ['name', 'phone', 'notes', 'active'] },
  profiles: { pk: 'id', cols: ['id', 'full_name', 'role', 'roles', 'xroles', 'active', 'created_at', 'avatar', 'avatar_chosen', 'notif_level'],
    dt: ['created_at'], json: ['roles', 'xroles'], bool: ['active', 'avatar_chosen'],
    upd: ['full_name', 'role', 'roles', 'xroles', 'active', 'avatar', 'avatar_chosen', 'notif_level'] },
  boards: { pk: 'id', cols: ['id', 'name', 'created_at', 'bg', 'bg_custom', 'blur', 'bg_fit', 'bg_anim', 'has_anim'], dt: ['created_at'], bool: ['has_anim'],
    ins: ['name', 'bg', 'bg_custom', 'blur', 'bg_fit', 'bg_anim', 'has_anim'], upd: ['name', 'bg', 'bg_custom', 'blur', 'bg_fit', 'bg_anim', 'has_anim'] },
  board_members: { pk: 'board_id', cols: ['board_id', 'user_id'], ins: ['board_id', 'user_id'] },
  role_defs: { pk: 'key', cols: ['key', 'name', 'perms', 'builtin', 'created_at'], dt: ['created_at'], json: ['perms'], bool: ['builtin'],
    ins: ['key', 'name', 'perms'], upd: ['name', 'perms'] },
  app_settings: { pk: 'key', cols: ['key', 'value', 'updated_at', 'updated_by'], dt: ['updated_at'], ins: ['key', 'value'], upd: ['value'] },
};
for (const s of Object.values(T)) { s.dt ||= []; s.date ||= []; s.json ||= []; s.bool ||= []; s.ins ||= s.upd || []; s.upd ||= [] }
export const TABLES = T;
export const spec = t => T[t] || fail('جدول غير معروف: ' + t, 404);
export const col = c => raw(`[${c}]`);

// قيمة من الواجهة → قيمة للقاعدة
export function toDb(table, c, v) {
  const s = T[table];
  if (v === undefined || v === null) return null;
  if (s.dt.includes(c)) { const d = new Date(v); if (isNaN(d)) fail('وقت غير صالح: ' + c); return d }
  if (s.bool.includes(c)) return v === true || v === 'true' || v === 1 || v === '1';
  if (s.json.includes(c)) return typeof v === 'string' ? v : JSON.stringify(v);
  if (s.date.includes(c)) return String(v).slice(0, 10);
  return v;
}
// صف من القاعدة → صف للواجهة (نفس شكل PostgREST)
export function fromDb(table, row) {
  if (!row) return row;
  const s = T[table], o = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'name_norm') continue;
    if (s && s.json.includes(k)) o[k] = v == null ? v : JSON.parse(v);
    else if (s && s.date.includes(k)) o[k] = v == null ? v : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    else o[k] = v;
  }
  return o;
}
export const selectCols = (table, list) => join(list.map(c => col(c)));

// ---------------------------------------------------------------- المستخدم الحالي
let defsCache = null;
export const dropDefsCache = () => { defsCache = null };
async function roleDefs(r) {
  if (!defsCache) defsCache = Object.fromEntries((await r.query(sql`select [key], perms from role_defs`)).map(d => [d.key, JSON.parse(d.perms)]));
  return defsCache;
}

// صلاحيات أي مستخدم: نفس user_perm/role_perm/my_boards
export async function loadUser(r, uid) {
  const u = { uid, active: false, admin: false, roles: [], xroles: [], perms: new Set(), boards: [], roleOnly: new Set() };
  if (!uid) return u;
  const p = await r.one(sql`select roles, xroles, active from profiles where id = ${uid}`);
  if (!p || !p.active) return u;
  u.active = true;
  u.roles = JSON.parse(p.roles); u.xroles = JSON.parse(p.xroles);
  u.admin = u.roles.includes('admin');
  const defs = await roleDefs(r);
  for (const k of [...u.roles, ...u.xroles]) for (const x of defs[k] || []) u.roleOnly.add(x);
  u.boards = u.admin
    ? (await r.query(sql`select id from boards`)).map(b => b.id)
    : (await r.query(sql`select board_id from board_members where user_id = ${uid}`)).map(b => b.board_id);
  return u;
}
export const perm = (u, p) => u.admin || u.roleOnly.has(p);   // user_perm
export const rolePerm = (u, p) => u.roleOnly.has(p);          // role_perm (بدون استثناء الأدمن)
export const inBoard = (u, b) => u.boards.includes(b);
export const needActive = u => { if (!u.active) fail('الحساب غير مفعّل', 403) };

// ---------------------------------------------------------------- رؤية الطلبات
// شرط SQL لطلبات يشوفها المستخدم (invoices_read)
export function invoiceVisible(u, alias = '') {
  const a = alias ? alias + '.' : '';
  if (!u.active || !u.boards.length) return raw('1 = 0');
  const parts = [];
  if (perm(u, 'see_all')) parts.push(raw('1 = 1'));
  if (perm(u, 'see_late')) parts.push(raw(`${a}stage in ('decision', 'done')`));
  parts.push(sql`${raw(a + 'rep_id')} = ${u.uid}`);
  return sql`(${raw(a + 'deleted_at')} is null and ${raw(a + 'board_id')} in (${u.boards}) and (${join(parts, ' or ')}))`;
}
// can_see_invoice / user_can_see_invoice على صف محمّل
export const canSee = (u, inv) => !!inv && u.active && inv.deleted_at == null && inBoard(u, inv.board_id)
  && (perm(u, 'see_all') || (perm(u, 'see_late') && ['decision', 'done'].includes(inv.stage)) || inv.rep_id === u.uid);

export async function getInvoice(r, id, lock = false) {
  return fromDb('invoices', await r.one(lock
    ? sql`select * from invoices with (updlock, rowlock) where id = ${id}`
    : sql`select * from invoices where id = ${id}`));
}

export async function addLog(r, u, invId, body) {
  await r.exec(sql`insert into invoice_log (invoice_id, actor, body) values (${invId}, ${u.uid}, ${body})`);
}

// ---------------------------------------------------------------- الإشعارات
const NOTIF_RANK = { new: 1, acc: 2, decision: 3 };
const isImportant = (kind, d) => ['mention', 'turn', 'late'].includes(kind)
  || (kind === 'stage' && (['done', 'cancel'].includes(d.stage) || (NOTIF_RANK[d.stage] || 9) < (NOTIF_RANK[d.from_stage] || 0)));

// إدخال إشعار مع فلتر المستوى (notifications_level_filter) + بث مباشر بعد الحفظ
export async function notify(r, ctx, n) {
  const pref = n.invoice_id != null ? await r.one(sql`select level from invoice_notif_prefs where user_id = ${n.user_id} and invoice_id = ${n.invoice_id}`) : null;
  const prof = pref ? null : await r.one(sql`select notif_level from profiles where id = ${n.user_id}`);
  const lvl = (pref && pref.level) || (prof && prof.notif_level) || 'all';
  if (lvl === 'none') return;
  if (lvl === 'mention' && n.kind !== 'mention') return;
  if (lvl === 'important' && !isImportant(n.kind, n.data)) return;
  const row = await r.one(sql`insert into notifications (user_id, invoice_id, kind, actor, data)
    output inserted.* values (${n.user_id}, ${n.invoice_id}, ${n.kind}, ${n.actor}, ${JSON.stringify(n.data)})`);
  ctx.events.push({ type: 'notification', user_id: n.user_id, row: fromDb('notifications', row) });
}

const userCache = (r, ctx) => async uid => {
  ctx.users ||= new Map();
  if (!ctx.users.has(uid)) ctx.users.set(uid, await loadUser(r, uid));
  return ctx.users.get(uid);
};

// mentioned_users: @الاسم الكامل (الأطول أول حتى "أحمد علي" ما ينحسب "أحمد")
const AR = '؀-ۿ';
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export async function mentionedUsers(r, text) {
  let t = String(text || '');
  if (!t.includes('@')) return [];
  const people = (await r.query(sql`select id, ltrim(rtrim(full_name)) n from profiles where active = 1 and ltrim(rtrim(full_name)) <> ''`))
    .sort((a, b) => b.n.length - a.n.length);
  const out = [];
  for (const p of people) {
    const name = '@' + reEsc(p.n);
    if (new RegExp(name + `([^A-Za-z0-9_${AR}]|$)`).test(t)) {
      out.push(p.id);
      t = t.replace(new RegExp(name, 'g'), ' ');
    }
  }
  return out;
}

// turn_users: منو دوره بهاي المرحلة
async function turnUsers(r, stage, sub, rep) {
  const out = new Set();
  if (rep && (stage === 'new' || (stage === 'decision' && sub === 'cust'))) out.add(rep);
  const need = stage === 'acc' ? ['acc'] : stage === 'decision' && sub === 'mgr' ? ['approve'] : stage === 'decision' && sub === 'wh' ? ['complete']
    : stage === 'decision' && /^s_/.test(sub || '') ? [sub] : null;
  if (need) {
    const people = await r.query(sql`select id from profiles where active = 1`);
    for (const p of people) {
      const u = await loadUser(r, p.id);
      if (!rolePerm(u, need[0])) continue;
      if (stage === 'decision' && sub === 'wh' && rolePerm(u, 'approve')) continue;
      out.add(p.id);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------- تنسيق سجل التعديلات (inv_fmt)
const PAY = { cash: 'نقدي', credit: 'آجل', cheque: 'صك', transfer: 'تحويل' };
const PAYER = { customer: 'على الزبون', company: 'على الشركة', none: 'بدون' };
const CUR = { iqd: 'دينار', usd: 'دولار', both: 'دينار ودولار' };
const LABELS = {
  customer: 'الزبون', quote_no: 'رقم عرض السعر', res_no: 'رقم الحجز', value: 'القيمة', rep_id: 'المندوب', pdf_name: 'ملف PDF',
  payment: 'طريقة السداد', credit_months: 'أشهر الآجل', payer: 'التوصيل', transport_amt: 'أجور النقل', unload_amt: 'أجور التفريغ',
  ld: 'خصم لاحق', ld_pct: 'نسبة الخصم اللاحق', points: 'النقاط', notes: 'الملاحظات', disc_req: 'طلب خصم', disc_pct: 'نسبة طلب الخصم',
  cust_debt: 'على الزبون دين', debt_amt: 'مبلغ الدين', bal_cur: 'عملة الرصيد', bal_iqd: 'الرصيد بالدينار', bal_usd: 'الرصيد بالدولار',
  debt_cur: 'عملة الدين', debt_iqd: 'الدين بالدينار', debt_usd: 'الدين بالدولار',
};
async function fmt(r, k, v) {
  if (v == null || v === '') return '—';
  if (k === 'payment') return PAY[v] || v;
  if (k === 'payer') return PAYER[v] || v;
  if (k === 'bal_cur' || k === 'debt_cur') return CUR[v] || v;
  if (k === 'rep_id') { const p = await r.one(sql`select full_name from profiles where id = ${v}`); return (p && p.full_name) || '—' }
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(v).slice(0, 80);
}
const same = (a, b) => (a instanceof Date ? a.getTime() : a ?? null) === (b instanceof Date ? b.getTime() : b ?? null);

// ---------------------------------------------------------------- تعديل طلب (كل الـ triggers بمكان واحد)
// direct = تعديل مباشر من الواجهة (يمر على invoices_guard)، غيرها = من إجراء بالسيرفر
export async function updateInvoice(r, ctx, id, patch, { direct = false } = {}) {
  const u = ctx.user;
  const old = await getInvoice(r, id, true);
  if (!old) fail('الطلب غير موجود');
  patch = { ...patch };

  // invoices_customer_sync: اسم الزبون من جدول الزبائن
  if ('customer_id' in patch && patch.customer_id != null && patch.customer_id !== old.customer_id) {
    const c = await r.one(sql`select name from customers where id = ${patch.customer_id}`);
    patch.customer = c ? c.name : null;
  }
  // invoices_trash_guard
  const newDeleted = 'deleted_at' in patch ? patch.deleted_at : old.deleted_at;
  if (old.deleted_at != null && newDeleted != null) fail('الطلب بسلة المحذوفات — رجّعه أول');
  // invoices_board_guard
  if (u.uid) {
    if (!inBoard(u, old.board_id)) fail('الطلب مو ضمن بورداتك');
    if ('board_id' in patch && patch.board_id !== old.board_id) {
      if (!u.admin) fail('نقل الطلب لبورد ثاني للأدمن فقط');
      if (!await r.one(sql`select 1 x from boards where id = ${patch.board_id}`)) fail('البورد غير موجود');
    }
  }

  const keys = Object.keys(patch);
  if (!keys.length) return old;
  await r.exec(sql`update invoices set ${join(keys.map(k => sql`${col(k)} = ${toDb('invoices', k, patch[k])}`))} where id = ${id}`);
  const nw = await getInvoice(r, id);
  const changed = T.invoices.cols.filter(k => !same(old[k], nw[k]));

  if (direct) invoicesGuard(u, old, nw, changed);
  if (!changed.length) return nw;

  // invoices_history
  const parts = [];
  for (const k of Object.keys(LABELS)) if (changed.includes(k)) parts.push(`${LABELS[k]}: ${await fmt(r, k, old[k])} ← ${await fmt(r, k, nw[k])}`);
  if (parts.length) await r.exec(sql`insert into invoice_log (invoice_id, actor, body) values (${id}, ${u.uid}, ${'عدّل ' + parts.join('، ')})`);

  const stageChanged = changed.includes('stage') || changed.includes('sub');
  if (stageChanged) {
    // invoices_stage_track
    await r.exec(sql`insert into invoice_stage_log (invoice_id, stage, sub, at) values (${id}, ${nw.stage}, ${nw.sub}, ${nw.stage_at || new Date()})`);
    await notifyStage(r, ctx, old, nw);
  }
  if (changed.includes('notes')) await notifyNotes(r, ctx, old, nw);
  ctx.events.push({ type: 'invoice', id });
  return nw;
}

// invoices_guard: منو يعدل شنو (للتعديل المباشر)
function invoicesGuard(u, old, nw, changed) {
  needActive(u);
  const canBasic = u.admin || (perm(u, 'create') && old.rep_id === u.uid && old.stage === 'new');
  const canTerms = u.admin || (perm(u, 'acc') && old.stage === 'acc');
  const basic = ['customer', 'customer_id', 'quote_no', 'res_no', 'value', 'pdf_path', 'pdf_name', 'pdf_size'];
  const terms = ['payment', 'credit_days', 'credit_months', 'payer', 'transport_amt', 'unload_amt', 'ld', 'ld_pct', 'ld_due', 'from_purch',
    'exc', 'exc_reason', 'notes', 'points', 'cust_debt', 'debt_amt', 'bal_cur', 'bal_iqd', 'bal_usd', 'debt_cur', 'debt_iqd', 'debt_usd'];
  const nums = ['value', 'credit_days', 'transport_amt', 'unload_amt', 'ld_pct', 'pdf_size', 'points', 'disc_pct', 'debt_amt', 'bal_iqd', 'bal_usd', 'debt_iqd', 'debt_usd'];
  for (const k of changed) {
    if (['value', 'disc_req', 'disc_pct'].includes(k)) { if (!(canBasic || canTerms)) fail(`ما عندك صلاحية تعديل ${k}`) }
    else if (basic.includes(k)) { if (!canBasic) fail(`ما عندك صلاحية تعديل ${k}`) }
    else if (terms.includes(k)) { if (!canTerms) fail(`ما عندك صلاحية تعديل ${k}`) }
    else if (k === 'rep_id') { if (!(u.admin && old.stage === 'new')) fail('تغيير المندوب للأدمن فقط وبمرحلة الطلب الجديد') }
    else fail(`الحقل ${k} يتغير فقط عبر الإجراءات`);
    if (nums.includes(k) && (+nw[k] || 0) < 0) fail(`القيمة ${k} ما تكون سالبة`);
  }
  if (changed.includes('ld_pct') && nw.ld_pct > 100) fail('نسبة الخصم ما تتجاوز 100');
  if (changed.includes('disc_pct') && nw.disc_pct > 100) fail('نسبة طلب الخصم ما تتجاوز 100');
  if ((changed.includes('quote_no') || changed.includes('res_no'))
    && String(nw.quote_no || '').trim() && String(nw.res_no || '').trim()) fail('اكتب رقم عرض السعر أو رقم الحجز، مو الاثنين');
}

// notify_stage_change
async function notifyStage(r, ctx, old, nw) {
  const me = ctx.user.uid, see = userCache(r, ctx);
  const owners = [...new Set([nw.rep_id, nw.created_by].filter(Boolean))];
  const d = { stage: nw.stage, sub: nw.sub, from_stage: old.stage, from_sub: old.sub, customer: nw.customer,
    reason: nw.stage === 'cancel' ? nw.cancel_reason : null };
  for (const u of owners) if (u !== me && canSee(await see(u), nw)) await notify(r, ctx, { user_id: u, invoice_id: nw.id, kind: 'stage', actor: me, data: d });
  for (const u of await turnUsers(r, nw.stage, nw.sub, nw.rep_id))
    if (u !== me && !owners.includes(u) && canSee(await see(u), nw)) await notify(r, ctx, { user_id: u, invoice_id: nw.id, kind: 'turn', actor: me, data: d });
}

// notify_notes_mentions: اللي انذكروا جديد بالملاحظات
async function notifyNotes(r, ctx, old, nw) {
  const me = ctx.user.uid, see = userCache(r, ctx);
  const before = new Set(await mentionedUsers(r, old.notes));
  for (const m of await mentionedUsers(r, nw.notes)) {
    if (before.has(m) || m === me || !canSee(await see(m), nw)) continue;
    await notify(r, ctx, { user_id: m, invoice_id: nw.id, kind: 'mention', actor: me,
      data: { src: 'notes', text: String(nw.notes).slice(0, 160), customer: nw.customer } });
  }
}

// إدخال تعليق (يدوي أو من النظام) + إشعارات الذكر والتعليق (notify_comment_mentions)
export async function addComment(r, ctx, invId, body, isSystem) {
  const me = ctx.user.uid, see = userCache(r, ctx);
  const c = await r.one(sql`insert into invoice_comments (invoice_id, author, body, is_system)
    output inserted.* values (${invId}, ${me}, ${body}, ${isSystem})`);
  const inv = await getInvoice(r, invId);
  if (inv) {
    const m = await mentionedUsers(r, body);
    for (const u of m) if (u !== me && canSee(await see(u), inv))
      await notify(r, ctx, { user_id: u, invoice_id: invId, kind: 'mention', actor: me, data: { src: 'comment', text: String(body).slice(0, 160), customer: inv.customer } });
    if (!isSystem) for (const u of new Set([inv.rep_id, inv.created_by].filter(Boolean)))
      if (u !== me && !m.includes(u) && canSee(await see(u), inv))
        await notify(r, ctx, { user_id: u, invoice_id: invId, kind: 'comment', actor: me, data: { text: String(body).slice(0, 160), customer: inv.customer } });
  }
  ctx.events.push({ type: 'invoice', id: invId });
  return fromDb('invoice_comments', c);
}

// ---------------------------------------------------------------- الحقول الإلزامية (fld_req / fld_on)
export async function fields(r) {
  const rows = await r.query(sql`select [key], value from app_settings where [key] in ('opt_fields', 'req_fields')`);
  const list = k => new Set(String((rows.find(x => x.key === k) || {}).value || '').replace(/ /g, '').split(',').filter(Boolean));
  const opt = list('opt_fields'), req = list('req_fields');
  return { req: k => !opt.has(k), on: k => req.has(k) };
}

// ---------------------------------------------------------------- الأرباح (inv_profit_rows)
export function profitRow(i, cost) {
  const total = (+i.value || 0) + (i.payer === 'customer' ? (+i.transport_amt || 0) : 0);
  if (!total) return { invoice_id: i.id, stage: i.stage, total, gross_pct: null, net_pct: null };
  const g = (1 - cost / total) * 100;
  const net = g - (i.ld ? (+i.ld_pct || 0) : 0) - (i.disc_req ? (+i.disc_pct || 0) : 0) - (+i.points || 0) * 1.5;
  const r2 = x => Math.round(x * 100) / 100;
  return { invoice_id: i.id, stage: i.stage, total, gross_pct: r2(g), net_pct: r2(net) };
}

// ---------------------------------------------------------------- صلاحيات الجداول (RLS)
// read: شرط القراءة. ins/upd/del: (u, row, old) → يرمي خطأ إذا ممنوع
const no = () => fail('ما عندك صلاحية', 403);
export const POLICY = {
  invoices: {
    read: u => invoiceVisible(u),
    ins: (u, row) => {
      if (row.stage && row.stage !== 'new') no();
      if (!inBoard(u, row.board_id ?? 1)) no();
      if (!(u.admin || (perm(u, 'create') && row.rep_id === u.uid))) no();
    },
    updUsing: (u, o) => inBoard(u, o.board_id) && (u.admin || (perm(u, 'create') && o.rep_id === u.uid && o.stage === 'new') || (perm(u, 'acc') && o.stage === 'acc')),
    del: u => u.admin,
  },
  invoice_costs: { read: u => u.admin ? raw('1 = 1') : raw('1 = 0') },
  invoice_log: { read: u => sql`exists (select 1 from invoices i where i.id = invoice_id and ${invoiceVisible(u, 'i')})` },
  invoice_stage_log: { read: u => sql`exists (select 1 from invoices i where i.id = invoice_id and ${invoiceVisible(u, 'i')})` },
  invoice_comments: {
    read: u => sql`exists (select 1 from invoices i where i.id = invoice_id and ${invoiceVisible(u, 'i')})`,
  },
  comment_reactions: { read: u => sql`exists (select 1 from invoice_comments c join invoices i on i.id = c.invoice_id where c.id = comment_id and ${invoiceVisible(u, 'i')})` },
  invoice_notif_prefs: { read: u => sql`user_id = ${u.uid}` },
  notifications: {
    read: u => sql`user_id = ${u.uid}`,
    updUsing: (u, o) => o.user_id === u.uid,
    del: (u, o) => o.user_id === u.uid,
  },
  customers: {
    read: u => u.active ? raw('1 = 1') : raw('1 = 0'),
    ins: u => perm(u, 'customers') || no(),
    updUsing: u => perm(u, 'customers'),
    del: u => perm(u, 'customers'),
  },
  profiles: {
    read: u => u.active ? raw('1 = 1') : sql`id = ${u.uid}`,
    updUsing: (u, o) => u.admin || (perm(u, 'users') && !o.roles.includes('admin')),
  },
  boards: {
    read: u => u.boards.length ? sql`id in (${u.boards})` : raw('1 = 0'),
    ins: u => u.admin || no(),
    updUsing: u => u.admin,
  },
  board_members: {
    read: u => u.boards.length ? sql`board_id in (${u.boards})` : raw('1 = 0'),
    ins: (u, row) => (u.admin || (perm(u, 'users') && row.user_id !== u.uid)) || no(),
    del: (u, o) => u.admin || (perm(u, 'users') && o.user_id !== u.uid),
  },
  role_defs: {
    read: u => u.active ? raw('1 = 1') : raw('1 = 0'),
    ins: u => u.admin || no(),
    updUsing: u => u.admin,
    del: (u, o) => u.admin && !o.builtin,
  },
  app_settings: {
    read: u => u.active ? raw('1 = 1') : raw('1 = 0'),
    ins: u => u.admin || no(),
    updUsing: u => u.admin,
  },
};

// قيود الجداول اللي ما تنكتب بسهولة بـ SQL Server (regex)
export function validate(table, row) {
  if (table === 'boards') {
    if (row.bg != null && !/^[a-z0-9-]{1,24}$/.test(row.bg)) fail('خلفية غير معروفة');
    if (row.bg_custom != null && !(/^data:image\/(jpeg|png|webp);base64,/.test(row.bg_custom) && row.bg_custom.length <= 4e6)) fail('الصورة لازم JPG أو PNG أو WEBP وحجمها أقل من 3 ميغا');
    if (row.bg_anim != null && !(/^data:(image\/(gif|webp)|video\/(mp4|webm));base64,/.test(row.bg_anim) && row.bg_anim.length <= 8e6)) fail('الخلفية المتحركة لازم GIF أو WEBP أو MP4 أو WEBM وحجمها أقل من 6 ميغا');
  }
  if (table === 'role_defs') {
    if (row.key != null && (!/^[a-z][a-z0-9_]{1,30}$/.test(row.key) || row.key === 'admin')) fail('مفتاح دور غير صالح');
    if (row.name != null && (!String(row.name).trim() || String(row.name).length > 40)) fail('اسم الدور مطلوب (40 حرف كحد أقصى)');
    if (row.perms != null) {
      const p = typeof row.perms === 'string' ? JSON.parse(row.perms) : row.perms;
      if (!Array.isArray(p) || p.some(x => !permOk(x))) fail('صلاحية غير معروفة');
    }
  }
  if (table === 'profiles' && row.avatar != null && !/^[a-z0-9-]{1,24}$/.test(row.avatar)) fail('صورة غير معروفة');
}

// profiles_roles_sync + profiles_perm_guard
export async function profileBeforeWrite(r, u, nw, old, direct) {
  if (old && nw.role !== old.role && JSON.stringify(nw.roles) === JSON.stringify(old.roles)) nw.roles = [nw.role];
  if (!(nw.roles || []).length && !(nw.xroles || []).length) nw.roles = [nw.role || 'rep'];
  nw.roles = [...new Set(nw.roles || [])].sort();
  nw.xroles = [...new Set(nw.xroles || [])].sort();
  nw.role = ['admin', 'mgr', 'acc', 'wh'].find(x => nw.roles.includes(x)) || 'rep';
  if (nw.roles.some(x => !['rep', 'acc', 'mgr', 'wh', 'admin'].includes(x))) fail('دور غير معروف');
  if (!direct) return;
  const keys = new Set((await r.query(sql`select [key] from role_defs`)).map(d => d.key));
  if (nw.xroles.some(x => !keys.has(x))) fail('دور غير معروف');
  if (u.admin) return;
  if (nw.roles.includes('admin') || (old && old.roles.includes('admin'))) fail('حسابات الأدمن يعدلها الأدمن بس');
  if (old && nw.id === u.uid && (JSON.stringify(nw.roles) !== JSON.stringify(old.roles)
    || JSON.stringify(nw.xroles) !== JSON.stringify(old.xroles) || nw.active !== old.active)) fail('ما تكدر تغير أدوارك');
}

export { ACTIVE_STAGES };
