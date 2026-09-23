export const DAY = 864e5;
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
export const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n };
export const fmt = n => num(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const money = n => fmt(n) + ' د.ع';
export const pct = n => (n == null ? '—' : num(n).toFixed(2) + '%');
export const dt = ts => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dOnly = ts => new Date(ts).toLocaleDateString('en-GB');
export const ic = n => `<svg class="i"><use href="#ic-${n}"/></svg>`;
export const initials = n => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('');
// تاريخ محلي (toISOString يرجع UTC ويطلع يوم أمس قبل الساعة 3 الصبح ببغداد)
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const genPw = () => { const c = 'abcdefghjkmnpqrstuvwxyz23456789', a = new Uint32Array(10); crypto.getRandomValues(a); return [...a].map(x => c[x % c.length]).join('') };
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } };

let tt;
export function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3500) }

// نافذة إدخال عامة. أنواع الحقول: text | password | number | date | textarea | select (opts: HTML) | checks (opts: {k: label})
export function ask(title, fields, cb, { okText = 'تأكيد' } = {}) {
  const m = $('#modal');
  $('#mTitle').textContent = title;
  $('#mOk').textContent = okText;
  $('#mBody').innerHTML = fields.map(f => {
    const lab = `<label for="m_${f.id}">${esc(f.label)}${f.req ? ' <span class="req">*</span>' : ''}</label>`;
    let input;
    if (f.type === 'textarea') input = `<textarea id="m_${f.id}"></textarea>`;
    else if (f.type === 'select') input = `<select id="m_${f.id}">${f.opts}</select>`;
    else if (f.type === 'checks') input = `<div class="checks" id="m_${f.id}">${Object.entries(f.opts).map(([k, v]) =>
      `<label class="role-chk"><input type="checkbox" value="${esc(k)}" ${(f.value || []).includes(k) ? 'checked' : ''}>${esc(v)}</label>`).join('')}</div>`;
    else input = `<input type="${f.type || 'text'}" id="m_${f.id}" ${f.type === 'number' ? 'min="0" step="any"' : ''}>`;
    return `<div class="fld">${lab}${input}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`;
  }).join('') + '<div class="err" id="mErr"></div>';
  fields.forEach(f => { if (f.value != null && f.type !== 'checks') $('#m_' + f.id).value = f.value });
  $('#mOk').onclick = ev => {
    ev.preventDefault();
    const v = {};
    for (const f of fields) {
      v[f.id] = f.type === 'checks'
        ? [...$('#m_' + f.id).querySelectorAll('input:checked')].map(x => x.value)
        : $('#m_' + f.id).value.trim();
      const empty = f.type === 'checks' ? !v[f.id].length : !v[f.id];
      if (f.req && empty) { $('#mErr').textContent = 'الحقل "' + f.label + '" مطلوب'; return }
    }
    m.close(); cb(v);
  };
  m.showModal();
  setTimeout(() => { const x = $('#mBody input,#mBody textarea,#mBody select'); x && x.focus() }, 30);
}
