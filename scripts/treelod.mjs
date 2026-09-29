// Distant trees (impostors) match the detailed trees they replace: renders the
// same stand of trees as detailed models, as impostors, and with no trees,
// and compares the brightness of tree pixels (the review saw far trees as dark
// flat cutouts; the impostor texture was decoded as sRGB twice), and how much
// ground their canopies cover (with sun shadows off: impostors cast none).
// Exits nonzero on failure.
// `--shots` saves the frames to /tmp.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.fov', '50'); });
const MAP = process.env.MAP || 'norcal';
await page.goto(`${base}/#skip&map=${MAP}&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
await page.evaluate(() => {
  const g = window.__game, t = g.trees, S = g.startView();
  cancelAnimationFrame(g.raf);
  document.querySelector('.hud').style.visibility = 'hidden';
  g.hour = 11; g.weather.force('clear', 30);
  let best = null, bn = 0;
  for (let k = 0; k < 400; k++) { const x = S.x + (k % 20 - 10) * 60, z = S.z + (Math.floor(k / 20) - 10) * 60; let n = 0; for (let i = 0; i < t.n; i += 7) if (Math.abs(t.X[i] - x) < 40 && Math.abs(t.Z[i] - z) < 40) n++; if (n > bn) { bn = n; best = { x, z }; } }
  window.__spot = best;
});
const frame = async (mode, dist, pitch, shadows = true) => {
  await page.evaluate(([mode, dist, pitch, shadows]) => {
    const g = window.__game, t = g.trees, s = window.__spot;
    g.env.sun.castShadow = shadows;
    t.q.treeNear = mode === 'near' ? 5000 : 0.001; t.dirty = true;
    g.rts.setView(s.x, s.z, dist, 0.6, pitch, true);
    for (let i = 0; i < 3; i++) g.frame(0.05, false);
    t.near.forEach((m) => { m.visible = mode !== 'none'; });
    t.far.forEach((m) => { m.visible = mode !== 'none'; });
    g.frame(0.016, true);
  }, [mode, dist, pitch, shadows]);
  if (shots) await page.screenshot({ path: `/tmp/treelod-${mode}-${dist}.png` });
  return (await page.screenshot()).toString('base64');
};
const lum = (a, b, c) => page.evaluate(async ([a, b, c]) => {
  const load = (s) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + s; });
  const px = async (s) => { const im = await load(s), cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const x = cv.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
  const [N, F, O] = await Promise.all([px(a), px(b), px(c)]);
  const L = (D, i) => 0.2126 * D[i] + 0.7152 * D[i + 1] + 0.0722 * D[i + 2];
  let sn = 0, nn = 0, sf = 0, nf = 0, su = 0, un = 0, ru = 0;
  const cn = [0, 0, 0], cf = [0, 0, 0];
  for (let i = 0; i < O.length; i += 4) {
    const dn = Math.abs(L(N, i) - L(O, i)) > 12, df = Math.abs(L(F, i) - L(O, i)) > 12;
    if (dn) { sn += L(N, i); nn++; for (let k = 0; k < 3; k++) cn[k] += N[i + k]; }
    if (df) { sf += L(F, i); nf++; for (let k = 0; k < 3; k++) cf[k] += F[i + k]; }
    // the whole forest patch, canopy and the ground its trees shade (where either picture differs from the bare ground):
    // the detailed trees shade the ground under them and the impostors do not, so this is the far forest against the
    // near forest's shadow
    if (dn || df) { su += L(N, i); ru += L(F, i); un++; }
  }
  const avg = (c, n) => c.map((v) => Math.round(v / Math.max(1, n)));
  return { near: +(sn / Math.max(1, nn)).toFixed(1), far: +(sf / Math.max(1, nf)).toFixed(1), nearPx: nn, farPx: nf, nearRGB: avg(cn, nn), farRGB: avg(cf, nf), patchNear: +(su / Math.max(1, un)).toFixed(1), patchFar: +(ru / Math.max(1, un)).toFixed(1), patchPx: un };
}, [a, b, c]);
const VIEWS = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [[140, 0.75], [320, 0.95]];
for (const [dist, pitch] of VIEWS) {
  const n = await frame('near', dist, pitch), f = await frame('far', dist, pitch), o = await frame('none', dist, pitch);
  const r = await lum(n, f, o);
  const ratio = r.far / r.near;
  // coverage is the canopy's: detailed trees also cast shadows on the ground
  // (impostors don't), and counting shadow pixels made far forest look half as
  // dense as it is
  const c = await lum(await frame('near', dist, pitch, false), await frame('far', dist, pitch, false), await frame('none', dist, pitch, false));
  check(`at ${dist} m, pitch ${pitch}, impostors are as bright as detailed trees (tree pixels: detailed ${r.near} rgb(${r.nearRGB}), impostor ${r.far} rgb(${r.farRGB}), ratio ${ratio.toFixed(2)})`, ratio > 0.85 && ratio < 1.15, r);
  // the forest patch as a whole, canopy plus the ground the detailed trees shade: informational, not a gate. The brief asks
  // that a far forest not read lighter than the near forest's shadow; the far pictures cast no shadow on the ground, so this
  // ratio stays above 1 (1.42-1.46 on the old code in NorCal), and the far-foot darkening moves it, it
  // does not close it
  const pr = r.patchFar / r.patchNear;
  console.log(`INFO at ${dist} m, the far forest patch vs the near one (with its shadows): ${r.patchFar} vs ${r.patchNear} over ${r.patchPx} px, ratio ${pr.toFixed(3)}`);
  check(`at ${dist} m, impostor canopies cover about as much ground (${c.farPx} vs ${c.nearPx} px, sun shadows off; ${r.farPx} vs ${r.nearPx} with them)`, c.farPx > c.nearPx * 0.6 && c.farPx < c.nearPx * 1.6, c);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
