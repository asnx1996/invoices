// "شوف كأنه": الأدمن يفتح الموقع بعين مستخدم ثاني — نفس البوردات والطلبات والتبويبات والأزرار اللي تطلعله
// للعرض بس: أي حفظ أو إجراء ينمنع. ينحفظ بـ sessionStorage (يخص هاي النافذة) والصفحة تنعاد حتى كلشي يترسم من جديد
// البيانات تنجاب بحساب الأدمن وتنفلتر بالمتصفح بنفس قواعد القاعدة (invoices_read بـ 018)
import { S, userHas } from './state.js';
import { $, esc } from './util.js';

const KEY = 'ib_viewas';
const get = () => { try { return sessionStorage.getItem(KEY) } catch (e) { return null } };
const set = v => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY) } catch (e) { } };

// تغيير الهاش وحده ما يعيد تحميل الصفحة، فنثبّت الرابط ونعيد التحميل
const reload = hash => { history.replaceState(null, '', location.pathname + location.search + hash); location.reload() };
export function startViewAs(id) { set(id); reload('') }
export function stopViewAs() { set(null); reload('#settings') }

// يستدعيها boot بعد ما يعرف المستخدم الحقيقي. ترجّع true إذا صرنا بوضع العرض
export async function applyViewAs(sb) {
  const id = get();
  if (!id) return false;
  if (!(S.ME.roles || []).includes('admin') || id === S.ME.id) { set(null); return false }
  const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!data) { set(null); return false }
  S.REAL = S.ME;
  S.ME = { ...data, roles: data.roles && (data.roles.length || (data.xroles || []).length) ? data.roles : [data.role] };
  S.VIEW_AS = true;
  blockWrites(sb);
  $('#viewAsBar').innerHTML = `<span>تشوف الموقع مثل ما يشوفه <b>${esc(S.ME.full_name)}</b> — للعرض بس، ما ينحفظ أي تعديل</span>
    <button type="button" class="btn sm" id="viewAsExit">رجوع لحسابي</button>`;
  $('#viewAsBar').classList.remove('hidden');
  $('#viewAsExit').onclick = stopViewAs;
  document.documentElement.classList.add('viewing-as');
  return true;
}

// الطلب يطلع للمستخدم المعروض؟ (نفس invoices_read: يشوف الكل، أو القرار والمكتملة، أو طلباته)
export const seenBy = (p, inv) => userHas(p, 'see_all') || (userHas(p, 'see_late') && ['decision', 'done'].includes(inv.stage)) || inv.rep_id === p.id;

// القراءة تبقى، وكل كتابة ترجع خطأ بدون ما توصل للقاعدة
const READ_RPC = new Set(['inv_profits', 'board_stats', 'stage_counts', 'urgent_left', 'cust_last_disc', 'admin_list_logins', 'trash_list', 'xtra_bills']);
const MSG = 'وضع العرض: ما ينحفظ شي — ارجع لحسابك حتى تعدل';
function blocked() {
  const res = { data: null, error: { message: MSG } };
  // سلسلة وهمية: .eq() .select() ... كلها ترجع نفسها، والـ await يرجّع الخطأ
  const q = new Proxy(() => {}, {
    get: (_, k) => k === 'then' ? (ok, bad) => Promise.resolve(res).then(ok, bad) : () => q,
    apply: () => q,
  });
  return q;
}
function blockWrites(sb) {
  const rpc = sb.rpc.bind(sb), from = sb.from.bind(sb), store = sb.storage.from.bind(sb.storage);
  sb.rpc = (fn, args, o) => READ_RPC.has(fn) ? rpc(fn, args, o) : blocked();
  sb.from = t => { const q = from(t); for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = blocked; return q };
  sb.storage.from = b => { const s = store(b); for (const m of ['upload', 'remove', 'update', 'move']) s[m] = blocked; return s };
}
