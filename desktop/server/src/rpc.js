// الإجراءات (كانت دوال SECURITY DEFINER بـ Postgres). نفس الأسماء والمعاملات والرسائل.
import { randomUUID } from 'node:crypto';
import { sql, join } from './db.js';
import {
  fail, perm, inBoard, needActive, canSee, getInvoice, addLog, addComment, updateInvoice, fields, profitRow,
  fromDb, loadUser, notify, profileBeforeWrite, ACTIVE_STAGES, invoiceVisible,
} from './rules.js';
import { hashPassword, loginEmail } from './auth.js';
import { purgeInvoiceRows } from './query.js';

const trim = s => String(s ?? '').trim();
const DAY = 86400000;

async function lockInvoice(r, id) {
  const v = await getInvoice(r, id, true);
  if (!v) fail('الطلب غير موجود');
  return v;
}

// تعديل مرحلة من إجراء + بث
const setStage = (r, ctx, id, patch) => updateInvoice(r, ctx, id, { ...patch, stage_at: new Date() });

export const RPC = {
  // ------------------------------------------------------------ مراحل الطلب
  async inv_send_to_acc(r, ctx, { p_id }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'new') fail('الطلب مو بمرحلة طلب جديد');
    if (!(u.admin || (perm(u, 'create') && v.rep_id === u.uid))) fail('ما عندك صلاحية');
    const f = await fields(r);
    if (f.req('customer') && v.customer_id == null) fail('اختار الزبون من القائمة');
    if (trim(v.quote_no) && trim(v.res_no)) fail('اكتب رقم عرض السعر أو رقم الحجز (واحد منهم فقط)');
    if (f.req('ref') && !trim(v.quote_no) && !trim(v.res_no)) fail('اكتب رقم عرض السعر أو رقم الحجز (واحد منهم فقط)');
    if (f.req('value') && !((+v.value || 0) > 0)) fail('قيمة الفاتورة مطلوبة');
    if (f.req('pdf') && v.pdf_path == null) fail('ملف الـ PDF مطلوب');
    const nw = await setStage(r, ctx, p_id, { stage: 'acc', sub: null });
    await addLog(r, u, p_id, 'أرسل الطلب للحسابات');
    return nw;
  },

  async inv_send_to_decision(r, ctx, { p_id }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'acc') fail('الطلب مو بمرحلة الحسابات');
    if (!perm(u, 'acc')) fail('ما عندك صلاحية');
    const f = await fields(r);
    if (f.req('payment') && !['cash', 'credit'].includes(v.payment)) fail('طريقة السداد: نقدي أو آجل');
    if (v.payment === 'credit' && v.credit_months == null) fail('حدد عدد أشهر الآجل');
    if (f.req('payer') && !['customer', 'none', 'company'].includes(v.payer)) fail('حدد النقل: على الزبون أو بدون');
    if (v.payer === 'customer' && !((+v.transport_amt || 0) > 0)) fail('اكتب مبلغ أجور النقل');
    if (v.ld && (!((+v.ld_pct || 0) > 0) || v.ld_pct > 100)) fail('اكتب نسبة الخصم اللاحق');
    if (f.req('cost') && !v.cost_set) fail('اكتب سعر الكلفة');
    if (v.cust_debt) {
      if (v.debt_cur == null) fail('حدد عملة دين الزبون');
      if (['iqd', 'both'].includes(v.debt_cur) && !((+v.debt_iqd || 0) > 0)) fail('اكتب دين الزبون بالدينار');
      if (['usd', 'both'].includes(v.debt_cur) && !((+v.debt_usd || 0) > 0)) fail('اكتب دين الزبون بالدولار');
    }
    if (f.on('cust')) {
      if (v.cust_debt == null) fail('حدد إذا على الزبون دين (نعم أو لا)');
      if (v.bal_cur == null) fail('حدد عملة رصيد الزبون');
      if (['iqd', 'both'].includes(v.bal_cur) && v.bal_iqd == null) fail('اكتب رصيد الزبون بالدينار');
      if (['usd', 'both'].includes(v.bal_cur) && v.bal_usd == null) fail('اكتب رصيد الزبون بالدولار');
    }
    const nw = await setStage(r, ctx, p_id, { stage: 'decision', sub: 'mgr' });
    await addLog(r, u, p_id, 'أرسل الطلب للقرار');
    return nw;
  },

  async inv_approve(r, ctx, { p_id }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'decision' || v.sub !== 'mgr') fail('الطلب مو بانتظار موافقة المدير');
    if (!perm(u, 'approve')) fail('الموافقة للمدير فقط');
    const nw = await setStage(r, ctx, p_id, { sub: 'cust' });
    await addLog(r, u, p_id, 'وافق المدير على الشروط');
    return nw;
  },

  async inv_return_to_acc(r, ctx, { p_id, p_reason }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'decision' || v.sub !== 'mgr') fail('الطلب مو بانتظار موافقة المدير');
    if (!perm(u, 'approve')) fail('الإرجاع للمدير فقط');
    const nw = await setStage(r, ctx, p_id, { stage: 'acc', sub: null, returned: (v.returned || 0) + 1 });
    await addComment(r, ctx, p_id, 'إرجاع للحسابات' + (trim(p_reason) ? ': ' + trim(p_reason) : ''), true);
    await addLog(r, u, p_id, 'أرجع الطلب للحسابات');
    return nw;
  },

  async inv_return_to_rep(r, ctx, { p_id, p_reason }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'acc') fail('الطلب مو بمرحلة الحسابات');
    if (!perm(u, 'acc')) fail('الإرجاع للمحاسب فقط');
    const nw = await setStage(r, ctx, p_id, { stage: 'new', sub: null, returned: (v.returned || 0) + 1 });
    await addComment(r, ctx, p_id, 'إرجاع للمندوب' + (trim(p_reason) ? ' — التعديلات المطلوبة: ' + trim(p_reason) : ''), true);
    await addLog(r, u, p_id, 'أرجع الطلب للمندوب');
    return nw;
  },

  async inv_customer_accept(r, ctx, { p_id }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'decision' || v.sub !== 'cust') fail('الطلب مو بانتظار رد الزبون');
    if (!(perm(u, 'cust_all') || (perm(u, 'create') && v.rep_id === u.uid))) fail('ما عندك صلاحية');
    const nw = await setStage(r, ctx, p_id, { sub: 'wh' });
    await addLog(r, u, p_id, 'أكد موافقة الزبون');
    return nw;
  },

  async inv_customer_refuse(r, ctx, { p_id, p_reason }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'decision' || v.sub !== 'cust') fail('الطلب مو بانتظار رد الزبون');
    if (!(perm(u, 'cust_all') || (perm(u, 'create') && v.rep_id === u.uid))) fail('ما عندك صلاحية');
    if (!trim(p_reason)) fail('سبب الرفض مطلوب');
    const nw = await setStage(r, ctx, p_id, { stage: 'cancel', sub: null, cancel_reason: p_reason, closed_at: new Date() });
    await addLog(r, u, p_id, 'سجل رفض الزبون وألغى الطلب');
    return nw;
  },

  async inv_complete(r, ctx, { p_id, p_sales_no }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (v.stage !== 'decision' || v.sub !== 'wh') fail('الطلب مو بانتظار المخزن');
    if (!perm(u, 'complete')) fail('التحويل للمخزن أو المدير');
    if (!trim(p_sales_no)) fail('رقم المبيعات مطلوب');
    const nw = await setStage(r, ctx, p_id, { stage: 'done', sub: null, sales_no: trim(p_sales_no), closed_at: new Date() });
    await addLog(r, u, p_id, 'حول الطلب لمبيعات برقم ' + trim(p_sales_no));
    return nw;
  },

  async inv_move(r, ctx, { p_id, p_target, p_reason }) {
    const u = ctx.user; needActive(u);
    if (!perm(u, 'move')) fail('ما عندك صلاحية نقل الطلب');
    const names = { new: 'طلب جديد', acc: 'الحسابات', 'decision:mgr': 'موافقة المدير', 'decision:cust': 'رد الزبون', 'decision:wh': 'المخزن', cancel: 'ملغاة', done: 'تمت' };
    const order = { new: 1, acc: 2, 'decision:mgr': 3, 'decision:cust': 4, 'decision:wh': 5 };
    if (!['new', 'acc', 'decision:mgr', 'decision:cust', 'decision:wh', 'cancel'].includes(p_target)) fail('مرحلة غير معروفة');
    const v = await lockInvoice(r, p_id);
    if (!canSee(u, v)) fail('الطلب غير موجود');
    const from = v.stage + (v.sub ? ':' + v.sub : '');
    if (from === p_target) fail('الطلب أصلاً بهاي المرحلة');
    const [tStage, tSub = null] = p_target.split(':');
    const back = (order[p_target] || 6) < (order[from] || 0);
    const nw = await setStage(r, ctx, p_id, {
      stage: tStage, sub: tSub, returned: (v.returned || 0) + (back ? 1 : 0),
      cancel_reason: tStage === 'cancel' ? trim(p_reason) : '',
      closed_at: tStage === 'cancel' ? new Date() : null,
      sales_no: v.stage === 'done' ? '' : v.sales_no,
    });
    await addComment(r, ctx, p_id, 'نقل من ' + (names[from] || from) + ' إلى ' + names[p_target] + (trim(p_reason) ? ': ' + trim(p_reason) : ''), true);
    await addLog(r, u, p_id, 'نقل الطلب إلى ' + names[p_target]);
    return nw;
  },

  async inv_set_board(r, ctx, { p_id, p_board }) {
    const u = ctx.user;
    if (!u.admin) fail('نقل الطلب لبورد ثاني للأدمن فقط');
    const b = await r.one(sql`select name from boards where id = ${p_board}`);
    if (!b) fail('البورد غير موجود');
    const v = await lockInvoice(r, p_id);
    if (v.board_id === p_board) return v;
    const nw = await updateInvoice(r, ctx, p_id, { board_id: p_board });
    await addLog(r, u, p_id, 'نقل الطلب لبورد ' + b.name);
    return nw;
  },

  async inv_set_cost(r, ctx, { p_id, p_cost }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (!(u.admin || (perm(u, 'acc') && v.stage === 'acc'))) fail('سعر الكلفة يكتبه المحاسب بمرحلة الحسابات');
    if (!((+p_cost || 0) > 0)) fail('سعر الكلفة لازم أكبر من صفر');
    const had = v.cost_set;
    const n = await r.exec(sql`update invoice_costs set cost = ${+p_cost}, set_by = ${u.uid}, set_at = sysutcdatetime() where invoice_id = ${p_id}`);
    if (!n) await r.exec(sql`insert into invoice_costs (invoice_id, cost, set_by) values (${p_id}, ${+p_cost}, ${u.uid})`);
    await updateInvoice(r, ctx, p_id, { cost_set: true });
    await addLog(r, u, p_id, had ? 'عدّل سعر الكلفة' : 'سجّل سعر الكلفة');
    ctx.events.push({ type: 'invoice', id: p_id });
    return null;
  },

  async inv_set_urgent(r, ctx, { p_id, p_on }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (!canSee(u, v)) fail('الطلب غير موجود');
    if (!ACTIVE_STAGES.includes(v.stage)) fail('الطلب مغلق');
    if (!(perm(u, 'urgent_all') || (perm(u, 'create') && v.rep_id === u.uid))) fail('ما عندك صلاحية');
    const on = !!p_on;
    if (v.urgent === on) return null;
    await updateInvoice(r, ctx, p_id, { urgent: on });
    await addLog(r, u, p_id, on ? 'أشّر الطلب طارئ' : 'شال علامة طارئ');
    return null;
  },

  // ------------------------------------------------------------ الحذف وسلة المحذوفات
  async inv_request_delete(r, ctx, { p_id, p_reason }) {
    const u = ctx.user; needActive(u);
    const v = await lockInvoice(r, p_id);
    if (!canSee(u, v)) fail('الطلب غير موجود');
    if (!trim(p_reason)) fail('سبب الحذف مطلوب');
    if (v.delete_req_at != null) fail('أكو طلب حذف سابق على هذا الطلب');
    await updateInvoice(r, ctx, p_id, { delete_req_by: u.uid, delete_req_at: new Date(), delete_req_reason: trim(p_reason) });
    await addComment(r, ctx, p_id, 'طلب حذف: ' + trim(p_reason), true);
    await addLog(r, u, p_id, 'طلب حذف الطلب');
    return null;
  },

  async inv_cancel_delete_request(r, ctx, { p_id }) {
    const u = ctx.user; needActive(u);
    const v = await getInvoice(r, p_id, true);
    if (!v || v.delete_req_at == null) fail('ماكو طلب حذف');
    if (!(u.admin || v.delete_req_by === u.uid)) fail('ما عندك صلاحية');
    await updateInvoice(r, ctx, p_id, { delete_req_by: null, delete_req_at: null, delete_req_reason: null });
    await addLog(r, u, p_id, u.admin && v.delete_req_by !== u.uid ? 'رفض الأدمن طلب الحذف' : 'ألغى طلب الحذف');
    return null;
  },

  async inv_delete(r, ctx, { p_id }) {
    const u = ctx.user;
    if (!perm(u, 'trash')) fail('ما عندك صلاحية الحذف');
    const v = await getInvoice(r, p_id, true);
    if (!v || v.deleted_at != null || !inBoard(u, v.board_id)) fail('الطلب غير موجود');
    await updateInvoice(r, ctx, p_id, { deleted_at: new Date(), deleted_by: u.uid });
    await addLog(r, u, p_id, 'نقل الطلب لسلة المحذوفات');
    return null;
  },

  async inv_restore(r, ctx, { p_id }) {
    const u = ctx.user;
    if (!perm(u, 'trash')) fail('ما عندك صلاحية الاسترجاع');
    const v = await getInvoice(r, p_id, true);
    if (!v || v.deleted_at == null || !inBoard(u, v.board_id)) fail('الطلب مو بسلة المحذوفات');
    await updateInvoice(r, ctx, p_id, { deleted_at: null, deleted_by: null, delete_req_by: null, delete_req_at: null, delete_req_reason: null });
    await addLog(r, u, p_id, 'رجع الطلب من سلة المحذوفات');
    return null;
  },

  async inv_purge(r, ctx, { p_id }) {
    const u = ctx.user;
    if (!perm(u, 'trash')) fail('ما عندك صلاحية الحذف');
    const v = await getInvoice(r, p_id, true);
    if (!v || v.deleted_at == null || !inBoard(u, v.board_id)) fail('الطلب مو بسلة المحذوفات');
    await purgeInvoiceRows(r, p_id);
    await r.exec(sql`delete from invoices where id = ${p_id}`);
    ctx.events.push({ type: 'invoice', id: p_id });
    return v.pdf_path;
  },

  async trash_list(r, ctx) {
    const u = ctx.user;
    if (!perm(u, 'trash')) fail('ما عندك صلاحية سلة المحذوفات');
    if (!u.boards.length) return [];
    return (await r.query(sql`select * from invoices where deleted_at is not null and board_id in (${u.boards}) order by deleted_at desc`)).map(x => fromDb('invoices', x));
  },

  // ------------------------------------------------------------ التعليقات
  async comment_edit(r, ctx, { p_id, p_body }) {
    const u = ctx.user; needActive(u);
    const c = await r.one(sql`select * from invoice_comments with (updlock) where id = ${p_id}`);
    if (!c || !canSee(u, await getInvoice(r, c.invoice_id))) fail('التعليق غير موجود');
    if (c.is_system) fail('تعليقات النظام ما تتعدل');
    if (c.author !== u.uid) fail('تعدل تعليقك بس');
    if (!trim(p_body)) fail('التعليق فارغ');
    await r.exec(sql`update invoice_comments set body = ${trim(p_body)}, edited_at = sysutcdatetime() where id = ${p_id}`);
    ctx.events.push({ type: 'invoice', id: c.invoice_id });
    return null;
  },

  async comment_delete(r, ctx, { p_id }) {
    const u = ctx.user; needActive(u);
    const c = await r.one(sql`select * from invoice_comments with (updlock) where id = ${p_id}`);
    if (!c || !canSee(u, await getInvoice(r, c.invoice_id))) fail('التعليق غير موجود');
    if (!(u.admin || (!c.is_system && c.author === u.uid))) fail('تحذف تعليقك بس');
    await r.exec(sql`delete from invoice_comments where id = ${p_id}`);
    ctx.events.push({ type: 'invoice', id: c.invoice_id });
    return null;
  },

  async comment_react(r, ctx, { p_id, p_emoji }) {
    const u = ctx.user; needActive(u);
    if (!['👍', '❤️', '😂', '😮', '🙏', '✅'].includes(p_emoji)) fail('تفاعل غير معروف');
    const c = await r.one(sql`select invoice_id from invoice_comments where id = ${p_id}`);
    if (!c || !canSee(u, await getInvoice(r, c.invoice_id))) fail('التعليق غير موجود');
    const n = await r.exec(sql`delete from comment_reactions where comment_id = ${p_id} and user_id = ${u.uid} and emoji = ${p_emoji}`);
    if (!n) await r.exec(sql`insert into comment_reactions (comment_id, user_id, emoji) values (${p_id}, ${u.uid}, ${p_emoji})`);
    return !n;
  },

  // ------------------------------------------------------------ الأرباح والإحصائيات
  async inv_profits(r, ctx, { p_ids = null } = {}) {
    const u = ctx.user;
    if (!u.boards.length || !(u.admin || perm(u, 'see_profit'))) return [];
    if (Array.isArray(p_ids) && !p_ids.length) return [];
    const rows = await r.query(sql`select i.*, c.cost from invoices i join invoice_costs c on c.invoice_id = i.id
      where i.deleted_at is null and i.board_id in (${u.boards}) ${Array.isArray(p_ids) ? sql`and i.id in (${p_ids})` : sql``}`);
    return rows
      .filter(i => u.admin || ['decision', 'done', 'cancel'].includes(i.stage))
      .map(i => { const p = profitRow(i, +i.cost); return { invoice_id: p.invoice_id, total: p.total, gross_pct: p.gross_pct, net_pct: p.net_pct } });
  },

  async board_stats(r) {
    return r.query(sql`select board_id,
      sum(case when stage in ('new', 'acc', 'decision') then 1 else 0 end) active,
      sum(case when stage in ('new', 'acc', 'decision') and stage_at < dateadd(day, -3, sysutcdatetime()) then 1 else 0 end) late
      from invoices group by board_id`);
  },

  async can_see_invoice(r, ctx, { p_id }) { return canSee(ctx.user, await getInvoice(r, p_id)) },

  async report_summary(r, ctx, { p_from, p_to, p_board = 1 }) {
    const u = ctx.user;
    if (!perm(u, 'reports')) fail('ما عندك صلاحية التقارير');
    if (!inBoard(u, p_board)) fail('ما عندك صلاحية على هذا البورد');
    const from = new Date(p_from + 'T00:00:00Z'), to = new Date(new Date(p_to + 'T00:00:00Z').getTime() + DAY);
    const inv = await r.query(sql`select i.*, c.cost from invoices i left join invoice_costs c on c.invoice_id = i.id
      where i.board_id = ${p_board} and i.deleted_at is null and i.created_at >= ${from} and i.created_at < ${to}`);
    for (const i of inv) i.net_pct = i.cost != null ? profitRow(i, +i.cost).net_pct : null;
    const now = Date.now(), active = i => ACTIVE_STAGES.includes(i.stage);
    const avg = (xs, d) => { xs = xs.filter(x => x != null); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10 ** d) / 10 ** d : null };
    const cycle = i => (i.closed_at - i.created_at) / DAY;
    const sum = xs => xs.reduce((a, i) => a + (+i.value || 0), 0);
    const agg = list => {
      const done = list.filter(i => i.stage === 'done');
      return { done: done.length, done_value: sum(done), avg_cycle_days: avg(done.map(cycle), 1), avg_net_pct: avg(done.map(i => i.net_pct), 2) };
    };
    const totals = { count: inv.length, active: inv.filter(active).length, cancel: inv.filter(i => i.stage === 'cancel').length,
      late: inv.filter(i => active(i) && i.stage_at < now - 3 * DAY).length, ...agg(inv) };
    const names = Object.fromEntries((await r.query(sql`select id, full_name from profiles`)).map(p => [p.id, p.full_name]));
    const byRep = {};
    for (const i of inv) (byRep[names[i.rep_id] ?? '—'] ||= []).push(i);
    const by_rep = Object.entries(byRep).map(([rep, l]) => ({ rep, total: l.length, active: l.filter(active).length,
      cancel: l.filter(i => i.stage === 'cancel').length, ...agg(l) })).sort((a, b) => b.done_value - a.done_value);
    const byMonth = {};
    for (const i of inv.filter(i => i.stage === 'done')) (byMonth[i.closed_at.toISOString().slice(0, 7)] ||= []).push(i);
    const by_month = Object.keys(byMonth).sort().map(m => ({ month: m, done: byMonth[m].length, value: sum(byMonth[m]), avg_net_pct: avg(byMonth[m].map(i => i.net_pct), 2) }));
    // وكت كل مرحلة من سجل المراحل
    const ids = inv.map(i => i.id), seg = {};
    if (ids.length) {
      const logs = await r.query(sql`select invoice_id, stage, sub, at, id from invoice_stage_log where invoice_id in (${ids}) order by invoice_id, at, id`);
      const live = Object.fromEntries(inv.map(i => [i.id, active(i)]));
      logs.forEach((s, k) => {
        if (!ACTIVE_STAGES.includes(s.stage)) return;
        const next = logs[k + 1] && logs[k + 1].invoice_id === s.invoice_id ? logs[k + 1].at : (live[s.invoice_id] ? new Date(now) : null);
        if (!next) return;
        const key = s.stage === 'decision' ? 'decision:' + (s.sub || '') : s.stage;
        const ord = s.stage === 'new' ? 1 : s.stage === 'acc' ? 2 : ({ mgr: 3, cust: 4, wh: 5 }[s.sub] || 6);
        (seg[key] ||= { key, ord, days: [] }).days.push((next - s.at) / DAY);
      });
    }
    const stages = Object.values(seg).sort((a, b) => a.ord - b.ord).map(s => ({ key: s.key, ord: s.ord, n: s.days.length, avg_days: avg(s.days, 1) }));
    const reasons = {};
    for (const i of inv) if (i.stage === 'cancel' && trim(i.cancel_reason)) reasons[trim(i.cancel_reason)] = (reasons[trim(i.cancel_reason)] || 0) + 1;
    const cancel_reasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, n]) => ({ reason, n }));
    return { totals, by_rep, by_month, stages, cancel_reasons };
  },

  // ------------------------------------------------------------ المستخدمين
  async admin_create_user(r, ctx, { p_username, p_password, p_full_name, p_roles, p_boards = null, p_xroles = [] }) {
    const u = ctx.user;
    if (!perm(u, 'users')) fail('ما عندك صلاحية إضافة حسابات');
    const roles = p_roles || [], xroles = p_xroles || [];
    if (roles.includes('admin') && !u.admin) fail('دور الأدمن ينطيه الأدمن بس');
    if (String(p_password || '').length < 8) fail('الرمز لازم 8 أحرف على الأقل');
    if (!trim(p_full_name)) fail('الاسم الكامل مطلوب');
    if (roles.length + xroles.length === 0) fail('اختار دور واحد على الأقل');
    const keys = new Set((await r.query(sql`select [key] from role_defs`)).map(d => d.key));
    if (xroles.some(x => !keys.has(x))) fail('دور غير معروف');
    const login = loginEmail(p_username);
    if (await r.one(sql`select 1 x from users where login = ${login}`)) fail('اسم المستخدم موجود، اختار غيره');
    const id = randomUUID();
    await r.exec(sql`insert into users (id, login, pass_hash) values (${id}, ${login}, ${await hashPassword(p_password)})`);
    const p = { id, full_name: trim(p_full_name), role: 'rep', roles, xroles, active: true };
    await profileBeforeWrite(r, u, p, null, false);
    await r.exec(sql`insert into profiles (id, full_name, role, roles, xroles, active)
      values (${id}, ${p.full_name}, ${p.role}, ${JSON.stringify(p.roles)}, ${JSON.stringify(p.xroles)}, 1)`);
    const boards = p_boards && p_boards.length ? p_boards : [1];
    for (const b of (await r.query(sql`select id from boards where id in (${boards})`))) await r.exec(sql`insert into board_members (board_id, user_id) values (${b.id}, ${id})`);
    return id;
  },

  async admin_list_logins(r, ctx) {
    if (!perm(ctx.user, 'users')) return [];
    return (await r.query(sql`select id, login from users`)).map(x => ({ id: x.id, login: x.login.replace('@invoices.local', '') }));
  },

  async admin_set_password(r, ctx, { p_user, p_password }) {
    const u = ctx.user;
    if (!perm(u, 'users')) fail('ما عندك صلاحية');
    if (!u.admin && await r.one(sql`select 1 x from profiles where id = ${p_user} and roles like '%"admin"%'`)) fail('رمز الأدمن يغيره الأدمن بس');
    if (String(p_password || '').length < 8) fail('الرمز لازم 8 أحرف على الأقل');
    const n = await r.exec(sql`update users set pass_hash = ${await hashPassword(p_password)}, updated_at = sysutcdatetime() where id = ${p_user}`);
    if (!n) fail('المستخدم غير موجود');
    if (p_user !== u.uid) { await r.exec(sql`delete from sessions where user_id = ${p_user}`); ctx.events.push({ type: 'kick', user_id: p_user }) }
    return null;
  },

  async set_avatar(r, ctx, { p_user, p_avatar }) {
    const u = ctx.user; needActive(u);
    const a = trim(p_avatar) || null;
    if (p_user !== u.uid && !perm(u, 'users')) fail('ما عندك صلاحية');
    if (a && !/^((people|pixel|robot|animal|space)-(10|[1-9])|[mf]([1-9]|1[0-2]))$/.test(a)) fail('صورة غير معروفة');
    const n = await r.exec(p_user === u.uid
      ? sql`update profiles set avatar = ${a}, avatar_chosen = 1 where id = ${p_user}`
      : sql`update profiles set avatar = ${a} where id = ${p_user}`);
    if (!n) fail('المستخدم غير موجود');
    return null;
  },

  // ------------------------------------------------------------ الإشعارات
  async set_invoice_notif(r, ctx, { p_id, p_level }) {
    const u = ctx.user; needActive(u);
    if (!canSee(u, await getInvoice(r, p_id))) fail('الطلب غير موجود');
    await r.exec(sql`delete from invoice_notif_prefs where user_id = ${u.uid} and invoice_id = ${p_id}`);
    if (p_level == null) return null;
    if (!['all', 'important', 'mention', 'none'].includes(p_level)) fail('مستوى غير معروف');
    await r.exec(sql`insert into invoice_notif_prefs (user_id, invoice_id, level) values (${u.uid}, ${p_id}, ${p_level})`);
    return null;
  },

  async set_notif_level(r, ctx, { p_level }) {
    const u = ctx.user; needActive(u);
    if (!['all', 'important', 'mention', 'none'].includes(p_level)) fail('مستوى غير معروف');
    await r.exec(sql`update profiles set notif_level = ${p_level} where id = ${u.uid}`);
    return null;
  },

  // تنبيهات الموبايل (Web Push) تحتاج إنترنت — بالنسخة المحلية الإشعارات توصل مباشرة للبرنامج
  async push_subscribe() { return null },
  async push_unsubscribe() { return null },
};

