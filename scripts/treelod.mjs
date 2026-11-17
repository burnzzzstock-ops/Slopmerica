// Distant trees (impostors) match the detailed trees they replace: renders the
// same stand of trees as detailed models, as impostors, and with no trees,
// and compares the brightness of tree pixels (the review saw far trees as dark
// flat cutouts; the impostor texture was decoded as sRGB twice), and how much
// ground their canopies cover (with sun shadows off: impostors cast none).
// Exits nonzero on failure.
// `--shots` saves the frames to /tmp.
import { launch } from './lib/browser.mjs';
import { seededInit, seededRandom, testSeed } from './refblock.mjs';
import { installTreeMask } from './look/tree-mask.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots');
const maskOut = process.env.MASK_OUT;
const maskBase = process.env.MASK_BASE;
const results = [];
const hash = value => createHash('sha256').update(value).digest('hex');
if (maskOut) mkdirSync(maskOut, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
await page.addInitScript(seededInit, { seed: testSeed(), rng: seededRandom.toString() });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('slopmerica.quality', 'high');
  localStorage.setItem('slopmerica.onboarded', '1');
  localStorage.setItem('slopmerica.fov', '50');
  window.__treeTime = 10000;
  performance.now = () => window.__treeTime;
});
const MAP = process.env.MAP || 'norcal';
await page.goto(`${base}/#skip&map=${MAP}&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
await page.evaluate(() => {
  const g = window.__game, t = g.trees, S = g.startView();
  cancelAnimationFrame(g.raf);
  g.sim.speed = 0;
  g.time = 20;
  g.weather.cloudOff.set(.31, .73);
  document.querySelector('.hud').style.visibility = 'hidden';
  g.hour = 11; g.env.hour = 11; g.weather.force('clear', 30);
  g.weather.settle();
  let best = null, bn = 0;
  for (let k = 0; k < 400; k++) { const x = S.x + (k % 20 - 10) * 60, z = S.z + (Math.floor(k / 20) - 10) * 60; let n = 0; for (let i = 0; i < t.n; i += 7) if (Math.abs(t.X[i] - x) < 40 && Math.abs(t.Z[i] - z) < 40) n++; if (n > bn) { bn = n; best = { x, z }; } }
  window.__spot = best;
});
// A diagnostic control for terrain-only shading changes. The normal test keeps
// the live understory. Geometry masks exclude ground shadows.
if (process.env.GROUND_CONTROL === '1') await page.evaluate(() => {
  const floor = window.__game.terrain.forestFloor;
  if (floor) { floor.texture.image.data.fill(0); floor.texture.needsUpdate = true; }
});
await installTreeMask(page);
const frame = async (mode, dist, pitch, shadows = true) => {
  const metadata = await page.evaluate(([mode, dist, pitch, shadows]) => {
    const g = window.__game, t = g.trees, s = window.__spot;
    g.time = 20;
    g.env.sun.castShadow = shadows;
    t.q.treeNear = mode === 'near' ? 5000 : 0.001; t.dirty = true;
    g.rts.setView(s.x, s.z, dist, 0.6, pitch, true);
    for (let i = 0; i < 3; i++) g.frame(0, false);
    t.near.forEach((m) => { m.visible = mode !== 'none'; });
    t.far.forEach((m) => { m.visible = mode !== 'none'; });
    window.__treeTime += 1000;
    g.frame(0, true);
    const hash = arrays => {
      let value = 2166136261;
      for (const array of arrays) for (const byte of new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) value = Math.imul(value ^ byte, 16777619) >>> 0;
      return value.toString(16);
    };
    const sprite = t.far[0].material.map;
    return {spot:s, camera:g.camera.matrixWorld.toArray(), projection:g.camera.projectionMatrix.toArray(),
      time:g.time, hour:g.hour, day:g.sim.day, weather:g.weather.kind, wind:g.weather.cur.wind,
      trees:hash([t.X,t.Y,t.Z,t.S,t.Rt,t.K,t.Vr,t.Asp,t.A]),
      matrices:hash([...t.near,...t.far].map(mesh=>mesh.instanceMatrix.array)),
      alpha:hash(sprite.mipmaps.map(mip=>new Uint8Array(mip.data.filter((_,i)=>i%4===3))))};
  }, [mode, dist, pitch, shadows]);
  if (shots) await page.screenshot({ path: `/tmp/treelod-${mode}-${dist}.png` });
  const color = await page.screenshot();
  const actualMask = Buffer.from(await page.evaluate(() => window.__treeMask()), 'base64');
  const filename = `${mode}-${dist}-${shadows ? 'sun' : 'unlit'}`;
  const fixedMask = maskBase ? readFileSync(`${maskBase}/${filename}-mask.png`) : actualMask;
  const mask = fixedMask.toString('base64');
  if (maskBase) check(`unchanged ${filename} geometry mask`, hash(actualMask) === hash(fixedMask));
  if (maskOut) {
    const name = `${maskOut}/${mode}-${dist}-${shadows ? 'sun' : 'unlit'}`;
    writeFileSync(name + '.png', color);
    writeFileSync(name + '-mask.png', actualMask);
  }
  return { color: color.toString('base64'), mask, metadata };
};
const lum = (a, b, c) => page.evaluate(async ([a, b, c]) => {
  const load = (s) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + s; });
  const px = async (s) => { const im = await load(s), cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const x = cv.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
  const [N, F, O, NM, FM] = await Promise.all([px(a.color), px(b.color), px(c.color), px(a.mask), px(b.mask)]);
  const L = (D, i) => 0.2126 * D[i] + 0.7152 * D[i + 1] + 0.0722 * D[i + 2];
  let sn = 0, nn = 0, sf = 0, nf = 0, su = 0, un = 0, ru = 0;
  const cn = [0, 0, 0], cf = [0, 0, 0];
  for (let i = 0; i < O.length; i += 4) {
    const dn = NM[i] > 127, df = FM[i] > 127;
    if (dn) { sn += L(N, i); nn++; for (let k = 0; k < 3; k++) cn[k] += N[i + k]; }
    if (df) { sf += L(F, i); nf++; for (let k = 0; k < 3; k++) cf[k] += F[i + k]; }
    // The union of the two actual canopy masks includes gaps one model covers
    // and the other does not. Shadows outside those crowns stay excluded.
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
  // Informational union-of-canopies comparison; the brightness gate above
  // averages each model's own geometry mask, without ground-shadow inference.
  const pr = r.patchFar / r.patchNear;
  results.push({dist, pitch, ...r, ratio, coverage: c, nearState:n.metadata, farState:f.metadata});
  console.log(`INFO at ${dist} m, the far forest patch vs the near one (with its shadows): ${r.patchFar} vs ${r.patchNear} over ${r.patchPx} px, ratio ${pr.toFixed(3)}`);
  check(`at ${dist} m, impostor canopies cover about as much ground (${c.farPx} vs ${c.nearPx} px, sun shadows off; ${r.farPx} vs ${r.nearPx} with them)`, c.farPx > c.nearPx * 0.6 && c.farPx < c.nearPx * 1.6, c);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
if (maskOut) writeFileSync(`${maskOut}/result.json`, JSON.stringify({base, map:MAP, seed:Number(process.env.SEED || 1), maskBase, results, errors:errs}, null, 2));
await browser.close();
process.exit(bad ? 1 : 0);
