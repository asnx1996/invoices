// التحديث المباشر بين الأجهزة (بدل Supabase Realtime) عن طريق Server-Sent Events.
// كل جهاز يفتح /api/events ويستلم: تغيّر طلب (id)، إشعار جديد له، أو طرد من الجلسة.
const clients = new Set();   // { res, uid }

export function addClient(res, uid) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const c = { res, uid };
  clients.add(c);
  res.on('close', () => clients.delete(c));
}

const send = (c, type, data) => { try { c.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`) } catch (e) { clients.delete(c) } };

// يتنادى بعد ما تنحفظ المعاملة
export function emit(events) {
  const seen = new Set();
  for (const e of events) {
    if (e.type === 'invoice') {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      for (const c of clients) send(c, 'invoice', { id: e.id });
    } else if (e.type === 'notification') {
      for (const c of clients) if (c.uid === e.user_id) send(c, 'notification', e.row);
    } else if (e.type === 'kick') {
      for (const c of clients) if (c.uid === e.user_id) { send(c, 'kick', {}); try { c.res.end() } catch (_) { } clients.delete(c) }
    }
  }
}

// نبضة كل 25 ثانية حتى الاتصال ما ينقطع
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n') } catch (e) { clients.delete(c) } } }, 25000).unref();

export const clientCount = () => clients.size;
