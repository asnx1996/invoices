import { S, COLS, SUB, MONTHS, getInv, userName, reps, isActive, isUrgent, ageLevel, daysIn, hasRole } from './state.js';
import { $, $$, esc, num, money, pct, ic, initials, toast, ask } from './util.js';
import { can } from './can.js';
import { run, waitingOn } from './actions.js';
import { openDrawer } from './drawer.js';

// تفضيلات اللوحة تنحفظ بالجهاز (مو بالقاعدة): الأعمدة المطوية، ترتيب كل عمود، عرض التفاصيل
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch (e) { return d } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } };
const folded = new Set(load('ib_folded', []));   // أعمدة مطوية
const sortBy = load('ib_sort', {});              // عمود → نوع الترتيب
let allOpen = !!load('ib_open', false);          // كل الكروت مفتوحة؟
const flipped = new Set();                       // كروت عكس الوضع العام (للجلسة فقط)
let lateOnly = false;                            // بطاقة "متأخرة" فوق تشتغل كفلتر
const isOpen = id => allOpen !== flipped.has(id);

// وين واكف الطلب
const STAGE_OPTS = [
  ['all', 'كل الحالات'], ['new', 'عند المندوب'], ['acc', 'عند المحاسب'],
  ['decision:mgr', 'موافقة المدير'], ['decision:cust', 'رد الزبون'], ['decision:wh', 'تحويل المخزن'],
  ['done', 'تمت'], ['cancel', 'ملغاة'], ['urgent', 'الطارئة'],
];

const SORTS = {
  age: ['الأقدم بالمرحلة', (a, b) => ageLevel(b) - ageLevel(a) || new Date(a.stage_at) - new Date(b.stage_at)],
  valDesc: ['القيمة: الأعلى', (a, b) => num(b.value) - num(a.value)],
  valAsc: ['القيمة: الأقل', (a, b) => num(a.value) - num(b.value)],
  new: ['التاريخ: الأحدث', (a, b) => new Date(b.created_at) - new Date(a.created_at)],
  old: ['التاريخ: الأقدم', (a, b) => new Date(a.created_at) - new Date(b.created_at)],
  nameAsc: ['الزبون: أ ← ي', (a, b) => String(a.customer || '').localeCompare(String(b.customer || ''), 'ar')],
  nameDesc: ['الزبون: ي ← أ', (a, b) => String(b.customer || '').localeCompare(String(a.customer || ''), 'ar')],
  profitDesc: ['الربح: الأعلى', (a, b) => byProfit(a, b, -1), true],
  profitAsc: ['الربح: الأقل', (a, b) => byProfit(a, b, 1), true],
};
// الطلبات بدون ربح محسوب تنزل آخر شي بالترتيبين
function byProfit(a, b, dir) {
  const x = S.PROFITS[a.id], y = S.PROFITS[b.id];
  return !x || !y ? !x - !y : dir * (num(x.net_pct) - num(y.net_pct));
}
const seesProfit = () => hasRole('admin') || hasRole('mgr');

function filtered() {
  const q = $('#q').value.trim().toLowerCase(), rep = $('#fRep').value, st = $('#fStage').value;
  return S.INVOICES.filter(inv => {
    if (q && ![inv.customer, inv.quote_no, inv.res_no, String(inv.id), inv.sales_no].join(' ').toLowerCase().includes(q)) return false;
    if (rep !== 'all' && inv.rep_id !== rep) return false;
    if (st === 'urgent' ? !isUrgent(inv) : st === 'del' ? !inv.delete_req_at
      : st !== 'all' && st !== (inv.stage === 'decision' ? 'decision:' + inv.sub : inv.stage)) return false;
    if (lateOnly && ageLevel(inv) !== 2) return false;
    return true;
  });
}

