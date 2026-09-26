// لوحة الإشعارات (الجرس): تغيّر مرحلة طلبك، أو أحد ذكرك بـ @ بتعليق أو بالملاحظات.
// الإشعارات تنكتب بالقاعدة (تريغرات 007) وتوصل مباشرة عبر Realtime.
import { S, COLS, SUB, getInv, userName } from './state.js';
import { sb, refreshInvoice } from './api.js';
import { $, esc, ic, toast } from './util.js';
import { VAPID_PUBLIC_KEY } from './config.js';
import { avatarHTML } from './avatars.js';
import { openDrawer } from './drawer.js';

let LIST = [], chan = null, open = false;
const BASE_TITLE = document.title;
const unread = () => LIST.filter(n => !n.read_at).length;

// نص الإشعار (بدون HTML)
function text(n) {
  const d = n.data || {}, who = n.actor ? userName(n.actor) : 'النظام';
  const inv = `#${n.invoice_id}${d.customer ? ' (' + d.customer + ')' : ''}`;
  if (n.kind === 'mention') return `${who} ذكرك ${d.src === 'notes' ? 'بالملاحظات' : 'بتعليق'} على الطلب ${inv}`;
  if (n.kind === 'comment') return `${who} علّق على طلبك ${inv}`;
  if (n.kind === 'late') return `الطلب ${inv} صار له ${d.days} يوم بنفس المرحلة وينتظرك`;
  if (d.stage === 'acc' && d.from_stage === 'decision') return `${who} رجّع الطلب ${inv} للحسابات`;
  if (n.kind === 'turn') return `${who} حوّل لك الطلب ${inv} — ${TURN[d.stage === 'decision' ? d.sub : d.stage] || ''}`;
  if (d.stage === 'done') return `${who} حوّل الطلب ${inv} لمبيعات ✓`;
  if (d.stage === 'cancel') return `${who} ألغى الطلب ${inv}${d.reason ? ': ' + d.reason : ''}`;
  const to = d.stage === 'decision' ? SUB[d.sub] : (COLS.find(c => c.k === d.stage) || {}).t || d.stage;
  return `${who} نقل الطلب ${inv} إلى: ${to}`;
}

// "دورك": شنو المطلوب منك
const TURN = { new: 'كمّله وأرسله للحسابات', acc: 'يحتاج السداد والكلفة', mgr: 'ينتظر موافقتك', cust: 'بلّغ الزبون وأشّر رده', wh: 'جاهز للتحويل لمبيعات' };

