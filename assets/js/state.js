import { DAY, num } from './util.js';

// الحالة المشتركة بين الوحدات
export const S = {
  ME: null,           // {id, full_name, roles[]}
  PROFILES: [],
  INVOICES: [],
  CUSTOMERS: [],
  PROFITS: {},        // invoice_id → {total, gross_pct, net_pct}
  COSTS: {},          // للأدمن فقط: invoice_id → cost
  drawerId: null,
  loaded: false,      // أول تحميل للطلبات خلص؟
  draft: null,        // الطلب الجديد قبل الحفظ
  draftFile: null,    // ملف الـ PDF ينتظر الحفظ
  lastMissing: null,
};

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
export const changed = () => listeners.forEach(fn => fn());

export const ROLES = { rep: 'مندوب', acc: 'محاسب', mgr: 'مدير', wh: 'مخزن', admin: 'أدمن' };
export const COLS = [
  { k: 'new', t: 'طلب جديد', who: 'المندوب', c: 'var(--primary)' },
  { k: 'acc', t: 'الحسابات', who: 'المحاسب', c: 'var(--warn)' },
  { k: 'decision', t: 'بانتظار القرار', who: 'المدير · المندوب · المخزن', c: 'var(--vio)' },
  { k: 'done', t: 'تمت', who: '', c: 'var(--ok)' },
  { k: 'cancel', t: 'ملغاة', who: '', c: 'var(--bad)' },
];
export const SUB = { mgr: 'بانتظار موافقة المدير', cust: 'بانتظار رد الزبون', wh: 'بانتظار تحويل المخزن' };
export const PAY = { cash: 'نقدي', credit: 'آجل' };
export const PAY_LEGACY = { cheque: 'صك', transfer: 'تحويل مصرفي' };
export const PAYER = { customer: 'على الزبون', none: 'بدون نقل' };
export const PAYER_LEGACY = { company: 'على الشركة' };
export const MONTHS = { 1: 'شهر', 2: 'شهرين', 3: '3 أشهر' };
export const POINT_RATE = 1.5;   // كل نقطة = 1.5%

export const hasRole = r => !!S.ME && S.ME.roles.includes(r);
export const rolesText = roles => (roles || []).map(r => ROLES[r] || r).join(' + ');
export const userName = id => (S.PROFILES.find(p => p.id === id) || {}).full_name || '—';
export const reps = () => S.PROFILES.filter(p => p.active && (p.roles || []).includes('rep'));
// 'draft' = طلب جديد لسه ما انحفظ بالقاعدة (ما يطلع باللوحة لحد الحفظ)
export const getInv = id => id === 'draft' ? S.draft : S.INVOICES.find(i => i.id === +id);
export const daysIn = inv => (Date.now() - new Date(inv.stage_at).getTime()) / DAY;
export const isActive = inv => ['new', 'acc', 'decision'].includes(inv.stage);
export const ageLevel = inv => { if (!isActive(inv)) return 0; const d = daysIn(inv); return d >= 3 ? 2 : d >= 2 ? 1 : 0 };
export const ldAmount = inv => inv.ld ? num(inv.value) * num(inv.ld_pct) / 100 : 0;
export const transportAdded = inv => inv.payer === 'customer' ? num(inv.transport_amt) : 0;
export const totalAfterTransport = inv => num(inv.value) + transportAdded(inv);
export const pointsPct = inv => num(inv.points) * POINT_RATE;
export const hasTerms = inv => !!(inv.ld || inv.payment === 'credit' || num(inv.points) > 0);
