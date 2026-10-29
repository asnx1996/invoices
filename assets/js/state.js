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
export const colKey = inv => inv.stage === 'decision' ? 'decision:' + inv.sub : inv.stage;

// خطوات مرحلة القرار (022): الأدمن يرتبها ويطفيها ويضيف عليها من الإعدادات (app_settings.stages)
// كل خطوة {k, n: اسم، on: مفعّلة، back: ترجع للحسابات}. الأساسية تنطفي بس، والإضافية مفتاحها s_xxxx وصلاحيتها نفس المفتاح
export const DEFAULT_STEPS = [{ k: 'mgr', on: true }, { k: 'cust', on: true }, { k: 'wh', on: true }];
const STEP_META = {
  mgr: { t: 'قرار المدير', sub: 'بانتظار موافقة المدير', who: 'المدير', c: 'var(--vio)', wait: 'المدير يوافق أو يرجع للحسابات', turn: 'ينتظر موافقتك', perm: 'approve', back: true },
  cust: { t: 'رد الزبون', sub: 'بانتظار رد الزبون', who: 'المندوب · المدير', c: 'color-mix(in srgb,var(--vio) 55%,var(--primary))', wait: 'المندوب يبلغ الزبون ويأشر الرد', turn: 'بلّغ الزبون وأشّر رده', perm: 'cust_all' },
  wh: { t: 'المخزن', sub: 'بانتظار تحويل المخزن', who: 'المخزن', c: 'color-mix(in srgb,var(--vio) 40%,var(--ok))', wait: 'المخزن يحول لمبيعات ويدخل الرقم', turn: 'جاهز للتحويل لمبيعات', perm: 'complete' },
};
// ألوان الخطوات الإضافية (تمشي ويا الثيمين)
const XCOLORS = ['#0E7490', '#C2410C', '#BE185D', '#4D7C0F', '#7C3AED', '#0369A1'];
S.STEPS = DEFAULT_STEPS;
S.HAS_STAGES = false;   // 022 متشغل؟
export const isBuiltinStep = k => !!STEP_META[k];
export function stepInfo(k) {
  const e = S.STEPS.find(x => x.k === k) || { k }, m = STEP_META[k], n = String(e.n || '').trim(), on = e.on !== false;
  if (m) return { ...m, k, on, t: n || m.t, sub: n ? 'بانتظار ' + n : m.sub };
  const xi = S.STEPS.filter(x => !STEP_META[x.k]).findIndex(x => x.k === k);
  const holders = S.ROLEDEFS.filter(d => d.perms.includes(k)).map(d => d.name).join(' · ');
  return { k, on, t: n || k, sub: 'بانتظار ' + (n || k), who: holders || 'الأدمن', c: XCOLORS[Math.max(0, xi) % XCOLORS.length],
    wait: (n || k) + ' — يكملها ' + (holders || 'الأدمن'), turn: 'ينتظرك بمرحلة ' + (n || k), perm: k, back: !!e.back };
}
export const stepName = k => stepInfo(k).t;
export const subName = k => stepInfo(k).sub;
// الخطوة المفعّلة اللي بعد cur (null = أول خطوة). null = الطلب يكتمل — نفس stage_next بالقاعدة
export function nextStep(cur) {
  const at = cur == null ? -1 : S.STEPS.findIndex(e => e.k === cur);
  return (S.STEPS.slice(at + 1).find(e => e.on !== false) || {}).k || null;
}
// إجراء "التالي" لكل خطوة
export const passAction = k => ({ mgr: 'approve', cust: 'custAccept', wh: 'complete' })[k] || 'stepPass';
// أعمدة خطوات القرار: المفعّلة + المطفية اللي بيها طلبات بالقائمة
export const stepCols = (list = S.INVOICES) => S.STEPS
  .filter(e => e.on !== false || list.some(i => i.stage === 'decision' && i.sub === e.k))
  .map(e => { const s = stepInfo(e.k); return { k: 'decision:' + e.k, t: s.t, who: s.on ? s.who : 'مرحلة مطفية — بس الطلبات القديمة', c: s.c, off: !s.on } });
export const boardCols = (list = S.INVOICES) => [COLS[0], COLS[1], ...stepCols(list), COLS[3], COLS[4]];
// اسم أي مكان بالبورد: new / acc / decision:k / done / cancel
export const placeName = key => String(key).startsWith('decision:') ? stepName(key.slice(9)) : (COLS.find(c => c.k === key) || {}).t || key;
export const PAY = { cash: 'نقدي', credit: 'آجل' };
export const PAY_LEGACY = { cheque: 'صك', transfer: 'تحويل مصرفي' };
export const PAYER = { customer: 'على الزبون', none: 'بدون نقل' };
export const PAYER_LEGACY = { company: 'على الشركة' };
export const MONTHS = { 1: 'شهر', 2: 'شهرين', 3: '3 أشهر' };
export const POINT_RATE = 1.5;   // كل نقطة = 1.5%

export const hasRole = r => !!S.ME && S.ME.roles.includes(r);

