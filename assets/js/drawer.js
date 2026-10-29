import { S, COLS, subName, stepInfo, PAY, PAY_LEGACY, PAYER, PAYER_LEGACY, MONTHS, POINT_RATE, hasRole, isReq, getInv, userName, reps, isActive, isUrgent,
  ldAmount, transportAdded, totalAfterTransport, pointsPct, discPct, onChange, NOTIF_LEVELS } from './state.js';
import { renderBoard } from './board.js';
import { $, esc, num, fmt, money, pct, dt, dOnly, ic, toast, ask, cur, rate, numAttrs, numVal, shareInv } from './util.js';
import { sb, rpc, refreshInvoice, loadCustomers, LOCAL } from './api.js';
import { can } from './can.js';
import { run, waitingOn, missingBasic, missingTerms } from './actions.js';
import { avatarHTML } from './avatars.js';
import { highlightMentions } from './mentions.js';

// pending: تعديلات مكتوبة بالدرج وما انحفظت بعد (تنحفظ بزر "حفظ التعديلات")
let extra = { comments: [], log: [], pdfUrl: null, costEdit: false, pending: {}, pendingCost: null, valCur: null, iqd: null, manualQuote: false };
let returnFocus = null;
// الأقسام المطوية تبقى مثل ما تركها المستخدم (حتى بعد ما يسكّر الموقع)
let shown = {};
try { shown = JSON.parse(localStorage.getItem('ib_secs') || '{}') || {} } catch (e) { }
// قسم ينطوي بسهم. إذا المستخدم ما لمسه، ينفتح القسم اللي يخص مرحلة الطلب بس (open)
function sec(k, title, body, { note = '', lock = '', open = false, force = false } = {}) {
  const o = force || (k in shown ? shown[k] : open);
  return `<details class="more sec" data-more="${k}" ${o ? 'open' : ''}><summary><span class="sec-t">${title}</span>${note ? `<span class="sec-note">${note}</span>` : ''}${lock}</summary><div class="sec-body">${body}</div></details>`;
}
const lockTag = t => `<span class="lock">${ic('lock')}${t}</span>`;

export async function openDrawer(id, push = true) {
  const wasOpen = !!S.drawerId;
  if (S.drawerId !== id) extra = { comments: [], log: [], pdfUrl: null, costEdit: false, pending: {}, pendingCost: null, valCur: null, iqd: null, manualQuote: false };
  else Object.assign(extra, { comments: [], log: [], pdfUrl: null });
  S.drawerId = id;
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
  const [c, l] = await Promise.all([loadComments(id), sb.from('invoice_log').select('*').eq('invoice_id', id).order('at'), loadUrgLeft()]);
  extra.comments = c; extra.log = l.data || [];
  const inv = getInv(id);
  if (inv && inv.pdf_path) { const { data } = await sb.storage.from('invoices').createSignedUrl(inv.pdf_path, 3600); extra.pdfUrl = data && data.signedUrl }
  if (S.drawerId === id) renderDrawer();
}

// التعليقات مع تفاعلاتها (016). قبل ما تتشغل 016 التعليقات تطلع بدون تفاعلات
async function loadComments(id) {
  const { data } = await sb.from('invoice_comments').select('*').eq('invoice_id', id).order('at');
  const list = data || [];
  const r = list.length ? await sb.from('comment_reactions').select('comment_id,user_id,emoji').in('comment_id', list.map(c => c.id)) : { data: [] };
  list.forEach(c => { c.reactions = r.error ? null : (r.data || []).filter(x => x.comment_id === c.id) });
  return list;
}

// كم طلب باقي يتأشر طارئ اليوم (025). null = بلا حد أو القاعدة قبل 025
let urgLeft = null;
// بداية اليوم بتوقيت بغداد (UTC+3 بلا توقيت صيفي) — نفس day_start بالقاعدة
const BGD = 3 * 3600e3;
const todayStart = () => new Date(Math.floor((Date.now() + BGD) / 864e5) * 864e5 - BGD);
async function loadUrgLeft() {
  const { data, error } = await sb.rpc('urgent_left');
  urgLeft = error ? null : data;
}

// بعد أي إجراء: التعليقات والسجل ممكن تغيّرت (سبب الإرجاع/النقل ينكتب تعليق)
export async function reloadActivity(id) {
  if (S.drawerId !== id) return;
  const [c, l] = await Promise.all([loadComments(id), sb.from('invoice_log').select('*').eq('invoice_id', id).order('at'), loadUrgLeft()]);
  if (S.drawerId !== id) return;
  extra.comments = c; extra.log = l.data || [];
  renderDrawer();
}

const dirty = () => Object.keys(extra.pending).length > 0 || extra.pendingCost != null;
const clearPending = () => { extra.pending = {}; extra.pendingCost = null; extra.costEdit = false; extra.valCur = null; extra.iqd = null };
const same = (a, b) => String(a ?? '') === String(b ?? '');

// زر الحفظ يتحدث بدون إعادة رسم الدرج (حتى ما يضيع المؤشر من الحقل)
function paintSaveBar() {
  const bar = $('#saveBar'); if (!bar) return;
  const n = Object.keys(extra.pending).length + (extra.pendingCost != null ? 1 : 0);
  bar.style.display = n ? 'flex' : 'none'; // inline حتى ما يتعارض ويا display بالستايل
  $('#saveN').textContent = n === 1 ? 'تعديل واحد ما انحفظ' : `${n} تعديلات ما انحفظت`;
}

// الإغلاق يمر من التاريخ (history) حتى يبقى متطابق مع زر الرجوع؛ popstate يستدعي hideDrawer
export function closeDrawer(force) {
  const dr = S.drawerId === 'draft' && S.draft;
  if (force !== true && dr && (dr.customer_id || dr.value || dr.quote_no || dr.res_no || S.draftFile))
    return ask('تجاهل الطلب الجديد؟', [], () => closeDrawer(true), { okText: 'تجاهل', danger: true, msg: 'الطلب ما انحفظ، وإذا طلعت تروح البيانات اللي كتبتها.' });
  if (force !== true && S.drawerId !== 'draft' && dirty())
    return ask('تجاهل التعديلات؟', [], () => { clearPending(); closeDrawer(true) }, { okText: 'تجاهل', danger: true, msg: 'عندك تعديلات ما انحفظت، وإذا طلعت تروح.' });
  if (S.drawerId && history.state && history.state.drawer) { history.back(); return }
  hideDrawer();
}

