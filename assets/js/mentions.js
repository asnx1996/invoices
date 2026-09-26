// المنشن: تكتب @ بالتعليق أو الملاحظات وتطلع قائمة الأشخاص اللي يكدرون يشوفون الطلب.
// الاختيار يكتب "@الاسم الكامل " والقاعدة (007) تطلع منه الإشعار.
import { S, getInv, rolesText } from './state.js';
import { esc } from './util.js';
import { avatarHTML } from './avatars.js';

// نفس منطق invoices_read: منو يكدر يشوف الطلب
export function canSee(p, inv) {
  const r = p.roles || [];
  if (!p.active || !inv) return false;
  return r.includes('admin') || r.includes('mgr') || r.includes('acc')
    || (r.includes('wh') && ['decision', 'done'].includes(inv.stage))
    || (r.includes('rep') && inv.rep_id === p.id);
}

// "@الاسم" داخل نص (بعد esc) يتلون
export function highlightMentions(html) {
  if (!html.includes('@')) return html;
  const names = S.PROFILES.map(p => (p.full_name || '').trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of names) {
    const e = esc(n);
    html = html.split('@' + e).join(`\u0000${e}\u0001`);
  }
  return html.replace(/\u0000([^\u0001]*)\u0001/g, '<span class="mention">@$1</span>');
}

let box = null, st = null; // st: {el, at, items, i}

function close() { if (box) box.classList.add('hidden'); st = null }

function query(el) {
  const v = el.value, caret = el.selectionStart ?? v.length;
  const before = v.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const q = before.slice(at + 1);
  if (q.length > 30 || /[\n@]/.test(q) || /\s{2}/.test(q)) return null;
  return { at, q };
}

function candidates(q) {
  const inv = getInv(S.drawerId);
  const k = q.trim().toLowerCase();
  return S.PROFILES
    .filter(p => p.id !== S.ME.id && canSee(p, inv) && (p.full_name || '').trim())
    .map(p => { const n = p.full_name.toLowerCase(), i = n.indexOf(k); return { p, score: !k ? 1 : i === 0 ? 0 : n.split(' ').some(w => w.startsWith(k)) ? 1 : i > 0 ? 2 : 9 } })
    .filter(x => x.score < 9)
    .sort((a, b) => a.score - b.score || a.p.full_name.localeCompare(b.p.full_name, 'ar'))
    .slice(0, 6).map(x => x.p);
}

function show(el, at, items) {
  if (!box) {
    box = document.createElement('div');
    box.className = 'mention-box hidden'; box.id = 'mentionBox'; box.setAttribute('role', 'listbox');
    document.body.appendChild(box);
    box.addEventListener('mousedown', e => e.preventDefault()); // الحقل ما يفقد التركيز
    box.addEventListener('click', e => { const o = e.target.closest('[data-mi]'); if (o) pick(+o.dataset.mi) });
  }
  st = { el, at, items, i: 0 };
  paint();
  const r = el.getBoundingClientRect(), h = Math.min(items.length * 48 + 12, 300);
  const below = r.bottom + h + 8 < innerHeight;
  box.style.top = (below ? r.bottom + 4 : r.top - h - 4) + 'px';
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - 288)) + 'px';
  box.style.width = Math.min(280, Math.max(220, r.width)) + 'px';
  box.classList.remove('hidden');
}

function paint() {
  box.innerHTML = st.items.map((p, i) => `<div class="mi${i === st.i ? ' on' : ''}" role="option" aria-selected="${i === st.i}" data-mi="${i}">
    ${avatarHTML(p, 30)}<span class="mi-n">${esc(p.full_name)}<small>${esc(rolesText(p.roles))}</small></span></div>`).join('');
}

function pick(i) {
  if (!st) return;
  const { el, at } = st, p = st.items[i]; if (!p) return;
  const caret = el.selectionStart ?? el.value.length;
  const ins = '@' + p.full_name.trim() + ' ';
  el.value = el.value.slice(0, at) + ins + el.value.slice(caret);
  const pos = at + ins.length;
  el.setSelectionRange(pos, pos); el.focus();
  close();
}

export function initMentions() {
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset || !el.dataset.mention) return;
    const m = query(el); if (!m) return close();
    const items = candidates(m.q);
    items.length ? show(el, m.at, items) : close();
  });
  // capture: قبل Enter حق "إرسال التعليق" و Escape حق إغلاق الدرج
  document.addEventListener('keydown', e => {
    if (!st || box.classList.contains('hidden') || e.target !== st.el) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      st.i = (st.i + (e.key === 'ArrowDown' ? 1 : -1) + st.items.length) % st.items.length; paint();
    } else if (e.key === 'Enter' || e.key === 'Tab') pick(st.i);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('focusout', e => { if (st && e.target === st.el) setTimeout(close, 120) });
  addEventListener('resize', close);
  document.addEventListener('scroll', e => { if (st && !box.contains(e.target)) close() }, true);
}

export const MENTION_HELP = 'اكتب @ حتى تذكر شخص ويوصله إشعار';
