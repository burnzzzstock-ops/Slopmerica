// Long-run economy/growth check: build a grid town, run years, print a timeline.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const map = process.argv[2] || 'florida';
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=ponzi`, { waitUntil: 'load' });
await page.waitForTimeout(7000);
const out = await page.evaluate(async () => {
  const d = window.__dbg, g = window.__game;
  const log = [];
  // grid of roads around the start
  const s = g.net.nodes.values().next().value;
  const S0 = g.startView();
  // put the test grid past the end of the seed road, away from the map edge
  const ex = S0.x - S0.edge.x, ez = S0.z - S0.edge.z, el = Math.hypot(ex, ez) || 1;
  const cx = Math.round(S0.x + (ex / el) * 380), cz = Math.round(S0.z + (ez / el) * 380);
  d.road(S0.x, S0.z, cx - 300, cz, 'twoLane');
  const res = [];
  for (let k = -3; k <= 3; k++) {
    res.push(d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'));
    res.push(d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane'));
  }
  d.zone(cx - 150, cz - 150, 130, 'resLow');
  d.zone(cx + 150, cz + 150, 130, 'resLow');
  d.zone(cx, cz, 70, 'comLow');
  d.zone(cx + 170, cz - 170, 110, 'industry');
  d.zone(cx - 170, cz + 170, 110, 'resHigh');
  d.zone(cx - 60, cz + 60, 50, 'comHigh');
  d.zone(cx + 60, cz - 60, 50, 'office');
  for (let y = 0; y < 6; y++) {
    const r = d.run(45);
    const c = g.buildings.counts();
    const lv = [...g.buildings.list.values()].reduce((a, b) => a + b.level, 0) / Math.max(1, g.buildings.list.size);
    log.push({ day: Math.round(r.day), pop: r.pop, bld: c.total, maxed: c.maxed, avgLv: +lv.toFixed(2), cars: r.cars, money: Math.round(g.sim.money), net: Math.round(g.sim.weeklyNet()), dem: Object.values(r.demand).map((v) => Math.round(v)).join('/'), sprawl: +(g.sim.sprawlPct * 100).toFixed(1), cov: +(g.sim.coverage * 100).toFixed(1), nature: +(g.sim.naturePct * 100).toFixed(1), crashes: g.traffic.crashes, flow: +g.traffic.flowEma.toFixed(2), st: JSON.stringify(g.traffic.stats()), blockedSegs: [...g.net.segs.values()].filter(s=>s.blocked>0).length });
  }
  return { res, log, ledger: g.sim.lastWeek };
});
console.log(JSON.stringify(out.res));
for (const l of out.log) console.log(JSON.stringify(l));
console.log(JSON.stringify(out.ledger));
await browser.close();
