import { S, COLS, SUB, PAY, PAY_LEGACY, PAYER, PAYER_LEGACY, MONTHS, userName, reps, hasRole, hasTerms, ldAmount, totalAfterTransport, pointsPct } from './state.js';
import { sb, fetchAll } from './api.js';
import { $, esc, num, ask, toast, ymd, dOnly, DAY } from './util.js';

export function initExport() {
  $('#exportBtn').onclick = () => {
    const now = new Date(), q = Math.floor(now.getMonth() / 3);
    ask('تصدير Excel', [
      { id: 'from', label: 'من تاريخ (الإنشاء)', type: 'date', value: ymd(new Date(now.getFullYear(), q * 3, 1)) },
      { id: 'to', label: 'إلى تاريخ', type: 'date', value: ymd(now) },
      { id: 'rep', label: 'المندوب', type: 'select', opts: '<option value="all">الكل</option>' + reps().map(r => `<option value="${esc(r.id)}">${esc(r.full_name)}</option>`).join('') },
      { id: 'st', label: 'الحالة', type: 'select', opts: '<option value="all">الكل</option>' + COLS.map(c => `<option value="${c.k}">${c.t}</option>`).join('') },
    ], exportXlsx, { okText: 'تصدير' });
  };
}

async function exportXlsx(v) {
  if (typeof XLSX === 'undefined') return toast('مكتبة Excel ما تحملت');
  toast('جاري التجهيز...');
  // من القاعدة مباشرة حتى يشمل الطلبات القديمة اللي مو محمّلة باللوحة
  let rows;
  try {
    rows = await fetchAll(() => {
      let q = sb.from('invoices').select('*').order('id');
      if (v.from) q = q.gte('created_at', new Date(v.from + 'T00:00').toISOString());
      if (v.to) q = q.lt('created_at', new Date(new Date(v.to + 'T00:00').getTime() + DAY).toISOString());
      if (v.rep !== 'all') q = q.eq('rep_id', v.rep);
      if (v.st !== 'all') q = q.eq('stage', v.st);
      return q;
    });
  } catch (e) { return toast(e.message) }
  if (!rows.length) return toast('ماكو طلبات بهاي الفلترة');

  const seeProfit = hasRole('admin') || hasRole('mgr'), admin = hasRole('admin');
  const profits = {}, costs = {};
  if (seeProfit) {
    const { data } = await sb.rpc('inv_profits', { p_ids: rows.map(r => r.id) });
    (data || []).forEach(p => profits[p.invoice_id] = p);
  }
  if (admin) {
    const all = await fetchAll(() => sb.from('invoice_costs').select('invoice_id,cost').order('invoice_id')).catch(() => []);
    all.forEach(c => costs[c.invoice_id] = c.cost);
  }

  const stName = i => COLS.find(c => c.k === i.stage).t + (i.stage === 'decision' ? ' - ' + SUB[i.sub] : '');
  const data = rows.map(i => {
    const p = profits[i.id];
    const row = {
      'رقم الطلب': i.id, 'رقم عرض السعر': i.quote_no, 'رقم الحجز': i.res_no, 'الزبون': i.customer, 'المندوب': userName(i.rep_id),
      'قيمة الفاتورة': num(i.value), 'طريقة السداد': PAY[i.payment] || PAY_LEGACY[i.payment] || '', 'مدة الآجل': MONTHS[i.credit_months] || '',
      'التوصيل': PAYER[i.payer] || PAYER_LEGACY[i.payer] || '', 'أجور النقل': num(i.transport_amt) || '', 'الإجمالي بعد النقل': totalAfterTransport(i),
      'أجور التفريغ': num(i.unload_amt) || '', 'النقاط': num(i.points) || '', 'نسبة النقاط %': num(i.points) ? pointsPct(i) : '',
      'خصم لاحق %': i.ld ? num(i.ld_pct) : '', 'مبلغ الخصم اللاحق': i.ld ? ldAmount(i) : '',
    };
    if (admin) row['سعر الكلفة'] = costs[i.id] != null ? num(costs[i.id]) : '';
    if (seeProfit) { row['الربح %'] = p ? num(p.gross_pct) : ''; row['صافي الربح %'] = p ? num(p.net_pct) : '' }
    Object.assign(row, {
      'خاضعة لشروط': hasTerms(i) ? 'نعم' : 'لا', 'مرات الإرجاع': i.returned, 'الحالة': stName(i), 'رقم المبيعات': i.sales_no, 'سبب الإلغاء': i.cancel_reason,
      'طلب حذف': i.delete_req_at ? 'نعم' : '', 'تاريخ الإنشاء': dOnly(i.created_at), 'تاريخ الإغلاق': i.closed_at ? dOnly(i.closed_at) : '',
      'مدة الطلب (يوم)': i.closed_at ? +((new Date(i.closed_at) - new Date(i.created_at)) / DAY).toFixed(1) : '',
    });
    return row;
  });

  const byRep = {};
  rows.forEach(i => {
    const k = userName(i.rep_id);
    const r = byRep[k] || (byRep[k] = { 'المندوب': k, 'عدد الطلبات': 0, 'مكتملة': 0, 'ملغاة': 0, 'قيمة المكتملة': 0, 'خصومات لاحقة': 0 });
    r['عدد الطلبات']++;
    if (i.stage === 'done') { r['مكتملة']++; r['قيمة المكتملة'] += num(i.value) }
    if (i.stage === 'cancel') r['ملغاة']++;
    if (i.stage !== 'cancel') r['خصومات لاحقة'] += ldAmount(i);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = Object.keys(data[0]).map(() => ({ wch: 16 }));
  const sum = Object.values(byRep);
  const ws2 = XLSX.utils.json_to_sheet(sum); ws2['!cols'] = Object.keys(sum[0]).map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, ws, 'الطلبات'); XLSX.utils.book_append_sheet(wb, ws2, 'ملخص المندوبين');
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.writeFile(wb, `فواتير-المبيعات-${v.from || ''}_${v.to || ''}.xlsx`);
  toast('تم تصدير ' + rows.length + ' طلب');
}
