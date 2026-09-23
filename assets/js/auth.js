import { LOGIN_DOMAIN } from './config.js';
import { S, rolesText } from './state.js';
import { sb, configured, loadAll, subscribe, unsubscribe } from './api.js';
import { $, esc } from './util.js';

const loginEmail = u => { u = u.trim().toLowerCase(); return u.includes('@') ? u : u + LOGIN_DOMAIN };
function authMsg(t, cls = 'bad') { $('#authMsg').innerHTML = `<div class="auth-msg ${cls}">${esc(t)}</div>` }
function showAuth() { $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden') }

let booting = false;
async function boot(onReady) {
  if (booting) return; booting = true;
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return showAuth();
    const { data: prof, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) { authMsg(error.message); return showAuth() }
    if (!prof || !prof.active) {
      authMsg('حسابك موقوف أو لسه ما مفعّل. راجع الأدمن.');
      showAuth(); await sb.auth.signOut(); return;
    }
    S.ME = { ...prof, roles: prof.roles && prof.roles.length ? prof.roles : [prof.role] };
    $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden');
    $('#meName').textContent = S.ME.full_name || user.email;
    $('#rolePill').textContent = rolesText(S.ME.roles);
    onReady();
    await loadAll();
    subscribe();
  } finally { booting = false }
}

export function initAuth(onReady) {
  if (!configured) {
    $('#cfgWarn').innerHTML = '<div class="cfg-warn">ما مضبوطة الإعدادات. حط <b>SUPABASE_URL</b> و<b>SUPABASE_ANON_KEY</b> بملف assets/js/config.js</div>';
    return;
  }
  $('#authBtn').onclick = async () => {
    const user = $('#em').value.trim(), password = $('#pw').value;
    if (!user || !password) return authMsg('اكتب اسم المستخدم والرمز');
    $('#authBtn').classList.add('busy');
    try {
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(user), password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'اسم المستخدم أو الرمز غلط' : error.message);
    } catch (e) { authMsg(e.message || 'صار خطأ') }
    $('#authBtn').classList.remove('busy');
  };
  ['#em', '#pw'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') $('#authBtn').click() }));
  $('#outBtn').onclick = async () => { await sb.auth.signOut(); location.reload() };

  // INITIAL_SESSION يغني عن getSession؛ TOKEN_REFRESHED ما يحتاج إعادة تحميل
  sb.auth.onAuthStateChange((e, session) => {
    if (!session) { S.ME = null; unsubscribe(); return showAuth() }
    if (e === 'INITIAL_SESSION' || (e === 'SIGNED_IN' && !S.ME)) setTimeout(() => boot(onReady), 0);
  });
}
