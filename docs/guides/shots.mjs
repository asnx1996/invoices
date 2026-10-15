// صور الأدلة: يفتح النسخة التجريبية (بيانات وهمية) بـ Edge بدون واجهة، يدخل بكل دور، ويصوّر.
// الاستخدام: node demo/build.mjs && node docs/guides/shots.mjs  →  docs/guides/img/*.png
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('./img/', import.meta.url));
const EDGE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 8790, DBG = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };

// ---------- خادم محلي للنسخة التجريبية ----------
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    let f = join(ROOT, p);
    if (p.endsWith('/')) f = join(f, 'index.html');
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end() }
}).listen(PORT);

// ---------- Edge + بروتوكول DevTools ----------
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${DBG}`, '--no-first-run', '--disable-gpu',
  `--user-data-dir=${join(ROOT, 'docs/guides/.edge-profile')}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find(t => t.type === 'page') } catch { }
}
if (!target) throw new Error('Edge ما اشتغل');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const waiting = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } };
const cdp = (method, params = {}) => new Promise((ok, bad) => {
  const id = ++seq; waiting.set(id, m => m.error ? bad(new Error(method + ': ' + m.error.message)) : ok(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const W = 1280, H = 800;
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
const BASE = `http://127.0.0.1:${PORT}/demo/dist/`;

// صفحة نظيفة: بيانات تجريبية جديدة، ثيم فاتح، والبورد الأول
await cdp('Page.navigate', { url: BASE }); await sleep(1200);
await js(`localStorage.clear(); return 1`);

// يدخل كمستخدم، ويخفي أشياء النسخة التجريبية من الصورة
async function as(user, hash = '') {
  await js(`localStorage.setItem('invoices-demo-session', '${user}'); localStorage.setItem('ib_theme', 'light'); localStorage.setItem('ib_board', '1'); return 1`);
  await cdp('Page.navigate', { url: BASE + hash }); await sleep(600);
  await js(`for (let i = 0; i < 60; i++) { if (document.querySelector('.card[data-id], #viewHome:not(.hidden) .home-card')) break; await new Promise(r => setTimeout(r, 100)) }
    const st = document.createElement('style'); st.textContent = '.demo-tag,.demo-switch,#installBtn{display:none!important} *{transition:none!important;animation:none!important}';
    document.head.append(st); return 1`);
  await sleep(500);
}
const toBoard = () => js(`const c = document.querySelector('#viewHome:not(.hidden) [data-board="1"]'); if (c) { c.click(); await new Promise(r => setTimeout(r, 900)) } return 1`);
// يفتح أول طلب يطابق الشرط بعمود معيّن
const openCard = (col, has = '') => js(`const cards = [...document.querySelectorAll('.column[data-col="${col}"] .card')].filter(c => !'${has}' || c.innerHTML.includes('${has}'));
  if (!cards.length) return false; cards[0].querySelector('.card-link').click(); await new Promise(r => setTimeout(r, 900)); return true`);
const scrollDrawerTo = h => js(`const h = [...document.querySelectorAll('#drawer h4, #drawer summary')].find(x => x.textContent.includes('${h}'));
  if (h) { const b = document.querySelector('#drawer .d-body'); b.scrollTop = h.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 12 } return !!h`);

async function shot(name, sel = null, pad = 0) {
  await sleep(400);
  let clip = { x: 0, y: 0, width: W, height: H, scale: 1 };
  if (sel) {
    const r = await js(`const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }`);
    if (!r) { console.log('  ✗ ' + name + ' (ما لقيت ' + sel + ')'); return }
    clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(W, r.width + pad * 2), height: Math.min(H, r.height + pad * 2), scale: 1 };
  }
  const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip, captureBeyondViewport: false });
  await writeFile(join(OUT, name + '.jpg'), Buffer.from(data, 'base64'));
  console.log('  ✓ ' + name);
}

await mkdir(OUT, { recursive: true });
console.log('Shots:');

// ---- الأدمن ----
await as('u-admin');
await shot('home');
await toBoard(); await shot('board_admin');
await shot('card', '.column[data-col="decision"] .card', 6);
await js(`document.querySelector('#fRep').closest('.ssel').querySelector('.ssel-btn').click(); const q = document.querySelector('#fRep').closest('.ssel').querySelector('.ssel-q'); q.value = 'عل'; q.dispatchEvent(new Event('input')); return 1`);
{ const r = await js(`const a = document.querySelector('#fRep').closest('.ssel').getBoundingClientRect(), p = document.querySelector('.ssel-pop:not(.hidden)').getBoundingClientRect();
    return { x: Math.min(a.x, p.x) - 10, y: a.y - 10, width: Math.max(a.right, p.right) - Math.min(a.x, p.x) + 20, height: p.bottom - a.y + 20 }`);
  const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { ...r, scale: 1 } });
  await writeFile(join(OUT, 'filter.jpg'), Buffer.from(data, 'base64')); console.log('  ✓ filter'); }
await js(`document.body.click(); return 1`);
await js(`document.querySelector('#bgBtn').click(); return 1`); await shot('bg', '#appearanceDialog');
await js(`document.querySelector('#appearanceDone').click(); document.querySelector('[data-view="users"]').click(); return 1`);
await sleep(800); await shot('users');
await js(`window.scrollTo(0, document.querySelector('#boardsPanel').offsetTop - 80); return 1`); await shot('boards', '#boardsPanel', 8);

// ---- المندوب ----
await as('u-rep1');
await shot('board_rep');
await js(`document.querySelector('#newBtn').click(); return 1`); await sleep(700);
await shot('rep_new', '#drawer');
await js(`document.querySelector('#drawer .close').click(); return 1`); await sleep(400);
(await openCard('decision', 'بانتظار رد الزبون')) || console.log('  ! ماكو طلب بانتظار رد الزبون للمندوب');
await shot('rep_cust', '#drawer');
await js(`history.back(); return 1`); await sleep(500);
await js(`document.querySelector('#bellBtn').click(); return 1`); await sleep(400);
await shot('notif', '#notifPop', 6);

// ---- المحاسب ----
await as('u-acc');
await shot('board_acc');
(await openCard('acc')) || console.log('  ! ماكو طلب بالحسابات');
await scrollDrawerTo('السداد والنقل'); await shot('acc', '#drawer');
await js(`const b = document.querySelector('#drawer .d-body'); b.scrollTop = 0; return 1`); await shot('acc_top', '#drawer');

// ---- المدير ----
await as('u-mgr');
await toBoard(); await shot('board_mgr');
(await openCard('decision', 'بانتظار موافقة المدير')) || console.log('  ! ماكو طلب بانتظار المدير');
await shot('mgr', '#drawer');
await js(`history.back(); return 1`); await sleep(400);
await js(`document.querySelector('[data-view="reports"]').click(); return 1`); await sleep(1200);
await shot('reports');

// ---- المخزن ----
await as('u-wh');
await shot('board_wh');
(await openCard('decision', 'بانتظار تحويل المخزن')) || console.log('  ! ماكو طلب بانتظار المخزن');
await shot('wh', '#drawer');

ws.close(); edge.kill(); server.close();
