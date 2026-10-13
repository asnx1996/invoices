// قائمة منسدلة بيها بحث: تلبس فوك <select> العادي (يبقى هو المرجع للقيمة)
// الكتابة تفلتر، الأسهم تتنقل، Enter يختار، Esc يسد
import { esc } from './util.js';

const norm = t => String(t).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

export function searchSelect(sel, placeholder = 'بحث...') {
  const wrap = document.createElement('div');
  wrap.className = 'ssel';
  sel.after(wrap); wrap.append(sel);
  sel.classList.add('ssel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ssel-btn';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', sel.getAttribute('aria-label') || '');
  const pop = document.createElement('div');
  pop.className = 'ssel-pop hidden';
  pop.innerHTML = `<input type="search" class="ssel-q" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"><ul class="ssel-list" role="listbox"></ul>`;
  wrap.append(btn, pop);
  const q = pop.querySelector('.ssel-q'), ul = pop.querySelector('.ssel-list');
  let items = [], at = 0;

  const sync = () => {
    const o = sel.options[sel.selectedIndex];
    btn.innerHTML = `<span>${esc(o ? o.text : '')}</span><svg class="i"><use href="#ic-chev"/></svg>`;
    btn.classList.toggle('active', !!o && sel.selectedIndex > 0);
    wrap.classList.toggle('hidden', sel.classList.contains('hidden'));
  };
  const paint = () => {
    const k = norm(q.value.trim());
    items = [...sel.options].filter(o => !k || norm(o.text).includes(k));
    at = Math.min(at, Math.max(0, items.length - 1));
    ul.innerHTML = items.map((o, i) => `<li role="option" data-i="${i}" class="${i === at ? 'on' : ''}" aria-selected="${o.selected}">${esc(o.text)}</li>`).join('')
      || '<li class="ssel-none">ماكو نتائج</li>';
  };
  const close = () => { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false') };
  const openPop = () => {
    q.value = ''; at = Math.max(0, sel.selectedIndex); paint();
    pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true');
    q.focus();
    const cur = ul.querySelector('.on'); cur && cur.scrollIntoView({ block: 'nearest' });
  };
  const pick = i => {
    const o = items[i]; if (!o) return;
    sel.value = o.value; close(); sync(); btn.focus();
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };

  btn.onclick = () => pop.classList.contains('hidden') ? openPop() : close();
  q.addEventListener('input', () => { at = 0; paint() });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); at = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); paint();
      const cur = ul.querySelector('.on'); cur && cur.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); pick(at) }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus() }
  });
  ul.addEventListener('mousedown', e => e.preventDefault());
  ul.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) pick(+li.dataset.i) });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close() });
  wrap.addEventListener('focusout', e => { if (!wrap.contains(e.relatedTarget)) close() });
  // الخيارات والقيمة تتغير من برا (fillFilters)
  new MutationObserver(sync).observe(sel, { childList: true, attributes: true, attributeFilter: ['class'] });
  sel.addEventListener('change', sync);
  sync();
  return sync;
}
