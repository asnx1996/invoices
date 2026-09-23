import { S, ROLES, rolesText, changed } from './state.js';
import { sb, rpc, loadProfiles, saveSetting } from './api.js';
import { $, esc, ic, ask, toast, genPw, cur, setCurrency } from './util.js';
import { backupNow } from './backup.js';

let LOGINS = {};

export async function renderUsers() {
  $('#setCur').value = cur();
  const { data } = await sb.rpc('admin_list_logins');
  LOGINS = Object.fromEntries((data || []).map(r => [r.id, r.login]));
  $('#usersTbl').innerHTML = `<thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الأدوار</th><th>مفعّل</th><th></th></tr></thead><tbody>${S.PROFILES.map(u => {
    const me = u.id === S.ME.id, roles = u.roles || [];
    return `<tr class="${u.active ? '' : 'off'}">
    <td>${esc(u.full_name) || '<span class="help">بدون اسم</span>'}</td>
    <td dir="ltr" style="text-align:end">${esc(LOGINS[u.id] || '—')}</td>
    <td><div class="roles">${Object.entries(ROLES).map(([k, v]) =>
      `<label class="role-chk"><input type="checkbox" data-urole="${esc(u.id)}" value="${k}" ${roles.includes(k) ? 'checked' : ''} ${me && k === 'admin' ? 'disabled' : ''}>${v}</label>`).join('')}</div></td>
    <td><label class="toggle"><input type="checkbox" data-uact="${esc(u.id)}" ${u.active ? 'checked' : ''} ${me ? 'disabled' : ''}>${u.active ? 'فعال' : 'موقوف'}</label></td>
    <td><button class="btn sm" data-upw="${esc(u.id)}">${ic('key')}تغيير الرمز</button></td></tr>`;
  }).join('')}</tbody>`;

  const P = [['إنشاء طلب', '✓', '—', '—', '—'], ['يشوف الطلبات', 'طلباته', 'الكل', 'الكل', 'القرار + تمت'],
    ['السداد والتوصيل والنقاط والكلفة', '—', '✓', '—', '—'], ['يشوف الربح', '—', '—', '✓ (بدون الكلفة)', '—'],
    ['موافقة / إرجاع', '—', '—', '✓', '—'], ['تأشير رد الزبون', 'طلباته', '—', '✓', '—'], ['رقم المبيعات', '—', '—', '✓', '✓'],
    ['طلب حذف', '✓', '✓', '✓', '✓'], ['تصدير Excel', '—', '✓', '✓', '—'], ['التقارير', '—', '—', '✓', '—']];
  $('#permTbl').innerHTML = `<thead><tr><th>الإجراء</th><th>مندوب</th><th>محاسب</th><th>مدير</th><th>مخزن</th></tr></thead><tbody>${P.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
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
  $('#addUserBtn').onclick = () => ask('مستخدم جديد', [
    { id: 'n', label: 'الاسم الكامل', type: 'text', req: true },
    { id: 'u', label: 'اسم المستخدم (إنجليزي، مثل ali.hassan)', type: 'text', req: true },
    { id: 'p', label: 'الرمز (8 أحرف أو أكثر)', type: 'text', req: true, value: genPw() },
    { id: 'r', label: 'الأدوار (تكدر تختار أكثر من واحد)', type: 'checks', opts: ROLES, value: ['rep'], req: true },
  ], async v => {
    const login = v.u.toLowerCase();
    const r = await rpc('admin_create_user', { p_username: login, p_password: v.p, p_full_name: v.n, p_roles: v.r });
    if (!r.ok) return;
    await refresh(); showCreds('انسوى الحساب ✓ (' + rolesText(v.r) + ')', login, v.p);
  });
  $('#backupBtn').onclick = backupNow;

  $('#usersTbl').addEventListener('change', async e => {
    const t = e.target;
    let id, patch;
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
