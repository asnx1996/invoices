import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animatedMediaBlob, MAX_ANIM_BYTES } from '../assets/js/background-media.js';

function mp4(brand = 'isom') {
  const bytes = new Uint8Array(24);
  new DataView(bytes.buffer).setUint32(0, 24);
  bytes.set(new TextEncoder().encode('ftyp' + brand), 4);
  bytes.set(new TextEncoder().encode('isommp42'), 16);
  return bytes;
}
for (const type of ['', 'application/octet-stream', 'video/x-m4v', 'video/mp4']) {
  test(`MP4 accepted and normalized with browser type '${type}'`, async () => {
    const input = new File([mp4()], 'background.MP4', { type });
    const result = await animatedMediaBlob(input);
    assert.equal(result.type, 'video/mp4');
    assert.deepEqual(await result.arrayBuffer(), await input.arrayBuffer());
  });
}
test('renamed files and unsupported ISO containers rejected', async () => {
  await assert.rejects(animatedMediaBlob(new File(['not video'], 'fake.mp4', {type:'video/mp4'})));
  for(const brand of ['avif','qt  ']) await assert.rejects(animatedMediaBlob(new File([mp4(brand)], 'fake.mp4')));
});
test('empty and oversized uploads rejected before reading file', async () => {
  await assert.rejects(animatedMediaBlob(new File([], 'empty.mp4')), /فارغ/);
  await assert.rejects(animatedMediaBlob({size:MAX_ANIM_BYTES+1}), /5.5 MB/);
});
test('other supported formats retain canonical MIME', async () => {
  for(const [header,mime] of [['GIF89a','image/gif'],['RIFF0000WEBP','image/webp'],['\x1a\x45\xdf\xa3webm','video/webm']]) {
    const bytes=Uint8Array.from(header,c=>c.charCodeAt(0));
    assert.equal((await animatedMediaBlob(new Blob([bytes]))).type,mime);
  }
});
