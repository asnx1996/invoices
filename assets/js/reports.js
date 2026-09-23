import { rpc } from './api.js';
import { $, esc, fmt, money, pct, ymd } from './util.js';

const STAGE_LABEL = { new: 'طلب جديد (المندوب)', acc: 'الحسابات', 'decision:mgr': 'موافقة المدير', 'decision:cust': 'رد الزبون', 'decision:wh': 'تحويل المخزن' };
const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const monthLabel = m => { const [y, mm] = m.split('-'); return `${MONTHS_AR[+mm - 1]} ${y}` };

// عمود بشريط أفقي (قيمة واحدة لكل صف، لون واحد)
const bar = (v, max, text) => `<div class="barcell" title="${esc(text)}"><div class="bar" style="width:${max > 0 ? Math.max(2, Math.round(v / max * 100)) : 0}%"></div><span>${esc(text)}</span></div>`;

export function initReports() {
  const now = new Date();
  $('#repFrom').value = ymd(new Date(now.getFullYear(), 0, 1));
  $('#repTo').value = ymd(now);
  $('#repGo').onclick = renderReports;
}

export async function renderReports() {
  const box = $('#repOut');
  box.innerHTML = '<div class="loading">جاري التحميل...</div>';
  const r = await rpc('report_summary', { p_from: $('#repFrom').value, p_to: $('#repTo').value });
  if (!r.ok) { box.innerHTML = ''; return }
  const d = r.data, t = d.totals;

  const tiles = [
    ['عدد الطلبات', fmt(t.count), `${fmt(t.active)} قيد العمل`],
    ['مكتملة', fmt(t.done), money(t.done_value)],
    ['ملغاة', fmt(t.cancel), t.count ? pct(t.cancel / t.count * 100) + ' من الطلبات' : ''],
    ['متأخرة الآن', fmt(t.late), '3 أيام+ بنفس المرحلة'],
    ['متوسط مدة الطلب', t.avg_cycle_days == null ? '—' : fmt(t.avg_cycle_days) + ' يوم', 'للمكتملة'],
    ['متوسط صافي الربح', pct(t.avg_net_pct), 'للمكتملة'],
  ].map(s => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${s[1]}</div><div class="s">${s[2]}</div></div>`).join('');

  const maxStage = Math.max(0, ...d.stages.map(s => +s.avg_days || 0));
  const stages = d.stages.map(s => `<tr><td>${esc(STAGE_LABEL[s.key] || s.key)}</td>
    <td>${bar(+s.avg_days || 0, maxStage, fmt(s.avg_days) + ' يوم')}</td><td class="num">${fmt(s.n)}</td></tr>`).join('');

  const maxRep = Math.max(0, ...d.by_rep.map(x => +x.done_value || 0));
  const byRep = d.by_rep.map(x => `<tr><td>${esc(x.rep)}</td><td class="num">${fmt(x.total)}</td><td class="num">${fmt(x.active)}</td>
    <td class="num">${fmt(x.done)}</td><td class="num">${fmt(x.cancel)}</td>
    <td>${bar(+x.done_value || 0, maxRep, money(x.done_value))}</td>
    <td class="num">${x.avg_cycle_days == null ? '—' : fmt(x.avg_cycle_days)}</td><td class="num">${pct(x.avg_net_pct)}</td></tr>`).join('');

  const maxMonth = Math.max(0, ...d.by_month.map(x => +x.value || 0));
  const byMonth = d.by_month.map(x => `<tr><td>${monthLabel(x.month)}</td><td class="num">${fmt(x.done)}</td>
    <td>${bar(+x.value || 0, maxMonth, money(x.value))}</td><td class="num">${pct(x.avg_net_pct)}</td></tr>`).join('');

  const maxReason = Math.max(0, ...d.cancel_reasons.map(x => +x.n));
  const reasons = d.cancel_reasons.map(x => `<tr><td>${esc(x.reason)}</td><td>${bar(+x.n, maxReason, fmt(x.n))}</td></tr>`).join('');

  const empty = cols => `<tr><td colspan="${cols}" class="muted">ماكو بيانات بهاي الفترة</td></tr>`;
  box.innerHTML = `<div class="tiles">${tiles}</div>
    <div class="panel"><h3 style="margin-top:0">وين يتأخر الطلب؟</h3><p class="help">متوسط الأيام اللي يقعدها الطلب بكل مرحلة</p>
      <div class="tbl-wrap"><table><thead><tr><th>المرحلة</th><th>متوسط الأيام</th><th class="num">عدد</th></tr></thead><tbody>${stages || empty(3)}</tbody></table></div></div>
    <div class="panel"><h3 style="margin-top:0">أداء المندوبين</h3>
      <div class="tbl-wrap"><table><thead><tr><th>المندوب</th><th class="num">الطلبات</th><th class="num">قيد العمل</th><th class="num">مكتملة</th><th class="num">ملغاة</th><th>قيمة المكتملة</th><th class="num">متوسط المدة (يوم)</th><th class="num">صافي الربح</th></tr></thead><tbody>${byRep || empty(8)}</tbody></table></div></div>
    <div class="panel"><h3 style="margin-top:0">المبيعات حسب الشهر</h3><p class="help">الطلبات المكتملة حسب شهر الإغلاق</p>
      <div class="tbl-wrap"><table><thead><tr><th>الشهر</th><th class="num">مكتملة</th><th>القيمة</th><th class="num">صافي الربح</th></tr></thead><tbody>${byMonth || empty(4)}</tbody></table></div></div>
    <div class="panel"><h3 style="margin-top:0">أسباب الإلغاء</h3>
      <div class="tbl-wrap"><table><thead><tr><th>السبب</th><th>العدد</th></tr></thead><tbody>${reasons || empty(2)}</tbody></table></div></div>`;
}
