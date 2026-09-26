// Save → reload → Resume trip brings back the same town: roads, buildings,
// zoning, population and money. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const SNAP = `(() => { const g = window.__game; return { segs: g.net.segs.size, bld: g.buildings.list.size, pop: g.sim.population, zoned: JSON.stringify(g.zones.counts().zoned), money: Math.round(g.sim.money), city: g.cityName }; })()`;
const before = await page.evaluate((snap) => {
  const d = window.__dbg, g = window.__game;
  cancelAnimationFrame(g.raf);
  const S = g.startView(); // inside the land you start with
  d.road(S.x - 60, S.z + 110, S.x - 60, S.z - 110, 'stroad4');
  d.zone(S.x - 60, S.z, 60, 'resLow');
  d.zone(S.x - 60, S.z - 70, 40, 'comLow');
  d.run(30);
  d.save();
  return (0, eval)(snap);
}, SNAP);
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('#continue', { timeout: 120000 });
await page.click('#continue');
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const after = await page.evaluate((snap) => { cancelAnimationFrame(window.__game.raf); return (0, eval)(snap); }, SNAP);
console.log('before', JSON.stringify(before));
console.log('after ', JSON.stringify(after));
const checks = [
  ['the test town was built (roads, buildings)', before.bld > 0 && before.segs > 0],
  ['roads come back', after.segs === before.segs],
  ['buildings come back', after.bld === before.bld],
  ['zoning comes back', after.zoned === before.zoned],
  ['population comes back', after.pop === before.pop],
  ['money comes back (a few frames may tick)', Math.abs(after.money - before.money) <= Math.abs(before.money) * 0.02 + 5],
  ['city name comes back', after.city === before.city],
  ['no page errors', errs.length === 0],
];
let bad = 0;
for (const [label, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', label); if (!ok) bad++; }
await browser.close();
process.exit(bad ? 1 : 0);