// الصلاحيات اللي الأدمن يوزعها على الأدوار (018). الأدمن عنده كلشي دائماً
export const PERMS = {
  create: ['إنشاء طلبات ومتابعة طلباته', 'يسوي طلب، يعدله، يرسله للحسابات، ويأشر رد الزبون لطلباته'],
  acc: ['شغل الحسابات', 'السداد والنقل والكلفة، الإرسال للقرار، والإرجاع للمندوب'],
  approve: ['موافقة المدير', 'يوافق على الشروط أو يرجع الطلب للحسابات'],
  rep_all: ['يشتغل على طلبات كل المندوبين', 'يعدل طلب أي مندوب ويرسله للحسابات ويأشر رد الزبون، مثل صاحب الطلب. تنضاف وياها "يشوف كل الطلبات"'],
  cust_all: ['رد الزبون لكل الطلبات', 'يأشر موافقة أو رفض الزبون على أي طلب'],
  complete: ['تحويل المخزن', 'يدخل رقم المبيعات ويكمل الطلب'],
  move: ['نقل الطلب لأي مرحلة', 'السحب والإفلات بين الأعمدة بدون الخطوات'],
  urgent_all: ['علامة طارئ لكل الطلبات', ''],
  see_all: ['يشوف كل الطلبات', 'بدونها يشوف طلباته بس'],
  see_late: ['يشوف طلبات القرار والمكتملة', 'مثل المخزن'],
  see_profit: ['يشوف الربح', 'من مرحلة القرار وبعدها، بدون سعر الكلفة'],
  export: ['تصدير Excel', ''],
  customers: ['تبويب الزبائن', 'إضافة وتعديل وحذف الزبائن'],
  users: ['إدارة المستخدمين', 'إضافة حسابات وتغيير الأدوار والرموز من الإعدادات (ما يلمس الأدمن)'],
  trash: ['الحذف والمحذوفات', 'يحذف الطلبات ويسترجعها من السلة'],
};
// تقسيم الصلاحيات بصفحة الإعدادات (التقارير انشالت لحد ما ترجع بتصميم جديد)
export const PERM_GROUPS = [
  ['سير الطلب', 'منو يحرك الطلب بكل مرحلة', ['create', 'rep_all', 'acc', 'approve', 'cust_all', 'complete']],
  ['شنو يشوف', 'الطلبات والأرقام اللي تطلعله', ['see_all', 'see_late', 'see_profit']],
  ['الإدارة', 'أدوات إضافية وتبويبات', ['move', 'urgent_all', 'trash', 'export', 'customers', 'users']],
];
// نفس الافتراضي بـ 018 — يستخدم قبل ما تتشغل
export const DEFAULT_ROLE_DEFS = [
  { key: 'rep', name: 'مندوب', builtin: true, perms: ['create'] },
  { key: 'acc', name: 'محاسب', builtin: true, perms: ['acc', 'see_all', 'export'] },
  { key: 'mgr', name: 'مدير', builtin: true, perms: ['approve', 'cust_all', 'complete', 'move', 'urgent_all', 'see_all', 'see_profit', 'reports', 'export'] },
  { key: 'wh', name: 'مخزن', builtin: true, perms: ['complete', 'see_late'] },
];
S.ROLEDEFS = DEFAULT_ROLE_DEFS;
S.HAS_ROLEDEFS = false;   // 018 متشغل؟

// الحقول اللي الأدمن يكدر يخليها اختيارية (app_settings.opt_fields)
// الحقول المعلّمة 'in' اختيارية من الأصل وتصير إلزامية إذا الأدمن أشّرها (app_settings.req_fields — 020)
export const REQ_FIELDS = {
  customer: ['الزبون (من القائمة)', 'new'], ref: ['رقم عرض السعر أو رقم الحجز', 'new'], value: ['قيمة الفاتورة', 'new'],
  pdf: ['ملف الـ PDF', 'new'], payment: ['طريقة السداد', 'acc'], payer: ['النقل', 'acc'], cost: ['سعر الكلفة', 'acc'],
  cust: ['حالة الزبون (الرصيد)', 'acc', 'in'],
};
S.OPT = new Set();
S.REQX = new Set();
export const isReq = k => REQ_FIELDS[k] && REQ_FIELDS[k][2] === 'in' ? S.REQX.has(k) : !S.OPT.has(k);

const roleKeys = p => [...(p.roles || []), ...(p.xroles || [])];
// صلاحية من الأدوار وحدها، بدون الخاصة بالحساب (حتى صفحة المستخدمين تعرف شنو اللي تغيّر)
export const fromRoles = (p, perm) => !!p && S.ROLEDEFS.some(d => roleKeys(p).includes(d.key) && d.perms.includes(perm));
// صلاحية المستخدم بدون استثناء الأدمن: أدواره + المضافة لحسابه − المشالة منه (025). منو "مندوب" مثلاً
export const roleHas = (p, perm) => !!p && !(p.nperms || []).includes(perm) && ((p.xperms || []).includes(perm) || fromRoles(p, perm));
export const userHas = (p, perm) => !!p && ((p.roles || []).includes('admin') || roleHas(p, perm));
export const hasPerm = perm => userHas(S.ME, perm);
export const roleName = k => k === 'admin' ? ROLES.admin : (S.ROLEDEFS.find(d => d.key === k) || {}).name || ROLES[k] || k;
export const rolesText = (roles, xroles) => [...(roles || []), ...(xroles || [])].map(roleName).join(' + ');
export const userName = id => (S.PROFILES.find(p => p.id === id) || {}).full_name || '—';
// الأدمن بكل البوردات؛ الباقين حسب الأدمن يحددهم (012)
export const inBoard = (p, b = S.board) => !S.BOARDS || (p.roles || []).includes('admin') || S.MEMBERS.some(m => m.board_id === b && m.user_id === p.id);
export const getBoard = (id = S.board) => (S.BOARDS || []).find(b => b.id === id) || null;
export const NOTIF_LEVELS = { all: 'كل الإشعارات', important: 'المهمة بس', mention: 'المنشن بس', none: 'بدون إشعارات' };
export const boardName = id => ((S.BOARDS || []).find(b => b.id === id) || {}).name || '';
export const reps = () => S.PROFILES.filter(p => p.active && roleHas(p, 'create') && inBoard(p));
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
