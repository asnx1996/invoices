import { S, onChange, reps, hasRole, getInv } from './state.js';
import { sb, getRange, setRange, refreshInvoice } from './api.js';
import { can } from './can.js';
import { $, $$, toast } from './util.js';
import { initAuth } from './auth.js';
import { initBoard, renderBoard, fillFilters } from './board.js';
import { initDrawer, openDrawer, hideDrawer } from './drawer.js';
import { initUsers, renderUsers } from './users.js';
import { initCustomers, renderCustomers } from './customers.js';
import { initReports, renderReports } from './reports.js';
import { initExport } from './export.js';

const VIEWS = { board: '#viewBoard', customers: '#viewCustomers', reports: '#viewReports', users: '#viewUsers' };
let view = 'board';
let pendingInv = null; // رابط طلب (#inv-12) ينفتح بعد ما تتحمل البيانات

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
  if (pendingInv && S.loaded) {
    const id = pendingInv; pendingInv = null;
    getInv(id) ? openDrawer(id) : toast('الطلب #' + id + ' مو موجود أو ما عندك صلاحية تشوفه');
  }
});

$$('.tab').forEach(t => t.onclick = () => show(t.dataset.view));
$('#fRange').addEventListener('change', e => setRange(+e.target.value));

$('#newBtn').onclick = async () => {
  const rep_id = hasRole('rep') ? S.ME.id : (reps()[0] || {}).id;
  if (!rep_id) return toast('ماكو مندوبين مفعّلين');
  const { data, error } = await sb.from('invoices').insert({ rep_id }).select().single();
  if (error) return toast(error.message);
  await refreshInvoice(data.id); openDrawer(data.id);
  setTimeout(() => { const f = $('#f_customer_pick'); f && f.focus() }, 150);
};

// الوضع الليلي
$('#themeBtn').onclick = () => {
  const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  // نوقف الانتقالات لحظة التبديل حتى الألوان تتبدل مرة وحدة بدل ما تتلطخ عنصر عنصر
  r.classList.add('no-trans'); r.dataset.theme = next; syncThemeBtn();
  void r.offsetHeight; requestAnimationFrame(() => r.classList.remove('no-trans'));
  try { localStorage.setItem('ib_theme', next) } catch (e) { }
};
function syncThemeBtn() {
  const r = document.documentElement;
  $('#themeBtn').setAttribute('aria-pressed', r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
}
try { const th = localStorage.getItem('ib_theme'); if (th) document.documentElement.dataset.theme = th } catch (e) { }
syncThemeBtn();

initBoard(); initDrawer(); initUsers(); initCustomers(); initReports(); initExport();
initAuth(onReady);

// تطبيق (PWA): يشتغل من الشاشة الرئيسية
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { });
}
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').classList.remove('hidden') });
$('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').classList.add('hidden') };
addEventListener('appinstalled', () => $('#installBtn').classList.add('hidden'));
