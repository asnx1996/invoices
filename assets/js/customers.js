import { S } from './state.js';
import { sb, loadCustomers } from './api.js';
import { $, esc, ask, toast } from './util.js';

const key = n => String(n || '').trim().toLowerCase();

export function renderCustomers() {
  const q = key($('#custQ').value), showOff = $('#custOff').checked;
  const list = S.CUSTOMERS.filter(c => (showOff || c.active) && (!q || key(c.name).includes(q) || key(c.phone).includes(q)));
  const used = new Map();
  S.INVOICES.forEach(i => i.customer_id && used.set(i.customer_id, (used.get(i.customer_id) || 0) + 1));
  $('#custCount').textContent = `${list.length} من ${S.CUSTOMERS.length}`;
  $('#custTbl').innerHTML = `<thead><tr><th>الاسم</th><th>الهاتف</th><th>ملاحظات</th><th class="num">طلبات (الفترة الحالية)</th><th>مفعّل</th><th></th></tr></thead><tbody>${
    list.slice(0, 500).map(c => `<tr class="${c.active ? '' : 'off'}">
      <td>${esc(c.name)}</td><td dir="ltr" style="text-align:end">${esc(c.phone)}</td><td class="muted">${esc(c.notes)}</td>
      <td class="num">${used.get(c.id) || 0}</td>
      <td><label class="toggle"><input type="checkbox" data-cact="${c.id}" ${c.active ? 'checked' : ''}>${c.active ? 'فعال' : 'مخفي'}</label></td>
      <td><button class="btn sm" data-cedit="${c.id}">تعديل</button></td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">ماكو زبائن. أضف من زر "زبون جديد" أو استورد ملف Excel.</td></tr>'}</tbody>`;
}

function editCustomer(c) {
  ask(c ? 'تعديل زبون' : 'زبون جديد', [
    { id: 'n', label: 'اسم الزبون', type: 'text', req: true, value: c ? c.name : '' },
    { id: 'p', label: 'الهاتف', type: 'text', value: c ? c.phone : '' },
    { id: 'o', label: 'ملاحظات', type: 'textarea', value: c ? c.notes : '' },
  ], async v => {
    const row = { name: v.n.replace(/\s+/g, ' '), phone: v.p, notes: v.o };
    const { error } = c ? await sb.from('customers').update(row).eq('id', c.id) : await sb.from('customers').insert(row);
    if (error) return toast(error.code === '23505' ? 'هذا الزبون موجود' : error.message);
    await loadCustomers(); renderCustomers(); toast(c ? 'تم التعديل' : 'انضاف الزبون');
  });
}

// استيراد من Excel: عمود "الاسم" (أو أول عمود) + "الهاتف" اختياري
async function importFile(f) {
  if (typeof XLSX === 'undefined') return toast('مكتبة Excel ما تحملت');
  const wb = XLSX.read(await f.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  if (!rows.length) return toast('الملف فارغ');
  const head = rows[0].map(h => key(h));
  const hasHead = head.some(h => ['الاسم', 'اسم الزبون', 'name', 'customer', 'الزبون'].includes(h));
  const ni = hasHead ? Math.max(0, head.findIndex(h => ['الاسم', 'اسم الزبون', 'name', 'customer', 'الزبون'].includes(h))) : 0;
  const pi = hasHead ? head.findIndex(h => ['الهاتف', 'هاتف', 'رقم الهاتف', 'phone', 'mobile'].includes(h)) : -1;
  const have = new Set(S.CUSTOMERS.map(c => key(c.name)));
  const add = [];
  for (const r of rows.slice(hasHead ? 1 : 0)) {
    const name = String(r[ni] ?? '').replace(/\s+/g, ' ').trim();
    if (!name || have.has(key(name))) continue;
    have.add(key(name));
    add.push({ name, phone: pi >= 0 ? String(r[pi] ?? '').trim() : '' });
  }
  if (!add.length) return toast('ماكو زبائن جدد بالملف');
  for (let i = 0; i < add.length; i += 500) {
    const { error } = await sb.from('customers').insert(add.slice(i, i + 500));
    if (error) { toast(error.message); break }
  }
  await loadCustomers(); renderCustomers(); toast('انضاف ' + add.length + ' زبون');
}

export function initCustomers() {
  $('#custAdd').onclick = () => editCustomer(null);
  ['#custQ', '#custOff'].forEach(s => $(s).addEventListener('input', renderCustomers));
  $('#custImport').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f) });
  $('#custTbl').addEventListener('click', e => {
    const b = e.target.closest('[data-cedit]'); if (!b) return;
    editCustomer(S.CUSTOMERS.find(c => c.id === +b.dataset.cedit));
  });
  $('#custTbl').addEventListener('change', async e => {
    const id = e.target.dataset.cact; if (!id) return;
    const { error } = await sb.from('customers').update({ active: e.target.checked }).eq('id', id);
    if (error) toast(error.message);
    await loadCustomers(); renderCustomers();
  });
}
