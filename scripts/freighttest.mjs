// Builds a mixed town and verifies conserved production, truck deliveries,
// dry-shop consequences, and freight save data. Run with Vite on :5173.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep Chromium's ephemeral profile outside Vite's watched project tree.
const playwrightTmp = resolve('..', 'playwright-tmp');
mkdirSync(playwrightTmp, { recursive: true });
process.env.TEMP = process.env.TMP = playwrightTmp;

const executablePath = process.env.CHROME_PATH
  || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION_REFUSED')) errors.push(m.text()); });
const baseUrl = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:5173';
await page.goto(`${baseUrl}/#skip&map=florida&mode=sandbox&debug=1`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.freight && window.__dbg, null, { timeout: 120000 });

const result = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; g.communes.group.remove(c.group); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  for (let k = -3; k <= 3; k++) {
    d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane');
    d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane');
  }
  const edgeRoad = d.road(cx + 300, cz, 3040, cz, 'highway');
  d.zone(cx - 150, cz - 150, 130, 'resLow');
  d.zone(cx, cz, 90, 'comLow');
  d.zone(cx + 170, cz - 170, 120, 'industry');
  d.zone(cx - 170, cz + 170, 80, 'resHigh');
  const run = (days) => {
    const old = g.sim.speed; g.sim.speed = 3;
    const end = g.sim.day + days;
    while (g.sim.day < end) g.frame(0.1, false);
    g.sim.speed = old;
  };
  run(75);
  const before = g.freight.stats();
  const assertion = g.freight.assertBalance();
  const factorySegs = new Set([...g.buildings.list.values()].filter((b) => b.zone === 'industry').map((b) => b.seg));
  for (const id of factorySegs) if (g.net.segs.has(id)) g.net.removeSeg(id);
  // Stop replacement factories from regrowing on vacated industrial cells.
  // Existing shelf stock remains conserved and is sold down naturally.
  g.zones.paint(cx + 170, cz - 170, 180, null);
  const outside = g.traffic.outsideConnections;
  g.traffic.outsideConnections = () => 0;
  run(50);
  g.traffic.outsideConnections = outside;
  const afterRoadCut = g.freight.stats();
  const blocked = [...g.buildings.list.values()].filter((b) => (b.zone === 'comLow' || b.zone === 'comHigh') && g.sim.vacancyBlock(b) === 'No goods to sell').length;
  const populatedRoundTrip = g.freight.roundTrip();
  for (const car of g.traffic.cars) if (car.kind === 'semi' || car.kind === 'boxTruck') car.crashed = -1;
  g.frame(0.1, false);
  // Isolate one real edge-to-shop delivery. Competing factories otherwise keep
  // retrying local routes, while dozens of long-haul imports can sit in traffic
  // beyond this test's time budget. The road-cut consequence was measured above.
  const commerce = [...g.buildings.list.values()].filter((b) => b.zone === 'comLow' || b.zone === 'comHigh');
  const importShop = commerce.filter((b) => g.sim.vacancyBlock(b) === 'No goods to sell').sort((a, b) => b.x - a.x)[0];
  for (const b of [...g.buildings.list.values()]) {
    if (b.zone === 'industry' || ((b.zone === 'comLow' || b.zone === 'comHigh') && b !== importShop)) g.buildings.demolish(b, 'freight test isolation');
  }
  g.zones.paint(cx + 170, cz - 170, 180, null);
  g.zones.paint(cx, cz, 160, null);
  g.freight.daily();
  run(120);
  const afterImports = g.freight.stats();
  const roundTrip = g.freight.roundTrip();
  d.save();
  const savedFreight = JSON.parse(localStorage.getItem('slopmerica.save.v1')).ext.freight;
  return { edgeRoad, before, assertion, outsideConnections: outside.call(g.traffic), removedFactoryRoads: factorySegs.size, afterRoadCut, blocked, populatedRoundTrip, importShop: importShop?.id ?? 0, afterImports, roundTrip, savedFreight: { factories: savedFreight.factories.length, shops: savedFreight.shops.length, version: savedFreight.version } };
});

console.log(JSON.stringify(result, null, 2));
if (!result.assertion.ok) throw new Error('conservation assertion failed');
if (typeof result.edgeRoad !== 'number') throw new Error(`explicit highway was not built: ${result.edgeRoad}`);
if (result.before.totals.localDelivered <= 0) throw new Error('no local goods were delivered');
if (result.blocked <= 0) throw new Error('shops did not run dry after factory roads were removed');
if (!result.importShop || result.outsideConnections <= 0) throw new Error('no reachable import test endpoint');
if (result.afterImports.totals.imported <= 0) throw new Error(`dry shop did not receive its highway import; active imports=${result.afterImports.activeByKind.import}`);
if (!result.populatedRoundTrip.equal || !result.roundTrip.equal) throw new Error('freight save/load round trip changed state');
if (result.savedFreight.version !== 1 || !result.savedFreight.shops) throw new Error('freight state missing from save');
if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
await browser.close();
