// Growth pace, land ownership and shore snapping in a normal (ponzi) game.
import { chromium } from 'playwright-core';
const map = process.argv[2] || 'florida';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message + '\n' + e.stack));
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=ponzi`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg && window.__land, null, { timeout: 120000 });
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
const out = await page.evaluate(() => {
  const d = window.__dbg, g = window.__game, LD = window.__land, SV = window.__services;
  const S0 = g.startView();
  const cx = Math.round(S0.x), cz = Math.round(S0.z);
  const log = [];
  const owned = LD.L.owned.reduce((a, b) => a + b, 0);
  log.push({ owned, price: LD.landPrice(), money: Math.round(g.sim.money) });
  // land: a road far outside the starting block is refused
  log.push({ farRoad: d.road(cx + 1700, cz, cx + 1900, cz, 'twoLane') });
  // a small town inside the start block
  for (let k = -1; k <= 1; k++) { d.road(cx - 180, cz + k * 90, cx + 180, cz + k * 90, 'twoLane'); d.road(cx + k * 90, cz - 180, cx + k * 90, cz + 180, 'twoLane'); }
  d.zone(cx - 90, cz - 90, 80, 'resLow'); d.zone(cx + 90, cz + 90, 80, 'resLow'); d.zone(cx + 90, cz - 90, 60, 'comLow'); d.zone(cx - 90, cz + 90, 60, 'industry');
  const snap = () => ({ day: Math.round(g.sim.day), pop: g.sim.population, bld: [...g.buildings.list.values()].filter((b) => b.zone !== 'service').length, money: Math.round(g.sim.money), net: Math.round(g.sim.weeklyNet()) });
  for (const days of [5, 5, 10, 10, 20, 30]) { d.run(days); log.push(snap()); }
  // shore snapping: find a water cell near town, aim 50 m inland of it
  let best = null;
  for (let r = 100; r < 1500 && !best; r += 40) for (let a = 0; a < 64; a++) {
    const x = cx + Math.cos(a / 64 * Math.PI * 2) * r, z = cz + Math.sin(a / 64 * Math.PI * 2) * r;
    if (g.terrain.h(x, z) < -0.5 && LD.landOwned(x, z)) { best = { x, z, a: a / 64 * Math.PI * 2 }; break; }
  }
  if (best) {
    const ax = best.x - Math.cos(best.a) * 60, az = best.z - Math.sin(best.a) * 60;
    for (const id of ['waterPump', 'sewageOutfall']) {
      const direct = SV.canPlace(g, id, ax, az);
      const spot = SV.findSpot ? SV.findSpot(g, id, ax, az) : null;
      log.push({ id, direct: direct.ok || direct.reason, snapped: spot && (spot.reason || (spot.snapped ? `snapped ${Math.round(Math.hypot(spot.x - ax, spot.z - az))} m` : 'ok here')) });
    }
  } else log.push({ water: 'no owned water found near town' });
  // buy a neighbor tile
  const t = [...LD.L.owned.keys()].find((i) => !LD.L.owned[i] && [1, -1, 8, -8].some((o) => LD.L.owned[i + o] && Math.abs((i % 8) - ((i + o) % 8)) <= 1));
  const before = Math.round(g.sim.money);
  const ok = LD.buy(g, t);
  log.push({ buyTile: t, ok, cost: before - Math.round(g.sim.money), ownedNow: LD.L.owned.reduce((a, b) => a + b, 0), nextPrice: LD.landPrice() });
  return log;
});
for (const l of out) console.log(JSON.stringify(l));
console.log(errs.slice(0, 5).join('\n'));
await browser.close();
