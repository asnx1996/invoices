import { S, hasRole, hasPerm } from './state.js';

// نسخة من قواعد القاعدة للواجهة فقط (الحماية الحقيقية بالقاعدة — supabase/migrations/018)
// الصلاحيات يوزعها الأدمن على الأدوار من صفحة المستخدمين؛ الأدمن عنده كلشي
export function can(a, inv) {
  const admin = hasRole('admin'), P = hasPerm;
  const own = inv && inv.rep_id === S.ME.id;
  switch (a) {
    case 'create': return P('create');
    case 'export': return P('export');
    case 'users': return P('users');
    case 'customers': return P('customers');
    case 'trash': return P('trash');
    case 'reports': return P('reports');
    case 'backup': case 'settings': return admin;
    case 'editBasic': return admin || (inv.stage === 'new' && P('create') && own);
    case 'editValue': return admin || (inv.stage === 'new' && P('create') && own) || (inv.stage === 'acc' && P('acc'));
    case 'sendToAcc': return inv.stage === 'new' && (admin || (P('create') && own));
    case 'editTerms': return admin || (inv.stage === 'acc' && P('acc'));
    case 'sendToDecision': return inv.stage === 'acc' && P('acc');
    case 'setCost': return admin || (inv.stage === 'acc' && P('acc'));
    case 'returnToRep': return inv.stage === 'acc' && P('acc');
    case 'move': return P('move');
    case 'approve': case 'returnToAcc': return inv.stage === 'decision' && inv.sub === 'mgr' && P('approve');
    case 'custAccept': case 'custRefuse': return inv.stage === 'decision' && inv.sub === 'cust' && (P('cust_all') || (P('create') && own));
    case 'complete': return inv.stage === 'decision' && inv.sub === 'wh' && P('complete');
    case 'toggleUrgent': return ['new', 'acc', 'decision'].includes(inv.stage) && (P('urgent_all') || (P('create') && own));
    case 'delete': return P('trash');
    case 'home': return !!S.BOARDS && S.BOARDS.length > 1;
    case 'setBoard': return admin && !!S.BOARDS && S.BOARDS.length > 1;
    case 'requestDelete': return !P('trash') && !inv.delete_req_at;
    case 'cancelDeleteReq': return !!inv.delete_req_at && (P('trash') || inv.delete_req_by === S.ME.id);
    case 'seeProfit': return admin || (P('see_profit') && ['decision', 'done', 'cancel'].includes(inv.stage));
    case 'seeTerms': return inv.stage !== 'new' || P('see_all') || P('acc');
  }
  return false;
}
