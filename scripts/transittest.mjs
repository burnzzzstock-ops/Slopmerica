import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const temp = resolve('..', 'playwright-tmp');
mkdirSync(temp, { recursive: true });
process.env.TEMP = temp;
process.env.TMP = temp;

const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Number(process.argv[3]) || 1000, height: Number(process.argv[4]) || 700 }, hasTouch: process.argv[5] === 'touch', isMobile: process.argv[5] === 'touch' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const base = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:5173';
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction(() => window.__game?.transit && window.__dbg, null, { timeout: 120000 });
} catch (error) {
  console.log('startup errors:', errors.join('\n'));
  throw error;
}
if (await page.locator('#ob-go').count()) await page.locator('#ob-go').click();
const out = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.transit;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  for (let k = -3; k <= 3; k++) {
    d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane');
    d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane');
  }
  g.sim.population = 400;
  const depotPlaced = t.placeDepot(390, 85);
  const depot = [...g.buildings.list.values()].find((b) => b.kind === 'busDepot');
  if (depot) { depot.state = 'active'; depot.progress = 1; }
  d.zone(cx - 170, cz - 170, 150, 'resHigh');
  d.zone(cx + 170, cz + 170, 150, 'resHigh');
  d.zone(cx, cz, 90, 'comHigh');
  d.zone(cx + 170, cz - 170, 120, 'industry');
  d.zone(cx - 170, cz + 170, 120, 'office');
  d.run(90);
  // Make the test independent of growth variance while preserving real generated lots and road anchors.
  for (const b of g.buildings.list.values()) if (b.zone !== 'service' && b.zone !== 'landmark') { b.state = 'active'; b.progress = 1; b.occ = Math.max(1, b.cap); }
  g.sim.population = Math.max(400, [...g.buildings.list.values()].filter((b) => b.zone === 'resLow' || b.zone === 'resHigh').reduce((n, b) => n + b.occ, 0));
  const points = [[-180, 60], [0, 60], [180, 60]];
  const stopResults = points.map(([x, z]) => t.addDraftPoint(x, z));
  const lineFinished = t.finishDraft();
  const line = [...t.lines.values()][0];
  if (line) line.buses = 4;
  t.daily();
  const ridersAtOpening = t.stats.ridersToday;

  const clearCars = () => {
    for (const c of g.traffic.cars) g.traffic.renderer.remove(c.h);
    g.traffic.cars.length = 0;
  };
  const hook = g.traffic.transitModeChoice;
  g.traffic.transitModeChoice = undefined;
  clearCars();
  const b0 = g.traffic.totalTrips;
  for (let i = 0; i < 700; i++) g.traffic.spawnTrip(8.2);
  const carsWithoutTransit = g.traffic.totalTrips - b0;
  clearCars();
  g.traffic.transitModeChoice = hook;
  const b1 = g.traffic.totalTrips, diverted0 = t.stats.divertedCarTrips, riders0 = line?.weeklyRiders ?? 0;
  for (let i = 0; i < 700; i++) g.traffic.spawnTrip(8.2);
  const carsWithTransit = g.traffic.totalTrips - b1;
  const diverted = t.stats.divertedCarTrips - diverted0;
  // accounting: diverted visible trips are mode choice, not extra riders
  const divertedAddedRiders = (line?.weeklyRiders ?? 0) - riders0;
  clearCars();
  // a second line on the same stops shares the same commuters
  points.forEach(([x, z]) => t.addDraftPoint(x, z));
  t.finishDraft();
  const twin = [...t.lines.values()][1];
  if (twin) twin.buses = 4;
  t.daily();
  const ridersWithTwin = t.stats.ridersToday;

  g.sim.speed = 3;
  for (let i = 0; i < 3000; i++) g.frame(1 / 30, false);
  const saveOk = d.save();
  const saved = JSON.parse(localStorage.getItem('slopmerica.save.v1'));
  const roundTrip = saved?.ext?.transit?.lines?.length === t.lines.size && saved?.ext?.transit?.stops?.length === t.stops.size && saved?.ext?.transit?.fare === t.fare;
  return {
    depotPlaced, stopResults, lineFinished, lines: t.lines.size, stops: t.stops.size,
    servedBuildings: t.stats.servedBuildings, ridersAtOpening, ridersToday: t.stats.ridersToday,
    carsWithoutTransit, carsWithTransit, diverted, divertedAddedRiders, ridersWithTwin, twinLines: t.lines.size,
    observedDrop: carsWithoutTransit ? (carsWithoutTransit - carsWithTransit) / carsWithoutTransit : 0,
    busesCompletedLoops: t.stats.busesCompletedLoops,
    activeBuses: g.traffic.cars.filter((c) => c.kind === 'cityBus').length,
    saveOk, roundTrip,
  };
});
console.log(JSON.stringify(out, null, 2));
if (errors.length) console.log('browser errors:', errors.join('\n'));
const ok = out.depotPlaced && out.stopResults.every(Boolean) && out.lineFinished && out.servedBuildings > 0 && out.ridersAtOpening > 0 && out.diverted > 0 && out.carsWithTransit < out.carsWithoutTransit && out.busesCompletedLoops > 0 && out.roundTrip && !errors.length
  && out.divertedAddedRiders === 0 && out.twinLines === 2 && out.ridersWithTwin <= out.ridersAtOpening * 1.05;
console.log(ok ? 'OK' : 'FAIL', `riders one line ${out.ridersAtOpening}, two overlapping lines ${out.ridersWithTwin}, riders added by diversions ${out.divertedAddedRiders}`);
const shotPrefix = process.argv[6];
if (shotPrefix) {
  mkdirSync('artifacts', { recursive: true });
  await page.locator('button[title="Transit"]').click();
  await page.evaluate(() => { const g = window.__game; g.rts.setView(0, 60, 520, 0, 0.72, true); g.frame(0.016); });
  await page.screenshot({ path: `artifacts/${shotPrefix}-panel.png`, timeout: 120000 });
  await page.locator('button[title="Info Views"]').click();
  await page.locator('button[data-extview="transit"]').click();
  await page.evaluate(() => { const g = window.__game; g.frame(0.016); });
  await page.screenshot({ path: `artifacts/${shotPrefix}-view.png`, timeout: 120000 });
}
await browser.close();
if (!ok) process.exitCode = 1;
