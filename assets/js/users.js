import { S, ROLES, rolesText, changed } from './state.js';
import { sb, rpc, loadProfiles, loadBoards, saveSetting } from './api.js';
import { $, esc, ic, ask, toast, genPw, cur, setCurrency, rate, setRate, num } from './util.js';
import { backupNow } from './backup.js';
import { avatarHTML, openAvatarPicker } from './avatars.js';

let LOGINS = {};

export async function renderUsers() {
  $('#setCur').value = cur();
  $('#setRate').value = rate();
  const { data } = await sb.rpc('admin_list_logins');
  LOGINS = Object.fromEntries((data || []).map(r => [r.id, r.login]));
  const boards = S.BOARDS || [];
  $('#usersTbl').innerHTML = `<thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الأدوار</th>${boards.length ? '<th>البوردات</th>' : ''}<th>مفعّل</th><th></th></tr></thead><tbody>${S.PROFILES.map(u => {
    const me = u.id === S.ME.id, roles = u.roles || [];
    const brd = !boards.length ? '' : roles.includes('admin') ? '<td><span class="help">الأدمن يشوف الكل</span></td>'
      : `<td><div class="roles">${boards.map(b => `<label class="role-chk"><input type="checkbox" data-ubrd="${esc(u.id)}" value="${b.id}" ${S.MEMBERS.some(m => m.board_id === b.id && m.user_id === u.id) ? 'checked' : ''}>${esc(b.name)}</label>`).join('')}</div></td>`;
    return `<tr class="${u.active ? '' : 'off'}">
    <td><span class="u-name"><button type="button" class="u-av" data-uav="${esc(u.id)}" aria-label="تغيير صورة ${esc(u.full_name)}" title="تغيير الصورة">${avatarHTML(u, 32)}</button>${esc(u.full_name) || '<span class="help">بدون اسم</span>'}</span></td>
    <td dir="ltr" style="text-align:end">${esc(LOGINS[u.id] || '—')}</td>
    <td><div class="roles">${Object.entries(ROLES).map(([k, v]) =>
      `<label class="role-chk"><input type="checkbox" data-urole="${esc(u.id)}" value="${k}" ${roles.includes(k) ? 'checked' : ''} ${me && k === 'admin' ? 'disabled' : ''}>${v}</label>`).join('')}</div></td>${brd}
    <td><label class="toggle"><input type="checkbox" data-uact="${esc(u.id)}" ${u.active ? 'checked' : ''} ${me ? 'disabled' : ''}>${u.active ? 'فعال' : 'موقوف'}</label></td>
    <td><button class="btn sm" data-upw="${esc(u.id)}">${ic('key')}تغيير الرمز</button></td></tr>`;
  }).join('')}</tbody>`;

  renderBoards();

  const P = [['إنشاء طلب', '✓', '—', '—', '—'], ['يشوف الطلبات', 'طلباته', 'الكل', 'الكل', 'القرار + تمت'],
    ['السداد والتوصيل والنقاط والكلفة', '—', '✓', '—', '—'], ['يشوف الربح', '—', '—', '✓ (بدون الكلفة)', '—'],
    ['موافقة / إرجاع', '—', '—', '✓', '—'], ['تأشير رد الزبون', 'طلباته', '—', '✓', '—'], ['رقم المبيعات', '—', '—', '✓', '✓'],
    ['طلب حذف', '✓', '✓', '✓', '✓'], ['تصدير Excel', '—', '✓', '✓', '—'], ['التقارير', '—', '—', '✓', '—']];
  $('#permTbl').innerHTML = `<thead><tr><th>الإجراء</th><th>مندوب</th><th>محاسب</th><th>مدير</th><th>مخزن</th></tr></thead><tbody>${P.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

function renderBoards() {
  $('#boardsPanel').classList.toggle('hidden', !S.BOARDS);
  if (!S.BOARDS) return;
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
    { id: 'r', label: 'الأدوار (تكدر تختار أكثر من واحد)', type: 'checks', opts: ROLES, value: ['rep'], req: true },
    ...(S.BOARDS && S.BOARDS.length ? [{ id: 'b', label: 'البوردات اللي يشوفها', type: 'checks', req: true,
      opts: Object.fromEntries(S.BOARDS.map(b => [b.id, b.name])), value: [String(S.board)] }] : []),
  ], async v => {
    const login = v.u.toLowerCase();
    const r = await rpc('admin_create_user', { p_username: login, p_password: v.p, p_full_name: v.n, p_roles: v.r,
      ...(v.b ? { p_boards: v.b.map(Number) } : {}) });
    if (!r.ok) return;
    if (v.b) await loadBoards();
    await refresh(); showCreds('انسوى الحساب ✓ (' + rolesText(v.r) + ')', login, v.p);
  });
  $('#backupBtn').onclick = backupNow;

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
      const roles = [...document.querySelectorAll(`[data-urole="${CSS.escape(id)}"]:checked`)].map(x => x.value);
      if (!roles.length) { t.checked = true; return toast('لازم دور واحد على الأقل') }
      patch = { roles };
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
