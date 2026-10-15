// دليل الاستخدام: دليل واحد لكل الموظفين (عدا الأدمن)، قسم لكل دور، بصور من النسخة التجريبية.
// الاستخدام: node docs/guides/shots.mjs && node docs/guides/build.mjs  →  docs/guides/pdf/*.pdf
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const EDGE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
await mkdir(join(DIR, 'pdf'), { recursive: true });
await copyFile(join(DIR, '../../assets/brand/atlasplast-logo.png'), join(DIR, 'img/logo.png'));

// ---------- القطع المشتركة ----------
const img = (f, cls = '') => `<img class="${cls}" src="img/${f}.jpg" alt="">`;
const tip = t => `<div class="tip"><b>نصيحة:</b> ${t}</div>`;
const warn = t => `<div class="tip warn"><b>انتبه:</b> ${t}</div>`;
// خطوة: نص + صورة (جنبه أو تحته)
const step = (n, title, body, pic = '', side = true) => `<section class="step${side && pic ? ' side' : ''}">
  <div class="txt"><h3><span class="n"></span>${title}</h3>${body}</div>${pic ? `<div class="pic">${pic}</div>` : ''}</section>`;

const START = (role, n0 = 1) => [
  step(n0, 'الدخول واختيار البورد', `<p>افتح الموقع واكتب <b>اسم المستخدم</b> و<b>الرمز</b> اللي انطاك ياهم الأدمن.</p>
    <p>إذا عندك أكثر من بورد (مثلاً المنطقة الوسطى والجنوبية) تطلعلك صفحة <b>البوردات</b>: اضغط على البورد اللي تريد تشتغل عليه. ترجع لها من زر <b>البوردات</b> فوك.</p>
    <p>تغيّر رمزك من زر المفتاح 🔑 فوك. وتكدر تثبّت الموقع كتطبيق على الموبايل.</p>`, img('home', 'shot')),
  step(n0 + 1, 'شكل اللوحة', `<p>كل طلب <b>كرت</b>، والكرت يمشي بين الأعمدة حسب مرحلته:</p>
    <p class="flow"><span>طلب جديد</span>←<span>الحسابات</span>←<span>بانتظار القرار</span>←<span>تمت / ملغاة</span></p>
    <p>بالكرت: اسم الزبون وصورة المندوب، القيمة، وتحت رقم الطلب. <b>طارئ</b> 🔥 يطلع فوك العمود، والطلب اللي صار له <b>3 أيام</b> بنفس المرحلة يتلون أحمر.</p>
    <p>اضغط الكرت حتى ينفتح الطلب. فوك اللوحة تكدر تبحث، وتفلتر حسب المندوب أو الحالة (الفلتر بيه بحث، تكتب جزء من الاسم).</p>`, img('board_' + role, 'shot wide'), false),
];

const NOTIF = n => step(n, 'الإشعارات 🔔', `<p>الجرس فوك يوصلك عليه كل شي يخصك: طلب صار دورك بيه، أحد ذكرك بـ <b>@</b>، طلب رجع إلك، أو طلب متأخر.</p>
  <p>من <b>يوصلني</b> تختار: كل الإشعارات، المهمة بس، المنشن بس، أو بدون.</p>
  <p>وبكل طلب، جوه اسم الزبون، تكدر تغيّر إشعارات <b>هذا الطلب بس</b>.</p>
  ${tip('اضغط "فعّل تنبيهات الجهاز" حتى توصلك الإشعارات على الموبايل حتى لو الموقع مسكّر.')}`, img('notif', 'shot narrow'));

const COMMENTS = n => step(n, 'التعليقات والمنشن', `<p>بأسفل كل طلب اكتب تعليق. إذا تريد شخص يشوفه اكتب <b>@</b> وأول اسمه واختاره، فيوصله إشعار.</p>
  <p>تكدر تعدل أو تحذف تعليقك. وإذا الطلب غلط ولازم ينحذف، اضغط <b>طلب حذف</b> واكتب السبب، والأدمن يقرر.</p>`);

