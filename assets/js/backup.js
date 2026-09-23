import { sb, fetchAll } from './api.js';
import { toast, ymd } from './util.js';

// نسخة احتياطية فورية (للأدمن): كل الجداول بملف Excel، كل جدول بورقة
// (النسخة الأسبوعية الكاملة القابلة للاسترجاع تسويها GitHub Actions — شوف docs/BACKUP.md)
const TABLES = [
  ['invoices', 'الطلبات', 'id'], ['invoice_costs', 'الكلفة', 'invoice_id'], ['customers', 'الزبائن', 'id'],
  ['profiles', 'المستخدمين', 'id'], ['invoice_comments', 'التعليقات', 'id'], ['invoice_log', 'سجل الحركة', 'id'],
  ['invoice_stage_log', 'سجل المراحل', 'id'],
];

export async function backupNow() {
  if (typeof XLSX === 'undefined') return toast('مكتبة Excel ما تحملت');
  toast('جاري تجهيز النسخة...');
  const wb = XLSX.utils.book_new();
  let total = 0;
  try {
    for (const [table, sheet, order] of TABLES) {
      const rows = await fetchAll(() => sb.from(table).select('*').order(order));
      total += rows.length;
      const flat = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])));
      XLSX.utils.book_append_sheet(wb, flat.length ? XLSX.utils.json_to_sheet(flat) : XLSX.utils.aoa_to_sheet([['فارغ']]), sheet);
    }
  } catch (e) { return toast('فشل النسخ: ' + e.message) }
  XLSX.writeFile(wb, `نسخة-احتياطية-${ymd(new Date())}.xlsx`);
  toast(`انحفظت النسخة (${total} صف)`);
}
