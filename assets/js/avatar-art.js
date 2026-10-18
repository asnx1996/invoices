// Original local SVG artwork: five collections, ten distinct characters each.
export const AVATAR_GROUPS = [
  ['people', 'شخصيات', ['آدم','نور','عمر','لينا','سامي','مريم','زيد','سارة','علي','هند']],
  ['pixel', 'بكسل', ['المغامر','النجمة','الفارس','المبرمجة','الطيار','المستكشفة','الحارس','الفنانة','الرحّال','القائدة']],
  ['robot', 'روبوتات', ['رادار','نوفا','بولت','مدار','بيبو','كوزمو','شرارة','أوربت','وميض','زيرو']],
  ['animal', 'حيوانات', ['قط','ثعلب','دب','باندا','أرنب','كوالا','بومة','نمر','كلب','ضفدع']],
  ['space', 'خيال وفضاء', ['رائد فضاء','قمر','شمس','كوكب','شبح لطيف','لهب','غيمة','نبتة','بلورة','نجم']],
];
export const AVATAR_KEYS = AVATAR_GROUPS.flatMap(([g,,names]) => names.map((_, i) => `${g}-${i + 1}`));
const colors = ['#4875D7','#D66B8D','#419B87','#9170C8','#DA9147','#5699B7','#C66551','#729849','#B578AF','#537D9B'];
const backgrounds = ['#DDEAFF','#FFE4ED','#DCF3E9','#EEE4FF','#FFF0D7','#DDF3FA','#FFE5DC','#EDF3D4','#F6E2F4','#E1ECF5'];
const skins = ['#EDB98A','#F5D0B0','#9D6748','#D39972','#704A37'];
const hairs = ['#263044','#50382F','#29272C','#AD633C','#D5B170'];
const circle = (x,y,r,c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const rect = (x,y,w,h,c,r=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;
const path = (d,c,stroke='none',width=2) => `<path d="${d}" fill="${c}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const eyes = (y=47, color='#263044') => circle(39,y,3,color)+circle(61,y,3,color);
const smile = (y=59) => path(`M44 ${y}q6 6 12 0`,'none','#263044',2.5);
export function normalizeAvatar(key) {
  if (AVATAR_KEYS.includes(key)) return key;
  // Replace old portraits consistently without touching saved account data.
  const old = /^([mf])(\d+)$/.exec(key || '');
  if (old && +old[2] >= 1 && +old[2] <= 12) return AVATAR_KEYS[(old[1] === 'f' ? 12 : 0) + +old[2] - 1];
  return null;
}
export function avatarSVG(key) {
  key = normalizeAvatar(key); if (!key) return '';
  const [group, n] = key.split('-'), i = +n - 1, c = colors[i], bg = backgrounds[i];
  let art = '';
  if (group === 'people') {
    const skin = skins[i % 5], hair = hairs[i % 5];
    art = (i % 2 ? rect(24,20,52,62,hair,25) : '') + path('M12 103v-9c0-19 17-25 38-25s38 6 38 25v9',c)
      + rect(43,61,14,17,skin,6) + circle(50,46,25,skin);
    const styles = [path('M25 41Q20 10 50 17Q80 10 75 41L62 28Q45 38 28 30',hair),path('M24 46Q19 13 50 15Q81 13 76 46L62 27Q49 40 24 46',hair),[28,39,50,61,72].map((x,j)=>circle(x,26-Math.sin(j)*5,10,hair)).join(''),path('M24 43Q20 13 50 14Q80 13 76 43L64 29L50 34L35 28Z',hair),path('M25 40Q25 15 50 17Q75 15 75 40L70 32Q50 20 30 32Z',hair)];
    art += styles[i%5]+eyes()+smile();
    if (i===5 || i===9) art = path('M19 73V42Q19 10 50 10Q81 10 81 42v31L66 82H34Z',c)+path('M12 103Q13 74 35 73L50 85L65 73Q88 74 88 103',c)+`<ellipse cx="50" cy="46" rx="22" ry="27" fill="${skin}"/>`+eyes()+smile()+path('M27 35Q50 9 73 35Q70 16 50 16Q30 16 27 35',c);
    if (i===2 || i===7) art += rect(30,40,17,14,'none',5).replace('fill="none"','fill="none" stroke="#263044" stroke-width="2"')+rect(53,40,17,14,'none',5).replace('fill="none"','fill="none" stroke="#263044" stroke-width="2"')+path('M47 45h6','none','#263044');
    if(i===4 || i===8) art += path('M28 53Q28 75 50 75Q72 75 72 53L62 63L50 60L38 63Z',hair)+smile(65);
  } else if (group === 'pixel') {
    const skin=skins[i%5], hair=hairs[i%5];
    art=rect(20,76,60,24,c)+rect(28,28,44,40,skin)+rect(36,68,28,8,skin)+rect(24,20,52,16,hair)+rect(i%2?64:24,36,12,24,hair)+rect(36,44,8,8,'#263044')+rect(56,44,8,8,'#263044')+rect(44,60,12,4,'#263044')+rect(44,80,12,20,'#fff');
    if(i%3===0) art+=rect(20,20,60,8,c)+rect(32,8,36,12,c)+rect(44,12,12,8,'#FFE191');
    if(i%3===1) art+=rect(20,40,8,24,c)+rect(72,40,8,24,c)+rect(28,12,44,8,c);
    if(i%3===2) art+=rect(32,40,16,16,'#39465D')+rect(52,40,16,16,'#39465D')+rect(48,44,4,4,'#39465D')+rect(36,44,8,4,'#8DE3EC');
  } else if (group === 'robot') {
    art=path('M50 25V12','none',c,4)+circle(50,12,5,'#F7B955')+rect(14,39,10,23,c,4)+rect(76,39,10,23,c,4)+rect(23,25,54,53,c,i%2?23:10)+rect(29,34,42,30,'#24364D',i%2?14:6)+rect(30,81,40,24,c,12);
    art+=i%3===0?rect(35,44,30,8,'#9AF5D7',4):circle(39,48, i%2?6:4,'#9AF5D7')+circle(61,48,i%2?4:6,'#9AF5D7');
    art+=rect(41,69,18,3,'#fff',1)+circle(50,91,5,'#FFE191')+circle(32,29,2,'#fff')+circle(68,29,2,'#fff');
  } else if(group==='animal') {
    const fur=['#8B8CBB','#E69A55','#AD7B5F','#F9FAFB','#FCF0E9','#96A5B6','#A880B5','#EDAE55','#C1906A','#8ABB70'][i];
    if(i===4) art+=`<ellipse cx="35" cy="25" rx="10" ry="24" fill="${fur}"/><ellipse cx="65" cy="25" rx="10" ry="24" fill="${fur}"/>`+rect(32,7,6,29,'#EAA6AD',3)+rect(62,7,6,29,'#EAA6AD',3);
    else if([0,1,6,7].includes(i)) art+=path('M22 44L18 13L43 30M57 30L82 13L78 44',fur);
    else art+=circle(25,31,i===5?17:12,i===3?'#354052':fur)+circle(75,31,i===5?17:12,i===3?'#354052':fur);
    art+=`<ellipse cx="50" cy="57" rx="33" ry="32" fill="${fur}"/>`;
    if(i===3) art+=circle(36,49,11,'#354052')+circle(64,49,11,'#354052');
    if(i===6) art+=circle(36,48,15,'#FFF2DB')+circle(64,48,15,'#FFF2DB');
    if(i===8) art+=`<ellipse cx="23" cy="49" rx="10" ry="23" fill="#77503E"/>`;
    art+=eyes(49,i===3?'#fff':'#263044')+`<ellipse cx="50" cy="67" rx="17" ry="12" fill="#FFF3E2"/>`+path('M45 61h10l-5 6z','#263044')+smile(70);
    if(i===7) art+=path('M24 40l8 4M21 57l9 1M76 40l-8 4M79 57l-9 1M45 29l5 8 5-8','none','#77503E',3);
    if(i===9) art+=circle(32,32,12,fur)+circle(68,32,12,fur)+circle(32,32,5,'#263044')+circle(68,32,5,'#263044');
  } else {
    const forms=[circle(50,48,31,'#F8FAFF')+rect(26,31,48,33,'#334B6A',16)+path('M21 101V86q29-25 58 0v15','#F8FAFF')+rect(42,85,16,10,c,3),path('M67 19Q20 10 21 51Q25 88 68 79Q40 66 46 42Q50 25 67 19','#E5C972'),Array.from({length:12},(_,j)=>`<path d="M50 10v8" stroke="#E7A844" stroke-width="5" stroke-linecap="round" transform="rotate(${j*30} 50 50)"/>`).join('')+circle(50,50,27,'#FFD775'),circle(50,49,28,c)+`<ellipse cx="50" cy="52" rx="43" ry="12" fill="none" stroke="#E8BC83" stroke-width="7" transform="rotate(-25 50 52)"/>`,path('M24 80V43a26 26 0 0 1 52 0v37l-9-7-9 7-8-7-8 7-9-7Z','#FAF7FF'),path('M50 12Q60 39 70 31Q88 61 66 80Q40 96 25 72Q12 50 38 29Q35 48 44 48Q53 32 50 12','#EE9563'),circle(34,53,20,'#fff')+circle(52,40,25,'#fff')+circle(72,55,18,'#fff')+rect(28,53,48,22,'#fff',10),path('M50 58Q19 54 24 27Q50 26 50 58Q50 20 80 19Q82 51 50 58', '#66A579')+path('M29 59h42l-6 27H35Z','#D99578'),path('M50 12L76 35L69 75L50 88L31 75L24 35Z',c)+path('M50 12L39 39L50 88L61 39Z','#FFFFFF55'),path('M50 12L61 36L87 39L68 58L73 85L50 72L27 85L32 58L13 39L39 36Z','#F3CC68')];
    art=forms[i]+eyes(i===7?70:49,i===0?'#9EF0EE':'#263044')+smile(i===7?78:60);
  }
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${rect(0,0,100,100,bg)}${circle(82,16,21,'#FFFFFF40')}${circle(12,91,26,'#FFFFFF35')}${art}</svg>`;
}
