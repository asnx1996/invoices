export const MAX_ANIM_BYTES = 5.5 * 1024 * 1024;
export const ANIM_ACCEPT = '.gif,.webp,.mp4,.webm,image/gif,image/webp,video/mp4,video/webm';

// Windows/browser MIME labels are not reliable; inspect the container signature.
export async function animatedMediaBlob(file) {
  if (!file.size) throw new Error('الملف فارغ، اختار ملف ثاني');
  if (file.size > MAX_ANIM_BYTES) throw new Error(`حجم الملف ${(file.size / 1024 / 1024).toFixed(1)} MB؛ الحد المسموح 5.5 MB. قلّل حجم الفيديو وحاول مرة ثانية.`);
  const bytes = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const ascii = (a, b) => String.fromCharCode(...bytes.slice(a, b));
  let mime;
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) mime = 'image/gif';
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') mime = 'image/webp';
  else if (ascii(4, 8) === 'ftyp') {
    const brands = [];
    const boxSize = new DataView(bytes.buffer).getUint32(0);
    for (let i = 8; i + 4 <= Math.min(boxSize, bytes.length); i += 4) {
      if (i !== 12) brands.push(ascii(i, i + 4));
    }
    if (brands.some(b => /^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(b)) && !brands.some(b => /^(avif|avis|heic|heix|mif1|qt  )$/.test(b))) mime = 'video/mp4';
  } else if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && ascii(0, bytes.length).includes('webm')) mime = 'video/webm';
  if (!mime) throw new Error('نوع الملف غير مدعوم. اختار GIF أو WebP أو MP4 أو WebM؛ تغيير اسم الملف وحده ما يحوّله.');
  return new Blob([file], { type: mime });
}
