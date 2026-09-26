// Hovering a need icon over a building says what it needs and how to fix it
// (the review saw rows of yellow icons with no explanation). Exits nonzero
// on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const at = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  // a street cut off from the highway: no utilities reach it
  d.road(S.x - 200, S.z + 500, S.x + 200, S.z + 500, 'twoLane');
  d.zone(S.x, S.z + 530, 120, 'resLow');
  g.sim.demand.res = 80;
  for (let i = 0; i < 30; i++) { d.run(2); if ([...g.buildings.list.values()].some((b) => b.state === 'active' && b.zone === 'resLow')) break; }
  d.run(6);
  const b = [...g.buildings.list.values()].find((b) => b.state === 'active' && b.zone === 'resLow');
  g.rts.setView(b.x, b.z, 160, 0.4, 0.9, true);
  for (let i = 0; i < 6; i++) g.frame(0.05, false);
  g.frame(0.016, true);
  const V = g.camera.position.constructor, rc = g.renderer.domElement.getBoundingClientRect();
  const p = new V(b.x, b.y + b.model.height + 5, b.z).project(g.camera);
  return { x: rc.left + ((p.x + 1) / 2) * rc.width, y: rc.top + ((1 - p.y) / 2) * rc.height, label: b.label };
});
await page.mouse.move(at.x - 60, at.y + 40);
await page.mouse.move(at.x, at.y);
const tip = await page.evaluate(() => { const g = window.__game; g.ui.update(0.3); const t = document.querySelector('.cursor-tip'); return t.hidden ? null : t.textContent; });
check(`hovering the icon names the building and the need ("${tip}")`, !!tip && tip.startsWith(at.label) && /(No electricity|No running water|No sewage|Trash|Sick|crime)/.test(tip) && /Services →/.test(tip), { tip, at });
await page.mouse.move(at.x + 250, at.y + 150);
const away = await page.evaluate(() => { window.__game.ui.update(0.3); const t = document.querySelector('.cursor-tip'); return t.hidden ? null : t.textContent; });
check(`moving off it hides it ("${away}")`, away === null, away);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
