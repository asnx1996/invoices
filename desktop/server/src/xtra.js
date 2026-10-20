// قراءة من برنامج إكسترا (قراءة فقط — ما نكتب بقاعدته أبداً).
// نسخة SQL Server مال إكسترا تقبل دخول ويندوز بس، فنستخدم sqlcmd بصلاحيات المستخدم اللي مشغّل السيرفر
// (الحاسبة الرئيسية) بدل مستخدم SQL.
// أسماء جداول إكسترا مشفرة: TBL016 الوكلاء، TBL004 الحسابات، TBL001 العملات، TBL020 أنواع الفواتير،
// TBL022 رؤوس الفواتير، TBL023 أسطر الفواتير، TBL024 حسميات وإضافات الفاتورة.
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { fail } from './rules.js';

const X = () => ({ server: '.', database: '', salesType: 1, customersAccount: '121', ...(config.xtra || {}) });
export const xtraEnabled = () => !!X().database;

// نص SQL → صفوف. كل الناتج JSON بقيمة وحدة بين علامتين حتى sqlcmd ما يقطّعه أو يحشيه فراغات
function query(text) {
  const x = X();
  if (!x.database) fail('الربط ويه إكسترا مو مفعّل');
  if (!/^[\w$.\\-]+$/.test(x.server) || !/^\w+$/.test(x.database)) fail('إعدادات إكسترا غير صالحة');
  const sql = `SET NOCOUNT ON; SELECT N'@@J@@' + ISNULL((${text} FOR JSON PATH, INCLUDE_NULL_VALUES), N'[]') + N'@@E@@'`;
  const args = ['-S', x.server, '-E', '-d', x.database, '-l', '10', '-t', '30', '-y', '0', '-f', '65001', '-b', '-x', '-Q', sql];
  return new Promise((ok, bad) => {
    execFile('sqlcmd', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out, errOut) => {
      if (err) return bad(Object.assign(new Error('ما كدرت أقرا من إكسترا: ' + String(errOut || out || err.message).trim().split('\n').pop()), { status: 502 }));
      const i = out.indexOf('@@J@@'), e = out.lastIndexOf('@@E@@');
      try { ok(JSON.parse(out.slice(i + 5, e))) } catch (_) { bad(new Error('رد غير مفهوم من إكسترا')) }
    });
  });
}
const str = s => "N'" + String(s).replace(/'/g, "''") + "'";
const like = s => str('%' + String(s).replace(/[%_[]/g, '[$&]') + '%');

// عملة إكسترا → عملة البرنامج
export function curKey(name) {
  const n = String(name || '').toLowerCase();
  if (/usd|دولار|\$/.test(n)) return 'usd';
  if (/iqd|دينار|د\.ع/.test(n)) return 'iqd';
  return null;
}

// صافي الفاتورة بعملتها: الأسطر (بعد خصم وإضافة كل سطر والضريبة) + إضافات الفاتورة − حسمياتها
const NET = `(
  ISNULL((SELECT SUM(ISNULL(l.TotalValue,0) - ISNULL(l.DiscountValue,0) + ISNULL(l.ExtraValue,0) + ISNULL(l.TaxValue,0)) FROM TBL023 l WHERE l.MainGuide = b.CardGuide), 0)
  + ISNULL((SELECT SUM(ISNULL(d.Extra,0) - ISNULL(d.Discount,0)) FROM TBL024 d WHERE d.MainGuide = b.CardGuide), 0))`;

const BILL_COLS = `b.CardGuide AS guid, b.BillNumber AS number, CONVERT(varchar(10), b.BillDate, 23) AS date,
  ISNULL(a.AgentName, b.CustomerName) AS customer, a.CardGuide AS agent, c.CurrencyName AS currency, ${NET} AS net, b.Notes AS notes`;
const BILL_FROM = `FROM TBL022 b
  JOIN TBL020 t ON t.CardGuide = b.MainGuide
  LEFT JOIN TBL016 a ON a.CardGuide = b.AgentGuide
  LEFT JOIN TBL001 c ON c.CardGuide = b.CurrencyGuide`;

// بحث بفواتير المبيعات: بالرقم أو اسم الزبون. الأحدث أول
export async function searchBills(q) {
  const t = String(q ?? '').trim().slice(0, 60);
  const where = !t ? '' : /^\d+$/.test(t)
    ? `AND (b.BillNumber = ${+t} OR a.AgentName LIKE ${like(t)})`
    : `AND (a.AgentName LIKE ${like(t)} OR b.CustomerName LIKE ${like(t)} OR b.Notes LIKE ${like(t)})`;
  const rows = await query(`SELECT TOP 60 ${BILL_COLS} ${BILL_FROM} WHERE t.CardNumber = ${+X().salesType} ${where} ORDER BY b.BillDate DESC, b.BillNumber DESC`);
  return rows.map(r => ({ ...r, cur: curKey(r.currency), net: Math.round((+r.net || 0) * 100) / 100 }));
}

export async function getBill(guid) {
  if (!/^[0-9a-f-]{36}$/i.test(String(guid))) fail('فاتورة غير صالحة');
  const [r] = await query(`SELECT ${BILL_COLS} ${BILL_FROM} WHERE b.CardGuide = '${guid}' AND t.CardNumber = ${+X().salesType}`);
  if (!r) fail('الفاتورة مو موجودة بإكسترا');
  return { ...r, cur: curKey(r.currency), net: Math.round((+r.net || 0) * 100) / 100 };
}

// الوكلاء (الزبائن): اللي حساباتهم تحت حساب الزبائن بالدليل (121 افتراضياً)
export async function listAgents() {
  const code = String(X().customersAccount);
  if (!/^\w+$/.test(code)) fail('رمز حساب الزبائن غير صالح');
  return query(`SELECT a.CardGuide AS guid, LTRIM(RTRIM(a.AgentName)) AS name, ISNULL(NULLIF(a.Mobile, ''), a.Phone) AS phone, a.NotActive AS inactive
    FROM TBL016 a JOIN TBL004 acc ON acc.CardGuide = a.AccountID JOIN TBL004 p ON p.CardGuide = acc.MainAccount
    WHERE p.CardCode = ${str(code)} AND LTRIM(RTRIM(ISNULL(a.AgentName, ''))) <> '' ORDER BY a.AgentName`);
}
