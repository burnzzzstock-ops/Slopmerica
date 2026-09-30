// How warm the night lights read (owner, 2026-09-30: "make it cozy warm night lights": sodium,
// incandescent, amber). Shoots the lookbook's street, overview and houses cameras on the reference
// block on a moonless and a full-moon night and measures the light itself: the brightest 2% of each
// frame and every "lit" pixel (display luma >= 110), as mean R/B and as a correlated colour temperature
// (sRGB -> CIE xy -> McCamy's CCT; lower = warmer: sodium ~2000 K, incandescent ~2700 K, cool LED ~5000 K).
// And the light alone: the same frame drawn again with the practical lights off (pools, windows and
// signs, lamp heads; the cars' lights stay on in both), the difference summed in linear light ("added").
// usage: node scripts/nightwarmth.mjs [quality, default high]   OUT=dir saves JPEGs (<dir>/<night>-<view>.jpg)
//        MAX_CCT=3400 makes it a check: exits nonzero if the added light of any frame is cooler than that.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'high';
const VIEWS = { street: [-40, -30, 110, 2.4, 0.38], overview: [0, 0, 320, 0.7, 0.6], houses: [-170, -130, 120, 4.0, 0.42] };
const NIGHTS = [['moonless', 23, 0], ['fullmoon', 23, 0.5]];
const OUT = process.env.OUT;
if (OUT) mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, quality });
const measure = (b64) => page.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, img.width, img.height).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const LUT = Array.from({ length: 256 }, (_, i) => lin(i));
  const px = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2], 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]]);
  const cct = (set) => {
    // mean linear colour of the set -> XYZ -> xy -> McCamy
    let R = 0, G = 0, B = 0, rb = 0;
    for (const p of set) { R += LUT[p[0]]; G += LUT[p[1]]; B += LUT[p[2]]; rb += (p[0] + 1) / (p[2] + 1); }
    const n = Math.max(1, set.length); R /= n; G /= n; B /= n;
    const X = 0.4124 * R + 0.3576 * G + 0.1805 * B, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
    const x = X / (X + Y + Z), y = Y / (X + Y + Z), m = (x - 0.332) / (0.1858 - y);
    return { n: set.length, rb: +(rb / n).toFixed(2), x: +x.toFixed(3), y: +y.toFixed(3), cct: Math.round(449 * m ** 3 + 3525 * m ** 2 + 6823.3 * m + 5520.33) };
  };
  const sorted = [...px].sort((a, b) => b[3] - a[3]);
  return { top2: cct(sorted.slice(0, Math.max(1, Math.floor(px.length * 0.02)))), lit: cct(px.filter((p) => p[3] >= 110)), meanLuma: +(px.reduce((s, p) => s + p[3], 0) / px.length).toFixed(1), jpeg: cv.toDataURL('image/jpeg', 0.85).split(',')[1] };
}, b64);
// the colour of what the practical lights add: this frame minus the same frame with them switched off
const added = () => page.evaluate(async () => {
  const g = window.__game, R = g.renderer, gl = R.getContext();
  const { LAMPS } = await import('/src/world/nightLights.ts');
  const { buildingMaterial } = await import('/src/buildings/material.ts');
  const { setKitNight } = await import('/src/buildings/kitGenerator.ts');
  const grab = () => { g.post.render(g.env.night); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const on = grab();
  const bm = buildingMaterial(), lamp = g.roads.lampMat, keep = [LAMPS.uLampOn.value, bm.emissiveIntensity, lamp.emissiveIntensity];
  LAMPS.uLampOn.value = 0; bm.emissiveIntensity = 0; lamp.emissiveIntensity = 0; setKitNight(0);
  const off = grab();
  [LAMPS.uLampOn.value, bm.emissiveIntensity, lamp.emissiveIntensity] = keep;
  g.frame(0.016); // (sets the kit night and everything else back)
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const LUT = Array.from({ length: 256 }, (_, i) => lin(i));
  let Rs = 0, Gs = 0, Bs = 0, n = 0;
  for (let i = 0; i < on.length; i += 4) {
    const r = Math.max(0, LUT[on[i]] - LUT[off[i]]), gg = Math.max(0, LUT[on[i + 1]] - LUT[off[i + 1]]), b = Math.max(0, LUT[on[i + 2]] - LUT[off[i + 2]]);
    if (0.2126 * r + 0.7152 * gg + 0.0722 * b < 0.004) continue;
    Rs += r; Gs += gg; Bs += b; n++;
  }
  const X = 0.4124 * Rs + 0.3576 * Gs + 0.1805 * Bs, Y = 0.2126 * Rs + 0.7152 * Gs + 0.0722 * Bs, Z = 0.0193 * Rs + 0.1192 * Gs + 0.9505 * Bs;
  const x = X / (X + Y + Z), y = Y / (X + Y + Z), m = (x - 0.332) / (0.1858 - y);
  return { px: n, share: +(n / (on.length / 4) * 100).toFixed(1), rb: +(Rs / Math.max(1e-6, Bs)).toFixed(2), x: +x.toFixed(3), y: +y.toFixed(3), cct: Math.round(449 * m ** 3 + 3525 * m ** 2 + 6823.3 * m + 5520.33) };
});
const rows = [];
for (const [night, hour, moon] of NIGHTS) for (const [view, v] of Object.entries(VIEWS)) {
  await shoot(page, center, { hour, moon, weather: 'clear', view: v });
  const add = await added();
  const png = await page.screenshot({ timeout: 300000 });
  const { jpeg, ...m } = await measure(png.toString('base64'));
  if (OUT) writeFileSync(`${OUT}/${night}-${view}.jpg`, Buffer.from(jpeg, 'base64'));
  rows.push({ night, view, ...m, add });
  console.log(night.padEnd(9), view.padEnd(9), `added light (${add.share}% of px): ${add.cct} K R/B ${add.rb} | top 2%: ${m.top2.cct} K R/B ${m.top2.rb} | lit (${m.lit.n} px): ${m.lit.cct} K R/B ${m.lit.rb} | mean luma ${m.meanLuma}`);
}
const avg = (k, f) => Math.round(rows.reduce((s, r) => s + r[k][f], 0) / rows.length * 100) / 100;
console.log(`MEAN added light: ${Math.round(avg('add', 'cct'))} K, R/B ${avg('add', 'rb')} | top 2%: ${Math.round(avg('top2', 'cct'))} K, R/B ${avg('top2', 'rb')} | lit: ${Math.round(avg('lit', 'cct'))} K, R/B ${avg('lit', 'rb')}`);
let bad = 0;
if (process.env.MAX_CCT) for (const r of rows) if (r.add.cct > +process.env.MAX_CCT) { console.log('FAIL', r.night, r.view, `the practical light adds ${r.add.cct} K (want <= ${process.env.MAX_CCT})`); bad++; }
if (errs.length) { console.log('page errors:', errs.slice(0, 3)); bad++; }
await browser.close();
process.exit(bad ? 1 : 0);
