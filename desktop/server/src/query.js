// محرك عام يقلّد PostgREST: الواجهة تبعث {table, op, columns, filters, or, order, range, ...}
// والسيرفر يطبّق صلاحيات الجدول (POLICY) وقواعده قبل ما يكتب.
import { sql, raw, join } from './db.js';
import {
  spec, col, toDb, fromDb, POLICY, fail, validate, updateInvoice, addComment, profileBeforeWrite,
  dropDefsCache, needActive,
} from './rules.js';

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function cond(table, f) {
  const s = spec(table);
  if (!s.cols.includes(f.col)) fail('عمود غير معروف: ' + f.col);
  const c = col(f.col);
  const v = x => toDb(table, f.col, x);
  if (OPS[f.op]) return sql`${c} ${raw(OPS[f.op])} ${v(f.val)}`;
  if (f.op === 'in') return sql`${c} in (${(f.val || []).map(v)})`;
  if (f.op === 'is' || f.op === 'not.is') {
    const n = f.op === 'not.is' ? ' not' : '';
    if (f.val === null || f.val === 'null') return raw(`[${f.col}] is${n} null`);
    const b = f.val === true || f.val === 'true';
    return n ? sql`(${c} is null or ${c} <> ${b})` : sql`${c} = ${b}`;
  }
  if (f.op === 'like' || f.op === 'ilike') return sql`${c} like ${String(f.val).replace(/\*/g, '%')}`;
  fail('شرط غير مدعوم: ' + f.op);
}

// صيغة or الخاصة بـ PostgREST: "stage.in.(new,acc),closed_at.gte.2026-01-01T00:00:00Z"
function parseOr(str) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) { parts.push(cur); cur = '' } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map(p => {
    const m = /^([a-z_0-9]+)\.(not\.is|[a-z]+)\.(.*)$/.exec(p.trim());
    if (!m) fail('شرط غير مفهوم: ' + p);
    let val = m[3];
    if (m[2] === 'in') val = val.replace(/^\(|\)$/g, '').split(',').map(x => x.trim());
    return { col: m[1], op: m[2], val };
  });
}

function whereOf(table, u, q) {
  const parts = [POLICY[table].read(u)];
  for (const f of q.filters || []) parts.push(cond(table, f));
  for (const o of q.or || []) parts.push(sql`(${join(parseOr(o).map(f => cond(table, f)), ' or ')})`);
  return join(parts, ' and ');
}

function columnsOf(table, columns) {
  const s = spec(table);
  if (!columns || columns.trim() === '*') return s.cols;
  const list = columns.split(',').map(c => c.trim()).filter(Boolean);
  for (const c of list) if (!s.cols.includes(c)) fail(`العمود ${c} غير موجود`);
  return list;
}

async function select(r, ctx, table, q) {
  const s = spec(table), cols = columnsOf(table, q.columns);
  let order = (q.order || []).map(o => {
    if (!s.cols.includes(o.col)) fail('عمود ترتيب غير معروف: ' + o.col);
    // مثل Postgres: الفارغ آخر شي بالتصاعدي وأول شي بالتنازلي
    return o.asc === false ? raw(`case when [${o.col}] is null then 0 else 1 end, [${o.col}] desc`) : raw(`case when [${o.col}] is null then 1 else 0 end, [${o.col}]`);
  });
  let page = raw('');
  const lim = q.range ? q.range[1] - q.range[0] + 1 : q.limit;
  if (q.range || q.limit) {
    if (!order.length) order = [col(s.pk)];
    page = sql` offset ${q.range ? q.range[0] : 0} rows fetch next ${lim} rows only`;
  }
  const text = sql`select ${join(cols.map(c => col(c)))} from ${raw(table)} where ${whereOf(table, ctx.user, q)}${order.length ? sql` order by ${join(order)}` : raw('')}${page}`;
  return (await r.query(text)).map(x => fromDb(table, x));
}

