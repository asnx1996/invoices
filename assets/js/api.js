import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { S, changed, hasRole } from './state.js';
import { toast, DAY, setCurrency } from './util.js';

export const configured = /^https:\/\/.+\.supabase\.co$/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 40;
export const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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
  if (!(hasRole('admin') || hasRole('mgr'))) { S.PROFITS = {}; S.COSTS = {}; return }
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
}

export async function saveSetting(key, value) {
  const { error } = await sb.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) { toast(error.message); return false }
  return true;
}

export async function loadAll() {
  await Promise.all([loadProfiles(), loadCustomers(), loadSettings()]);
  await loadInvoices();
}

// طلب واحد تغيّر: نجيبه وحده بدل ما نعيد تحميل كلشي
export async function refreshInvoice(id) {
  const { data } = await sb.from('invoices').select('*').eq('id', id).maybeSingle();
  const i = S.INVOICES.findIndex(x => x.id === id);
  if (data) { if (i >= 0) S.INVOICES[i] = data; else S.INVOICES.push(data) }
  else if (i >= 0) S.INVOICES.splice(i, 1);
  if (data) await loadProfits([id]);
  changed();
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
