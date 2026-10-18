// أفتارات جاهزة يختار منها المستخدم — صور 3D محلية تُحمّل من نفس الموقع.
// المفتاح ينحفظ بـ profiles.avatar (مثل m3). بدون أفتار: دائرة ملونة بأول حرفين من الاسم.
import { S, changed } from './state.js';
import { $, esc, initials, ask, toast } from './util.js';
import { rpc } from './api.js';

import { AVATAR_GROUPS, AVATAR_KEYS, normalizeAvatar, avatarArt } from './avatar-art.js';
export { AVATAR_KEYS, avatarArt };

// لون ثابت لكل اسم للي ما اختاروا أفتار (بدل الأزرق للكل)
const TINTS = [['#DBEAFE', '#1D4ED8'], ['#DCFCE7', '#15803D'], ['#FEF3C7', '#B45309'], ['#EDE9FE', '#6D28D9'], ['#FCE7F3', '#BE185D'], ['#CCFBF1', '#0F766E'], ['#FFE4E6', '#BE123C'], ['#E0F2FE', '#0369A1']];
const tint = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return TINTS[h % TINTS.length] };

// أفتار شخص (id أو profile). size بالبكسل
export function avatarHTML(who, size = 26, extraCls = '') {
  const p = typeof who === 'object' && who ? who : S.PROFILES.find(x => x.id === who) || (S.ME && S.ME.id === who ? S.ME : null);
  const name = p ? p.full_name : '';
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px`;
  if (p && p.avatar && normalizeAvatar(p.avatar)) return `<span class="avatar img ${extraCls}" style="${st}" aria-hidden="true">${avatarArt(p.avatar)}</span>`;
  const [bg, fg] = tint(name || '?');
  return `<span class="avatar ${extraCls}" style="${st};background:${bg};color:${fg}" aria-hidden="true">${esc(initials(name))}</span>`;
}

// اسمي وصورتي بالشريط العلوي
export function paintMe() {
  if (!S.ME) return;
  $('#meAv').innerHTML = avatarHTML(S.ME, 30);
}

// الاختيار محلي حتى يضغط حفظ؛ منع الطلبات المتزامنة يحافظ على آخر اختيار.
export function openAvatarPicker(userId = S.ME.id, welcome = false) {
  const p = userId === S.ME.id ? S.ME : S.PROFILES.find(x => x.id === userId);
  if (!p) return;
  const mine = userId === S.ME.id;
  let selected = normalizeAvatar(p.avatar) || '', saving = false;
  ask(welcome ? 'أهلاً بيك! اختار صورتك' : mine ? 'اختار صورتك' : 'صورة: ' + p.full_name, [], () => {}, { okText: 'حفظ الصورة' });
  const body = $('#mBody'), modal = $('#modal'), save = $('#mOk');
  body.innerHTML = `<p class="help">${welcome ? 'خلّي حسابك يشبهك. اختار من 50 صورة، وتكدر تبدّلها بأي وقت من صورتك فوق.' : '50 صورة 3D: شباب، بنات وشخصيات مرحة. اختار الصورة وبعدين اضغط حفظ.'}</p>
    <div class="avatar-preview">${avatarHTML({full_name:p.full_name,avatar:selected},72)}<span>${esc(p.full_name)}</span></div>
    <div class="avatar-collections"><button type="button" class="btn sm av-initials" aria-pressed="${!selected}">حروف اسمي بدون صورة</button>
    ${AVATAR_GROUPS.map(([group,label,names]) => `<section class="avatar-collection"><h4>${label}</h4><div class="av-grid" role="group" aria-label="${label}">${names.map((name,i) => { const k = group + '-' + (i+1); return `<button type="button" class="av-opt${k===selected?' on':''}" data-av="${k}" aria-pressed="${k===selected}" aria-label="${label}: ${name}" title="${name}"><span class="avatar img" style="width:56px;height:56px">${avatarArt(k)}</span></button>` }).join('')}</div></section>`).join('')}</div>
    <div class="err" id="mErr" role="alert"></div>`;
  body.onclick = e => {
    const b = e.target.closest('[data-av],.av-initials'); if (!b || saving) return;
    selected = b.dataset.av || '';
    body.querySelectorAll('[data-av]').forEach(x => { const on=x.dataset.av===selected; x.classList.toggle('on',on); x.setAttribute('aria-pressed',String(on)) });
    body.querySelector('.av-initials').setAttribute('aria-pressed', String(!selected));
    body.querySelector('.avatar-preview').innerHTML = avatarHTML({full_name:p.full_name,avatar:selected},72)+`<span>${esc(p.full_name)}</span>`;
  };
  const blockClose = e => { if(saving) e.preventDefault() };
  modal.addEventListener('cancel', blockClose);
  modal.addEventListener('close', () => { body.onclick=null; modal.removeEventListener('cancel',blockClose) }, {once:true});
  save.onclick = async e => {
    e.preventDefault(); if(saving) return;
    saving=true; save.disabled=true; save.textContent='جاري الحفظ...';
    try {
      const r = await rpc('set_avatar', {p_user:userId,p_avatar:selected || null});
      if(!r.ok) { $('#mErr').textContent='ما انحفظت الصورة، حاول مرة ثانية.'; return }
      const prof=S.PROFILES.find(x=>x.id===userId);
      if(prof) Object.assign(prof,{avatar:selected || null,avatar_chosen:true});
      if(mine) Object.assign(S.ME,{avatar:selected || null,avatar_chosen:true});
      paintMe(); changed(); modal.close(); toast('انحفظت الصورة');
    } catch { if(modal.open) $('#mErr').textContent='تعذر الاتصال، حاول مرة ثانية.' }
    finally { saving=false; save.disabled=false; save.textContent='حفظ الصورة' }
  };
}
