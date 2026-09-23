import { S, COLS, SUB, MONTHS, getInv, userName, reps, isActive, ageLevel, daysIn, ldAmount, hasTerms, hasRole } from './state.js';
import { $, $$, esc, num, money, pct, ic, initials, toast, DAY } from './util.js';
import { can } from './can.js';
import { run, waitingOn } from './actions.js';
import { openDrawer } from './drawer.js';

function filtered() {
  const q = $('#q').value.trim().toLowerCase(), rep = $('#fRep').value, ft = $('#fTerms').value;
  const late = $('#fLate').checked, del = $('#fDel').checked;
  return S.INVOICES.filter(inv => {
    if (q && ![inv.customer, inv.quote_no, inv.res_no, String(inv.id), inv.sales_no].join(' ').toLowerCase().includes(q)) return false;
    if (rep !== 'all' && inv.rep_id !== rep) return false;
    if (ft === 'with' && !hasTerms(inv)) return false;
    if (ft === 'without' && hasTerms(inv)) return false;
    if (late && ageLevel(inv) === 0) return false;
    if (del && !inv.delete_req_at) return false;
    return true;
  });
}

function cardHTML(inv) {
  const lvl = ageLevel(inv), d = Math.floor(daysIn(inv)), b = [];
  if (inv.delete_req_at) b.push(`<span class="badge b-bad">${ic('trash')}طلب حذف</span>`);
  if (inv.stage === 'decision') b.push(`<span class="badge b-vio">${SUB[inv.sub]}</span>`);
  if (lvl) b.push(`<span class="badge ${lvl === 2 ? 'b-bad' : 'b-warn'}">${ic('clock')}${d} يوم بالمرحلة</span>`);
  if (inv.returned && isActive(inv)) b.push(`<span class="badge b-warn">${ic('back')}مرجعة ${esc(inv.returned)}</span>`);
  if (inv.payment === 'credit' && inv.credit_months) b.push(`<span class="badge b-pri">آجل ${MONTHS[inv.credit_months] || ''}</span>`);
  if (inv.ld) b.push(`<span class="badge b-ok">خصم لاحق ${esc(inv.ld_pct)}%</span>`);
  if (num(inv.points) > 0) b.push(`<span class="badge b-vio">نقاط ${esc(inv.points)}</span>`);
  const pr = S.PROFITS[inv.id];
  if (pr && can('seeProfit', inv)) b.push(`<span class="badge ${num(pr.net_pct) >= 0 ? 'b-ok' : 'b-bad'}">صافي ${pct(pr.net_pct)}</span>`);
  if (inv.stage === 'done' && inv.sales_no) b.push(`<span class="badge b-pri">${esc(inv.sales_no)}</span>`);
  if (inv.stage === 'cancel' && inv.cancel_reason) b.push(`<span class="badge b-bad">${esc(inv.cancel_reason.slice(0, 30))}</span>`);
  const refs = [inv.quote_no && 'عرض ' + inv.quote_no, inv.res_no && 'حجز ' + inv.res_no].filter(Boolean).join(' · ') || 'بدون رقم';
  return `<button class="card" draggable="true" data-id="${inv.id}">
    <div class="top"><span class="id">#${inv.id}</span></div>
    <div class="cust">${esc(inv.customer) || '<span style="color:var(--faint)">(بدون اسم)</span>'}</div>
    <div class="refs">${esc(refs)}</div>
    ${num(inv.value) ? `<div class="val">${money(inv.value)}</div>` : ''}
    ${b.length ? `<div class="badges">${b.join('')}</div>` : ''}
    <div class="meta">
      ${inv.pdf_path ? `<span>${ic('clip')}1</span>` : `<span style="color:var(--bad)">${ic('clip')}0</span>`}
      <span class="avatar" title="${esc(userName(inv.rep_id))}">${esc(initials(userName(inv.rep_id)))}</span>
    </div></button>`;
}

export function renderBoard() {
  if (!S.ME) return;
  const list = filtered();
  $('#board').innerHTML = COLS.map(c => {
    const items = list.filter(i => i.stage === c.k).sort((a, b) => ageLevel(b) - ageLevel(a) || new Date(a.stage_at) - new Date(b.stage_at));
    const total = items.reduce((s, i) => s + num(i.value), 0);
    return `<section class="column" data-col="${c.k}">
      <div class="col-head"><span class="dot" style="background:${c.c}"></span><h2>${c.t}</h2><span class="count">${items.length}</span></div>
      <div class="col-sub"><span>${c.who}</span><span>${total ? money(total) : ''}</span></div>
      <div class="col-body">${items.map(cardHTML).join('') || '<div class="empty">لا توجد طلبات</div>'}</div></section>`;
  }).join('');
  renderStats(list);
}

