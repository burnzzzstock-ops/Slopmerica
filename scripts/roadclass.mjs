// Where the road-class pixels of nighttest come from. nighttest calls "road surfaces" every pixel of the road type
// meshes and the junction mesh, and takes the median of their display luma; the median of a class that mixes pale
// sidewalk and dark asphalt is sensitive to how many pixels of each there are. This renders each of those meshes on its
// own as a mask over the same frame and prints its pixel count and luma percentiles, at the nighttest camera, so two
// builds can be compared mesh by mesh.
//
// usage: BASE_URL=http://127.0.0.1:5175 node scripts/roadclass.mjs [quality]   (ONLY=moonless,rain adds nights; day always runs)
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'high';
const VIEW = [-40, -30, 150, 2.4, 0.45];
const ALL = [['day', 14, 0.5, 'clear'], ['moonless', 23, 0, 'clear'], ['rain', 23, 0.25, 'rain']];
const CONDS = ALL.filter(([n]) => n === 'day' || (process.env.ONLY || '').split(',').includes(n));

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, quality });
for (const [name, hour, moon, weather] of CONDS) {
  await shoot(page, center, { hour, moon, weather, view: VIEW });
  const buf = await page.screenshot({ timeout: 180000 });
  const res = await page.evaluate(async (b64) => {
    const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera, MBM = g.tools.grade.mesh.material.constructor;
    const meshes = [...g.roads.typeMeshes.entries()].map(([id, m]) => [id, m]);
    meshes.push(['junction', g.roads.junctionMesh]);
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data;
    const out = {};
    for (const [id, target] of meshes) {
      if (!target.geometry.getAttribute('position')?.count) continue;
      const rm = new MBM({ color: 0x00ff00, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const saved = [], cw = new Map();
      sc.traverse((o) => {
        if (!o.material) return;
        if (o === target) { saved.push([o, o.material]); o.material = rm; return; }
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!cw.has(m)) cw.set(m, m.colorWrite); m.colorWrite = false; }
      });
      const bg = sc.background; sc.background = null;
      const cc = R.getClearColor(new rm.color.constructor()), ca = R.getClearAlpha();
      R.setRenderTarget(null); R.setClearColor(0x000000, 1); R.clear();
      R.render(sc, cam);
      const gl = R.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (const [o, m] of saved) o.material = m;
      for (const [m, v] of cw) m.colorWrite = v;
      sc.background = bg; R.setClearColor(cc, ca); rm.dispose();
      const L = [];
      for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) {
        const mx = Math.floor((x * w) / img.width), my = Math.floor((y * h) / img.height);
        if (px[((h - 1 - my) * w + mx) * 4 + 1] > 128) { const i = (y * img.width + x) * 4; L.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); }
      }
      L.sort((a, b) => a - b);
      const q = (p) => (L.length ? Math.round(L[Math.floor(p * (L.length - 1))]) : 0);
      out[id] = { n: L.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
    }
    return out;
  }, buf.toString('base64'));
  console.log(name.padEnd(9), JSON.stringify(res));
  const tot = Object.values(res).reduce((a, v) => a + v.n, 0);
  console.log(`          total ${tot} px`);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__game.frame(0.016); });
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await browser.close();
