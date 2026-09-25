// Encode a key-art screenshot to WebP for the build (Chromium's encoder).
// usage: node scripts/encodeart.mjs <in.png> <out.webp> [width] [quality 0-1] [crop x,y,w,h]
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out, width = '1920', quality = '0.82', crop] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const dataUrl = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
const webp = await page.evaluate(async ({ dataUrl, width, quality, crop }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const [sx, sy, sw, sh] = crop ? crop.split(',').map(Number) : [0, 0, img.width, img.height];
  const w = Math.min(Number(width), sw), h = Math.round((sh * w) / sw);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return c.toDataURL('image/webp', Number(quality));
}, { dataUrl, width, quality, crop });
const buf = Buffer.from(webp.split(',')[1], 'base64');
writeFileSync(out, buf);
console.log(out, `${Math.round(buf.length / 1024)} KB`);
await browser.close();
