import { S, COLS, SUB, PAY, PAY_LEGACY, PAYER, PAYER_LEGACY, MONTHS, POINT_RATE, hasRole, getInv, userName, reps, isActive, isUrgent,
  ldAmount, transportAdded, totalAfterTransport, pointsPct, onChange } from './state.js';
import { renderBoard } from './board.js';
import { $, esc, num, fmt, money, pct, dt, dOnly, ic, toast, ask, cur, numAttrs, numVal } from './util.js';
import { sb, rpc, refreshInvoice } from './api.js';
import { can } from './can.js';
import { run, waitingOn, missingBasic, missingTerms } from './actions.js';

let extra = { comments: [], log: [], pdfUrl: null, costEdit: false };
let returnFocus = null;
const shown = { steps: false, log: false }; // الأقسام المطوية تبقى مثل ما تركها المستخدم

export async function openDrawer(id, push = true) {
  const wasOpen = !!S.drawerId;
  S.drawerId = id; extra = { comments: [], log: [], pdfUrl: null, costEdit: false };
  renderDrawer();
  if (S.drawerId !== id) return; // الطلب مو موجود
  // الطلب إله رابط يتشارك، وزر الرجوع بالموبايل يسكّر الدرج بدل ما يطلع من الموقع
  const st = { ...(history.state || {}), drawer: id };
  if (push && !wasOpen) history.pushState(st, '', '#inv-' + id);
  else history.replaceState(st, '', '#inv-' + id);
  const d = $('#drawer');
  if (!d.classList.contains('open')) {
    // نافذة: الخلفية تصير inert، والتركيز ينتقل للدرج ويرجع لمكانه عند الإغلاق
    returnFocus = document.activeElement;
    d.classList.add('open'); $('#scrim').classList.add('open'); d.inert = false; $('#appView').inert = true;
    d.querySelector('.close').focus({ preventScroll: true });
  }
  if (id === 'draft') return;
  const [c, l] = await Promise.all([
    sb.from('invoice_comments').select('*').eq('invoice_id', id).order('at'),
    sb.from('invoice_log').select('*').eq('invoice_id', id).order('at'),
  ]);
  extra.comments = c.data || []; extra.log = l.data || [];
  const inv = getInv(id);
  if (inv && inv.pdf_path) { const { data } = await sb.storage.from('invoices').createSignedUrl(inv.pdf_path, 3600); extra.pdfUrl = data && data.signedUrl }
  if (S.drawerId === id) renderDrawer();
}

// الإغلاق يمر من التاريخ (history) حتى يبقى متطابق مع زر الرجوع؛ popstate يستدعي hideDrawer
export function closeDrawer(force) {
  const dr = S.drawerId === 'draft' && S.draft;
  if (force !== true && dr && (dr.customer_id || dr.value || dr.quote_no || dr.res_no || S.draftFile))
    return ask('تجاهل الطلب الجديد؟', [], () => closeDrawer(true), { okText: 'تجاهل', danger: true, msg: 'الطلب ما انحفظ، وإذا طلعت تروح البيانات اللي كتبتها.' });
  if (S.drawerId && history.state && history.state.drawer) { history.back(); return }
  hideDrawer();
}

// طلب جديد: يتعبى بالدرج محلياً، وبس من يضغط "حفظ الطلب" ينضاف للقاعدة ويطلع كبطاقة
export function openDraft(rep_id) {
  S.draft = { id: 'draft', stage: 'new', rep_id, customer: '', customer_id: null, quote_no: null, res_no: null, value: null, created_at: new Date().toISOString() };
  S.draftFile = null;
  openDrawer('draft');
}

async function saveDraft() {
  // الحقل اللي لسه بيه المؤشر (مثل القيمة) نثبّته أول، حتى ما تضيع آخر كتابة
  const a = document.activeElement; if (a && $('#drawer').contains(a)) a.blur();
  const dr = S.draft; if (!dr) return;
  if (!dr.customer_id) { toast('اختار الزبون من القائمة أول'); const f = $('#f_customer_pick'); f && f.focus(); return }
  const btn = $('#saveDraft'); btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.from('invoices').insert({
    rep_id: dr.rep_id, customer_id: dr.customer_id, customer: dr.customer, quote_no: dr.quote_no ?? '', res_no: dr.res_no ?? '', value: dr.value ?? 0,
  }).select().single();
  if (error) { btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); return toast(error.message) }
  const file = S.draftFile;
  await refreshInvoice(data.id);          // المسودة تبقى معروضة لحد ما يوصل الطلب الحقيقي
  S.draft = null; S.draftFile = null;
  await openDrawer(data.id);
  toast('انحفظ الطلب #' + data.id);
  if (file) uploadPdf(getInv(data.id), file);
}

