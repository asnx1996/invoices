import { S, ROLES, PERMS, REQ_FIELDS, rolesText, roleName, hasRole, isReq, changed } from './state.js';
import { sb, rpc, loadProfiles, loadBoards, loadRoleDefs, saveSetting } from './api.js';
import { $, esc, ic, ask, toast, genPw, cur, setCurrency, rate, setRate, num } from './util.js';
import { backupNow } from './backup.js';
import { avatarHTML, openAvatarPicker } from './avatars.js';

let LOGINS = {};

// كل الأدوار اللي تنعطى للمستخدم: الأساسية (roles) + اللي سواها الأدمن (xroles)
const BUILTIN = ['rep', 'acc', 'mgr', 'wh'];
const roleOpts = () => {
  const o = Object.fromEntries([...BUILTIN, ...S.ROLEDEFS.filter(d => !d.builtin).map(d => d.key)].map(k => [k, roleName(k)]));
  if (hasRole('admin')) o.admin = ROLES.admin;   // دور الأدمن ينطيه الأدمن بس
  return o;
};
const splitRoles = keys => ({ roles: keys.filter(k => BUILTIN.includes(k) || k === 'admin'), xroles: keys.filter(k => !BUILTIN.includes(k) && k !== 'admin') });

export async function renderUsers() {
  const admin = hasRole('admin');
  $('#setCur').value = cur();
  $('#setRate').value = rate();
  // صاحب صلاحية المستخدمين (مو أدمن) يدير الحسابات بس — الإعدادات والبوردات والصلاحيات للأدمن
  ['#settingsPanel', '#backupBtn'].forEach(s => $(s).classList.toggle('hidden', !admin));
  const { data } = await sb.rpc('admin_list_logins');
  LOGINS = Object.fromEntries((data || []).map(r => [r.id, r.login]));
  const boards = S.BOARDS || [], opts = roleOpts();
  $('#usersTbl').innerHTML = `<thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الأدوار</th>${boards.length ? '<th>البوردات</th>' : ''}<th>مفعّل</th><th></th></tr></thead><tbody>${S.PROFILES.map(u => {
    const me = u.id === S.ME.id, roles = u.roles || [], keys = [...roles, ...(u.xroles || [])], isAdm = roles.includes('admin');
    const lock = !admin && (isAdm || me);   // غير الأدمن ما يلمس الأدمن ولا يغير أدواره هو
    const brd = !boards.length ? '' : isAdm ? '<td><span class="help">الأدمن يشوف الكل</span></td>'
      : `<td><div class="roles">${boards.map(b => `<label class="role-chk"><input type="checkbox" data-ubrd="${esc(u.id)}" value="${b.id}" ${S.MEMBERS.some(m => m.board_id === b.id && m.user_id === u.id) ? 'checked' : ''} ${lock ? 'disabled' : ''}>${esc(b.name)}</label>`).join('')}</div></td>`;
    const rOpts = isAdm && !admin ? { admin: ROLES.admin } : opts;
    return `<tr class="${u.active ? '' : 'off'}">
    <td><span class="u-name"><button type="button" class="u-av" data-uav="${esc(u.id)}" aria-label="تغيير صورة ${esc(u.full_name)}" title="تغيير الصورة" ${lock && !me ? 'disabled' : ''}>${avatarHTML(u, 32)}</button>${esc(u.full_name) || '<span class="help">بدون اسم</span>'}</span></td>
    <td dir="ltr" style="text-align:end">${esc(LOGINS[u.id] || '—')}</td>
    <td><div class="roles">${Object.entries(rOpts).map(([k, v]) =>
      `<label class="role-chk"><input type="checkbox" data-urole="${esc(u.id)}" value="${esc(k)}" ${keys.includes(k) ? 'checked' : ''} ${lock || (me && k === 'admin') ? 'disabled' : ''}>${esc(v)}</label>`).join('')}</div></td>${brd}
    <td><label class="toggle"><input type="checkbox" data-uact="${esc(u.id)}" ${u.active ? 'checked' : ''} ${me || lock ? 'disabled' : ''}>${u.active ? 'فعال' : 'موقوف'}</label></td>
    <td>${lock && !me ? '' : `<button class="btn sm" data-upw="${esc(u.id)}">${ic('key')}تغيير الرمز</button>`}</td></tr>`;
  }).join('')}</tbody>`;

  renderBoards();
  renderPerms();
  renderReq();
}

