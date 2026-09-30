// Tower look lab: lays out the showcase (every zone x level, so the glass offices, the neon tower and the resi towers) on open
// ground beside the reference block, then shoots it from a few cameras at noon / night for each of a list of glass settings,
// with the class-masked tower luma of each shot. One page load serves a whole sweep, so a look can be tuned in one go.
// (docs/HANDOFF_CARS_LOOK.md item 6; the numbers that go in a commit come from scripts/towers.mjs on the real block.)
//
// usage: node scripts/towerlab.mjs [quality, default low]
//   PHONE=1            390x780 @3x touch context
//   HOURS=12.5,23      hours (default 12.5)
//   YAWS=0.5,2.4       camera yaws around the lineup (default 0.5)
//   SETS='[[0.14,0.8,0.12,0.15,0.35],[0,0,0,0,0]]'   GLASS.uGlass vectors (+ optional 5th number: the wall fill uFillK) to try (default: the shipped ones); [0,0,0,0,0] = both off
//   VARIANT=0          showcase seed variant
//   ROWS=office        which showcase rows to frame: office | comHigh | resHigh | all (default office)
//   OUT=dir            JPEG per shot: dir/lab-<quality>-h<hour>-y<yaw>-s<set>.jpg
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
import { classStats, maskPass } from './lib/towermask.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'low';
const phone = !!process.env.PHONE;
const hours = (process.env.HOURS || '12.5').split(',').map(Number);
const yaws = (process.env.YAWS || '0.5').split(',').map(Number);
const sets = process.env.SETS ? JSON.parse(process.env.SETS) : [null];
const variant = Number(process.env.VARIANT || 0);
const rows = process.env.ROWS || 'office';
const OUT = process.env.OUT || 'shots/lab';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, phone ? { base, quality, width: 390, height: 780, phone: true } : { base, quality });
page.on('console', (m) => { if (m.type() === 'error' || /WebGLProgram|shader/i.test(m.text())) console.log('console:', m.text().slice(0, 600)); });
const lab = { x: center.x, z: center.z + 560 };
await page.evaluate(({ lab, variant }) => { window.__dbg.showcase(lab.x, lab.z, variant); }, { lab, variant });
const rowZ = { resHigh: -66, comHigh: 22, office: 110, all: 22 }[rows] ?? 110;
const out = [];
for (const hour of hours) for (const yaw of yaws) for (let si = 0; si < sets.length; si++) {
  const set = sets[si];
  if (set) await page.evaluate(async (v) => { const G = (await import('/src/buildings/material.ts')).GLASS; G.uGlass.value.set(v[0], v[1], v[2], v[3]); if (v.length > 4) G.uFillK.value = v[4]; }, set);
  const night = hour > 20 || hour < 5;
  await shoot(page, { x: lab.x, z: lab.z }, { hour, moon: night ? 0.5 : 0.5, weather: 'clear', view: [0, rowZ, rows === 'all' ? 330 : 190, yaw, 0.32] });
  console.log('sky', JSON.stringify(await page.evaluate(() => { const e = window.__game.env; const r = (c) => [c.r, c.g, c.b].map((v) => +v.toFixed(3)); return { zenith: r(e.zenith), horizon: r(e.horizon), sunI: +e.sunIntensity.toFixed(2), hemi: +e.hemi.intensity.toFixed(2), exposure: window.__game.renderer.toneMappingExposure }; })));
  await maskPass(page, 14);
  const buf = await page.screenshot({ timeout: 420000, ...(phone ? { scale: 'css' } : {}) });
  const s = await classStats(page, buf.toString('base64'));
  const name = `lab-${phone ? 'phone-' : ''}${quality}-h${String(hour).replace('.', '_')}-y${yaw}-s${si}`;
  writeFileSync(`${OUT}/${name}.jpg`, await page.screenshot({ timeout: 420000, type: 'jpeg', quality: 85, ...(phone ? { scale: 'css' } : {}) }));
  out.push({ name, set, hour, yaw, tower: s.tower });
  console.log(JSON.stringify({ name, set, tower: s.tower }));
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
writeFileSync(`${OUT}/lab-${phone ? 'phone-' : ''}${quality}.json`, JSON.stringify(out, null, 1));
await browser.close();
