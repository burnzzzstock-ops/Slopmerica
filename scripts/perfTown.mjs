// Build a repeatable 7x7 town, advance 270 days and capture the F3 metrics.
// PORT=5174 PRESET=high node scripts/perfTown.mjs
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const preset = process.env.PRESET || 'high';
const port = process.env.PORT || '5173';
const mobile = preset === 'low';
const width = mobile ? 390 : 1280, height = mobile ? 844 : 800;
const out = process.env.OUT || 'shots/perf';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
const errors = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(n => { try { localStorage.setItem('slopmerica.quality', n); } catch { /* private */ } }, preset);
await page.goto(`http://127.0.0.1:${port}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
await page.evaluate(() => { document.querySelector('.onboard button')?.click(); window.__game.stop(); window.__game.sim.speed = 0; });
const build = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  const x = S.x + 240, z = S.z + 240;
  const roads = [];
  for (let i = -3; i <= 3; i++) roads.push(d.road(x - 300, z + i * 100, x + 300, z + i * 100, i === 0 ? 'stroad4' : 'twoLane'));
  for (let i = -3; i <= 3; i++) roads.push(d.road(x + i * 100, z - 300, x + i * 100, z + 300, i === 0 ? 'stroad4' : 'twoLane'));
  let zoned = 0;
  const types = ['resLow', 'resHigh', 'comLow', 'industry', 'office', 'comHigh'];
  for (let row = -3; row < 3; row++) for (let col = -3; col < 3; col++) {
    const n = d.zone(x + col * 100 + 50, z + row * 100 + 50, 47, types[(row + col + 12) % types.length]);
    if (typeof n === 'number') zoned += n;
  }
  const showcased = d.showcase(x + 950, z + 950);
  return { x, z, roads, zoned, showcased };
});
console.log('built', JSON.stringify(build));
for (let i = 0; i < 9; i++) {
  const r = await page.evaluate(() => window.__dbg.run(30));
  console.log('day', (i + 1) * 30, JSON.stringify(r));
}
await page.evaluate(({ x, z }) => {
  const g = window.__game, d = window.__dbg;
  g.sim.speed = 0;
  g.hour = 13;
  d.view(x, z, 650, 0.65, 0.72);
}, build);
await page.keyboard.press('F3');
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(6500);
const result = await page.evaluate(() => {
  const g = window.__game;
  g.stop();
  return { preset: g.q.name, fps: g.perf.fps, frameMs: g.perf.frameMs, workMs: g.perf.renderMs,
    calls: g.perf.calls, triangles: g.perf.triangles, resolution: g.perf.resolution,
    buildings: g.buildings.list.size, usedVerts: g.buildings.usedVerts,
    overlay: document.querySelector('.perf-overlay')?.textContent, groundRefillMs: g.groundDetail.lastRefillMs };
});
const png = await page.evaluate(() => { const g = window.__game; g.frame(0.016); return g.renderer.domElement.toDataURL('image/png').split(',')[1]; });
await writeFile(`${out}/town-${preset}-${width}x${height}.png`, Buffer.from(png, 'base64'));
try { await page.screenshot({ path: `${out}/town-${preset}-${width}x${height}-overlay.png`, timeout: 30000 }); } catch (e) { console.log('overlay screenshot failed', e.message); }
console.log('result', JSON.stringify(result));
console.log('errors', JSON.stringify(errors));
await browser.close();
