// برنامج فواتير المبيعات (Electron).
// الحاسبة الرئيسية: البرنامج يشغّل السيرفر المحلي (SQL Server) ويفتح الواجهة منه.
// باقي الحاسبات: تتصل بالحاسبة الرئيسية على الشبكة.
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = app.isPackaged ? process.resourcesPath : join(HERE, '..');
const SERVER_DIR = app.isPackaged ? join(RES, 'server') : join(HERE, '..', 'server');
const WEB_ROOT = app.isPackaged ? join(RES, 'web') : join(HERE, '..', '..');
const ICON = join(WEB_ROOT, 'icons', 'progress-192.png');
const PORT = 8787;

const USER = app.getPath('userData');
const SETTINGS = join(USER, 'settings.json');
const readSettings = () => { try { return JSON.parse(readFileSync(SETTINGS, 'utf8')) } catch (e) { return {} } };
const saveSettings = s => { mkdirSync(USER, { recursive: true }); writeFileSync(SETTINGS, JSON.stringify(s, null, 2)) };

// السيرفر يقرا إعداداته من هنا (لازم قبل ما ينحمّل)
process.env.INVOICES_CONFIG = join(USER, 'server-config.json');
process.env.INVOICES_DATA = join(USER, 'data');
process.env.INVOICES_WEBROOT = WEB_ROOT;

let win = null, tray = null, server = null, quitting = false;
const serverMod = f => import(pathToFileURL(join(SERVER_DIR, 'src', f)).href);

async function startServer() {
  if (server) return server;
  const { start } = await serverMod('app.js');
  server = await start();
  return server;
}

async function healthy(url) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(url.replace(/\/$/, '') + '/api/health', { signal: ctl.signal });
    clearTimeout(t);
    return r.ok && (await r.json()).ok === true;
  } catch (e) { return false }
}

const normUrl = s => {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//.test(s)) s = 'http://' + s;
  const u = new URL(s);
  if (!u.port) u.port = String(PORT);
  return u.origin;
};

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    title: 'فواتير المبيعات', icon: ICON, backgroundColor: '#0b1020', show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(HERE, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // الروابط الخارجية (PDF مثلاً بتبويب جديد) تنفتح ببرنامج النظام
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const child = new BrowserWindow({ width: 1000, height: 800, icon: ICON, autoHideMenuBar: true, parent: win });
      child.loadURL(url);
    }
    return { action: 'deny' };
  });
  win.on('close', e => {
    // الحاسبة الرئيسية: السكر يخلي السيرفر شغال بالخلفية حتى باقي الحاسبات تبقى تشتغل
    if (readSettings().mode === 'server' && !quitting) { e.preventDefault(); win.hide(); trayNote() }
  });
}

let noted = false;
function trayNote() {
  if (noted || !tray) return; noted = true;
  tray.displayBalloon?.({ title: 'فواتير المبيعات', content: 'البرنامج شغال بالخلفية حتى باقي الحاسبات تبقى متصلة. للإيقاف: كليك يمين على الأيقونة ← إيقاف وخروج.' });
}

function makeTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('فواتير المبيعات — السيرفر شغال');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'فتح البرنامج', click: () => { win.show(); win.focus() } },
    { label: 'عناوين الشبكة', click: () => showAddresses() },
    { type: 'separator' },
    { label: 'إيقاف وخروج', click: () => { quitting = true; app.quit() } },
  ]));
  tray.on('double-click', () => { win.show(); win.focus() });
}

function showAddresses() {
  const list = (server?.addresses || []).map(ip => `http://${ip}:${PORT}`).join('\n') || 'ماكو شبكة';
  dialog.showMessageBox(win, { type: 'info', title: 'عنوان الحاسبة الرئيسية', message: 'الحاسبات الثانية تتصل على هذا العنوان:', detail: list });
}

async function openSetup(error) {
  await win.loadFile(join(HERE, 'setup.html'), { query: error ? { error } : {} });
}

async function boot() {
  const s = readSettings();
  if (s.mode === 'server') {
    try {
      await startServer();
      makeTray();
      return win.loadURL(`http://localhost:${PORT}/`);
    } catch (e) { return openSetup('ما اشتغل السيرفر: ' + e.message) }
  }
  if (s.mode === 'client' && s.serverUrl) {
    if (await healthy(s.serverUrl)) return win.loadURL(s.serverUrl + '/');
    return openSetup(`ما كدرت أوصل للحاسبة الرئيسية (${s.serverUrl}). تأكد إنها شغالة وعلى نفس الشبكة.`);
  }
  return openSetup();
}

// ---------------------------------------------------------------- شاشة الإعداد
ipcMain.handle('setup:state', async () => {
  const s = readSettings();
  let instances = [], sqlcmd = false;
  try { const m = await serverMod('install.js'); instances = m.listInstances(); sqlcmd = m.hasSqlcmd() } catch (e) { }
  return { settings: s, instances, sqlcmd, port: PORT };
});

ipcMain.handle('setup:client', async (_e, address) => {
  const url = normUrl(address);
  if (!url) throw new Error('اكتب عنوان الحاسبة الرئيسية');
  if (!await healthy(url)) throw new Error(`ما كدرت أوصل لـ ${url}. تأكد من العنوان، وإن البرنامج شغال على الحاسبة الرئيسية، وإن الجدار الناري يسمح بالمنفذ ${PORT}.`);
  saveSettings({ mode: 'client', serverUrl: url });
  setImmediate(() => win.loadURL(url + '/'));
  return true;
});

ipcMain.handle('setup:server', async (_e, { instance, adminName, adminPass, fullName }) => {
  const m = await serverMod('install.js');
  const log = [];
  await m.installDb({ instance, log: x => log.push(x) });
  await startServer();
  if (!await m.hasUsers()) {
    if (!adminName || !adminPass) throw new Error('اكتب اسم مستخدم ورمز الأدمن');
    await m.createAdmin(adminName, adminPass, fullName || adminName);
    log.push('✓ انشأ حساب الأدمن');
  }
  saveSettings({ mode: 'server' });
  makeTray();
  setImmediate(() => win.loadURL(`http://localhost:${PORT}/`));
  return { log, addresses: server.addresses };
});

ipcMain.handle('setup:reset', async () => { saveSettings({}); await openSetup(); return true });

// ---------------------------------------------------------------- تشغيل
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); if (win.isMinimized()) win.restore(); win.focus() } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'البرنامج', submenu: [
        { label: 'تحديث الصفحة', accelerator: 'F5', click: () => win.webContents.reload() },
        { label: 'تغيير إعدادات الاتصال', click: async () => {
          const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['إلغاء', 'تغيير'], defaultId: 0, cancelId: 0,
            title: 'إعدادات الاتصال', message: 'ترجع لشاشة الإعداد؟', detail: 'البيانات ما تنحذف. بس تختار من جديد: حاسبة رئيسية أو فرعية.' });
          if (r.response === 1) { saveSettings({}); openSetup() }
        } },
        { label: 'عناوين الشبكة', click: () => showAddresses(), visible: true },
        { type: 'separator' },
        { label: 'تكبير', role: 'zoomIn' }, { label: 'تصغير', role: 'zoomOut' }, { label: 'الحجم الطبيعي', role: 'resetZoom' },
        { label: 'أدوات المطور', accelerator: 'Ctrl+Shift+I', click: () => win.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'خروج', click: () => { quitting = true; app.quit() } },
      ] },
    ]));
    createWindow();
    boot();
  });
  app.on('before-quit', () => { quitting = true });
  app.on('window-all-closed', () => { if (readSettings().mode !== 'server') app.quit() });
}

