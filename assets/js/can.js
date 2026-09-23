import { S, hasRole } from './state.js';

// نسخة من قواعد القاعدة للواجهة فقط (الحماية الحقيقية بالقاعدة — supabase/migrations/004)
export function can(a, inv) {
  const admin = hasRole('admin'), rep = hasRole('rep'), acc = hasRole('acc'), mgr = hasRole('mgr'), wh = hasRole('wh');
  const own = inv && inv.rep_id === S.ME.id;
  switch (a) {
    case 'create': return admin || rep;
    case 'export': return admin || acc || mgr;
    case 'users': case 'customers': case 'backup': return admin;
    case 'reports': return admin || mgr;
    case 'editBasic': return admin || (inv.stage === 'new' && rep && own);
    case 'sendToAcc': return inv.stage === 'new' && (admin || (rep && own));
    case 'editTerms': return admin || (inv.stage === 'acc' && acc);
    case 'sendToDecision': return inv.stage === 'acc' && (admin || acc);
    case 'setCost': return admin || (inv.stage === 'acc' && acc);
    case 'approve': case 'returnToAcc': return inv.stage === 'decision' && inv.sub === 'mgr' && (admin || mgr);
    case 'custAccept': case 'custRefuse': return inv.stage === 'decision' && inv.sub === 'cust' && (admin || mgr || (rep && own));
    case 'complete': return inv.stage === 'decision' && inv.sub === 'wh' && (admin || mgr || wh);
    case 'delete': return admin;
    case 'requestDelete': return !admin && !inv.delete_req_at;
    case 'cancelDeleteReq': return !!inv.delete_req_at && (admin || inv.delete_req_by === S.ME.id);
    case 'seeProfit': return admin || (mgr && ['decision', 'done', 'cancel'].includes(inv.stage));
    case 'seeTerms': return inv.stage !== 'new' || admin || acc || mgr;
  }
  return false;
}
