// Honest service costs and guidance (playtest 5): the placing tip counts a
// building's running cost at today's use, not just its upkeep, and what's
// already under construction; the inspector says when a new one opens and what
// it will cost, and multiplies running costs out (683 kL/day × $0.05 × 7
// days); a problem the town can't fix yet names the milestone that unlocks the
// fix; an overloaded station comes before zoning tips in Next; lots that have
// sat zoned and empty for a month don't keep Next saying "wait"; a full
// landfill whose trash the other sites handle is news, not an emergency; and a
// road preview outlines the buildings it would bulldoze. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });

// a small town (no milestones yet), and a problem it can't fix yet
const early = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, S = g.startView();
  cancelAnimationFrame(g.raf);
  g.sim.earn(1e6 - g.sim.money, 'other', 'Test funds');
  g.net.allowed = null; g.zones.allowed = null;
  for (let k = -2; k <= 2; k++) { d.road(S.x - 180, S.z + k * 80, S.x + 180, S.z + k * 80); d.road(S.x + k * 90, S.z - 170, S.x + k * 90, S.z + 170); }
  d.road(S.x, S.z, S.x + 10, S.z + 10);
  d.zone(S.x - 60, S.z, 150, 'resLow'); d.zone(S.x + 120, S.z + 40, 60, 'comLow');
  d.run(40);
  const home = [...g.buildings.list.values()].find((b) => b.zone === 'resLow' && b.state === 'active');
  if (!home) return { err: 'no homes' };
  const bs = SV.S.b.get(home.id);
  if (bs) bs.crime = 90;
  const text = SV.problemText(g, home.id) ?? '';
  if (bs) bs.crime = 0;
  return { pop: g.sim.population, text };
});
console.log(JSON.stringify(early));
check(`a problem the town can't fix yet names the milestone ("${(early.text ?? '').slice(-110)}")`, /Sheriff's Office unlocks at 350 people \(Census-Designated Place\)/.test(early.text ?? ''), early);

// placing a clinic: its running cost at today's use; then what's being built
const clinic = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, S = g.startView();
  d.unlockAll();
  d.run(20);
  let sp = null;
  for (let r = 40; r < 400 && !sp; r += 30) for (let a = 0; a < 16 && !sp; a++) { const s = SV.findSpot(g, 'clinic', S.x + Math.cos(a * 0.39) * r, S.z + Math.sin(a * 0.39) * r); if (!s.reason) sp = s; }
  if (!sp) return { err: 'no clinic spot' };
  const est = SV.estimateRun(g, 'clinic', sp.x, sp.z);
  const before = g.sim.forecastWeek().net;
  const b = SV.place(g, 'clinic', sp.x, sp.z, sp.yaw);
  const com = SV.committedServices(g);
  g.select({ kind: 'building', b }); g.ui.update(0.3);
  const building = document.querySelector('.inspector')?.textContent ?? '';
  g.select(null);
  // open it and compare the bill with the estimate
  for (let i = 0; i < 40 && b.state !== 'active'; i++) d.run(1);
  d.run(3);
  const actual = SV.runningCosts(g).get(b.id) ?? 0;
  g.select({ kind: 'building', b }); g.ui.update(0.3);
  const open = document.querySelector('.inspector')?.textContent ?? '';
  g.select(null);
  return { pop: g.sim.population, est, com, before: Math.round(before), building, open, actual: Math.round(actual), state: b.state };
});
console.log(JSON.stringify({ ...clinic, building: clinic.building?.slice(0, 200), open: clinic.open?.slice(0, 200) }));
check(`the clinic's running cost is estimated at today's use (≈$${Math.round(clinic.est?.perWk ?? 0)}/wk: ${clinic.est?.how})`, !!clinic.est && clinic.est.perWk > 0 && /people in reach × \$0\.08/.test(clinic.est.how), clinic);
check(`what's being built is counted ($${Math.round(clinic.com?.perWk ?? 0)}/wk for ${clinic.com?.n})`, clinic.com?.n === 1 && Math.abs(clinic.com.perWk - (130 + (clinic.est?.perWk ?? 0))) < 1, clinic.com);
check('under construction, the inspector says when it opens and what it will cost', /Opens in~?\s*~?\d+ days?/.test(clinic.building.replace(/\s+/g, ' ')) && /Then costs\s*\$130\/wk \+ ≈\$\d+\/wk running/.test(clinic.building), clinic.building.slice(0, 300));
check(`open, the bill is near the estimate ($${clinic.actual}/wk vs ≈$${Math.round(clinic.est?.perWk ?? 0)})`, clinic.state === 'active' && clinic.actual > 0 && Math.abs(clinic.actual - clinic.est.perWk) <= Math.max(15, clinic.est.perWk * 0.6), clinic);
check('and multiplied out in the inspector', /Running cost\s*\$\d+\/wk\s*\([\d,]+ people served × \$0\.08\)/.test(clinic.open), clinic.open.slice(0, 300));

