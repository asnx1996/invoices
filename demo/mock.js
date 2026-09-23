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
    { id: 'u-admin', login: 'admin', full_name: 'أحمد الأدمن', roles: ['admin'] },
    { id: 'u-rep1', login: 'ali', full_name: 'علي حسن', roles: ['rep'] },
    { id: 'u-rep2', login: 'sara', full_name: 'سارة كريم', roles: ['rep'] },
    { id: 'u-acc', login: 'hussein', full_name: 'حسين المحاسب', roles: ['acc'] },
    { id: 'u-mgr', login: 'omar', full_name: 'عمر المدير', roles: ['mgr'] },
    { id: 'u-wh', login: 'zaid', full_name: 'زيد المخزن', roles: ['wh'] },
  ];
  const CUSTOMERS = ['شركة النور للتجارة العامة', 'مؤسسة الرافدين', 'معرض بغداد للأجهزة', 'شركة دجلة للمقاولات', 'مكتب الفرات الهندسي',
    'أسواق الكرادة', 'شركة بابل للتوريدات', 'مجموعة الزوراء', 'مطبعة المنصور', 'شركة أربيل للإنشاء', 'مخازن البصرة الحديثة',
    'صيدليات الشفاء', 'شركة الكوفة للطاقة', 'معمل السلام', 'مركز الحلة التجاري', 'شركة سومر للنقل', 'فندق الميناء', 'مكتبة المتنبي'];

  function seed() {
    const db = {
      seq: { invoices: 1100, customers: 100, invoice_comments: 1, invoice_log: 1, invoice_stage_log: 1 },
      profiles: USERS.map(u => ({ id: u.id, full_name: u.full_name, roles: u.roles, role: u.roles[0], active: true, created_at: iso(now - 200 * DAY) })),
      logins: Object.fromEntries(USERS.map(u => [u.id, u.login])),
      customers: CUSTOMERS.map((name, i) => ({ id: i + 1, name, phone: '0770' + String(1234567 + i * 7919).slice(0, 7), notes: '', active: true, created_at: iso(now - 190 * DAY) })),
      invoices: [], invoice_costs: [], invoice_comments: [], invoice_log: [], invoice_stage_log: [],
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
        value: value || null, payment, credit_months: months, payer, transport_amt: tamt, points, ld: ld > 0, ld_pct: ld || null,
        notes: '', pdf_path: value ? `${id}/عرض-${id}.pdf` : null, pdf_name: value ? `عرض-${id}.pdf` : null, pdf_size: value ? 184000 + n * 3100 : null,
        cost_set: cost != null, returned: n === 5 ? 1 : 0, sales_no: stage === 'done' ? salesNo(n) : null,
        cancel_reason: stage === 'cancel' ? reasons[ci++ % 2] : null, created_at: iso(created), stage_at: iso(stageAt),
        closed_at: ['done', 'cancel'].includes(stage) ? iso(stageAt) : null, delete_req_by: null, delete_req_at: null, delete_req_reason: null,
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
      { id: db.seq.invoice_comments++, invoice_id: first, author: 'u-rep1', body: 'تمام، بلغته.', is_system: false, at: iso(now - 0.5 * DAY) },
      { id: db.seq.invoice_comments++, invoice_id: db.invoices[5].id, author: 'u-mgr', body: 'إرجاع للحسابات: نسبة الخصم عالية، راجعوها', is_system: true, at: iso(now - 3 * DAY) },
    );
    return db;
  }
  function isActiveStage(s) { return ['new', 'acc', 'decision'].includes(s) }

  let db;
  try { db = JSON.parse(store.get(KEY)) } catch (e) { db = null }
  if (!db || !db.invoices) db = seed();
  const save = () => store.set(KEY, JSON.stringify({ ...db, files: {} }));
  save();

  // ---------- الجلسة ----------
  let session = store.get(SKEY);
  if (session && !db.profiles.some(p => p.id === session)) session = null;
  const me = () => db.profiles.find(p => p.id === session);
  const has = r => { const u = me(); return !!u && u.active && u.roles.includes(r) };
  const active = () => { const u = me(); return !!u && u.active };
  const err = (message, code) => ({ data: null, error: { message, code } });

  // ---------- الصلاحيات (نفس policies بالقاعدة) ----------
  const canRead = {
    invoices: i => has('admin') || has('mgr') || has('acc') || (has('wh') && ['decision', 'done'].includes(i.stage)) || (has('rep') && i.rep_id === session),
    invoice_costs: () => has('admin'),
    profiles: p => active() || p.id === session,
    customers: () => active(),
    app_settings: () => active(),
  };
  const readable = (t, r) => {
    if (canRead[t]) return canRead[t](r);
    if (t === 'invoice_comments' || t === 'invoice_log' || t === 'invoice_stage_log') { const i = db.invoices.find(x => x.id === r.invoice_id); return !!i && canRead.invoices(i) }
    return active();
  };

  function addLog(id, body) { db.invoice_log.push({ id: db.seq.invoice_log++, invoice_id: id, actor: session, body, at: iso(Date.now()) }) }
  function stageLog(inv) { db.invoice_stage_log.push({ id: db.seq.invoice_stage_log++, invoice_id: inv.id, key: inv.stage === 'decision' ? 'decision:' + inv.sub : inv.stage, entered_at: iso(Date.now()) }) }

  const FIELD = { customer_id: 'الزبون', quote_no: 'رقم عرض السعر', res_no: 'رقم الحجز', value: 'قيمة الفاتورة', payment: 'طريقة السداد', credit_months: 'مدة الآجل',
    payer: 'النقل', transport_amt: 'أجور النقل', points: 'النقاط', ld: 'خصم لاحق', ld_pct: 'نسبة الخصم', notes: 'ملاحظات', pdf_path: 'ملف الـ PDF', rep_id: 'المندوب' };
  const BASIC = ['customer_id', 'customer', 'quote_no', 'res_no', 'value', 'pdf_path', 'pdf_name', 'pdf_size', 'rep_id'];
  const TERMS = ['payment', 'credit_months', 'payer', 'transport_amt', 'points', 'ld', 'ld_pct', 'notes'];

  function updateInvoice(inv, patch) {
    const keys = Object.keys(patch);
    const admin = has('admin');
    if (!admin) {
      const okBasic = inv.stage === 'new' && has('rep') && inv.rep_id === session;
      const okTerms = inv.stage === 'acc' && has('acc');
      for (const k of keys) {
        if (BASIC.includes(k) && !okBasic) return 'ما تكدر تعدل بيانات الطلب بهاي المرحلة';
        if (TERMS.includes(k) && !okTerms) return 'الشروط يعدلها المحاسب بمرحلة الحسابات';
        if (!BASIC.includes(k) && !TERMS.includes(k)) return 'ما عندك صلاحية';
      }
    }
    if ('customer_id' in patch) { const c = db.customers.find(x => x.id === patch.customer_id); if (c) patch.customer = c.name }
    Object.assign(inv, patch);
    keys.filter(k => FIELD[k]).forEach(k => addLog(inv.id, 'عدّل ' + FIELD[k]));
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
      if (this.op === 'select') return this.finish(this.rows());
      if (this.op === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload], out = [];
        for (const r0 of rows) {
          const r = { ...r0 };
          if (t === 'invoices') {
            if (!(has('admin') || (has('rep') && r.rep_id === session))) return err('new row violates row-level security policy for table "invoices"', '42501');
            const c = db.customers.find(x => x.id === r.customer_id);
            Object.assign(r, { id: ++db.seq.invoices, stage: 'new', sub: null, customer: c ? c.name : r.customer || '', points: 0, ld: false, cost_set: false, returned: 0,
              created_at: iso(Date.now()), stage_at: iso(Date.now()), closed_at: null, pdf_path: null, delete_req_at: null });
            db.invoices.push(r); addLog(r.id, 'أنشأ الطلب'); stageLog(r);
          } else if (t === 'customers') {
            if (!has('admin')) return err('ما عندك صلاحية', '42501');
            if (db.customers.some(c => c.name.trim().toLowerCase() === String(r.name).trim().toLowerCase())) return err('duplicate key value', '23505');
            Object.assign(r, { id: ++db.seq.customers, active: true, created_at: iso(Date.now()), phone: r.phone || '', notes: r.notes || '' });
            db.customers.push(r);
          } else if (t === 'invoice_comments') {
            const inv = db.invoices.find(x => x.id === r.invoice_id);
            if (!inv || !canRead.invoices(inv)) return err('ما عندك صلاحية', '42501');
            Object.assign(r, { id: db.seq.invoice_comments++, author: session, is_system: false, at: iso(Date.now()) });
            db.invoice_comments.push(r);
          } else return err('ما عندك صلاحية', '42501');
          out.push(r);
        }
        save();
        return this.ret ? (this.one ? { data: clone(out[0]), error: null } : { data: clone(out), error: null }) : { data: null, error: null };
      }
      if (this.op === 'upsert') {
        if (t !== 'app_settings' || !has('admin')) return err('ما عندك صلاحية', '42501');
        const r = db.app_settings.find(x => x.key === this.payload.key);
        if (r) Object.assign(r, this.payload); else db.app_settings.push({ ...this.payload });
        save(); return { data: null, error: null };
      }
      if (this.op === 'update') {
        const list = this.rows();
        for (const r of list) {
          if (t === 'invoices') { const e = updateInvoice(r, { ...this.payload }); if (e) return err(e, '42501') }
          else if (t === 'customers') { if (!has('admin')) return err('ما عندك صلاحية', '42501'); Object.assign(r, this.payload) }
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
        const ids = new Set(this.rows().map(r => r.id));
        if (t === 'customers' && db.invoices.some(i => ids.has(i.customer_id))) return err('الزبون مربوط بطلبات');
        db[t] = db[t].filter(r => !ids.has(r.id));
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
    return v;
  }
  const blank = s => String(s ?? '').trim() === '';
  function move(v, stage, sub, body) {
    v.stage = stage; v.sub = sub; v.stage_at = iso(Date.now());
    if (['done', 'cancel'].includes(stage)) v.closed_at = v.stage_at;
    stageLog(v); addLog(v.id, body);
  }
  function profitRows() {
    return db.invoices.map(i => {
      const c = db.invoice_costs.find(x => x.invoice_id === i.id); if (!c) return null;
      const total = (+i.value || 0) + (i.payer === 'customer' ? +i.transport_amt || 0 : 0);
      if (total <= 0) return null;
      const gross = (1 - c.cost / total) * 100, net = gross - (i.ld ? +i.ld_pct || 0 : 0) - (+i.points || 0) * 1.5;
      return { invoice_id: i.id, stage: i.stage, total, gross_pct: round2(gross), net_pct: round2(net) };
    }).filter(Boolean);
  }

  const RPC = {
    inv_send_to_acc({ p_id }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'new') throw new Error('الطلب مو بمرحلة طلب جديد');
      if (!(has('admin') || (has('rep') && v.rep_id === session))) throw new Error('ما عندك صلاحية');
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
      move(v, 'decision', 'mgr', 'أرسل الطلب للقرار'); return v;
    },
    inv_approve({ p_id }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'mgr') throw new Error('الطلب مو بانتظار موافقة المدير');
      if (!(has('mgr') || has('admin'))) throw new Error('الموافقة للمدير فقط');
      move(v, 'decision', 'cust', 'وافق المدير على الشروط'); return v;
    },
    inv_return_to_acc({ p_id, p_reason }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'mgr') throw new Error('الطلب مو بانتظار موافقة المدير');
      if (!(has('mgr') || has('admin'))) throw new Error('الإرجاع للمدير فقط');
      if (blank(p_reason)) throw new Error('سبب الإرجاع مطلوب');
      v.returned = (v.returned || 0) + 1;
      db.invoice_comments.push({ id: db.seq.invoice_comments++, invoice_id: v.id, author: session, body: 'إرجاع للحسابات: ' + p_reason, is_system: true, at: iso(Date.now()) });
      move(v, 'acc', null, 'أرجع الطلب للحسابات'); return v;
    },
    inv_customer_accept({ p_id }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'cust') throw new Error('الطلب مو بانتظار رد الزبون');
      if (!(has('mgr') || has('admin') || (has('rep') && v.rep_id === session))) throw new Error('ما عندك صلاحية');
      move(v, 'decision', 'wh', 'أكد موافقة الزبون'); return v;
    },
    inv_customer_refuse({ p_id, p_reason }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'cust') throw new Error('الطلب مو بانتظار رد الزبون');
      if (!(has('mgr') || has('admin') || (has('rep') && v.rep_id === session))) throw new Error('ما عندك صلاحية');
      if (blank(p_reason)) throw new Error('سبب الرفض مطلوب');
      v.cancel_reason = p_reason; move(v, 'cancel', null, 'سجل رفض الزبون وألغى الطلب'); return v;
    },
    inv_complete({ p_id, p_sales_no }) {
      const v = getInvFor(p_id);
      if (v.stage !== 'decision' || v.sub !== 'wh') throw new Error('الطلب مو بانتظار المخزن');
      if (!(has('wh') || has('mgr') || has('admin'))) throw new Error('التحويل للمخزن أو المدير');
      if (blank(p_sales_no)) throw new Error('رقم المبيعات مطلوب');
      v.sales_no = p_sales_no.trim(); move(v, 'done', null, 'حول الطلب لمبيعات برقم ' + v.sales_no); return v;
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
    inv_delete({ p_id }) {
      if (!has('admin')) throw new Error('الحذف للأدمن فقط');
      const v = getInvFor(p_id), path = v.pdf_path;
      ['invoice_comments', 'invoice_log', 'invoice_stage_log', 'invoice_costs'].forEach(t => db[t] = db[t].filter(r => r.invoice_id !== v.id));
      db.invoices = db.invoices.filter(r => r.id !== v.id);
      return path;
    },
    inv_profits({ p_ids }) {
      const ids = p_ids ? new Set(p_ids.map(Number)) : null;
      return profitRows().filter(p => (!ids || ids.has(p.invoice_id)) && (has('admin') || (has('mgr') && ['decision', 'done', 'cancel'].includes(p.stage))))
        .map(({ stage, ...p }) => p);
    },
    report_summary({ p_from, p_to }) {
      if (!(has('admin') || has('mgr'))) throw new Error('التقارير للأدمن والمدير');
      const from = new Date(p_from + 'T00:00').getTime(), to = new Date(p_to + 'T00:00').getTime() + DAY;
      const list = db.invoices.filter(i => { const t = new Date(i.created_at).getTime(); return t >= from && t < to });
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
    admin_list_logins() {
      if (!has('admin')) throw new Error('للأدمن فقط');
      return db.profiles.map(p => ({ id: p.id, login: db.logins[p.id] || '' }));
    },
    admin_create_user({ p_username, p_password, p_full_name, p_roles }) {
      if (!has('admin')) throw new Error('للأدمن فقط');
      if (!/^[a-z0-9._-]{3,}$/.test(p_username || '')) throw new Error('اسم المستخدم: أحرف إنجليزية صغيرة وأرقام فقط (3 أو أكثر)');
      if (Object.values(db.logins).includes(p_username)) throw new Error('اسم المستخدم موجود');
      if ((p_password || '').length < 8) throw new Error('الرمز لازم 8 أحرف على الأقل');
      if (!p_roles || !p_roles.length) throw new Error('لازم دور واحد على الأقل');
      const id = 'u-' + Math.random().toString(36).slice(2, 9);
      db.profiles.push({ id, full_name: p_full_name, roles: p_roles, role: p_roles[0], active: true, created_at: iso(Date.now()) });
      db.logins[id] = p_username; return id;
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
