import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://127.0.0.1:5173/#skip&map=florida&mode=sandbox`, { waitUntil: 'load' });
await page.waitForTimeout(7000);
const out = await page.evaluate(async () => {
  const d = window.__dbg, g = window.__game;
  const cx = 60, cz = 60;
  for (const c of g.communes.list) { c.state = 'gone'; g.communes.group.remove(c.group); }
  g.syncBlockers();
  for (let k = -3; k <= 3; k++) { d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'); d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane'); }
  d.zone(cx - 150, cz - 150, 130, 'resLow'); d.zone(cx + 150, cz + 150, 130, 'resLow'); d.zone(cx, cz, 70, 'comLow'); d.zone(cx + 170, cz - 170, 110, 'industry'); d.zone(cx - 170, cz + 170, 110, 'resHigh');
  const log = [];
  for (let i = 0; i < 6; i++) {
    // realistic frame rate: 60fps at speed 1
    g.sim.speed = 1;
    for (let f = 0; f < 600; f++) g.frame(1 / 60, false);
    log.push({ day: Math.round(g.sim.day), pop: g.sim.population, flow: +g.traffic.flowEma.toFixed(2), crashes: g.traffic.crashes, ...g.traffic.stats(), target: g.traffic.targetCars });
  }
  return log;
});
for (const l of out) console.log(JSON.stringify(l));
await browser.close();
