// أفتارات جاهزة يختار منها المستخدم — مرسومة بالكود (SVG) فما تحتاج ملفات أو إنترنت.
// المفتاح ينحفظ بـ profiles.avatar (مثل m3). بدون أفتار: دائرة ملونة بأول حرفين من الاسم.
import { S, changed } from './state.js';
import { $, esc, initials, ask, toast } from './util.js';
import { rpc } from './api.js';

const SKIN = ['#F6D5B8', '#EDC19C', '#D9A27A', '#B97D56', '#8D5A3B'];
const HAIR = ['#2B2118', '#4A3222', '#1B1B1F', '#7A4B2A', '#B8B8BE', '#C98B4F'];
const BG = ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#EDE9FE', '#FCE7F3', '#E0F2FE', '#FFE4E6', '#D1FAE5', '#FDE68A', '#E9D5FF', '#CCFBF1', '#FED7AA'];
const CLOTH = ['#1D4ED8', '#0F766E', '#7C3AED', '#B45309', '#BE123C', '#334155', '#15803D', '#0369A1', '#9D174D', '#4338CA'];

// [خلفية, بشرة, شعر/حجاب, لون الحجاب أو الشعر, ملابس, لحية, نظارة]
// hair: short | side | curly | buzz | bald | long | bob | bun | hijab
// beard: 0 بدون | 1 شارب | 2 لحية خفيفة | 3 لحية كاملة
const P = {
  m1: [0, 1, 'short', 0, 0, 0, 0], m2: [2, 2, 'side', 1, 3, 1, 0], m3: [5, 0, 'curly', 2, 5, 0, 1],
  m4: [6, 3, 'buzz', 2, 4, 3, 0], m5: [3, 1, 'bald', 4, 1, 3, 1], m6: [1, 2, 'short', 2, 6, 2, 0],
  m7: [10, 4, 'curly', 2, 7, 2, 0], m8: [11, 1, 'side', 5, 2, 0, 1], m9: [4, 0, 'short', 3, 9, 1, 0],
  m10: [8, 3, 'side', 0, 5, 3, 0], m11: [9, 2, 'buzz', 4, 0, 1, 1], m12: [7, 1, 'bald', 1, 3, 2, 0],
  f1: [4, 1, 'hijab', 8, 8, 0, 0], f2: [0, 0, 'hijab', 1, 0, 0, 0], f3: [3, 2, 'hijab', 5, 5, 0, 1],
  f4: [1, 3, 'hijab', 6, 1, 0, 0], f5: [9, 1, 'hijab', 2, 2, 0, 0], f6: [11, 0, 'hijab', 3, 7, 0, 1],
  f7: [6, 1, 'long', 1, 4, 0, 0], f8: [5, 2, 'bob', 0, 9, 0, 0], f9: [10, 0, 'bun', 3, 6, 0, 1],
  f10: [2, 3, 'long', 2, 3, 0, 0], f11: [7, 4, 'hijab', 9, 6, 0, 0], f12: [8, 1, 'bob', 5, 2, 0, 1],
};
export const AVATAR_KEYS = Object.keys(P);

// ألوان الحجاب أوسع من ألوان الشعر
const HIJAB = ['#1E293B', '#7C2D12', '#BE185D', '#0F766E', '#6D28D9', '#B45309', '#475569', '#9F1239', '#DB2777', '#1D4ED8'];