function renderStats(list) {
  const act = list.filter(isActive), late = act.filter(i => ageLevel(i) === 2).length;
  const doneL = list.filter(i => i.stage === 'done');
  const ld = list.filter(i => i.stage !== 'cancel').reduce((s, i) => s + ldAmount(i), 0);
  const cyc = doneL.length ? doneL.reduce((s, i) => s + (new Date(i.closed_at) - new Date(i.created_at)) / DAY, 0) / doneL.length : 0;
  const tiles = [
    ['قيد العمل', act.length, money(act.reduce((s, i) => s + num(i.value), 0))],
    ['متأخرة (3 أيام+)', late, 'بنفس المرحلة', 'late'],
    ['مكتملة', doneL.length, money(doneL.reduce((s, i) => s + num(i.value), 0))],
    ['خصومات لاحقة', money(ld), 'غير الملغاة'],
    ['متوسط مدة الطلب', cyc.toFixed(1) + ' يوم', 'من الإنشاء للإغلاق'],
  ];
  if (hasRole('admin') || hasRole('mgr')) {
    const nets = doneL.map(i => S.PROFITS[i.id]).filter(Boolean).map(p => num(p.net_pct));
    tiles.push(['متوسط صافي الربح', nets.length ? pct(nets.reduce((a, b) => a + b, 0) / nets.length) : '—', 'للمكتملة']);
  }
  if (hasRole('admin')) {
    const n = S.INVOICES.filter(i => i.delete_req_at).length;
    if (n) tiles.push(['طلبات حذف', n, 'اضغط للعرض', 'del']);
  }
  // البطاقات اللي تفلتر أزرار حقيقية (كيبورد + قارئ الشاشة يعرف إذا الفلتر شغال)
  const on = { late: $('#fLate').checked, del: $('#fDel').checked };
  $('#stats').innerHTML = tiles.map(s => {
    const inner = `<span class="k">${s[0]}</span><span class="v">${s[1]}</span><span class="s">${s[2]}</span>`;
    return s[3] ? `<button type="button" class="stat click" data-stat="${s[3]}" aria-pressed="${on[s[3]]}">${inner}</button>` : `<div class="stat">${inner}</div>`;
  }).join('');
}

export function fillFilters() {
  const cur = $('#fRep').value || 'all';
  $('#fRep').innerHTML = '<option value="all">كل المندوبين</option>' + reps().map(r => `<option value="${esc(r.id)}">${esc(r.full_name)}</option>`).join('');
  $('#fRep').value = [...$('#fRep').options].some(o => o.value === cur) ? cur : 'all';
  $('#fRep').classList.toggle('hidden', !(hasRole('admin') || hasRole('acc') || hasRole('mgr')));
  $('#fDelWrap').classList.toggle('hidden', !hasRole('admin'));
}

export function initBoard() {
  ['#q', '#fRep', '#fTerms', '#fLate', '#fDel'].forEach(s => $(s).addEventListener('input', renderBoard));
  $('#stats').addEventListener('click', e => {
    const t = e.target.closest('[data-stat]'); if (!t) return;
    const box = t.dataset.stat === 'late' ? $('#fLate') : $('#fDel');
    box.checked = !box.checked; renderBoard();
  });
  $('#board').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openDrawer(+c.dataset.id) });

  // السحب والإفلات
  let dragId = null;
  document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('.card'); if (!c) return; dragId = +c.dataset.id; c.classList.add('dragging') });
  document.addEventListener('dragend', () => { $$('.dragging,.drop-ok').forEach(x => x.classList.remove('dragging', 'drop-ok')); dragId = null });
  document.addEventListener('dragover', e => {
    const col = e.target.closest && e.target.closest('.column'); if (!col || dragId == null) return;
    e.preventDefault(); $$('.drop-ok').forEach(x => x !== col && x.classList.remove('drop-ok')); col.classList.add('drop-ok');
  });
  document.addEventListener('drop', e => {
    const col = e.target.closest && e.target.closest('.column'); if (!col || dragId == null) return;
    e.preventDefault(); handleDrop(dragId, col.dataset.col);
  });
}

function handleDrop(id, to) {
  const inv = getInv(id); if (!inv || inv.stage === to) return;
  const f = inv.stage; let a = null;
  if (f === 'new' && to === 'acc') a = 'sendToAcc';
  else if (f === 'acc' && to === 'decision') a = 'sendToDecision';
  else if (f === 'decision' && to === 'acc' && inv.sub === 'mgr') a = 'returnToAcc';
  else if (f === 'decision' && to === 'done' && inv.sub === 'wh') a = 'complete';
  else if (f === 'decision' && to === 'cancel' && inv.sub === 'cust') a = 'custRefuse';
  if (!a) return toast('هذا الانتقال غير مسموح. ' + (waitingOn(inv) ? 'الخطوة الحالية: ' + waitingOn(inv) : ''));
  run(a, id);
}