// ---------- الأدلة ----------
const GUIDES = {
  rep: { title: 'دليل المندوب', who: 'تنشئ الطلب، تتابعه، وتبلّغ رد الزبون', parts: () => [
    ...START('rep'),
    step(3, 'طلب جديد', `<ol>
      <li>اضغط <b>+ طلب جديد</b>.</li>
      <li><b>اسم الزبون:</b> اكتب جزء من الاسم واختاره من القائمة. إذا الزبون مو موجود راجع الأدمن.</li>
      <li>اكتب <b>رقم عرض السعر</b> أو <b>رقم الحجز</b>، واحد منهم بس.</li>
      <li>اختار <b>عملة الفاتورة</b> (دولار أو دينار) وبعدها اكتب <b>القيمة</b>. الدينار يتحول دولار حسب سعر الصرف.</li>
      <li>ارفع <b>ملف الـ PDF</b> (أقصى حد 2 MB).</li>
      <li>اضغط <b>حفظ الطلب</b>. الطلب ما يطلع باللوحة إلا بعد الحفظ.</li>
      <li>لما تكمل كلشي اضغط <b>إرسال للحسابات</b>.</li></ol>
      ${tip('إذا نسيت حقل، الموقع يگلك شنو ناقص.')}`, img('rep_new', 'shot drawer')),
    step(4, 'إذا رجع الطلب إلك', `<p>إذا المحاسب أو المدير رجّع الطلب، يوصلك إشعار والكرت يطلع بعمود <b>طلب جديد</b> عليه علامة <b>مرجعة</b>.</p>
      <p>افتحه، اقرا التعليق (شنو المطلوب تعدله)، عدّل، واضغط <b>حفظ التعديلات</b> وبعدها <b>إرسال للحسابات</b> مرة ثانية.</p>`),
    step(5, 'رد الزبون', `<p>بعد ما يوافق المدير، الطلب يصير <b>بانتظار رد الزبون</b> ويوصلك إشعار "دورك".</p>
      <p>بلّغ الزبون بالشروط وبعدها اضغط:</p>
      <ul><li><b>الزبون موافق</b>: الطلب يروح للمخزن.</li><li><b>الزبون رفض</b>: تكتب السبب والطلب يصير ملغى.</li></ul>
      <p>زر <b>طارئ</b> 🔥 يخلي الطلب فوك العمود حتى ينتبهوله.</p>`, img('rep_cust', 'shot drawer')),
    COMMENTS(6), NOTIF(7),
  ] },

  acc: { title: 'دليل المحاسب', who: 'تكمّل شروط السداد والنقل والكلفة وترسل الطلب للقرار', parts: () => [
    ...START('acc'),
    step(3, 'استلام الطلب', `<p>الطلبات اللي تنتظرك تطلع بعمود <b>الحسابات</b>، ويوصلك إشعار لكل طلب جديد.</p>
      <p>افتح الطلب وتأكد من البيانات وملف الـ PDF. تكدر تعدّل <b>قيمة الفاتورة</b> إذا لازم (تختار العملة أول).</p>
      <p>إذا البيانات غلط اضغط <b>إرجاع للمندوب</b> واكتب شنو يعدّل، فيرجع إله مع إشعار.</p>`, img('acc_top', 'shot drawer')),
    step(4, 'السداد والنقل والكلفة', `<ol>
      <li><b>طريقة السداد:</b> نقدي أو آجل. إذا آجل اختار المدة (شهر، شهرين، 3 أشهر).</li>
      <li><b>النقل:</b> على الزبون (واكتب المبلغ، ينضاف على القيمة) أو بدون نقل.</li>
      <li><b>عدد النقاط</b> إذا أكو. كل نقطة = 1.5%.</li>
      <li><b>خصم لاحق:</b> أشّره إذا أكو، واكتب النسبة.</li>
      <li><b>سعر الكلفة:</b> بعد الحفظ يختفي، ومحد يشوفه غير الأدمن.</li>
      <li>اضغط <b>حفظ التعديلات</b> بالشريط اللي يطلع جوه.</li></ol>`, img('acc', 'shot drawer')),
    step(5, 'إرسال للقرار', `<p>لما تكمل كل الحقول اضغط <b>إرسال للقرار</b>، والطلب يروح للمدير. إذا شي ناقص، الموقع يگلك شنو.</p>
      <p>إذا المدير رجّع الطلب إلك، يوصلك إشعار وتلكى السبب بالتعليقات.</p>
      <p><b>تصدير Excel:</b> زر فوك اللوحة، تختار الفترة والمندوب والحالة.</p>`),
    COMMENTS(6), NOTIF(7),
  ] },

  mgr: { title: 'دليل المدير', who: 'توافق على الشروط، تتابع الربح والتأخير، وتشوف التقارير', parts: () => [
    ...START('mgr'),
    step(3, 'الموافقة', `<p>الطلبات اللي تنتظرك تطلع بعمود <b>بانتظار القرار</b> مكتوب عليها "بانتظار موافقة المدير"، ويوصلك إشعار.</p>
      <p>افتح الطلب وشوف الشروط و<b>الربح</b> (الإجمالي، نسبة الربح، والصافي بعد الخصم والنقاط).</p>
      <ul><li><b>موافقة على الشروط</b>: الطلب يروح للمندوب حتى يبلّغ الزبون.</li>
      <li><b>إرجاع للحسابات</b>: مع سبب اختياري.</li></ul>`, img('mgr', 'shot drawer')),
    step(4, 'التحكم بالطلبات', `<ul>
      <li><b>نقل لمرحلة ثانية</b>: تنقل الطلب لأي مرحلة (إلا "تمت"). وتكدر تسحب الكرت بالماوس من عمود لعمود.</li>
      <li><b>طارئ</b> 🔥: يخلي الطلب فوك العمود.</li>
      <li>تكدر تأشّر <b>رد الزبون</b> بدل المندوب، وتحوّل الطلب لمبيعات بدل المخزن.</li>
      <li>بطاقة <b>متأخرة</b> فوك اللوحة: اضغطها تطلعلك بس الطلبات المتأخرة 3 أيام أو أكثر.</li></ul>`),
    step(5, 'التقارير', `<p>من تبويب <b>التقارير</b> تختار الفترة وتشوف: عدد الطلبات، المكتملة والملغاة، المتأخرة، متوسط المدة وصافي الربح، أداء كل مندوب، المبيعات حسب الشهر، ووين يتأخر الطلب.</p>
      <p>التقرير للبورد المختار فوك.</p>`, img('reports', 'shot narrow')),
    COMMENTS(6), NOTIF(7),
  ] },

  wh: { title: 'دليل المخزن', who: 'تحوّل الطلبات الموافق عليها لمبيعات', parts: () => [
    ...START('wh'),
    step(3, 'تحويل لمبيعات', `<p>تشوف الطلبات اللي <b>بانتظار القرار</b> واللي <b>تمت</b>. الطلبات اللي تنتظرك مكتوب عليها <b>بانتظار تحويل المخزن</b>، ويوصلك إشعار لكل واحد.</p>
      <ol><li>افتح الطلب وشوف البيانات وملف الـ PDF.</li>
      <li>سوّي فاتورة المبيعات بالنظام.</li>
      <li>اضغط <b>تحويل لمبيعات + رقم المبيعات</b> واكتب رقم الفاتورة.</li></ol>
      <p>الطلب ينتقل لعمود <b>تمت</b>، والمندوب يوصله إشعار.</p>
      ${warn('اكتب رقم المبيعات صح، لأنه يطلع بالتقارير والتصدير.')}`, img('wh', 'shot drawer')),
    COMMENTS(4), NOTIF(5),
  ] },

  admin: { title: 'دليل الأدمن', who: 'تدير المستخدمين والبوردات والإعدادات، وتشوف كلشي', parts: () => [
    ...START('admin'),
    step(3, 'المستخدمين', `<ul>
      <li><b>مستخدم جديد</b>: الاسم، اسم المستخدم (إنجليزي)، الرمز، الأدوار، والبوردات. تطلع بيانات الدخول مرة وحدة حتى تنطيها للموظف.</li>
      <li>الشخص ممكن ياخذ <b>أكثر من دور</b> (مثلاً مندوب + محاسب).</li>
      <li>عمود <b>البوردات</b>: تأشّر وين يشتغل الموظف. الأدمن يشوف الكل.</li>
      <li><b>مفعّل</b>: تشيله يطلع الموظف من كل أجهزته فوراً. و<b>تغيير الرمز</b> لأي موظف.</li></ul>`, img('users', 'shot wide'), false),
    step(4, 'البوردات والخلفية', `<ul>
      <li><b>بورد جديد</b>: من صفحة البوردات أو صفحة المستخدمين. بعدها أشّر الموظفين اللي يشوفوه.</li>
      <li>كل بورد معزول: طلباته وتقاريره وإشعاراته إله بس.</li>
      <li><b>نقل لبورد ثاني</b>: زر داخل الطلب، للأدمن بس.</li>
      <li><b>الخلفية</b>: زر الصورة 🖼 فوك. تختار خلفية أو ترفع صورة، "ملء الشاشة" أو "إظهار الصورة كاملة"، وتتحكم بالضبابية. تطلع لكل أعضاء البورد.</li></ul>`, img('bg', 'shot drawer')),
    step(5, 'باقي الإعدادات', `<ul>
      <li><b>الزبائن</b>: تضيف وتعدّل وتستورد من Excel. المندوب يختار منهم بس.</li>
      <li><b>العملة وسعر الصرف</b>: بأسفل صفحة المستخدمين.</li>
      <li><b>طلبات الحذف</b>: فلتر الحالة ← "طلبات الحذف". تحذف نهائياً أو ترفض.</li>
      <li><b>سعر الكلفة</b> تشوفه انت بس، و<b>الربح</b> تشوفه انت والمدير.</li>
      <li><b>نسخة احتياطية الآن</b>: بصفحة المستخدمين.</li></ul>
      ${tip('اقرا أدلة باقي الأدوار حتى تعرف شنو يشوف كل موظف.')}`),
    NOTIF(6),
  ] },
};