// الصفوف اللي المستخدم يكدر يعدلها/يحذفها (USING) مع قفل
async function targetRows(r, ctx, table, q) {
  const rows = (await r.query(sql`select * from ${raw(table)} with (updlock, rowlock) where ${whereOf(table, ctx.user, q)}`)).map(x => fromDb(table, x));
  return rows;
}

const pkWhere = (table, row) => table === 'board_members' ? sql`board_id = ${row.board_id} and user_id = ${row.user_id}`
  : table === 'comment_reactions' ? sql`comment_id = ${row.comment_id} and user_id = ${row.user_id} and emoji = ${row.emoji}`
    : table === 'invoice_notif_prefs' ? sql`user_id = ${row.user_id} and invoice_id = ${row.invoice_id}`
      : sql`${col(spec(table).pk)} = ${row[spec(table).pk]}`;

async function insertRow(r, ctx, table, input) {
  const u = ctx.user, s = spec(table), pol = POLICY[table];
  if (!pol.ins && table !== 'invoice_comments') fail('ما عندك صلاحية', 403);
  needActive(u);
  // invoice_comments: comments_guard + comments_insert
  if (table === 'invoice_comments') {
    const body = String(input.body ?? '');
    const inv = await r.one(sql`select id from invoices where id = ${input.invoice_id} and ${POLICY.invoices.read(u)}`);
    if (!inv) fail('ما عندك صلاحية', 403);
    return addComment(r, ctx, input.invoice_id, body, false);
  }
  const row = {};
  for (const [k, v] of Object.entries(input)) {
    if (!s.ins.includes(k) && !(table === 'invoices' && s.cols.includes(k) && !['id'].includes(k))) fail(`ما تكدر تحدد ${k}`);
    row[k] = v;
  }
  if (table === 'invoices') {
    row.board_id ??= 1; row.created_by ??= u.uid; row.stage ??= 'new';
    for (const k of ['deleted_at', 'deleted_by', 'delete_req_at', 'delete_req_by', 'closed_at', 'sales_no', 'cost_set', 'returned']) delete row[k];
    if (row.customer_id != null) {
      const c = await r.one(sql`select name from customers where id = ${row.customer_id}`);
      row.customer = c ? c.name : null;
    }
  }
  if (table === 'app_settings') row.updated_by = u.uid;
  pol.ins(u, row);
  validate(table, row);
  const keys = Object.keys(row);
  const out = await r.one(sql`insert into ${raw(table)} (${join(keys.map(k => col(k)))}) output inserted.*
    values (${join(keys.map(k => sql`${toDb(table, k, row[k])}`))})`);
  const res = fromDb(table, out);
  if (table === 'invoices') {
    await r.exec(sql`insert into invoice_stage_log (invoice_id, stage, sub, at) values (${res.id}, ${res.stage}, ${res.sub}, ${res.stage_at})`);
    ctx.events.push({ type: 'invoice', id: res.id });
  }
  if (table === 'role_defs') dropDefsCache();
  return res;
}