function cardHTML(inv) {
  const lvl = ageLevel(inv), d = Math.floor(daysIn(inv)), open = isOpen(inv.id), urgent = isUrgent(inv);
  // تنبيهات تبين دائماً، والباقي بالتفاصيل
  const alert = [], b = [];
  if (urgent) alert.push(`<span class="badge b-urgent">${ic('flame')}طارئ</span>`);
  if (inv.delete_req_at) alert.push(`<span class="badge b-bad">${ic('trash')}طلب حذف</span>`);
  if (lvl) alert.push(`<span class="badge ${lvl === 2 ? 'b-bad' : 'b-warn'}">${ic('clock')}${d} يوم بالمرحلة</span>`);
  if (inv.stage === 'decision') b.push(`<span class="badge b-vio">${SUB[inv.sub]}</span>`);
  if (inv.returned && isActive(inv)) b.push(`<span class="badge b-warn">${ic('back')}مرجعة ${esc(inv.returned)}</span>`);
  if (inv.payment === 'credit' && inv.credit_months) b.push(`<span class="badge b-pri">آجل ${MONTHS[inv.credit_months] || ''}</span>`);
  if (inv.ld) b.push(`<span class="badge b-ok">خصم لاحق ${esc(inv.ld_pct)}%</span>`);
  if (num(inv.points) > 0) b.push(`<span class="badge b-vio">نقاط ${esc(inv.points)}</span>`);
  const pr = S.PROFITS[inv.id];
  if (pr && can('seeProfit', inv)) b.push(`<span class="badge ${num(pr.net_pct) >= 0 ? 'b-ok' : 'b-bad'}">صافي ${pct(pr.net_pct)}</span>`);
  if (inv.stage === 'done' && inv.sales_no) b.push(`<span class="badge b-pri">${esc(inv.sales_no)}</span>`);
  if (inv.stage === 'cancel' && inv.cancel_reason) b.push(`<span class="badge b-bad">${esc(inv.cancel_reason.slice(0, 30))}</span>`);
  const refs = [inv.quote_no && 'عرض ' + inv.quote_no, inv.res_no && 'حجز ' + inv.res_no].filter(Boolean).join(' · ') || 'بدون رقم';
  const rep = userName(inv.rep_id);
  return `<article class="card${urgent ? ' urgent' : ''}${open ? ' open' : ''}" draggable="true" data-id="${inv.id}">
    <div class="top"><span class="id">#${inv.id}</span>
      <button type="button" class="more-btn" aria-expanded="${open}" aria-controls="cx${inv.id}" aria-label="${open ? 'إخفاء' : 'عرض'} تفاصيل الطلب ${inv.id}">${ic('chev')}</button></div>
    <button type="button" class="card-link cust">${esc(inv.customer) || '<span style="color:var(--faint)">(بدون اسم)</span>'}</button>
    ${num(inv.value) ? `<div class="val">${money(inv.value)}</div>` : ''}
    ${alert.length ? `<div class="badges">${alert.join('')}</div>` : ''}
    <div class="extra" id="cx${inv.id}" ${open ? '' : 'inert'}><div>
      <div class="refs">${esc(refs)}</div>
      ${b.length ? `<div class="badges">${b.join('')}</div>` : ''}
      <div class="meta">
        ${inv.pdf_path ? `<span>${ic('clip')}1</span>` : `<span style="color:var(--bad)">${ic('clip')}0</span>`}
        <span class="rep"><span class="avatar" aria-hidden="true">${esc(initials(rep))}</span>${esc(rep)}</span>
      </div></div></div></article>`;
}

// هيكل رمادي مكان الكروت لحد ما توصل البيانات، بدل "لا توجد طلبات" الغلط
const skel = n => '<div class="card skel" aria-hidden="true"><i></i><i></i><i></i></div>'.repeat(n);

