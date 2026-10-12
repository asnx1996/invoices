import { $, toast } from './util.js';

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
  ['none', 'خلفية سادة', null],
  ['ledger', 'مكتب الحسابات', 'assets/backgrounds/ledger.jpg'],
  ['midnight', 'دفاتر المساء', 'assets/backgrounds/midnight.jpg'],
];
const read = key => { try { return localStorage.getItem(key) } catch { return null } };
function persist(key, value) {
  try { localStorage.setItem(key, value) }
  catch { toast('تم التطبيق، لكن المتصفح ما سمح بحفظ الاختيار للجلسة القادمة') }
}
let theme = read('ib_theme') || 'system';
if (!['system', ...THEMES.map(t => t[0])].includes(theme)) theme = 'system';
let custom = read('ib_bg');
// نقبل صور المتصفح فقط؛ ما نحمّل روابط خارجية من الإعدادات القديمة.
if (!/^data:image\/(jpeg|png|webp);base64,/.test(custom || '')) custom = null;
let background = read('ib_background') || (custom ? 'custom' : 'atlas-light');
if (![...BACKGROUNDS.map(b => b[0]), 'custom'].includes(background) || (background === 'custom' && !custom)) background = 'none';
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
function applyBackground() {
  const url = background === 'custom' ? custom : BACKGROUNDS.find(b => b[0] === background)?.[2];
  document.body.classList.toggle('has-bg', !!url);
  if (url) document.body.style.setProperty('--bg-img', `url("${new URL(url, document.baseURI).href}")`);
  else document.body.style.removeProperty('--bg-img');
}
function syncChoices() {
  document.querySelectorAll('[name="appearanceTheme"]').forEach(el => { el.checked = el.value === theme });
  document.querySelectorAll('[name="appearanceBackground"]').forEach(el => { el.checked = el.value === background });
  document.querySelectorAll('[data-mood]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.mood === theme && background === theme)) });
  $('#customBackground').hidden = !custom;
}
function openAppearance() { syncChoices(); $('#appearanceDialog').showModal() }

function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), src = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', .8));
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
  dialog.innerHTML = `<div class="appearance-head"><div><h2 id="appearanceTitle">مظهر الموقع</h2><p class="help">مساحة عمل على ذوقك · ينحفظ اختيارك على هذا الجهاز</p></div><button type="button" class="icon-btn" id="appearanceClose" aria-label="إغلاق مظهر الموقع">×</button></div>
    <div class="appearance-body"><fieldset><legend>ألوان مساحة العمل</legend><div class="appearance-grid">${THEMES.map(([id, title, subtitle, accent, bg]) => `<label class="appearance-option"><input type="radio" name="appearanceTheme" value="${id}"><span class="theme-sample" style="--sample-bg:${bg};--sample-accent:${accent}" aria-hidden="true"><i></i><i></i><i></i></span><strong>${title}</strong><small>${subtitle}</small></label>`).join('')}</div><label class="appearance-system"><input type="radio" name="appearanceTheme" value="system"> حسب إعدادات الجهاز</label></fieldset>
    <fieldset><legend>صورة الخلفية</legend><div class="appearance-grid">${BACKGROUNDS.map(([id, title, url]) => `<label class="appearance-option"><input type="radio" name="appearanceBackground" value="${id}">${url ? `<img src="${url}" alt="" width="240" height="135" loading="lazy">` : '<span class="background-plain" aria-hidden="true"></span>'}<strong>${title}</strong></label>`).join('')}</div><label class="appearance-system" id="customBackground"><input type="radio" name="appearanceBackground" value="custom"> صورتي الخاصة</label></fieldset>
    <p class="help">الخلفية تظهر حول البطاقات؛ بيانات الطلبات تبقى على أسطح واضحة للقراءة.</p></div>
    <div class="appearance-foot"><button type="button" class="btn" id="appearanceUpload">رفع صورة خاصة</button><button type="button" class="btn primary" id="appearanceDone">تم</button></div>`;
  document.body.append(dialog);
  const moods = document.createElement('fieldset');
  moods.innerHTML = `<legend>ثيمات كاملة</legend><p class="help">شكل متكامل للبطاقات والأزرار والنوافذ والخلفية. اختار ثيمك بضغطة، أو خصص الألوان والصورة أدناه.</p><div class="appearance-grid mood-grid">${MOODS.map(([id, title, subtitle]) => `<button type="button" class="appearance-option mood-option" data-mood="${id}" aria-pressed="false"><img src="${moodImage(id)}" alt="" width="240" height="135" loading="lazy"><strong>${title}</strong><small>${subtitle}</small></button>`).join('')}</div>`;
  dialog.querySelector('.appearance-body').prepend(moods);
  moods.addEventListener('click', e => {
    const button = e.target.closest('[data-mood]');
    if (!button) return;
    theme = background = button.dataset.mood;
    persist('ib_theme', theme); persist('ib_background', background);
    applyTheme(); applyBackground(); syncChoices();
  });
  $('#bgBtn').onclick = openAppearance;
  $('#bgBtn').setAttribute('aria-label', 'مظهر الموقع: الثيمات والخلفيات');
  $('#bgBtn').title = 'مظهر الموقع';
  $('#bgBtn').setAttribute('aria-haspopup', 'dialog');
  $('#bgBtn').setAttribute('aria-controls', dialog.id);
  $('#appearanceClose').onclick = $('#appearanceDone').onclick = () => dialog.close();
  $('#appearanceUpload').onclick = () => $('#bgIn').click();
  dialog.addEventListener('change', e => {
    if (e.target.name === 'appearanceTheme') { theme = e.target.value; persist('ib_theme', theme); applyTheme() }
    if (e.target.name === 'appearanceBackground') { background = e.target.value; persist('ib_background', background); applyBackground() }
    syncChoices();
  });
  $('#themeBtn').onclick = () => {
    theme = isDark() ? 'light' : 'dark';
    persist('ib_theme', theme); applyTheme(); syncChoices();
  };
  $('#bgIn').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    if (!file.type.startsWith('image/')) return toast('اختار ملف صورة');
    if (file.size > 15 * 1024 * 1024) return toast('اختار صورة أصغر من 15 MB');
    const button = $('#appearanceUpload'); button.disabled = true;
    try {
      custom = await shrink(file); background = 'custom';
      persist('ib_bg', custom); persist('ib_background', background);
      applyBackground(); syncChoices();
    } catch (err) { toast(err.message) }
    finally { button.disabled = false }
  };
  scheme.addEventListener('change', () => { if (theme === 'system') applyTheme() });
  applyTheme(); applyBackground(); syncChoices();
}