export function hideDrawer() {
  const id = S.drawerId;
  S.drawerId = null; S.lastMissing = null; S.draft = null; S.draftFile = null;
  const d = $('#drawer');
  if (!d.classList.contains('open')) return;
  d.classList.remove('open'); $('#scrim').classList.remove('open'); d.inert = true; $('#appView').inert = false;
  // الكارت ممكن انرسم من جديد، فندور عليه بالرقم
  const back = returnFocus && returnFocus.isConnected ? returnFocus : (id != null && document.querySelector(`.card[data-id="${id}"] .card-link`));
  if (back) back.focus({ preventScroll: true });
  returnFocus = null;
}

async function reloadLog() {
  const { data } = await sb.from('invoice_log').select('*').eq('invoice_id', S.drawerId).order('at');
  extra.log = data || [];
}

// ---------- مكونات الحقول ----------
function fld(label, col, val, { type = 'text', req = false, dis = false, full = false, opts = null, help = '', rer = false, list = '' } = {}) {
  const id = 'f_' + col; let input;
  if (opts) input = `<select id="${id}" data-f="${col}" ${rer ? 'data-rer="1"' : ''} ${dis ? 'disabled' : ''}><option value="">— اختر —</option>${Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${String(val) === String(k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea id="${id}" data-f="${col}" ${dis ? 'disabled' : ''}>${esc(val)}</textarea>`;
  else input = `<input ${type === 'number' ? numAttrs : `type="${type}"`} id="${id}" data-f="${col}" value="${esc(type === 'number' ? numVal(val) : val ?? '')}" ${dis ? 'disabled' : ''} ${rer ? 'data-rer="1"' : ''} ${list ? `list="${list}"` : ''}>`;
  return `<div class="fld ${full ? 'full' : ''}"><label for="${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>${input}${help ? `<div class="help">${help}</div>` : ''}</div>`;
}
const tog = (label, col, val, dis) => `<label class="toggle" for="f_${col}"><input type="checkbox" id="f_${col}" data-f="${col}" data-rer="1" ${val ? 'checked' : ''} ${dis ? 'disabled' : ''}>${label}</label>`;
const filled = v => String(v ?? '').trim() !== '';

function stepsHTML(inv) {
  const seq = [['new', 'طلب'], ['acc', 'حسابات'], ['mgr', 'المدير'], ['cust', 'الزبون'], ['wh', 'المخزن'], ['done', 'تمت']];
  if (inv.stage === 'cancel') return `<div class="steps">${seq.map(s => `<div class="step cancel"><div class="ln"></div>${s[1]}</div>`).join('')}</div>`;
  const pos = inv.stage === 'new' ? 0 : inv.stage === 'acc' ? 1 : inv.stage === 'done' ? 5 : { mgr: 2, cust: 3, wh: 4 }[inv.sub];
  return `<div class="steps">${seq.map((s, i) => `<div class="step ${i < pos || inv.stage === 'done' ? 'done' : i === pos ? 'cur' : ''}"><div class="ln"></div>${s[1]}</div>`).join('')}</div>`;
}

function deleteReqHTML(inv) {
  if (!inv.delete_req_at) return '';
  const btn = (a, label, cls) => can(a, inv) ? `<button class="btn sm ${cls}" data-act="${a}">${label}</button>` : '';
  const mine = inv.delete_req_by === S.ME.id;
  return `<div class="warnbox">${ic('trash')} <b>طلب حذف</b> من ${esc(userName(inv.delete_req_by))} — ${dOnly(inv.delete_req_at)}<br>السبب: ${esc(inv.delete_req_reason)}
    <div class="row">${btn('delete', 'حذف نهائي', 'bad')}${hasRole('admin') ? btn('cancelDeleteReq', mine ? 'إلغاء الطلب' : 'رفض طلب الحذف', '') : mine ? btn('cancelDeleteReq', 'إلغاء طلبي', '') : ''}</div></div>`;
}

