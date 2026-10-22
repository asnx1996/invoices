import { S, onChange, reps, roleHas, getInv } from './state.js';
import { sb, getRange, setRange, setBoard, findInvoice, loadAll, subscribe } from './api.js';
import { can } from './can.js';
import { $, $$, toast, esc } from './util.js';
import { initAuth } from './auth.js';
import { initBoard, renderBoard, fillFilters } from './board.js';
import { initDrawer, openDrawer, hideDrawer, openDraft } from './drawer.js';
import { initSettings, renderSettings, refreshSettingsNav, addBoard } from './settings.js';
import { initCustomers, renderCustomers } from './customers.js';
import { initExport } from './export.js';
import { initNotifs, loadNotifs, subscribeNotifs } from './notifications.js';
import { initMentions } from './mentions.js';
import { openAvatarPicker } from './avatars.js';
import { initAppearance } from './appearance.js';
import { initHome, renderHome, refreshHome } from './home.js';
import { initTrash, renderTrash } from './trash.js';
import { initSuper, renderSuper, paintSuper } from './supervisor.js';

const VIEWS = { home: '#viewHome', board: '#viewBoard', customers: '#viewCustomers', settings: '#viewSettings', trash: '#viewTrash', super: '#viewSuper' };
let view = 'board';
let pendingInv = null; // رابط طلب (#inv-12) ينفتح بعد ما تتحمل البيانات
let startHome = false; // فتح التطبيق بدون رابط: صفحة البوردات أول (إذا عنده أكثر من بورد)

// كل قسم إله رابط (#settings) حتى زر الرجوع بالموبايل والمتصفح يشتغل صح
const urlFor = v => v === 'board' ? location.pathname + location.search : '#' + v;

function show(v, push = true) {
  if (v === 'users') v = 'settings';   // الرابط القديم
  if (!VIEWS[v] || (v !== 'board' && !can(v))) v = 'board';
  if (push && v !== view) history.pushState({ v }, '', urlFor(v));
  view = v;
  $$('.tab').forEach(t => t.dataset.view === v ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'));
  $('#skipLink').setAttribute('href', VIEWS[v]);
  Object.entries(VIEWS).forEach(([k, sel]) => $(sel).classList.toggle('hidden', k !== v));
  $('#toolbar').classList.toggle('hidden', v !== 'board');
  if (v === 'settings') renderSettings();
  if (v === 'customers') renderCustomers();
  if (v === 'trash') renderTrash();
  if (v === 'super') renderSuper();
  if (v === 'home') { renderHome(); refreshHome() }
  $('#boardSel').classList.toggle('on-home', v === 'home');
}

// بعد تسجيل الدخول: نظهر/نخفي حسب الصلاحيات
function onReady() {
  $('#tabSettings').classList.toggle('hidden', !can('settings'));
  $('#tabCustomers').classList.toggle('hidden', !can('customers'));
  $('#tabTrash').classList.toggle('hidden', !can('trash'));
  $('#tabSuper').classList.toggle('hidden', !can('super'));
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
  if (view === 'super') paintSuper();
  if (view === 'settings') refreshSettingsNav();
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
$('#boardSel').addEventListener('change', e => setBoard(+e.target.value));

$$('.tab').forEach(t => t.onclick = () => show(t.dataset.view));
initHome(async id => { show('board'); await setBoard(id) }, addBoard);
$('#fRange').addEventListener('change', e => setRange(+e.target.value));

$('#newBtn').onclick = () => {
  const rep_id = roleHas(S.ME, 'create') ? S.ME.id : (reps()[0] || {}).id;
  if (!rep_id) return toast('ماكو مندوبين مفعّلين');
  openDraft(rep_id); // ما ينضاف للقاعدة لحد ما يضغط "حفظ الطلب"
  setTimeout(() => { const f = $('#f_customer_pick'); f && f.focus() }, 150);
};

initBoard(); initAppearance(); initDrawer(); initSettings(); initCustomers(); initExport(); initNotifs(); initMentions(); initTrash();
initSuper(async id => { show('board'); if (await findInvoice(id)) openDrawer(id); else toast('الطلب #' + id + ' مو موجود') });
$('#meBtn').onclick = () => openAvatarPicker();

// تحديث البيانات بدون إعادة تحميل الصفحة: زر بالهيدر، وتلقائياً لما يرجع للتطبيق أو يرجع الإنترنت
let refreshing = null;
function refreshNow(quiet = false) {
  if (!S.ME || refreshing) return refreshing;
  const btn = $('#refreshBtn'); btn.classList.add('spin'); btn.disabled = true;
  refreshing = (async () => {
    try {
      await loadAll();
      subscribe(); subscribeNotifs(); // نعيد الاتصال المباشر إذا انقطع
      await loadNotifs();
      if (view === 'super') await renderSuper();
      if (view === 'trash') await renderTrash();
      if (view === 'home') refreshHome();
      if (!quiet) toast('تم تحديث البيانات');
    } catch (e) { if (!quiet) toast('ما صار التحديث، تأكد من الإنترنت') }
    finally { btn.classList.remove('spin'); btn.disabled = false; refreshing = null }
  })();
  return refreshing;
}
$('#refreshBtn').onclick = () => refreshNow();
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60e3) refreshNow(true);
});
addEventListener('online', () => refreshNow(true));
initAuth(onReady);

// تطبيق (PWA): يشتغل من الشاشة الرئيسية
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { });
}
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').classList.remove('hidden') });
$('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').classList.add('hidden') };
addEventListener('appinstalled', () => $('#installBtn').classList.add('hidden'));