function sortSelect(k) {
  const cur = sortBy[k] || 'age';
  return `<select class="col-sort" data-sort="${k}" aria-label="ترتيب عمود ${COLS.find(c => c.k === k).t}">${Object.entries(SORTS)
    .filter(([, s]) => !s[2] || seesProfit())
    .map(([v, s]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${s[0]}</option>`).join('')}</select>`;
}

export function renderBoard() {
  if (!S.ME) return;
  if (!S.loaded) {
    $('#board').setAttribute('aria-busy', 'true');
    $('#board').innerHTML = COLS.map((c, i) => `<section class="column"><div class="col-head"><span class="dot" style="background:${c.c}"></span><h2>${c.t}</h2></div>
      <div class="col-body">${skel([3, 2, 2, 1, 1][i])}</div></section>`).join('');
    $('#stats').innerHTML = '<div class="stat skel" aria-hidden="true"><i></i><i></i></div>'.repeat(3);
    return;
  }
  // إعادة الرسم تمسح العناصر، فنرجع التركيز لنفس الزر/القائمة
  const a = document.activeElement, col = a && a.closest && a.closest('.column');
  const refocus = col && (a.matches('.col-sort') ? '.col-sort' : a.matches('.col-fold') ? '.col-fold' : null);
  const card = a && a.closest && a.closest('.card'), cardFocus = card && (a.matches('.more-btn') ? '.more-btn' : '.card-link');

  $('#board').removeAttribute('aria-busy');
  const list = filtered();
  $('#board').innerHTML = COLS.map(c => {
    const cmp = (SORTS[sortBy[c.k]] || SORTS.age)[1];
    // الطارئة دائماً فوق، وبعدها الترتيب اللي اختاره
    const items = list.filter(i => i.stage === c.k).sort((x, y) => isUrgent(y) - isUrgent(x) || cmp(x, y));
    const urg = items.filter(isUrgent).length;
    if (folded.has(c.k)) return `<section class="column folded" data-col="${c.k}">
      <button type="button" class="col-fold" aria-expanded="false" aria-label="فتح عمود ${c.t}" title="فتح العمود">
        <span class="dot" style="background:${c.c}"></span><span class="count">${items.length}</span>${urg ? `<span class="urg-dot" title="${urg} طارئ"></span>` : ''}<h2>${c.t}</h2></button></section>`;
    return `<section class="column" data-col="${c.k}">
      <div class="col-head"><span class="dot" style="background:${c.c}"></span><h2>${c.t}</h2><span class="count">${items.length}</span>
        <button type="button" class="col-fold icon-btn sm" aria-expanded="true" aria-label="طي عمود ${c.t}" title="طي العمود">${ic('chev')}</button></div>
      <div class="col-sub"><span>${c.who}</span>${sortSelect(c.k)}</div>
      <div class="col-body">${items.map(cardHTML).join('') || '<div class="empty">لا توجد طلبات</div>'}</div></section>`;
  }).join('');
  renderStats(list);

  if (refocus) { const el = $(`.column[data-col="${col.dataset.col}"] ${refocus}`); el && el.focus({ preventScroll: true }) }
  if (cardFocus) { const el = $(`.card[data-id="${card.dataset.id}"] ${cardFocus}`); el && el.focus({ preventScroll: true }) }
}

function renderStats(list) {
  // المتأخرة تنحسب من غير فلتر المتأخرة نفسه، حتى الرقم ما يتغير لما تضغطها
  const act = list.filter(isActive), doneL = list.filter(i => i.stage === 'done');
  const late = lateOnly ? act.length : act.filter(i => ageLevel(i) === 2).length;
  const tiles = [
    ['قيد العمل', act.length, money(act.reduce((s, i) => s + num(i.value), 0))],
    ['متأخرة (3 أيام+)', late, lateOnly ? 'اضغط لإلغاء الفلتر' : 'بنفس المرحلة · اضغط للعرض', 'late'],
    ['مكتملة', doneL.length, money(doneL.reduce((s, i) => s + num(i.value), 0))],
  ];
  $('#stats').innerHTML = tiles.map(s => {
    const inner = `<span class="k">${s[0]}</span><span class="v">${s[1]}</span><span class="s">${s[2]}</span>`;
    return s[3] ? `<button type="button" class="stat click" data-stat="${s[3]}" aria-pressed="${lateOnly}">${inner}</button>` : `<div class="stat">${inner}</div>`;
  }).join('');
}

export function fillFilters() {
  const cur = $('#fRep').value || 'all';
  $('#fRep').innerHTML = '<option value="all">كل المندوبين</option>' + reps().map(r => `<option value="${esc(r.id)}">${esc(r.full_name)}</option>`).join('');
  $('#fRep').value = [...$('#fRep').options].some(o => o.value === cur) ? cur : 'all';
  $('#fRep').classList.toggle('hidden', !(hasRole('admin') || hasRole('acc') || hasRole('mgr') || hasRole('wh')));
  const st = $('#fStage').value || 'all';
  const opts = hasRole('admin') ? [...STAGE_OPTS, ['del', 'طلبات الحذف']] : STAGE_OPTS;
  $('#fStage').innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('#fStage').value = opts.some(o => o[0] === st) ? st : 'all';
  syncExpandBtn();
}

const syncExpandBtn = () => $('#expandAll').setAttribute('aria-pressed', String(allOpen));

export function initBoard() {
  ['#q', '#fRep', '#fStage'].forEach(s => $(s).addEventListener('input', renderBoard));
  $('#stats').addEventListener('click', e => {
    if (!e.target.closest('[data-stat="late"]')) return;
    lateOnly = !lateOnly; renderBoard();
  });
  $('#expandAll').onclick = () => { allOpen = !allOpen; flipped.clear(); keep('ib_open', allOpen); syncExpandBtn(); renderBoard() };

  $('#board').addEventListener('change', e => {
    const s = e.target.closest('.col-sort'); if (!s) return;
    sortBy[s.dataset.sort] = s.value; keep('ib_sort', sortBy); renderBoard();
  });
  $('#board').addEventListener('click', e => {
    const f = e.target.closest('.col-fold');
    if (f) {
      const k = f.closest('.column').dataset.col;
      folded.has(k) ? folded.delete(k) : folded.add(k); keep('ib_folded', [...folded]); renderBoard(); return;
    }
    if (e.target.closest('.col-sort')) return;
    const m = e.target.closest('.more-btn');
    if (m) { const id = +m.closest('.card').dataset.id; flipped.has(id) ? flipped.delete(id) : flipped.add(id); toggleCard(m.closest('.card')); return }
    const c = e.target.closest('.card'); if (c) openDrawer(+c.dataset.id);
  });

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

  initBackground();
}

// فتح/إغلاق كرت بدون إعادة رسم اللوحة (حتى تشتغل الحركة)
function toggleCard(card) {
  const open = card.classList.toggle('open'), btn = card.querySelector('.more-btn'), x = card.querySelector('.extra');
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', `${open ? 'إخفاء' : 'عرض'} تفاصيل الطلب ${card.dataset.id}`);
  x.inert = !open;
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

// ---------- صورة الخلفية (لكل جهاز، تنحفظ بالمتصفح) ----------
function applyBg(url) {
  document.body.classList.toggle('has-bg', !!url);
  if (url) document.body.style.setProperty('--bg-img', `url("${url}")`);
  else document.body.style.removeProperty('--bg-img');
}

// نصغّر الصورة (أقصى 1920px، JPEG) حتى تنحفظ بالمتصفح وما تثقل الصفحة
function shrink(file) {
  return new Promise((ok, bad) => {
    const img = new Image(), src = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1920 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src); ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(src); bad(new Error('ما انقرت الصورة')) };
    img.src = src;
  });
}

function initBackground() {
  try { applyBg(localStorage.getItem('ib_bg')) } catch (e) { }
  $('#bgBtn').onclick = () => {
    if (!document.body.classList.contains('has-bg')) return $('#bgIn').click();
    ask('صورة الخلفية', [{
      id: 'a', label: 'شتريد تسوي؟', type: 'select',
      opts: '<option value="change">تغيير الصورة</option><option value="remove">إزالة الخلفية</option>',
    }], v => {
      if (v.a === 'change') return $('#bgIn').click();
      try { localStorage.removeItem('ib_bg') } catch (e) { }
      applyBg(null); toast('انشالت الخلفية');
    });
  };
  $('#bgIn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!f.type.startsWith('image/')) return toast('اختار صورة');
    try {
      const url = await shrink(f);
      applyBg(url);
      try { localStorage.setItem('ib_bg', url) } catch (err) { toast('الصورة كبيرة، راح تنشال لما تسكر الصفحة'); return }
      toast('انحفظت الخلفية على هذا الجهاز');
    } catch (err) { toast(err.message) }
  };
}
