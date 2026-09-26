// Service worker: يخلي الموقع ينثبت كتطبيق ويفتح أسرع.
// "الشبكة أولاً": دائماً ياخذ آخر نسخة، والمخزّن بس إذا ماكو إنترنت.
// البيانات (Supabase) ما تنخزن هنا أبداً.
const CACHE = 'invoices-v3';
const SHELL = [
  './', 'index.html', 'assets/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'assets/js/main.js', 'assets/js/config.js', 'assets/js/util.js', 'assets/js/state.js', 'assets/js/api.js',
  'assets/js/can.js', 'assets/js/actions.js', 'assets/js/auth.js', 'assets/js/board.js', 'assets/js/drawer.js',
  'assets/js/users.js', 'assets/js/customers.js', 'assets/js/reports.js', 'assets/js/export.js', 'assets/js/backup.js',
  'assets/js/avatars.js', 'assets/js/notifications.js', 'assets/js/mentions.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});

// تنبيه من السيرفر (Web Push) — يوصل حتى لو الموقع مسكّر
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {} } catch (err) { d = { body: e.data && e.data.text() } }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    // الموقع قدامه: الجرس والتوست يكفون
    if (list.some(c => c.visibilityState === 'visible' && c.focused)) return;
    return self.registration.showNotification(d.title || 'فواتير المبيعات', {
      body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', dir: 'rtl', lang: 'ar', data: { inv: d.inv },
    });
  }));
});

// الضغط على تنبيه الجهاز: يفتح الموقع على الطلب
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const inv = e.notification.data && e.notification.data.inv;
  const url = new URL(inv ? './#inv-' + inv : './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ openInv: inv }); return c.focus() }
    return self.clients.openWindow(url);
  }));
});
