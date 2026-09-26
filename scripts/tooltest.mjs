// One active tool (desktop). Placing a Sheriff's Office, then switching the
// Services tab, pressing Esc, right-clicking or pressing Cancel must put the
// building away everywhere at once: tool, ghost, tip, badge, highlighted
// card and click handler. A right-drag still orbits without cancelling.
// Repeated clicks place once, and failed placements spend nothing.
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// a small town with room for a sheriff's office, and the camera on that spot
const aim = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services;
  const S = g.startView();
  d.road(S.x - 160, S.z + 40, S.x + 160, S.z + 40, 'twoLane');
  d.zone(S.x - 60, S.z + 75, 50, 'resLow');
  d.run(4);
  for (let r = 60; r < 900; r += 30) for (let a = 0; a < 24; a++) {
    const x = S.x + Math.cos(a * 0.26) * r, z = S.z + Math.sin(a * 0.26) * r;
    if (!SV.canPlace(g, 'sheriff', x, z).ok) continue;
    g.rts.setView(x, z, 320, undefined, undefined, true);
    g.frame(0.016);
    const p = new (g.camera.position.constructor)(x, g.terrain.h(x, z), z).project(g.camera);
    const rc = g.renderer.domElement.getBoundingClientRect();
    return { x: rc.left + ((p.x + 1) / 2) * rc.width, y: rc.top + ((1 - p.y) / 2) * rc.height };
  }
  return null;
});
check('found a valid spot on screen', !!aim, aim);
// software rendering is slow: step frames by hand after each input
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
const settle = () => page.evaluate(() => { const g = window.__game; for (let i = 0; i < 3; i++) g.frame(0.05, false); g.ui.refreshNow(); g.ui.update(0.05); });
const state = () => page.evaluate(() => {
  const g = window.__game, t = g.tools, gh = g.scene.getObjectByName('svc-ghost');
  const bar = document.querySelector('.tool-actions'), tipEl = document.querySelector('#ta-tip');
  return {
    tool: t.active, ext: t.extTool, placing: t.placingLabel, ghost: !!gh?.visible, tip: t.tip?.text ?? '',
    badge: bar && !bar.hidden && tipEl && !tipEl.hidden ? tipEl.textContent : '',
    cardOn: [...document.querySelectorAll('.subpanel .card.on[data-svc]')].map((c) => c.dataset.svc),
    cat: document.querySelector('.svc-cats .chip.on')?.dataset.cat ?? null,
    panelOpen: !document.querySelector('.subpanel').hidden,
    money: Math.round(g.sim.money), n: [...g.buildings.list.values()].filter((b) => b.zone === 'service').length,
  };
});
const clean = (s) => s.tool === 'inspect' && !s.ghost && !s.placing && !s.badge && s.cardOn.length === 0;
const pickSheriff = async () => {
  if (!(await page.isVisible('.svc-cats'))) await page.click('button.tbtn[data-t="ext:services"]');
  await page.click('[data-cat="police"]');
  await page.click('[data-svc="sheriff"]');
  await page.mouse.move(aim.x - 10, aim.y);
  await page.mouse.move(aim.x, aim.y);
  await settle();
};

await pickSheriff();
let s = await state();
check(`picking the Sheriff's Office shows its ghost, badge and card (${s.badge})`, s.tool === 'ext' && s.ghost && /Placing .*Sheriff/.test(s.badge) && s.cardOn.join() === 'sheriff', s);

// the recording at 4:56: switch to Garbage with the sheriff in hand
await page.click('[data-cat="garbage"]');
await settle();
s = await state();
check('switching to the Garbage tab puts the sheriff away (tool, ghost, tip, badge, card)', clean(s) && s.cat === 'garbage' && !/Sheriff/.test(s.tip), s);
const before = await state();
await page.mouse.click(aim.x, aim.y);
await settle();
s = await state();
check('a click on the map afterwards builds nothing and spends nothing', s.n === before.n && s.money === before.money, { before: [before.n, before.money], after: [s.n, s.money] });

// Water → Well tower → Police tab
await page.click('[data-cat="water"]');
await page.click('[data-svc="wellTower"]');
await page.mouse.move(aim.x + 5, aim.y);
await settle();
await page.click('[data-cat="police"]');
await settle();
s = await state();
check('Water tower in hand, then the Police tab: nothing left in hand', clean(s) && s.cat === 'police', s);

// Esc
await pickSheriff();
await page.keyboard.press('Escape');
await settle();
s = await state();
check('Esc puts it away and closes the panel', clean(s) && !s.panelOpen, s);

// right-click (no drag): tool away, panel stays
await pickSheriff();
await page.mouse.click(aim.x, aim.y, { button: 'right' });
await settle();
s = await state();
check('right-click puts it away, panel stays open', clean(s) && s.panelOpen, s);

// right-drag orbits and keeps the tool
await pickSheriff();
const yaw0 = await page.evaluate(() => window.__game.rts.yaw);
await page.mouse.move(aim.x, aim.y);
await page.mouse.down({ button: 'right' });
await page.mouse.move(aim.x + 80, aim.y, { steps: 5 });
await page.mouse.up({ button: 'right' });
await settle();
s = await state();
const yaw1 = await page.evaluate(() => window.__game.rts.goal.yaw);
check('right-drag orbits the camera and keeps the building in hand', s.tool === 'ext' && s.placing && Math.abs(yaw1 - yaw0) > 0.05, { s, yaw0, yaw1 });

// the badge's Cancel button
await page.click('#ta-done');
await settle();
s = await state();
check('the badge’s ✕ Cancel puts it away', clean(s), s);

// rapid clicks at one spot: one building, one charge
await pickSheriff();
const b0 = await state();
for (let i = 0; i < 4; i++) await page.mouse.click(aim.x, aim.y);
await settle();
s = await state();
const cost = await page.evaluate(() => 11000);
check(`four quick clicks at one spot build one office (${s.n - b0.n} service building, ${b0.money - s.money} spent)`, s.n - b0.n === 1 && b0.money - s.money === cost, { before: [b0.n, b0.money], after: [s.n, s.money] });
// undo names what it reverses and gives back exactly what it cost
await settle();
const undoTitle = await page.evaluate(() => document.querySelector('#ta-undo')?.title ?? '');
check(`Undo says what it will reverse ("${undoTitle}")`, /Undo Sheriff's Office \(\+\$11,000 back\)/.test(undoTitle), undoTitle);
const u0 = await state();
await page.keyboard.press('Control+z');
await settle();
const u1 = await state();
check(`Ctrl+Z removes the office and refunds $11,000 (${u0.n}→${u1.n}, +$${u1.money - u0.money})`, u1.n === u0.n - 1 && u1.money - u0.money === 11000, { u0: [u0.n, u0.money], u1: [u1.n, u1.money] });
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
