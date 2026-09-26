// Anti-aliasing compared, in motion. Renders a small town (roads, lane
// markings, trees, parked/stopped cars) with each AA mode and compares it to
// a 3x supersampled reference: error (aliasing + blur), sharpness (edge energy
// relative to the reference; <1 is blurrier), and while panning by sub-pixel
// steps: the error at each step and how much it jumps between steps (shimmer)
// plus any lag behind the reference (trails). Bloom, tilt-shift and vignette
// are off. Usage: node scripts/aacompare.mjs [modes...]
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['none', 'msaa4', 'msaa8', 'taa'];
const W = 640, H = 360;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.resolution', 'full'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  document.querySelector('.hud').style.visibility = 'hidden';
  for (let k = -2; k <= 2; k++) d.road(S.x - 180, S.z - 100 + k * 60, S.x + 180, S.z - 100 + k * 60, k === 0 ? 'stroad4' : 'twoLane');
  d.road(S.x, S.z - 240, S.x, S.z + 40, 'stroad4');
  d.zone(S.x - 90, S.z - 100, 70, 'resLow'); d.zone(S.x + 90, S.z - 100, 70, 'comLow');
  d.run(25);
  g.sim.speed = 0;
  g.weather.force('clear', 30);
  const P = g.post; P.bloomOn = false; P.tiltShift = false; P.vignette = false;
  g.hour = 11;
  window.__aa = { S, yaw: 0.35, dist: 230, pitch: 0.95 };
  // one frame, captured into luminance at the page's size
  window.__cap = () => {
    const c = g.renderer.domElement, cv = document.createElement('canvas'); cv.width = innerWidth; cv.height = innerHeight;
    const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, cv.width, cv.height);
    const px = x.getImageData(0, 0, cv.width, cv.height).data, L = new Float32Array(cv.width * cv.height);
    for (let i = 0; i < L.length; i++) L[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
    return L;
  };
  window.__view = (shift) => {
    const a = window.__aa, g2 = window.__game, cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
    g2.rts.setView(a.S.x - 60 + cs * shift, a.S.z - 100 - sn * shift, a.dist, a.yaw, a.pitch, true);
  };
  window.__render = (mode, pr, frames) => {
    const g2 = window.__game;
    if (g2.renderer.getPixelRatio() !== pr) { g2.renderer.setPixelRatio(pr); g2.resize(); }
    g2.post.setAA(mode);
    for (let i = 0; i < frames; i++) g2.frame(0, true);
    return window.__cap();
  };
});
const stats = (A, R) => {
  let se = 0, ga = 0, gr = 0;
  const w = W, h = H;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, e = A[i] - R[i]; se += e * e;
    ga += Math.abs(A[i + 1] - A[i]) + Math.abs(A[i + w] - A[i]);
    gr += Math.abs(R[i + 1] - R[i]) + Math.abs(R[i + w] - R[i]);
  }
  return { rmse: Math.sqrt(se / ((w - 2) * (h - 2))), sharp: ga / gr };
};
const grab = async (fn, ...args) => page.evaluate(([fn, args]) => Array.from(window[fn](...args)), [fn, args]);
// references: static and at each pan step (3x supersampled, MSAA)
const px = await page.evaluate(() => { const a = window.__aa, g = window.__game; return (2 * a.dist * Math.tan((g.camera.fov * Math.PI) / 360)) / innerHeight; });
const steps = [0, 3, 6, 9, 12].map((k) => k * 0.37 * px);
const refs = [];
for (const sh of steps) { await page.evaluate((sh) => window.__view(sh), sh); refs.push(await grab('__render', 'msaa4', 3, 1)); }
const rows = [];
for (const mode of modes) {
  await page.evaluate((sh) => window.__view(sh), 0);
  const stat = stats(await grab('__render', mode, 1, mode === 'taa' ? 16 : 1), refs[0]);
  // pan: one frame per 0.37 px step, compared at steps 3, 6, 9, 12
  const errsAt = [];
  let k = 0;
  for (let i = 1; i <= 12; i++) {
    await page.evaluate((sh) => window.__view(sh), i * 0.37 * px);
    const f = await grab('__render', mode, 1, 1);
    if (i % 3 === 0) errsAt.push(stats(f, refs[++k]).rmse);
  }
  const mean = errsAt.reduce((a, b) => a + b, 0) / errsAt.length;
  const jump = Math.max(...errsAt) - Math.min(...errsAt);
  rows.push({ mode, still: +stat.rmse.toFixed(2), sharp: +stat.sharp.toFixed(3), moving: +mean.toFixed(2), shimmer: +jump.toFixed(2) });
}
console.log('mode    error still  sharpness  error moving  jump (shimmer)');
for (const r of rows) console.log(`${r.mode.padEnd(7)} ${String(r.still).padStart(11)} ${String(r.sharp).padStart(10)} ${String(r.moving).padStart(13)} ${String(r.shimmer).padStart(15)}`);
console.log('errors:', errs.slice(0, 3));
await browser.close();
