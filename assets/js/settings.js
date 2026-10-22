// صفحة الإعدادات: قائمة أقسام على الجنب وكل قسم بمكانه
//   عام (العملة، سعر الصرف، النسخة الاحتياطية) · المستخدمين · الأدوار والصلاحيات · البوردات · مراحل الطلب · الحقول الإلزامية
// صاحب صلاحية "إدارة المستخدمين" (مو أدمن) يشوف قسم المستخدمين بس
import { S, ROLES, PERMS, PERM_GROUPS, REQ_FIELDS, COLS, rolesText, roleName, hasRole, isReq, changed, stepInfo, isBuiltinStep } from './state.js';
import { sb, rpc, loadProfiles, loadBoards, loadRoleDefs, saveSetting, loadStageCounts } from './api.js';
import { $, esc, ic, ask, toast, genPw, cur, setCurrency, rate, setRate, num } from './util.js';
import { can } from './can.js';
import { backupNow } from './backup.js';
import { avatarHTML, openAvatarPicker } from './avatars.js';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch (e) { return d } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } };

let sec = load('ib_set_sec', 'users');
let LOGINS = {}, COUNTS = {};
let openUser = null, uq = '', uRole = '', showOff = false;
let selRole = null, permView = load('ib_perm_view', 'role');

const admin = () => hasRole('admin');
const SECTIONS = [
  { g: 'عام', k: 'general', t: 'عام', d: 'العملة وسعر الصرف والنسخة الاحتياطية', i: 'sliders', ok: admin },
  { g: 'الفريق', k: 'users', t: 'المستخدمين', d: 'الحسابات وأدوار كل موظف', i: 'users', ok: () => can('users') },
  { g: 'الفريق', k: 'roles', t: 'الأدوار والصلاحيات', d: 'شنو يكدر يسوي كل دور', i: 'shield', ok: admin },
  { g: 'الفريق', k: 'boards', t: 'البوردات', d: 'البوردات وأعضاءها', i: 'board', ok: () => admin() && !!S.BOARDS },
  { g: 'سير العمل', k: 'stages', t: 'مراحل الطلب', d: 'ترتيب المراحل وتشغيلها', i: 'flow', ok: admin },
  { g: 'سير العمل', k: 'fields', t: 'الحقول الإلزامية', d: 'شنو لازم ينكتب قبل الإرسال', i: 'list', ok: () => admin() && S.HAS_ROLEDEFS },
];
const visible = () => SECTIONS.filter(s => s.ok());

// ---------------------------------------------------------------- أدوات الرسم
const head = (t, d, acts = '') => `<div class="set-head"><div class="set-head-t"><h3>${t}</h3>${d ? `<p class="help">${d}</p>` : ''}</div>${acts ? `<div class="set-acts">${acts}</div>` : ''}</div>`;
const sw = (attrs, on, label, dis = false) => `<label class="sw"><input type="checkbox" role="switch" ${attrs} ${on ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${esc(label)}"><span class="sw-ui" aria-hidden="true"></span></label>`;
const row = (t, d, ctl, cls = '') => `<div class="set-row ${cls}"><div class="set-row-t"><b>${t}</b>${d ? `<span class="help">${d}</span>` : ''}</div><div class="set-row-c">${ctl}</div></div>`;
const warn = t => `<div class="set-warn">${t}</div>`;

// كل الأدوار اللي تنعطى للمستخدم: الأساسية (roles) + اللي سواها الأدمن (xroles)
const BUILTIN = ['rep', 'acc', 'mgr', 'wh'];
const roleOpts = () => {
  const o = Object.fromEntries([...BUILTIN, ...S.ROLEDEFS.filter(d => !d.builtin).map(d => d.key)].map(k => [k, roleName(k)]));
  if (admin()) o.admin = ROLES.admin;   // دور الأدمن ينطيه الأدمن بس
  return o;
};
const splitRoles = keys => ({ roles: keys.filter(k => BUILTIN.includes(k) || k === 'admin'), xroles: keys.filter(k => !BUILTIN.includes(k) && k !== 'admin') });
const userKeys = u => [...(u.roles || []), ...(u.xroles || [])];
const roleUsers = key => S.PROFILES.filter(p => userKeys(p).includes(key));

// ---------------------------------------------------------------- الهيكل
// بعد ما تتحمل البوردات أو الأدوار ممكن تبين أقسام جديدة: نعيد القائمة بس (القسم المفتوح ما يتغير حتى ما يضيع اللي يكتبه)
let navKey = '';
export function refreshSettingsNav() {
  if (visible().map(s => s.k).join() !== navKey) renderSettings();
}

export async function renderSettings() {
  const list = visible();
  navKey = list.map(s => s.k).join();
  if (!list.some(s => s.k === sec)) sec = (list[0] || {}).k;
  const groups = [...new Set(list.map(s => s.g))];
  $('#setNav').innerHTML = groups.map(g => `<div class="set-ng"><div class="set-ng-t">${g}</div>${list.filter(s => s.g === g).map(s =>
    `<button type="button" class="set-nb" data-sec="${s.k}" ${s.k === sec ? 'aria-current="page"' : ''}><span class="set-ni">${ic(s.i)}</span><span>${s.t}</span></button>`).join('')}</div>`).join('');
  $('#setPick').innerHTML = list.map(s => `<option value="${s.k}" ${s.k === sec ? 'selected' : ''}>${s.g} · ${s.t}</option>`).join('');
  $('#setPick').classList.toggle('hidden', list.length < 2);
  $('#viewSettings').classList.toggle('one', list.length < 2);
  await paint(true);
}

