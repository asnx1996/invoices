import { ANIM_ACCEPT, animatedMediaBlob } from './background-media.js';
import { $, toast } from './util.js';
import { hasRole, getBoard } from './state.js';
import { STARS } from './stars-data.js';
import { saveBoardLook, loadBoardAnim } from './api.js';

const THEMES = [
  ['light', 'أزرق أطلس', 'هوية أطلس بلاست', '#0C5093', '#F4F6F9'],
  ['ivory', 'العاجي والذهبي', 'دفء وأناقة', '#806019', '#F5F1E8'],
  ['dark', 'الكحلي الليلي', 'هدوء للعمل المسائي', '#60A5FA', '#0B1120'],
  ['anime', 'حسابات الأنمي', 'دفاتر تحت ضوء الساكورا', '#794287', '#F7F1F8'],
  ['future', 'حسابات المستقبل', 'مكتب حسابات بأضواء النيون', '#67E8F9', '#0C1024'],
  ['nature', 'حسابات في الطبيعة', 'مكتب هادئ بإطلالة خضراء', '#375E55', '#EFF4F0'],
];
const MOODS = [
  ['anime', 'أنمي · مكتب الحسابات', 'دفاتر وفواتير بأجواء ساكورا'],
  ['future', 'مستقبل · مكتب الحسابات', 'حسابات رقمية وأضواء نيون'],
  ['nature', 'طبيعة · مكتب الحسابات', 'فواتير ودفاتر بإطلالة الغابة'],
];
const MOOD_IMAGES = { anime: 'assets/backgrounds/scene-anime.png', future: 'assets/backgrounds/scene-future.png', nature: 'assets/backgrounds/scene-nature.png' };
const moodImage = id => MOOD_IMAGES[id];
const BACKGROUNDS = [
  ...MOODS.map(([id, title]) => [id, title, moodImage(id)]),
  ['atlas-light', 'أطلس · انسياب أزرق', 'assets/backgrounds/atlas-light.png'],
  ['atlas-dark', 'أطلس · أزرق ليلي', 'assets/backgrounds/atlas-dark.png'],
  ['stars', 'سماء النجوم · متحركة', null],
  ['stars-day', 'سماء النهار · متحركة', null],
  ['none', 'خلفية سادة', null],
  ['ledger', 'مكتب الحسابات', 'assets/backgrounds/ledger.jpg'],
  ['midnight', 'دفاتر المساء', 'assets/backgrounds/midnight.jpg'],
];

// الخلفية والضبابية للبورد (012/013): الأدمن يحددها والكل يشوفها.
// الألوان (الثيم) تبقى لكل جهاز. صفحة البوردات تاخذ الخلفية الافتراضية.
export const DEFAULT_BG = 'atlas-light';
export function boardBgUrl(b) {
  const id = (b && b.bg) || DEFAULT_BG;
  if (id === 'custom') return (b && b.bg_custom) || null;
  return BACKGROUNDS.find(x => x[0] === id)?.[2] || null;
}

const read = key => { try { return localStorage.getItem(key) } catch { return null } };
function persist(key, value) {
  try { localStorage.setItem(key, value) }
  catch { toast('تم التطبيق، لكن المتصفح ما سمح بحفظ الاختيار للجلسة القادمة') }
}
let theme = read('ib_theme') || 'system';
if (!['system', ...THEMES.map(t => t[0])].includes(theme)) theme = 'system';
const scheme = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => ['dark', 'future'].includes(theme) || (theme === 'system' && scheme.matches);

function applyTheme() {
  const root = document.documentElement;
  root.classList.add('no-trans');
  if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
  const dark = isDark();
  if (MOODS.some(([id]) => id === theme)) root.dataset.mood = theme;
  else delete root.dataset.mood;
  if (MOODS.some(([id]) => id === theme)) document.body.style.setProperty('--mood-img', `url("${new URL(moodImage(theme), document.baseURI).href}")`);
  else document.body.style.removeProperty('--mood-img');
  $('#themeBtn').setAttribute('aria-pressed', String(dark));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES.find(([id]) => id === theme)?.[4] || (dark ? '#0B1120' : '#F4F6F9');
  void root.offsetHeight;
  requestAnimationFrame(() => root.classList.remove('no-trans'));
}

let lookKey = '';
const onHome = () => { const h = document.querySelector('#viewHome'); return !!h && !h.classList.contains('hidden') };

