// Ground noise at distance (docs/GRAPHICS_HANDOFF.md, item 2). The fine ground texture should be there under your
// feet and gone from far away, where it only competes with the buildings. This renders the reference block with
// EVERYTHING but the terrain hidden, from four fixed cameras, and measures the ground's high-frequency contrast:
// hp    the standard deviation of (luma minus its 7x7 box average) over the ground pixels whose 7x7 neighbourhood is all
//       ground (includes every paint edge: roads, lot footprints, so it mostly measures structure)
// grain the same, over only the flat ground: pixels whose 15x15 neighbourhood spans less than 24 luma levels (no paint
//       edge in it). This is the speckle and clumps of the ground texture itself, the thing that competes with buildings.
// The same script runs against the old code and the new (same JSON to compare):
//
//   near      34 m   the camera that frames a house lot
//   street   110 m
//   overview 320 m
//   wide     900 m   (the fine ground texture is fully gone here in old and new: its grain is the renderer's floor)
//
// Every frame carries a floor of grain that is not the ground (dither, post grain: about 1.6 levels, the same at every
// distance, and what the wide view measures). So the figure compared is the EXCESS grain, sqrt(grain^2 - wide^2): what the
// ground texture adds above that floor. Targets, new against old: near at least 88% of it (close up is kept), street at
// most 75%, overview at most 50%; the wide view's own grain within 3% and the mean ground tone within 3 levels.
//
// GN_IMAGES=<dir> measures the four saved PNGs of a GN_SHOTS run instead of rendering (no game is loaded), so a new
// metric can be applied to old captures.
//
// The mean ground luma is printed too (a fade must not change the ground's tone: within 3 levels).
//
// usage: BASE_URL=http://127.0.0.1:5178 GN_OUT=shots/gfx/gn-old.json node scripts/groundnoise.mjs [quality]
//        GN_IMAGES=shots/gfx/gn-old GN_OUT=shots/gfx/gn-old.json node scripts/groundnoise.mjs
//        BASE_URL=http://127.0.0.1:5179 GN_BASE=shots/gfx/gn-old.json node scripts/groundnoise.mjs [quality]
// Exits nonzero on failure (with GN_BASE).
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'high';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const NAMES = ['near', 'street', 'overview', 'wide'];

// runs in the page: hp and grain (see the header) and the mean luma of the ground pixels
async function measure(b64) {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const W = img.width, H = img.height, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data, L = new Float32Array(W * H), ok = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; ok[i] = L[i] > 4 ? 1 : 0; }
  // range of luma in the 15x15 window (separable running max and min)
  const R2 = 7, hi = new Float32Array(W * H), lo = new Float32Array(W * H), hi2 = new Float32Array(W * H), lo2 = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = -1e9, b = 1e9;
    for (let u = Math.max(0, x - R2); u <= Math.min(W - 1, x + R2); u++) { const v = L[y * W + u]; if (v > a) a = v; if (v < b) b = v; }
    hi[y * W + x] = a; lo[y * W + x] = b;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = -1e9, b = 1e9;
    for (let v = Math.max(0, y - R2); v <= Math.min(H - 1, y + R2); v++) { const i = v * W + x; if (hi[i] > a) a = hi[i]; if (lo[i] < b) b = lo[i]; }
    hi2[y * W + x] = a; lo2[y * W + x] = b;
  }
  const R = 3;
  let s = 0, s2 = 0, n = 0, ms = 0, g = 0, g2 = 0, gn = 0;
  for (let y = R2; y < H - R2; y++) for (let x = R2; x < W - R2; x++) {
    let all = 1, m = 0;
    for (let v = -R; v <= R && all; v++) for (let u = -R; u <= R; u++) { const j = (y + v) * W + x + u; if (!ok[j]) { all = 0; break; } m += L[j]; }
    if (!all) continue;
    m /= (2 * R + 1) ** 2;
    const hp = L[y * W + x] - m;
    s += hp; s2 += hp * hp; n++; ms += m;
    if (hi2[y * W + x] - lo2[y * W + x] < 24) { g += hp; g2 += hp * hp; gn++; }
  }
  const sd = (a, a2, k) => (k ? Math.sqrt(Math.max(0, a2 / k - (a / k) ** 2)) : NaN);
  return { hp: sd(s, s2, n), grain: sd(g, g2, gn), mean: n ? ms / n : NaN, n, share: n / (W * H), flat: gn / Math.max(1, n) };
}

