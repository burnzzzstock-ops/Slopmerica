// Services & utilities: build a town on imports only, watch it run short,
// then add plants/services and check that the consequences resolve.
import { chromium } from 'playwright-core';
const map = process.argv[2] || 'florida';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message + '\n' + e.stack));
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 120000 });
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
const out = await page.evaluate(() => {
  const d = window.__dbg, g = window.__game, SV = window.__services;
  const S0 = g.startView();
  const cx = Math.round(S0.x), cz = Math.round(S0.z);
  for (const c of g.communes.list) { c.state = 'gone'; g.communes.group.remove(c.group); }
  g.syncBlockers();
  for (let k = -3; k <= 3; k++) { d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'); d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane'); }
  // connect the grid to the nearest outside connection road if not already
  d.zone(cx - 150, cz - 150, 130, 'resLow'); d.zone(cx + 150, cz + 150, 130, 'resLow'); d.zone(cx, cz, 70, 'comLow'); d.zone(cx + 170, cz - 170, 110, 'industry'); d.zone(cx - 170, cz + 170, 110, 'resHigh');
  const snap = (label) => { const s = SV.snapshot(); return { label, day: Math.round(g.sim.day), pop: g.sim.population, bld: g.buildings.list.size, power: fmt(s.util.power), water: fmt(s.util.water), sewage: fmt(s.util.sewage), counts: s.counts, garbage: { made: +s.garbage.made.toFixed(1), coll: +s.garbage.collected.toFixed(1), exp: +s.garbage.exported.toFixed(1), stored: Math.round(s.garbage.stored) }, demand: g.sim.demand && Object.fromEntries(Object.entries(g.sim.demand).map(([k, v]) => [k, Math.round(v)])), why: g.sim.demandWhy.res.slice(0, 4) }; };
  const fmt = (u) => ({ sup: +u.supply.toFixed(1), use: +u.served.toFixed(1), imp: +u.imported.toFixed(1), off: u.unserved });
  const log = [];
  d.run(40); log.push(snap('imports only'));
  // place services: scan candidate spots around the grid
  const tryPlace = (id, near) => {
    const R = near ? [60, 120, 200, 320, 500, 800, 1200] : [60, 120, 200];
    for (const r of R) for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
      const c = SV.canPlace(g, id, x, z);
      if (c.ok) { const b = SV.place(g, id, x, z); if (b) return [Math.round(x), Math.round(z)]; }
    }
    return null;
  };
  const placed = {};
  for (const id of ['gasPeaker', 'wellTower', 'fireStation', 'sheriff', 'clinic', 'school', 'park']) placed[id] = tryPlace(id, false);
  placed.landfill = tryPlace('landfill', true);
  placed.waterPump = tryPlace('waterPump', true);
  placed.sewageOutfall = tryPlace('sewageOutfall', true);
  log.push({ placed });
  d.run(40); log.push(snap('with services'));
  d.run(60); log.push(snap('later'));
  const lv = [...g.buildings.list.values()].filter((b) => b.zone !== 'service');
  const binding = {};
  for (const b of lv) { const r = g.sim.bindingConstraint(b); if (r) binding[r] = (binding[r] ?? 0) + 1; }
  const lines = [];
  for (const h of g.sim.hooks.weekly) h((l, a) => lines.push([l, Math.round(a)]));
  const F = SV.S.fields; let pmax = 0, nmax = 0; for (const v of F.pol) pmax = Math.max(pmax, v); for (const v of F.noise) nmax = Math.max(nmax, v);
  log.push({ dailyMs: +(SV.S.perf.ms / Math.max(1, SV.S.perf.n)).toFixed(2), days: SV.S.perf.n, polMax: +pmax.toFixed(2), noiseMax: +nmax.toFixed(2) });
  log.push({ levels: lv.reduce((a, b) => { a[b.level] = (a[b.level] ?? 0) + 1; return a; }, {}), binding, weekly: lines });
  return log;
});
for (const l of out) console.log(JSON.stringify(l));
console.log(errs.slice(0, 5).join('\n'));
await browser.close();