// the placing tip says all of it (through the real tool)
const aim = await page.evaluate(() => {
  const g = window.__game, SV = window.__services, S = g.startView();
  for (let r = 60; r < 500; r += 30) for (let a = 0; a < 16; a++) {
    const x = S.x + Math.cos(a * 0.39) * r, z = S.z + Math.sin(a * 0.39) * r;
    if (!SV.canPlace(g, 'wellTower', x, z).ok) continue;
    g.rts.setView(x, z, 300, undefined, undefined, true); g.frame(0.016);
    const p = new (g.camera.position.constructor)(x, g.terrain.h(x, z), z).project(g.camera), rc = g.renderer.domElement.getBoundingClientRect();
    return { x: rc.left + ((p.x + 1) / 2) * rc.width, y: rc.top + ((1 - p.y) / 2) * rc.height };
  }
  return null;
});
await page.click('button.tbtn[data-t="ext:services"]');
await page.click('[data-cat="water"]');
await page.click('[data-svc="wellTower"]');
await page.mouse.move(aim.x - 8, aim.y); await page.mouse.move(aim.x, aim.y);
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 3; i++) g.frame(0.05, false); });
const tip = await page.evaluate(() => window.__game.tools.tip?.text ?? '');
check(`the placing tip counts running cost in kL/day and the budget after it ("${tip.slice(0, 170)}…")`, /\+ ≈\$\d+\/wk running \([\d,]+ kL\/day × \$0\.05 × 7 days\)/.test(tip) && /→/.test(tip), tip);
await page.keyboard.press('Escape');

// guidance: an overloaded station comes before zoning tips; month-old empty lots don't say "wait"
const guide = await page.evaluate(() => {
  const g = window.__game, SV = window.__services;
  const fire = [...g.buildings.list.values()].find((b) => b.kind === 'fireStation');
  let over = null;
  const S = g.startView();
  let f = fire;
  if (!f) { let sp = null; for (let r = 40; r < 400 && !sp; r += 30) for (let a = 0; a < 16 && !sp; a++) { const s = SV.findSpot(g, 'fireStation', S.x + Math.cos(a * 0.39) * r, S.z + Math.sin(a * 0.39) * r); if (!s.reason) sp = s; } f = sp && SV.place(g, 'fireStation', sp.x, sp.z, sp.yaw); if (f) { f.state = 'active'; f.progress = 1; } }
  if (f) { SV.S.f.get(f.id) ?? SV.S.f.set(f.id, { stored: 0, load: 0, quality: 1, out: 0, contaminated: false, full: false, rate: 0, warned: 0 }); SV.S.f.get(f.id).load = 311; over = g.ui.nextAction().text; SV.S.f.get(f.id).load = 0; }
  // every shop lot zoned a month ago and still empty
  g.sim.demand.com = 60;
  const cells = g.zones.candidates('comLow');
  const day = Math.floor(g.sim.day);
  for (const c of cells) g.ui.lotSeen.set(c.id, day - 40);
  const stale = cells.length ? g.ui.nextAction().text : 'no shop lots';
  return { over, stale, shopLots: cells.length };
});
console.log(JSON.stringify(guide));
check(`an overloaded station comes first in Next ("${guide.over}")`, /overloaded \(311 of 260\)/.test(guide.over ?? ''), guide);
check(`lots empty for a month don't keep Next saying "wait" ("${guide.stale.slice(0, 140)}")`, guide.shopLots === 0 || (!/^Wait: builders are putting up shops/.test(guide.stale)), guide);

