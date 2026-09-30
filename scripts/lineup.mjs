// Vehicle lineup captures (dev/vehicles.html, src/dev/vehicles.ts): every model at 8 m, 40 m and 150 m, day and night, on the
// real VehicleRenderer, no game boot (a page load is seconds, not minutes). Works on old and new code with the same camera,
// which is the point: run it against the frozen "before" server and against your build, then compare the contact sheets.
// usage: BASE_URL=http://127.0.0.1:5175 node scripts/lineup.mjs <tag> [ids, comma list or 'all'] [dists, default 8,40,150] [times, default day,night]
//   OUT=shots/lineup (default)   writes <OUT>/<tag>/<id>-<dist>-<time>.jpg, sheet-<dist>-<time>.jpg contact sheets and index.html
//   AZ=35 EL=18 (camera)   W=960 H=540 (frame)   CROP=1 (crop each shot to the car, default on)   WET=1 (rain wet)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const [tag = 'run', idsArg = 'all', distsArg = '8,40,150', timesArg = 'day,night'] = process.argv.slice(2);
const out = `${process.env.OUT || 'shots/lineup'}/${tag}`;
mkdirSync(out, { recursive: true });
const W = Number(process.env.W || 960), H = Number(process.env.H || 540);
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`${base}/dev/vehicles.html?w=${W}&h=${H}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__lineup?.ready, null, { timeout: 180000 });
const all = await page.evaluate(() => window.__lineup.models());
const ids = idsArg === 'all' ? all.map((m) => m.id) : idsArg.split(',');
const dists = distsArg.split(',').map(Number), times = timesArg.split(',');
const shots = [];
const azs = (process.env.AZS || process.env.AZ || '35').split(',').map(Number);
for (const time of times) for (const dist of dists) for (const id of ids) for (const azi of azs) {
  const m = all.find((x) => x.id === id);
  if (!m) { console.log('unknown id', id); continue; }
  const r = await page.evaluate((a) => window.__lineup.show(a.id, { dist: a.dist, night: a.time === 'night' ? 1 : 0, wet: a.wet, az: a.az, el: a.el, scale: false }),
    { id, dist, time, wet: Number(process.env.WET || 0), az: azi, el: Number(process.env.EL || 18), fov: Number(process.env.FOV || 50) });
  // crop to the car: its projected box, padded
  let clip = { x: 0, y: 0, width: W, height: H };
  if (process.env.CROP !== '0') {
    clip = await page.evaluate(({ L, Hh, Wd }) => {
      const { camera } = window.__lineup, THREE_V = camera.position.constructor;
      const pts = [];
      for (const x of [-Wd / 2, Wd / 2]) for (const y of [0, Hh]) for (const z of [-L / 2, L / 2]) pts.push(new THREE_V(x, y, z));
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) { p.project(camera); const sx = (p.x * 0.5 + 0.5) * innerWidth, sy = (0.5 - p.y * 0.5) * innerHeight; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
      const pad = Math.max(24, (x1 - x0) * 0.12), w = Math.max(x1 - x0 + pad * 2, 200), h = Math.max(y1 - y0 + pad * 2, 130);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const ar = 16 / 10; let cw = Math.max(w, h * ar), ch = cw / ar;
      cw = Math.min(cw, innerWidth); ch = Math.min(ch, innerHeight);
      return { x: Math.max(0, Math.min(innerWidth - cw, cx - cw / 2)), y: Math.max(0, Math.min(innerHeight - ch, cy - ch / 2)), width: cw, height: ch };
    }, { L: m.length, Hh: m.height, Wd: m.width });
  }
  const file = azs.length > 1 ? `${id}-${dist}-${time}-a${azi}.jpg` : `${id}-${dist}-${time}.jpg`;
  await page.screenshot({ path: `${out}/${file}`, type: 'jpeg', quality: 86, clip, timeout: 180000 });
  shots.push({ id, dist, time, az: azi, file, calls: r.calls, tris: r.tris });
  console.log('shot', file, `${r.calls} calls ${r.tris} tris`);
}
if (errs.length) console.log('page errors:', [...new Set(errs)].slice(0, 5));
await browser.close();
const cell = (s) => `<figure><img src="${s.file}"><figcaption>${s.id} · ${s.dist} m · ${s.time}${azs.length > 1 ? ' · az ' + s.az : ''}</figcaption></figure>`;
writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Lineup ${tag}</title>
<style>body{font:12px system-ui;background:#111;color:#ddd;margin:12px}section{display:grid;grid-template-columns:repeat(${process.env.COLS || 4},1fr);gap:6px;margin-bottom:20px}img{width:100%;display:block}figure{margin:0}h2{margin:8px 0}</style>
${times.map((t) => dists.map((d) => `<h2>${t} · ${d} m</h2><section>${shots.filter((s) => s.time === t && s.dist === d).map(cell).join('')}</section>`).join('')).join('')}`);
console.log(`${shots.length} shots -> ${out}/index.html`);
process.exit(errs.length ? 0 : 0);