// fresh: نعيد تحميل اللي يحتاجه القسم (الرموز، عدد الطلبات بالمراحل)
async function paint(fresh = false) {
  const m = $('#setMain');
  if (!sec) { m.innerHTML = ''; return }
  if (fresh && sec === 'users') {
    const { data } = await sb.rpc('admin_list_logins');
    LOGINS = Object.fromEntries((data || []).map(r => [r.id, r.login]));
  }
  if (fresh && sec === 'stages') COUNTS = await loadStageCounts() || {};
  const a = document.activeElement, focusSel = a && m.contains(a) && a.id ? '#' + CSS.escape(a.id) : null;
  m.innerHTML = ({ general: generalHTML, users: usersHTML, roles: rolesHTML, boards: boardsHTML, stages: stagesHTML, fields: fieldsHTML })[sec]();
  if (focusSel) { const f = $(focusSel); f && f.focus({ preventScroll: true }) }
}

function go(k) {
  if (k === sec) return;
  sec = k; keep('ib_set_sec', k);
  document.querySelectorAll('.set-nb').forEach(b => b.dataset.sec === k ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $('#setPick').value = k;
  paint(true);
  $('#setMain').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---------------------------------------------------------------- عام
function generalHTML() {
  return head('عام', 'إعدادات تمشي على كل المستخدمين')
    + `<div class="set-card">
      ${row('العملة', 'تطلع جنب كل المبالغ بالموقع', `<input type="text" id="setCur" list="curList" maxlength="10" autocomplete="off" value="${esc(cur())}" aria-label="العملة">
        <datalist id="curList"><option value="د.ع"><option value="$"><option value="IQD"><option value="USD"><option value="€"></datalist>
        <button class="btn primary sm" id="setCurBtn">حفظ</button>`)}
      ${row('سعر صرف الدولار', 'بالدينار. إذا المندوب كتب القيمة بالدينار تنقسم عليه وتنحفظ بالدولار', `<input type="text" id="setRate" inputmode="decimal" autocomplete="off" dir="ltr" value="${esc(rate())}" aria-label="سعر صرف الدولار">
        <button class="btn primary sm" id="setRateBtn">حفظ</button>`)}
    </div>
    <div class="set-card">${row('نسخة احتياطية', 'كل الجداول بملف Excel ينحفظ على جهازك', `<button class="btn sm" id="backupBtn">${ic('download')}نسخة احتياطية الآن</button>`)}</div>`;
}

// ---------------------------------------------------------------- المستخدمين
function usersHTML() {
  const keys = Object.keys(roleOpts());
  const off = S.PROFILES.filter(u => !u.active).length;
  const q = uq.trim().toLowerCase();
  const list = S.PROFILES.filter(u => (showOff || u.active || u.id === openUser)
    && (!uRole || userKeys(u).includes(uRole))
    && (!q || [u.full_name, LOGINS[u.id]].join(' ').toLowerCase().includes(q)));
  return head('المستخدمين', 'سوّي حساب لكل موظف وانطيه دور أو أكثر (مثلاً مندوب + محاسب). اضغط على أي شخص حتى تعدله.',
    `<button class="btn primary" id="addUserBtn">${ic('plus')}مستخدم جديد</button>`)
    + `<div class="u-tools">
      <div class="search"><svg class="i"><use href="#ic-search"/></svg><input type="search" id="uQ" value="${esc(uq)}" placeholder="بحث بالاسم أو اسم المستخدم" aria-label="بحث بالمستخدمين" autocomplete="off"></div>
      <div class="u-filters" role="group" aria-label="فلترة حسب الدور">
        <button type="button" class="u-f" data-urf="" aria-pressed="${!uRole}">الكل <span>${S.PROFILES.filter(u => showOff || u.active).length}</span></button>
        ${keys.map(k => { const n = S.PROFILES.filter(u => (showOff || u.active) && userKeys(u).includes(k)).length;
          return n ? `<button type="button" class="u-f" data-urf="${esc(k)}" aria-pressed="${uRole === k}">${esc(roleName(k))} <span>${n}</span></button>` : '' }).join('')}
      </div>
      ${off ? `<label class="chk"><input type="checkbox" id="uOff" ${showOff ? 'checked' : ''}> الموقوفين (${off})</label>` : ''}
    </div>
    <div class="u-list">${list.map(userHTML).join('') || '<div class="empty">ماكو نتائج</div>'}</div>`;
}

function userHTML(u) {
  const me = u.id === S.ME.id, roles = u.roles || [], keys = userKeys(u), isAdm = roles.includes('admin');
  const lock = !admin() && (isAdm || me);   // غير الأدمن ما يلمس الأدمن ولا يغير أدواره هو
  const open = openUser === u.id, boards = S.BOARDS || [];
  const myBoards = boards.filter(b => S.MEMBERS.some(m => m.board_id === b.id && m.user_id === u.id));
  const chips = keys.map(k => `<span class="u-chip${k === 'admin' ? ' adm' : ''}">${esc(roleName(k))}</span>`).join('');
  const sum = `<button type="button" class="u-sum" data-uopen="${esc(u.id)}" aria-expanded="${open}" aria-controls="ud-${esc(u.id)}">
      ${avatarHTML(u, 38)}
      <span class="u-id"><b>${esc(u.full_name) || '<span class="help">بدون اسم</span>'}${me ? ' <span class="u-me">أنت</span>' : ''}</b><span class="u-login" dir="ltr">${esc(LOGINS[u.id] || '—')}</span></span>
      <span class="u-chips">${chips}</span>
      ${boards.length > 1 ? `<span class="u-brd help">${isAdm ? 'كل البوردات' : myBoards.length ? esc(myBoards.map(b => b.name).join('، ')) : 'بدون بورد'}</span>` : ''}
      <span class="u-st ${u.active ? 'on' : 'off'}">${u.active ? 'فعّال' : 'موقوف'}</span>${ic('chev')}</button>`;
  if (!open) return `<div class="u-row${u.active ? '' : ' off'}">${sum}</div>`;
  const rOpts = isAdm && !admin() ? { admin: ROLES.admin } : roleOpts();
  return `<div class="u-row open${u.active ? '' : ' off'}">${sum}
    <div class="u-det" id="ud-${esc(u.id)}">
      ${lock ? `<p class="help" style="margin:0">${isAdm ? 'حسابات الأدمن يعدلها الأدمن بس.' : 'ما تكدر تغير أدوارك أو توقف حسابك.'}</p>` : ''}
      <div class="u-blk"><div class="u-lbl">الأدوار</div><div class="roles">${Object.entries(rOpts).map(([k, v]) =>
        `<label class="role-chk"><input type="checkbox" data-urole="${esc(u.id)}" value="${esc(k)}" ${keys.includes(k) ? 'checked' : ''} ${lock || (me && k === 'admin') ? 'disabled' : ''}>${esc(v)}</label>`).join('')}</div></div>
      ${boards.length ? `<div class="u-blk"><div class="u-lbl">البوردات</div>${isAdm ? '<span class="help">الأدمن يشوف كل البوردات</span>' : `<div class="roles">${boards.map(b =>
        `<label class="role-chk"><input type="checkbox" data-ubrd="${esc(u.id)}" value="${b.id}" ${myBoards.includes(b) ? 'checked' : ''} ${lock ? 'disabled' : ''}>${esc(b.name)}</label>`).join('')}</div>`}</div>` : ''}
      <div class="u-blk u-acts">
        <label class="sw-l">${sw(`data-uact="${esc(u.id)}"`, u.active, 'الحساب فعّال', me || lock)}<span>${u.active ? 'الحساب فعّال' : 'الحساب موقوف'}</span></label>
        <span class="spacer"></span>
        ${lock && !me ? '' : `<button class="btn sm" data-uav="${esc(u.id)}">${ic('image')}الصورة</button>`}
        ${admin() ? `<button class="btn sm" data-uname="${esc(u.id)}">${ic('edit')}الاسم</button>` : ''}
        ${lock && !me ? '' : `<button class="btn sm" data-upw="${esc(u.id)}">${ic('key')}تغيير الرمز</button>`}
      </div>
    </div></div>`;
}

// ---------------------------------------------------------------- الأدوار والصلاحيات
// صلاحيات الخطوات الإضافية (مثل التدقيق) تطلع ويا "سير الطلب"
const stepPerms = () => S.STEPS.filter(e => !isBuiltinStep(e.k)).map(e => {
  const s = stepInfo(e.k);
  return [e.k, 'مرحلة ' + s.t, (s.back ? 'يكمل الطلب بهاي المرحلة أو يرجعه للحسابات' : 'يكمل الطلب بهاي المرحلة') + (s.on ? '' : ' — المرحلة مطفية هسه')];
});
const permRows = g => [...g[2].map(p => [p, ...PERMS[p]]), ...(g[0] === 'سير الطلب' ? stepPerms() : [])];
const permTitle = p => (PERMS[p] || [stepInfo(p).t])[0];

function rolesHTML() {
  if (!S.HAS_ROLEDEFS) return head('الأدوار والصلاحيات', '') + warn('هذا القسم يحتاج تشغيل ملف القاعدة 018 أول.');
  const defs = S.ROLEDEFS;
  if (!defs.some(d => d.key === selRole)) selRole = (defs[0] || {}).key;
  const seg = `<div class="seg" role="group" aria-label="طريقة العرض">
      <button type="button" class="seg-b" data-pview="role" aria-pressed="${permView === 'role'}">حسب الدور</button>
      <button type="button" class="seg-b" data-pview="grid" aria-pressed="${permView === 'grid'}">جدول الكل</button></div>`;
  const h = head('الأدوار والصلاحيات', 'المستخدم ياخذ صلاحيات كل أدواره مجموعة. الأدمن عنده كلشي دائماً. التغيير يمشي على المستخدم من يحدّث الصفحة.',
    seg + `<button class="btn primary" id="addRoleBtn">${ic('plus')}دور جديد</button>`);
  return h + (permView === 'grid' ? gridHTML(defs) : roleEditHTML(defs));
}

function roleEditHTML(defs) {
  const d = defs.find(x => x.key === selRole);
  const tabs = defs.map(x => {
    const n = roleUsers(x.key).length;
    return `<button type="button" class="r-tab" role="tab" data-rsel="${esc(x.key)}" aria-selected="${x.key === selRole}">
      <b>${esc(x.name)}</b><span class="help">${n} مستخدم · ${x.perms.filter(p => p in PERMS || /^s_/.test(p)).length} صلاحية</span></button>`;
  }).join('') + `<div class="r-tab r-adm"><b>${ROLES.admin}</b><span class="help">كل الصلاحيات دائماً</span></div>`;
  if (!d) return `<div class="r-wrap"><div class="r-list" role="tablist" aria-label="الأدوار">${tabs}</div></div>`;
  const members = roleUsers(d.key);
  const groups = PERM_GROUPS.map(g => {
    const rows = permRows(g);
    const on = rows.filter(r => d.perms.includes(r[0])).length;
    return `<div class="set-card"><div class="g-h"><div><b>${g[0]}</b><span class="help">${g[1]}</span></div><span class="g-n">${on} / ${rows.length}</span></div>
      ${rows.map(([p, t, hlp]) => row(esc(t), hlp ? esc(hlp) : '', sw(`data-rperm="${esc(d.key)}" value="${esc(p)}"`, d.perms.includes(p), d.name + ': ' + t))).join('')}</div>`;
  }).join('');
  return `<div class="r-wrap">
    <div class="r-list" role="tablist" aria-label="الأدوار">${tabs}</div>
    <div class="r-edit" role="tabpanel" aria-label="${esc(d.name)}">
      <div class="r-top"><h4>${esc(d.name)}</h4>${d.builtin ? '<span class="u-chip">أساسي</span>' : ''}<span class="spacer"></span>
        <button class="btn sm" data-rren="${esc(d.key)}">${ic('edit')}تغيير الاسم</button>
        ${d.builtin ? '' : `<button class="btn sm bad" data-rdel="${esc(d.key)}">${ic('trash')}حذف الدور</button>`}</div>
      <div class="r-mem">${members.length ? members.map(p => `<span class="r-m">${avatarHTML(p, 24)}${esc(p.full_name)}</span>`).join('') : '<span class="help">محد عنده هذا الدور بعد — انطيه للموظفين من قسم المستخدمين</span>'}</div>
      ${groups}
    </div></div>`;
}

function gridHTML(defs) {
  return `<div class="set-card flush"><div class="tbl-wrap"><table class="perm perm-edit">
    <thead><tr><th>الصلاحية</th>${defs.map(d => `<th>${esc(d.name)}</th>`).join('')}<th>${ROLES.admin}</th></tr></thead>
    <tbody>${PERM_GROUPS.map(g => `<tr class="perm-g"><th colspan="${defs.length + 2}">${g[0]}</th></tr>${permRows(g).map(([p, t, hlp]) => `<tr><td><b>${esc(t)}</b>${hlp ? `<div class="help">${esc(hlp)}</div>` : ''}</td>${defs.map(d =>
      `<td><input type="checkbox" class="perm-chk" data-rperm="${esc(d.key)}" value="${esc(p)}" ${d.perms.includes(p) ? 'checked' : ''} aria-label="${esc(d.name)}: ${esc(t)}"></td>`).join('')}<td class="perm-all">${ic('check')}</td></tr>`).join('')}`).join('')}</tbody>
  </table></div></div>`;
}

// ---------------------------------------------------------------- البوردات
const boardMembers = id => S.PROFILES.filter(p => p.active && !(p.roles || []).includes('admin') && S.MEMBERS.some(m => m.board_id === id && m.user_id === p.id));

function boardsHTML() {
  return head('البوردات', 'كل بورد معزول بطلباته. الأدمن يشوف كل البوردات، والباقين يشوفون البوردات اللي هم أعضاء بيها.',
    `<button class="btn primary" id="addBoardBtn">${ic('plus')}بورد جديد</button>`)
    + `<div class="b-grid">${S.BOARDS.map(b => {
      const ms = boardMembers(b.id);
      return `<div class="set-card b-card"><div class="b-top"><span class="b-ic">${ic('board')}</span><b>${esc(b.name)}</b></div>
        <div class="b-av">${ms.slice(0, 7).map(p => `<span title="${esc(p.full_name)}">${avatarHTML(p, 28)}</span>`).join('')}${ms.length > 7 ? `<span class="b-more">+${ms.length - 7}</span>` : ''}</div>
        <span class="help">${ms.length ? ms.length + ' عضو' : 'ماكو أعضاء (بس الأدمن)'}</span>
        <div class="b-acts"><button class="btn sm" data-bmem="${b.id}">${ic('users')}الأعضاء</button><button class="btn sm" data-brename="${b.id}">${ic('edit')}تغيير الاسم</button></div></div>`;
    }).join('')}</div>`;
}

// ---------------------------------------------------------------- مراحل الطلب
function stagesHTML() {
  const off = !S.HAS_STAGES;
  const steps = S.STEPS;
  const flow = [COLS[0].t, COLS[1].t, ...steps.filter(e => e.on !== false).map(e => stepInfo(e.k).t), COLS[3].t];
  const fixed = (c, who, extra = '') => `<li class="st-row fixed"><span class="st-dot" style="background:${c.c}"></span>
    <div class="st-t"><b>${c.t}</b><span class="help">${who}</span></div>${extra}<span class="st-lock" title="مرحلة ثابتة">${ic('lock')}</span></li>`;
  const items = steps.map((e, i) => {
    const s = stepInfo(e.k), n = COUNTS[e.k] || 0, custom = !isBuiltinStep(e.k);
    return `<li class="st-row${s.on ? '' : ' is-off'}">
      <div class="st-move"><button type="button" class="icon-btn sm" data-smove="${i}" data-dir="-1" ${i === 0 || off ? 'disabled' : ''} aria-label="رفع ${esc(s.t)}">${ic('up')}</button>
        <button type="button" class="icon-btn sm st-down" data-smove="${i}" data-dir="1" ${i === steps.length - 1 || off ? 'disabled' : ''} aria-label="تنزيل ${esc(s.t)}">${ic('up')}</button></div>
      <span class="st-dot" style="background:${s.c}"></span>
      <div class="st-t"><span class="st-tt"><b>${esc(s.t)}</b>${custom ? '<span class="u-chip">إضافية</span>' : ''}${custom && s.back ? '<span class="u-chip">ترجع للحسابات</span>' : ''}</span>
        <span class="help">${s.on ? 'يكملها: ' + esc(s.who) : 'مطفية — الطلبات ما تمر بيها'}</span></div>
      ${n ? `<span class="st-n" title="طلبات شغالة بهاي المرحلة بكل البوردات">${n} طلب</span>` : ''}
      <button type="button" class="icon-btn sm" data-sedit="${esc(e.k)}" ${off ? 'disabled' : ''} aria-label="تعديل ${esc(s.t)}" title="تعديل">${ic('edit')}</button>
      ${custom ? `<button type="button" class="icon-btn sm st-del" data-sdel="${esc(e.k)}" ${off ? 'disabled' : ''} aria-label="حذف ${esc(s.t)}" title="حذف">${ic('trash')}</button>` : ''}
      ${sw(`data-son="${esc(e.k)}"`, s.on, 'تشغيل مرحلة ' + s.t, off)}</li>`;
  }).join('');
  return head('مراحل الطلب', 'المراحل اللي يمر بيها الطلب بعد الحسابات. رتّبها بالأسهم، طفّي اللي ما تحتاجه شركتك، أو ضيف مرحلة جديدة مثل التدقيق.',
    `<button class="btn primary" id="addStepBtn" ${off ? 'disabled' : ''}>${ic('plus')}مرحلة جديدة</button>`)
    + (off ? warn('التحكم بالمراحل يحتاج تشغيل ملف القاعدة <b>022_stages.sql</b> أول. لحد ذاك الطلب يمشي: قرار المدير ← رد الزبون ← المخزن.') : '')
    + `<div class="st-flow" aria-label="مسار الطلب">${flow.map(t => `<span>${esc(t)}</span>`).join(ic('chev'))}</div>
    <ol class="st-list">
      ${fixed(COLS[0], 'المندوب يكمل البيانات')}
      ${fixed(COLS[1], 'المحاسب يضيف السداد والكلفة')}
      ${items}
      <li class="st-row fixed"><span class="st-dot" style="background:var(--ok)"></span><div class="st-t"><b>تمت / ملغاة</b><span class="help">آخر مرحلة مفعّلة تكمل الطلب</span></div><span class="st-lock">${ic('lock')}</span></li>
    </ol>
    <p class="help">الطلب الموجود بمرحلة تطفيها يبقى بمكانه ويكمل منها عادي، بس الطلبات الجديدة ما تمر بيها. الصلاحية على المراحل الإضافية تنعطى من <button type="button" class="link-btn inline" data-sec="roles">الأدوار والصلاحيات</button>.</p>`;
}

async function saveSteps(list, msg) {
  if (!await saveSetting('stages', JSON.stringify(list))) return false;
  S.STEPS = list; changed(); toast(msg); paint(true);
  return true;
}

// تنطي الأدوار المختارة صلاحية الخطوة. اللي ما يشوف طلبات القرار ينضاف له "يشوف طلبات القرار والمكتملة"
async function grantStep(k, keys) {
  for (const d of S.ROLEDEFS) {
    const has = d.perms.includes(k), want = keys.includes(d.key);
    if (has === want) continue;
    let perms = want ? [...d.perms, k] : d.perms.filter(p => p !== k);
    if (want && !perms.includes('see_all') && !perms.includes('see_late')) perms.push('see_late');
    const { error } = await sb.from('role_defs').update({ perms }).eq('key', d.key);
    if (error) { toast(error.message); continue }
    d.perms = perms;
  }
}

function addStep() {
  const steps = S.STEPS;
  const pos = `<option value="-1">أول وحدة بعد الحسابات</option>` + steps.map((e, i) => `<option value="${i}" ${i === steps.findIndex(x => x.k === 'cust') ? 'selected' : ''}>بعد ${esc(stepInfo(e.k).t)}</option>`).join('');
  const roles = Object.fromEntries(S.ROLEDEFS.map(d => [d.key, d.name]));
  ask('مرحلة جديدة', [
    { id: 'n', label: 'اسم المرحلة (مثل: التدقيق)', type: 'text', req: true },
    { id: 'p', label: 'مكانها', type: 'select', opts: pos },
    { id: 'r', label: 'منو يكملها؟', type: 'checks', opts: roles, help: 'تكدر تغيرها بعدين من الأدوار والصلاحيات. الأدمن يكدر دائماً' },
    { id: 'b', label: 'خيارات', type: 'checks', opts: { back: 'يكدر يرجع الطلب للحسابات' }, value: ['back'] },
  ], async v => {
    if (v.n.length > 30) return toast('الاسم لازم 30 حرف أو أقل');
    const k = 's_' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 4);
    const list = steps.slice();
    list.splice(+v.p + 1, 0, { k, n: v.n, on: true, back: v.b.includes('back') });
    if (!await saveSteps(list, `انضافت مرحلة "${v.n}"`)) return;
    if (v.r.length) { await grantStep(k, v.r); changed(); paint() }
  }, { okText: 'إضافة' });
}

function editStep(k) {
  const s = stepInfo(k), custom = !isBuiltinStep(k), e = S.STEPS.find(x => x.k === k) || {};
  const roles = Object.fromEntries(S.ROLEDEFS.map(d => [d.key, d.name]));
  ask('تعديل مرحلة ' + s.t, [
    { id: 'n', label: 'الاسم', type: 'text', req: custom, value: e.n || '', help: custom ? '' : 'يطلع عنوان للعمود باللوحة. اتركه فارغ حتى يرجع الاسم الأصلي' },
    ...(custom ? [
      { id: 'r', label: 'منو يكملها؟', type: 'checks', opts: roles, value: S.ROLEDEFS.filter(d => d.perms.includes(k)).map(d => d.key) },
      { id: 'b', label: 'خيارات', type: 'checks', opts: { back: 'يكدر يرجع الطلب للحسابات' }, value: e.back ? ['back'] : [] }] : []),
  ], async v => {
    if (v.n.length > 30) return toast('الاسم لازم 30 حرف أو أقل');
    const list = S.STEPS.map(x => {
      if (x.k !== k) return x;
      const y = { ...x };
      if (v.n) y.n = v.n; else delete y.n;
      if (custom) y.back = v.b.includes('back');
      return y;
    });
    if (!await saveSteps(list, 'انحفظت المرحلة')) return;
    if (custom) { await grantStep(k, v.r); changed(); paint() }
  }, { okText: 'حفظ' });
}

// ---------------------------------------------------------------- الحقول الإلزامية
function fieldsHTML() {
  const grp = { new: ['الطلب الجديد', 'المندوب لازم يكتبها قبل ما يرسل للحسابات'], acc: ['الحسابات', 'المحاسب لازم يكتبها قبل ما يرسل للقرار'] };
  return head('الحقول الإلزامية', 'المشغّل إلزامي: الطلب ما ينرسل للمرحلة الجاية بدونه. طفّيه حتى يصير اختياري.')
    + Object.entries(grp).map(([g, [t, d]]) => `<div class="set-card"><div class="g-h"><div><b>${t}</b><span class="help">${d}</span></div></div>
      ${Object.entries(REQ_FIELDS).filter(([, f]) => f[1] === g).map(([k, f]) => row(esc(f[0]), f[2] === 'in' ? 'اختياري من الأصل' : '', sw(`data-req="${k}"`, isReq(k), f[0]))).join('')}</div>`).join('');
}

// ---------------------------------------------------------------- إجراءات مشتركة
async function refreshRoles() { await loadRoleDefs(); changed(); paint() }
async function refreshBoards() { await loadBoards(); changed(); if (!$('#viewSettings').classList.contains('hidden')) paint() }
async function refreshUsers() { await loadProfiles(); paint() }

export function addBoard() {
  ask('بورد جديد', [{ id: 'n', label: 'اسم البورد (مثل: المنطقة الجنوبية)', type: 'text', req: true }], async v => {
    const { error } = await sb.from('boards').insert({ name: v.n.trim() });
    if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو بورد بنفس الاسم' : error.message);
    toast('انسوى البورد. حدد أعضاءه من الإعدادات ← البوردات');
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

function addUser() {
  ask('مستخدم جديد', [
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
    await loadProfiles();
    const { data } = await sb.rpc('admin_list_logins');
    LOGINS = Object.fromEntries((data || []).map(x => [x.id, x.login]));
    openUser = Object.keys(LOGINS).find(id => LOGINS[id] === login) || null;
    paint(); showCreds('انسوى الحساب ✓ (' + rolesText(roles, xroles) + ')', login, v.p);
  });
}

async function togglePerm(t) {
  const d = S.ROLEDEFS.find(x => x.key === t.dataset.rperm); if (!d) return;
  let perms = t.checked ? [...new Set([...d.perms, t.value])] : d.perms.filter(p => p !== t.value);
  // صاحب مرحلة إضافية لازم يشوف طلبات القرار حتى يكدر يكملها
  const addSee = t.checked && /^s_/.test(t.value) && !perms.includes('see_all') && !perms.includes('see_late');
  if (addSee) perms.push('see_late');
  // طلبات كل المندوبين بلا ما يشوفها ما إلها معنى
  const addAll = t.checked && t.value === 'rep_all' && !perms.includes('see_all');
  if (addAll) perms.push('see_all');
  const { error } = await sb.from('role_defs').update({ perms }).eq('key', d.key);
  if (error) { t.checked = !t.checked; return toast(error.message) }
  d.perms = perms; changed();
  toast(`${d.name}: ${t.checked ? 'انضافت' : 'انشالت'} "${permTitle(t.value)}"${addSee ? ' + يشوف طلبات القرار' : ''}${addAll ? ' + يشوف كل الطلبات' : ''}`);
  paint();
}

export function initSettings() {
  $('#setNav').addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (b) go(b.dataset.sec) });
  $('#setPick').addEventListener('change', e => go(e.target.value));
  const m = $('#setMain');

  m.addEventListener('input', e => {
    if (e.target.id === 'uQ') { uq = e.target.value; const pos = e.target.selectionStart; paint(); const q = $('#uQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos) } }
  });

  m.addEventListener('click', async e => {
    const t = e.target.closest('button,[data-sec]'); if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.sec) return go(d.sec);
    // عام
    if (t.id === 'setCurBtn') {
      const v = $('#setCur').value.trim();
      if (!v) return toast('اكتب العملة');
      if (!await saveSetting('currency', v)) return;
      setCurrency(v); changed(); return toast('صارت العملة: ' + v);
    }
    if (t.id === 'setRateBtn') {
      const v = num($('#setRate').value);
      if (v <= 0) return toast('اكتب سعر صرف صحيح، مثل 1650');
      if (!await saveSetting('usd_rate', String(v))) return;
      setRate(v); changed(); return toast('صار سعر الصرف: ' + v);
    }
    if (t.id === 'backupBtn') return backupNow();
    // المستخدمين
    if (t.id === 'addUserBtn') return addUser();
    if (d.uopen) { openUser = openUser === d.uopen ? null : d.uopen; paint(); const b = $(`[data-uopen="${CSS.escape(d.uopen)}"]`); b && b.focus({ preventScroll: true }); return }
    if ('urf' in d) { uRole = d.urf; return paint() }
    if (d.uav) return openAvatarPicker(d.uav);
    if (d.uname) {
      const u = S.PROFILES.find(p => p.id === d.uname) || {};
      return ask('تغيير الاسم', [{ id: 'n', label: 'الاسم الكامل', type: 'text', req: true, value: u.full_name || '' }], async v => {
        const { error } = await sb.from('profiles').update({ full_name: v.n }).eq('id', u.id);
        if (error) return toast(error.message);
        toast('تغير الاسم'); await loadProfiles(); changed(); paint();
      });
    }
    if (d.upw) {
      const u = S.PROFILES.find(p => p.id === d.upw) || {};
      return ask('تغيير رمز: ' + (u.full_name || ''), [{ id: 'p', label: 'الرمز الجديد (8 أحرف أو أكثر)', type: 'text', req: true, value: genPw() }], async v => {
        const r = await rpc('admin_set_password', { p_user: u.id, p_password: v.p });
        if (!r.ok) return;
        if (u.id === S.ME.id) return toast('تغير رمزك');
        showCreds('تغير الرمز ✓', LOGINS[u.id] || '', v.p);
      });
    }
    // الأدوار
    if (t.id === 'addRoleBtn') return ask('دور جديد', [{ id: 'n', label: 'اسم الدور (مثل: مشرف مبيعات)', type: 'text', req: true,
      help: 'بعدين شغّل صلاحياته، وانطيه للموظفين من قسم المستخدمين' }], async v => {
      const key = 'r_' + Date.now().toString(36);
      const { error } = await sb.from('role_defs').insert({ key, name: v.n.trim(), perms: [] });
      if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو دور بنفس الاسم' : error.message);
      selRole = key; permView = 'role'; toast('انسوى الدور. شغّل صلاحياته'); refreshRoles();
    }, { okText: 'إنشاء' });
    if (d.pview) { permView = d.pview; keep('ib_perm_view', permView); return paint() }
    if (d.rsel) { selRole = d.rsel; paint(); const b = $(`[data-rsel="${CSS.escape(d.rsel)}"]`); b && b.focus({ preventScroll: true }); return }
    if (d.rren || d.rdel) {
      const r = S.ROLEDEFS.find(x => x.key === (d.rren || d.rdel)); if (!r) return;
      if (d.rren) return ask('تغيير اسم الدور', [{ id: 'n', label: 'الاسم', type: 'text', req: true, value: r.name }], async v => {
        const { error } = await sb.from('role_defs').update({ name: v.n.trim() }).eq('key', r.key);
        if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو دور بنفس الاسم' : error.message);
        toast('تغير الاسم'); refreshRoles();
      });
      const n = roleUsers(r.key).length;
      return ask('حذف دور ' + r.name, [], async () => {
        const { error } = await sb.from('role_defs').delete().eq('key', r.key);
        if (error) return toast(error.message);
        selRole = null; toast('انحذف الدور'); await loadProfiles(); refreshRoles();
      }, { okText: 'حذف', danger: true, msg: n ? `ينشال من ${n} مستخدم. اللي ما عنده دور ثاني يبقى بدون صلاحيات.` : 'محد عنده هذا الدور.' });
    }
    // البوردات
    if (t.id === 'addBoardBtn') return addBoard();
    if (d.brename) {
      const id = +d.brename, name = (S.BOARDS.find(x => x.id === id) || {}).name || '';
      return ask('تغيير اسم البورد', [{ id: 'n', label: 'الاسم', type: 'text', req: true, value: name }], async v => {
        const { error } = await sb.from('boards').update({ name: v.n.trim() }).eq('id', id);
        if (error) return toast(/duplicate|unique/i.test(error.message) ? 'أكو بورد بنفس الاسم' : error.message);
        toast('تغير الاسم'); refreshBoards();
      });
    }
    if (d.bmem) {
      const id = +d.bmem, b = S.BOARDS.find(x => x.id === id) || {};
      const people = S.PROFILES.filter(p => p.active && !(p.roles || []).includes('admin'));
      const cur = boardMembers(id).map(p => p.id);
      return ask('أعضاء ' + b.name, [{ id: 'm', label: 'منو يشوف هذا البورد؟', type: 'checks', opts: Object.fromEntries(people.map(p => [p.id, p.full_name])), value: cur,
        help: 'الأدمن يشوف كل البوردات بدون عضوية' }], async v => {
        let bad = 0;
        for (const p of people) {
          const was = cur.includes(p.id), now = v.m.includes(p.id);
          if (was === now) continue;
          const { error } = now ? await sb.from('board_members').insert({ board_id: id, user_id: p.id })
            : await sb.from('board_members').delete().eq('board_id', id).eq('user_id', p.id);
          if (error) bad++;
        }
        toast(bad ? `ما انحفظ ${bad} تغيير` : 'انحفظ الأعضاء'); refreshBoards();
      }, { okText: 'حفظ' });
    }
    // المراحل
    if (t.id === 'addStepBtn') return addStep();
    if (d.smove) {
      const i = +d.smove, j = i + +d.dir, list = S.STEPS.slice();
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await saveSteps(list, 'تغير ترتيب المراحل');
      const b = $(`[data-smove="${j}"][data-dir="${d.dir}"]`) || $(`[data-smove="${j}"]`); b && b.focus({ preventScroll: true });
      return;
    }
    if (d.sedit) return editStep(d.sedit);
    if (d.sdel) {
      const s = stepInfo(d.sdel), n = COUNTS[d.sdel] || 0;
      if (n) return toast(`مرحلة "${s.t}" بيها ${n} طلب — انقلها لمرحلة ثانية أو طفّي المرحلة بدل الحذف`);
      return ask('حذف مرحلة ' + s.t, [], () => saveSteps(S.STEPS.filter(x => x.k !== d.sdel), `انحذفت مرحلة "${s.t}"`),
        { okText: 'حذف', danger: true, msg: 'المرحلة تنشال من المسار وصلاحيتها تنشال من الأدوار.' });
    }
  });

  m.addEventListener('change', async e => {
    const t = e.target, d = t.dataset;
    if (t.id === 'uOff') { showOff = t.checked; return paint() }
    if (d.rperm) return togglePerm(t);
    if (d.son) {
      const k = d.son, s = stepInfo(k), n = COUNTS[k] || 0, on = t.checked;
      const list = S.STEPS.map(x => x.k === k ? { ...x, on } : x);
      const apply = () => saveSteps(list, `${on ? 'اشتغلت' : 'انطفت'} مرحلة "${s.t}"`).then(ok => { if (!ok) t.checked = !on });
      if (!on && n) {
        t.checked = true;
        return ask('إطفاء مرحلة ' + s.t, [], apply, { okText: 'إطفاء', msg: `بيها ${n} طلب هسه. يبقون بمكانهم ويكملون منها، بس الطلبات الجديدة ما تمر بيها.` });
      }
      return apply();
    }
    if (d.req) {
      const k = d.req, optIn = REQ_FIELDS[k][2] === 'in';
      const set = new Set(optIn ? S.REQX : S.OPT);
      (t.checked === optIn) ? set.add(k) : set.delete(k);
      if (!await saveSetting(optIn ? 'req_fields' : 'opt_fields', [...set].join(','))) { t.checked = !t.checked; return }
      if (optIn) S.REQX = set; else S.OPT = set;
      changed();
      return toast(`${REQ_FIELDS[k][0]}: صار ${t.checked ? 'إلزامي' : 'اختياري'}`);
    }
    if (d.ubrd) {
      const uid = d.ubrd, bid = +t.value;
      const { error } = t.checked
        ? await sb.from('board_members').insert({ board_id: bid, user_id: uid })
        : await sb.from('board_members').delete().eq('board_id', bid).eq('user_id', uid);
      if (error) toast(error.message); else toast(t.checked ? 'انضاف للبورد' : 'انشال من البورد');
      return refreshBoards();
    }
    let id, patch;
    if (d.urole) {
      id = d.urole;
      const keys = [...document.querySelectorAll(`[data-urole="${CSS.escape(id)}"]:checked`)].map(x => x.value);
      if (!keys.length) { t.checked = true; return toast('لازم دور واحد على الأقل') }
      patch = splitRoles(keys);
      if (!S.HAS_ROLEDEFS) delete patch.xroles; // قبل 018
    } else if (d.uact) { id = d.uact; patch = { active: t.checked } }
    else return;
    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) { toast(error.message); return refreshUsers() }
    toast(patch.active === false ? 'انوقف الحساب وطلع من كل أجهزته' : 'تم التحديث');
    refreshUsers();
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
