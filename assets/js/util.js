export const DAY = 864e5;
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
// يقبل الفواصل والأرقام العربية (١٢٣) — المستخدم يكتب 1,250,000 أو ١٢٥٠٠٠٠
export const toLatin = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.').replace(/[٬،]/g, ',');
export const num = v => { const n = parseFloat(toLatin(v).replace(/,/g, '')); return isNaN(n) ? 0 : n };
export const fmt = n => num(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
// العملة يحددها الأدمن (جدول app_settings)؛ د.ع لحد ما تتحمل
let CUR = 'د.ع';
export const setCurrency = c => { CUR = c || 'د.ع' };
export const cur = () => CUR;
export const money = n => fmt(n) + ' ' + CUR;

// حقول الأرقام: نص مع فواصل الآلاف أثناء الكتابة (type=number ما يقبل فواصل)
export const numAttrs = 'type="text" inputmode="decimal" autocomplete="off" dir="ltr" data-num="1"';
export const numVal = v => v === null || v === undefined || v === '' ? '' : fmt(v);
function groupDigits(raw) {
  let s = toLatin(raw).replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  const [i, d] = s.split('.');
  return (i || (d !== undefined ? '0' : '')).replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d !== undefined ? '.' + d : '');
}
document.addEventListener('input', e => {
  const el = e.target; if (!el.dataset || !el.dataset.num) return;
  // نحافظ على مكان المؤشر: نعد الأرقام اللي قبله
  const pos = el.selectionStart ?? el.value.length;
  const before = toLatin(el.value.slice(0, pos)).replace(/[^\d.]/g, '').length;
  const out = groupDigits(el.value);
  if (out === el.value) return;
  el.value = out;
  let i = 0, n = 0; while (i < out.length && n < before) { if (/[\d.]/.test(out[i])) n++; i++ }
  el.setSelectionRange(i, i);
});
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
export function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), Math.max(3500, String(m).length * 90)) } // الرسائل الطويلة تبقى وقت يكفي لقراءتها

// نافذة إدخال عامة. أنواع الحقول: text | password | number | date | textarea | select (opts: HTML) | checks (opts: {k: label})
export function ask(title, fields, cb, { okText = 'تأكيد', msg = '', danger = false } = {}) {
  const m = $('#modal');
  $('#mTitle').textContent = title;
  $('#mOk').textContent = okText;
  $('#mOk').className = 'btn ' + (danger ? 'danger' : 'primary');
  $('#mBody').innerHTML = (msg ? `<p class="m-msg${danger ? ' bad' : ''}">${esc(msg)}</p>` : '') + fields.map(f => {
    const lab = `<label for="m_${f.id}">${esc(f.label)}${f.req ? ' <span class="req">*</span>' : ''}</label>`;
    let input;
    if (f.type === 'textarea') input = `<textarea id="m_${f.id}"></textarea>`;
    else if (f.type === 'select') input = `<select id="m_${f.id}">${f.opts}</select>`;
    else if (f.type === 'checks') input = `<div class="checks" id="m_${f.id}">${Object.entries(f.opts).map(([k, v]) =>
      `<label class="role-chk"><input type="checkbox" value="${esc(k)}" ${(f.value || []).includes(k) ? 'checked' : ''}>${esc(v)}</label>`).join('')}</div>`;
    else input = f.type === 'number' ? `<input ${numAttrs} id="m_${f.id}">` : `<input type="${f.type || 'text'}" id="m_${f.id}">`;
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
  setTimeout(() => { const x = $('#mBody input,#mBody textarea,#mBody select') || $('#mOk'); x && x.focus() }, 30);
}
