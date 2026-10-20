// صفحة المشرف (للأدمن): كل الطلبات المعلّقة بكل البوردات بمكان واحد
// الأدمن يشوف كل البوردات أصلاً (my_boards بـ 012)، فما تحتاج شي بالقاعدة
import { S, BOARD_COLS, colKey, userName, boardName, daysIn } from './state.js';
import { sb, fetchAll } from './api.js';
import { $, esc, fmt, money, toast, dOnly, ic } from './util.js';

const STAGES = BOARD_COLS.filter(c => !['done', 'cancel'].includes(c.k));
const LATE = 3; // نفس حد "متأخرة" باللوحة
const f = { board: '', stage: '', rep: '', q: '', late: false };
let rows = [], openInv = null;

const stageT = k => (STAGES.find(c => c.k === k) || {}).t || k;
const isLate = i => daysIn(i) >= LATE;

export async function renderSuper() {
  $('#supOut').innerHTML = '<div class="loading">جاري التحميل...</div>';
  try {
    rows = await fetchAll(() => sb.from('invoices')
      .select('id,board_id,customer,rep_id,value,stage,sub,stage_at,created_at,urgent,delete_req_at')
      .in('stage', ['new', 'acc', 'decision']).order('id'));
  } catch (e) { $('#supOut').innerHTML = ''; return toast(e.message) }
  fillFilters(); paint();
}

