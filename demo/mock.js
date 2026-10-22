// نسخة تجريبية: قاعدة بيانات وهمية بالمتصفح بدل Supabase.
// نفس الواجهة اللي يستخدمها الكود (from/select/eq/rpc/auth/storage...) ونفس قواعد الصلاحيات
// ورسائل الأخطاء الموجودة بـ supabase/migrations، حتى النسخة تتصرف مثل الحقيقية.
// البيانات تنحفظ بمتصفح الزائر فقط (localStorage) وتنعاد بزر "إعادة البيانات".
(() => {
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';

  const KEY = 'invoices-demo-v1', SKEY = 'invoices-demo-session';
  const DAY = 864e5, now = Date.now(), iso = t => new Date(t).toISOString();
  const store = {
    get(k) { try { return localStorage.getItem(k) } catch (e) { return null } },
    set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } },
    del(k) { try { localStorage.removeItem(k) } catch (e) { } },
  };
  const round2 = n => Math.round(n * 100) / 100;
  const clone = o => JSON.parse(JSON.stringify(o));

  // ملف PDF صغير حقيقي حتى زر "فتح" يشتغل
  const SAMPLE_PDF = 'data:application/pdf;base64,' + btoa('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 40 70 Td (Demo invoice) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

  // ---------- بيانات البداية ----------
  const USERS = [
    { id: 'u-admin', login: 'admin', full_name: 'أحمد الأدمن', roles: ['admin'], avatar: 'm2' },
    { id: 'u-rep1', login: 'ali', full_name: 'علي حسن', roles: ['rep'], avatar: 'm6' },
    { id: 'u-rep2', login: 'sara', full_name: 'سارة كريم', roles: ['rep'], avatar: 'f1' },
    { id: 'u-acc', login: 'hussein', full_name: 'حسين المحاسب', roles: ['acc'], avatar: 'm11' },
    { id: 'u-mgr', login: 'omar', full_name: 'عمر المدير', roles: ['mgr'], avatar: 'm5' },
    { id: 'u-wh', login: 'zaid', full_name: 'زيد المخزن', roles: ['wh'], avatar: null },
  ];
  const CUSTOMERS = ['شركة النور للتجارة العامة', 'مؤسسة الرافدين', 'معرض بغداد للأجهزة', 'شركة دجلة للمقاولات', 'مكتب الفرات الهندسي',
    'أسواق الكرادة', 'شركة بابل للتوريدات', 'مجموعة الزوراء', 'مطبعة المنصور', 'شركة أربيل للإنشاء', 'مخازن البصرة الحديثة',
    'صيدليات الشفاء', 'شركة الكوفة للطاقة', 'معمل السلام', 'مركز الحلة التجاري', 'شركة سومر للنقل', 'فندق الميناء', 'مكتبة المتنبي'];

  function seed() {
    const db = {
      seq: { invoices: 1100, customers: 100, invoice_comments: 1, invoice_log: 1, invoice_stage_log: 1, notifications: 1 },
      profiles: USERS.map(u => ({ id: u.id, full_name: u.full_name, roles: u.roles, role: u.roles[0], avatar: u.avatar, active: true, created_at: iso(now - 200 * DAY) })),
      logins: Object.fromEntries(USERS.map(u => [u.id, u.login])),
      customers: CUSTOMERS.map((name, i) => ({ id: i + 1, name, phone: '0770' + String(1234567 + i * 7919).slice(0, 7), notes: '', active: true, created_at: iso(now - 190 * DAY) })),
      invoices: [], invoice_costs: [], invoice_comments: [], invoice_log: [], invoice_stage_log: [], notifications: [],
      app_settings: [{ key: 'currency', value: 'د.ع', updated_at: iso(now) }],
      files: {},
    };
    // [مرحلة, sub, مندوب, زبون, قيمة, كلفة, سداد, أشهر, نقل, مبلغ نقل, نقاط, خصم%, عمر بالأيام, أيام بالمرحلة الحالية]
    const rows = [
      ['new', null, 'u-rep1', 3, 4850000, null, null, null, null, 0, 0, 0, 1, 1],
      ['new', null, 'u-rep2', 7, 0, null, null, null, null, 0, 0, 0, 4, 4],
      ['acc', null, 'u-rep1', 1, 12500000, null, 'credit', 2, 'customer', 150000, 2, 0, 3, 1],
      ['acc', null, 'u-rep2', 9, 3200000, null, null, null, null, 0, 0, 0, 5, 3.5],
      ['acc', null, 'u-rep1', 12, 7640000, 6100000, 'cash', null, 'none', 0, 0, 0, 2, 0.4],
      ['decision', 'mgr', 'u-rep2', 4, 22750000, 18900000, 'credit', 3, 'customer', 400000, 3, 2, 6, 1],
      ['decision', 'mgr', 'u-rep1', 14, 5900000, 4700000, 'cash', null, 'customer', 90000, 0, 0, 4, 2.2],
      ['decision', 'cust', 'u-rep1', 6, 9300000, 7650000, 'credit', 1, 'none', 0, 1, 0, 7, 1.5],
      ['decision', 'wh', 'u-rep2', 2, 15400000, 12100000, 'cash', null, 'customer', 250000, 0, 3, 8, 0.6],
      ['decision', 'wh', 'u-rep1', 16, 2750000, 2150000, 'cash', null, 'none', 0, 0, 0, 5, 4],
      ['done', null, 'u-rep1', 1, 18200000, 14800000, 'credit', 2, 'customer', 300000, 2, 0, 38, 30],
      ['done', null, 'u-rep2', 5, 6400000, 5050000, 'cash', null, 'none', 0, 0, 0, 52, 45],
      ['done', null, 'u-rep1', 8, 11250000, 9300000, 'credit', 3, 'customer', 180000, 4, 2, 70, 62],
      ['done', null, 'u-rep2', 11, 4100000, 3200000, 'cash', null, 'customer', 60000, 0, 0, 95, 88],
      ['done', null, 'u-rep1', 13, 27900000, 23100000, 'credit', 2, 'none', 0, 3, 1.5, 120, 110],
      ['done', null, 'u-rep2', 15, 8800000, 7000000, 'cash', null, 'customer', 120000, 1, 0, 140, 133],
      ['done', null, 'u-rep1', 17, 3650000, 2800000, 'cash', null, 'none', 0, 0, 0, 20, 14],
      ['cancel', null, 'u-rep2', 10, 5200000, 4600000, 'credit', 3, 'customer', 90000, 0, 0, 33, 25],
      ['cancel', null, 'u-rep1', 18, 1900000, null, null, null, null, 0, 0, 0, 60, 55],
    ];
    const reasons = ['الزبون لقى سعر أرخص', 'تأجل المشروع'];
    const salesNo = n => 'S-' + (24000 + n * 37);
    let ci = 0;
    rows.forEach((r, n) => {
      const [stage, sub, rep, cust, value, cost, payment, months, payer, tamt, points, ld, age, inStage] = r;
      const id = ++db.seq.invoices, created = now - age * DAY, stageAt = now - inStage * DAY;
      const c = db.customers.find(x => x.id === cust);
      const inv = {
        id, stage, sub, rep_id: rep, customer_id: cust, customer: c.name,
        quote_no: n % 3 === 1 ? null : 'Q-' + (7300 + n * 13), res_no: n % 3 === 1 ? 'R-' + (5100 + n * 11) : null,
        value: value || null, payment, credit_months: months, payer, transport_amt: tamt, points, ld: ld > 0, ld_pct: ld || null, disc_req: false, disc_pct: null, cust_debt: null, debt_cur: null, debt_iqd: null, debt_usd: null, bal_cur: null, bal_iqd: null, bal_usd: null,
        notes: '', pdf_path: value ? `${id}/عرض-${id}.pdf` : null, pdf_name: value ? `عرض-${id}.pdf` : null, pdf_size: value ? 184000 + n * 3100 : null,
        cost_set: cost != null, returned: n === 5 ? 1 : 0, sales_no: stage === 'done' ? salesNo(n) : null,
        cancel_reason: stage === 'cancel' ? reasons[ci++ % 2] : null, created_at: iso(created), stage_at: iso(stageAt),
        closed_at: ['done', 'cancel'].includes(stage) ? iso(stageAt) : null, delete_req_by: null, delete_req_at: null, delete_req_reason: null, urgent: n === 2 || n === 6,
      };
      if (n === 1) Object.assign(inv, { delete_req_by: 'u-rep2', delete_req_at: iso(now - DAY), delete_req_reason: 'الطلب مكرر' });
      db.invoices.push(inv);
      if (cost != null) db.invoice_costs.push({ invoice_id: id, cost, set_by: 'u-acc', set_at: iso(created + DAY) });
      // مسار المراحل للتقارير
      const path = ['new', 'acc', 'decision:mgr', 'decision:cust', 'decision:wh'];
      const endKey = stage === 'decision' ? 'decision:' + sub : stage;
      const steps = stage === 'done' ? path.length : stage === 'cancel' ? (cost ? 4 : 1) : path.indexOf(endKey) + 1;
      const span = Math.max(0.1, (stageAt - created) / DAY), each = span / Math.max(1, steps - (isActiveStage(stage) ? 1 : 0));
      let t = created;
      const log = (body, at) => db.invoice_log.push({ id: db.seq.invoice_log++, invoice_id: id, actor: rep, body, at: iso(at) });
      log('أنشأ الطلب', created);
      for (let s = 0; s < steps; s++) {
        const at = s === steps - 1 && isActiveStage(stage) ? stageAt : t;
        db.invoice_stage_log.push({ id: db.seq.invoice_stage_log++, invoice_id: id, key: path[s], entered_at: iso(at) });
        t += each * DAY * (0.6 + ((n + s) % 5) / 5);
        if (t > stageAt) t = stageAt;
      }
      if (['acc', 'decision', 'done'].includes(stage) || (stage === 'cancel' && cost)) log('أرسل الطلب للحسابات', created + 0.3 * DAY);
      if (stage === 'decision' || stage === 'done' || (stage === 'cancel' && cost)) log('أرسل الطلب للقرار', created + 1.4 * DAY);
      if (stage === 'done') { log('وافق المدير على الشروط', stageAt - 2 * DAY); log('أكد موافقة الزبون', stageAt - DAY); log('حول الطلب لمبيعات برقم ' + inv.sales_no, stageAt) }
      if (stage === 'cancel') log('سجل رفض الزبون وألغى الطلب', stageAt);
    });
    const first = db.invoices[2].id;
    db.invoice_comments.push(
      { id: db.seq.invoice_comments++, invoice_id: first, author: 'u-acc', body: 'الزبون يريد الآجل شهرين بدل شهر، ثبتتها.', is_system: false, at: iso(now - 0.8 * DAY) },
      { id: db.seq.invoice_comments++, invoice_id: first, author: 'u-rep1', body: 'تمام، بلغته. @حسين المحاسب ثبّت النقل هم', is_system: false, at: iso(now - 0.5 * DAY) },
      { id: db.seq.invoice_comments++, invoice_id: db.invoices[5].id, author: 'u-mgr', body: 'إرجاع للحسابات: نسبة الخصم عالية، راجعوها', is_system: true, at: iso(now - 3 * DAY) },
    );
    // إشعارات تجريبية
    const N = (user_id, inv, kind, actor, data, ago, read) => db.notifications.push({ id: db.seq.notifications++, user_id, invoice_id: inv.id, kind, actor,
      data: { customer: inv.customer, ...data }, created_at: iso(now - ago * DAY), read_at: read ? iso(now - ago * DAY + 3600e3) : null });
    const I = db.invoices;
    N('u-acc', I[2], 'mention', 'u-rep1', { src: 'comment', text: 'تمام، بلغته. @حسين المحاسب ثبّت النقل هم' }, 0.5, false);
    N('u-rep1', I[7], 'stage', 'u-mgr', { stage: 'decision', sub: 'cust', from_stage: 'decision', from_sub: 'mgr' }, 1.5, false);
    N('u-rep1', I[6], 'stage', 'u-acc', { stage: 'decision', sub: 'mgr', from_stage: 'acc' }, 2.2, false);
    N('u-rep1', I[16], 'stage', 'u-wh', { stage: 'done', from_stage: 'decision', from_sub: 'wh' }, 14, true);
    N('u-rep2', I[5], 'stage', 'u-acc', { stage: 'decision', sub: 'mgr', from_stage: 'acc' }, 1, false);
    N('u-mgr', I[5], 'turn', 'u-acc', { stage: 'decision', sub: 'mgr', from_stage: 'acc' }, 1, false);
    N('u-mgr', I[6], 'turn', 'u-acc', { stage: 'decision', sub: 'mgr', from_stage: 'acc' }, 2.2, false);
    N('u-acc', I[3], 'late', null, { stage: 'acc', days: 3 }, 0.2, false);
    N('u-wh', I[9], 'late', null, { stage: 'decision', sub: 'wh', days: 4 }, 0.2, false);
    N('u-rep1', I[2], 'comment', 'u-acc', { text: 'الزبون يريد الآجل شهرين بدل شهر، ثبتتها.' }, 0.8, false);
    N('u-rep2', I[17], 'stage', 'u-mgr', { stage: 'cancel', from_stage: 'decision', from_sub: 'cust', reason: I[17].cancel_reason }, 25, true);
    db.v2 = true;
    return db;
  }
  function isActiveStage(s) { return ['new', 'acc', 'decision'].includes(s) }

  let db;
  try { db = JSON.parse(store.get(KEY)) } catch (e) { db = null }
  if (!db || !db.invoices || !db.notifications || !db.v2) db = seed();
  // الأدوار وصلاحياتها (018) — العرض يعرض المصفوفة ويحفظها، بس قواعده تبقى على الأدوار الأساسية
  if (!db.role_defs) db.role_defs = [
    { key: 'rep', name: 'مندوب', builtin: true, perms: ['create'], created_at: '2026-01-01' },
    { key: 'acc', name: 'محاسب', builtin: true, perms: ['acc', 'see_all', 'export'], created_at: '2026-01-02' },
    { key: 'mgr', name: 'مدير', builtin: true, perms: ['approve', 'cust_all', 'complete', 'move', 'urgent_all', 'see_all', 'see_profit', 'reports', 'export'], created_at: '2026-01-03' },
    { key: 'wh', name: 'مخزن', builtin: true, perms: ['complete', 'see_late'], created_at: '2026-01-04' },
  ];
  // البوردات (012): الوسطى + الجنوبية. سارة بالاثنين، وكل طلب رابع إلها يروح للجنوبية
  if (!db.boards) {
    db.boards = [{ id: 1, name: 'المنطقة الوسطى' }, { id: 2, name: 'المنطقة الجنوبية' }];
    db.seq.boards = 2;
    db.board_members = db.profiles.filter(p => !p.roles.includes('admin')).map(p => ({ board_id: 1, user_id: p.id }));
    db.board_members.push({ board_id: 2, user_id: 'u-rep2' });
    db.invoices.filter(i => i.rep_id === 'u-rep2').forEach((i, k) => { if (k % 3 === 0) i.board_id = 2 });
  }
  db.invoices.forEach(i => { if (i.board_id == null) i.board_id = 1 });
  // 013: خلفية البورد ومستوى الإشعارات
  db.boards.forEach(b => { if (b.blur == null) Object.assign(b, { bg: b.id === 2 ? 'nature' : null, bg_custom: null, blur: 0 }); if (!b.bg_fit) b.bg_fit = 'cover' });
  db.profiles.forEach(p => { if (p.notif_level == null) p.notif_level = 'all' });
  if (!db.invoice_notif_prefs) db.invoice_notif_prefs = [];
  // 016: تفاعلات التعليقات + الخلفية المتحركة
  if (!db.comment_reactions) db.comment_reactions = [];
  db.boards.forEach(b => { b.has_anim = !!b.bg_anim });
  const save = () => store.set(KEY, JSON.stringify({ ...db, files: {} }));
  save();

  // ---------- الجلسة ----------
  let session = store.get(SKEY);
  if (session && !db.profiles.some(p => p.id === session)) session = null;
  const me = () => db.profiles.find(p => p.id === session);
  const has = r => { const u = me(); return !!u && u.active && u.roles.includes(r) };
  const active = () => { const u = me(); return !!u && u.active };
  const err = (message, code) => ({ data: null, error: { message, code } });
  const boardsOf = uid => { const p = db.profiles.find(x => x.id === uid); return !p || !p.active ? [] : p.roles.includes('admin') ? db.boards.map(b => b.id) : db.board_members.filter(m => m.user_id === uid).map(m => m.board_id) };
  const inBoard = b => boardsOf(session).includes(b);

  // ---------- الصلاحيات (نفس policies بالقاعدة) ----------
  const canRead = {
    invoices: i => !i.deleted_at && inBoard(i.board_id) && (has('admin') || has('mgr') || has('acc') || (has('wh') && ['decision', 'done'].includes(i.stage)) || (has('rep') && i.rep_id === session) || rolePerm(session, 'see_all')),
    boards: b => inBoard(b.id),
    board_members: m => inBoard(m.board_id),
    invoice_notif_prefs: r => r.user_id === session,
    invoice_costs: () => has('admin'),
    profiles: p => active() || p.id === session,
    customers: () => active(),
    app_settings: () => active(),
    notifications: n => n.user_id === session,
  };
  const readable = (t, r) => {
    if (canRead[t]) return canRead[t](r);
    if (t === 'comment_reactions') { const c = db.invoice_comments.find(x => x.id === r.comment_id); return !!c && readable('invoice_comments', c) }
    if (t === 'invoice_comments' || t === 'invoice_log' || t === 'invoice_stage_log') { const i = db.invoices.find(x => x.id === r.invoice_id); return !!i && canRead.invoices(i) }
    return active();
  };

  function addLog(id, body) { db.invoice_log.push({ id: db.seq.invoice_log++, invoice_id: id, actor: session, body, at: iso(Date.now()) }) }
  // ---------- الإشعارات (نفس تريغرات 007) ----------
  const canSeeAs = (uid, i) => {
    const p = db.profiles.find(x => x.id === uid); if (!p || !p.active || !boardsOf(uid).includes(i.board_id)) return false; const r = p.roles;
    return r.includes('admin') || r.includes('mgr') || r.includes('acc') || (r.includes('wh') && ['decision', 'done'].includes(i.stage)) || (r.includes('rep') && i.rep_id === uid);
  };
  function mentioned(text) {
    let t = String(text || ''); const out = [];
    if (!t.includes('@')) return out;
    [...db.profiles].filter(p => p.active && p.full_name.trim()).sort((a, b) => b.full_name.trim().length - a.full_name.trim().length).forEach(p => {
      const tag = '@' + p.full_name.trim(), k = t.indexOf(tag);
      if (k < 0 || /[A-Za-z0-9_\u0600-\u06FF]/.test(t[k + tag.length] || '')) return;
      out.push(p.id); t = t.split(tag).join(' ');
    });
    return out;
  }
  // منو دوره بهاي المرحلة (نفس turn_users بـ 008)
  // مراحل القرار (022): app_settings.stages — بدونه المدير ← الزبون ← المخزن
  const STEPS = () => { const r = db.app_settings.find(x => x.key === 'stages'); try { const j = r && JSON.parse(r.value); if (Array.isArray(j)) return j } catch (e) { } return [{ k: 'mgr', on: true }, { k: 'cust', on: true }, { k: 'wh', on: true }] };
  const nextStep = cur => { const L = STEPS(), at = cur == null ? -1 : L.findIndex(e => e.k === cur); return (L.slice(at + 1).find(e => e.on !== false) || {}).k || null };
  const stepName = k => String((STEPS().find(e => e.k === k) || {}).n || '').trim() || { mgr: 'موافقة المدير', cust: 'رد الزبون', wh: 'المخزن' }[k] || k;
  const placeName = k => ({ new: 'طلب جديد', acc: 'الحسابات', cancel: 'ملغاة', done: 'تمت' })[k] || stepName(String(k).split(':')[1]);
  const rolePerm = (uid, p) => { const u = db.profiles.find(x => x.id === uid); return !!u && u.active && db.role_defs.some(d => [...u.roles, ...(u.xroles || [])].includes(d.key) && d.perms.includes(p)) };
  // 023: طلبي كمندوب، أو صلاحية طلبات كل المندوبين
  const repMine = v => (has('rep') && v.rep_id === session) || rolePerm(session, 'rep_all');
  const hasPerm = p => has('admin') || rolePerm(session, p);
  const turnUsers = (stage, sub, rep) => {
    if (stage === 'new' || (stage === 'decision' && sub === 'cust')) return rep ? [rep] : [];
    if (stage === 'decision' && /^s_/.test(sub || '')) return db.profiles.filter(p => rolePerm(p.id, sub)).map(p => p.id);
    const role = stage === 'acc' ? 'acc' : stage === 'decision' ? { mgr: 'mgr', wh: 'wh' }[sub] : null;
    return role ? db.profiles.filter(p => p.active && p.roles.includes(role)).map(p => p.id) : [];
  };
  function notify(user_id, inv, kind, data) {
    if (!user_id || user_id === session || !canSeeAs(user_id, inv)) return;
    // نفس فلتر 013: إعداد الطلب يغطي العام
    const lvl = (db.invoice_notif_prefs.find(r => r.user_id === user_id && r.invoice_id === inv.id) || {}).level
      || (db.profiles.find(p => p.id === user_id) || {}).notif_level || 'all';
    const ord = { new: 1, acc: 2, decision: 3 };
    const important = ['mention', 'turn', 'late'].includes(kind) || (kind === 'stage' && (['done', 'cancel'].includes(data.stage) || ord[data.stage] < ord[data.from_stage]));
    if (lvl === 'none' || (lvl === 'mention' && kind !== 'mention') || (lvl === 'important' && !important)) return;
    db.notifications.push({ id: db.seq.notifications++, user_id, invoice_id: inv.id, kind, actor: session, data: { customer: inv.customer, ...data }, created_at: iso(Date.now()), read_at: null });
  }
  function stageLog(inv) { db.invoice_stage_log.push({ id: db.seq.invoice_stage_log++, invoice_id: inv.id, key: inv.stage === 'decision' ? 'decision:' + inv.sub : inv.stage, entered_at: iso(Date.now()) }) }

  // نفس أسماء سجل القاعدة (invoices_history) حتى ملخص "شنو تغيّر" يشتغل بالتجريبي
  const FIELD = { customer_id: 'الزبون', quote_no: 'رقم عرض السعر', res_no: 'رقم الحجز', value: 'القيمة', payment: 'طريقة السداد', credit_months: 'أشهر الآجل',
    payer: 'التوصيل', transport_amt: 'أجور النقل', points: 'النقاط', ld: 'خصم لاحق', ld_pct: 'نسبة الخصم اللاحق', disc_req: 'طلب خصم', disc_pct: 'نسبة طلب الخصم', cust_debt: 'على الزبون دين', debt_cur: 'عملة الدين', debt_iqd: 'الدين بالدينار', debt_usd: 'الدين بالدولار', bal_cur: 'عملة الرصيد', bal_iqd: 'الرصيد بالدينار', bal_usd: 'الرصيد بالدولار', notes: 'ملاحظات', pdf_path: 'ملف الـ PDF', rep_id: 'المندوب' };
  const BASIC = ['customer_id', 'customer', 'quote_no', 'res_no', 'value', 'pdf_path', 'pdf_name', 'pdf_size', 'rep_id'];
  const TERMS = ['payment', 'credit_months', 'payer', 'transport_amt', 'points', 'ld', 'ld_pct', 'notes', 'cust_debt', 'debt_cur', 'debt_iqd', 'debt_usd', 'bal_cur', 'bal_iqd', 'bal_usd'];

  function updateInvoice(inv, patch) {
    const keys = Object.keys(patch);
    const admin = has('admin');
    if (!admin) {
      const okBasic = inv.stage === 'new' && repMine(inv);
      const okTerms = inv.stage === 'acc' && has('acc');
      for (const k of keys) {
        if (['value', 'disc_req', 'disc_pct'].includes(k) && (okBasic || okTerms)) continue;
        if (BASIC.includes(k) && !okBasic) return 'ما تكدر تعدل بيانات الطلب بهاي المرحلة';
        if (TERMS.includes(k) && !okTerms) return 'الشروط يعدلها المحاسب بمرحلة الحسابات';
        if (!BASIC.includes(k) && !TERMS.includes(k)) return 'ما عندك صلاحية';
      }
    }
    if ('customer_id' in patch) { const c = db.customers.find(x => x.id === patch.customer_id); if (c) patch.customer = c.name }
    const before = mentioned(inv.notes);
    const old = { ...inv };
    Object.assign(inv, patch);
    if ('notes' in patch) mentioned(inv.notes).filter(u => !before.includes(u)).forEach(u => notify(u, inv, 'mention', { src: 'notes', text: String(inv.notes).slice(0, 160) }));
    // نفس شكل سجل القاعدة (invoices_history): "عدّل الحقل: قبل ← بعد"
    const V = { cash: 'نقدي', credit: 'آجل', customer: 'على الزبون', none: 'بدون', iqd: 'دينار', usd: 'دولار', both: 'دينار ودولار' };
    const f = v => v == null || v === '' ? '—' : v === true ? 'نعم' : v === false ? 'لا' : typeof v === 'number' ? v.toLocaleString('en-US') : V[v] || String(v).slice(0, 80);
    const diff = keys.filter(k => FIELD[k] && f(old[k]) !== f(inv[k])).map(k => `${FIELD[k]}: ${f(old[k])} ← ${f(inv[k])}`);
    if (diff.length) addLog(inv.id, 'عدّل ' + diff.join('، '));
    return null;
  }

  // ---------- استعلامات ----------
  function parseOr(expr) {
    // مثال: stage.in.(new,acc,decision),closed_at.gte.2026-01-01T...
    const parts = []; let depth = 0, cur = '';
    for (const ch of expr) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = '' } else cur += ch }
    if (cur) parts.push(cur);
    return parts.map(p => {
      const [col, op, ...rest] = p.split('.'); const val = rest.join('.');
      if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); return r => set.includes(String(r[col])) }
      if (op === 'gte') return r => r[col] != null && r[col] >= val;
      if (op === 'eq') return r => String(r[col]) === val;
      return () => false;
    });
  }

  class Query {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = []; this.rng = null; this.one = null; this.ret = false }
    select() { if (this.op !== 'select') this.ret = true; return this }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this }
    update(p) { this.op = 'update'; this.payload = p; return this }
    upsert(p) { this.op = 'upsert'; this.payload = p; return this }
    delete() { this.op = 'delete'; return this }
    eq(c, v) { this.f.push(r => String(r[c]) === String(v)); return this }
    neq(c, v) { this.f.push(r => String(r[c]) !== String(v)); return this }
    gte(c, v) { this.f.push(r => r[c] != null && r[c] >= v); return this }
    gt(c, v) { this.f.push(r => r[c] != null && r[c] > v); return this }
    lte(c, v) { this.f.push(r => r[c] != null && r[c] <= v); return this }
    lt(c, v) { this.f.push(r => r[c] != null && r[c] < v); return this }
    in(c, arr) { const s = arr.map(String); this.f.push(r => s.includes(String(r[c]))); return this }
    not(c, op, v) { if (op === 'is' && v === null) this.f.push(r => r[c] != null); return this }
    or(expr) { const fs = parseOr(expr); this.f.push(r => fs.some(fn => fn(r))); return this }
    order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this }
    range(a, b) { this.rng = [a, b]; return this }
    limit(n) { this.rng = [0, n - 1]; return this }
    single() { this.one = 'single'; return this }
    maybeSingle() { this.one = 'maybe'; return this }
    then(res, rej) { return new Promise(r => setTimeout(r, 60)).then(() => this.run()).then(res, rej) }

    rows() { return (db[this.t] || []).filter(r => readable(this.t, r) && this.f.every(fn => fn(r))) }
    finish(list) {
      list = list.slice();
      if (this.ord.length) list.sort((a, b) => { for (const [c, asc] of this.ord) { if (a[c] === b[c]) continue; return (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1) } return 0 });
      if (this.rng) list = list.slice(this.rng[0], this.rng[1] + 1);
      list = clone(list);
      if (this.one) {
        if (!list.length) return this.one === 'maybe' ? { data: null, error: null } : err('ما لقيت الصف', 'PGRST116');
        return { data: list[0], error: null };
      }
      return { data: list, error: null };
    }
    run() {
      if (!session) return err('JWT expired', '401');
      const t = this.t;
      // جدول مو موجود بالعرض (مثل boards): نفس خطأ القاعدة، والواجهة ترجع لبورد واحد
      if (!db[t]) return err(`relation "public.${t}" does not exist`, '42P01');
      if (this.op === 'select') return this.finish(this.rows());
      if (this.op === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload], out = [];
        for (const r0 of rows) {
          const r = { ...r0 };
          if (t === 'invoices') {
            if (r.board_id == null) r.board_id = 1;
            if (!inBoard(r.board_id) || !(has('admin') || (has('rep') && r.rep_id === session))) return err('new row violates row-level security policy for table "invoices"', '42501');
            const c = db.customers.find(x => x.id === r.customer_id);
            Object.assign(r, { id: ++db.seq.invoices, created_by: session, stage: 'new', sub: null, customer: c ? c.name : r.customer || '', points: 0, ld: false, disc_req: !!r.disc_req, disc_pct: r.disc_req ? r.disc_pct ?? null : null, cust_debt: null, debt_cur: null, cost_set: false, returned: 0,
              created_at: iso(Date.now()), stage_at: iso(Date.now()), closed_at: null, pdf_path: null, delete_req_at: null });
            db.invoices.push(r); addLog(r.id, 'أنشأ الطلب'); stageLog(r);
          } else if (t === 'customers') {
            if (!has('admin')) return err('ما عندك صلاحية', '42501');
            if (db.customers.some(c => c.name.trim().toLowerCase() === String(r.name).trim().toLowerCase())) return err('duplicate key value', '23505');
            Object.assign(r, { id: ++db.seq.customers, active: true, created_at: iso(Date.now()), phone: r.phone || '', notes: r.notes || '' });
            db.customers.push(r);
          } else if (t === 'boards') {
            if (!has('admin')) return err('ما عندك صلاحية', '42501');
            if (db.boards.some(b => b.name.trim() === String(r.name).trim())) return err('duplicate key value violates unique constraint', '23505');
            Object.assign(r, { id: ++db.seq.boards, name: String(r.name).trim() });
            db.boards.push(r);
          } else if (t === 'role_defs') {
            if (!has('admin')) return err('ما عندك صلاحية', '42501');
            if (db.role_defs.some(d => d.name.trim() === String(r.name).trim())) return err('duplicate key value violates unique constraint', '23505');
            Object.assign(r, { builtin: false, perms: r.perms || [], created_at: iso(Date.now()) });
            db.role_defs.push(r);
          } else if (t === 'board_members') {
            if (!has('admin')) return err('ما عندك صلاحية', '42501');
            if (!db.board_members.some(m => m.board_id === r.board_id && m.user_id === r.user_id)) db.board_members.push(r);
          } else if (t === 'invoice_comments') {
            const inv = db.invoices.find(x => x.id === r.invoice_id);
            if (!inv || !canRead.invoices(inv)) return err('ما عندك صلاحية', '42501');
            Object.assign(r, { id: db.seq.invoice_comments++, author: session, is_system: false, at: iso(Date.now()) });
            db.invoice_comments.push(r);
            const m = mentioned(r.body);
            m.forEach(u => notify(u, inv, 'mention', { src: 'comment', text: String(r.body).slice(0, 160) }));
            [...new Set([inv.rep_id, inv.created_by].filter(Boolean))].filter(u => !m.includes(u)).forEach(u => notify(u, inv, 'comment', { text: String(r.body).slice(0, 160) }));
          } else return err('ما عندك صلاحية', '42501');
          out.push(r);
        }
        save();
        return this.ret ? (this.one ? { data: clone(out[0]), error: null } : { data: clone(out), error: null }) : { data: null, error: null };
      }
      if (this.op === 'upsert') {
        if (t !== 'app_settings' || !has('admin')) return err('ما عندك صلاحية', '42501');
        const r = db.app_settings.find(x => x.key === this.payload.key);
        if (this.payload.key === 'stages') {
          const keys = JSON.parse(this.payload.value).map(e => e.k);
          const gone = r ? JSON.parse(r.value).filter(e => !keys.includes(e.k)) : [];
          for (const g of gone) { const n = db.invoices.filter(i => i.stage === 'decision' && i.sub === g.k && !i.deleted_at).length; if (n) return err(`ما تكدر تحذف مرحلة "${g.n || g.k}" — بيها ${n} طلب`) }
          db.role_defs.forEach(d => { d.perms = d.perms.filter(x => !/^s_/.test(x) || keys.includes(x)) });
        }
        if (r) Object.assign(r, this.payload); else db.app_settings.push({ ...this.payload });
        save(); return { data: null, error: null };
      }
      if (this.op === 'update') {
        const list = this.rows();
        for (const r of list) {
          if (t === 'invoices') { const e = updateInvoice(r, { ...this.payload }); if (e) return err(e, '42501') }
          else if (t === 'role_defs') { if (!has('admin')) return err('ما عندك صلاحية', '42501'); Object.assign(r, this.payload) }
          else if (t === 'customers' || t === 'boards') {
            if (!has('admin')) return err('ما عندك صلاحية', '42501');
            if (t === 'boards' && db.boards.some(b => b !== r && b.name.trim() === String(this.payload.name).trim())) return err('duplicate key value violates unique constraint', '23505');
            Object.assign(r, this.payload);
            if (t === 'boards') r.has_anim = !!r.bg_anim;
          }
          else if (t === 'notifications') { if (Object.keys(this.payload).some(k => k !== 'read_at')) return err('permission denied for table notifications', '42501'); Object.assign(r, this.payload) }
          else if (t === 'profiles') {
            if (!has('admin')) return err('ما عندك صلاحية', '42501');
            if (r.id === session && (this.payload.active === false || (this.payload.roles && !this.payload.roles.includes('admin')))) return err('ما تكدر توقف حسابك أو تشيل الأدمن عن نفسك');
            Object.assign(r, this.payload); if (r.roles) r.role = r.roles[0];
          } else return err('ما عندك صلاحية', '42501');
        }
        save(); return { data: null, error: null };
      }
      if (this.op === 'delete') {
        if (!has('admin')) return err('ما عندك صلاحية', '42501');
        const gone = new Set(this.rows()), ids = new Set([...gone].map(r => r.id));
        if (t === 'customers' && db.invoices.some(i => ids.has(i.customer_id))) return err('الزبون مربوط بطلبات');
        if (t === 'role_defs') { if ([...gone].some(d => d.builtin)) return err('ما ينحذف دور أساسي'); db.profiles.forEach(p => p.xroles = (p.xroles || []).filter(k => !gone.has(db.role_defs.find(d => d.key === k)))) }
        db[t] = db[t].filter(r => !gone.has(r));
        save(); return { data: null, error: null };
      }
      return err('عملية غير مدعومة بالنسخة التجريبية');
    }
  }

  // ---------- الدوال (RPC) ----------
  function getInvFor(id) {
    if (!active()) throw new Error('الحساب غير مفعّل');
    const v = db.invoices.find(x => x.id === +id);
    if (!v) throw new Error('الطلب غير موجود');
    if (!inBoard(v.board_id)) throw new Error('الطلب مو ضمن بورداتك');
    if (v.deleted_at) throw new Error('الطلب بسلة المحذوفات — رجّعه أول');
    return v;
  }
  const blank = s => String(s ?? '').trim() === '';
  function move(v, stage, sub, body) {
    const from = { from_stage: v.stage, from_sub: v.sub };
    v.stage = stage; v.sub = sub; v.stage_at = iso(Date.now());
    const owners = [...new Set([v.rep_id, v.created_by].filter(Boolean))], d = { stage, sub, ...from, reason: stage === 'cancel' ? v.cancel_reason : null };
    owners.forEach(u => notify(u, v, 'stage', d));
    turnUsers(stage, sub, v.rep_id).filter(u => !owners.includes(u)).forEach(u => notify(u, v, 'turn', d));
    if (['done', 'cancel'].includes(stage)) v.closed_at = v.stage_at;
    stageLog(v); addLog(v.id, body);
  }
  // الخطوة المفعّلة اللي بعد from، أو يكتمل الطلب
  function advance(v, from, body) { const n = nextStep(from); move(v, n ? 'decision' : 'done', n, body) }
  function profitRows() {
    return db.invoices.map(i => {
      const c = db.invoice_costs.find(x => x.invoice_id === i.id); if (!c) return null;
      const total = (+i.value || 0) + (i.payer === 'customer' ? +i.transport_amt || 0 : 0);
      if (total <= 0) return null;
      const gross = (1 - c.cost / total) * 100, net = gross - (i.ld ? +i.ld_pct || 0 : 0) - (i.disc_req ? +i.disc_pct || 0 : 0) - (+i.points || 0) * 1.5;
      return { invoice_id: i.id, stage: i.stage, total, gross_pct: round2(gross), net_pct: round2(net) };
    }).filter(Boolean);
  }

  const RPC = {
    inv_send_to_acc({ p_id }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'new') throw new Error('الطلب مو بمرحلة طلب جديد');
      if (!(has('admin') || repMine(v))) throw new Error('ما عندك صلاحية');
      if (v.customer_id == null) throw new Error('اختار الزبون من القائمة');
      if (blank(v.quote_no) === blank(v.res_no)) throw new Error('اكتب رقم عرض السعر أو رقم الحجز (واحد منهم فقط)');
      if (!(+v.value > 0)) throw new Error('قيمة الفاتورة مطلوبة');
      if (!v.pdf_path) throw new Error('ملف الـ PDF مطلوب');
      move(v, 'acc', null, 'أرسل الطلب للحسابات'); return v;
    },
    inv_send_to_decision({ p_id }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'acc') throw new Error('الطلب مو بمرحلة الحسابات');
      if (!(has('acc') || has('admin'))) throw new Error('ما عندك صلاحية');
      if (!['cash', 'credit'].includes(v.payment)) throw new Error('طريقة السداد: نقدي أو آجل');
      if (v.payment === 'credit' && v.credit_months == null) throw new Error('حدد عدد أشهر الآجل');
      if (!['customer', 'none', 'company'].includes(v.payer)) throw new Error('حدد النقل: على الزبون أو بدون');
      if (v.payer === 'customer' && !(+v.transport_amt > 0)) throw new Error('اكتب مبلغ أجور النقل');
      if (v.ld && (!(+v.ld_pct > 0) || +v.ld_pct > 100)) throw new Error('اكتب نسبة الخصم اللاحق');
      if (!v.cost_set) throw new Error('اكتب سعر الكلفة');
      advance(v, null, 'أرسل الطلب للقرار'); return v;
    },
    inv_approve({ p_id }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'mgr') throw new Error('الطلب مو بانتظار موافقة المدير');
      if (!(has('mgr') || has('admin'))) throw new Error('الموافقة للمدير فقط');
      advance(v, 'mgr', 'وافق المدير على الشروط'); return v;
    },
    inv_return_to_acc({ p_id, p_reason }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'mgr') throw new Error('الطلب مو بانتظار موافقة المدير');
      if (!(has('mgr') || has('admin'))) throw new Error('الإرجاع للمدير فقط');
      v.returned = (v.returned || 0) + 1;
      db.invoice_comments.push({ id: db.seq.invoice_comments++, invoice_id: v.id, author: session, body: 'إرجاع للحسابات' + (blank(p_reason) ? '' : ': ' + p_reason.trim()), is_system: true, at: iso(Date.now()) });
      move(v, 'acc', null, 'أرجع الطلب للحسابات'); return v;
    },
    inv_return_to_rep({ p_id, p_reason }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'acc') throw new Error('الطلب مو بمرحلة الحسابات');
      if (!(has('acc') || has('admin'))) throw new Error('الإرجاع للمحاسب فقط');
      v.returned = (v.returned || 0) + 1;
      db.invoice_comments.push({ id: db.seq.invoice_comments++, invoice_id: v.id, author: session, body: 'إرجاع للمندوب' + (blank(p_reason) ? '' : ' — التعديلات المطلوبة: ' + p_reason.trim()), is_system: true, at: iso(Date.now()) });
      move(v, 'new', null, 'أرجع الطلب للمندوب'); return v;
    },
    inv_move({ p_id, p_target, p_reason }) {
      const ORD = { new: 1, acc: 2, ...Object.fromEntries(STEPS().map((e, i) => ['decision:' + e.k, i + 3])) };
      if (!(has('admin') || has('mgr'))) throw new Error('نقل الطلب للأدمن والمدير فقط');
      if (!(['new', 'acc', 'cancel'].includes(p_target) || (String(p_target).startsWith('decision:') && ORD[p_target]))) throw new Error('مرحلة غير معروفة');
      const v = getInvFor(p_id);
      const from = v.stage + (v.sub ? ':' + v.sub : '');
      if (from === p_target) throw new Error('الطلب أصلاً بهاي المرحلة');
      const [stage, sub = null] = p_target.split(':');
      if ((ORD[p_target] || 99) < (ORD[from] || 0)) v.returned = (v.returned || 0) + 1;
      if (v.stage === 'done') v.sales_no = null;
      v.cancel_reason = stage === 'cancel' && !blank(p_reason) ? p_reason.trim() : null;
      v.closed_at = null;
      db.invoice_comments.push({ id: db.seq.invoice_comments++, invoice_id: v.id, author: session, body: `نقل من ${placeName(from)} إلى ${placeName(p_target)}${blank(p_reason) ? '' : ': ' + p_reason.trim()}`, is_system: true, at: iso(Date.now()) });
      move(v, stage, sub, 'نقل الطلب إلى ' + placeName(p_target)); return v;
    },
    comment_edit({ p_id, p_body }) {
      const c = db.invoice_comments.find(x => x.id === p_id); if (!c) throw new Error('التعليق غير موجود');
      if (c.is_system) throw new Error('تعليقات النظام ما تتعدل');
      if (c.author !== session) throw new Error('تعدل تعليقك بس');
      if (blank(p_body)) throw new Error('التعليق فارغ');
      c.body = p_body.trim(); c.edited_at = iso(Date.now()); return null;
    },
    comment_delete({ p_id }) {
      const c = db.invoice_comments.find(x => x.id === p_id); if (!c) throw new Error('التعليق غير موجود');
      if (!(has('admin') || (!c.is_system && c.author === session))) throw new Error('تحذف تعليقك بس');
      db.invoice_comments = db.invoice_comments.filter(x => x !== c); return null;
    },
    inv_customer_accept({ p_id }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'cust') throw new Error('الطلب مو بانتظار رد الزبون');
      if (!(has('mgr') || has('admin') || repMine(v))) throw new Error('ما عندك صلاحية');
      advance(v, 'cust', 'أكد موافقة الزبون'); return v;
    },
    inv_customer_refuse({ p_id, p_reason, p_back }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'cust') throw new Error('الطلب مو بانتظار رد الزبون');
      if (!(has('mgr') || has('admin') || repMine(v))) throw new Error('ما عندك صلاحية');
      if (blank(p_reason)) throw new Error('سبب الرفض مطلوب');
      if (!p_back) { v.cancel_reason = p_reason; move(v, 'cancel', null, 'سجل رفض الزبون وألغى الطلب'); return v }
      const mgrOn = STEPS().some(e => e.k === 'mgr' && e.on !== false), to = mgrOn ? 'للمدير' : 'للحسابات';
      v.returned = (v.returned || 0) + 1;
      db.invoice_comments.push({ id: db.seq.invoice_comments++, invoice_id: v.id, author: session, body: 'الزبون رفض — رجع ' + to + ': ' + p_reason.trim(), is_system: true, at: iso(Date.now()) });
      move(v, mgrOn ? 'decision' : 'acc', mgrOn ? 'mgr' : null, 'سجل رفض الزبون وأرجع الطلب ' + to); return v;
    },
    inv_complete({ p_id, p_sales_no }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'wh') throw new Error('الطلب مو بانتظار المخزن');
      if (!(has('wh') || has('mgr') || has('admin'))) throw new Error('التحويل للمخزن أو المدير');
      if (blank(p_sales_no)) throw new Error('رقم المبيعات مطلوب');
      v.sales_no = p_sales_no.trim(); advance(v, 'wh', 'حول الطلب لمبيعات برقم ' + v.sales_no); return v;
    },
    inv_step_pass({ p_id }) {
      const v = getInvFor(p_id), k = v.sub;
      if (v.stage !== 'decision' || !/^s_/.test(k || '')) throw new Error('الطلب مو بهاي المرحلة');
      if (!hasPerm(k)) throw new Error('ما عندك صلاحية مرحلة ' + stepName(k));
      advance(v, k, 'أكمل مرحلة ' + stepName(k)); return v;
    },
    inv_step_back({ p_id, p_reason }) {
      const v = getInvFor(p_id), k = v.sub;
      if (v.stage !== 'decision' || !/^s_/.test(k || '')) throw new Error('الطلب مو بهاي المرحلة');
      if (!(STEPS().find(e => e.k === k) || {}).back) throw new Error('هاي المرحلة ما ترجع للحسابات');
      if (!hasPerm(k)) throw new Error('ما عندك صلاحية مرحلة ' + stepName(k));
      v.returned = (v.returned || 0) + 1;
      db.invoice_comments.push({ id: db.seq.invoice_comments++, invoice_id: v.id, author: session, body: 'إرجاع للحسابات من ' + stepName(k) + (blank(p_reason) ? '' : ': ' + p_reason.trim()), is_system: true, at: iso(Date.now()) });
      move(v, 'acc', null, 'أرجع الطلب للحسابات من ' + stepName(k)); return v;
    },
    stage_counts() {
      if (!has('admin')) return [];
      const c = {};
      db.invoices.filter(i => i.stage === 'decision' && !i.deleted_at).forEach(i => { c[i.sub] = (c[i.sub] || 0) + 1 });
      return Object.entries(c).map(([k, n]) => ({ k, n }));
    },
    inv_set_urgent({ p_id, p_on }) {
      const v = getInvFor(p_id);
      if (!['new', 'acc', 'decision'].includes(v.stage)) throw new Error('الطلب مغلق');
      if (!(has('admin') || has('mgr') || repMine(v))) throw new Error('ما عندك صلاحية');
      if (!!v.urgent === !!p_on) return null;
      v.urgent = !!p_on; addLog(v.id, p_on ? 'أشّر الطلب طارئ' : 'شال علامة طارئ'); return null;
    },
    inv_set_cost({ p_id, p_cost }) {
      const v = getInvFor(p_id);
      if (!(has('admin') || (has('acc') && v.stage === 'acc'))) throw new Error('سعر الكلفة يكتبه المحاسب بمرحلة الحسابات');
      if (!(+p_cost > 0)) throw new Error('سعر الكلفة لازم أكبر من صفر');
      const had = v.cost_set, c = db.invoice_costs.find(x => x.invoice_id === v.id);
      if (c) Object.assign(c, { cost: +p_cost, set_by: session, set_at: iso(Date.now()) });
      else db.invoice_costs.push({ invoice_id: v.id, cost: +p_cost, set_by: session, set_at: iso(Date.now()) });
      v.cost_set = true; addLog(v.id, had ? 'عدّل سعر الكلفة' : 'سجّل سعر الكلفة'); return null;
    },
    inv_request_delete({ p_id, p_reason }) {
      const v = getInvFor(p_id);
      if (blank(p_reason)) throw new Error('سبب الحذف مطلوب');
      if (v.delete_req_at) throw new Error('الطلب عليه طلب حذف');
      Object.assign(v, { delete_req_by: session, delete_req_at: iso(Date.now()), delete_req_reason: p_reason.trim() });
      addLog(v.id, 'طلب حذف الطلب: ' + p_reason.trim()); return null;
    },
    inv_cancel_delete_request({ p_id }) {
      const v = getInvFor(p_id);
      if (!v.delete_req_at) throw new Error('ماكو طلب حذف');
      if (!(has('admin') || v.delete_req_by === session)) throw new Error('ما عندك صلاحية');
      const mine = v.delete_req_by === session;
      Object.assign(v, { delete_req_by: null, delete_req_at: null, delete_req_reason: null });
      addLog(v.id, has('admin') && !mine ? 'رفض طلب الحذف' : 'ألغى طلب الحذف'); return null;
    },
    // 016: الحذف ينقل للسلة
    inv_delete({ p_id }) {
      if (!has('admin')) throw new Error('الحذف للأدمن فقط');
      const v = getInvFor(p_id); if (v.deleted_at) throw new Error('الطلب غير موجود');
      Object.assign(v, { deleted_at: iso(Date.now()), deleted_by: session }); addLog(v.id, 'نقل الطلب لسلة المحذوفات');
      return null;
    },
    inv_restore({ p_id }) {
      if (!has('admin')) throw new Error('الاسترجاع للأدمن فقط');
      const v = db.invoices.find(x => x.id === +p_id); if (!v || !v.deleted_at) throw new Error('الطلب مو بسلة المحذوفات');
      Object.assign(v, { deleted_at: null, deleted_by: null, delete_req_by: null, delete_req_at: null, delete_req_reason: null }); addLog(v.id, 'رجع الطلب من سلة المحذوفات');
      return null;
    },
    inv_purge({ p_id }) {
      if (!has('admin')) throw new Error('الحذف للأدمن فقط');
      const v = db.invoices.find(x => x.id === +p_id); if (!v || !v.deleted_at) throw new Error('الطلب مو بسلة المحذوفات');
      const cids = db.invoice_comments.filter(c => c.invoice_id === v.id).map(c => c.id);
      db.comment_reactions = db.comment_reactions.filter(r => !cids.includes(r.comment_id));
      ['invoice_comments', 'invoice_log', 'invoice_stage_log', 'invoice_costs', 'notifications'].forEach(t => db[t] = db[t].filter(r => r.invoice_id !== v.id));
      db.invoices = db.invoices.filter(r => r.id !== v.id);
      return v.pdf_path;
    },
    trash_list() {
      if (!has('admin')) throw new Error('سلة المحذوفات للأدمن فقط');
      return db.invoices.filter(i => i.deleted_at && inBoard(i.board_id)).sort((a, b) => a.deleted_at < b.deleted_at ? 1 : -1);
    },
    comment_react({ p_id, p_emoji }) {
      if (!active()) throw new Error('الحساب غير مفعّل');
      const c = db.invoice_comments.find(x => x.id === +p_id); if (!c || !readable('invoice_comments', c)) throw new Error('التعليق غير موجود');
      if (!['👍', '❤️', '😂', '😮', '🙏', '✅'].includes(p_emoji)) throw new Error('violates check constraint "comment_reactions_emoji_chk"');
      const k = db.comment_reactions.findIndex(r => r.comment_id === c.id && r.user_id === session && r.emoji === p_emoji);
      if (k >= 0) { db.comment_reactions.splice(k, 1); return false }
      db.comment_reactions.push({ comment_id: c.id, user_id: session, emoji: p_emoji, at: iso(Date.now()) }); return true;
    },
    board_stats() {
      const out = {};
      db.invoices.filter(i => canRead.invoices(i) && isActiveStage(i.stage)).forEach(i => {
        const r = out[i.board_id] = out[i.board_id] || { board_id: i.board_id, active: 0, late: 0 };
        r.active++; if ((Date.now() - new Date(i.stage_at)) / DAY >= 3) r.late++;
      });
      return Object.values(out);
    },
    set_notif_level({ p_level }) {
      if (!['all', 'important', 'mention', 'none'].includes(p_level)) throw new Error('مستوى غير معروف');
      me().notif_level = p_level; return null;
    },
    set_invoice_notif({ p_id, p_level }) {
      const v = getInvFor(p_id); if (!canRead.invoices(v)) throw new Error('الطلب غير موجود');
      db.invoice_notif_prefs = db.invoice_notif_prefs.filter(r => !(r.user_id === session && r.invoice_id === v.id));
      if (p_level) db.invoice_notif_prefs.push({ user_id: session, invoice_id: v.id, level: p_level });
      return null;
    },
    inv_set_board({ p_id, p_board }) {
      if (!has('admin')) throw new Error('نقل الطلب لبورد ثاني للأدمن فقط');
      const b = db.boards.find(x => x.id === +p_board); if (!b) throw new Error('البورد غير موجود');
      const v = getInvFor(p_id);
      if (v.board_id !== b.id) { v.board_id = b.id; addLog(v.id, 'نقل الطلب لبورد ' + b.name) }
      return clone(v);
    },
    inv_profits({ p_ids }) {
      const ids = p_ids ? new Set(p_ids.map(Number)) : null;
      const vis = new Set(db.invoices.filter(i => inBoard(i.board_id)).map(i => i.id));
      return profitRows().filter(p => (!ids || ids.has(p.invoice_id)) && vis.has(p.invoice_id) && (has('admin') || (has('mgr') && ['decision', 'done', 'cancel'].includes(p.stage))))
        .map(({ stage, ...p }) => p);
    },
    report_summary({ p_from, p_to, p_board = 1 }) {
      if (!(has('admin') || has('mgr'))) throw new Error('التقارير للأدمن والمدير');
      if (!inBoard(+p_board)) throw new Error('ما عندك صلاحية على هذا البورد');
      const from = new Date(p_from + 'T00:00').getTime(), to = new Date(p_to + 'T00:00').getTime() + DAY;
      const list = db.invoices.filter(i => { if (i.board_id !== +p_board) return false; const t = new Date(i.created_at).getTime(); return t >= from && t < to });
      const P = Object.fromEntries(profitRows().map(p => [p.invoice_id, p]));
      const avg = a => a.length ? round2(a.reduce((s, x) => s + x, 0) / a.length) : null;
      const cyc = i => (new Date(i.closed_at) - new Date(i.created_at)) / DAY;
      const done = list.filter(i => i.stage === 'done'), act = list.filter(i => isActiveStage(i.stage));
      const netOf = arr => avg(arr.map(i => P[i.id]).filter(Boolean).map(p => p.net_pct));
      const byRep = {};
      list.forEach(i => { (byRep[i.rep_id] = byRep[i.rep_id] || []).push(i) });
      const byMonth = {};
      done.forEach(i => { const m = i.closed_at.slice(0, 7); (byMonth[m] = byMonth[m] || []).push(i) });
      const ids = new Set(list.map(i => i.id)), durs = {};
      const order = ['new', 'acc', 'decision:mgr', 'decision:cust', 'decision:wh'];
      Object.values(db.invoice_stage_log.filter(s => ids.has(s.invoice_id)).reduce((m, s) => ((m[s.invoice_id] = m[s.invoice_id] || []).push(s), m), {}))
        .forEach(arr => {
          arr.sort((a, b) => a.entered_at < b.entered_at ? -1 : 1);
          const inv = db.invoices.find(i => i.id === arr[0].invoice_id);
          arr.forEach((s, k) => {
            if (!order.includes(s.key)) return;
            const end = arr[k + 1] ? new Date(arr[k + 1].entered_at) : inv.closed_at ? new Date(inv.closed_at) : new Date();
            (durs[s.key] = durs[s.key] || []).push((end - new Date(s.entered_at)) / DAY);
          });
        });
      const reasons = {};
      list.filter(i => i.stage === 'cancel').forEach(i => { const r = i.cancel_reason || '—'; reasons[r] = (reasons[r] || 0) + 1 });
      return {
        totals: { count: list.length, active: act.length, done: done.length, done_value: done.reduce((s, i) => s + (+i.value || 0), 0),
          cancel: list.filter(i => i.stage === 'cancel').length, late: act.filter(i => (Date.now() - new Date(i.stage_at)) / DAY >= 3).length,
          avg_cycle_days: avg(done.map(cyc)), avg_net_pct: netOf(done) },
        by_rep: Object.entries(byRep).map(([rep, a]) => {
          const d = a.filter(i => i.stage === 'done');
          return { rep: (db.profiles.find(p => p.id === rep) || {}).full_name || '—', total: a.length, active: a.filter(i => isActiveStage(i.stage)).length,
            done: d.length, cancel: a.filter(i => i.stage === 'cancel').length, done_value: d.reduce((s, i) => s + (+i.value || 0), 0),
            avg_cycle_days: avg(d.map(cyc)), avg_net_pct: netOf(d) };
        }).sort((a, b) => b.done_value - a.done_value),
        by_month: Object.entries(byMonth).sort().map(([month, a]) => ({ month, done: a.length, value: a.reduce((s, i) => s + (+i.value || 0), 0), avg_net_pct: netOf(a) })),
        stages: order.filter(k => durs[k]).map(k => ({ key: k, avg_days: avg(durs[k]), n: durs[k].length })),
        cancel_reasons: Object.entries(reasons).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
      };
    },
    push_subscribe() { return null },
    push_unsubscribe() { return null },
    set_avatar({ p_user, p_avatar }) {
      if (!active()) throw new Error('الحساب غير مفعّل');
      if (p_user !== session && !has('admin')) throw new Error('ما عندك صلاحية');
      if (p_avatar && !/^[a-z0-9-]{1,24}$/.test(p_avatar)) throw new Error('صورة غير معروفة');
      const p = db.profiles.find(x => x.id === p_user); if (!p) throw new Error('المستخدم غير موجود');
      p.avatar = p_avatar || null; if(p_user === session) p.avatar_chosen = true; return null;
    },
    admin_list_logins() {
      if (!has('admin')) throw new Error('للأدمن فقط');
      return db.profiles.map(p => ({ id: p.id, login: db.logins[p.id] || '' }));
    },
    admin_create_user({ p_username, p_password, p_full_name, p_roles, p_boards }) {
      if (!has('admin')) throw new Error('للأدمن فقط');
      if (!/^[a-z0-9._-]{3,}$/.test(p_username || '')) throw new Error('اسم المستخدم: أحرف إنجليزية صغيرة وأرقام فقط (3 أو أكثر)');
      if (Object.values(db.logins).includes(p_username)) throw new Error('اسم المستخدم موجود');
      if ((p_password || '').length < 8) throw new Error('الرمز لازم 8 أحرف على الأقل');
      if (!p_roles || !p_roles.length) throw new Error('لازم دور واحد على الأقل');
      const id = 'u-' + Math.random().toString(36).slice(2, 9);
      db.profiles.push({ id, avatar_chosen: false, full_name: p_full_name, roles: p_roles, role: p_roles[0], active: true, created_at: iso(Date.now()) });
      db.logins[id] = p_username;
      (p_boards && p_boards.length ? p_boards : [1]).forEach(b => { if (db.boards.some(x => x.id === +b)) db.board_members.push({ board_id: +b, user_id: id }) });
      return id;
    },
    admin_set_password({ p_password }) {
      if (!has('admin')) throw new Error('للأدمن فقط');
      if ((p_password || '').length < 8) throw new Error('الرمز لازم 8 أحرف على الأقل');
      return null;
    },
  };

  // ---------- العميل الوهمي ----------
  let authCb = null;
  const userObj = () => session ? { id: session, email: (db.logins[session] || 'user') + '@invoices.local' } : null;
  const client = {
    from: t => new Query(t),
    async rpc(fn, args = {}) {
      await new Promise(r => setTimeout(r, 120));
      if (!session) return err('JWT expired');
      if (!RPC[fn]) return err('الدالة مو موجودة بالنسخة التجريبية: ' + fn);
      try { const data = RPC[fn](args); save(); return { data: clone(data ?? null), error: null } }
      catch (e) { return err(e.message) }
    },
    channel() { return { on() { return this }, subscribe() { return this } } },
    removeChannel() { },
    storage: {
      from: () => ({
        async upload(path, file) { db.files[path] = URL.createObjectURL(file); return { data: { path }, error: null } },
        async createSignedUrl(path) { return { data: { signedUrl: db.files[path] || SAMPLE_PDF }, error: null } },
        async remove(paths) { paths.forEach(p => delete db.files[p]); return { data: null, error: null } },
      }),
    },
    auth: {
      async getUser() { return { data: { user: userObj() }, error: null } },
      async signInWithPassword({ email }) {
        await new Promise(r => setTimeout(r, 250));
        const login = String(email).split('@')[0];
        const id = Object.keys(db.logins).find(k => db.logins[k] === login);
        if (!id) return err('Invalid login credentials');
        session = id; store.set(SKEY, id);
        setTimeout(() => authCb && authCb('SIGNED_IN', { user: userObj() }), 0);
        return { data: { user: userObj() }, error: null };
      },
      async signOut() { session = null; store.del(SKEY); setTimeout(() => authCb && authCb('SIGNED_OUT', null), 0); return { error: null } },
      async updateUser() { return { data: {}, error: null } },
      onAuthStateChange(cb) { authCb = cb; setTimeout(() => cb('INITIAL_SESSION', session ? { user: userObj() } : null), 0); return { data: { subscription: { unsubscribe() { } } } } },
    },
  };
  window.supabase = { createClient: () => client };

  // ---------- واجهة النسخة التجريبية: دخول سريع لكل دور + تبديل الدور + إعادة البيانات ----------
  const ROLE_LABEL = { admin: 'أدمن', rep: 'مندوب', acc: 'محاسب', mgr: 'مدير', wh: 'مخزن' };
  function loginAs(id) { session = id; store.set(SKEY, id); location.reload() }
  document.addEventListener('DOMContentLoaded', () => {
    const card = document.querySelector('.auth-card');
    if (card) {
      const box = document.createElement('div');
      box.className = 'demo-login';
      box.innerHTML = `<p class="demo-note"><b>نسخة تجريبية.</b> البيانات وهمية وتنحفظ بمتصفحك بس. اختار دور وجرّب:</p>
        <div class="demo-roles">${USERS.map(u => `<button type="button" class="btn" data-demo-login="${u.id}"><span>${u.full_name}</span><span class="demo-role">${ROLE_LABEL[u.roles[0]]}</span></button>`).join('')}</div>
        <p class="help">أو ادخل يدوياً باسم المستخدم (مثل <b dir="ltr">ali</b>) وأي رمز.</p>`;
      card.insertBefore(box, card.querySelector('#cfgWarn'));
      box.addEventListener('click', e => { const b = e.target.closest('[data-demo-login]'); if (b) loginAs(b.dataset.demoLogin) });
    }
    const bar = document.querySelector('.bar .brand');
    if (bar) {
      const tag = document.createElement('span'); tag.className = 'demo-tag'; tag.textContent = 'تجريبي';
      bar.after(tag);
      const sw = document.createElement('div'); sw.className = 'demo-switch';
      sw.innerHTML = `<label for="demoAs">جرّب كـ</label><select id="demoAs">${USERS.map(u => `<option value="${u.id}">${u.full_name} (${ROLE_LABEL[u.roles[0]]})</option>`).join('')}</select>
        <button type="button" class="btn sm" id="demoReset" title="يرجع البيانات التجريبية مثل أول مرة">إعادة البيانات</button>`;
      document.querySelector('.bar .spacer').after(sw);
      const sel = sw.querySelector('#demoAs');
      if (session && USERS.some(u => u.id === session)) sel.value = session;
      sel.addEventListener('change', () => loginAs(sel.value));
      sw.querySelector('#demoReset').addEventListener('click', () => { store.del(KEY); location.reload() });
    }
  });
})();
