import { S, getInv, userName, boardName, isReq } from './state.js';
import { sb, rpc, refreshInvoice, loadInvoices } from './api.js';
import { can } from './can.js';
import { ask, toast, num, esc } from './util.js';
import { openDrawer, closeDrawer, reloadActivity } from './drawer.js';

export function waitingOn(inv) {
  if (inv.stage === 'new') return 'المندوب (' + userName(inv.rep_id) + ') يكمل البيانات ويرسل للحسابات';
  if (inv.stage === 'acc') return 'المحاسب يضيف السداد والتوصيل والكلفة';
  if (inv.stage === 'decision') return { mgr: 'المدير يوافق أو يرجع للحسابات', cust: 'المندوب يبلغ الزبون ويأشر الرد', wh: 'المخزن يحول لمبيعات ويدخل الرقم' }[inv.sub];
  return '';
}

const filled = v => String(v ?? '').trim() !== '';

export function missingBasic(inv) {
  const m = [];
  // الأدمن يكدر يخلي بعضها اختياري من صفحة المستخدمين ← إلزامية الحقول
  if (isReq('customer') && !inv.customer_id) m.push('الزبون (من القائمة)');
  if (filled(inv.quote_no) && filled(inv.res_no)) m.push('رقم عرض السعر أو رقم الحجز (واحد منهم فقط)');
  else if (isReq('ref') && !filled(inv.quote_no) && !filled(inv.res_no)) m.push('رقم عرض السعر أو رقم الحجز (واحد منهم فقط)');
  if (isReq('value') && num(inv.value) <= 0) m.push('قيمة الفاتورة');
  if (isReq('pdf') && !inv.pdf_path) m.push('ملف الـ PDF');
  if (inv.disc_req && (num(inv.disc_pct) <= 0 || num(inv.disc_pct) > 100)) m.push('نسبة طلب الخصم');
  return m;
}

export function missingTerms(inv) {
  const m = [];
  if (isReq('payment') && !['cash', 'credit'].includes(inv.payment)) m.push('طريقة السداد (نقدي أو آجل)');
  if (inv.payment === 'credit' && !inv.credit_months) m.push('عدد أشهر الآجل');
  if (isReq('payer') && !['customer', 'none', 'company'].includes(inv.payer)) m.push('النقل: على الزبون أو بدون');
  if (inv.payer === 'customer' && num(inv.transport_amt) <= 0) m.push('مبلغ أجور النقل');
  if (inv.ld && (num(inv.ld_pct) <= 0 || num(inv.ld_pct) > 100)) m.push('نسبة الخصم اللاحق');
  if (isReq('cost') && !inv.cost_set) m.push('سعر الكلفة');
  if (inv.cust_debt && num(inv.debt_amt) <= 0) m.push('مبلغ دين الزبون');
  if (isReq('cust') && 'bal_cur' in inv) {
    if (!inv.bal_cur) m.push('عملة رصيد الزبون');
    if (['iqd', 'both'].includes(inv.bal_cur) && inv.bal_iqd == null) m.push('رصيد الزبون بالدينار');
    if (['usd', 'both'].includes(inv.bal_cur) && inv.bal_usd == null) m.push('رصيد الزبون بالدولار');
  }
  return m;
}

let inFlight = false;
async function step(fn, args, okMsg, id) {
  if (inFlight) return { ok: false }; // ضغطتين سريعة ما تنفذ الإجراء مرتين
  inFlight = true;
  const box = document.querySelector('#drawer .actions');
  if (box) { box.classList.add('busy'); box.setAttribute('aria-busy', 'true') }
  try {
    const r = await rpc(fn, args, okMsg);
    if (r.ok) { S.lastMissing = null; await refreshInvoice(id); reloadActivity(id) }
    return r;
  } finally {
    inFlight = false;
    const b = document.querySelector('#drawer .actions');
    if (b) { b.classList.remove('busy'); b.removeAttribute('aria-busy') }
  }
}

async function deleteInvoice(inv) {
  const r = await rpc('inv_delete', { p_id: inv.id });
  if (!r.ok) return;
  if (r.data) await sb.storage.from('invoices').remove([r.data]); // قبل 016 الحذف نهائي ويرجّع مسار الملف
  closeDrawer(); await loadInvoices(); toast(r.data === null ? 'انتقل الطلب #' + inv.id + ' لسلة المحذوفات' : 'انحذف الطلب #' + inv.id);
}

// أهداف "نقل الطلب" (الأدمن والمدير) — "تمت" مو منها: تحتاج رقم مبيعات من المخزن
const MOVE_TO = { new: 'طلب جديد', acc: 'الحسابات', 'decision:mgr': 'بانتظار موافقة المدير', 'decision:cust': 'بانتظار رد الزبون', 'decision:wh': 'بانتظار تحويل المخزن', cancel: 'ملغاة' };

