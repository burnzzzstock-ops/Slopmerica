// Shorelines on gentle banks (docs/GRAPHICS_HANDOFF.md, item 6): numbers from a running game.
//
//   edge    where the water shader believes the ground is, against where the ground is. The shader reads the height texture
//           with a uv; Terrain.h() reads the same samples with the map's own arithmetic. At the waterline itself (the
//           contour, bisected out along the normal of every bank of 1:60 to 1:1 found on the map) this emulates the shader's
//           sampler (bilinear over texel centres, in half float, as the GPU does) for the OLD uv (x / WORLD) and the NEW one
//           (i + 0.5 texels) and reports the depth read there (which should be 0) and the distance along the ground it puts
//           the visible edge off (depth / slope), mean, 95th percentile and worst. It emulates the sampler, it does not render.
//   fringe  along the waterline of the bank nearest the start (1:10, else 1:6, else 1:4; contour points every 2 m over 240 m),
//           the share that has a reed clump or a stone within 3 m, and the number drawn around the camera there; and, over
//           the whole map, that share by the slope of the bank (a sample of 700 waterline points). Nothing on code without
//           the shore module.
//
// usage: BASE_URL=http://127.0.0.1:5194 MAP=appalachia node scripts/shoretest.mjs   (COAST=1 for the beach)
// Exits nonzero on failure of the checks that apply to the new code (set SHORE_OLD=1 to only print, for the old snapshot).
import { chromium } from 'playwright-core';
import { ARGS, EXE } from './refblock.mjs';
import { bankTools } from './bankfind.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const MAP = process.env.MAP || 'appalachia';
const oldCode = !!process.env.SHORE_OLD;
const coast = !!process.env.COAST; // the bank is the beach (the map's sand function above 0.4) instead of the nearest bank
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok && !oldCode) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=${MAP}&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
const res = await page.evaluate(({ coast, src }) => {
  const g = window.__game, T = g.terrain;
  cancelAnimationFrame(g.raf);
  const HALF = 3072, N = 1537, WORLD = 6144;
  const data = T.heightTex.image.data;
  const half = (u) => { const s = u & 0x8000 ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff; return e === 0 ? s * 2 ** -14 * (f / 1024) : s * 2 ** (e - 15) * (1 + f / 1024); };
  const texel = (i, j) => half(data[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))]);
  // the GPU's bilinear read at texture coordinate (cx, cz) in texel units (centres at k + 0.5)
  const read = (cx, cz) => {
    const fx = cx - 0.5, fz = cz - 0.5, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (texel(i, j) * (1 - tx) + texel(i + 1, j) * tx) * (1 - tz) + (texel(i, j + 1) * (1 - tx) + texel(i + 1, j + 1) * tx) * tz;
  };
  const oldRead = (x, z) => read(((x + HALF) / WORLD) * N, ((z + HALF) / WORLD) * N);
  const newRead = (x, z) => read((x + HALF) / 4 + 0.5, (z + HALF) / 4 + 0.5);
  const S = g.startView();
  const tools = new Function(`return ${src}`)()(T);
  // every waterline point of the map whose bank is 1:60 to 1:1 there (Appalachia has only two banks gentler than 1:8)
  const pts = tools.points({ minSlope: 1 / 60, maxSlope: 1 });
  const stat = (arr) => { const a = arr.slice().sort((p, q) => p - q); return { mean: a.reduce((s, v) => s + v, 0) / Math.max(1, a.length), p95: a[Math.floor(a.length * 0.95)] ?? 0, max: a[a.length - 1] ?? 0 }; };
  // the depth the shader reads at the waterline itself, which should be 0, and how far along the ground that puts the visible edge
  // from where it is (depth / slope)
  const dOld = [], dNew = [], sOld = [], sNew = [];
  for (const c of pts) {
    const eo = Math.abs(oldRead(c.x, c.z)), en = Math.abs(newRead(c.x, c.z));
    dOld.push(eo); dNew.push(en); sOld.push(eo / c.sl); sNew.push(en / c.sl);
  }
  // the bank nearest the start (1:10 or gentler, else 1:6, else 1:4) with 60 m of the same kind of bank
  let best = null;
  for (const maxSlope of [1 / 10, 1 / 6, 1 / 4]) { best = tools.find(S, { coast, maxSlope }); if (best) { best.maxSlope = maxSlope; break; } }
  const shore = g.trees.shore;
  let fringe = null;
  if (best) {
    const tx = -best.nz, tz = best.nx;
    let n = 0, hit = 0, rocksN = 0, reedsN = 0;
    for (let k = -60; k <= 60; k++) {
      const px = best.x + tx * k * 2, pz = best.z + tz * k * 2;
      // the contour along the normal: bisect where the ground crosses the water level
      let a = -16, b = 16, ha = T.h(px + best.nx * a, pz + best.nz * a), hb = T.h(px + best.nx * b, pz + best.nz * b);
      if ((ha < 0) === (hb < 0)) continue;
      for (let it = 0; it < 30; it++) { const m = (a + b) / 2, hm = T.h(px + best.nx * m, pz + best.nz * m); if ((hm < 0) === (ha < 0)) { a = m; ha = hm; } else b = m; }
      const cx = px + best.nx * a, cz = pz + best.nz * a;
      n++;
      if (shore) {
        const c = shore.countNear(cx, cz, 3);
        if (c.reeds + c.rocks > 0) hit++;
        rocksN += c.rocks; reedsN += c.reeds;
      }
    }
    // draw the bank as the game does, from 30 m
    let drawn = null;
    if (shore) {
      g.startView();
      window.__dbg.view(best.x, best.z, 30, 0.6, 0.2);
      for (let i = 0; i < 6; i++) g.frame(0.016);
      drawn = shore.drawn;
    }
    fringe = { bank: { x: +best.x.toFixed(1), z: +best.z.toFixed(1), slope: +best.sl.toFixed(3), fromStart: +best.d.toFixed(0) }, samples: n, withinThree: hit, shareOfWaterline: n ? hit / n : 0, reedsNear: reedsN, rocksNear: rocksN, drawn };
  }
  // the whole map: a sample of about 700 waterline points, by the slope of the bank there, and the share with a reed clump or
  // stone within 3 m
  let classes = null;
  if (shore) {
    const all = tools.points({ minSlope: 1 / 50, maxSlope: 100 });
    const stride = Math.max(1, Math.floor(all.length / 700));
    const names = ['gentle (1:50 to 1:8)', 'moderate (1:8 to 1:3)', 'steep (over 1:3)'];
    const cl = names.map(() => ({ n: 0, hit: 0 }));
    for (let i = 0; i < all.length; i += stride) {
      const c = all[i], k = c.sl <= 1 / 8 ? 0 : c.sl <= 1 / 3 ? 1 : 2;
      const r = shore.countNear(c.x, c.z, 3);
      cl[k].n++;
      if (r.reeds + r.rocks > 0) cl[k].hit++;
    }
    classes = names.map((name, k) => ({ name, n: cl[k].n, share: cl[k].n ? cl[k].hit / cl[k].n : 0 }));
  }
  return { pts: pts.length, depthOld: stat(dOld), depthNew: stat(dNew), shiftOld: stat(sOld), shiftNew: stat(sNew), fringe, classes, hasShore: !!shore };
}, { coast, src: bankTools.toString() });
console.log(JSON.stringify(res, null, 1));
check(`the bank sample is not empty (${res.pts} waterline points, banks of 1:60 to 1:1)`, res.pts > 20);
check(`the water shader's depth read: mean error ${res.depthOld.mean.toFixed(3)} m with the old uv, ${res.depthNew.mean.toFixed(4)} m with the new; the waterline it puts at ${res.shiftOld.mean.toFixed(2)} m (95th percentile ${res.shiftOld.p95.toFixed(2)}) off vs ${res.shiftNew.mean.toFixed(3)} m (${res.shiftNew.p95.toFixed(3)})`, res.shiftNew.p95 < 0.05, res.shiftNew);
if (res.hasShore && res.fringe) {
  const f = res.fringe;
  check(`${(f.shareOfWaterline * 100).toFixed(0)}% of the waterline (${f.withinThree} of ${f.samples} points, bank ${f.bank.slope} slope, ${f.bank.fromStart} m from the start) has a reed clump or stone within 3 m (${f.reedsNear} reeds, ${f.rocksNear} stones near it); drawn from the bank: ${JSON.stringify(f.drawn)}`, f.shareOfWaterline >= 0.4, f);
}
if (res.classes) console.log('waterline fringed with a reed clump or stone within 3 m, whole map, by bank slope: ' + res.classes.map((c) => `${c.name}: ${(c.share * 100).toFixed(0)}% of ${c.n}`).join('; '));
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
