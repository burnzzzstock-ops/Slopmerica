import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tmp = resolve('..', 'playwright-tmp');
const out = resolve('docs', 'screenshots', 'systems');
mkdirSync(tmp, { recursive: true }); mkdirSync(out, { recursive: true });
process.env.TEMP = tmp; process.env.TMP = tmp;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const errors = [];
for (const [layout, width, height] of [['desktop', 1280, 800], ['mobile', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: layout === 'mobile', hasTouch: layout === 'mobile' });
  page.on('pageerror', e => errors.push(`${layout}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${layout}: ${m.text()}`); });
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:5173'}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 120000 });
  await page.getByText("Let's pave", { exact: true }).click();
  await page.evaluate(() => {
    const g = window.__game, d = window.__dbg;
    cancelAnimationFrame(g.raf);
    for (const c of g.communes.list) { c.state = 'gone'; g.communes.group.remove(c.group); }
    g.syncBlockers();
    const cx = 60, cz = 60;
    for (let k = -3; k <= 3; k++) {
      d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane');
      d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane');
    }
    g.sim.population = 400;
    g.transit.placeDepot(390, 85);
    const depot = [...g.buildings.list.values()].find(b => b.kind === 'busDepot');
    if (depot) { depot.state = 'active'; depot.progress = 1; }
    d.zone(cx - 170, cz - 170, 150, 'resHigh');
    d.zone(cx + 170, cz + 170, 150, 'resHigh');
    d.zone(cx, cz, 90, 'comHigh');
    d.zone(cx + 170, cz - 170, 120, 'industry');
    d.zone(cx - 170, cz + 170, 120, 'office');
    d.run(90);
    for (const b of g.buildings.list.values()) if (b.zone !== 'service' && b.zone !== 'landmark') { b.state = 'active'; b.progress = 1; b.occ = Math.max(1, b.cap); }
    g.sim.population = Math.max(400, g.sim.population);
    for (const [x, z] of [[-180, 60], [0, 60], [180, 60]]) g.transit.addDraftPoint(x, z);
    g.transit.finishDraft();
    const line = [...g.transit.lines.values()][0]; if (line) line.buses = 4;
    g.transit.daily();
    g.transit.weekly();
    g.hour = 12;
    g.ui.feed.setCollapsed(true);
    const districts = g.districts;
    const district = districts.create();
    districts.paint(cx, cz, district.id, 160);
    districts.setDistrictPolicy(district.id, 'freeParking', true);
    g.rts.setView(cx, cz, 700, 0.6, 0.72, true);
    g.frame(0.016);
  });
  await page.waitForTimeout(4500);
  let currentPanel = null;
  const shot = async (name, panel, view) => {
    if (currentPanel !== panel) { await page.locator(`[data-t="${panel}"]`).click(); currentPanel = panel; }
    if (view) await page.locator(`[data-extview="${view}"]`).click();
    await page.evaluate(() => window.__game.frame(0.016));
    const path = resolve(out, `${layout}-${name}.png`);
    await page.screenshot({ path, timeout: 120000 });
    console.log(path);
  };
  await shot('transit-panel', 'ext:transit');
  await shot('districts-panel', 'ext:districts');
  await shot('terraform-panel', 'ext:terraform');
  await shot('disasters-panel', 'ext:disasters');
  await shot('transit-view', 'views', 'transit');
  await shot('goods-view', 'views', 'goods');
  await shot('districts-view', 'views', 'districts');
  await page.close();
}
await browser.close();
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 20)) console.log(e);
if (errors.length) process.exitCode = 1;