function ago(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'هسه';
  if (s < 3600) return `قبل ${Math.floor(s / 60)} دقيقة`;
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} ساعة`;
  if (s < 7 * 86400) return `قبل ${Math.floor(s / 86400)} يوم`;
  return new Date(ts).toLocaleDateString('en-GB');
}

function kindIcon(n) {
  const d = n.data || {};
  if (n.kind === 'mention') return ['at', 'var(--primary)'];
  if (n.kind === 'comment') return ['chat', 'var(--primary)'];
  if (n.kind === 'late') return ['clock', 'var(--urgent)'];
  if (n.kind === 'turn' && !(d.stage === 'acc' && d.from_stage === 'decision')) return ['inbox', 'var(--ok)'];
  if (d.stage === 'done') return ['check', 'var(--ok)'];
  if (d.stage === 'cancel') return ['x', 'var(--bad)'];
  if (d.stage === 'acc' && d.from_stage === 'decision') return ['back', 'var(--warn)'];
  return ['board', 'var(--vio)'];
}

function paintBadge() {
  const n = unread(), b = $('#bellN');
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', !n);
  $('#bellBtn').setAttribute('aria-label', n ? `الإشعارات: ${n} غير مقروءة` : 'الإشعارات');
  document.title = (n ? `(${n}) ` : '') + BASE_TITLE;
}

function paintList() {
  if (!open) return;
  const n = unread();
  $('#notifPop').innerHTML = `<div class="np-head"><h2>الإشعارات</h2>
      ${n ? `<button type="button" class="link-btn" data-np="all">تعليم الكل كمقروء</button>` : ''}</div>
    ${permHTML()}
    <ul class="np-list">${LIST.map(x => {
      const [icn, col] = kindIcon(x), d = x.data || {};
      return `<li><button type="button" class="np-item${x.read_at ? '' : ' unread'}" data-nid="${x.id}">
        <span class="np-av">${x.actor ? avatarHTML(x.actor, 36) : `<span class="avatar np-sys" style="width:36px;height:36px">${ic('clock')}</span>`}<span class="np-kind" style="background:${col}">${ic(icn)}</span></span>
        <span class="np-body"><span class="np-text">${esc(text(x))}</span>
          ${(x.kind === 'mention' || x.kind === 'comment') && d.text ? `<span class="np-quote">${esc(d.text)}</span>` : ''}
          <span class="np-time">${ago(x.created_at)}</span></span>
        ${x.read_at ? '' : '<span class="np-dot" aria-label="غير مقروء"></span>'}</button></li>`;
    }).join('') || `<li class="np-empty">${ic('bell')}<span>ما عندك إشعارات بعد.<br>توصلك هنا لما تتغير مرحلة طلبك أو أحد يذكرك بـ @</span></li>`}</ul>`;
}

const paint = () => { paintBadge(); paintList() };

// ---------- تنبيهات الموبايل/الكمبيوتر (Web Push) ----------
const pushOK = () => !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function permHTML() {
  if (!('Notification' in window)) return isIOS && !standalone()
    ? `<div class="np-perm info">${ic('bell')}حتى توصلك التنبيهات على الآيفون: ثبّت الموقع (مشاركة ← إضافة إلى الشاشة الرئيسية) وافتحه من الأيقونة</div>` : '';
  if (Notification.permission === 'default') return `<button type="button" class="np-perm" data-np="perm">${ic('bell')}${pushOK() ? 'فعّل تنبيهات الجهاز — توصلك حتى لو الموقع مسكّر' : 'فعّل تنبيهات الجهاز حتى توصلك وأنت بصفحة ثانية'}</button>`;
  if (Notification.permission === 'denied') return `<div class="np-perm info">${ic('bell')}التنبيهات مقفولة لهذا الموقع من إعدادات المتصفح</div>`;
  return '';
}

const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)) };

// يسجل هذا الجهاز للمستخدم الحالي (أو يجدد تسجيله). ما يسأل الإذن — لازم يكون ممنوح
export async function syncPush() {
  if (!pushOK() || Notification.permission !== 'granted' || !S.ME) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    await sb.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
  } catch (e) { console.warn('push', e) }
}

// عند تسجيل الخروج: الجهاز يوقف يستلم تنبيهات هذا المستخدم
export async function dropPush() {
  if (!pushOK()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await sb.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }); await sub.unsubscribe() }
  } catch (e) { }
}

export async function loadNotifs() {
  const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
  // قبل ما تتشغل 007 الجدول مو موجود: نخفي الجرس
  $('#bellBtn').classList.toggle('hidden', !!error);
  if (error) return;
  LIST = data || []; paint();
  syncPush();
}

// تنبيه الجهاز: بس إذا الصفحة مو قدامه (وإلا يكفي التوست)
function sysNotify(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const opts = { body: text(n), icon: 'icons/icon-192.png', tag: 'n' + n.id, dir: 'rtl', lang: 'ar', data: { inv: n.invoice_id } };
  const fallback = () => { try { const x = new Notification('فواتير المبيعات', opts); x.onclick = () => { focus(); openInv(n.invoice_id); x.close() } } catch (e) { } };
  if (navigator.serviceWorker && navigator.serviceWorker.controller)
    navigator.serviceWorker.ready.then(r => r.showNotification('فواتير المبيعات', opts)).catch(fallback);
  else fallback();
}

const dropChan = () => { if (chan) { sb.removeChannel(chan); chan = null } };
export function subscribeNotifs() {
  dropChan();
  chan = sb.channel('notifs-' + S.ME.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${S.ME.id}` }, p => {
      const n = p.new; if (!n || LIST.some(x => x.id === n.id)) return;
      LIST.unshift(n); LIST.length = Math.min(LIST.length, 60);
      paint(); toast('🔔 ' + text(n)); sysNotify(n);
      $('#bellBtn').classList.remove('ring'); void $('#bellBtn').offsetWidth; $('#bellBtn').classList.add('ring');
    })
    .subscribe();
}
export function unsubscribeNotifs() { dropChan(); LIST = []; setOpen(false) }

async function markRead(ids) {
  ids = ids.filter(id => { const x = LIST.find(n => n.id === id); return x && !x.read_at });
  if (!ids.length) return;
  const at = new Date().toISOString();
  LIST.forEach(n => { if (ids.includes(n.id)) n.read_at = at });
  paint();
  const { error } = await sb.from('notifications').update({ read_at: at }).in('id', ids);
  if (error) toast(error.message);
}

async function openInv(id) {
  if (!id) return;
  if (!getInv(id)) await refreshInvoice(id);   // ممكن طلب مغلق قديم مو ضمن الفترة المحمّلة
  getInv(id) ? openDrawer(id) : toast('الطلب #' + id + ' انحذف أو ما عندك صلاحية تشوفه');
}

function setOpen(v) {
  open = v;
  $('#notifPop').classList.toggle('hidden', !v);
  $('#bellBtn').setAttribute('aria-expanded', String(v));
  if (v) { paintList(); const f = $('#notifPop .np-item,#notifPop button'); f && f.focus({ preventScroll: true }) }
}

export function initNotifs() {
  $('#bellBtn').onclick = e => { e.stopPropagation(); setOpen(!open) };
  $('#notifPop').addEventListener('click', async e => {
    e.stopPropagation();
    const a = e.target.closest('[data-np]');
    if (a && a.dataset.np === 'all') return markRead(LIST.map(n => n.id));
    if (a && a.dataset.np === 'perm') {
      const r = await Notification.requestPermission();
      if (r === 'granted') { await syncPush(); toast('تفعّلت التنبيهات على هذا الجهاز') }
      return paintList();
    }
    const it = e.target.closest('[data-nid]'); if (!it) return;
    const n = LIST.find(x => x.id === +it.dataset.nid); if (!n) return;
    setOpen(false); markRead([n.id]); openInv(n.invoice_id);
  });
  document.addEventListener('click', () => { if (open) setOpen(false) });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { setOpen(false); $('#bellBtn').focus() } });
  // ضغطة على تنبيه الجهاز والموقع مفتوح (sw.js يرسل رقم الطلب)
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.openInv && S.ME) openInv(+e.data.openInv) });
  // "قبل 5 دقائق" تبقى صحيحة
  setInterval(() => { if (open) paintList() }, 60000);
}
