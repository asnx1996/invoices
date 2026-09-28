import { $, toast } from './util.js';

const THEMES = [
  ['light', 'الأزرق الرسمي', 'وضوح وتركيز', '#1D4ED8', '#F4F6F9'],
  ['ivory', 'العاجي والذهبي', 'دفء وأناقة', '#806019', '#F5F1E8'],
  ['dark', 'الكحلي الليلي', 'هدوء للعمل المسائي', '#60A5FA', '#0B1120'],
];
const BACKGROUNDS = [
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
let background = read('ib_background') || (custom ? 'custom' : 'ledger');
if (![...BACKGROUNDS.map(b => b[0]), 'custom'].includes(background) || (background === 'custom' && !custom)) background = 'none';
const scheme = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const root = document.documentElement;
  root.classList.add('no-trans');
  if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && scheme.matches);
  $('#themeBtn').setAttribute('aria-pressed', String(dark));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0B1120' : theme === 'ivory' ? '#806019' : '#1D4ED8';
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
  });
  $('#themeBtn').onclick = () => {
    theme = theme === 'dark' || (theme === 'system' && scheme.matches) ? 'light' : 'dark';
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
