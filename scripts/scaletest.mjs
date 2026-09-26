// What you see matches the size of the town: in a town of ~200 people the
// people outside, the cars and the boats stay in proportion (the playtest
// saw crowds of 50 leave one factory and a harbour full of boats).
// Exits nonzero on failure. `--trace` prints counts over time.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const trace = process.argv.includes('--trace');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  d.road(S.x, S.z - 100, S.x - 220, S.z - 100, 'twoLane');
  d.road(S.x, S.z - 100, S.x + 220, S.z - 100, 'twoLane');
  d.road(S.x, S.z - 260, S.x + 220, S.z - 260, 'twoLane');
  d.zone(S.x - 110, S.z - 70, 60, 'resLow');
  d.zone(S.x + 110, S.z - 70, 60, 'resLow');
  d.zone(S.x - 110, S.z - 130, 40, 'comLow');
  d.zone(S.x + 110, S.z - 230, 60, 'industry');
  // boats on the nearest water, counted the way the recording saw them (pop ~25: 50-70 boats)
  const W = (() => { for (let rad = 200; rad < 3000; rad += 100) for (let a = 0; a < 6.28; a += 0.2) { const x = S.x + Math.cos(a) * rad, z = S.z + Math.sin(a) * rad; if (g.terrain.inBounds(x, z, 50) && g.terrain.h(x, z) < -3) return { x, z }; } return null; })();
  const boatsAt = () => {
    const keep = g.camera.position.clone(), kt = g.rts.target?.clone?.();
    if (W) g.rts.setView(W.x, W.z, 700, undefined, undefined, true);
    for (let i = 0; i < 40; i++) g.frame(0.05, false);
    const n = g.ambientLife.activeBoats();
    return n;
  };
  for (let i = 0; i < 80 && g.sim.population < 25; i++) d.run(1);
  const small = { pop: g.sim.population, boats: boatsAt() };
  for (let i = 0; i < 80 && g.sim.population < 200; i++) d.run(1);
  // look at the town at rush hour, including the factory, and let agents settle
  g.hour = 17.5;
  g.rts.setView(S.x + 60, S.z - 150, 420, undefined, undefined, true);
  const samples = [];
  for (let k = 0; k < 8; k++) {
    for (let i = 0; i < 60; i++) g.frame(0.05, false);
    const out = new Map();
    for (const p of g.peds.peds) if (p.fromBld !== undefined) out.set(p.fromBld, (out.get(p.fromBld) ?? 0) + 1);
    const kinds = {}; for (const p of g.peds.peds) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    samples.push({ small, water: !!W, kinds, pop: g.sim.population, peds: g.peds.peds.length, town: g.peds.peds.filter((p) => p.kind !== 'commune').length, maxFromOne: Math.max(0, ...out.values()), cars: g.traffic.count, target: g.traffic.targetCars });
  }
  return samples;
});
if (trace) for (const s of r) console.log(JSON.stringify(s));
const last = r[r.length - 1], peak = (k) => Math.max(...r.map((s) => s[k]));
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
check(`people outside stay in proportion (at most ${peak('town')} of ${last.pop} residents, ≤ 12%)`, peak('town') <= Math.max(6, last.pop * 0.12), r);
check(`no building empties out at once (at most ${peak('maxFromOne')} people from one building)`, peak('maxFromOne') <= 8, r);
check(`rush-hour cars stay in proportion (${last.target} for ${last.pop} people, ≤ 20%)`, last.target <= Math.max(8, last.pop * 0.2), r);
check(`boats fit the town (${last.small.boats} at ${last.small.pop} people${last.water ? '' : ', no water found'})`, last.water && last.small.boats <= 3, last.small);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