async function updateRows(r, ctx, table, q, patch) {
  const u = ctx.user, s = spec(table), pol = POLICY[table];
  if (!pol.updUsing) fail('ما عندك صلاحية', 403);
  for (const k of Object.keys(patch)) if (!s.upd.includes(k)) fail(`ما تكدر تعدل ${k}`);
  const out = [];
  for (const old of await targetRows(r, ctx, table, q)) {
    if (!pol.updUsing(u, old)) continue;   // مثل RLS: الصف اللي ما مسموح يتجاهل بصمت
    if (table === 'invoices') {
      const nw = await updateInvoice(r, ctx, old.id, patch, { direct: true });
      if (!pol.updUsing(u, nw)) fail('ما عندك صلاحية', 403);   // WITH CHECK
      out.push(nw); continue;
    }
    const nw = { ...old, ...patch };
    if (table === 'profiles') await profileBeforeWrite(r, u, nw, old, true);
    validate(table, patch);
    if (!pol.updUsing(u, nw)) fail('ما عندك صلاحية', 403);
    const keys = table === 'profiles' ? ['full_name', 'role', 'roles', 'xroles', 'active', 'avatar', 'avatar_chosen', 'notif_level'] : Object.keys(patch);
    if (table === 'app_settings') { nw.updated_by = u.uid; nw.updated_at = new Date(); keys.push('updated_by', 'updated_at') }
    await r.exec(sql`update ${raw(table)} set ${join(keys.map(k => sql`${col(k)} = ${toDb(table, k, nw[k])}`))} where ${pkWhere(table, old)}`);
    // profiles_kick_inactive
    if (table === 'profiles' && old.active && !nw.active) { await r.exec(sql`delete from sessions where user_id = ${old.id}`); ctx.events.push({ type: 'kick', user_id: old.id }) }
    if (table === 'role_defs') dropDefsCache();
    out.push(fromDb(table, await r.one(sql`select * from ${raw(table)} where ${pkWhere(table, old)}`)));
  }
  return out;
}

async function deleteRows(r, ctx, table, q) {
  const u = ctx.user, pol = POLICY[table];
  if (!pol.del) fail('ما عندك صلاحية', 403);
  const out = [];
  for (const old of await targetRows(r, ctx, table, q)) {
    if (!pol.del(u, old)) continue;
    if (table === 'invoices') await purgeInvoiceRows(r, old.id);
    await r.exec(sql`delete from ${raw(table)} where ${pkWhere(table, old)}`);
    // role_defs_cleanup
    if (table === 'role_defs') {
      for (const p of await r.query(sql`select id, xroles from profiles where xroles like ${'%"' + old.key + '"%'}`))
        await r.exec(sql`update profiles set xroles = ${JSON.stringify(JSON.parse(p.xroles).filter(x => x !== old.key))} where id = ${p.id}`);
      dropDefsCache();
    }
    if (table === 'invoices') ctx.events.push({ type: 'invoice', id: old.id });
    out.push(old);
  }
  return out;
}

// SQL Server ما يسمح بأكثر من مسار cascade: الإشعارات والتفضيلات والتفاعلات تنحذف يدوياً
export async function purgeInvoiceRows(r, id) {
  await r.exec(sql`delete from comment_reactions where comment_id in (select id from invoice_comments where invoice_id = ${id})`);
}

export async function runQuery(r, ctx, q) {
  const table = q.table;
  spec(table);
  if (!POLICY[table]) fail('ما عندك صلاحية', 403);
  let rows;
  switch (q.op) {
    case 'select': rows = await select(r, ctx, table, q); break;
    case 'insert': {
      const list = Array.isArray(q.values) ? q.values : [q.values];
      rows = [];
      for (const v of list) rows.push(await insertRow(r, ctx, table, v));
      break;
    }
    case 'upsert': {
      // يستخدم بس لإعدادات البرنامج (app_settings) — المفتاح key
      if (table !== 'app_settings') fail('upsert غير مدعوم لهذا الجدول');
      const list = Array.isArray(q.values) ? q.values : [q.values];
      rows = [];
      for (const v of list) {
        const ex = await r.one(sql`select [key] from app_settings where [key] = ${v.key}`);
        if (ex) rows.push(...await updateRows(r, ctx, table, { filters: [{ col: 'key', op: 'eq', val: v.key }] }, { value: v.value }));
        else rows.push(await insertRow(r, ctx, table, { key: v.key, value: v.value }));
      }
      break;
    }
    case 'update': rows = await updateRows(r, ctx, table, q, q.values || {}); break;
    case 'delete': rows = await deleteRows(r, ctx, table, q); break;
    default: fail('عملية غير معروفة');
  }
  if (q.op !== 'select' && q.columns != null) {
    const cols = columnsOf(table, q.columns);
    rows = rows.map(x => Object.fromEntries(cols.map(c => [c, x[c]])));
  }
  return rows;
}
