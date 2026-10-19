// صفحة البوردات: أول ما يفتح التطبيق (إذا عنده أكثر من بورد) يختار البورد مثل تريلو
import { S, hasRole } from './state.js';
import { loadBoardStats } from './api.js';
import { $, esc, ic } from './util.js';
import { boardBgUrl } from './appearance.js';

export function renderHome() {
  const list = S.BOARDS || [];
  const card = b => {
    const url = boardBgUrl(b), st = S.STATS[b.id] || {};
    const cur = b.id === S.board;
    return `<button type="button" class="home-card${cur ? ' cur' : ''}" data-board="${b.id}"${cur ? ' aria-current="true"' : ''}>
      <span class="hc-img${b.bg === 'stars' ? ' background-stars' : ''}"${url ? ` style="background-image:url('${esc(url)}')"` : ''}></span>
      <span class="hc-body"><strong>${esc(b.name)}</strong>
        <span class="hc-meta">${st.active != null ? `<span>${+st.active} شغالة</span>${+st.late ? `<span class="hc-late">${ic('clock')}${+st.late} متأخرة</span>` : ''}` : '&nbsp;'}</span></span></button>`;
  };
  $('#homeGrid').innerHTML = list.map(card).join('')
    + (hasRole('admin') ? `<button type="button" class="home-card add" id="homeAdd"><span class="hc-plus">${ic('plus')}</span><strong>بورد جديد</strong></button>` : '');
}

export function refreshHome() { loadBoardStats() }

export function initHome(open, addBoard) {
  $('#homeGrid').addEventListener('click', e => {
    if (e.target.closest('#homeAdd')) return addBoard();
    const c = e.target.closest('[data-board]'); if (c) open(+c.dataset.board);
  });
}