// طلب جديد: يتعبى بالدرج محلياً، وبس من يضغط "حفظ الطلب" ينضاف للقاعدة ويطلع كبطاقة
export function openDraft(rep_id) {
  S.draft = { id: 'draft', stage: 'new', rep_id, customer: '', customer_id: null, quote_no: null, res_no: null, value: null, disc_req: false, disc_pct: null, created_at: new Date().toISOString() };
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
    ...(S.board ? { board_id: S.board } : {}),
    rep_id: dr.rep_id, customer_id: dr.customer_id, customer: dr.customer, quote_no: dr.quote_no ?? '', res_no: dr.res_no ?? '', value: dr.value ?? 0,
    ...(dr.disc_req ? { disc_req: true, disc_pct: dr.disc_pct } : {}),
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
// الحقل اللي تغير وما انحفظ: يتلون ويبين جنبه شنو كانت قيمته قبل
const pendingHas = col => S.drawerId !== 'draft' && col in extra.pending;
function wasText(col, opts) {
  const v = (getInv(S.drawerId) || {})[col];
  if (v === null || v === undefined || v === '') return 'فارغ';
  if (typeof v === 'boolean') return v ? 'مفعّل' : 'مو مفعّل';
  if (opts) return opts[v] ?? String(v);
  if (col === 'rep_id') return userName(v);
  return typeof v === 'number' ? fmt(v) : String(v);
}
const wasHTML = (col, opts) => `<div class="was">${ic('back')}قبل: <b>${esc(wasText(col, opts))}</b></div>`;

function fld(label, col, val, { type = 'text', req = false, dis = false, full = false, opts = null, help = '', rer = false, list = '' } = {}) {
  const id = 'f_' + col; let input;
  const chg = pendingHas(col);
  if (opts) input = `<select id="${id}" data-f="${col}" ${rer ? 'data-rer="1"' : ''} ${dis ? 'disabled' : ''}><option value="">— اختر —</option>${Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${String(val) === String(k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea id="${id}" data-f="${col}" ${dis ? 'disabled' : ''}>${esc(val)}</textarea>`;
  else input = `<input ${type === 'number' ? numAttrs : `type="${type}"`} id="${id}" data-f="${col}" value="${esc(type === 'number' ? numVal(val) : val ?? '')}" ${dis ? 'disabled' : ''} ${rer ? 'data-rer="1"' : ''} ${list ? `list="${list}"` : ''}>`;
  return `<div class="fld ${full ? 'full' : ''}${chg ? ' chg' : ''}"><label for="${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>${input}${help ? `<div class="help">${help}</div>` : ''}${chg ? wasHTML(col, opts) : ''}</div>`;
}
// قيمة الفاتورة تنحفظ بالدولار. اللي يعدلها يختار العملة أول؛ الدينار ينقسم على سعر الصرف
function valueFld(inv, eb) {
  const help = eb && can('editValue', inv) ? 'يعدلها المحاسب بمرحلة الحسابات' : '';
  if (!can('editValue', inv)) return fld(`قيمة الفاتورة (${cur()})`, 'value', inv.value, { type: 'number', dis: true });
  const vc = extra.valCur ?? (filled(inv.value) && inv.value ? 'usd' : '');
  const pick = `<div class="fld"><label for="f_valcur">عملة الفاتورة <span class="req">*</span></label>
    <select id="f_valcur" data-valcur="1"><option value="">— اختر —</option>${[['usd', 'دولار'], ['iqd', 'دينار']].map(([k, t]) => `<option value="${k}" ${vc === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  if (!vc) return pick + `<div class="fld"><label for="f_value">قيمة الفاتورة${isReq('value') ? ' <span class="req">*</span>' : ''}</label><input ${numAttrs} id="f_value" disabled placeholder="اختار العملة أول"></div>`;
  if (vc === 'usd') return pick + fld(`قيمة الفاتورة (${cur()})`, 'value', inv.value, { type: 'number', req: isReq('value'), rer: true, help });
  const conv = extra.iqd ? `= ${money(inv.value)} (سعر الصرف ${fmt(rate())})` : `تنقسم على سعر الصرف ${fmt(rate())} وتنحفظ بالدولار`;
  return pick + `<div class="fld${pendingHas('value') ? ' chg' : ''}"><label for="f_value">قيمة الفاتورة (دينار)${isReq('value') ? ' <span class="req">*</span>' : ''}</label>
    <input ${numAttrs} id="f_value" data-iqd="1" value="${esc(numVal(extra.iqd))}"><div class="help">${conv}${help ? ' · ' + help : ''}</div>${pendingHas('value') ? wasHTML('value') : ''}</div>`;
}
const tog = (label, col, val, dis) => `<label class="toggle${pendingHas(col) ? ' chg' : ''}" for="f_${col}"><input type="checkbox" id="f_${col}" data-f="${col}" data-rer="1" ${val ? 'checked' : ''} ${dis ? 'disabled' : ''}>${label}${pendingHas(col) ? `<span class="was">قبل: <b>${esc(wasText(col))}</b></span>` : ''}</label>`;
const filled = v => String(v ?? '').trim() !== '';

// شريط المراحل: المفعّلة حسب إعداد الأدمن (+ خطوة الطلب الحالية لو مطفية)
function stepsHTML(inv) {
  const mid = S.STEPS.filter(e => e.on !== false || (inv.stage === 'decision' && inv.sub === e.k)).map(e => [e.k, stepInfo(e.k).t]);
  const seq = [['new', 'طلب'], ['acc', 'حسابات'], ...mid, ['done', 'تمت']];
  if (inv.stage === 'cancel') return `<div class="steps">${seq.map(s => `<div class="step cancel"><div class="ln"></div>${esc(s[1])}</div>`).join('')}</div>`;
  const pos = inv.stage === 'decision' ? seq.findIndex(s => s[0] === inv.sub) : seq.findIndex(s => s[0] === inv.stage);
  return `<div class="steps">${seq.map((s, i) => `<div class="step ${i < pos || inv.stage === 'done' ? 'done' : i === pos ? 'cur' : ''}"><div class="ln"></div>${esc(s[1])}</div>`).join('')}</div>`;
}

function deleteReqHTML(inv) {
  if (!inv.delete_req_at) return '';
  const btn = (a, label, cls) => can(a, inv) ? `<button class="btn sm ${cls}" data-act="${a}">${label}</button>` : '';
  const mine = inv.delete_req_by === S.ME.id;
  return `<div class="warnbox">${ic('trash')} <b>طلب حذف</b> من ${esc(userName(inv.delete_req_by))} — ${dOnly(inv.delete_req_at)}<br>السبب: ${esc(inv.delete_req_reason)}
    <div class="row">${btn('delete', 'حذف', 'bad')}${can('trash') ? btn('cancelDeleteReq', mine ? 'إلغاء الطلب' : 'رفض طلب الحذف', '') : mine ? btn('cancelDeleteReq', 'إلغاء طلبي', '') : ''}</div></div>`;
}

function actionsHTML(inv) {
  if (inv.id === 'draft') return `<div class="actions"><div class="wait">${ic('file')}<span>طلب جديد — ما يطلع باللوحة لحد ما تحفظه</span></div>
    <div class="row"><button class="btn primary" id="saveDraft">${ic('check')}حفظ الطلب</button></div></div>`;
  const btn = (a, label, cls = '', icn = '') => can(a, inv) ? `<button class="btn ${cls}" data-act="${a}">${icn ? ic(icn) : ''}${label}</button>` : '';
  const btns = [btn('sendToAcc', 'إرسال للحسابات', 'primary', 'check'), btn('sendToDecision', 'إرسال للقرار', 'primary', 'check'),
    btn('returnToRep', 'إرجاع للمندوب', 'bad', 'back'),
    btn('approve', 'موافقة على الشروط', 'ok', 'check'), btn('returnToAcc', 'إرجاع للحسابات', 'bad', 'back'),
    btn('custAccept', 'الزبون موافق', 'ok', 'check'), btn('custRefuse', 'الزبون رفض', 'bad', 'x'),
    btn('complete', 'تحويل لمبيعات + رقم المبيعات', 'ok', 'check'),
    inv.stage === 'decision' ? btn('stepPass', 'تم: ' + esc(stepInfo(inv.sub).t), 'ok', 'check') : '', btn('stepBack', 'إرجاع للحسابات', 'bad', 'back')].join('');
  // الحد اليومي: نفس الطلب اليوم ما ينحسب مرتين (025)
  const urgFree = inv.urgent_by === S.ME.id && inv.urgent_at && new Date(inv.urgent_at) >= todayStart();
  const urgOut = !inv.urgent && urgLeft === 0 && !urgFree;
  const urgTxt = inv.urgent ? 'شيل علامة طارئ' : urgLeft == null || urgFree ? 'طارئ' : `طارئ (باقي ${urgLeft} اليوم)`;
  const small = [btn('move', 'نقل لمرحلة ثانية', 'sm', 'board'), btn('setBoard', 'نقل لبورد ثاني', 'sm', 'board'), can('toggleUrgent', inv) ? `<button class="btn sm ${inv.urgent ? '' : 'bad'}" data-act="toggleUrgent" aria-pressed="${!!inv.urgent}" ${urgOut ? 'disabled title="وصلت الحد اليومي للطلبات الطارئة"' : ''}>${ic('flame')}${urgOut ? 'خلص حد الطارئ اليوم' : urgTxt}</button>` : '', btn('requestDelete', 'طلب حذف', 'bad sm', 'trash'), inv.delete_req_at ? '' : btn('delete', 'حذف', 'bad sm', 'trash')].join('');
  let wait;
  if (inv.stage === 'done') wait = inv.sales_no ? `تمت برقم مبيعات <b>${esc(inv.sales_no)}</b> — ${dOnly(inv.closed_at)}` : `تمت — ${dOnly(inv.closed_at)}`;
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
  return `<div class="fld full${pendingHas('customer') ? ' chg' : ''}"><label for="f_customer_pick">اسم الزبون${isReq('customer') ? ' <span class="req">*</span>' : ''}</label>
    <input type="search" id="f_customer_pick" list="custList" value="${esc(inv.customer)}" autocomplete="off" placeholder="ابحث عن الزبون...">
    <datalist id="custList">${S.CUSTOMERS.filter(c => c.active).map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>${warn}${pendingHas('customer') ? wasHTML('customer') : ''}</div>`;
}

function costFld(inv) {
  if (!can('setCost', inv)) return '';
  const chg = h => extra.pendingCost != null ? h.replace('class="fld ', 'class="fld chg ').replace(/<\/div>$/, `<div class="was">${ic('back')}قبل: <b>${S.COSTS[inv.id] != null ? esc(fmt(S.COSTS[inv.id])) : 'فارغ'}</b></div></div>`) : h;
  if (hasRole('admin')) return chg(fld(`سعر الكلفة (${cur()}) — للأدمن فقط`, 'cost', extra.pendingCost ?? S.COSTS[inv.id] ?? '', { type: 'number', req: isReq('cost'), help: 'ما يظهر لأي أحد غيرك' }).replace('data-f="cost"', 'data-cost="1"'));
  if (inv.cost_set && !extra.costEdit)
    return `<div class="fld"><label>سعر الكلفة</label><div class="cost-set">${ic('check')}مسجّل (مخفي) <button class="btn sm" data-costedit="1">تغيير</button></div></div>`;
  return fld(`سعر الكلفة (${cur()})`, 'cost', extra.pendingCost ?? '', { type: 'number', req: isReq('cost'), help: 'بعد الحفظ يختفي ومحد يشوفه غير الأدمن' }).replace('data-f="cost"', 'data-cost="1"');
}

function termsHTML(inv) {
  const et = !can('editTerms', inv);
  const payOpts = { ...PAY, ...(PAY_LEGACY[inv.payment] ? { [inv.payment]: PAY_LEGACY[inv.payment] } : {}) };
  const payerOpts = { ...PAYER, ...(PAYER_LEGACY[inv.payer] ? { [inv.payer]: PAYER_LEGACY[inv.payer] } : {}) };
  const tr = transportAdded(inv);
  const note = [inv.payment ? (PAY[inv.payment] || PAY_LEGACY[inv.payment]) + (inv.payment === 'credit' && inv.credit_months ? ' ' + (MONTHS[inv.credit_months] || '') : '') : '',
    inv.payer ? 'نقل ' + (PAYER[inv.payer] || PAYER_LEGACY[inv.payer]) : ''].filter(Boolean).join(' · ');
  const miss = S.lastMissing && S.lastMissing.id === inv.id;
  return sec('terms', 'السداد والنقل', `
    <div class="grid">
      ${fld('طريقة السداد', 'payment', inv.payment, { opts: payOpts, req: isReq('payment'), dis: et, rer: true })}
      ${inv.payment === 'credit' ? fld('مدة الآجل', 'credit_months', inv.credit_months, { opts: MONTHS, req: true, dis: et, rer: true }) : '<div></div>'}
      ${fld('النقل', 'payer', inv.payer, { opts: payerOpts, req: isReq('payer'), dis: et, rer: true })}
      ${inv.payer === 'customer' ? fld(`أجور النقل (${cur()})`, 'transport_amt', inv.transport_amt, { type: 'number', req: true, dis: et, rer: true, help: 'تنضاف على قيمة الفاتورة' }) : '<div></div>'}
      <div class="fld full"><div class="help">الإجمالي بعد النقل: <b>${money(totalAfterTransport(inv))}</b>${tr ? ` (${money(inv.value)} + ${money(tr)})` : ''}</div></div>
      ${fld('عدد النقاط', 'points', inv.points, { type: 'number', dis: et, rer: true, help: `نسبة النقاط: ${fmt(pointsPct(inv))}% (النقطة = ${POINT_RATE}%)` })}
      ${costFld(inv)}
      <div class="term-box">${tog('خصم لاحق', 'ld', inv.ld, et)}${lastDiscHTML(inv, 'ld', et)}
        ${inv.ld ? `<div class="grid">${fld('نسبة الخصم %', 'ld_pct', inv.ld_pct, { type: 'number', req: true, dis: et, rer: true })}
          <div class="fld"><div class="help" style="margin-top:28px">مبلغ الخصم: <b>${money(ldAmount(inv))}</b></div></div></div>` : ''}</div>
      ${changesHTML(inv)}
    </div>`, { note, lock: et ? lockTag('يعدلها المحاسب') : '', open: inv.stage === 'acc', force: miss })
    + custStateHTML(inv, et, miss);
}

// شنو تغيّر على الطلب عند المدير: من أول ما وصل للمدير (أول "أرسل الطلب للقرار" بعد آخر إرسال للحسابات)
// لحد هسه — يشمل اللي عدله المحاسب بعد ما رجعه المدير. من سجل الحركة ("عدّل الحقل: قبل ← بعد")
// نجمع كل حقل من أول قيمة لآخر قيمة، واللي رجع مثل ما كان ما ينذكر
function orderChanges() {
  const log = extra.log;
  let sent = -1;
  log.forEach((l, i) => { if (l.body === 'أرسل الطلب للحسابات') sent = i });
  const from = log.findIndex((l, i) => i > sent && l.body === 'أرسل الطلب للقرار');
  if (from < 0) return null;
  const ch = new Map();
  for (const l of log.slice(from + 1)) {
    if (!l.body.startsWith('عدّل ')) continue;
    for (const part of l.body.slice(5).split('، ')) {
      const c = part.indexOf(': '), a = part.indexOf(' ← ');
      if (c < 0 || a < c) continue;
      const k = part.slice(0, c), o = part.slice(c + 2, a), n = part.slice(a + 3);
      if (ch.has(k)) ch.get(k).n = n; else ch.set(k, { o, n });
    }
  }
  for (const [k, v] of ch) if (v.o === v.n) ch.delete(k);
  return describeChanges(ch, getInv(S.drawerId) || {});
}

// جمل مفهومة: الحقول المترابطة تنكتب بجملة وحدة ويا القيمة (مثلاً الخصم ونسبته ومبلغه)
const B = v => `<b>${esc(v)}</b>`;
const amtText = (inv, p) => [inv[p + '_iqd'] != null && ['iqd', 'both'].includes(inv[p + '_cur']) ? fmt(inv[p + '_iqd']) + ' د.ع' : '',
  inv[p + '_usd'] != null && ['usd', 'both'].includes(inv[p + '_cur']) ? '$' + fmt(inv[p + '_usd']) : ''].filter(Boolean).join(' + ') || '—';
function describeChanges(ch, inv) {
  const out = [], take = k => { const v = ch.get(k); ch.delete(k); return v };
  const pctDiscount = (on, pk, name, amount) => {
    const T = take(on), P = take(pk);
    if (T && T.n === 'نعم') out.push(`انضاف ${name} بنسبة ${B(P ? P.n : '')}%، بقيمة ${B(money(amount))}`);
    else if (T && T.n === 'لا') out.push(`انشال ${name}${P && P.o !== '—' ? ` (كان ${B(P.o)}%)` : ''}`);
    else if (P) out.push(`تغيّرت نسبة ${name} من ${B(P.o)}% إلى ${B(P.n)}%، وصارت قيمته ${B(money(amount))}`);
  };
  pctDiscount('خصم لاحق', 'نسبة الخصم اللاحق', 'الخصم اللاحق', ldAmount(inv));
  pctDiscount('طلب خصم', 'نسبة طلب الخصم', 'طلب الخصم', num(inv.value) * discPct(inv) / 100);

  const V = take('القيمة');
  if (V) out.push(`تغيّرت قيمة الفاتورة من ${B(V.o === '—' ? '—' : V.o + ' ' + cur())} إلى ${B(V.n === '—' ? '—' : V.n + ' ' + cur())}`);

  const Pay = take('طريقة السداد'), M = take('أشهر الآجل');
  const months = inv.credit_months ? ` لمدة ${MONTHS[inv.credit_months] || inv.credit_months + ' أشهر'}` : '';
  if (Pay) out.push(`تغيّرت طريقة السداد من ${B(Pay.o)} إلى ${B(Pay.n)}${Pay.n === 'آجل' ? months : ''}`);
  else if (M) out.push(`تغيّرت مدة الآجل من ${B(M.o)} إلى ${B(M.n)} شهر`);

  const Tr = take('التوصيل'), Ta = take('أجور النقل');
  if (Tr) out.push(Tr.n === 'على الزبون' ? `صار النقل على الزبون بأجور ${B(money(inv.transport_amt))}` : `تغيّر النقل من ${B(Tr.o)} إلى ${B(Tr.n)}`);
  else if (Ta) out.push(`تغيّرت أجور النقل من ${B(Ta.o)} إلى ${B(Ta.n)}`);

  const Pt = take('النقاط');
  if (Pt) out.push(`تغيّر عدد النقاط من ${B(Pt.o)} إلى ${B(Pt.n)} (نسبة النقاط صارت ${fmt(pointsPct(inv))}%)`);

  const D = take('على الزبون دين'), dx = ['عملة الدين', 'الدين بالدينار', 'الدين بالدولار', 'مبلغ الدين'].map(take).some(Boolean);
  if (D && D.n === 'نعم' || (!D && dx && inv.cust_debt)) out.push(`${D ? 'صار' : 'تغيّر'} دين الزبون: ${B(amtText(inv, 'debt'))}`);
  else if (D) out.push(D.n === 'لا' ? 'الزبون ما عليه دين' : 'انمسح جواب الدين');
  if (['عملة الرصيد', 'الرصيد بالدينار', 'الرصيد بالدولار'].map(take).some(Boolean)) out.push(`صار رصيد الزبون: ${B(amtText(inv, 'bal'))}`);

  // أي حقل ثاني
  for (const [k, { o, n }] of ch) {
    if (['نعم', 'لا'].includes(n) && ['نعم', 'لا', '—'].includes(o)) out.push(n === 'نعم' ? `انضاف ${k}` : `انشال ${k}`);
    else if (o === '—') out.push(`تحدد ${k}: ${B(n)}`);
    else if (n === '—') out.push(`انمسح ${k} (كان ${esc(o)})`);
    else out.push(`تغيّر ${k} من ${B(o)} إلى ${B(n)}`);
  }
  return out;
}
function changesHTML(inv) {
  if (!['decision', 'done', 'cancel'].includes(inv.stage)) return '';
  const list = orderChanges();
  if (!list) return '';
  return `<div class="term-box"><div class="help" style="font-weight:600;margin-bottom:6px">${ic('back')} شنو تغيّر على الطلب عند المدير</div>
    ${list.length ? `<ul style="margin:0;padding-inline-start:18px;line-height:1.9">${list.map(x => `<li>${x}</li>`).join('')}</ul>` : '<div class="help">ما تغيّر شي عند المدير — نفس الشروط اللي أرسلها المحاسب.</div>'}</div>`;
}

// حالة الزبون (019/021) قسم وحده: عليه دين؟ نعم/لا، وإذا نعم عملته ومبلغه. والرصيد دائماً
const BAL_CUR = { iqd: 'دينار', usd: 'دولار', both: 'دينار ودولار' };
// مبلغ لكل عملة: p = 'debt' أو 'bal'
const amounts = (p, pre, inv, req, dis) => { const c = inv[p + '_cur'];
  return (c === 'iqd' || c === 'both' ? fld(`${pre} بالدينار (د.ع)`, p + '_iqd', inv[p + '_iqd'], { type: 'number', req, dis, rer: true }) : '')
    + (c === 'usd' || c === 'both' ? fld(`${pre} بالدولار ($)`, p + '_usd', inv[p + '_usd'], { type: 'number', req, dis, rer: true }) : '') };
function custStateHTML(inv, dis, force) {
  if (!('debt_cur' in inv)) return ''; // قبل ما تتشغل 021
  const rq = isReq('cust'), d = inv.cust_debt, chg = pendingHas('cust_debt');
  const yn = [[true, 'نعم'], [false, 'لا']].map(([v, t]) => `<label class="chk"><input type="radio" name="cust_debt" data-f="cust_debt" data-rer="1" value="${v}" ${d === v ? 'checked' : ''} ${dis ? 'disabled' : ''}> ${t}</label>`).join('');
  const note = d == null ? '' : d ? 'عليه دين: ' + amtText(inv, 'debt') : 'ما عليه دين';
  return sec('cust', 'حالة الزبون', `
    <div class="grid">
      <div class="fld full${chg ? ' chg' : ''}"><label>هل على الزبون دين؟${rq ? ' <span class="req">*</span>' : ''}</label>
        <div role="radiogroup" aria-label="هل على الزبون دين" style="display:flex;gap:8px;flex-wrap:wrap">${yn}</div>${chg ? `<div class="was">${ic('back')}قبل: <b>${esc(wasDebt())}</b></div>` : ''}</div>
      ${d ? `<div class="term-box"><div class="grid">${fld('عملة الدين', 'debt_cur', inv.debt_cur, { opts: BAL_CUR, req: true, dis, rer: true })}<div></div>${amounts('debt', 'الدين', inv, true, dis)}</div></div>` : ''}
      <div class="term-box"><div class="help" style="font-weight:600;margin-bottom:6px">رصيد الزبون</div><div class="grid">
        ${fld('عملة الرصيد', 'bal_cur', inv.bal_cur, { opts: BAL_CUR, req: rq, dis, rer: true })}<div></div>${amounts('bal', 'الرصيد', inv, rq, dis)}</div></div>
    </div>`, { note: esc(note), lock: dis ? lockTag('يعدلها المحاسب') : '', open: inv.stage === 'acc', force });
}
const wasDebt = () => { const v = (getInv(S.drawerId) || {}).cust_debt; return v == null ? 'ما انجاوب' : v ? 'نعم' : 'لا' };

// الربح: إذا اكو تعديلات ما انحفظت، نحسب النتيجة الجديدة بالمتصفح ونبينها جنب القديمة (نفس معادلة inv_profit_rows)
function profitHTML(inv) {
  if (!can('seeProfit', inv)) return '';
  const real = getInv(inv.id), p = S.PROFITS[inv.id];
  const costNow = extra.pendingCost ?? (hasRole('admin') ? S.COSTS[inv.id] : null);
  const lock = lockTag('للأدمن والمدير'), open = inv.stage === 'decision';
  if (!p && costNow == null) return sec('profit', 'الربح', `<div class="help">${inv.cost_set ? 'جاري الحساب...' : 'ما انكتب سعر الكلفة بعد'}</div>`, { lock, open });
  // الكلفة: الأدمن يعرفها، والمدير نطلعها من الربح والإجمالي المحفوظين
  const cost = costNow != null ? num(costNow) : num(p.total) * (1 - num(p.gross_pct) / 100);
  const calc = x => {
    const total = totalAfterTransport(x), gross = total ? (1 - cost / total) * 100 : 0;
    const ld = x.ld ? num(x.ld_pct) : 0, disc = discPct(x), pts = pointsPct(x);
    return { total, gross, ld, disc, pts, net: gross - ld - disc - pts };
  };
  const now = calc(inv), before = p ? { ...calc(real), total: num(p.total), gross: num(p.gross_pct), net: num(p.net_pct) } : null;
  const preview = dirty();
  // صف: القيمة الجديدة، وإذا تغيرت تتلون وتبين القديمة جنبها
  const row = (label, k, f, cls = '') => {
    const ch = preview && before && Math.abs(now[k] - before[k]) > 0.005;
    return `<tr class="${cls}${ch ? ' chg' : ''}"><td>${label}</td><td>${ch ? `<s class="old">${f(before[k])}</s> ` : ''}<span class="${k === 'net' ? (now.net >= 0 ? 'pos' : 'neg') : ''}">${f(now[k])}</span></td></tr>`;
  };
  return sec('profit', 'الربح', `
    ${preview ? `<div class="preview-note">${ic('clock')}معاينة — هذي النتيجة بعد حفظ التعديلات</div>` : ''}
    <div class="profit${preview ? ' previewing' : ''}"><table>
      ${row('الإجمالي بعد النقل', 'total', money)}
      ${hasRole('admin') && costNow != null ? `<tr class="${extra.pendingCost != null ? 'chg' : ''}"><td>سعر الكلفة</td><td>${extra.pendingCost != null && S.COSTS[inv.id] != null ? `<s class="old">${money(S.COSTS[inv.id])}</s> ` : ''}${money(costNow)}</td></tr>` : ''}
      ${row('الربح (1 − الكلفة ÷ الإجمالي)', 'gross', pct)}
      ${row('− الخصم اللاحق', 'ld', pct)}
      ${row('− طلب خصم المندوب', 'disc', pct)}
      ${row(`− النقاط (${fmt(inv.points)} × ${POINT_RATE})`, 'pts', pct)}
      ${row('<b>صافي الربح</b>', 'net', pct, 'net')}
    </table></div>`, { note: 'صافي ' + pct(now.net), lock, open: open || preview });
}

// آخر خصم انعطى لنفس الزبون (025) — من كل الطلبات حتى اللي ما يشوفها المستخدم. ينجاب مرة لكل زبون
const lastDisc = {};
function lastDiscHTML(inv, kind, dis) {
  if (!inv.customer_id) return '';
  const key = inv.customer_id + ':' + inv.id, c = lastDisc[key];
  if (c === undefined) { loadLastDisc(inv.customer_id, inv.id, key); return '' }
  if (!c || c === 'wait') return '';   // قبل 025، أو لسه يتحمل
  const name = kind === 'ld' ? 'خصم لاحق' : 'خصم', x = c[kind];
  if (!x) return `<div class="last-disc help">${ic('clock')}ما انعطى ${name} لهذا الزبون قبل</div>`;
  const now = kind === 'ld' ? (inv.ld ? num(inv.ld_pct) : 0) : discPct(inv);
  return `<div class="last-disc">${ic('clock')}<span>آخر ${name} لهذا الزبون: <b>${fmt(x.pct)}%</b> · طلب #${x.invoice_id} · ${dOnly(x.at)}</span>
    ${!dis && num(x.pct) !== now ? `<button type="button" class="btn sm" data-lastdisc="${kind}" data-pct="${esc(x.pct)}">استخدم ${fmt(x.pct)}%</button>` : ''}</div>`;
}
async function loadLastDisc(cid, id, key) {
  lastDisc[key] = 'wait';
  const { data, error } = await sb.rpc('cust_last_disc', { p_customer: cid, p_except: id === 'draft' ? null : id });
  lastDisc[key] = error ? null : Object.fromEntries((data || []).map(r => [r.kind, r]));
  if (S.drawerId === id) renderDrawer();
}

// طلب خصم من المندوب: نسبة تنطرح من صافي الربح (015)
function discHTML(inv, dis) {
  if (!('disc_req' in inv)) return ''; // قبل ما تتشغل 015
  return `<div class="term-box">${tog('طلب خصم', 'disc_req', inv.disc_req, dis)}${lastDiscHTML(inv, 'disc', dis)}
    ${inv.disc_req ? `<div class="grid">${fld('نسبة الخصم المطلوبة %', 'disc_pct', inv.disc_pct, { type: 'number', req: true, dis, rer: true })}
      <div class="fld"><div class="help" style="margin-top:28px">مبلغ الخصم: <b>${money(num(inv.value) * discPct(inv) / 100)}</b><br>القيمة بعد الخصم: <b>${money(num(inv.value) * (1 - discPct(inv) / 100))}</b></div></div></div>` : ''}</div>`;
}

// تعليق: صاحبه يعدله ويحذفه، والأدمن يحذف أي تعليق (نفس قواعد comment_edit/comment_delete بـ 011)
function commentHTML(c) {
  const mine = c.author === S.ME.id;
  const canEdit = mine && !c.is_system, canDel = hasRole('admin') || canEdit;
  const acts = canEdit || canDel ? `<span class="c-acts">${canEdit ? `<button type="button" class="c-act" data-cedit="${c.id}">تعديل</button>` : ''}${canDel ? `<button type="button" class="c-act bad" data-cdel="${c.id}">حذف</button>` : ''}</span>` : '';
  return `<div class="comment ${c.is_system ? 'sys' : ''}${mine ? ' mine' : ''}">${avatarHTML(c.author, 30, 'c-av')}<div class="c-main"><div class="by"><b>${esc(userName(c.author))}</b> · ${dt(c.at)}${c.edited_at ? ' · معدّل' : ''}${acts}</div><div class="c-body">${highlightMentions(esc(c.body))}</div>${reactionsHTML(c)}</div></div>`;
}

// تفاعلات: نفس القائمة اللي بالقاعدة (comment_reactions_emoji_chk)
const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
let pickFor = null;
function reactionsHTML(c) {
  if (!c.reactions) return '';
  const chips = EMOJIS.map(e => {
    const who = c.reactions.filter(r => r.emoji === e); if (!who.length) return '';
    const me = who.some(r => r.user_id === S.ME.id);
    return `<button type="button" class="r-chip${me ? ' me' : ''}" data-react="${c.id}" data-emoji="${e}" aria-pressed="${me}" title="${esc(who.map(r => userName(r.user_id)).join('، '))}">${e}<span>${who.length}</span></button>`;
  }).join('');
  const pick = pickFor === c.id ? `<span class="r-pick" role="group" aria-label="اختار تفاعل">${EMOJIS.map(e => `<button type="button" class="r-opt" data-react="${c.id}" data-emoji="${e}" aria-label="تفاعل ${e}">${e}</button>`).join('')}</span>` : '';
  return `<div class="c-reacts">${chips}<button type="button" class="r-add" data-rpick="${c.id}" aria-label="أضف تفاعل" aria-expanded="${pickFor === c.id}">${pickFor === c.id ? '×' : '☺+'}</button>${pick}</div>`;
}

async function react(id, emoji) {
  pickFor = null;
  const c = extra.comments.find(x => x.id === id); if (!c || !c.reactions) return;
  // نحدّث الشاشة فوراً ونرجّعها إذا فشل
  const before = c.reactions, mine = before.some(r => r.user_id === S.ME.id && r.emoji === emoji);
  c.reactions = mine ? before.filter(r => !(r.user_id === S.ME.id && r.emoji === emoji)) : [...before, { comment_id: id, user_id: S.ME.id, emoji }];
  renderDrawer();
  const r = await rpc('comment_react', { p_id: id, p_emoji: emoji });
  if (!r.ok) { c.reactions = before; renderDrawer() }
}

function editComment(id) {
  const c = extra.comments.find(x => x.id === id); if (!c) return;
  const inv = S.drawerId;
  ask('تعديل التعليق', [{ id: 'b', label: 'التعليق', type: 'textarea', req: true, value: c.body }], async v => {
    if (v.b === c.body) return;
    const r = await rpc('comment_edit', { p_id: id, p_body: v.b }, 'انعدل التعليق');
    if (r.ok) reloadActivity(inv);
  }, { okText: 'حفظ' });
}

function deleteComment(id) {
  const inv = S.drawerId;
  ask('حذف التعليق', [], async () => {
    const r = await rpc('comment_delete', { p_id: id }, 'انحذف التعليق');
    if (r.ok) reloadActivity(inv);
  }, { okText: 'حذف', danger: true, msg: 'ينحذف التعليق نهائياً.' });
}

export function renderDrawer() {
  const real = getInv(S.drawerId); if (!real) return closeDrawer(true);
  const inv = dirty() ? { ...real, ...extra.pending } : real; // الحقول تنعرض بالتعديلات اللي ما انحفظت
  const eb = !can('editBasic', inv), draft = inv.id === 'draft';
  const col = COLS.find(c => c.k === inv.stage);
  // نحافظ على مكان التمرير والحقل المحدد بعد إعادة الرسم
  const body = $('#drawer .d-body'), scroll = body ? body.scrollTop : 0;
  const act = document.activeElement, focusId = act && $('#drawer').contains(act) ? act.id : null;
  // مكان المؤشر بالحقل (التحديثات المباشرة تعيد رسم الدرج وما نريد الكتابة تتخربط)
  const sel = focusId && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
  const qDis = eb || (filled(inv.res_no) && !filled(inv.quote_no));
  const rDis = eb || (filled(inv.quote_no) && !filled(inv.res_no));
  $('#drawer').innerHTML = `
  <div class="d-head">
    <div style="flex:1;min-width:0">
      <div class="sub">${draft ? 'غير محفوظ' : '#' + inv.id} · ${esc(userName(inv.rep_id))} · ${dOnly(inv.created_at)}</div>
      <h3>${esc(inv.customer) || 'طلب جديد'}</h3>
      <span class="badge" style="background:var(--surface-2);color:${inv.stage === 'decision' ? stepInfo(inv.sub).c : col.c};border:1px solid var(--border)">${col.t}${inv.stage === 'decision' ? ' · ' + esc(subName(inv.sub)) : ''}</span>
      ${isUrgent(inv) ? `<span class="badge b-urgent">${ic('flame')}طارئ</span>` : ''}
      ${draft || S.ME.notif_level == null ? '' : `<label class="d-notif" title="شنو يوصلك من إشعارات هذا الطلب">${ic('bell')}<select id="invNotif" aria-label="إشعارات هذا الطلب">
        <option value="">حسب إعدادي العام (${NOTIF_LEVELS[S.ME.notif_level] || ''})</option>
        ${Object.entries(NOTIF_LEVELS).map(([k, t]) => `<option value="${k}" ${S.NPREFS[inv.id] === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`}
    </div>
    ${draft ? '' : `<button class="icon-btn share" title="مشاركة رابط الطلب" aria-label="مشاركة رابط الطلب">${ic('link')}</button>`}
    <button class="icon-btn close" aria-label="إغلاق">${ic('x')}</button>
  </div>
  <div class="d-body">
    ${actionsHTML(inv)}
    ${draft ? '' : sec('steps', 'مراحل الطلب', stepsHTML(inv))}
    ${draft ? '' : profitHTML(inv)}
    ${sec('data', 'بيانات الطلب', `
      <div class="grid">
        ${customerFld(inv, eb)}
        ${fld('رقم عرض السعر', 'quote_no', inv.quote_no, { dis: qDis, help: xtraQuote(inv, qDis) ? 'اضغط حتى تختار من فواتير إكسترا' : '' })}
        ${fld('رقم الحجز', 'res_no', inv.res_no, { dis: rDis, help: 'واحد منهم فقط' })}
        ${valueFld(inv, eb)}
        ${discHTML(inv, !can('editValue', inv))}
        ${hasRole('admin') && inv.stage === 'new' ? fld('المندوب', 'rep_id', inv.rep_id, { opts: Object.fromEntries(reps().map(r => [r.id, r.full_name])), rer: true }) : `<div class="fld"><label>المندوب</label><input type="text" value="${esc(userName(inv.rep_id))}" disabled></div>`}
        <div class="fld full"><label>ملف الفاتورة PDF${isReq('pdf') ? ' <span class="req">*</span>' : ''}</label>
          <div class="pdf">${ic('file')}<span class="name" title="${esc(inv.pdf_name || '')}">${inv.pdf_path || inv.pdf_name ? esc(inv.pdf_name || 'ملف') + ' · ' + Math.round((inv.pdf_size || 0) / 1024) + ' KB' : '<span style="color:var(--faint)">ما مرفوع ملف</span>'}</span>
          ${extra.pdfUrl ? `<a class="btn sm" href="${esc(extra.pdfUrl)}" target="_blank" rel="noopener noreferrer">فتح</a>` : ''}
          ${!eb ? `<label class="btn sm" for="pdfIn">${inv.pdf_path || inv.pdf_name ? 'تغيير' : 'رفع'}</label><input type="file" id="pdfIn" accept="application/pdf" class="hidden">` : ''}</div>
          <div class="help">الحد الأقصى 2 MB${draft && inv.pdf_name ? ' · ينرفع وياه من تحفظ الطلب' : ''}</div></div>
      </div>`, { note: inv.value ? money(inv.value) : '', lock: eb && !can('editValue', inv) ? lockTag('للعرض فقط') : '',
        open: inv.stage === 'new', force: draft || (S.lastMissing && S.lastMissing.id === inv.id && inv.stage === 'new') })}
    ${!draft && can('seeTerms', inv) ? termsHTML(inv) : ''}
    ${draft ? '' : sec('comments', 'التعليقات', `
      ${extra.comments.map(commentHTML).join('') || '<div class="help" style="margin-bottom:8px">لا توجد تعليقات</div>'}
      <div class="add-c">${avatarHTML(S.ME, 30, 'c-av')}<textarea id="cIn" rows="1" data-mention="1" autocomplete="off" placeholder="اكتب تعليق... (@ حتى تذكر شخص · Shift+Enter سطر جديد)" aria-label="تعليق">${esc(cDrafts[S.drawerId] || '')}</textarea><button class="btn primary" id="cBtn">إرسال</button></div>`,
      { note: extra.comments.length ? String(extra.comments.length) : '', open: true, force: !!cDrafts[S.drawerId] })}
    ${draft ? '' : sec('log', 'سجل الحركة', `
      <ul class="timeline">${extra.log.slice().reverse().map(l => `<li><div>${esc(userName(l.actor))}: ${esc(l.body)}</div><div class="t">${dt(l.at)}</div></li>`).join('') || '<li class="help">—</li>'}</ul>`, { note: extra.log.length ? String(extra.log.length) : '' })}
    ${draft ? '' : `<div id="saveBar" role="status" style="position:sticky;bottom:0;z-index:2;display:none;align-items:center;gap:8px;flex-wrap:wrap;margin:12px -4px 0;padding:10px 12px;background:var(--surface);border:1px solid var(--warn);border-radius:12px;box-shadow:0 -6px 18px rgb(0 0 0 / .18)">
      <span id="saveN" style="flex:1;min-width:0;color:var(--warn);font-weight:600"></span>
      <button class="btn sm" id="undoEdits">تراجع</button><button class="btn primary sm" id="saveEdits">${ic('check')}حفظ التعديلات</button></div>`}
  </div>`;
  paintSaveBar();
  $('#drawer .d-body').scrollTop = scroll;
  if (focusId) {
    const f = document.getElementById(focusId);
    if (f && !f.disabled) { f.focus({ preventScroll: true }); if (sel && typeof f.selectionStart === 'number') try { f.setSelectionRange(sel[0], sel[1]) } catch (e) { } }
  }
  growComment();
}

// مسودة التعليق لكل طلب: تبقى لو انرسم الدرج من جديد أو انسد وانفتح
const cDrafts = {};
function growComment() {
  const t = $('#cIn'); if (!t) return;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight + 2, 180) + 'px';
}

// ---------- فواتير إكسترا (نسخة الحاسبة): الضغط على "رقم عرض السعر" يفتح بحث بفواتير المبيعات ----------
// الفاتورة المختارة تعبّي: الرقم، الزبون (ينضاف للقائمة إذا جديد)، والقيمة بعملتها
const xtraQuote = (inv, dis) => LOCAL && !dis && !extra.manualQuote && can('editBasic', inv);
const curName = { usd: 'دولار', iqd: 'دينار' };

function openXtraBills(inv) {
  ask('فواتير المبيعات بإكسترا', [], () => {}, { okText: 'إغلاق' });
  const body = $('#mBody'), modal = $('#modal');
  body.innerHTML = `<div class="fld"><label for="xq">بحث برقم الفاتورة أو اسم الزبون</label><input type="search" id="xq" autocomplete="off" placeholder="مثلاً 125 أو اسم الزبون"></div>
    <div id="xList" class="xbills" role="listbox" aria-label="الفواتير"><div class="help">جاري التحميل...</div></div>
    <button type="button" class="btn sm" id="xManual" style="margin-top:8px">أكتب الرقم يدوياً</button><div class="err" id="mErr" role="alert"></div>`;
  let seq = 0, timer, busy = false;
  const load = async () => {
    const my = ++seq, r = await rpc('xtra_bills', { p_q: $('#xq').value });
    if (my !== seq || !modal.open) return;
    const list = r.ok ? r.data : [];
    $('#xList').innerHTML = !r.ok ? '<div class="help">ما كدرت أقرا من إكسترا</div>' : list.length ? list.map(b => `
      <button type="button" class="xbill" data-xb="${esc(b.guid)}" role="option">
        <span class="xn">#${esc(b.number)}</span><span class="xc">${esc(b.customer || '—')}</span>
        <span class="xv">${fmt(b.net)} ${esc(curName[b.cur] || b.currency || '')}</span><span class="xd">${esc(b.date || '')}</span></button>`).join('')
      : '<div class="help">ماكو فواتير بهذا البحث</div>';
  };
  $('#xq').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250) });
  body.onclick = async e => {
    if (e.target.closest('#xManual')) { extra.manualQuote = true; modal.close(); renderDrawer(); setTimeout(() => { const q = $('#f_quote_no'); q && q.focus() }, 30); return }
    const b = e.target.closest('[data-xb]'); if (!b || busy) return;
    busy = true; b.classList.add('busy');
    const r = await rpc('xtra_pick_bill', { p_guid: b.dataset.xb });
    busy = false; b.classList.remove('busy');
    if (!r.ok) return;
    const x = r.data;
    if (!x.cur) $('#mErr').textContent = `عملة الفاتورة (${x.currency || '؟'}) مو دينار ولا دولار — انحسبت دولار، راجعها`;
    await loadCustomers();
    const usd = x.cur === 'iqd' ? Math.round(x.net / rate() * 100) / 100 : x.net;
    extra.valCur = x.cur === 'iqd' ? 'iqd' : 'usd';
    extra.iqd = x.cur === 'iqd' ? x.net : null;
    const dup = dupRef(inv, 'quote_no', x.number);
    if (dup) { $('#mErr').textContent = `رقم عرض السعر ${x.number} مكرر — مكتوب بالطلب #${dup.id}`; return }
    const patch = { quote_no: x.number, res_no: '', value: usd };
    if (x.customer_id) Object.assign(patch, { customer_id: x.customer_id, customer: x.customer });
    if (x.cur) modal.close();
    stage(inv, patch, true);
    toast(`فاتورة إكسترا #${x.number}: ${x.customer || ''} — ${fmt(x.net)} ${curName[x.cur] || x.currency || ''}`);
  };
  modal.addEventListener('close', () => { body.onclick = null; seq++ }, { once: true });
  load();
  setTimeout(() => $('#xq').focus(), 30);
}

let sending = false;
async function addComment() {
  const id = S.drawerId, v = $('#cIn').value.trim(); if (!v || sending) return;
  sending = true;
  const { error } = await sb.from('invoice_comments').insert({ invoice_id: id, body: v });
  sending = false;
  if (error) return toast(error.message);
  delete cDrafts[id];
  const t = $('#cIn'); if (t && S.drawerId === id) t.value = '';
  extra.comments = await loadComments(id); renderDrawer();
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

// رقم عرض السعر/الحجز مكتوب بطلب ثاني؟ (من الطلبات اللي عندنا، والقاعدة تفحص الكل عند الحفظ)
function dupRef(inv, col, v) {
  v = String(v ?? '').trim().toLowerCase(); if (!v) return null;
  return S.INVOICES.find(i => i.id !== inv.id && !i.deleted_at && String(i[col] ?? '').trim().toLowerCase() === v) || null;
}

// تعديل على طلب محفوظ: ينحط بالانتظار لحد ما ينضغط "حفظ التعديلات"
function stage(inv, patch, rerender) {
  if (inv.id === 'draft') return save(inv, patch, rerender);
  for (const [k, v] of Object.entries(patch)) {
    if (same(v, inv[k])) delete extra.pending[k]; else extra.pending[k] = v;
  }
  if (rerender) renderDrawer(); else paintSaveBar();
}

async function saveEdits() {
  // الحقل اللي بيه المؤشر نثبّته أول، حتى ما تضيع آخر كتابة
  const a = document.activeElement; if (a && $('#drawer').contains(a)) a.blur();
  const inv = getInv(S.drawerId); if (!inv || !dirty()) return;
  const btn = $('#saveEdits'); if (btn.classList.contains('busy')) return;
  btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
  const patch = { ...extra.pending }, cost = extra.pendingCost;
  if (Object.keys(patch).length) {
    if (!await save(inv, patch, false)) { const b = $('#saveEdits'); if (b) { b.classList.remove('busy'); b.removeAttribute('aria-busy') } return }
    extra.pending = {};
  }
  if (cost != null) {
    const r = await rpc('inv_set_cost', { p_id: inv.id, p_cost: cost });
    if (!r.ok) { renderDrawer(); return }
    extra.pendingCost = null; extra.costEdit = false;
    await reloadLog(); await refreshInvoice(inv.id);
  }
  renderDrawer(); toast('انحفظت التعديلات');
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
  d.addEventListener('mousedown', e => { if (e.target.closest('#saveDraft,#saveEdits')) e.preventDefault() });
  d.addEventListener('click', e => {
    if (e.target.closest('.close')) return closeDrawer();
    if (e.target.closest('.d-head .share')) return shareInv(S.drawerId, (getInv(S.drawerId) || {}).customer);
    const a = e.target.closest('[data-act]');
    if (a) return dirty() ? toast('احفظ التعديلات أو تراجع عنها أول') : run(a.dataset.act, S.drawerId);
    if (e.target.closest('#saveEdits')) return saveEdits();
    if (e.target.closest('#undoEdits')) { clearPending(); renderDrawer(); return toast('انلغت التعديلات') }
    const ld = e.target.closest('[data-lastdisc]');
    if (ld) { const inv = getInv(S.drawerId), p = num(ld.dataset.pct); if (inv) stage(inv, ld.dataset.lastdisc === 'ld' ? { ld: true, ld_pct: p } : { disc_req: true, disc_pct: p }, true); return }
    if (e.target.closest('[data-costedit]')) { extra.costEdit = true; renderDrawer(); setTimeout(() => { const c = $('#f_cost'); c && c.focus() }, 30); return }
    const ce = e.target.closest('[data-cedit]'); if (ce) return editComment(+ce.dataset.cedit);
    const cd = e.target.closest('[data-cdel]'); if (cd) return deleteComment(+cd.dataset.cdel);
    const rp = e.target.closest('[data-rpick]'); if (rp) { pickFor = pickFor === +rp.dataset.rpick ? null : +rp.dataset.rpick; return renderDrawer() }
    const rc = e.target.closest('[data-react]'); if (rc) return react(+rc.dataset.react, rc.dataset.emoji);
    if (e.target.closest('#cBtn')) addComment();
    if (e.target.closest('#saveDraft')) saveDraft();
    if (e.target.id === 'f_quote_no') { const inv = getInv(S.drawerId); if (inv && xtraQuote(inv, e.target.disabled)) { e.target.blur(); openXtraBills(inv) } }
  });
  // نتذكر إذا المستخدم فتح "مراحل الطلب" أو "سجل الحركة"
  d.addEventListener('toggle', e => {
    const k = e.target.dataset && e.target.dataset.more; if (!k || shown[k] === e.target.open) return;
    // الرسم من جديد ما يحسب: نخزن بس اللي يغيّره المستخدم بإيده
    if (!e.target.dataset.user) return;
    delete e.target.dataset.user;
    shown[k] = e.target.open;
    try { localStorage.setItem('ib_secs', JSON.stringify(shown)) } catch (_) { }
  }, true);
  d.addEventListener('click', e => { const s = e.target.closest('details.sec>summary'); if (s) s.parentElement.dataset.user = '1' });
  initSwipe(d);
  // Enter يرسل، Shift+Enter ينزل سطر (وأثناء كتابة العربي بلوحة IME ما نرسل)
  d.addEventListener('keydown', e => { if (e.target.id === 'cIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addComment() } });
  d.addEventListener('input', e => { if (e.target.id === 'cIn') { cDrafts[S.drawerId] = e.target.value; growComment() } });

  // أثناء الكتابة (قبل ما يطلع من الحقل) الحقل يتلون إذا صار يختلف عن المحفوظ
  d.addEventListener('input', e => {
    const el = e.target, col = el.dataset && el.dataset.f, box = el.closest && el.closest('.fld');
    if (!col || !box || S.drawerId === 'draft' || el.type === 'checkbox') return;
    const real = getInv(S.drawerId); if (!real) return;
    const v = el.value.trim(), o = real[col];
    box.classList.toggle('chg', el.dataset.num ? (v === '' ? o != null && o !== '' : num(v) !== num(o) || o == null) : !same(v, o));
  });
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
    if (el.id === 'invNotif') {
      const v = el.value || null, { error } = await sb.rpc('set_invoice_notif', { p_id: inv.id, p_level: v });
      if (error) return toast(error.message);
      if (v) S.NPREFS[inv.id] = v; else delete S.NPREFS[inv.id];
      return toast(v ? 'إشعارات هذا الطلب: ' + NOTIF_LEVELS[v] : 'هذا الطلب رجع لإعدادك العام');
    }

    if (el.id === 'f_customer_pick') {
      const name = el.value.trim().toLowerCase();
      const c = S.CUSTOMERS.find(x => x.active && x.name.trim().toLowerCase() === name);
      if (!c) { toast('الزبون مو موجود بالقائمة. اختار من القائمة أو راجع الأدمن'); el.value = inv.customer || ''; return }
      stage(inv, { customer_id: c.id, customer: c.name }, true);
      return;
    }

    if (el.dataset.valcur) {
      extra.valCur = el.value;
      // نحول القيمة الموجودة للدينار حتى المندوب يشوفها بالعملة اللي اختارها
      const v = 'value' in extra.pending ? extra.pending.value : inv.value;
      extra.iqd = el.value === 'iqd' && num(v) > 0 ? Math.round(num(v) * rate()) : null;
      renderDrawer();
      const f = $('#f_value'); f && !f.disabled && f.focus();
      return;
    }
    if (el.dataset.iqd) {
      const v = el.value.trim() === '' ? null : num(el.value);
      extra.iqd = v;
      stage(inv, { value: v === null ? null : Math.round(v / rate() * 100) / 100 }, true);
      return;
    }

    if (el.dataset.cost) {
      if (el.value.trim() === '') { extra.pendingCost = null; renderDrawer(); return }
      const v = num(el.value); if (v <= 0) { el.value = extra.pendingCost ?? ''; return toast('سعر الكلفة لازم أكبر من صفر') }
      extra.pendingCost = hasRole('admin') && same(v, S.COSTS[inv.id]) ? null : v;
      renderDrawer(); // معاينة الربح تتحدث ويا الكلفة
      return;
    }

    const col = el.dataset.f; if (!col) return;
    let val = el.type === 'checkbox' ? el.checked : el.value;
    // الحقول النصية بالقاعدة ما تقبل null، الفارغ ينحفظ ''
    if (val === '' && !['quote_no', 'res_no', 'notes'].includes(col)) val = null;
    if (['value', 'transport_amt', 'ld_pct', 'points', 'credit_months', 'disc_pct', 'debt_iqd', 'debt_usd', 'bal_iqd', 'bal_usd'].includes(col)) val = val === null ? null : num(val);
    if (col === 'points' && val === null) val = 0;
    if (col === 'quote_no' || col === 'res_no') {
      const dup = dupRef(inv, col, val);
      if (dup) {
        toast(`${col === 'quote_no' ? 'رقم عرض السعر' : 'رقم الحجز'} ${String(val).trim()} مكرر — مكتوب بالطلب #${dup.id}`);
        el.value = (col in extra.pending ? extra.pending[col] : inv[col]) ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true })); // يرجّع قفل الحقل الثاني وتلوين التعديل
        el.focus(); el.select();
        return;
      }
    }
    const patch = { [col]: val };
    // تنظيف الحقول التابعة
    if (col === 'payment' && val !== 'credit') patch.credit_months = null;
    if (col === 'payer' && val !== 'customer') patch.transport_amt = 0;
    if (col === 'ld' && !val) patch.ld_pct = null;
    if (col === 'disc_req' && !val) patch.disc_pct = null;
    if (col === 'cust_debt') { patch.cust_debt = val = val === 'true'; if (!val) Object.assign(patch, { debt_cur: null, debt_iqd: null, debt_usd: null }) }
    for (const p of ['bal', 'debt']) if (col === p + '_cur') {
      if (val !== 'iqd' && val !== 'both') patch[p + '_iqd'] = null;
      if (val !== 'usd' && val !== 'both') patch[p + '_usd'] = null;
    }
    stage(inv, patch, !!el.dataset.rer || Object.keys(patch).length > 1);
  });
}