function draw(key) {
  const p = P[key]; if (!p) return '';
  const [bg, sk, hair, hc, cl, beard, glasses] = p;
  const skin = SKIN[sk], shade = 'rgba(0,0,0,.12)', ink = '#1F1A17';
  const hairC = hair === 'hijab' ? HIJAB[hc % HIJAB.length] : HAIR[hc % HAIR.length];
  let back = '', front = '', face = '';

  // الجسم والرقبة
  const body = hair === 'hijab'
    ? `<path d="M8 66c0-12 9-19 24-19s24 7 24 19z" fill="${CLOTH[cl]}"/>`
    : `<path d="M9 66c0-11 9-18 23-18s23 7 23 18z" fill="${CLOTH[cl]}"/><path d="M26.5 37h11v9.5a5.5 5.5 0 0 1-11 0z" fill="${skin}"/><path d="M26.5 40.5c3.6 2 7.4 2 11 0V37h-11z" fill="${shade}"/><path d="M26 48.2c1.6 2.3 3.6 3.3 6 3.3s4.4-1 6-3.3" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.6"/>`;

  if (hair === 'hijab') {
    back = `<path d="M15.5 31C15.5 18.5 22.8 11 32 11s16.5 7.5 16.5 20c0 6-1.6 11-3.8 14.8C41 51 36.7 52 32 52s-9-1-12.7-6.2C17.1 42 15.5 37 15.5 31z" fill="${hairC}"/>`;
    front = `<path d="M20.4 27.5C21 19.8 25.8 15.5 32 15.5s11 4.3 11.6 12c-2.6-4.7-6.6-7.2-11.6-7.2s-9 2.5-11.6 7.2z" fill="${hairC}"/><path d="M20.3 29c.3-8 5.2-13 11.7-13s11.4 5 11.7 13" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>`;
  } else if (hair === 'long') {
    back = `<path d="M18 30c0-11 6-17 14-17s14 6 14 17v17c0 2-2 3-4 3H22c-2 0-4-1-4-3z" fill="${hairC}"/>`;
    front = `<path d="M20.2 29c-.4-9 4.6-14.5 11.8-14.5 7.6 0 12.3 5.6 11.8 14.2-4.6-1-9-4-11.2-8.4C30.4 24.8 25.8 28 20.2 29z" fill="${hairC}"/>`;
  } else if (hair === 'bob') {
    back = `<path d="M17.5 31c0-11.5 6.3-18 14.5-18s14.5 6.5 14.5 18v8.5c0 1.8-1.4 3-3.2 3H20.7c-1.8 0-3.2-1.2-3.2-3z" fill="${hairC}"/>`;
    front = `<path d="M20.3 28.5c-.2-8.6 4.8-14 11.7-14s11.9 5.4 11.7 14c-5.5 0-11-2.6-13.4-7-1.6 3.8-5.4 6.4-10 7z" fill="${hairC}"/>`;
  } else if (hair === 'bun') {
    back = `<circle cx="32" cy="11.5" r="6" fill="${hairC}"/>`;
    front = `<path d="M20.4 28c-.4-8.6 4.8-13.8 11.6-13.8S44 19.4 43.6 28c-2.8-3.6-6.8-5.8-11.6-5.8S23.2 24.4 20.4 28z" fill="${hairC}"/>`;
  } else if (hair === 'short') {
    front = `<path d="M20.4 28.5c-1-9.4 4.4-15 11.6-15s12.6 5.6 11.6 15c-1-4-3.8-6.8-7.8-7.6-2.8 1.4-6.8 1.6-11.4.6-2.3 1.4-3.6 3.8-4 7z" fill="${hairC}"/>`;
  } else if (hair === 'side') {
    front = `<path d="M20.2 29c-1.4-10 4.2-16.2 12.2-16.2 6.8 0 12.2 4.6 11.4 15.8-.8-3.4-2.4-6-4.8-7.4-5.6 1.2-12 .6-15.4-2.2-1.8 2.2-3 5.6-3.4 10z" fill="${hairC}"/><path d="M23.6 19.2c3.6 2.6 9.6 3 15.2 1.8" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1"/>`;
  } else if (hair === 'curly') {
    front = `<g fill="${hairC}"><circle cx="22.5" cy="23" r="4.2"/><circle cx="26" cy="17.8" r="4.6"/><circle cx="32" cy="15.6" r="4.8"/><circle cx="38" cy="17.8" r="4.6"/><circle cx="41.5" cy="23" r="4.2"/><circle cx="29" cy="20.5" r="4"/><circle cx="35" cy="20.5" r="4"/></g>`;
  } else if (hair === 'buzz') {
    front = `<path d="M20.6 27.5c-.6-8.4 4.6-13.4 11.4-13.4s12 5 11.4 13.4c-2.6-3.6-6.6-5.6-11.4-5.6s-8.8 2-11.4 5.6z" fill="${hairC}" opacity=".85"/>`;
  } else if (hair === 'bald') {
    front = `<path d="M20.3 30.5c.2-2.4.8-4 1.8-5.2v6.6zM43.7 30.5c-.2-2.4-.8-4-1.8-5.2v6.6z" fill="${hairC}"/><path d="M26 17.5c2-1.3 4.4-1.8 6.6-1.6" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.4" stroke-linecap="round"/>`;
  }

  // الوجه
  const ears = hair === 'hijab' || hair === 'long' || hair === 'bob' ? '' : `<ellipse cx="20.3" cy="29.5" rx="2.4" ry="3.2" fill="${skin}"/><ellipse cx="43.7" cy="29.5" rx="2.4" ry="3.2" fill="${skin}"/>`;
  face = `${ears}<ellipse cx="32" cy="28.5" rx="11.6" ry="13" fill="${skin}"/>`;
  const brows = `<path d="M25.6 24.3q2.4-1.4 4.6-.2M33.8 24.1q2.2-1.2 4.6.2" fill="none" stroke="${hair === 'hijab' ? ink : HAIR[hc % HAIR.length]}" stroke-width="1.3" stroke-linecap="round" opacity=".8"/>`;
  const eyes = `<ellipse cx="27.9" cy="28.2" rx="1.35" ry="1.6" fill="${ink}"/><ellipse cx="36.1" cy="28.2" rx="1.35" ry="1.6" fill="${ink}"/><circle cx="28.3" cy="27.7" r=".45" fill="#fff"/><circle cx="36.5" cy="27.7" r=".45" fill="#fff"/>`;
  const cheeks = `<ellipse cx="25.3" cy="33" rx="2.2" ry="1.3" fill="#F43F5E" opacity=".16"/><ellipse cx="38.7" cy="33" rx="2.2" ry="1.3" fill="#F43F5E" opacity=".16"/>`;
  const nose = `<path d="M32 29.5v3.1q-.9.5-1.6.1" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.1" stroke-linecap="round"/>`;
  const mouth = beard === 3 ? `<path d="M29.2 36.2q2.8 1.9 5.6 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".85"/>`
    : `<path d="M28.8 35.3q3.2 2.8 6.4 0" fill="none" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/>`;

  let bd = '';
  const bc = HAIR[hc % HAIR.length];
  if (beard === 1) bd = `<path d="M28.2 33.5q3.8-2.1 7.6 0q-3.8 .8-7.6 0z" fill="${bc}"/>`;
  if (beard === 2) bd = `<path d="M20.6 30c.4 7.6 5.2 11.6 11.4 11.6s11-4 11.4-11.6c-1.4 4-3.4 6.2-6 7.2-1.6-1.5-3.3-2.2-5.4-2.2s-3.8.7-5.4 2.2c-2.6-1-4.6-3.2-6-7.2z" fill="${bc}" opacity=".55"/><path d="M28.2 33.5q3.8-2.1 7.6 0q-3.8 .8-7.6 0z" fill="${bc}"/>`;
  if (beard === 3) bd = `<path d="M20.4 29.5c0 8.4 5 13.6 11.6 13.6s11.6-5.2 11.6-13.6c-1.4 4.2-3.4 6.4-6.2 7.2-1.6-1.8-3.2-2.6-5.4-2.6s-3.8.8-5.4 2.6c-2.8-.8-4.8-3-6.2-7.2z" fill="${bc}"/><path d="M27.6 34.4q4.4-2.6 8.8 0q-4.4 1.1-8.8 0z" fill="${bc}"/>`;

  const gl = glasses ? `<g fill="rgba(255,255,255,.18)" stroke="${ink}" stroke-width="1.1"><rect x="24.3" y="25.4" width="7.2" height="5.6" rx="2.2"/><rect x="32.5" y="25.4" width="7.2" height="5.6" rx="2.2"/></g><path d="M31.5 27.6h1M24.3 27.2l-3.4-.8M39.7 27.2l3.4-.8" stroke="${ink}" stroke-width="1.1" fill="none"/>` : '';

  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect width="64" height="64" fill="${BG[bg]}"/>${back}${body}${face}${cheeks}${bd}${nose}${mouth}${eyes}${brows}${gl}${front}</svg>`;
}

const cache = {};
export const avatarSVG = key => cache[key] ??= draw(key);

// لون ثابت لكل اسم للي ما اختاروا أفتار (بدل الأزرق للكل)
const TINTS = [['#DBEAFE', '#1D4ED8'], ['#DCFCE7', '#15803D'], ['#FEF3C7', '#B45309'], ['#EDE9FE', '#6D28D9'], ['#FCE7F3', '#BE185D'], ['#CCFBF1', '#0F766E'], ['#FFE4E6', '#BE123C'], ['#E0F2FE', '#0369A1']];
const tint = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return TINTS[h % TINTS.length] };

// أفتار شخص (id أو profile). size بالبكسل
export function avatarHTML(who, size = 26, extraCls = '') {
  const p = typeof who === 'object' && who ? who : S.PROFILES.find(x => x.id === who) || (S.ME && S.ME.id === who ? S.ME : null);
  const name = p ? p.full_name : '';
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px`;
  if (p && p.avatar && P[p.avatar]) return `<span class="avatar img ${extraCls}" style="${st}" aria-hidden="true">${avatarSVG(p.avatar)}</span>`;
  const [bg, fg] = tint(name || '?');
  return `<span class="avatar ${extraCls}" style="${st};background:${bg};color:${fg}" aria-hidden="true">${esc(initials(name))}</span>`;
}

