// Road rules say the rule first and the way out: a road across a commune
// names it as commune land with the pay-off and lawsuit prices, builds
// nothing, spends nothing, and opens the commune (where those buttons are).
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// look at a non-forever commune from above; screen points either side of it
const setup = await page.evaluate(() => {
  const g = window.__game;
  cancelAnimationFrame(g.raf);
  const c = g.communes.list.find((x) => x.state === 'active' && !x.forever);
  if (!c) return null;
  g.rts.setView(c.x, c.z, 260, 0, 1.3, true);
  g.frame(0.016);
  const V = g.camera.position.constructor, rc = g.renderer.domElement.getBoundingClientRect();
  const scr = (x, z) => { const p = new V(x, g.terrain.h(x, z), z).project(g.camera); return { x: rc.left + ((p.x + 1) / 2) * rc.width, y: rc.top + ((1 - p.y) / 2) * rc.height }; };
  const off = c.r + 45;
  return { name: c.name, a: scr(c.x - off, c.z), b: scr(c.x + off, c.z), segs: g.net.segs.size, money: g.sim.money };
});
check('found a commune to test against', !!setup, setup);
const step = () => page.evaluate(() => { const g = window.__game; g.frame(0.05, false); g.ui.update(0.05); });
await page.evaluate(() => { const g = window.__game; g.tools.roadMode = 'straight'; g.tools.roadType = 'twoLane'; g.tools.set('road'); });
await page.mouse.click(setup.a.x, setup.a.y);
await page.mouse.move(setup.b.x - 20, setup.b.y);
await page.mouse.move(setup.b.x, setup.b.y);
await step();
const tip = await page.evaluate(() => window.__game.tools.tip?.text ?? '');
check(`preview names the rule and both ways out ("${tip}")`, new RegExp(`^Commune land: roads can’t cross ${setup.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`).test(tip) && /Pay them off \$[\d,]+ \(\d+% chance\)/.test(tip) && /sue \$[\d,]+ \(\d+%, 20 days\)/.test(tip), tip);
await page.mouse.click(setup.b.x, setup.b.y);
await step();
const after = await page.evaluate(() => { const g = window.__game; return { segs: g.net.segs.size, money: g.sim.money, sel: g.selection?.kind === 'commune' ? g.selection.c.name : null, inspector: document.querySelector('.inspector')?.textContent ?? '' }; });
check('clicking anyway builds nothing and spends nothing', after.segs === setup.segs && after.money === setup.money, { before: [setup.segs, setup.money], after: [after.segs, after.money] });
check(`and opens ${setup.name}, with Pay off and Sue (and what happens if they fail)`, after.sel === setup.name && /Pay off \$/.test(after.inspector) && /Sue \$/.test(after.inspector) && /dig in/.test(after.inspector), { sel: after.sel, txt: after.inspector.slice(0, 200) });

check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