function fillFilters() {
  const opt = (list, cur, all) => `<option value="">${all}</option>` + list.map(([v, t]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const boards = [...new Set(rows.map(r => r.board_id))].map(b => [b, boardName(b) || 'بورد ' + b]);
  const reps = [...new Set(rows.map(r => r.rep_id))].map(r => [r, userName(r)]).sort((a, b) => a[1].localeCompare(b[1], 'ar'));
  $('#supBoard').innerHTML = opt(boards, f.board, 'كل البوردات');
  $('#supBoard').classList.toggle('hidden', boards.length < 2 && !f.board);
  $('#supStage').innerHTML = opt(STAGES.map(c => [c.k, c.t]), f.stage, 'كل المراحل');
  $('#supRep').innerHTML = opt(reps, f.rep, 'كل المندوبين');
}

// skip: نتجاهل فلتر البورد والمرحلة (لجدول البورد × المرحلة)
const match = (i, skip = false) =>
  (skip || !f.board || String(i.board_id) === f.board) &&
  (skip || !f.stage || colKey(i) === f.stage) &&
  (!f.rep || i.rep_id === f.rep) &&
  (!f.late || isLate(i)) &&
  (!f.q || String(i.id) === f.q.replace('#', '') || (i.customer || '').toLowerCase().includes(f.q.toLowerCase()));

function paint() {
  const list = rows.filter(i => match(i)).sort((a, b) => (b.urgent - a.urgent) || daysIn(b) - daysIn(a));
  const late = list.filter(isLate), urgent = list.filter(i => i.urgent), oldest = list.reduce((m, i) => Math.max(m, daysIn(i)), 0);
  const tile = (k, v, s, act) => `<button class="stat click" ${act ? `data-tile="${act}" aria-pressed="${act === 'late' && f.late}"` : ''}><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></button>`;
  const tiles = tile('معلّقة', fmt(list.length), money(list.reduce((s, i) => s + (+i.value || 0), 0)), 'all')
    + tile('متأخرة', fmt(late.length), `${LATE} أيام+ بنفس المرحلة`, 'late')
    + tile('طارئة', fmt(urgent.length), '')
    + tile('أقدم طلب', list.length ? fmt(Math.floor(oldest)) + ' يوم' : '—', 'بمرحلته الحالية')
    + tile('طلبات حذف', fmt(list.filter(i => i.delete_req_at).length), 'تنتظر الأدمن');

  // البورد × المرحلة: كل خانة تفلتر الجدول
  const base = rows.filter(i => match(i, true));
  const byB = [...new Set(base.map(i => i.board_id))].sort((a, b) => a - b);
  const cell = (b, k) => {
    const g = base.filter(i => i.board_id === b && (!k || colKey(i) === k)), n = g.length, l = g.filter(isLate).length;
    if (!n) return '<td class="num muted">0</td>';
    const on = String(f.board) === String(b) && f.stage === (k || '');
    return `<td class="num"><button class="link-btn" style="width:auto;padding:4px 8px${on ? ';background:var(--primary-soft)' : ''}" data-cell="${b}|${k || ''}">${fmt(n)}${l ? ` <span style="color:var(--bad);font-weight:400">(${fmt(l)} متأخرة)</span>` : ''}</button></td>`;
  };
  const matrix = byB.map(b => `<tr><td>${esc(boardName(b) || 'بورد ' + b)}</td>${STAGES.map(c => cell(b, c.k)).join('')}${cell(b, '')}</tr>`).join('');

  // حسب المندوب
  const reps = [...new Set(list.map(i => i.rep_id))].map(r => {
    const g = list.filter(i => i.rep_id === r);
    return { r, n: g.length, l: g.filter(isLate).length, v: g.reduce((s, i) => s + (+i.value || 0), 0) };
  }).sort((a, b) => b.l - a.l || b.n - a.n);

  const tr = i => `<tr${isLate(i) ? ' style="box-shadow:inset 3px 0 0 var(--bad)"' : ''}>
    <td><button class="link-btn" style="width:auto;padding:4px" data-open="${i.id}">#${i.id}</button></td>
    <td>${esc(i.customer) || '—'}${i.urgent ? ` <span class="badge b-urgent">${ic('flame')}طارئ</span>` : ''}${i.delete_req_at ? ' <span class="badge b-warn">طلب حذف</span>' : ''}</td>
    <td>${esc(userName(i.rep_id))}</td>${byB.length > 1 || f.board ? `<td>${esc(boardName(i.board_id))}</td>` : ''}
    <td>${esc(stageT(colKey(i)))}</td>
    <td class="num" style="${isLate(i) ? 'color:var(--bad);font-weight:700' : ''}">${fmt(Math.floor(daysIn(i)))} يوم</td>
    <td class="num">${money(i.value)}</td><td class="num">${dOnly(i.created_at)}</td></tr>`;
  const multi = byB.length > 1 || f.board;

  $('#supOut').innerHTML = `<div class="tiles">${tiles}</div>
    <div class="panel"><h3 style="margin-top:0">حسب البورد والمرحلة</h3><p class="help">اضغط على أي رقم حتى تشوف طلباته تحت</p>
      <div class="tbl-wrap"><table><thead><tr><th>البورد</th>${STAGES.map(c => `<th class="num">${esc(c.t)}</th>`).join('')}<th class="num">المجموع</th></tr></thead>
      <tbody>${matrix || '<tr><td colspan="7" class="muted">ماكو طلبات معلّقة</td></tr>'}</tbody></table></div></div>
    <div class="panel"><h3 style="margin-top:0">حسب المندوب</h3>
      <div class="tbl-wrap"><table><thead><tr><th>المندوب</th><th class="num">معلّقة</th><th class="num">متأخرة</th><th class="num">القيمة</th></tr></thead>
      <tbody>${reps.map(x => `<tr><td><button class="link-btn" style="width:auto;padding:4px;text-align:start" data-rep="${esc(x.r)}">${esc(userName(x.r))}</button></td><td class="num">${fmt(x.n)}</td>
        <td class="num" style="${x.l ? 'color:var(--bad);font-weight:700' : ''}">${fmt(x.l)}</td><td class="num">${money(x.v)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}</tbody></table></div></div>
    <div class="panel"><h3 style="margin-top:0">الطلبات (${fmt(list.length)})</h3><p class="help">الطارئة أول، بعدين الأقدم بمرحلته. اضغط رقم الطلب حتى تفتحه</p>
      <div class="tbl-wrap"><table><thead><tr><th>#</th><th>الزبون</th><th>المندوب</th>${multi ? '<th>البورد</th>' : ''}<th>المرحلة</th><th class="num">بالمرحلة</th><th class="num">القيمة</th><th class="num">تاريخ الطلب</th></tr></thead>
      <tbody>${list.map(tr).join('') || `<tr><td colspan="${multi ? 8 : 7}" class="muted">ماكو طلبات بهذا الفلتر</td></tr>`}</tbody></table></div></div>`;
}

export function initSuper(onOpen) {
  openInv = onOpen;
  const set = (k, v) => { f[k] = v; fillFilters(); paint() };
  $('#supBoard').onchange = e => set('board', e.target.value);
  $('#supStage').onchange = e => set('stage', e.target.value);
  $('#supRep').onchange = e => set('rep', e.target.value);
  $('#supQ').oninput = e => set('q', e.target.value.trim());
  $('#supLate').onchange = e => set('late', e.target.checked);
  $('#supRefresh').onclick = renderSuper;
  $('#supOut').addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) return openInv(+o.dataset.open);
    const c = e.target.closest('[data-cell]');
    if (c) { const [b, k] = c.dataset.cell.split('|'); f.board = b; f.stage = k; fillFilters(); paint(); $('#supOut .panel:last-child').scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    const r = e.target.closest('[data-rep]'); if (r) { set('rep', f.rep === r.dataset.rep ? '' : r.dataset.rep); return }
    const t = e.target.closest('[data-tile]');
    if (t) {
      if (t.dataset.tile === 'late') f.late = !f.late;
      else { Object.assign(f, { board: '', stage: '', rep: '', q: '', late: false }); $('#supQ').value = '' }
      $('#supLate').checked = f.late; fillFilters(); paint();
    }
  });
}
