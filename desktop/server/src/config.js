// الإعدادات من config.json (يسويه setup.js). مسار الملف يتغير بـ INVOICES_CONFIG
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = process.env.INVOICES_CONFIG || join(SERVER_DIR, 'config.json');

const defaults = {
  port: 8787,
  // مجلد الواجهة (index.html). افتراضياً جذر المشروع
  webRoot: resolve(SERVER_DIR, '..', '..'),
  dataDir: join(SERVER_DIR, 'data'),
  sql: { server: 'localhost', instanceName: 'TEW_SQLEXPRESS', port: 0, database: 'InvoicesApp', user: 'invoices_app', password: '' },
  // برنامج إكسترا (قراءة فقط): نسخة SQL Server وقاعدة الشركة. salesType = رقم نوع فاتورة المبيعات بإكسترا
  xtra: { server: '.', database: 'XtrDB11_10_2026', salesType: 1, customersAccount: '121' },
};

export const config = existsSync(CONFIG_PATH)
  ? { ...defaults, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) }
  : structuredClone(defaults);
config.sql = { ...defaults.sql, ...config.sql };
config.xtra = { ...defaults.xtra, ...config.xtra };
// برنامج الحاسبة (Electron) يحدد مكان الواجهة والبيانات
if (process.env.INVOICES_WEBROOT) config.webRoot = process.env.INVOICES_WEBROOT;
if (process.env.INVOICES_DATA) config.dataDir = process.env.INVOICES_DATA;

export function saveConfig() {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export const filesDir = () => { const d = join(config.dataDir, 'files'); mkdirSync(d, { recursive: true }); return d };
