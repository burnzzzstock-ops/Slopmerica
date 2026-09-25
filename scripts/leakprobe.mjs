// Heap after forced GC over a long run with a stable town: flags leaks.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const cdp = await page.context().newCDPSession(page);
await page.evaluate(() => {
  const g = window.__game, d = window.__dbg; cancelAnimationFrame(g.raf);
  const S = g.startView(), cx = S.x, cz = S.z;
  for (let k = -2; k <= 2; k++) { d.road(cx - 200, cz + k * 90, cx + 200, cz + k * 90, 'twoLane'); d.road(cx + k * 90, cz - 200, cx + k * 90, cz + 200, 'twoLane'); }
  d.zone(cx - 100, cz - 100, 90, 'resLow'); d.zone(cx + 100, cz + 100, 90, 'resLow'); d.zone(cx + 100, cz - 100, 60, 'comLow'); d.zone(cx - 100, cz + 100, 60, 'industry');
});
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); return page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)); };
const counts = () => page.evaluate(() => { const g = window.__game; return { pop: g.sim.population, bld: g.buildings.list.size, cars: g.traffic.count, dom: document.getElementsByTagName('*').length, hist: g.sim.history.length }; });
for (const days of [60, 90, 90, 90, 90]) {
  await page.evaluate((n) => window.__dbg.run(n), days);
  console.log(JSON.stringify({ day: await page.evaluate(() => Math.round(window.__game.sim.day)), heapMB: await heap(), ...(await counts()) }));
}
await browser.close();
