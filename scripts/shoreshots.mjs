// Shorelines on gentle banks (docs/GRAPHICS_HANDOFF.md, item 6): fixed-camera captures of a map's water edge at low
// angles, from a point chosen from the terrain alone (so the same picture on old and new code).
//
// The bank is the nearest stretch to the start site where the ground crosses the water level with a slope, measured at the
// waterline, of 1:50 to 1:10 (else 1:6, else 1:4), the same kind of bank for 60 m along it (scripts/bankfind.mjs). Appalachia's is a river bank, Florida's the open coast. Each
// is shot from
//   low    1.7 m up, 24 m inland of the contour, looking at it and a little along the bank
//   low2   the other way along the bank, 30 m out
//   mid    140 m out at 20 degrees
//   top    90 m up looking straight down
//
// usage: BASE_URL=http://127.0.0.1:5175 MAP=appalachia node scripts/shoreshots.mjs <outdir> [quality]
//   COAST=1 picks the beach instead (the map's sand function above 0.4), PHONE=1 shoots a 390x780 @3x touch context; DAY=<0-364> and HOUR=<h> set the date and the hour; SHOTS=mid,top only those.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE } from './refblock.mjs';
import { bankTools } from './bankfind.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const MAP = process.env.MAP || 'appalachia';
const outDir = process.argv[2] || 'shots/gfx/shore';
const quality = process.argv[3] || 'high';
mkdirSync(outDir, { recursive: true });
const phone = !!process.env.PHONE;
const coast = !!process.env.COAST; // the beach: the nearest gentle bank where the map's own sand function says beach
const tag = MAP + (coast ? '-coast' : '');
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const ctx = phone ? await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }) : await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((q) => { try { localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } }, quality);
await page.goto(`${base}/#skip&map=${MAP}&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
const bank = await page.evaluate(({ day, hour, coast, src }) => {
  const g = window.__game, T = g.terrain;
  cancelAnimationFrame(g.raf);
  for (const e of document.querySelectorAll('.hud, .xfeed, .toast, .next-bar, .side-cards')) e.style.display = 'none';
  const S = g.startView();
  const tools = new Function(`return ${src}`)()(T);
  // the gentlest kind of bank there is near the start: 1:10, else 1:6, else 1:4
  let best = null, used = 0;
  for (const maxSlope of [1 / 10, 1 / 6, 1 / 4]) { best = tools.find(S, { coast, maxSlope }); if (best) { used = maxSlope; break; } }
  if (!best) return null;
  best.maxSlope = used;
  // toward the water: down the gradient
  best.wx = -best.nx; best.wz = -best.nz;
  g.env.moonPhaseOverride = 0.5; g.weather.force('clear', 30); g.weather.settle(); g.weather.snowCover = 0;
  window.__dbg.hour(hour);
  g.sim.day = day;
  return best;
}, { day: +(process.env.DAY ?? 120), hour: +(process.env.HOUR ?? 12.5), coast, src: bankTools.toString() });
if (!bank) { console.log('no gentle bank found near the start of', MAP); process.exit(1); }
console.log('bank', JSON.stringify(bank));
// yaw such that the camera offset points along (dx, dz)
const yawOf = (dx, dz) => Math.atan2(dx, dz);
const tx = -bank.wz, tz = bank.wx;
const V = [
  ['low', bank.x - bank.wx * 0 + tx * 6, bank.z + tz * 6, 24, yawOf(-bank.wx + tx * 0.25, -bank.wz + tz * 0.25), 0.05],
  ['low2', bank.x - tx * 10, bank.z - tz * 10, 30, yawOf(-bank.wx - tx * 0.5, -bank.wz - tz * 0.5), 0.07],
  ['mid', bank.x, bank.z, 140, yawOf(-bank.wx, -bank.wz), 0.35],
  ['top', bank.x, bank.z, 90, yawOf(-bank.wx, -bank.wz), 1.5],
];
const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
for (const [name, x, z, dist, yaw, pitch] of V) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(({ x, z, dist, yaw, pitch }) => { const g = window.__game; window.__dbg.view(x, z, dist, yaw, pitch); for (let i = 0; i < 12; i++) g.frame(0.016); }, { x, z, dist, yaw, pitch });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.screenshot({ path: `${outDir}/${tag}-${name}.png`, timeout: 420000 });
      console.log('shot', `${outDir}/${tag}-${name}.png`);
      break;
    } catch (e) { console.log('shot failed', name, attempt, String(e.message).split('\n')[0]); }
  }
}
writeFileSync(`${outDir}/${tag}-bank.json`, JSON.stringify(bank));
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await browser.close();