function actionsHTML(inv) {
  if (inv.id === 'draft') return `<div class="actions"><div class="wait">${ic('file')}<span>طلب جديد — ما يطلع باللوحة لحد ما تحفظه</span></div>
    <div class="row"><button class="btn primary" id="saveDraft">${ic('check')}حفظ الطلب</button></div></div>`;
  const btn = (a, label, cls = '', icn = '') => can(a, inv) ? `<button class="btn ${cls}" data-act="${a}">${icn ? ic(icn) : ''}${label}</button>` : '';
  const btns = [btn('sendToAcc', 'إرسال للحسابات', 'primary', 'check'), btn('sendToDecision', 'إرسال للقرار', 'primary', 'check'),
    btn('approve', 'موافقة على الشروط', 'ok', 'check'), btn('returnToAcc', 'إرجاع للحسابات', 'bad', 'back'),
    btn('custAccept', 'الزبون موافق', 'ok', 'check'), btn('custRefuse', 'الزبون رفض', 'bad', 'x'),
    btn('complete', 'تحويل لمبيعات + رقم المبيعات', 'ok', 'check')].join('');
  const small = [can('toggleUrgent', inv) ? `<button class="btn sm ${inv.urgent ? '' : 'bad'}" data-act="toggleUrgent" aria-pressed="${!!inv.urgent}">${ic('flame')}${inv.urgent ? 'شيل علامة طارئ' : 'طارئ'}</button>` : '', btn('requestDelete', 'طلب حذف', 'bad sm', 'trash'), inv.delete_req_at ? '' : btn('delete', 'حذف', 'bad sm', 'trash')].join('');
  let wait;
  if (inv.stage === 'done') wait = `تمت برقم مبيعات <b>${esc(inv.sales_no)}</b> — ${dOnly(inv.closed_at)}`;
  else if (inv.stage === 'cancel') wait = `ملغاة: ${esc(inv.cancel_reason)}`;
  else wait = 'الخطوة الحالية: ' + esc(waitingOn(inv));
  const miss = S.lastMissing && S.lastMissing.id === inv.id ? `<div class="missing">حقول ناقصة:<ul>${S.lastMissing.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `${deleteReqHTML(inv)}<div class="actions"><div class="wait">${ic('clock')}<span>${wait}</span></div>
    ${btns ? `<div class="row">${btns}</div>` : `<div class="help">${isActive(inv) ? 'ما عندك إجراء بهذه المرحلة.' : ''}</div>`}
    ${small ? `<div class="row" style="margin-top:8px">${small}</div>` : ''}${miss}</div>`;
}

function customerFld(inv, dis) {
  if (dis) return `<div class="fld full"><label>اسم الزبون</label><input type="text" value="${esc(inv.customer)}" disabled></div>`;
  const warn = !inv.customer_id ? `<div class="help" style="color:var(--bad)">${filled(inv.customer) ? 'الاسم مو من القائمة — ' : ''}اختار الزبون من القائمة</div>` : '<div class="help">اكتب جزء من الاسم واختار من القائمة</div>';
  return `<div class="fld full"><label for="f_customer_pick">اسم الزبون <span class="req">*</span></label>
    <input type="search" id="f_customer_pick" list="custList" value="${esc(inv.customer)}" autocomplete="off" placeholder="ابحث عن الزبون...">
    <datalist id="custList">${S.CUSTOMERS.filter(c => c.active).map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>${warn}</div>`;
}

function costFld(inv) {
  if (!can('setCost', inv)) return '';
  if (hasRole('admin')) return fld(`سعر الكلفة (${cur()}) — للأدمن فقط`, 'cost', S.COSTS[inv.id] ?? '', { type: 'number', req: true, help: 'ما يظهر لأي أحد غيرك' }).replace('data-f="cost"', 'data-cost="1"');
  if (inv.cost_set && !extra.costEdit)
    return `<div class="fld"><label>سعر الكلفة</label><div class="cost-set">${ic('check')}مسجّل (مخفي) <button class="btn sm" data-costedit="1">تغيير</button></div></div>`;
  return fld(`سعر الكلفة (${cur()})`, 'cost', '', { type: 'number', req: true, help: 'بعد الحفظ يختفي ومحد يشوفه غير الأدمن' }).replace('data-f="cost"', 'data-cost="1"');
}

function termsHTML(inv) {
  const et = !can('editTerms', inv);
  const payOpts = { ...PAY, ...(PAY_LEGACY[inv.payment] ? { [inv.payment]: PAY_LEGACY[inv.payment] } : {}) };
  const payerOpts = { ...PAYER, ...(PAYER_LEGACY[inv.payer] ? { [inv.payer]: PAYER_LEGACY[inv.payer] } : {}) };
  const tr = transportAdded(inv);
  return `<section class="blk"><h4>السداد والنقل ${et ? `<span class="lock">${ic('lock')}يعدلها المحاسب</span>` : ''}</h4>
    <div class="grid">
      ${fld('طريقة السداد', 'payment', inv.payment, { opts: payOpts, req: true, dis: et, rer: true })}
      ${inv.payment === 'credit' ? fld('مدة الآجل', 'credit_months', inv.credit_months, { opts: MONTHS, req: true, dis: et, rer: true }) : '<div></div>'}
      ${fld('النقل', 'payer', inv.payer, { opts: payerOpts, req: true, dis: et, rer: true })}
      ${inv.payer === 'customer' ? fld(`أجور النقل (${cur()})`, 'transport_amt', inv.transport_amt, { type: 'number', req: true, dis: et, rer: true, help: 'تنضاف على قيمة الفاتورة' }) : '<div></div>'}
      <div class="fld full"><div class="help">الإجمالي بعد النقل: <b>${money(totalAfterTransport(inv))}</b>${tr ? ` (${money(inv.value)} + ${money(tr)})` : ''}</div></div>
      ${fld('عدد النقاط', 'points', inv.points, { type: 'number', dis: et, rer: true, help: `نسبة النقاط: ${fmt(pointsPct(inv))}% (النقطة = ${POINT_RATE}%)` })}
      ${costFld(inv)}
      <div class="term-box">${tog('خصم لاحق', 'ld', inv.ld, et)}
        ${inv.ld ? `<div class="grid">${fld('نسبة الخصم %', 'ld_pct', inv.ld_pct, { type: 'number', req: true, dis: et, rer: true })}
          <div class="fld"><div class="help" style="margin-top:28px">مبلغ الخصم: <b>${money(ldAmount(inv))}</b></div></div></div>` : ''}</div>
      ${fld('ملاحظات', 'notes', inv.notes, { type: 'textarea', dis: et, full: true })}
    </div></section>`;
}

function profitHTML(inv) {
  if (!can('seeProfit', inv)) return '';
  const p = S.PROFITS[inv.id];
  if (!p) return `<section class="blk"><h4>الربح</h4><div class="help">${inv.cost_set ? 'جاري الحساب...' : 'ما انكتب سعر الكلفة بعد'}</div></section>`;
  const ld = inv.ld ? num(inv.ld_pct) : 0, pts = pointsPct(inv), net = num(p.net_pct);
  return `<section class="blk"><h4>الربح <span class="lock">${ic('lock')}للأدمن والمدير</span></h4>
    <div class="profit"><table>
      <tr><td>الإجمالي بعد النقل</td><td>${money(p.total)}</td></tr>
      ${hasRole('admin') && S.COSTS[inv.id] != null ? `<tr><td>سعر الكلفة</td><td>${money(S.COSTS[inv.id])}</td></tr>` : ''}
      <tr><td>الربح (1 − الكلفة ÷ الإجمالي)</td><td>${pct(p.gross_pct)}</td></tr>
      <tr><td>− الخصم اللاحق</td><td>${pct(ld)}</td></tr>
      <tr><td>− النقاط (${fmt(inv.points)} × ${POINT_RATE})</td><td>${pct(pts)}</td></tr>
      <tr class="net"><td><b>صافي الربح</b></td><td class="${net >= 0 ? 'pos' : 'neg'}">${pct(net)}</td></tr>
    </table></div></section>`;
}

export function renderDrawer() {
  const inv = getInv(S.drawerId); if (!inv) return closeDrawer();
  const eb = !can('editBasic', inv), draft = inv.id === 'draft';
  const col = COLS.find(c => c.k === inv.stage);
  // نحافظ على مكان التمرير والحقل المحدد بعد إعادة الرسم
  const body = $('#drawer .d-body'), scroll = body ? body.scrollTop : 0;
  const act = document.activeElement, focusId = act && $('#drawer').contains(act) ? act.id : null;
  const qDis = eb || (filled(inv.res_no) && !filled(inv.quote_no));
  const rDis = eb || (filled(inv.quote_no) && !filled(inv.res_no));
  $('#drawer').innerHTML = `
  <div class="d-head">
    <div style="flex:1;min-width:0">
      <div class="sub">${draft ? 'غير محفوظ' : '#' + inv.id} · ${esc(userName(inv.rep_id))} · ${dOnly(inv.created_at)}</div>
      <h3>${esc(inv.customer) || 'طلب جديد'}</h3>
      <span class="badge" style="background:var(--surface-2);color:${col.c};border:1px solid var(--border)">${col.t}${inv.stage === 'decision' ? ' · ' + SUB[inv.sub] : ''}</span>
      ${isUrgent(inv) ? `<span class="badge b-urgent">${ic('flame')}طارئ</span>` : ''}
    </div>
    <button class="icon-btn close" aria-label="إغلاق">${ic('x')}</button>
  </div>
  <div class="d-body">
    ${actionsHTML(inv)}
    ${draft ? '' : `<details class="more" data-more="steps" ${shown.steps ? 'open' : ''}><summary>مراحل الطلب</summary>${stepsHTML(inv)}</details>`}
    ${draft ? '' : profitHTML(inv)}
    <section class="blk"><h4>بيانات الطلب ${eb ? `<span class="lock">${ic('lock')}للعرض فقط</span>` : ''}</h4>
      <div class="grid">
        ${customerFld(inv, eb)}
        ${fld('رقم عرض السعر', 'quote_no', inv.quote_no, { dis: qDis })}
        ${fld('رقم الحجز', 'res_no', inv.res_no, { dis: rDis, help: 'واحد منهم فقط' })}
        ${fld(`قيمة الفاتورة (${cur()})`, 'value', inv.value, { type: 'number', req: true, dis: eb, rer: true })}
        ${hasRole('admin') && inv.stage === 'new' ? fld('المندوب', 'rep_id', inv.rep_id, { opts: Object.fromEntries(reps().map(r => [r.id, r.full_name])), rer: true }) : `<div class="fld"><label>المندوب</label><input type="text" value="${esc(userName(inv.rep_id))}" disabled></div>`}
        <div class="fld full"><label>ملف الفاتورة PDF <span class="req">*</span></label>
          <div class="pdf">${ic('file')}<span class="name" title="${esc(inv.pdf_name || '')}">${inv.pdf_path || inv.pdf_name ? esc(inv.pdf_name || 'ملف') + ' · ' + Math.round((inv.pdf_size || 0) / 1024) + ' KB' : '<span style="color:var(--faint)">ما مرفوع ملف</span>'}</span>
          ${extra.pdfUrl ? `<a class="btn sm" href="${esc(extra.pdfUrl)}" target="_blank" rel="noopener noreferrer">فتح</a>` : ''}
          ${!eb ? `<label class="btn sm" for="pdfIn">${inv.pdf_path || inv.pdf_name ? 'تغيير' : 'رفع'}</label><input type="file" id="pdfIn" accept="application/pdf" class="hidden">` : ''}</div>
          <div class="help">الحد الأقصى 2 MB${draft && inv.pdf_name ? ' · ينرفع وياه من تحفظ الطلب' : ''}</div></div>
      </div></section>
    ${!draft && can('seeTerms', inv) ? termsHTML(inv) : ''}
    ${draft ? '' : `<section class="blk"><h4>التعليقات</h4>
      ${extra.comments.map(c => `<div class="comment ${c.is_system ? 'sys' : ''}"><div class="by">${esc(userName(c.author))} · ${dt(c.at)}</div>${esc(c.body)}</div>`).join('') || '<div class="help" style="margin-bottom:8px">لا توجد تعليقات</div>'}
      <div class="add-c"><input type="text" id="cIn" placeholder="اكتب تعليق..." aria-label="تعليق"><button class="btn primary" id="cBtn">إرسال</button></div></section>
    <details class="more blk" data-more="log" ${shown.log ? 'open' : ''}><summary>سجل الحركة${extra.log.length ? ` (${extra.log.length})` : ''}</summary>
      <ul class="timeline">${extra.log.slice().reverse().map(l => `<li><div>${esc(userName(l.actor))}: ${esc(l.body)}</div><div class="t">${dt(l.at)}</div></li>`).join('') || '<li class="help">—</li>'}</ul></details>`}
  </div>`;
  $('#drawer .d-body').scrollTop = scroll;
  if (focusId) { const f = document.getElementById(focusId); if (f && !f.disabled) f.focus({ preventScroll: true }) }
}

async function addComment() {
  const v = $('#cIn').value.trim(); if (!v) return;
  const { error } = await sb.from('invoice_comments').insert({ invoice_id: S.drawerId, body: v });
  if (error) return toast(error.message);
  const { data } = await sb.from('invoice_comments').select('*').eq('invoice_id', S.drawerId).order('at');
  extra.comments = data || []; renderDrawer();
}

async function save(inv, patch, rerender) {
  if (inv.id === 'draft') { Object.assign(inv, patch); if (rerender) renderDrawer(); return true }
  const { error } = await sb.from('invoices').update(patch).eq('id', inv.id);
  if (error) { toast(error.message); renderDrawer(); return false }
  Object.assign(inv, patch);
  if (S.lastMissing && S.lastMissing.id === inv.id) {
    S.lastMissing.list = (inv.stage === 'new' ? missingBasic : missingTerms)(inv);
    if (!S.lastMissing.list.length) S.lastMissing = null;
  }
  await reloadLog();
  if (S.PROFITS[inv.id]) await refreshInvoice(inv.id);   // الربح يتغير ويا القيمة/النقل/النقاط
  else renderBoard();
  if (rerender) renderDrawer();
  return true;
}

async function uploadPdf(inv, f) {
  if (f.type !== 'application/pdf') return toast('الملف لازم PDF');
  if (f.size > 2 * 1024 * 1024) return toast('الحجم أكثر من 2 MB');
  if (inv.id === 'draft') { S.draftFile = f; Object.assign(inv, { pdf_name: f.name, pdf_size: f.size }); return renderDrawer() }
  const path = `${inv.id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, '_')}`;
  toast('جاري الرفع...');
  const up = await sb.storage.from('invoices').upload(path, f, { contentType: 'application/pdf' });
  if (up.error) return toast(up.error.message);
  const old = inv.pdf_path;
  if (!await save(inv, { pdf_path: path, pdf_name: f.name, pdf_size: f.size })) return;
  if (old) await sb.storage.from('invoices').remove([old]);
  openDrawer(inv.id); toast('انرفع الملف');
}

// ---------- سحب الدرج لإغلاقه (باللمس) ----------
// الدرج يتبع الإصبع 1:1، وعند الترك نحسب وين راح يوقف حسب سرعة الإصبع (مثل iOS)،
// ونكمل الحركة بنفس السرعة حتى ما يبين فاصل بين السحب والأنيميشن.
const project = v => (v / 1000) * 0.998 / (1 - 0.998);
const rubber = (x, dim) => (x * dim * 0.55) / (dim + 0.55 * Math.abs(x));

function initSwipe(d) {
  const scrim = $('#scrim');
  let sw = null;
  const reset = () => { d.classList.remove('swiping'); scrim.classList.remove('swiping'); d.style.transform = ''; scrim.style.opacity = '' };
  d.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (e.target.closest('input,textarea,select,button,a,label,.tbl-wrap')) return;
    sw = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, on: false, pts: [[e.clientX, e.timeStamp]] };
  });
  d.addEventListener('pointermove', e => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
    if (!sw.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return } // تمرير عمودي، مو سحب
      if (Math.abs(dx) < 10) return;
      sw.on = true; sw.x0 = e.clientX; try { d.setPointerCapture(e.pointerId) } catch (_) { }
      d.classList.add('swiping'); scrim.classList.add('swiping');
    }
    const raw = e.clientX - sw.x0, w = d.offsetWidth;
    sw.dx = raw < 0 ? raw : rubber(raw, w); // عكس الاتجاه: مقاومة ناعمة بدل وقفة صلبة
    sw.pts.push([e.clientX, e.timeStamp]); if (sw.pts.length > 6) sw.pts.shift();
    d.style.transform = `translateX(${sw.dx}px)`;
    scrim.style.opacity = String(Math.max(0, 1 + Math.min(0, sw.dx) / w));
  });
  const end = e => {
    if (!sw || e.pointerId !== sw.id) return;
    const s = sw; sw = null;
    if (!s.on) return;
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
    const v = b[1] > a[1] && e.type !== 'pointercancel' ? (b[0] - a[0]) / (b[1] - a[1]) * 1000 : 0; // px/s
    const w = d.offsetWidth, shut = s.dx + project(v) < -w / 2;
    // مدة تخلي السرعة الابتدائية للمنحنى = سرعة الإصبع (ميل --ease-out بالبداية ≈ 2.25)
    const dist = Math.abs((shut ? -w : 0) - s.dx);
    const t = v ? Math.min(.45, Math.max(.2, 2.25 * dist / Math.abs(v))) : .45;
    d.style.transitionDuration = scrim.style.transitionDuration = t + 's';
    reset();
    if (shut) closeDrawer();
    setTimeout(() => { d.style.transitionDuration = scrim.style.transitionDuration = '' }, t * 1000 + 50);
  };
  d.addEventListener('pointerup', end);
  d.addEventListener('pointercancel', end);
}

export function initDrawer() {
  $('#scrim').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.drawerId && !$('#modal').open) closeDrawer() });
  onChange(() => { if (S.drawerId) renderDrawer() });

  const d = $('#drawer');
  // زر "حفظ الطلب": لو الضغطة تشيل التركيز من الحقل، الـ change يعيد رسم الدرج
  // والزر ينمسح بين ما ينضغط وما ينترك، فالضغطة تضيع. نمنع خسارة التركيز ونثبّت الحقل بـ saveDraft
  d.addEventListener('mousedown', e => { if (e.target.closest('#saveDraft')) e.preventDefault() });
  d.addEventListener('click', e => {
    if (e.target.closest('.close')) return closeDrawer();
    const a = e.target.closest('[data-act]'); if (a) return run(a.dataset.act, S.drawerId);
    if (e.target.closest('[data-costedit]')) { extra.costEdit = true; renderDrawer(); setTimeout(() => { const c = $('#f_cost'); c && c.focus() }, 30); return }
    if (e.target.closest('#cBtn')) addComment();
    if (e.target.closest('#saveDraft')) saveDraft();
  });
  // نتذكر إذا المستخدم فتح "مراحل الطلب" أو "سجل الحركة"
  d.addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.more; if (k) shown[k] = e.target.open }, true);
  initSwipe(d);
  d.addEventListener('keydown', e => { if (e.target.id === 'cIn' && e.key === 'Enter') { e.preventDefault(); addComment() } });

  // رقم عرض السعر ورقم الحجز: إذا انكتب واحد، الثاني يتقفل
  d.addEventListener('input', e => {
    const pair = { f_quote_no: 'f_res_no', f_res_no: 'f_quote_no' }[e.target.id];
    if (!pair) return;
    const inv = getInv(S.drawerId); if (!inv || !can('editBasic', inv)) return;
    const other = $('#' + pair);
    other.disabled = filled(e.target.value) && !filled(other.value);
  });

  d.addEventListener('change', async e => {
    const el = e.target, inv = getInv(S.drawerId); if (!inv) return;
    if (el.id === 'pdfIn') { const f = el.files[0]; if (f) uploadPdf(inv, f); return }

    if (el.id === 'f_customer_pick') {
      const name = el.value.trim().toLowerCase();
      const c = S.CUSTOMERS.find(x => x.active && x.name.trim().toLowerCase() === name);
      if (!c) { toast('الزبون مو موجود بالقائمة. اختار من القائمة أو راجع الأدمن'); el.value = inv.customer || ''; return }
      if (c.id !== inv.customer_id) await save(inv, { customer_id: c.id, customer: c.name }, true);
      return;
    }

    if (el.dataset.cost) {
      const v = num(el.value); if (v <= 0) return toast('سعر الكلفة لازم أكبر من صفر');
      const r = await rpc('inv_set_cost', { p_id: inv.id, p_cost: v }, 'انحفظ سعر الكلفة');
      if (r.ok) { extra.costEdit = false; await reloadLog(); await refreshInvoice(inv.id) }
      return;
    }

    const col = el.dataset.f; if (!col) return;
    let val = el.type === 'checkbox' ? el.checked : el.value;
    // الحقول النصية بالقاعدة ما تقبل null، الفارغ ينحفظ ''
    if (val === '' && !['quote_no', 'res_no', 'notes'].includes(col)) val = null;
    if (['value', 'transport_amt', 'ld_pct', 'points', 'credit_months'].includes(col)) val = val === null ? null : num(val);
    if (col === 'points' && val === null) val = 0;
    const patch = { [col]: val };
    // تنظيف الحقول التابعة
    if (col === 'payment' && val !== 'credit') patch.credit_months = null;
    if (col === 'payer' && val !== 'customer') patch.transport_amt = 0;
    if (col === 'ld' && !val) patch.ld_pct = null;
    await save(inv, patch, !!el.dataset.rer || Object.keys(patch).length > 1);
  });
}
