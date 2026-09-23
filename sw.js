// Service worker: يخلي الموقع ينثبت كتطبيق ويفتح أسرع.
// "الشبكة أولاً": دائماً ياخذ آخر نسخة، والمخزّن بس إذا ماكو إنترنت.
// البيانات (Supabase) ما تنخزن هنا أبداً.
const CACHE = 'invoices-v1';
const SHELL = [
  './', 'index.html', 'assets/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'assets/js/main.js', 'assets/js/config.js', 'assets/js/util.js', 'assets/js/state.js', 'assets/js/api.js',
  'assets/js/can.js', 'assets/js/actions.js', 'assets/js/auth.js', 'assets/js/board.js', 'assets/js/drawer.js',
  'assets/js/users.js', 'assets/js/customers.js', 'assets/js/reports.js', 'assets/js/export.js', 'assets/js/backup.js',
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
