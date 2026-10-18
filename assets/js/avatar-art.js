// صور 3D محلية. المفاتيح القديمة محفوظة حتى تبقى اختيارات الحسابات متوافقة.
export const AVATAR_GROUPS = [
  ['people', 'شباب · كاجوال', ['آدم','عمر','علي','حسن','سامي','زيد','يوسف','ليث','أمير','كرار']],
  ['pixel', 'شباب · ستايل', ['أحمد','مصطفى','حيدر','عباس','حسين','قاسم','مهند','سيف','سجاد','باقر']],
  ['robot', 'شباب · كلاسيك', ['أبو علي','نور','محمد','مازن','حمزة','بشار','فهد','رامي','أيمن','إياد']],
  ['animal', 'شباب · شخصيات', ['كريم','عمار','جواد','نبيل','وسام','طارق','ياسر','عادل','بلال','أنس']],
  ['space', 'بنات وشخصيات مرحة', ['مريم','نور','سارة','لينا','هند','ثعلب','روبوت أبيض','أسد','قط','روبوت أزرق']],
];
export const AVATAR_KEYS = AVATAR_GROUPS.flatMap(([g,,names]) => names.map((_, i) => `${g}-${i + 1}`));
export const AVATAR_SHEETS = {
  people: 'assets/avatars/people-3d.webp',
  pixel: 'assets/avatars/pixel-3d.webp',
  robot: 'assets/avatars/robot-3d.webp',
  animal: 'assets/avatars/animal-3d.webp',
  space: 'assets/avatars/space-3d.webp',
};
export function normalizeAvatar(key) {
  if (AVATAR_KEYS.includes(key)) return key;
  const old = /^([mf])(\d+)$/.exec(key || '');
  if (old && +old[2] >= 1 && +old[2] <= 12)
    return old[1] === 'f' ? `space-${(+old[2]-1)%5+1}` : AVATAR_KEYS[+old[2]-1];
  return null;
}
export function avatarArt(key) {
  key = normalizeAvatar(key); if (!key) return '';
  const [group,n] = key.split('-'), i = +n-1;
  return `<span class="avatar-art" style="background-image:url('${AVATAR_SHEETS[group]}');background-position:${(i%5)*25}% ${Math.floor(i/5)*100}%" aria-hidden="true"></span>`;
}
