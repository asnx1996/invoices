import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { S, changed, hasRole, hasPerm, getBoard, DEFAULT_ROLE_DEFS } from './state.js';
import { toast, DAY, setCurrency, setRate } from './util.js';

import { createLocalClient } from './local-client.js';

// النسخة المحلية (برنامج الحاسبة): السيرفر يعرّف window.__LOCAL_API__ وكلشي يروح له بدل Supabase
export const LOCAL = !!window.__LOCAL_API__;
export const configured = LOCAL || (/^https:\/\/.+\.supabase\.co$/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 40);
export const sb = LOCAL ? createLocalClient(window.__LOCAL_API__) : configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// الفترة المحمّلة: الطلبات الشغالة دائماً + المغلقة خلال هاي الأيام (0 = الكل)
let rangeDays = 90;
try { rangeDays = +(localStorage.getItem('ib_range') ?? 90) } catch (e) { }
export const getRange = () => rangeDays;
export function setRange(d) { rangeDays = d; try { localStorage.setItem('ib_range', d) } catch (e) { } return loadInvoices() }

// PostgREST يرجع 1000 صف بالمرة كحد أقصى — نجيب على دفعات
export async function fetchAll(build, size = 1000) {
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) return out;
  }
}

const invoiceQuery = () => {
  let q = sb.from('invoices').select('*').order('stage_at', { ascending: true });
  if (S.board) q = q.eq('board_id', S.board);
  if (rangeDays > 0) q = q.or(`stage.in.(new,acc,decision),closed_at.gte.${new Date(Date.now() - rangeDays * DAY).toISOString()}`);
  return q;
};

export async function loadInvoices() {
  try { S.INVOICES = await fetchAll(invoiceQuery) } catch (e) { toast(e.message) }
  S.loaded = true;
  await loadProfits();
  changed();
}

export async function loadProfits(ids = null) {
  if (!hasPerm('see_profit')) { S.PROFITS = {}; S.COSTS = {}; return }
  const { data, error } = await sb.rpc('inv_profits', { p_ids: ids });
  if (error) return toast(error.message);
  if (!ids) S.PROFITS = {};
  (data || []).forEach(p => S.PROFITS[p.invoice_id] = p);
  if (hasRole('admin')) {
    let q = sb.from('invoice_costs').select('invoice_id,cost');
    if (ids) q = q.in('invoice_id', ids);
    const c = await q;
    if (!c.error) (c.data || []).forEach(r => S.COSTS[r.invoice_id] = r.cost);
  }
}

export async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*').order('full_name');
  if (error) toast(error.message); else S.PROFILES = data || [];
}

export async function loadCustomers() {
  try { S.CUSTOMERS = await fetchAll(() => sb.from('customers').select('*').order('name')) }
  catch (e) { toast(e.message) }
}

export async function loadSettings() {
  const { data, error } = await sb.from('app_settings').select('key,value');
  if (error) return; // قبل ما تتشغل 005 نبقى على الافتراضي
  const m = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  setCurrency(m.currency);
  setRate(m.usd_rate);
  const list = v => new Set(String(v || '').split(',').map(x => x.trim()).filter(Boolean));
  S.OPT = list(m.opt_fields);
  S.REQX = list(m.req_fields);
}

// الأدوار وصلاحياتها (018). قبلها نبقى على الافتراضي
export async function loadRoleDefs() {
  const { data, error } = await sb.from('role_defs').select('key,name,perms,builtin').order('created_at');
  S.HAS_ROLEDEFS = !error;
  S.ROLEDEFS = error ? DEFAULT_ROLE_DEFS : data || [];
}

export async function saveSetting(key, value) {
  const { error } = await sb.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) { toast(error.message); return false }
  return true;
}