// اسمي وصورتي بالشريط العلوي
export function paintMe() {
  if (!S.ME) return;
  $('#meAv').innerHTML = avatarHTML(S.ME, 30);
}

// نافذة اختيار الأفتار — لنفسي، أو الأدمن لأي مستخدم
export function openAvatarPicker(userId = S.ME.id) {
  const p = userId === S.ME.id ? S.ME : S.PROFILES.find(x => x.id === userId);
  if (!p) return;
  const mine = userId === S.ME.id;
  ask(mine ? 'اختار صورتك' : 'صورة: ' + p.full_name, [], () => { }, { okText: 'تم' });
  const cur = p.avatar || '';
  $('#mBody').innerHTML = `<p class="help" style="margin:0">${mine ? 'تطلع جنب اسمك بالكروت والتعليقات والإشعارات.' : 'تطلع جنب اسمه لكل المستخدمين.'}</p>
    <div class="av-grid" role="radiogroup" aria-label="الصور">
      <button type="button" class="av-opt${cur ? '' : ' on'}" data-av="" role="radio" aria-checked="${!cur}" title="بدون صورة (الحروف)">${avatarHTML({ full_name: p.full_name }, 56)}</button>
      ${AVATAR_KEYS.map(k => `<button type="button" class="av-opt${k === cur ? ' on' : ''}" data-av="${k}" role="radio" aria-checked="${k === cur}" aria-label="صورة ${k}"><span class="avatar img" style="width:56px;height:56px">${avatarSVG(k)}</span></button>`).join('')}
    </div>`;
  $('#mBody .av-grid').onclick = async e => {
    const b = e.target.closest('[data-av]'); if (!b || b.classList.contains('busy')) return;
    const key = b.dataset.av;
    b.classList.add('busy');
    const r = await rpc('set_avatar', { p_user: userId, p_avatar: key || null });
    b.classList.remove('busy');
    if (!r.ok) return;
    const val = key || null;
    const prof = S.PROFILES.find(x => x.id === userId); if (prof) prof.avatar = val;
    if (mine) S.ME.avatar = val;
    $$av().forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)) });
    paintMe(); changed(); toast('تغيرت الصورة');
  };
}
const $$av = () => [...document.querySelectorAll('#mBody .av-opt')];
