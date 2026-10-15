import { DAY, num } from './util.js';

// الحالة المشتركة بين الوحدات
export const S = {
  ME: null,           // {id, full_name, roles[]}
  PROFILES: [],
  INVOICES: [],
  CUSTOMERS: [],
  BOARDS: null,       // [{id, name}] — null = القاعدة قبل 012 (بورد واحد بدون اختيار)
  MEMBERS: [],        // [{board_id, user_id}] لبوردات المستخدم
  board: null,        // البورد المعروض
  boardsLoaded: false,
  STATS: {},          // board_id → {active, late} لصفحة البوردات
  NPREFS: {},         // invoice_id → مستوى إشعاراتي لهذا الطلب (013)
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
// أعمدة اللوحة: مرحلة القرار مقسومة لثلاث أعمدة (المدير · الزبون · المخزن)
export const BOARD_COLS = [
  COLS[0], COLS[1],
  { k: 'decision:mgr', t: 'قرار المدير', who: 'المدير', c: 'var(--vio)' },
  { k: 'decision:cust', t: 'رد الزبون', who: 'المندوب · المدير', c: 'color-mix(in srgb,var(--vio) 55%,var(--primary))' },
  { k: 'decision:wh', t: 'المخزن', who: 'المخزن', c: 'color-mix(in srgb,var(--vio) 40%,var(--ok))' },
  COLS[3], COLS[4],
];
export const colKey = inv => inv.stage === 'decision' ? 'decision:' + inv.sub : inv.stage;
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
// الأدمن بكل البوردات؛ الباقين حسب الأدمن يحددهم (012)
export const inBoard = (p, b = S.board) => !S.BOARDS || (p.roles || []).includes('admin') || S.MEMBERS.some(m => m.board_id === b && m.user_id === p.id);
export const getBoard = (id = S.board) => (S.BOARDS || []).find(b => b.id === id) || null;
export const NOTIF_LEVELS = { all: 'كل الإشعارات', important: 'المهمة بس', mention: 'المنشن بس', none: 'بدون إشعارات' };
export const boardName = id => ((S.BOARDS || []).find(b => b.id === id) || {}).name || '';
export const reps = () => S.PROFILES.filter(p => p.active && (p.roles || []).includes('rep') && inBoard(p));
// 'draft' = طلب جديد لسه ما انحفظ بالقاعدة (ما يطلع باللوحة لحد الحفظ)
export const getInv = id => id === 'draft' ? S.draft : S.INVOICES.find(i => i.id === +id);
export const daysIn = inv => (Date.now() - new Date(inv.stage_at).getTime()) / DAY;
export const isActive = inv => ['new', 'acc', 'decision'].includes(inv.stage);
export const isUrgent = inv => !!inv.urgent && isActive(inv);
export const ageLevel = inv => { if (!isActive(inv)) return 0; const d = daysIn(inv); return d >= 3 ? 2 : d >= 2 ? 1 : 0 };
export const ldAmount = inv => inv.ld ? num(inv.value) * num(inv.ld_pct) / 100 : 0;
export const transportAdded = inv => inv.payer === 'customer' ? num(inv.transport_amt) : 0;
export const totalAfterTransport = inv => num(inv.value) + transportAdded(inv);
export const pointsPct = inv => num(inv.points) * POINT_RATE;
export const discPct = inv => inv.disc_req ? num(inv.disc_pct) : 0;   // طلب خصم المندوب (015)
export const hasTerms = inv => !!(inv.ld || inv.payment === 'credit' || num(inv.points) > 0);
