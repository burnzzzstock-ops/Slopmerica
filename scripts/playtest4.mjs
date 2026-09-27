// Round 4 (Codex's first-five-minutes review and the user's screenshots):
// a persistent "Next" line walks a new town through its first steps and then
// follows demand, with a button that does the step and the next unlock;
// demand wording separates "no lots zoned yet" from "every zoned lot has a
// building"; the road preview gives the weekly balance change; H (or the
// town's name) flies back to town; the desktop toolbar leads with the
// building tools and keeps the rest under More; notices stack at the right;
// the feed peeks at one post. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.removeItem('slopmerica.firstSteps'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const tick = () => page.evaluate(() => { const g = window.__game; for (let i = 0; i < 3; i++) g.frame(0.05, false); g.time += 2; g.ui.update(0.5); });
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
await tick();

const bar = () => page.evaluate(() => { const b = document.querySelector('.next-bar'); return b && !b.hidden ? { text: b.querySelector('.nb-step')?.textContent ?? '', act: b.querySelector('.chip')?.dataset.act ?? null, unlock: b.querySelector('.nb-unlock')?.textContent ?? '' } : null; });
const b1 = await bar();
check(`a new town gets step 1 with a button ("${b1?.text}")`, !!b1 && /^Step 1\/5/.test(b1.text) && b1.act === 'road', b1);

// a street off the county road: step 2 is homes, and its button starts zoning homes
const street = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  const end = [...g.net.nodes.values()].filter((n) => n.segs.length === 1).sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[0];
  d.road(end.x, end.z, end.x + 160, end.z + 20, 'twoLane');
  return { x: end.x + 80, z: end.z + 10 };
});
await tick();
const b2 = await bar();
check(`after the street, step 2 is homes ("${b2?.text}")`, !!b2 && /^Step 2\/5/.test(b2.text) && b2.act === 'zone:resLow', b2);
await page.click('.next-bar .chip');
const z = await page.evaluate(() => ({ tool: window.__game.tools.active, zone: window.__game.tools.zoneType, drawer: !document.querySelector('.subpanel').hidden }));
check(`its button starts zoning homes with the drawer open (${JSON.stringify(z)})`, z.tool === 'zone' && z.zone === 'resLow' && z.drawer, z);
await page.keyboard.press('Escape');

// demand wording: none zoned yet vs every zoned lot built
const words = await page.evaluate(() => {
  const g = window.__game, s = g.sim;
  s.demand.res = 60; s.demand.com = -20; s.demand.ind = -20; s.demand.off = -20;
  const none = g.ui.nextAction().text;
  return { none };
});
check(`with no home lots zoned it says so, and counts unzoned lots separately ("${words.none}")`, /no lots are zoned for homes yet/.test(words.none) && /\d+ unzoned lots line your roads/.test(words.none) && !/is taken/.test(words.none), words);

// road preview: weekly balance change (sandbox has no weekly bill, so check in text form on a ponzi-like sim)
const tip = await page.evaluate(({ x, z }) => {
  const g = window.__game, t = g.tools, V = g.camera.position.constructor;
  g.sim.money = 50000; // a finite treasury, so the preview can talk about the week
  const ev = (type, ts) => ({ button: 0, pointerType: 'mouse', timeStamp: ts, type, shiftKey: false });
  t.roadType = 'twoLane'; t.roadMode = 'straight'; t.set('road');
  const P = (x, z) => new V(x, g.terrain.h(x, z), z);
  t.move(P(x, z + 60), ev('pointermove', 1000), false);
  t.down(P(x, z + 60), ev('pointerdown', 1000)); t.up(P(x, z + 60), ev('pointerup', 1000), false);
  t.move(P(x + 90, z + 70), ev('pointermove', 2000), false); t.update();
  const text = t.tip?.text ?? '';
  t.cancel(); t.set('inspect');
  return text;
}, street);
check(`the road preview gives the weekly balance change ("${tip}")`, /weekly [+−]\$[\d,]+ → [+−]\$[\d,]+/.test(tip), tip);

// H flies back to town
const home = await page.evaluate(() => {
  const g = window.__game;
  g.rts.setView(g.rts.target.x + 1500, g.rts.target.z + 1500, 600, g.rts.yaw, 0.8, true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
  let x = 0, z = 0, n = 0; for (const b of g.buildings.list.values()) { x += b.x; z += b.z; n++; }
  const S = g.startView(); if (n) { x /= n; z /= n; } else { x = S.x; z = S.z; }
  return { d: Math.round(Math.hypot(g.rts.goal.target.x - x, g.rts.goal.target.z - z)), label: document.querySelector('#tb-home')?.title };
});
check(`H flies back to town (${home.d} m from its middle; name says "${home.label}")`, home.d < 5 && /Back to town/.test(home.label ?? ''), home);

// toolbar, notices, feed
const ui = await page.evaluate(() => {
  const g = window.__game;
  const ids = [...document.querySelectorAll('.toolbar button.tbtn')].map((b) => b.dataset.t);
  g.toast('A test notice');
  const t = document.querySelector('.toasts .toast:last-child')?.getBoundingClientRect();
  const feed = document.querySelector('.xfeed');
  const shown = [...document.querySelectorAll('.xfeed .xpost')].filter((p) => getComputedStyle(p).display !== 'none').length;
  return { ids, toastRight: t ? Math.round(innerWidth - t.right) : null, toastLeft: t ? Math.round(t.left) : null, W: innerWidth, peek: feed?.classList.contains('peek'), shown };
});
check(`the desktop toolbar leads with the building tools and puts the rest under More (${ui.ids.length}: ${ui.ids.join(' ')})`, ui.ids.length <= 12 && ['roads', 'zones', 'ext:services', 'more'].every((x) => ui.ids.includes(x)) && !ui.ids.includes('communes'), ui.ids);
check(`notices stack at the right (${ui.toastRight} px from the right edge)`, ui.toastRight !== null && ui.toastRight < 40 && ui.toastLeft > ui.W / 2, ui);
check(`the feed opens as a peek at the newest post (${ui.shown} shown)`, ui.peek === true && ui.shown <= 1, ui);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