export const ACTIONS = {
  sendToAcc(inv) {
    const m = missingBasic(inv);
    if (m.length) { S.lastMissing = { id: inv.id, list: m }; openDrawer(inv.id); return toast('أكمل الحقول الناقصة') }
    step('inv_send_to_acc', { p_id: inv.id }, 'انتقل الطلب للحسابات', inv.id);
  },
  sendToDecision(inv) {
    const m = missingTerms(inv);
    if (m.length) { S.lastMissing = { id: inv.id, list: m }; openDrawer(inv.id); return toast('أكمل الشروط الناقصة') }
    step('inv_send_to_decision', { p_id: inv.id }, 'بانتظار موافقة المدير', inv.id);
  },
  approve: inv => step('inv_approve', { p_id: inv.id }, 'تمت الموافقة، بانتظار رد الزبون', inv.id),
  returnToAcc: inv => ask('إرجاع الطلب للحسابات', [{ id: 'r', label: 'سبب الإرجاع (اختياري)', type: 'textarea' }],
    v => step('inv_return_to_acc', { p_id: inv.id, p_reason: v.r || null }, 'رجع الطلب للمحاسب', inv.id)),
  returnToRep: inv => ask('إرجاع الطلب للمندوب', [{ id: 'r', label: 'التعديلات المطلوبة (اختياري)', type: 'textarea', help: 'المندوب يشوفها كتعليق على الطلب ويوصله إشعار' }],
    v => step('inv_return_to_rep', { p_id: inv.id, p_reason: v.r || null }, 'رجع الطلب للمندوب', inv.id)),
  move: inv => {
    const cur = inv.stage + (inv.sub ? ':' + inv.sub : '');
    const opts = Object.entries(MOVE_TO).filter(([k]) => k !== cur).map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
    ask('نقل الطلب #' + inv.id, [{ id: 't', label: 'إلى المرحلة', type: 'select', opts, req: true },
      { id: 'r', label: 'السبب (اختياري)', type: 'textarea', help: 'ينكتب كتعليق على الطلب' }],
      v => step('inv_move', { p_id: inv.id, p_target: v.t, p_reason: v.r || null }, 'انتقل الطلب إلى: ' + MOVE_TO[v.t], inv.id), { okText: 'نقل' });
  },
  custAccept: inv => step('inv_customer_accept', { p_id: inv.id }, 'الزبون موافق، بانتظار المخزن', inv.id),
  custRefuse: inv => ask('الزبون رفض', [{ id: 'r', label: 'سبب الرفض', type: 'textarea', req: true }],
    v => step('inv_customer_refuse', { p_id: inv.id, p_reason: v.r }, 'انتقل الطلب للملغاة', inv.id)),
  complete: inv => ask('تحويل إلى مبيعات', [{ id: 's', label: 'رقم فاتورة المبيعات بالنظام', type: 'text', req: true }],
    v => step('inv_complete', { p_id: inv.id, p_sales_no: v.s }, 'اكتمل الطلب', inv.id)),
  requestDelete: inv => ask('طلب حذف الطلب #' + inv.id, [{ id: 'r', label: 'سبب الحذف', type: 'textarea', req: true, help: 'الطلب يوصل للأدمن وهو يقرر' }],
    v => step('inv_request_delete', { p_id: inv.id, p_reason: v.r }, 'انرسل طلب الحذف للأدمن', inv.id)),
  cancelDeleteReq: inv => step('inv_cancel_delete_request', { p_id: inv.id },
    inv.delete_req_by === S.ME.id ? 'انلغى طلب الحذف' : 'انرفض طلب الحذف', inv.id),
  toggleUrgent: inv => step('inv_set_urgent', { p_id: inv.id, p_on: !inv.urgent }, inv.urgent ? 'انشالت علامة طارئ' : 'انأشر الطلب طارئ', inv.id),
  setBoard: inv => {
    const opts = S.BOARDS.filter(b => b.id !== inv.board_id).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    ask('نقل الطلب #' + inv.id + ' لبورد ثاني', [{ id: 'b', label: 'إلى البورد', type: 'select', opts, req: true,
      help: 'الطلب يختفي من هذا البورد. تأكد إن المندوب عضو بالبورد الجديد حتى يشوفه' }],
      // الطلب يطلع من البورد الحالي، والدرج ينسد وحده (renderDrawer)
      v => step('inv_set_board', { p_id: inv.id, p_board: +v.b }, 'انتقل الطلب لبورد ' + boardName(+v.b), inv.id), { okText: 'نقل' });
  },
  delete: inv => ask('حذف الطلب #' + inv.id, [], () => deleteInvoice(inv),
    { okText: 'حذف', danger: true, msg: 'ينتقل الطلب لسلة المحذوفات (تبويب "المحذوفات")، وتكدر ترجعه منها.' }),
};

// نقل مباشر بدون سؤال (السحب والإفلات للأدمن والمدير)
export function moveTo(inv, target) {
  if (!can('move', inv) || !MOVE_TO[target]) return;
  return step('inv_move', { p_id: inv.id, p_target: target, p_reason: null }, 'انتقل الطلب #' + inv.id + ' إلى: ' + MOVE_TO[target], inv.id);
}

export function run(a, id) {
  const inv = getInv(id); if (!inv) return;
  if (!can(a, inv)) return toast('ما عندك صلاحية. ' + (waitingOn(inv) ? 'بانتظار: ' + waitingOn(inv) : ''));
  ACTIONS[a](inv);
}
