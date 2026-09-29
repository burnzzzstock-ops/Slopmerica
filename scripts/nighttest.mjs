// Night exposure targets (docs/ART_DIRECTION.md; playtest 5: "The observed
// night view was too dark to evaluate assets... Establish exposure targets
// that retain facade separation, road readability, and landmark
// recognition. Add practical lighting"). On the reference block at High, a
// class mask (buildings, road surfaces, everything else) splits each capture,
// and display luma (0..255) is measured per class:
//   road median >= 50 on every night; roads under lamps (p90) >= 100;
//   facades (p90) at least 20 above the ground's median; blown-out < 1%;
//   the day capture is unchanged by the night lighting (pools off by day).
// usage: node scripts/nighttest.mjs [quality]   (OUT=dir saves the captures; ONLY=moonless,rain runs just those nights)
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'high';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, quality });
const VIEW = [-40, -30, 150, 2.4, 0.45];
const ALL_CONDS = [['day', 14, 0.5, 'clear'], ['moonless', 23, 0, 'clear'], ['full moon', 23, 0.5, 'clear'], ['rain', 23, 0.25, 'rain']];
// ONLY=moonless,rain  runs just those nights (the day capture always runs): a quick look at one change; the full run is the test
const CONDS = process.env.ONLY ? ALL_CONDS.filter(([n]) => n === 'day' || process.env.ONLY.split(',').includes(n)) : ALL_CONDS;

// buildings red, road surfaces green, everything else writes depth only; read back top-down
const maskPass = () => page.evaluate(() => {
  const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera, MBM = g.tools.grade.mesh.material.constructor;
  const bm = new MBM({ color: 0xff0000, toneMapped: false, fog: false });
  const rm = new MBM({ color: 0x00ff00, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const bset = new Set([g.buildings.mesh, g.buildings.kitMesh].filter(Boolean));
  const rset = new Set([...g.roads.typeMeshes.values(), g.roads.junctionMesh]);
  // (materials are shared by many meshes: remember each one's setting once)
  const saved = [], cw = new Map();
  sc.traverse((o) => {
    if (!o.material) return;
    if (bset.has(o)) { saved.push([o, o.material]); o.material = bm; return; }
    if (rset.has(o)) { saved.push([o, o.material]); o.material = rm; return; }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!cw.has(m)) cw.set(m, m.colorWrite); m.colorWrite = false; }
  });
  const bg = sc.background; sc.background = null;
  const cc = R.getClearColor(new bm.color.constructor()), ca = R.getClearAlpha();
  R.setRenderTarget(null); R.setClearColor(0x000000, 1); R.clear();
  R.render(sc, cam);
  const gl = R.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (const [o, m] of saved) o.material = m;
  for (const [m, v] of cw) m.colorWrite = v;
  sc.background = bg;
  R.setClearColor(cc, ca);
  bm.dispose(); rm.dispose();
  const cls = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4; cls[y * w + x] = px[i] > 128 ? 1 : px[i + 1] > 128 ? 2 : 0; }
  window.__cls = { cls, w, h };
  for (let i = 0; i < 3; i++) g.frame(0.016);
});

const stats = (b64) => page.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, img.width, img.height).data;
  const { cls, w, h } = window.__cls;
  const L = [[], [], []];
  for (let y = 0; y < img.height; y += 2) for (let x = 0; x < img.width; x += 2) {
    const i = (y * img.width + x) * 4;
    L[cls[Math.floor((y * h) / img.height) * w + Math.floor((x * w) / img.width)]].push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
  }
  const q = (a, p) => { if (!a.length) return 0; a.sort((x, y) => x - y); return Math.round(a[Math.floor(p * (a.length - 1))]); };
  const all = [...L[0], ...L[1], ...L[2]];
  return { ground: [q(L[0], 0.1), q(L[0], 0.5), q(L[0], 0.9)], bldg: [q(L[1], 0.1), q(L[1], 0.5), q(L[1], 0.9)], road: [q(L[2], 0.1), q(L[2], 0.5), q(L[2], 0.9)], n: [L[0].length, L[1].length, L[2].length], hot: (all.filter((v) => v > 245).length / all.length) * 100 };
}, b64);

const out = {};
if (process.env.OUT) mkdirSync(process.env.OUT, { recursive: true });
for (const [name, hour, moon, weather] of CONDS) {
  await shoot(page, center, { hour, moon, weather, view: VIEW });
  await maskPass();
  const buf = await page.screenshot({ timeout: 180000 });
  if (process.env.OUT) writeFileSync(`${process.env.OUT}/night-${quality}-${name.replace(/\s/g, '')}.png`, buf);
  out[name] = await stats(buf.toString('base64'));
  if (name === 'day') out.day.lampOn = await page.evaluate(async () => (await import('/src/world/nightLights.ts')).LAMPS.uLampOn.value);
  console.log(name.padEnd(10), JSON.stringify(out[name]));
}
const nights = CONDS.slice(1).map(([n]) => n);
const lamps = await page.evaluate(() => ({ pools: window.__game.nightLights?.pools ?? 0, lamps: window.__game.roads.lampSpots?.length ?? 0 }));
check(`the town has practical light (${lamps.pools} pools from ${lamps.lamps} street lamps and the lots)`, lamps.pools > lamps.lamps && lamps.lamps > 20, lamps);
check(`roads read on every night: median ${nights.map((n) => out[n].road[1]).join(' / ')} (target >= 50)`, nights.every((n) => out[n].road[1] >= 50), nights.map((n) => [n, out[n].road]));
check(`roads under lamps read as pools: p90 ${nights.map((n) => out[n].road[2]).join(' / ')} (target >= 100)`, nights.every((n) => out[n].road[2] >= 100), nights.map((n) => [n, out[n].road]));
check(`facades separate from the ground: p90 ${nights.map((n) => `${out[n].bldg[2]} vs ${out[n].ground[1]}`).join(' / ')} (target 20 apart)`, nights.every((n) => out[n].bldg[2] - out[n].ground[1] >= 20), nights.map((n) => [n, out[n].bldg, out[n].ground]));
check(`nothing blows out: ${nights.map((n) => out[n].hot.toFixed(2)).join(' / ')}% over 245 (target < 1%)`, nights.every((n) => out[n].hot < 1), nights.map((n) => [n, out[n].hot]));
check(`by day the pools are off and the streets are daylit (road median ${out.day.road[1]})`, out.day.lampOn === 0 && out.day.road[1] > 90, out.day);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
