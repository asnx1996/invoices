// سيرفر برنامج الفواتير المحلي: يقدّم الواجهة + API بدل Supabase.
// يشتغل على الحاسبة الرئيسية؛ باقي الحاسبات تفتح http://<IP-الحاسبة>:8787
import { createServer } from 'node:http';
import { readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { config, saveConfig, filesDir, SERVER_DIR } from './config.js';
import { connect, db, tx, sql } from './db.js';
import { AppError, loadUser, getInvoice, canSee, perm, fail } from './rules.js';
import { runQuery } from './query.js';
import { RPC, notifyLate } from './rpc.js';
import { login, logout, sessionUser, changeOwnPassword } from './auth.js';
import { addClient, emit } from './realtime.js';

if (!config.secret) { config.secret = randomBytes(32).toString('hex'); saveConfig() }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.gif': 'image/gif', '.mp4': 'video/mp4' };

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) };
const errBody = e => ({ error: { message: e.message, code: e.code } });

async function readBody(req, limit = 12e6) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new AppError('الطلب كبير', 413); chunks.push(c) }
  return Buffer.concat(chunks);
}
const readJson = async req => { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {} };
const tokenOf = (req, url) => (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('token') || '';

// ينفذ داخل معاملة ويبث التغييرات بعد الحفظ
async function inTx(user, fn) {
  const ctx = { events: [] };
  const out = await tx(async r => { ctx.user = await loadUser(r, user && user.id); return fn(r, ctx) });
  emit(ctx.events);
  return out;
}

// ---------------------------------------------------------------- ملفات الـ PDF
const safePath = p => {
  const clean = String(p || '').replace(/\\/g, '/');
  if (!/^\d+\/[\w.\-]+$/.test(clean)) fail('مسار ملف غير صالح');
  return clean;
};
const sign = (path, exp) => createHmac('sha256', config.secret).update(path + '|' + exp).digest('base64url');

async function storage(req, res, url, user, action) {
  if (action === 'upload') {
    const path = safePath(url.searchParams.get('path'));
    const body = await readBody(req, 2 * 1024 * 1024 + 1);
    if (body.length > 2 * 1024 * 1024) fail('الحجم أكثر من 2 MB');
    if (body.subarray(0, 5).toString() !== '%PDF-') fail('الملف لازم PDF');
    await inTx(user, async (r, ctx) => {
      const u = ctx.user, inv = await getInvoice(r, +path.split('/')[0]);
      if (!inv || !(u.admin || (perm(u, 'create') && inv.rep_id === u.uid && inv.stage === 'new'))) fail('ما عندك صلاحية رفع ملف لهذا الطلب', 403);
    });
    const full = join(filesDir(), ...path.split('/'));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return json(res, 200, { data: { path } });
  }
  if (action === 'remove') {
    const { paths = [] } = await readJson(req);
    const done = [];
    for (const p of paths) {
      const path = safePath(p);
      const ok = await inTx(user, async (r, ctx) => {
        const u = ctx.user; if (!u.active) return false;
        if (u.admin) return true;
        const inv = await getInvoice(r, +path.split('/')[0]);
        if (!inv) return true;   // الطلب انحذف نهائياً — الملف يتيم
        return (perm(u, 'trash') && inv.deleted_at != null) || (perm(u, 'create') && inv.rep_id === u.uid && inv.stage === 'new');
      });
      if (!ok) continue;
      try { await unlink(join(filesDir(), ...path.split('/'))); done.push(path) } catch (e) { }
    }
    return json(res, 200, { data: done });
  }
  if (action === 'sign') {
    const { path: p, expiresIn = 3600 } = await readJson(req);
    const path = safePath(p);
    await inTx(user, async (r, ctx) => {
      const inv = await getInvoice(r, +path.split('/')[0]);
      if (!ctx.user.active || !inv || !(canSee(ctx.user, inv) || inv.deleted_at != null && perm(ctx.user, 'trash'))) fail('الملف غير موجود', 404);
    });
    const exp = Date.now() + Math.min(+expiresIn || 3600, 86400) * 1000;
    return json(res, 200, { data: { signedUrl: `/api/files/${path}?exp=${exp}&sig=${sign(path, exp)}` } });
  }
  fail('غير معروف', 404);
}

async function serveFile(res, url) {
  const path = safePath(decodeURIComponent(url.pathname.slice('/api/files/'.length)));
  const exp = +url.searchParams.get('exp'), sig = url.searchParams.get('sig') || '';
  const want = Buffer.from(sign(path, exp)), got = Buffer.from(sig);
  if (!(exp > Date.now()) || want.length !== got.length || !timingSafeEqual(want, got)) return json(res, 403, { error: { message: 'الرابط منتهي' } });
  const full = join(filesDir(), ...path.split('/'));
  try { await stat(full) } catch (e) { return json(res, 404, { error: { message: 'الملف غير موجود' } }) }
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=3600' });
  createReadStream(full).pipe(res);
}

// ---------------------------------------------------------------- الواجهة
const NM = join(SERVER_DIR, 'node_modules');
const VENDOR = [
  ['/vendor/xlsx.full.min.js', join(NM, 'xlsx', 'dist', 'xlsx.full.min.js')],
  ['/vendor/font/', join(NM, '@fontsource', 'ibm-plex-sans-arabic')],
];
let indexCache = null;
async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const vendor = VENDOR.find(([pre]) => p.startsWith(pre));
  if (vendor) {
    const base = normalize(vendor[1]), f = normalize(join(base, p.slice(vendor[0].length)));
    if (!f.startsWith(base)) { res.writeHead(404); return res.end() }
    try {
      if (!(await stat(f)).isFile()) throw new Error();
      res.writeHead(200, { 'Content-Type': MIME[extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
      return createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(404); return res.end() }
  }
  const root = normalize(config.webRoot);
  const full = normalize(join(root, p));
  if (!full.startsWith(root + sep) || /[\\/](desktop|supabase|node_modules|\.git|\.claude|tests|docs)([\\/]|$)/.test(full.slice(root.length))) {
    res.writeHead(404); return res.end();
  }
  try {
    if (p === '/index.html') {
      // وضع محلي: نشيل مكتبة Supabase (تحتاج إنترنت) ونعرّف الواجهة بالـ API المحلي
      // والخط ومكتبة Excel من نسخة محلية بدل الإنترنت
      indexCache ||= (await readFile(full, 'utf8'))
        .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]*><\/script>\s*/, '')
        .replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/[^>]*><\/script>/, '<script src="vendor/xlsx.full.min.js"></script>')
        .replace(/<link rel="preconnect"[^>]*>\s*/g, '')
        .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, [400, 500, 600, 700].map(w => `<link rel="stylesheet" href="vendor/font/${w}.css">`).join('\n'))
        .replace(/(http-equiv="Content-Security-Policy" content=")[^"]*"/, `$1default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"`)
        // قبل الـ CSP حتى ينقرا (الـ CSP يمنع السكربتات المضمّنة بعده)
        .replace('<head>', '<head>\n<script>window.__LOCAL_API__ = "/api";</script>');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return res.end(indexCache);
    }
    const st = await stat(full);
    if (!st.isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(full).pipe(res);
  } catch (e) { res.writeHead(404); res.end() }
}

// ---------------------------------------------------------------- الطلبات
async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(req, res, url);
  if (p.startsWith('/api/files/')) return serveFile(res, url);

  const r = await db();
  if (p === '/api/health') return json(res, 200, { ok: true, version: 1 });
  if (p === '/api/auth/login' && req.method === 'POST') {
    const { email, password } = await readJson(req);
    return json(res, 200, { data: await login(r, email, password) });
  }
  const token = tokenOf(req, url);
  const user = await sessionUser(r, token);
  if (p === '/api/auth/user') return json(res, 200, { data: { user } });
  if (p === '/api/auth/logout') { await logout(r, token); return json(res, 200, { data: null }) }
  if (!user) return json(res, 401, { error: { message: 'انتهت الجلسة، سجّل دخول من جديد', code: 'no_session' } });

  if (p === '/api/events') return addClient(res, user.id);
  if (p === '/api/auth/password' && req.method === 'POST') {
    const { password } = await readJson(req);
    await changeOwnPassword(r, user.id, password);
    return json(res, 200, { data: { user } });
  }
  if (p === '/api/query' && req.method === 'POST') {
    const q = await readJson(req);
    const rows = q.op === 'select' && !q.lock
      ? await (async () => { const ctx = { events: [], user: await loadUser(r, user.id) }; return runQuery(r, ctx, q) })()
      : await inTx(user, (tr, ctx) => runQuery(tr, ctx, q));
    return json(res, 200, { data: rows });
  }
  const m = /^\/api\/rpc\/([a-z_]+)$/.exec(p);
  if (m && req.method === 'POST') {
    const fn = RPC[m[1]];
    if (!fn) return json(res, 404, { error: { message: 'إجراء غير معروف: ' + m[1] } });
    const args = await readJson(req);
    return json(res, 200, { data: await inTx(user, (tr, ctx) => fn(tr, ctx, args)) ?? null });
  }
  const s = /^\/api\/storage\/(upload|remove|sign)$/.exec(p);
  if (s && req.method === 'POST') return storage(req, res, url, user, s[1]);
  return json(res, 404, { error: { message: 'غير موجود' } });
}

const server = createServer(async (req, res) => {
  try { await handle(req, res) }
  catch (e) {
    const known = e instanceof AppError;
    if (!known) console.error(new Date().toISOString(), req.method, req.url, e.message, e.sqlText ? '\n  SQL: ' + e.sqlText.slice(0, 500) : '');
    // أخطاء القاعدة المعروفة برسالة مفهومة
    let msg = e.message;
    if (e.number === 2601 || e.number === 2627) msg = 'القيمة موجودة من قبل (مكررة)';
    else if (e.number === 547) msg = 'ما يصير: البيانات مرتبطة ببيانات ثانية أو القيمة غير مسموحة';
    if (!res.headersSent) json(res, e.status || (known ? 400 : 500), errBody({ ...e, message: msg }));
    else try { res.end() } catch (_) { }
  }
});

// ---------------------------------------------------------------- تشغيل
await connect();
server.listen(config.port, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`سيرفر الفواتير شغال على المنفذ ${config.port}`);
  console.log(`  هاي الحاسبة:    http://localhost:${config.port}`);
  for (const ip of ips) console.log(`  من الشبكة:      http://${ip}:${config.port}`);
});

// تنبيه الطلبات المتأخرة كل ساعة
const lateTick = async () => {
  try { const out = await tx(r => notifyLate(r)); emit(out.events) } catch (e) { console.error('notify_late:', e.message) }
};
setTimeout(lateTick, 60000).unref();
setInterval(lateTick, 3600000).unref();

export { server };
