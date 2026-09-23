import { S, onChange, reps, hasRole } from './state.js';
import { sb, getRange, setRange, refreshInvoice } from './api.js';
import { can } from './can.js';
import { $, $$, toast } from './util.js';
import { initAuth } from './auth.js';
import { initBoard, renderBoard, fillFilters } from './board.js';
import { initDrawer, openDrawer } from './drawer.js';
import { initUsers, renderUsers } from './users.js';
import { initCustomers, renderCustomers } from './customers.js';
import { initReports, renderReports } from './reports.js';
import { initExport } from './export.js';

const VIEWS = { board: '#viewBoard', customers: '#viewCustomers', reports: '#viewReports', users: '#viewUsers' };
let view = 'board';

function show(v) {
  if (v !== 'board' && !can(v)) v = 'board';
  view = v;
  $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.view === v));
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
  show('board');
}

onChange(() => {
  if (!S.ME) return;
  fillFilters(); renderBoard();
  if (view === 'customers') renderCustomers();
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
  r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('ib_theme', r.dataset.theme) } catch (e) { }
};
try { const th = localStorage.getItem('ib_theme'); if (th) document.documentElement.dataset.theme = th } catch (e) { }

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