// دليل واحد لكل الموظفين (بدون الأدمن): البداية مرة وحدة، وبعدها قسم لكل دور
const ROLES = [['rep', 'المندوب'], ['acc', 'المحاسب'], ['mgr', 'المدير'], ['wh', 'المخزن']];
const ALL = { file: 'دليل الاستخدام', title: 'دليل الاستخدام', who: 'للمندوب والمحاسب والمدير والمخزن · اقرا البداية وبعدها قسم دورك', parts: () => [
  `<div class="role">${START('mgr').join('')}${COMMENTS(0)}${NOTIF(0)}</div>`,
  ...ROLES.map(([k, name]) => `<div class="role"><h2 class="role-h">${name} <small>${GUIDES[k].who}</small></h2>${GUIDES[k].parts().slice(2, -2).join('')}</div>`),
] };

const CSS = `
@page{size:A4;margin:14mm 13mm 14mm}
*{box-sizing:border-box}
body{background:#fff;font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#0F172A;font-size:11.2pt;line-height:1.65;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{display:flex;align-items:center;gap:16px;padding:0 0 12px;margin-bottom:14px;border-bottom:3px solid #0C5093}
header img{width:118px;height:auto}
header h1{margin:0;font-size:24pt;color:#0C5093;line-height:1.2}
header p{margin:2px 0 0;color:#475569;font-size:11pt}
header .app{margin-inline-start:auto;text-align:end;color:#64748B;font-size:9.5pt}
.step{break-inside:avoid;margin:0 0 14px;padding:12px 14px;border:1px solid #E2E8F0;border-radius:12px;background:#fff}
.step.side{display:grid;grid-template-columns:1fr 240px;gap:16px;align-items:start}
.step h3{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:13.5pt;color:#0C5093}
.role{counter-reset:st}.step{counter-increment:st}.n::before{content:counter(st)}
.n{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#0C5093;color:#fff;font-size:11pt;flex:none}
.step p{margin:0 0 6px}
.step ol,.step ul{margin:0 0 6px;padding-inline-start:20px}
.step li{margin-bottom:2px}
.shot{display:block;width:100%;border:1px solid #CBD5E1;border-radius:10px;box-shadow:0 2px 8px rgba(15,23,42,.12)}
.shot.wide{margin-top:8px}
.shot.drawer{max-height:118mm;object-fit:cover;object-position:top}
.shot.narrow{max-height:95mm;object-fit:cover;object-position:top}
.flow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;color:#64748B}
.flow span{background:#E7EFF8;color:#0C5093;font-weight:600;padding:1px 10px;border-radius:999px}
.tip{margin-top:6px;padding:7px 11px;border-radius:8px;background:#EEF6FF;border-inline-start:4px solid #0C5093;font-size:10.3pt}
.tip.warn{background:#FFF4E5;border-color:#C2410C}
b{color:#0B1F3A}
h2.role-h{display:flex;align-items:center;gap:10px;margin:18px 0 10px;padding:8px 14px;border-radius:10px;background:#0C5093;color:#fff;font-size:15pt;break-after:avoid}
h2.role-h small{font-weight:400;font-size:10.5pt;opacity:.85}
.role{break-before:auto}
footer{position:fixed;bottom:-9mm;left:0;right:0;text-align:center;font-size:8.5pt;color:#94A3B8}`;

const page = g => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${g.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>
<header><img src="img/logo.png" alt="Atlas Plast"><div><h1>${g.title}</h1><p>${g.who}</p></div><div class="app">نظام فواتير المبيعات<br>الصور من نسخة تجريبية ببيانات وهمية</div></header>
${g.parts().join('\n')}
<footer>Atlas Plast · نظام فواتير المبيعات</footer>
</body></html>`;

console.log('Guide:');
for (const g of [ALL]) {
  const html = join(DIR, 'guide.html'), pdf = join(DIR, 'pdf', `${g.file}.pdf`);
  await writeFile(html, page(g));
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=8000',
    `--user-data-dir=${join(DIR, '.edge-profile')}`, `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: 'ignore' });
  console.log('  ✓ ' + g.title);
}
