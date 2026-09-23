import { S, getInv, userName } from './state.js';
import { sb, rpc, refreshInvoice, loadInvoices } from './api.js';
import { can } from './can.js';
import { ask, toast, num } from './util.js';
import { openDrawer, closeDrawer } from './drawer.js';

export function waitingOn(inv) {
  if (inv.stage === 'new') return 'المندوب (' + userName(inv.rep_id) + ') يكمل البيانات ويرسل للحسابات';
  if (inv.stage === 'acc') return 'المحاسب يضيف السداد والتوصيل والكلفة';
  if (inv.stage === 'decision') return { mgr: 'المدير يوافق أو يرجع للحسابات', cust: 'المندوب يبلغ الزبون ويأشر الرد', wh: 'المخزن يحول لمبيعات ويدخل الرقم' }[inv.sub];
  return '';
}

const filled = v => String(v ?? '').trim() !== '';

export function missingBasic(inv) {
  const m = [];
  if (!inv.customer_id) m.push('الزبون (من القائمة)');
  if (filled(inv.quote_no) === filled(inv.res_no)) m.push('رقم عرض السعر أو رقم الحجز (واحد منهم فقط)');
  if (num(inv.value) <= 0) m.push('قيمة الفاتورة');
  if (!inv.pdf_path) m.push('ملف الـ PDF');
  return m;
}

export function missingTerms(inv) {
  const m = [];
  if (!['cash', 'credit'].includes(inv.payment)) m.push('طريقة السداد (نقدي أو آجل)');
  if (inv.payment === 'credit' && !inv.credit_months) m.push('عدد أشهر الآجل');
  if (!['customer', 'company'].includes(inv.payer)) m.push('التوصيل: على الزبون أو على الشركة');
  if (inv.payer === 'customer' && num(inv.transport_amt) <= 0) m.push('مبلغ أجور النقل');
  if (inv.ld && (num(inv.ld_pct) <= 0 || num(inv.ld_pct) > 100)) m.push('نسبة الخصم اللاحق');
  if (!inv.cost_set) m.push('سعر الكلفة');
  return m;
}

async function step(fn, args, okMsg, id) {
  const r = await rpc(fn, args, okMsg);
  if (r.ok) { S.lastMissing = null; await refreshInvoice(id) }
  return r;
}

async function deleteInvoice(inv) {
  const r = await rpc('inv_delete', { p_id: inv.id });
  if (!r.ok) return;
  if (r.data) await sb.storage.from('invoices').remove([r.data]);
  closeDrawer(); await loadInvoices(); toast('انحذف الطلب #' + inv.id);
}

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
  returnToAcc: inv => ask('إرجاع الطلب للحسابات', [{ id: 'r', label: 'سبب الإرجاع', type: 'textarea', req: true }],
    v => step('inv_return_to_acc', { p_id: inv.id, p_reason: v.r }, 'رجع الطلب للمحاسب', inv.id)),
  custAccept: inv => step('inv_customer_accept', { p_id: inv.id }, 'الزبون موافق، بانتظار المخزن', inv.id),
  custRefuse: inv => ask('الزبون رفض', [{ id: 'r', label: 'سبب الرفض', type: 'textarea', req: true }],
    v => step('inv_customer_refuse', { p_id: inv.id, p_reason: v.r }, 'انتقل الطلب للملغاة', inv.id)),
  complete: inv => ask('تحويل إلى مبيعات', [{ id: 's', label: 'رقم فاتورة المبيعات بالنظام', type: 'text', req: true }],
    v => step('inv_complete', { p_id: inv.id, p_sales_no: v.s }, 'اكتمل الطلب', inv.id)),
  requestDelete: inv => ask('طلب حذف الطلب #' + inv.id, [{ id: 'r', label: 'سبب الحذف', type: 'textarea', req: true, help: 'الطلب يوصل للأدمن وهو يقرر' }],
    v => step('inv_request_delete', { p_id: inv.id, p_reason: v.r }, 'انرسل طلب الحذف للأدمن', inv.id)),
  cancelDeleteReq: inv => step('inv_cancel_delete_request', { p_id: inv.id },
    inv.delete_req_by === S.ME.id ? 'انلغى طلب الحذف' : 'انرفض طلب الحذف', inv.id),
  delete: inv => ask('حذف الطلب #' + inv.id + ' نهائياً', [{ id: 'c', label: 'اكتب "حذف" للتأكيد', type: 'text', req: true, help: 'ينحذف الطلب وملفه وتعليقاته وسجله. ما يرجع.' }],
    v => v.c.trim() === 'حذف' ? deleteInvoice(inv) : toast('ما تم الحذف'), { okText: 'حذف نهائي' }),
};

export function run(a, id) {
  const inv = getInv(id); if (!inv) return;
  if (!can(a, inv)) return toast('ما عندك صلاحية. ' + (waitingOn(inv) ? 'بانتظار: ' + waitingOn(inv) : ''));
  ACTIONS[a](inv);
}