// البوردات اللي يشوفها المستخدم + أعضاءها. قبل ما تتشغل 012 الجدول ما موجود: S.BOARDS يبقى null
export async function loadBoards() {
  // الأعمدة الأحدث أول؛ إذا migration بعده ما انشغل نرجع خطوة (016 ← 014 ← 013 ← 012)
  const cols = ['id,name,bg,bg_custom,blur,bg_fit,has_anim', 'id,name,bg,bg_custom,blur,bg_fit', 'id,name,bg,bg_custom,blur', 'id,name'];
  let [b, m] = await Promise.all([sb.from('boards').select(cols[0]).order('id'), sb.from('board_members').select('board_id,user_id')]);
  for (let i = 1; b.error && i < cols.length; i++) b = await sb.from('boards').select(cols[i]).order('id');
  S.boardsLoaded = true;
  if (b.error) { S.BOARDS = null; S.MEMBERS = []; S.board = null; return }
  S.BOARDS = b.data || []; S.MEMBERS = m.data || [];
  loadBoardStats();
  let saved = null; try { saved = +localStorage.getItem('ib_board') } catch (e) { }
  S.board = (S.BOARDS.find(x => x.id === saved) || S.BOARDS[0] || {}).id ?? null;
}

export async function loadBoardStats() {
  const { data, error } = await sb.rpc('board_stats');
  S.STATS = error ? {} : Object.fromEntries((data || []).map(r => [r.board_id, r]));
  changed();
}

// خلفية البورد وضبابيته (الأدمن)
export async function saveBoardLook(id, patch) {
  const { error } = await sb.from('boards').update(patch).eq('id', id);
  if (error) { toast(error.message); return false }
  Object.assign(getBoard(id) || {}, patch); changed();
  return true;
}

// الخلفية المتحركة ثقيلة: تنجاب وحدها بس على الحاسبة (016)
export async function loadBoardAnim(id) {
  const { data, error } = await sb.from('boards').select('bg_anim').eq('id', id).maybeSingle();
  return error || !data ? null : data.bg_anim;
}

export async function loadNotifPrefs() {
  const { data, error } = await sb.from('invoice_notif_prefs').select('invoice_id,level');
  S.NPREFS = error ? {} : Object.fromEntries((data || []).map(r => [r.invoice_id, r.level]));
}

export async function setBoard(id) {
  if (id === S.board) return;
  S.board = id; try { localStorage.setItem('ib_board', id) } catch (e) { }
  S.INVOICES = []; S.loaded = false; changed();
  await loadInvoices();
}

export async function loadAll() {
  await Promise.all([loadProfiles(), loadCustomers(), loadSettings(), loadBoards(), loadNotifPrefs()]);
  await loadInvoices();
}

// طلب واحد تغيّر: نجيبه وحده بدل ما نعيد تحميل كلشي
export async function refreshInvoice(id) {
  let { data } = await sb.from('invoices').select('*').eq('id', id).maybeSingle();
  if (data && S.board && data.board_id !== S.board) data = null;  // انتقل لبورد ثاني
  const i = S.INVOICES.findIndex(x => x.id === id);
  if (data) { if (i >= 0) S.INVOICES[i] = data; else S.INVOICES.push(data) }
  else if (i >= 0) S.INVOICES.splice(i, 1);
  if (data) await loadProfits([id]);
  changed();
}

// طلب من إشعار أو رابط: إذا ببورد ثاني نحول له أول. يرجّع true إذا صار موجود
export async function findInvoice(id) {
  if (S.INVOICES.some(x => x.id === id)) return true;
  if (S.BOARDS) {
    const { data } = await sb.from('invoices').select('board_id').eq('id', id).maybeSingle();
    if (!data) return false;
    if (data.board_id !== S.board) await setBoard(data.board_id);
  }
  if (!S.INVOICES.some(x => x.id === id)) await refreshInvoice(id); // ممكن طلب مغلق قديم مو ضمن الفترة المحمّلة
  return S.INVOICES.some(x => x.id === id);
}

let chan = null;
const pending = new Set();
const flush = () => { const ids = [...pending]; pending.clear(); ids.forEach(refreshInvoice) };
let flushT;
export function subscribe() {
  unsubscribe();
  chan = sb.channel('board')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, p => {
      const id = (p.new && p.new.id) || (p.old && p.old.id);
      if (!id) return;
      pending.add(id); clearTimeout(flushT); flushT = setTimeout(flush, 300);
    })
    .subscribe();
}
export function unsubscribe() { if (chan) { sb.removeChannel(chan); chan = null } }

// نداء دالة بالقاعدة + رسالة
export async function rpc(fn, args, okMsg) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { toast(error.message); return { ok: false } }
  if (okMsg) toast(okMsg);
  return { ok: true, data };
}
