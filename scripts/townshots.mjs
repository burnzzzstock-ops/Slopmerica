// Builds a small river town like the playtest's (Appalachia, ~250 people:
// a stroad, a street grid, an acute junction, a curve, shops, industry) and
// screenshots it the way the reference shots saw it: day overview, night,
// a close-up of the acute junction and of the factory frontage at shift
// change. For eyeballing visual fixes; prints counts. Usage:
//   node scripts/townshots.mjs [tag]    (Q=ultra|high|low, W=, H=)
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const tag = process.argv[2] || 'now';
const Q = process.env.Q || 'high';
const W = Number(process.env.W || 1268), H = Number(process.env.H || 595);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((q) => { try { localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } }, Q);
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const town = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  const r = [];
  r.push(d.road(S.x, S.z - 320, S.x, S.z + 320, 'stroad4'));
  for (let k = -3; k <= 3; k++) if (k) r.push(d.road(S.x - 260, S.z + k * 90, S.x + 260, S.z + k * 90, 'twoLane'));
  for (const x of [-180, -90, 90, 180]) r.push(d.road(S.x + x, S.z - 270, S.x + x, S.z + 270, 'twoLane'));
  // an acute junction: a road meeting the stroad at ~25 degrees
  r.push(d.road(S.x, S.z + 20, S.x + 130, S.z - 250, 'stroad4'));
  // a curve into the grid
  r.push(d.road(S.x + 260, S.z + 270, S.x + 60, S.z + 380, 'twoLane', S.x + 260, S.z + 380));
  for (const [x, z] of [[-135, -225], [-135, -135], [-135, 135], [-135, 225], [135, 135], [135, 225], [-45, 225], [45, 135]]) d.zone(S.x + x, S.z + z, 38, 'resLow');
  for (const [x, z] of [[-30, -45], [30, 45], [-30, 45]]) d.zone(S.x + x, S.z + z, 28, 'comLow');
  for (const [x, z] of [[135, -135], [225, -45], [-225, -45]]) d.zone(S.x + x, S.z + z, 40, 'industry');
  for (let i = 0; i < 160 && g.sim.population < 250; i++) d.run(1);
  return { S, roads: r, pop: g.sim.population, bld: g.buildings.list.size, day: Math.round(g.sim.day) };
});
console.log('town', JSON.stringify(town));
const shot = async (name, setup) => {
  const info = await page.evaluate(setup, town.S);
  await page.evaluate(() => { const g = window.__game; document.querySelector('.hud').style.visibility = 'hidden'; for (let i = 0; i < 3; i++) g.frame(0.05, false); g.frame(0.016, true); });
  await page.screenshot({ path: `shots/town/${tag}-${name}.png` });
  await page.evaluate(() => { document.querySelector('.hud').style.visibility = ''; });
  console.log(name, JSON.stringify(info ?? {}));
};
await shot('day', (S) => { const g = window.__game; g.hour = 10; g.rts.setView(S.x + 40, S.z, 620, 0.5, 0.95, true); for (let i = 0; i < 20; i++) g.frame(0.05, false); });
await shot('night', (S) => { const g = window.__game; g.hour = 1.2; g.rts.setView(S.x + 40, S.z, 620, 0.5, 0.95, true); for (let i = 0; i < 40; i++) g.frame(0.05, false); return { fireflies: g.particles?.count?.('firefly') }; });
await shot('dusk', (S) => { const g = window.__game; g.hour = 20.3; g.rts.setView(S.x + 40, S.z, 420, 0.5, 0.9, true); for (let i = 0; i < 20; i++) g.frame(0.05, false); });
await shot('junction', (S) => { const g = window.__game; g.hour = 10; g.rts.setView(S.x + 25, S.z - 20, 110, 0.3, 1.0, true); for (let i = 0; i < 10; i++) g.frame(0.05, false); });
await shot('factory', (S) => {
  const g = window.__game; g.hour = 16.8;
  const fac = [...g.buildings.list.values()].filter((b) => b.zone === 'industry').sort((a, b) => (b.occ ?? b.jobs ?? 0) - (a.occ ?? a.jobs ?? 0))[0];
  const at = fac ? { x: fac.x, z: fac.z } : { x: S.x + 135, z: S.z - 135 };
  g.rts.setView(at.x, at.z, 120, 0.3, 0.95, true);
  const trace = [];
  for (let k = 0; k < 10; k++) { for (let i = 0; i < 20; i++) g.frame(0.05, false); const near = g.peds.peds.filter((p) => Math.hypot(p.x - at.x, p.z - at.z) < 60); trace.push(near.length); }
  return { fac: !!fac, nearPeds: trace, pop: g.sim.population, all: g.peds.peds.length };
});
console.log('errors', errs.slice(0, 3));
await browser.close();