// سماء النجوم (Uiverse · jaykdoe): ثلاث طبقات نجوم (box-shadow) تطلع لفوق بسرعات مختلفة — CSS بس، تشتغل حتى على الموبايل
// mode: 'night' (ألوان الواجهة داكنة متناسقة) أو 'day' (الواجهة تبقى فاتحة) أو null
function syncStars(mode) {
  let el = document.querySelector('.bg-stars');
  document.body.classList.toggle('has-stars', mode === 'night');
  document.body.classList.toggle('has-stars-day', mode === 'day');
  if (!mode) return el && el.remove();
  if (el) return el.classList.toggle('day', mode === 'day');
  el = document.createElement('div');
  el.className = 'bg-stars' + (mode === 'day' ? ' day' : ''); el.setAttribute('aria-hidden', 'true');
  STARS.forEach((shadow, i) => {
    const layer = document.createElement('i');
    layer.className = 's' + (i + 1); layer.style.setProperty('--stars', shadow);
    el.append(layer);
  });
  document.body.prepend(el);
}

function setLook(url, blur, fit, stars) {
  syncStars(stars);
  document.body.classList.toggle('has-bg', !!url || stars || document.body.classList.contains('has-anim'));
  document.body.classList.toggle('bg-contain', fit === 'contain');
  if (url) document.body.style.setProperty('--bg-img', `url("${url.startsWith('data:') ? url : new URL(url, document.baseURI).href}")`);
  else document.body.style.removeProperty('--bg-img');
  document.body.style.setProperty('--bg-blur', blur + 'px');
  document.body.classList.toggle('bg-blurred', blur > 0);
}

// خلفية متحركة (016): بس على الحاسبة، وما تشتغل إذا الجهاز طالب حركة أقل.
// على الموبايل ما تنجاب أصلاً وتبقى الصورة الثابتة
const desktop = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const animCache = new Map();   // رقم البورد ← data URL
let animFor = null;

function clearAnim() {
  document.querySelector('.bg-anim')?.remove();
  document.body.classList.remove('has-anim');
  document.body.classList.toggle('has-bg', !!document.body.style.getPropertyValue('--bg-img') || !!document.querySelector('.bg-stars'));
}
function showAnim(src, fit) {
  const el = document.createElement(src.startsWith('data:video') ? 'video' : 'img');
  el.className = 'bg-anim' + (fit === 'contain' ? ' contain' : '');
  el.setAttribute('aria-hidden', 'true'); el.alt = '';
  if (el.tagName === 'VIDEO') Object.assign(el, { muted: true, loop: true, autoplay: true, playsInline: true, disablePictureInPicture: true });
  if (el.tagName === 'VIDEO') el.addEventListener('error', () => {
    if (!el.isConnected) return;
    clearAnim();
    toast('الفيديو مرفوع بس المتصفح ما يكدر يشغّل ترميزه. جرّب MP4 بترميز H.264 أو WebM.');
  }, { once: true });
  el.src = src;
  document.body.prepend(el);
  document.body.classList.add('has-anim', 'has-bg');
}
async function syncAnim(b) {
  const want = b && b.has_anim && desktop.matches && !calm.matches ? b.id : null;
  const el = document.querySelector('.bg-anim');
  const fitChanged = !!el && el.classList.contains('contain') !== (b?.bg_fit === 'contain');
  if (want === animFor && !fitChanged) return;
  animFor = want; clearAnim();
  if (!want) return;
  if (!animCache.has(want)) animCache.set(want, loadBoardAnim(want));   // نخزن الوعد: ما تنجاب مرتين
  const src = await animCache.get(want);
  if (animFor === want && src && !document.querySelector('.bg-anim')) showAnim(src, b.bg_fit);
}
document.addEventListener('visibilitychange', () => {
  const v = document.querySelector('video.bg-anim'); if (!v) return;
  document.hidden ? v.pause() : v.play().catch(() => { });
});

// تنادى بعد كل تغيير؛ ما تعيد الرسم إذا ما تغير شي
export function applyLook() {
  const b = onHome() ? null : getBoard(), url = boardBgUrl(b), blur = b ? +b.blur || 0 : 0, fit = b && b.bg_fit;
  const id = (b && b.bg) || DEFAULT_BG, stars = id === 'stars' ? 'night' : id === 'stars-day' ? 'day' : null;
  syncAnim(b);
  const key = (url || '').slice(0, 64) + (url || '').length + '|' + blur + '|' + fit + '|' + stars;
  if (key === lookKey) return;
  lookKey = key;
  setLook(url, blur, fit, stars);
}
const relook = () => { animFor = undefined; lookKey = ''; applyLook() };
desktop.addEventListener('change', relook); calm.addEventListener('change', relook);