// a full landfill whose trash the other site handles is news, not an emergency
const lf = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, S = g.startView();
  const spots = [];
  for (let r = 150; r < 900 && spots.length < 2; r += 40) for (let a = 0; a < 16 && spots.length < 2; a++) {
    const s = SV.findSpot(g, 'landfill', S.x + Math.cos(a * 0.39) * r, S.z + Math.sin(a * 0.39) * r);
    if (!s.reason && !spots.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 120)) spots.push(s);
  }
  if (spots.length < 2) return { err: 'no landfill spots' };
  const [a, b] = spots.map((s) => SV.place(g, 'landfill', s.x, s.z, s.yaw));
  for (const x of [a, b]) { x.state = 'active'; x.progress = 1; }
  d.run(3);
  const fs = SV.S.f.get(a.id);
  fs.stored = 9000 - 0.01;
  const n0 = g.sim.alerts.length;
  d.run(3);
  return { made: SV.S.garbage.made, alerts: g.sim.alerts.slice(n0).map((x) => `${x.level}: ${x.text}`) };
});
console.log(JSON.stringify(lf));
const lfAlert = (lf.alerts ?? []).find((x) => /full \(9,000 t\)/.test(x)) ?? '';
check(`a full landfill with another site taking the trash is an info note ("${lfAlert.slice(0, 120)}")`, /^info: .*your other sites .* handle the town's/.test(lfAlert), lf);

// the garbage dashboard: one row per site, the full one says so, a row selects its site
await page.evaluate(() => document.querySelector('button.tbtn[data-t="ext:services"]')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('[data-cat="garbage"]')?.click());
await page.waitForTimeout(200);
const gb = await page.evaluate(() => {
  const g = window.__game;
  const rows = [...document.querySelectorAll('.gb-row')];
  const texts = rows.map((r) => r.textContent.replace(/\s+/g, ' '));
  rows[0]?.click();
  const sel = g.selection?.kind === 'building' ? g.selection.b : null;
  return { texts, total: document.querySelector('.gb-total')?.textContent ?? '', selected: sel ? `${sel.kind} ${sel.id}` : null, first: rows[0]?.dataset.goto };
});
console.log(JSON.stringify(gb).slice(0, 600));
check(`the garbage dashboard lists every site ("${(gb.texts.find((t) => /full: trucks stopped/.test(t)) ?? gb.texts[0] ?? '').slice(0, 100)}")`, gb.texts.length >= 2 && gb.texts.some((t) => /full: trucks stopped/.test(t)) && gb.texts.some((t) => /% of 9,000 t/.test(t) && /t\/day from \d+ building/.test(t)) && /Town makes/.test(gb.total), gb);
check(`clicking a row selects that site (${gb.selected})`, gb.selected === `landfill ${gb.first}`, gb);

// a road preview outlines the buildings it would bulldoze
const raze = await page.evaluate(() => {
  const g = window.__game, t = g.tools, V = g.camera.position.constructor;
  const S = g.startView();
  t.roadType = 'twoLane'; t.roadMode = 'straight'; t.set('road');
  const ev = { pointerType: 'mouse', button: 0, timeStamp: 1e6 };
  // a new cross street through a home, from its street to the next one (the
  // town's east-west streets are 80 m apart, north-south ones 90 m)
  let shown = 0;
  const tried = [];
  const homes = [...g.buildings.list.values()].filter((b) => b.zone === 'resLow' && b.state === 'active');
  for (const h of homes) {
    const gx = (h.x - S.x) / 90;
    if (Math.abs(gx - Math.round(gx)) * 90 < 20) continue; // too near a north-south street
    const z0 = S.z + 80 * Math.floor((h.z - S.z) / 80);
    const a = new V(h.x, 0, z0), b = new V(h.x, 0, z0 + 80);
    a.y = g.terrain.h(a.x, a.z); b.y = g.terrain.h(b.x, b.z);
    t.set('road');
    t.hover = a; t.up(a, ev, false);
    t.hover = b; t.update();
    shown = t.razeGroup.children.filter((m) => m.visible).length;
    tried.push((t.tip?.text ?? '').slice(0, 60));
    if (shown) break;
    if (tried.length > 12) break;
  }
  const text = t.tip?.text ?? '';
  t.set('inspect'); t.update();
  const after = t.razeGroup.children.filter((m) => m.visible).length;
  return { text, shown, after, tried: tried.length, why: shown ? undefined : tried };
});
console.log(JSON.stringify(raze));
check(`a road through homes outlines them in red, with who lives there ("${(raze.text ?? '').match(/⚠️[^·]*/)?.[0] ?? raze.text}")`, raze.shown >= 1 && /outlined in red/.test(raze.text ?? '') && raze.after === 0, raze);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
