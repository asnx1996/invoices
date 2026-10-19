import { $ } from './util.js';
import { STARS } from './stars-data.js';

// مظهر الموقع: ثيمين بس — سماء الليل وسماء النهار (نجوم Uiverse · jaykdoe تطلع لفوق).
// زر BB-8 (Uiverse · Galahhad) يبدّل بينهم، والاختيار ينحفظ على هذا الجهاز.
// أول مرة: حسب الوضع الداكن/الفاتح بالجهاز.
const KEY = 'ib_sky';
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } };
const keep = v => { try { localStorage.setItem(KEY, v) } catch { } };

let sky = read();
if (!['night', 'day'].includes(sky)) sky = matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';

// الطبقات الثلاث (1px / 2px / 3px) — لون النجمة ياخذ color من CSS
function starLayer() {
  const el = document.createElement('div');
  el.className = 'bg-stars'; el.setAttribute('aria-hidden', 'true');
  STARS.forEach((shadow, i) => {
    const layer = document.createElement('i');
    layer.className = 's' + (i + 1); layer.style.setProperty('--stars', shadow);
    el.append(layer);
  });
  document.body.prepend(el);
  return el;
}

function apply() {
  const night = sky === 'night', b = document.body;
  b.classList.add('has-bg');
  b.classList.toggle('has-stars', night);
  b.classList.toggle('has-stars-day', !night);
  (document.querySelector('.bg-stars') || starLayer()).classList.toggle('day', !night);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = night ? '#0D1118' : '#EEF4FB';
  const t = $('#skyToggle'); if (t) t.checked = night;
}

const TOGGLE = `<label class="bb8-toggle" title="ليل / نهار">
  <input class="bb8-toggle__checkbox" type="checkbox" id="skyToggle" aria-label="الوضع الليلي">
  <div class="bb8-toggle__container" aria-hidden="true">
    <div class="bb8-toggle__scenery">
      ${'<div class="bb8-toggle__star"></div>'.repeat(7)}
      <div class="tatto-1"></div><div class="tatto-2"></div>
      <div class="gomrassen"></div><div class="hermes"></div><div class="chenini"></div>
      ${'<div class="bb8-toggle__cloud"></div>'.repeat(3)}
    </div>
    <div class="bb8">
      <div class="bb8__head-container"><div class="bb8__antenna"></div><div class="bb8__antenna"></div><div class="bb8__head"></div></div>
      <div class="bb8__body"></div>
    </div>
    <div class="artificial__hidden"><div class="bb8__shadow"></div></div>
  </div>
</label>`;

export function initAppearance() {
  $('#skySlot').innerHTML = TOGGLE;
  apply();
  $('#skyToggle').addEventListener('change', e => { sky = e.target.checked ? 'night' : 'day'; keep(sky); apply() });
}
