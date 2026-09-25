// Right-click / double-click ends a road; zoning doesn't paint over other zones.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5173/#skip&map=florida&mode=sandbox', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 120000 });
await page.evaluate(() => document.querySelector('.onboard button, .onboarding button')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => { const g = window.__game, S = g.startView(); window.__dbg.view(S.x, S.z, 500, 0.5, 1.1); g.tools.set('road'); });
await page.waitForTimeout(1500);
const st = () => page.evaluate(() => ({ drawing: window.__game.tools.drawing, segs: window.__game.net.segs.size }));
const r = {};
await page.mouse.click(420, 350); await page.waitForTimeout(400);
r.afterStart = await st();
await page.mouse.click(600, 360); await page.waitForTimeout(600);
r.afterSegment = await st();
await page.mouse.click(600, 360, { button: 'right' }); await page.waitForTimeout(400);
r.afterRightClick = await st();
// right-drag should still orbit and not break anything
await page.mouse.click(420, 450); await page.waitForTimeout(400);
r.restarted = await st();
await page.mouse.click(620, 460); await page.waitForTimeout(120);
await page.mouse.click(620, 460); await page.waitForTimeout(500);
r.afterDoubleClick = await st();
// zoning
r.zone = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  const cells = g.zones.cellsNear(S.x, S.z, 400).filter((c) => c.valid && !c.bld);
  const c = cells[0];
  if (!c) return 'no cells';
  d.zone(c.x, c.z, 12, 'resLow');
  const was = c.zone;
  d.zone(c.x, c.z, 12, 'industry');
  const after = c.zone;
  g.zones.paint(c.x, c.z, 12, null);
  const cleared = c.zone;
  d.zone(c.x, c.z, 12, 'industry');
  return { was, afterPaintOver: after, afterDezone: cleared, afterRezone: c.zone };
});
console.log(JSON.stringify(r));
console.log(errs.join('\n'));
await browser.close();
