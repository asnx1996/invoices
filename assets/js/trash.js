// سلة المحذوفات (للأدمن): الطلب المحذوف يبقى هنا لحد ما يرجع أو ينحذف نهائياً (016)
import { S, COLS, SUB, userName, boardName } from './state.js';
import { sb, rpc, loadInvoices } from './api.js';
import { $, esc, ask, toast, money, dt } from './util.js';

let rows = [];

const stageText = i => ((COLS.find(c => c.k === i.stage) || {}).t || i.stage) + (i.stage === 'decision' && SUB[i.sub] ? ' · ' + SUB[i.sub] : '');

function paint() {
  const multi = (S.BOARDS || []).length > 1;
  $('#trashCount').textContent = rows.length ? `(${rows.length})` : '';
  $('#trashTbl').innerHTML = `<thead><tr><th>#</th><th>الزبون</th><th>المندوب</th><th class="num">القيمة</th><th>المرحلة</th>${multi ? '<th>البورد</th>' : ''}<th>حذفه</th><th>وقت الحذف</th><th></th></tr></thead><tbody>${
    rows.map(i => `<tr>
      <td>${i.id}</td><td>${esc(i.customer) || '—'}</td><td>${esc(userName(i.rep_id))}</td><td class="num">${money(i.value)}</td>
      <td>${esc(stageText(i))}</td>${multi ? `<td>${esc(boardName(i.board_id))}</td>` : ''}
      <td>${esc(userName(i.deleted_by))}</td><td>${dt(i.deleted_at)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-restore="${i.id}">استرجاع</button> <button class="btn sm bad" data-purge="${i.id}">حذف نهائي</button></td></tr>`).join('')
    || `<tr><td colspan="${multi ? 9 : 8}" class="muted">السلة فارغة</td></tr>`}</tbody>`;
}

export async function renderTrash() {
  const { data, error } = await sb.rpc('trash_list');
  if (error) {
    rows = [];
    $('#trashTbl').innerHTML = `<tbody><tr><td class="muted">${error.code === 'PGRST202' ? 'لازم تتشغل 016 بالقاعدة أول' : esc(error.message)}</td></tr></tbody>`;
    return;
  }
  rows = data || []; paint();
}

async function restore(id) {
  const r = await rpc('inv_restore', { p_id: id }, 'رجع الطلب #' + id + ' للبورد');
  if (r.ok) { await renderTrash(); loadInvoices() }
}

function purge(id) {
  ask('حذف نهائي للطلب #' + id, [], async () => {
    const r = await rpc('inv_purge', { p_id: id });
    if (!r.ok) return;
    if (r.data) await sb.storage.from('invoices').remove([r.data]);
    toast('انحذف الطلب #' + id + ' نهائياً'); renderTrash();
  }, { okText: 'حذف نهائي', danger: true, msg: 'ينحذف الطلب وملفه وتعليقاته وسجله نهائياً، وما يرجع.' });
}

export function initTrash() {
  $('#trashTbl').addEventListener('click', e => {
    const r = e.target.closest('[data-restore]'); if (r) return restore(+r.dataset.restore);
    const p = e.target.closest('[data-purge]'); if (p) return purge(+p.dataset.purge);
  });
}
