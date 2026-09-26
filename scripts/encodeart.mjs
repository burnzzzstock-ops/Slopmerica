// Encode a key-art screenshot to WebP for the build (Chromium's encoder).
// usage: node scripts/encodeart.mjs <in.png> <out.webp> [width] [quality 0-1] [crop x,y,w,h]
// GRADE=sunX,sunY (0-1) adds the key-art grade: contrast, warm sun glow from
// that point, cool shadows and a vignette. GRADE=none skips it.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out, width = '1920', quality = '0.82', crop] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const dataUrl = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
const grade = process.env.GRADE ?? '0.8,0.15';
const webp = await page.evaluate(async ({ dataUrl, width, quality, crop, grade }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const [sx, sy, sw, sh] = crop ? crop.split(',').map(Number) : [0, 0, img.width, img.height];
  const w = Math.min(Number(width), sw), h = Math.round((sh * w) / sw);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  if (grade !== 'none') x.filter = 'contrast(1.12) saturate(1.2) brightness(1.03)';
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  x.filter = 'none';
  if (grade !== 'none') {
    const [gx, gy] = grade.split(',').map(Number);
    // warm late-afternoon light pouring in from the sun side
    const sun = x.createRadialGradient(gx * w, gy * h, 0, gx * w, gy * h, Math.max(w, h) * 0.9);
    sun.addColorStop(0, 'rgba(255, 196, 120, 0.42)');
    sun.addColorStop(0.45, 'rgba(255, 170, 100, 0.14)');
    sun.addColorStop(1, 'rgba(255, 160, 90, 0)');
    x.globalCompositeOperation = 'soft-light';
    x.fillStyle = sun;
    x.fillRect(0, 0, w, h);
    // cool the shadows a touch (teal/orange split)
    x.globalCompositeOperation = 'soft-light';
    const cool = x.createLinearGradient(0, h, w * 0.3, 0);
    cool.addColorStop(0, 'rgba(30, 70, 110, 0.35)');
    cool.addColorStop(1, 'rgba(30, 70, 110, 0)');
    x.fillStyle = cool;
    x.fillRect(0, 0, w, h);
    // vignette
    x.globalCompositeOperation = 'multiply';
    const vig = x.createRadialGradient(w * 0.55, h * 0.5, Math.min(w, h) * 0.35, w * 0.55, h * 0.5, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'rgba(255, 255, 255, 1)');
    vig.addColorStop(1, 'rgba(120, 110, 120, 1)');
    x.fillStyle = vig;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
  }
  return c.toDataURL('image/webp', Number(quality));
}, { dataUrl, width, quality, crop, grade });
const buf = Buffer.from(webp.split(',')[1], 'base64');
writeFileSync(out, buf);
console.log(out, `${Math.round(buf.length / 1024)} KB`);
await browser.close();
