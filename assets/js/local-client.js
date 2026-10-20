// عميل للسيرفر المحلي (desktop/server) بنفس شكل supabase-js اللي تستخدمه الواجهة:
// from().select().eq()... / rpc / auth / storage / channel — حتى باقي الملفات ما تتغير.
const TOKEN_KEY = 'ib_local_token';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch (e) { } };

export function createLocalClient(base) {
  const listeners = new Set();
  const fire = (event, session) => listeners.forEach(cb => { try { cb(event, session) } catch (e) { console.error(e) } });
  const session = () => getToken() ? { access_token: getToken() } : null;

  async function post(path, body, raw) {
    let res;
    try {
      res = await fetch(base + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + getToken(), ...(raw ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }) },
        body: raw ? body : JSON.stringify(body ?? {}),
      });
    } catch (e) { return { data: null, error: { message: 'ما كدرت أوصل للسيرفر — تأكد إن الحاسبة الرئيسية شغالة' } } }
    let j = {};
    try { j = await res.json() } catch (e) { }
    if (res.status === 401 && getToken()) { setToken(''); closeEvents(); fire('SIGNED_OUT', null) }
    return j.error ? { data: null, error: j.error } : { data: j.data ?? null, error: null };
  }

  // ------------------------------------------------------------ الاستعلامات
  class Query {
    constructor(table) { this.q = { table, op: 'select', filters: [], or: [], order: [] }; this.mode = null }
    select(columns = '*') { if (this.q.op === 'select') this.q.columns = columns; else this.q.columns = columns; this.returning = true; return this }
    insert(values) { this.q.op = 'insert'; this.q.values = values; return this }
    upsert(values) { this.q.op = 'upsert'; this.q.values = values; return this }
    update(values) { this.q.op = 'update'; this.q.values = values; return this }
    delete() { this.q.op = 'delete'; return this }
    f(col, op, val) { this.q.filters.push({ col, op, val }); return this }
    eq(c, v) { return this.f(c, 'eq', v) }
    neq(c, v) { return this.f(c, 'neq', v) }
    gt(c, v) { return this.f(c, 'gt', v) }
    gte(c, v) { return this.f(c, 'gte', v) }
    lt(c, v) { return this.f(c, 'lt', v) }
    lte(c, v) { return this.f(c, 'lte', v) }
    in(c, v) { return this.f(c, 'in', v) }
    is(c, v) { return this.f(c, 'is', v) }
    like(c, v) { return this.f(c, 'like', v) }
    ilike(c, v) { return this.f(c, 'ilike', v) }
    not(c, op, v) { if (op !== 'is') throw new Error('not: ' + op + ' غير مدعوم'); return this.f(c, 'not.is', v) }
    match(obj) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this }
    or(s) { this.q.or.push(s); return this }
    order(col, o = {}) { this.q.order.push({ col, asc: o.ascending !== false }); return this }
    range(a, b) { this.q.range = [a, b]; return this }
    limit(n) { this.q.limit = n; return this }
    single() { this.mode = 'single'; return this }
    maybeSingle() { this.mode = 'maybe'; return this }
    async run() {
      if (this.q.op !== 'select' && !this.returning) delete this.q.columns;
      const r = await post('/query', this.q);
      if (r.error) return r;
      let data = r.data;
      if (this.q.op !== 'select' && !this.returning) data = null;
      else if (this.mode) {
        if (data.length > 1 || (this.mode === 'single' && !data.length)) return { data: null, error: { message: 'المتوقع صف واحد' } };
        data = data[0] ?? null;
      }
      return { data, error: null };
    }
    then(ok, bad) { return this.run().then(ok, bad) }
  }

  // ------------------------------------------------------------ التحديث المباشر (SSE)
  let es = null;
  const chans = new Set();
  function openEvents() {
    if (es || !getToken() || !chans.size) return;
    es = new EventSource(base + '/events?token=' + encodeURIComponent(getToken()));
    es.addEventListener('invoice', e => { const d = JSON.parse(e.data); dispatch('invoices', { eventType: 'UPDATE', new: { id: d.id }, old: { id: d.id } }) });
    es.addEventListener('notification', e => dispatch('notifications', { eventType: 'INSERT', new: JSON.parse(e.data), old: {} }));
    es.addEventListener('kick', () => { setToken(''); closeEvents(); fire('SIGNED_OUT', null) });
  }
  function closeEvents() { if (es) { es.close(); es = null } }
  function dispatch(table, payload) {
    for (const ch of chans) for (const h of ch.handlers) if (h.table === table) { try { h.cb(payload) } catch (e) { console.error(e) } }
  }

  return {
    from: table => new Query(table),
    rpc: (fn, args) => post('/rpc/' + fn, args || {}),

    auth: {
      async getUser() {
        if (!getToken()) return { data: { user: null }, error: null };
        const r = await post('/auth/user');
        return { data: { user: (r.data && r.data.user) || null }, error: r.error };
      },
      async getSession() { return { data: { session: session() }, error: null } },
      async signInWithPassword({ email, password }) {
        const r = await post('/auth/login', { email, password });
        if (r.error) return { data: null, error: r.error };
        setToken(r.data.token);
        fire('SIGNED_IN', session());
        openEvents();
        return { data: { user: r.data.user, session: session() }, error: null };
      },
      async signOut() {
        if (getToken()) await post('/auth/logout');
        setToken(''); closeEvents();
        fire('SIGNED_OUT', null);
        return { error: null };
      },
      async updateUser({ password }) { return post('/auth/password', { password }) },
      onAuthStateChange(cb) {
        listeners.add(cb);
        setTimeout(() => cb('INITIAL_SESSION', session()), 0);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
    },

    storage: {
      from: () => ({
        async upload(path, file) {
          return post('/storage/upload?path=' + encodeURIComponent(path), file, true);
        },
        async remove(paths) { return post('/storage/remove', { paths }) },
        async createSignedUrl(path, expiresIn) {
          const r = await post('/storage/sign', { path, expiresIn });
          if (r.data) r.data.signedUrl = new URL(r.data.signedUrl, location.href).href;
          return r;
        },
      }),
    },

    channel() {
      const ch = {
        handlers: [],
        on(type, filter, cb) { ch.handlers.push({ table: filter.table, cb }); return ch },
        subscribe() { chans.add(ch); openEvents(); return ch },
      };
      return ch;
    },
    removeChannel(ch) { chans.delete(ch); if (!chans.size) closeEvents() },
  };
}