// تنبيه الطلبات المتأخرة (notify_late) — السيرفر يشغله كل ساعة
export async function notifyLate(r) {
  const ctx = { user: { uid: null }, events: [] };
  const late = await r.query(sql`select * from invoices where stage in ('new', 'acc', 'decision') and deleted_at is null
    and stage_at <= dateadd(day, -3, sysutcdatetime())`);
  const people = (await r.query(sql`select id from profiles where active = 1`)).map(p => p.id);
  const users = new Map();
  for (const id of people) users.set(id, await loadUser(r, id));
  let n = 0;
  for (const raw of late) {
    const i = fromDb('invoices', raw);
    const turn = new Set();
    if (i.rep_id && (i.stage === 'new' || (i.stage === 'decision' && i.sub === 'cust'))) turn.add(i.rep_id);
    for (const [id, u] of users) {
      if ((i.stage === 'acc' && u.roleOnly.has('acc')) || (i.stage === 'decision' && i.sub === 'mgr' && u.roleOnly.has('approve'))
        || (i.stage === 'decision' && i.sub === 'wh' && u.roleOnly.has('complete') && !u.roleOnly.has('approve'))) turn.add(id);
    }
    for (const uid of turn) {
      const u = users.get(uid) || await loadUser(r, uid);
      if (!canSee(u, i)) continue;
      const recent = await r.one(sql`select 1 x from notifications where user_id = ${uid} and invoice_id = ${i.id} and kind = 'late'
        and created_at > dateadd(hour, -20, sysutcdatetime())`);
      if (recent) continue;
      await notify(r, ctx, { user_id: uid, invoice_id: i.id, kind: 'late', actor: null,
        data: { stage: i.stage, sub: i.sub, customer: i.customer, days: Math.floor((Date.now() - i.stage_at) / DAY) } });
      n++;
    }
  }
  await r.exec(sql`delete from notifications where read_at is not null and created_at < dateadd(day, -90, sysutcdatetime())`);
  return { count: n, events: ctx.events };
}

export { invoiceVisible, join };
