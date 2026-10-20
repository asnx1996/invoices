// داشبورد المشرف (للأدمن): كل الطلبات المعلّقة بكل البوردات بمكان واحد
// الأدمن يشوف كل البوردات أصلاً (my_boards بـ 012)، فما تحتاج شي بالقاعدة
import { S, BOARD_COLS, colKey, userName, boardName, daysIn } from './state.js';
import { sb, fetchAll } from './api.js';
import { $, esc, fmt, money, toast, ic, DAY } from './util.js';
import { avatarHTML } from './avatars.js';

const STAGES = BOARD_COLS.filter(c => !['done', 'cancel'].includes(c.k));
const LATE = 3; // نفس حد "متأخرة" باللوحة
const f = { board: '', stage: '', rep: '', q: '', late: false };
let rows = [], recent = [], span = 7, openInv = null;

const stageT = k => (STAGES.find(c => c.k === k) || {}).t || k;
const isLate = i => daysIn(i) >= LATE;
const sum = (a, k = 'value') => a.reduce((s, i) => s + (+i[k] || 0), 0);
const dayKey = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() };
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export async function renderSuper() {
  if (!rows.length) $('#supOut').innerHTML = '<div class="loading">جاري التحميل...</div>';
  const since = new Date(Date.now() - 60 * DAY).toISOString();
  try {
    [rows, recent] = await Promise.all([
      fetchAll(() => sb.from('invoices')
        .select('id,board_id,customer,rep_id,value,stage,sub,stage_at,created_at,urgent,delete_req_at')
        .in('stage', ['new', 'acc', 'decision']).order('id')),
      // آخر 60 يوم: للرسم والمقارنة ويا الأسبوع اللي قبله
      fetchAll(() => sb.from('invoices').select('id,board_id,rep_id,value,stage,created_at,closed_at')
        .or(`created_at.gte.${since},closed_at.gte.${since}`).order('id')),
    ]);
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

// skip: نتجاهل فلتر المرحلة (للرسم حسب المرحلة)
const match = (i, skip = false) =>
  (!f.board || String(i.board_id) === f.board) &&
  (skip || !f.stage || colKey(i) === f.stage) &&
  (!f.rep || i.rep_id === f.rep) &&
  (!f.late || isLate(i)) &&
  (!f.q || String(i.id) === f.q.replace('#', '') || (i.customer || '').toLowerCase().includes(f.q.toLowerCase()));
const matchRecent = i => (!f.board || String(i.board_id) === f.board) && (!f.rep || i.rep_id === f.rep);

// نسبة التغيير عن الفترة اللي قبلها
function delta(now, prev) {
  if (!prev) return now ? '<span class="d-pill up">جديد</span>' : '';
  const p = Math.round((now - prev) / prev * 100);
  return `<span class="d-pill ${p >= 0 ? 'up' : 'down'}" title="مقارنة بالأسبوع اللي قبله">${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}%</span>`;
}

function tilesHTML(list) {
  const late = list.filter(isLate), now = Date.now(), wk = now - 7 * DAY, pwk = now - 14 * DAY;
  const rec = recent.filter(matchRecent);
  const created = a => rec.filter(i => +new Date(i.created_at) >= a.from && +new Date(i.created_at) < a.to);
  const done = a => rec.filter(i => i.stage === 'done' && i.closed_at && +new Date(i.closed_at) >= a.from && +new Date(i.closed_at) < a.to);
  const cw = created({ from: wk, to: now }), cp = created({ from: pwk, to: wk });
  const dw = done({ from: wk, to: now }), dp = done({ from: pwk, to: wk });
  const tile = (cls, k, v, sub, pill, act) => `<div class="d-tile ${cls}">
      <div class="d-tile-k">${k}</div><div class="d-tile-v">${v}</div>
      <div class="d-tile-s"><span>${sub}</span>${pill || ''}</div>
      ${act ? `<button class="d-arrow" data-tile="${act}" aria-label="${act === 'late' ? (f.late ? 'رجّع كل الطلبات' : 'اعرض المتأخرة بس') : 'رجّع كل الفلاتر'}" aria-pressed="${act === 'late' && f.late}"><svg class="i" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></button>` : ''}</div>`;
  return `<div class="d-tiles">
    ${tile('sun', 'الطلبات المعلّقة', fmt(list.length), money(sum(list)), '', 'all')}
    ${tile('ink', 'متأخرة', fmt(late.length), list.length ? `${Math.round(late.length / list.length * 100)}% من المعلّقة` : '—', '', 'late')}
    ${tile('ink', 'جديدة هذا الأسبوع', fmt(cw.length), `الأسبوع الماضي: ${fmt(cp.length)}`, delta(cw.length, cp.length))}
    ${tile('ink', 'تمت هذا الأسبوع', fmt(dw.length), money(sum(dw)), delta(dw.length, dp.length))}
  </div>`;
}

// رسم 1: الطلبات الجديدة لكل يوم (سلسلة وحدة، لون واحد)
function newChartHTML() {
  const rec = recent.filter(matchRecent), today = dayKey(Date.now());
  const days = Array.from({ length: span }, (_, i) => today - (span - 1 - i) * DAY);
  const data = days.map(d => { const g = rec.filter(i => dayKey(i.created_at) === d); return { d, n: g.length, v: sum(g) } });
  const max = Math.max(1, ...data.map(x => x.n)), top = data.reduce((a, b) => b.n > a.n ? b : a, data[0]);
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const lbl = d => span <= 7 ? DAYS_AR[new Date(d).getDay()] : new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  const showLbl = (i) => span <= 14 || i % 5 === 0 || i === data.length - 1;
  return `<div class="panel d-card d-wide">
    <div class="d-card-h"><h3>الطلبات الجديدة</h3>
      <select id="supSpan" aria-label="الفترة">${[[7, 'آخر 7 أيام'], [14, 'آخر 14 يوم'], [30, 'آخر 30 يوم']].map(([v, t]) => `<option value="${v}" ${span === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="d-bars" style="--n:${span}" role="img" aria-label="عدد الطلبات الجديدة لكل يوم، أعلى يوم ${fmt(top.n)} طلب">
      <div class="d-grid">${ticks.slice().reverse().map(t => `<div><span>${fmt(t)}</span></div>`).join('')}</div>
      <div class="d-cols">${data.map((x, i) => `<div class="d-col" tabindex="0" data-tip="${esc(new Date(x.d).toLocaleDateString('en-GB'))} · ${fmt(x.n)} طلب · ${esc(money(x.v))}">
        ${x === top && x.n ? `<span class="d-flag">${fmt(x.n)}</span>` : ''}
        <div class="d-bar${x === top && x.n ? ' top' : ''}" style="height:${x.n ? Math.max(4, x.n / max * 100) : 0}%"></div>
        <span class="d-x">${showLbl(i) ? esc(lbl(x.d)) : ''}</span></div>`).join('')}</div>
    </div></div>`;
}

// رسم 2: المعلّقة حسب المرحلة — بالوقت / متأخرة (مكدّس)
function stageChartHTML() {
  const base = rows.filter(i => match(i, true));
  const data = STAGES.map(c => { const g = base.filter(i => colKey(i) === c.k); return { c, ok: g.filter(i => !isLate(i)).length, late: g.filter(isLate).length } });
  const max = Math.max(1, ...data.map(x => x.ok + x.late));
  return `<div class="panel d-card">
    <div class="d-card-h"><h3>حسب المرحلة</h3>
      <div class="d-legend"><span><i class="ok"></i>بالوقت</span><span><i class="late"></i>متأخرة</span></div></div>
    <div class="d-stack">${data.map(x => `<button class="d-srow${f.stage === x.c.k ? ' on' : ''}" data-stage="${x.c.k}" title="${esc(x.c.t)}: ${x.ok} بالوقت، ${x.late} متأخرة">
      <span class="d-sname">${esc(x.c.t)}</span>
      <span class="d-strack">${x.ok ? `<i class="ok" style="width:${x.ok / max * 100}%"></i>` : ''}${x.late ? `<i class="late" style="width:${x.late / max * 100}%"></i>` : ''}</span>
      <span class="d-snum">${fmt(x.ok + x.late)}${x.late ? ` <small>(${fmt(x.late)} متأخرة)</small>` : ''}</span></button>`).join('')}</div>
    <p class="help" style="margin:10px 0 0">اضغط على مرحلة حتى تشوف طلباتها بالجدول</p></div>`;
}

function repsHTML(list) {
  const reps = [...new Set(list.map(i => i.rep_id))].map(r => {
    const g = list.filter(i => i.rep_id === r);
    return { r, n: g.length, l: g.filter(isLate).length };
  }).sort((a, b) => b.l - a.l || b.n - a.n);
  const onTime = list.length ? Math.round(list.filter(i => !isLate(i)).length / list.length * 100) : 100;
  const urgent = list.filter(i => i.urgent).length;
  return `<div class="panel d-card">
    <div class="d-card-h"><h3>المندوبين</h3></div>
    <ul class="d-reps">${reps.map(x => `<li><button class="d-rep${f.rep === x.r ? ' on' : ''}" data-rep="${esc(x.r)}">${avatarHTML(x.r, 34)}
      <span class="d-rname">${esc(userName(x.r))}</span><span class="d-pill">${fmt(x.n)} معلّقة</span>${x.l ? `<span class="d-pill down">${fmt(x.l)} متأخرة</span>` : ''}</button></li>`).join('') || '<li class="help">—</li>'}</ul>
    <div class="d-meter"><div class="d-meter-h"><span>بالوقت</span><b>${onTime}%</b></div>
      <div class="d-meter-t" role="progressbar" aria-valuenow="${onTime}" aria-valuemin="0" aria-valuemax="100" aria-label="نسبة الطلبات بالوقت"><i style="width:${onTime}%"></i></div></div>
    <div class="d-meter"><div class="d-meter-h"><span>طارئة</span><b>${fmt(urgent)} من ${fmt(list.length)}</b></div>
      <div class="d-meter-t" aria-hidden="true"><i style="width:${list.length ? urgent / list.length * 100 : 0}%"></i></div></div>
  </div>`;
}

function tableHTML(list) {
  const multi = new Set(rows.map(i => i.board_id)).size > 1;
  const st = i => `<span class="d-status s-${colKey(i).replace(':', '-')}">${esc(stageT(colKey(i)))}</span>`;
  const tr = i => `<tr${isLate(i) ? ' class="late"' : ''}>
    <td><button class="link-btn" style="width:auto;padding:4px" data-open="${i.id}">#${i.id}</button></td>
    <td>${esc(i.customer) || '—'}${i.urgent ? ` <span class="badge b-urgent">${ic('flame')}طارئ</span>` : ''}${i.delete_req_at ? ' <span class="badge b-warn">طلب حذف</span>' : ''}</td>
    <td>${esc(userName(i.rep_id))}</td>${multi ? `<td>${esc(boardName(i.board_id))}</td>` : ''}
    <td>${st(i)}</td>
    <td class="num${isLate(i) ? ' d-late' : ''}">${fmt(Math.floor(daysIn(i)))} يوم</td>
    <td class="num">${money(i.value)}</td></tr>`;
  return `<div class="panel d-card d-wide">
    <div class="d-card-h"><h3>الطلبات المعلّقة <span class="help">(${fmt(list.length)})</span></h3><span class="help">الطارئة أول، بعدين الأقدم بمرحلته</span></div>
    <div class="tbl-wrap"><table class="d-tbl"><thead><tr><th>#</th><th>الزبون</th><th>المندوب</th>${multi ? '<th>البورد</th>' : ''}<th>المرحلة</th><th class="num">بالمرحلة</th><th class="num">القيمة</th></tr></thead>
    <tbody>${list.map(tr).join('') || `<tr><td colspan="${multi ? 7 : 6}" class="muted">ماكو طلبات بهذا الفلتر</td></tr>`}</tbody></table></div></div>`;
}

// البورد × المرحلة (إذا اكو أكثر من بورد)
function matrixHTML() {
  const base = rows.filter(i => (!f.rep || i.rep_id === f.rep) && (!f.late || isLate(i)));
  const byB = [...new Set(base.map(i => i.board_id))].sort((a, b) => a - b);
  if (byB.length < 2) return '';
  const cell = (b, k) => {
    const g = base.filter(i => i.board_id === b && (!k || colKey(i) === k)), n = g.length, l = g.filter(isLate).length;
    if (!n) return '<td class="num muted">0</td>';
    const on = String(f.board) === String(b) && f.stage === (k || '');
    return `<td class="num"><button class="link-btn${on ? ' on' : ''}" style="width:auto;padding:4px 8px" data-cell="${b}|${k || ''}">${fmt(n)}${l ? ` <span class="d-late" style="font-weight:400">(${fmt(l)})</span>` : ''}</button></td>`;
  };
  return `<div class="panel d-card d-full"><div class="d-card-h"><h3>البوردات</h3><span class="help">بين القوسين: المتأخرة</span></div>
    <div class="tbl-wrap"><table class="d-tbl"><thead><tr><th>البورد</th>${STAGES.map(c => `<th class="num">${esc(c.t)}</th>`).join('')}<th class="num">المجموع</th></tr></thead>
    <tbody>${byB.map(b => `<tr><td>${esc(boardName(b) || 'بورد ' + b)}</td>${STAGES.map(c => cell(b, c.k)).join('')}${cell(b, '')}</tr>`).join('')}</tbody></table></div></div>`;
}

// إعادة رسم بدون تحميل (مثلاً بعد ما تتحمل أسماء المستخدمين والبوردات)
export function paintSuper() { if (rows.length || recent.length) { fillFilters(); paint() } }

function paint() {
  const list = rows.filter(i => match(i)).sort((a, b) => (b.urgent - a.urgent) || daysIn(b) - daysIn(a));
  $('#supOut').innerHTML = `${tilesHTML(list)}
    <div class="d-grid2">${newChartHTML()}${stageChartHTML()}${tableHTML(list)}${repsHTML(list)}${matrixHTML()}</div>`;
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
  const out = $('#supOut');
  out.addEventListener('change', e => { if (e.target.id === 'supSpan') { span = +e.target.value; paint() } });
  out.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) return openInv(+o.dataset.open);
    const c = e.target.closest('[data-cell]'); if (c) { const [b, k] = c.dataset.cell.split('|'); f.board = b; f.stage = k; fillFilters(); return paint() }
    const s = e.target.closest('[data-stage]'); if (s) return set('stage', f.stage === s.dataset.stage ? '' : s.dataset.stage);
    const r = e.target.closest('[data-rep]'); if (r) return set('rep', f.rep === r.dataset.rep ? '' : r.dataset.rep);
    const t = e.target.closest('[data-tile]');
    if (t) {
      if (t.dataset.tile === 'late') f.late = !f.late;
      else { Object.assign(f, { board: '', stage: '', rep: '', q: '', late: false }); $('#supQ').value = '' }
      $('#supLate').checked = f.late; fillFilters(); paint();
    }
  });
  // تلميح الأعمدة (ماوس أو كيبورد)
  const tip = document.createElement('div'); tip.className = 'd-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
  const showTip = el => { const r = el.getBoundingClientRect(); tip.textContent = el.dataset.tip; tip.style.left = r.left + r.width / 2 + 'px'; tip.style.top = r.top + 'px'; tip.classList.add('on') };
  out.addEventListener('pointerover', e => { const c = e.target.closest('[data-tip]'); if (c) showTip(c) });
  out.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) tip.classList.remove('on') });
  out.addEventListener('focusin', e => { const c = e.target.closest('[data-tip]'); if (c) showTip(c) });
  out.addEventListener('focusout', () => tip.classList.remove('on'));
  addEventListener('scroll', () => tip.classList.remove('on'), { passive: true });
}
