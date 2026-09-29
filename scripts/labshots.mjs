// Fixed-camera captures from the dev lab (dev/buildings.html): one model at a time, the same camera on every run, so a
// before/after pair of a building change is the same picture. Loads only the generators (no town), so a run is quick.
//
// usage: BASE_URL=http://127.0.0.1:5175 node scripts/labshots.mjs <outdir> [view] [shots]
//   view   services (default) | vault | zones ... whatever dev/buildings.ts builds; an item is found by its `sub` label
//   shots  comma list of  <sub>@<dist>@<az>@<el>  (az 0 = looking at the front (+z) face, 1.57 = from +x; el in radians),
//          default: the buildings item 4 changes, two views each (front three-quarter, side three-quarter)
//   NIGHT=1 lights the lab at night; W= H= set the viewport (1280x720)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { ARGS, EXE } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const outDir = process.argv[2] || 'shots/gfx/lab';
const view = process.argv[3] || 'services';
const DEFAULT = [
  'school:classic@74@0.6@0.42', 'school:classic@74@2.2@0.42',
  'sheriff:vault@56@0.6@0.42', 'sheriff:vault@56@2.2@0.42',
  'waterPump:vault@36@0.6@0.42', 'waterPump:vault@36@2.2@0.42',
  'sewageOutfall:vault@36@0.6@0.42', 'sewageOutfall:vault@36@2.2@0.42',
  'treatmentPlant:vault@72@0.6@0.42', 'treatmentPlant:vault@72@2.2@0.42',
];
const shots = (process.argv[4] ? process.argv[4].split(',') : DEFAULT).map((s) => { const [sub, dist, az, el] = s.split('@'); return { sub, dist: +dist, az: +az, el: +el }; });
mkdirSync(outDir, { recursive: true });
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); });
await page.goto(`${base}/dev/buildings.html#view=${view}&labels=0${process.env.NIGHT === '1' ? '&night=1' : ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__gallery, null, { timeout: 300000 });
const items = await page.evaluate(() => window.__gallery.items.map((i) => i.sub));
await page.evaluate(() => { for (const id of ['hud', 'info']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } });
for (const s of shots) {
  const idx = items.indexOf(s.sub);
  if (idx < 0) { console.log('no such item', s.sub, '(have', items.length, ')'); continue; }
  await page.evaluate(({ idx, s }) => window.__gallery.focus(idx, s.dist, s.az, s.el), { idx, s });
  await page.waitForTimeout(2500); // (a few frames: the lab renders on its own loop)
  const file = `${outDir}/${s.sub.replace(':', '-')}-az${s.az}.png`;
  await page.screenshot({ path: file, timeout: 120000 });
  console.log('shot', file);
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await browser.close();