function syncChoices() {
  const b = getBoard(), admin = hasRole('admin') && !!b;
  document.querySelectorAll('[name="appearanceTheme"]').forEach(el => { el.checked = el.value === theme });
  document.querySelectorAll('[data-mood]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.mood === theme)) });
  $('#bgFieldset').hidden = !admin; $('#appearanceUpload').hidden = !admin;
  if (!admin) return;
  document.querySelectorAll('[name="appearanceBackground"]').forEach(el => { el.checked = el.value === (b.bg || DEFAULT_BG) });
  $('#bgLegend').textContent = `خلفية بورد "${b.name}" (تطلع لكل أعضاء البورد)`;
  $('#customBackground').hidden = !b.bg_custom;
  $('#bgBlur').value = +b.blur || 0; $('#bgBlurV').textContent = (+b.blur || 0) + 'px';
  $('#bgFitRow').hidden = !('bg_fit' in b);
  $('#animRow').hidden = !('has_anim' in b);
  $('#animRemove').hidden = !b.has_anim;
  $('#animState').textContent = b.has_anim ? 'مرفوعة ✓' : '';
  document.querySelectorAll('[name="bgFit"]').forEach(el => { el.checked = el.value === (b.bg_fit || 'cover') });
}
function openAppearance() { syncChoices(); $('#appearanceDialog').showModal() }

// الصورة المرفوعة: دقة عالية (حتى 2560) وننزل الجودة بس إذا طلعت ثقيلة على القاعدة
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), src = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, 2560 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        let q = .9, out = canvas.toDataURL('image/jpeg', q);
        while (out.length > 3800000 && q > .5) { q -= .1; out = canvas.toDataURL('image/jpeg', q) }
        resolve(out);
      } catch { reject(new Error('تعذّر تجهيز الصورة')) }
      finally { URL.revokeObjectURL(src) }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('ما انقرت الصورة')) };
    img.src = src;
  });
}