// مصفوفة الصلاحيات: صف لكل صلاحية، عمود لكل دور. تنحفظ مباشرة (الأدمن)
function renderPerms() {
  const on = hasRole('admin') && S.HAS_ROLEDEFS;
  $('#permPanel').classList.toggle('hidden', !on);
  if (!on) return;
  const defs = S.ROLEDEFS;
  $('#permTbl').innerHTML = `<thead><tr><th>الصلاحية</th>${defs.map(d => `<th><div class="perm-role"><button type="button" class="link-btn" data-rren="${esc(d.key)}" title="تغيير الاسم">${esc(d.name)}</button>
      ${d.builtin ? '' : `<button type="button" class="icon-btn sm perm-del" data-rdel="${esc(d.key)}" aria-label="حذف دور ${esc(d.name)}" title="حذف الدور">${ic('trash')}</button>`}</div></th>`).join('')}<th>${ROLES.admin}</th></tr></thead>
    <tbody>${Object.entries(PERMS).map(([p, [t, h]]) => `<tr><td><b>${esc(t)}</b>${h ? `<div class="help">${esc(h)}</div>` : ''}</td>${defs.map(d =>
      `<td><input type="checkbox" class="perm-chk" data-rperm="${esc(d.key)}" value="${p}" ${d.perms.includes(p) ? 'checked' : ''} aria-label="${esc(d.name)}: ${esc(t)}"></td>`).join('')}<td class="perm-all">${ic('check')}</td></tr>`).join('')}</tbody>`;
}

function renderReq() {
  const on = hasRole('admin') && S.HAS_ROLEDEFS;
  $('#reqPanel').classList.toggle('hidden', !on);
  if (!on) return;
  const grp = { new: 'الطلب الجديد (المندوب)', acc: 'الحسابات (المحاسب)' };
  $('#reqList').innerHTML = Object.entries(grp).map(([g, t]) => `<div><div class="help" style="margin-bottom:6px">${t}</div><div class="roles">${Object.entries(REQ_FIELDS).filter(([, f]) => f[1] === g)
    .map(([k, f]) => `<label class="role-chk"><input type="checkbox" data-req="${k}" ${isReq(k) ? 'checked' : ''}>${esc(f[0])}</label>`).join('')}</div></div>`).join('');
}

async function refreshRoles() { await loadRoleDefs(); changed(); renderUsers() }

function renderBoards() {
  $('#boardsPanel').classList.toggle('hidden', !S.BOARDS || !hasRole('admin'));
  if (!S.BOARDS || !hasRole('admin')) return;
  const members = b => S.PROFILES.filter(p => p.active && !(p.roles || []).includes('admin') && S.MEMBERS.some(m => m.board_id === b && m.user_id === p.id));
  $('#boardsTbl').innerHTML = `<thead><tr><th>البورد</th><th>الأعضاء</th><th></th></tr></thead><tbody>${S.BOARDS.map(b => {
    const ms = members(b.id);
    return `<tr><td><b>${esc(b.name)}</b></td>
    <td>${ms.length ? esc(ms.map(p => p.full_name).join('، ')) : '<span class="help">ماكو أعضاء (بس الأدمن)</span>'}</td>
    <td><button class="btn sm" data-brename="${b.id}">تغيير الاسم</button></td></tr>`;
  }).join('')}</tbody>`;
}

async function refreshBoards() { await loadBoards(); changed(); if (!$('#viewUsers').classList.contains('hidden')) renderUsers() }

export function addBoard() {
  ask('بورد جديد', [{ id: 'n', label: 'اسم البورد (مثل: المنطقة الجنوبية)', type: 'text', req: true }], async v => {
    const { error } = await sb.from('boards').insert({ name: v.n.trim() });
    if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو بورد بنفس الاسم' : error.message);
    toast('انسوى البورد. أشّر المستخدمين اللي يشوفوه من صفحة المستخدمين');
    refreshBoards();
  }, { okText: 'إنشاء' });
}

// يعرض بيانات الدخول مرة وحدة حتى الأدمن ينطيها للموظف
function showCreds(title, login, pw) {
  ask(title, [], () => { });
  $('#mBody').innerHTML = `<p style="margin:0">انطي هاي البيانات للموظف. الرمز ما يظهر مرة ثانية.</p>
    <div class="panel" style="margin:0;direction:ltr;text-align:left">
      <div>Username: <b>${esc(login)}</b></div><div>Password: <b>${esc(pw)}</b></div></div>
    <button type="button" class="btn sm" id="copyCreds">نسخ</button>`;
  $('#copyCreds').onclick = () => navigator.clipboard.writeText(`اسم المستخدم: ${login}\nالرمز: ${pw}\n${location.origin + location.pathname}`)
    .then(() => toast('انّسخت'), () => toast('ما انّسخت، انسخها يدوي'));
}