const out = {};
let errs = [];
let browser;
if (process.env.GN_IMAGES) {
  browser = await chromium.launch({ executablePath: EXE, args: ARGS });
  const page = await browser.newPage();
  for (const name of NAMES) {
    out[name] = await page.evaluate(new Function('b64', `return (${measure.toString()})(b64);`), readFileSync(`${process.env.GN_IMAGES}/${name}.png`).toString('base64'));
    console.log(name.padEnd(9), JSON.stringify(out[name]));
  }
} else {
  const CAMS = JSON.parse(readFileSync(process.env.CAMS || 'shots/gfx/cams.json', 'utf8'));
  const VIEWS = { near: CAMS.lotedge, street: CAMS.street, overview: CAMS.overview, wide: CAMS.wide };
  if (!VIEWS.near) throw new Error('shots/gfx/cams.json has no lotedge camera: run scripts/gfxshots.mjs lotedge once first');
  browser = await chromium.launch({ executablePath: EXE, args: ARGS });
  const opened = await openBlock(browser, { base, quality });
  const { page, center } = opened;
  errs = opened.errs;
  await page.waitForFunction(() => window.__game.civic.status !== 'loading', null, { timeout: 180000 });
  if (process.env.GN_SHOTS) mkdirSync(process.env.GN_SHOTS, { recursive: true });
  for (const [name, view] of Object.entries(VIEWS)) {
    await shoot(page, center, { hour: 12.5, moon: 0.5, weather: 'clear', view });
    // hide everything except the terrain and the lights, look at the ground alone
    await page.evaluate(() => {
      const g = window.__game, sc = g.scene, keep = new Set();
      g.terrain.group.traverse((o) => keep.add(o));
      for (let p = g.terrain.group.parent; p; p = p.parent) keep.add(p);
      window.__hid = [];
      sc.traverse((o) => { if (!keep.has(o) && !o.isLight && o.visible && (o.isMesh || o.isPoints || o.isLine || o.isSprite || o.isGroup)) { if (o.parent && !window.__hid.some(([q]) => q === o.parent)) { window.__hid.push([o, true]); o.visible = false; } } });
      window.__bg = sc.background; sc.background = null;
      g.frame(0.016); g.frame(0.016);
    });
    const buf = await page.screenshot({ timeout: 180000 });
    if (process.env.GN_SHOTS) writeFileSync(`${process.env.GN_SHOTS}/${name}.png`, buf);
    await page.evaluate(() => { for (const [o] of window.__hid) o.visible = true; window.__game.scene.background = window.__bg; });
    out[name] = await page.evaluate(new Function('b64', `return (${measure.toString()})(b64);`), buf.toString('base64'));
    console.log(name.padEnd(9), JSON.stringify(out[name]));
  }
}
if (process.env.GN_OUT) writeFileSync(process.env.GN_OUT, JSON.stringify(out));
if (process.env.GN_BASE) {
  const o = JSON.parse(readFileSync(process.env.GN_BASE, 'utf8'));
  const ex = (d, k) => Math.sqrt(Math.max(0, d[k].grain ** 2 - d.wide.grain ** 2));
  const r = (k) => ex(out, k) / Math.max(1e-6, ex(o, k));
  const line = (k) => `${k}: excess grain ${ex(o, k).toFixed(2)} -> ${ex(out, k).toFixed(2)} (${Math.round(r(k) * 100)}%; raw ${o[k].grain.toFixed(2)} -> ${out[k].grain.toFixed(2)})`;
  check(`${line('near')} (target: at least 88%, close up is kept)`, r('near') >= 0.88, { old: o.near, now: out.near });
  check(`${line('street')} (target: at most 75%)`, r('street') <= 0.75, { old: o.street, now: out.street });
  check(`${line('overview')} (target: at most 50%)`, r('overview') <= 0.5, { old: o.overview, now: out.overview });
  check(`wide: grain ${o.wide.grain.toFixed(2)} -> ${out.wide.grain.toFixed(2)} (target: within 3%)`, Math.abs(out.wide.grain / o.wide.grain - 1) <= 0.03, { old: o.wide, now: out.wide });
  for (const k of NAMES) check(`${k}: ground tone ${o[k].mean.toFixed(1)} -> ${out[k].mean.toFixed(1)} (target: within 3)`, Math.abs(out[k].mean - o[k].mean) <= 3, { old: o[k], now: out[k] });
}
if (!process.env.GN_IMAGES) check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