export function initAppearance() {
  const dialog = document.createElement('dialog');
  dialog.id = 'appearanceDialog'; dialog.className = 'appearance-dialog';
  dialog.setAttribute('aria-labelledby', 'appearanceTitle');
  dialog.innerHTML = `<div class="appearance-head"><div><h2 id="appearanceTitle">مظهر الموقع</h2><p class="help">الألوان تنحفظ على هذا الجهاز</p></div><button type="button" class="icon-btn" id="appearanceClose" aria-label="إغلاق مظهر الموقع">×</button></div>
    <div class="appearance-body">
    <fieldset id="bgFieldset"><legend id="bgLegend">خلفية البورد</legend>
      <div class="fit-row" id="bgFitRow" role="radiogroup" aria-label="طريقة عرض الصورة">
        <label class="role-chk"><input type="radio" name="bgFit" value="cover">ملء الشاشة</label>
        <label class="role-chk"><input type="radio" name="bgFit" value="contain">إظهار الصورة كاملة</label></div>
      <div class="anim-row" id="animRow"><span>خلفية متحركة <small class="help">(MP4 / WebM / GIF / WebP — لحد 5.5 MB، للحاسبة فقط)</small> <b id="animState"></b></span>
        <button type="button" class="btn sm" id="animUpload">رفع فيديو أو صورة متحركة</button><button type="button" class="btn sm bad" id="animRemove">إزالة</button>
        <input type="file" id="animIn" accept="${ANIM_ACCEPT}" class="hidden"></div>
      <label class="blur-row" for="bgBlur"><span>ضبابية الخلفية</span><input type="range" id="bgBlur" min="0" max="30" step="1" value="0"><output id="bgBlurV" for="bgBlur">0px</output></label>
      <div class="appearance-grid">${BACKGROUNDS.map(([id, title, url]) => `<label class="appearance-option"><input type="radio" name="appearanceBackground" value="${id}">${url ? `<img src="${url}" alt="" width="240" height="135" loading="lazy">` : `<span class="background-plain${id === 'stars' ? ' background-stars' : id === 'stars-day' ? ' background-stars-day' : ''}" aria-hidden="true"></span>`}<strong>${title}</strong></label>`).join('')}</div>
      <label class="appearance-system" id="customBackground"><input type="radio" name="appearanceBackground" value="custom"> الصورة المرفوعة</label></fieldset>
    <fieldset><legend>ألوان مساحة العمل</legend><div class="appearance-grid">${THEMES.map(([id, title, subtitle, accent, bg]) => `<label class="appearance-option"><input type="radio" name="appearanceTheme" value="${id}"><span class="theme-sample" style="--sample-bg:${bg};--sample-accent:${accent}" aria-hidden="true"><i></i><i></i><i></i></span><strong>${title}</strong><small>${subtitle}</small></label>`).join('')}</div><label class="appearance-system"><input type="radio" name="appearanceTheme" value="system"> حسب إعدادات الجهاز</label></fieldset>
    </div>
    <div class="appearance-foot"><button type="button" class="btn" id="appearanceUpload">رفع صورة للبورد</button><button type="button" class="btn primary" id="appearanceDone">تم</button></div>`;
  document.body.append(dialog);
  const moods = document.createElement('fieldset');
  moods.innerHTML = `<legend>ثيمات كاملة</legend><p class="help">شكل متكامل للبطاقات والأزرار والنوافذ. اختار ثيمك بضغطة.</p><div class="appearance-grid mood-grid">${MOODS.map(([id, title, subtitle]) => `<button type="button" class="appearance-option mood-option" data-mood="${id}" aria-pressed="false"><img src="${moodImage(id)}" alt="" width="240" height="135" loading="lazy"><strong>${title}</strong><small>${subtitle}</small></button>`).join('')}</div>`;
  $('#bgFieldset').after(moods);
  moods.addEventListener('click', e => {
    const button = e.target.closest('[data-mood]');
    if (!button) return;
    theme = button.dataset.mood;
    persist('ib_theme', theme); applyTheme(); syncChoices();
  });
  $('#bgBtn').onclick = openAppearance;
  $('#bgBtn').setAttribute('aria-label', 'مظهر الموقع');
  $('#bgBtn').title = 'مظهر الموقع';
  $('#bgBtn').setAttribute('aria-haspopup', 'dialog');
  $('#bgBtn').setAttribute('aria-controls', dialog.id);
  $('#appearanceClose').onclick = $('#appearanceDone').onclick = () => dialog.close();
  $('#appearanceUpload').onclick = () => $('#bgIn').click();
  dialog.addEventListener('change', async e => {
    if (e.target.name === 'appearanceTheme') { theme = e.target.value; persist('ib_theme', theme); applyTheme() }
    const b = getBoard(), admin = b && hasRole('admin');
    if (e.target.name === 'appearanceBackground' && admin) await saveBoardLook(b.id, { bg: e.target.value });
    if (e.target.id === 'bgBlur' && admin) await saveBoardLook(b.id, { blur: +e.target.value });
    if (e.target.name === 'bgFit' && admin) await saveBoardLook(b.id, { bg_fit: e.target.value });
    syncChoices();
  });
  // معاينة مباشرة للضبابية وهو يسحب، والحفظ لما يترك (change)
  dialog.addEventListener('input', e => {
    if (e.target.id !== 'bgBlur') return;
    $('#bgBlurV').textContent = e.target.value + 'px';
    setLook(boardBgUrl(getBoard()), +e.target.value, (getBoard() || {}).bg_fit);
    lookKey = '';
  });
  $('#themeBtn').onclick = () => {
    theme = isDark() ? 'light' : 'dark';
    persist('ib_theme', theme); applyTheme(); syncChoices();
  };
  $('#bgIn').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const b = getBoard(); if (!b || !hasRole('admin')) return;
    if (!file.type.startsWith('image/')) return toast('اختار ملف صورة');
    if (file.size > 15 * 1024 * 1024) return toast('اختار صورة أصغر من 15 MB');
    const button = $('#appearanceUpload'); button.disabled = true;
    try {
      if (await saveBoardLook(b.id, { bg: 'custom', bg_custom: await shrink(file) })) toast('تغيرت خلفية البورد للكل');
      syncChoices();
    } catch (err) { toast(err.message) }
    finally { button.disabled = false }
  };
  $('#animUpload').onclick = () => $('#animIn').click();
  $('#animIn').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const b = getBoard(); if (!b || !hasRole('admin')) return;
    const button = $('#animUpload'); button.disabled = true; toast('جاري رفع الخلفية المتحركة...');
    try {
      const media = await animatedMediaBlob(file);
      const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('ما انقرى الملف')); r.readAsDataURL(media) });
      if (await saveBoardLook(b.id, { bg_anim: data })) {
        delete b.bg_anim; b.has_anim = true; animCache.set(b.id, Promise.resolve(data)); relook();
        toast(desktop.matches ? 'تغيرت الخلفية المتحركة للبورد' : 'انرفعت — تبين بس على شاشة الحاسبة');
      }
      syncChoices();
    } catch (err) { toast(err.message) }
    finally { button.disabled = false }
  };
  $('#animRemove').onclick = async () => {
    const b = getBoard(); if (!b || !hasRole('admin')) return;
    if (await saveBoardLook(b.id, { bg_anim: null })) { delete b.bg_anim; b.has_anim = false; animCache.delete(b.id); relook(); toast('انشالت الخلفية المتحركة') }
    syncChoices();
  };
  scheme.addEventListener('change', () => { if (theme === 'system') applyTheme() });
  applyTheme(); applyLook();
}