async function refresh() { await loadProfiles(); renderUsers() }

export function initUsers() {
  $('#setCurBtn').onclick = async () => {
    const v = $('#setCur').value.trim();
    if (!v) return toast('اكتب العملة');
    if (!await saveSetting('currency', v)) return;
    setCurrency(v); changed(); toast('صارت العملة: ' + v);
  };
  $('#setRateBtn').onclick = async () => {
    const v = num($('#setRate').value);
    if (v <= 0) return toast('اكتب سعر صرف صحيح، مثل 1650');
    if (!await saveSetting('usd_rate', String(v))) return;
    setRate(v); changed(); toast('صار سعر الصرف: ' + v);
  };
  $('#addUserBtn').onclick = () => ask('مستخدم جديد', [
    { id: 'n', label: 'الاسم الكامل', type: 'text', req: true },
    { id: 'u', label: 'اسم المستخدم (إنجليزي، مثل ali.hassan)', type: 'text', req: true },
    { id: 'p', label: 'الرمز (8 أحرف أو أكثر)', type: 'text', req: true, value: genPw() },
    { id: 'r', label: 'الأدوار (تكدر تختار أكثر من واحد)', type: 'checks', opts: roleOpts(), value: ['rep'], req: true },
    ...(S.BOARDS && S.BOARDS.length ? [{ id: 'b', label: 'البوردات اللي يشوفها', type: 'checks', req: true,
      opts: Object.fromEntries(S.BOARDS.map(b => [b.id, b.name])), value: [String(S.board)] }] : []),
  ], async v => {
    const login = v.u.toLowerCase(), { roles, xroles } = splitRoles(v.r);
    const r = await rpc('admin_create_user', { p_username: login, p_password: v.p, p_full_name: v.n, p_roles: roles,
      ...(v.b ? { p_boards: v.b.map(Number) } : {}), ...(xroles.length ? { p_xroles: xroles } : {}) });
    if (!r.ok) return;
    if (v.b) await loadBoards();
    await refresh(); showCreds('انسوى الحساب ✓ (' + rolesText(roles, xroles) + ')', login, v.p);
  });
  $('#backupBtn').onclick = backupNow;

  // الأدوار والصلاحيات (الأدمن): دور جديد، تأشير صلاحية، تغيير اسم، حذف
  $('#addRoleBtn').onclick = () => ask('دور جديد', [{ id: 'n', label: 'اسم الدور (مثل: مشرف مبيعات)', type: 'text', req: true,
    help: 'بعدين أشّر صلاحياته من الجدول، وانطيه للمستخدمين من عمود الأدوار' }], async v => {
    const { error } = await sb.from('role_defs').insert({ key: 'r_' + Date.now().toString(36), name: v.n.trim(), perms: [] });
    if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو دور بنفس الاسم' : error.message);
    toast('انسوى الدور. أشّر صلاحياته من الجدول'); refreshRoles();
  }, { okText: 'إنشاء' });
  $('#permTbl').addEventListener('change', async e => {
    const t = e.target.closest('[data-rperm]'); if (!t) return;
    const d = S.ROLEDEFS.find(x => x.key === t.dataset.rperm); if (!d) return;
    const perms = t.checked ? [...new Set([...d.perms, t.value])] : d.perms.filter(p => p !== t.value);
    const { error } = await sb.from('role_defs').update({ perms }).eq('key', d.key);
    if (error) { t.checked = !t.checked; return toast(error.message) }
    d.perms = perms; changed();
    toast(`${d.name}: ${t.checked ? 'انضافت' : 'انشالت'} "${PERMS[t.value][0]}"`);
  });
  $('#permTbl').addEventListener('click', e => {
    const ren = e.target.closest('[data-rren]'), del = e.target.closest('[data-rdel]');
    const key = ren ? ren.dataset.rren : del ? del.dataset.rdel : null;
    const d = key && S.ROLEDEFS.find(x => x.key === key); if (!d) return;
    if (ren) return ask('تغيير اسم الدور', [{ id: 'n', label: 'الاسم', type: 'text', req: true, value: d.name }], async v => {
      const { error } = await sb.from('role_defs').update({ name: v.n.trim() }).eq('key', d.key);
      if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو دور بنفس الاسم' : error.message);
      toast('تغير الاسم'); refreshRoles();
    });
    const n = S.PROFILES.filter(p => (p.xroles || []).includes(d.key)).length;
    ask('حذف دور ' + d.name, [], async () => {
      const { error } = await sb.from('role_defs').delete().eq('key', d.key);
      if (error) return toast(error.message);
      toast('انحذف الدور'); await loadProfiles(); refreshRoles();
    }, { okText: 'حذف', danger: true, msg: n ? `ينشال من ${n} مستخدم. اللي ما عنده دور ثاني يبقى بدون صلاحيات.` : 'محد عنده هذا الدور.' });
  });
  // الحقول الإلزامية: المؤشّر إلزامي، والباقي ينحفظ بـ opt_fields
  $('#reqList').addEventListener('change', async e => {
    const t = e.target.closest('[data-req]'); if (!t) return;
    const opt = new Set(S.OPT); t.checked ? opt.delete(t.dataset.req) : opt.add(t.dataset.req);
    if (!await saveSetting('opt_fields', [...opt].join(','))) { t.checked = !t.checked; return }
    S.OPT = opt; changed();
    toast(`${REQ_FIELDS[t.dataset.req][0]}: صار ${t.checked ? 'إلزامي' : 'اختياري'}`);
  });

  $('#addBoardBtn').onclick = addBoard;
  $('#boardsTbl').addEventListener('click', e => {
    const b = e.target.closest('[data-brename]'); if (!b) return;
    const id = +b.dataset.brename, cur = (S.BOARDS.find(x => x.id === id) || {}).name || '';
    ask('تغيير اسم البورد', [{ id: 'n', label: 'الاسم', type: 'text', req: true, value: cur }], async v => {
      const { error } = await sb.from('boards').update({ name: v.n.trim() }).eq('id', id);
      if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو بورد بنفس الاسم' : error.message);
      toast('تغير الاسم'); refreshBoards();
    });
  });

  $('#usersTbl').addEventListener('change', async e => {
    const t = e.target;
    let id, patch;
    if (t.dataset.ubrd) {
      const uid = t.dataset.ubrd, bid = +t.value;
      const { error } = t.checked
        ? await sb.from('board_members').insert({ board_id: bid, user_id: uid })
        : await sb.from('board_members').delete().eq('board_id', bid).eq('user_id', uid);
      if (error) toast(error.message); else toast(t.checked ? 'انضاف للبورد' : 'انشال من البورد');
      return refreshBoards();
    }
    if (t.dataset.urole) {
      id = t.dataset.urole;
      const keys = [...document.querySelectorAll(`[data-urole="${CSS.escape(id)}"]:checked`)].map(x => x.value);
      if (!keys.length) { t.checked = true; return toast('لازم دور واحد على الأقل') }
      patch = splitRoles(keys);
      if (!S.HAS_ROLEDEFS) delete patch.xroles; // قبل 018
    } else if (t.dataset.uact) { id = t.dataset.uact; patch = { active: t.checked } }
    else return;
    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) { toast(error.message); return refresh() }
    toast(patch.active === false ? 'انوقف الحساب وطلع من كل أجهزته' : 'تم التحديث');
    refresh();
  });

  $('#usersTbl').addEventListener('click', e => {
    const av = e.target.closest('[data-uav]');
    if (av) return openAvatarPicker(av.dataset.uav);
    const b = e.target.closest('[data-upw]'); if (!b) return;
    const id = b.dataset.upw, u = S.PROFILES.find(p => p.id === id) || {};
    ask('تغيير رمز: ' + (u.full_name || ''), [{ id: 'p', label: 'الرمز الجديد (8 أحرف أو أكثر)', type: 'text', req: true, value: genPw() }], async v => {
      const r = await rpc('admin_set_password', { p_user: id, p_password: v.p });
      if (!r.ok) return;
      if (id === S.ME.id) return toast('تغير رمزك');
      showCreds('تغير الرمز ✓', LOGINS[id] || '', v.p);
    });
  });

  // أي مستخدم يغير رمزه
  $('#pwBtn').onclick = () => ask('تغيير رمزي', [
    { id: 'p', label: 'الرمز الجديد (8 أحرف أو أكثر)', type: 'password', req: true },
    { id: 'c', label: 'أعد كتابة الرمز', type: 'password', req: true }], async v => {
    if (v.p.length < 8) return toast('الرمز لازم 8 أحرف على الأقل');
    if (v.p !== v.c) return toast('الرمزين مو متطابقين');
    const { error } = await sb.auth.updateUser({ password: v.p });
    toast(error ? error.message : 'تغير رمزك');
  });
}
