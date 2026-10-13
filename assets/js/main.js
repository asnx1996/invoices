import { S, onChange, reps, hasRole, getInv } from './state.js';
import { sb, getRange, setRange, setBoard, findInvoice } from './api.js';
import { can } from './can.js';
import { $, $$, toast, esc } from './util.js';
import { initAuth } from './auth.js';
import { initBoard, renderBoard, fillFilters } from './board.js';
import { initDrawer, openDrawer, hideDrawer, openDraft } from './drawer.js';
import { initUsers, renderUsers, addBoard } from './users.js';
import { initCustomers, renderCustomers } from './customers.js';
import { initReports, renderReports } from './reports.js';
import { initExport } from './export.js';
import { initNotifs } from './notifications.js';
import { initMentions } from './mentions.js';
import { openAvatarPicker } from './avatars.js';
import { initAppearance, applyLook } from './appearance.js';
import { initHome, renderHome, refreshHome } from './home.js';

const VIEWS = { home: '#viewHome', board: '#viewBoard', customers: '#viewCustomers', reports: '#viewReports', users: '#viewUsers' };
let view = 'board';
let pendingInv = null; // رابط طلب (#inv-12) ينفتح بعد ما تتحمل البيانات
let startHome = false; // فتح التطبيق بدون رابط: صفحة البوردات أول (إذا عنده أكثر من بورد)

// كل قسم إله رابط (#reports) حتى زر الرجوع بالموبايل والمتصفح يشتغل صح
const urlFor = v => v === 'board' ? location.pathname + location.search : '#' + v;

function show(v, push = true) {
  if (!VIEWS[v] || (v !== 'board' && !can(v))) v = 'board';
  if (push && v !== view) history.pushState({ v }, '', urlFor(v));
  view = v;
  $$('.tab').forEach(t => t.dataset.view === v ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'));
  $('#skipLink').setAttribute('href', VIEWS[v]);
  Object.entries(VIEWS).forEach(([k, sel]) => $(sel).classList.toggle('hidden', k !== v));
  $('#toolbar').classList.toggle('hidden', v !== 'board');
  if (v === 'users') renderUsers();
  if (v === 'customers') renderCustomers();
  if (v === 'reports') renderReports();
  if (v === 'home') { renderHome(); refreshHome() }
  $('#boardSel').classList.toggle('on-home', v === 'home');
  applyLook();
}

// بعد تسجيل الدخول: نظهر/نخفي حسب الصلاحيات
function onReady() {
  $('#tabUsers').classList.toggle('hidden', !can('users'));
  $('#tabCustomers').classList.toggle('hidden', !can('customers'));
  $('#tabReports').classList.toggle('hidden', !can('reports'));
  $('#newBtn').classList.toggle('hidden', !can('create'));
  $('#exportBtn').classList.toggle('hidden', !can('export'));
  $('#fRange').value = String(getRange());
  const m = location.hash.match(/^#inv-(\d+)$/);
  pendingInv = m ? +m[1] : null;
  const v = m ? 'board' : location.hash.slice(1) || 'board';
  startHome = !location.hash || location.hash === '#home';
  show(v, false);
  history.replaceState({ v: view }, '', urlFor(view));
  fillFilters(); renderBoard();
}

addEventListener('popstate', () => {
  const st = history.state || {};
  if (S.drawerId && !st.drawer) hideDrawer();
  else if (st.drawer && st.drawer !== S.drawerId && getInv(st.drawer)) openDrawer(st.drawer, false);
  const v = st.v || (VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'board');
  if (S.ME && v !== view) show(v, false);
});

onChange(() => {
  if (!S.ME) return;
  fillFilters(); renderBoard();
  if (view === 'customers') renderCustomers();
  fillBoards();
  if (startHome && S.boardsLoaded) {
    startHome = false;
    if (can('home') && view === 'board') { show('home', false); history.replaceState({ v: view }, '', urlFor(view)) }
  }
  if (view === 'home') renderHome();
  applyLook();
  if (pendingInv && S.loaded) {
    const id = pendingInv; pendingInv = null;
    findInvoice(id).then(ok => ok ? openDrawer(id) : toast('الطلب #' + id + ' مو موجود أو ما عندك صلاحية تشوفه'));
  }
});

// اختيار البورد: يبين بس إذا المستخدم عنده أكثر من بورد
function fillBoards() {
  const sel = $('#boardSel'), list = S.BOARDS || [];
  const html = list.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html }
  if (S.board) sel.value = String(S.board);
  sel.classList.toggle('hidden', list.length < 2);
  $('#tabHome').classList.toggle('hidden', !can('home'));
  $('#noBoard').classList.toggle('hidden', !(S.BOARDS && !S.BOARDS.length));
}
$('#boardSel').addEventListener('change', async e => {
  await setBoard(+e.target.value);
  if (view === 'reports') renderReports();
});

$$('.tab').forEach(t => t.onclick = () => show(t.dataset.view));
initHome(async id => { show('board'); await setBoard(id) }, addBoard);
$('#fRange').addEventListener('change', e => setRange(+e.target.value));

$('#newBtn').onclick = () => {
  const rep_id = hasRole('rep') ? S.ME.id : (reps()[0] || {}).id;
  if (!rep_id) return toast('ماكو مندوبين مفعّلين');
  openDraft(rep_id); // ما ينضاف للقاعدة لحد ما يضغط "حفظ الطلب"
  setTimeout(() => { const f = $('#f_customer_pick'); f && f.focus() }, 150);
};

initBoard(); initAppearance(); initDrawer(); initUsers(); initCustomers(); initReports(); initExport(); initNotifs(); initMentions();
$('#meBtn').onclick = () => openAvatarPicker();
initAuth(onReady);

// تطبيق (PWA): يشتغل من الشاشة الرئيسية
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { });
}
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').classList.remove('hidden') });
$('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').classList.add('hidden') };
addEventListener('appinstalled', () => $('#installBtn').classList.add('hidden'));
