// A bus line whose road is cut between its stops. Bulldozing a road that
// carries a stop takes the line with it (the tool says so first). Bulldozing a
// road the line merely drives over left the line standing with no way through:
// 0 riders, "∞ min headway", and still billed $135 a bus a week, with no word
// to the player about why. Now the line stops (and stops costing), says so
// once, says why on its card, and runs again when the road is rebuilt.
//   playtest 6: a line with no route kept its buses on the payroll.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/transitcut.mjs
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game?.transit && window.__dbg, null, { timeout: 300000 });
const fails = [];
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  ✗  ', msg); if (!ok) fails.push(msg); };

// five 100 m pieces in a row; stops on the first and last; homes at one end, shops at the other
const setup = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.transit; cancelAnimationFrame(g.raf);
  window.__toasts = []; const tt = g.toast.bind(g); g.toast = (m, ...r) => { window.__toasts.push(String(m)); return tt(m, ...r); };
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); } g.syncBlockers();
  d.unlockAll(); g.sim.earn(3e6 - g.sim.money, 'other', 'test funds');
  const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z);
  const xs = [-250, -150, -50, 50, 150, 250];
  for (let i = 0; i < 5; i++) d.road(cx + xs[i], cz, cx + xs[i + 1], cz, 'twoLane');
  let placed = false;
  for (const [dx, dz] of [[-10, 40], [-10, -40], [100, 40], [100, -40], [-100, 40], [200, 40]]) if (!placed && t.canPlaceDepot(cx + dx, cz + dz).ok) placed = t.placeDepot(cx + dx, cz + dz);
  const depot = [...g.buildings.list.values()].find((b) => b.kind === 'busDepot'); if (depot) { depot.state = 'active'; depot.progress = 1; }
  // (and a factory between: with no goods the shops have no jobs, and nobody rides; the
  // demand bars used to keep adding bare shops, which is where the riders came from)
  d.zone(cx - 200, cz, 90, 'resHigh'); d.zone(cx + 200, cz, 90, 'comHigh'); d.zone(cx, cz, 45, 'industry');
  d.run(150);
  const ok = t.addDraftPoint(cx - 200, cz) && t.addDraftPoint(cx + 200, cz) && t.finishDraft();
  const line = [...t.lines.values()][0]; if (line) line.buses = 3;
  d.run(28);
  return { placed, ok, cx, cz };
});
check(setup.placed && setup.ok, `a depot and a two-stop line along one road (${JSON.stringify({ depot: setup.placed, line: setup.ok })})`);

const state = () => page.evaluate(() => {
  const g = window.__game, t = g.transit, l = [...t.lines.values()][0], el = document.createElement('div');
  t.renderPanel(el, () => {});
  const b = t.bill();
  return { lines: t.lines.size, loop: l ? Math.round(l.loopLength) : null, last: l?.lastWeekRiders ?? 0, buses: b.buses, upkeep: Math.round(b.upkeep), idle: [...el.querySelectorAll('[data-idle]')].map((x) => x.textContent), toasts: window.__toasts.slice(), drift: g.sim.ledgerDrift };
});
let s = await state();
check(s.lines === 1 && s.loop > 0 && s.last > 0 && s.buses === 3, `it runs: loop ${s.loop} m, ${s.last} riders last week, ${s.buses} buses billed`);

// cut the road between the stops (no stop on those pieces)
await page.evaluate(({ cx, cz }) => {
  const g = window.__game, d = window.__dbg;
  window.__cut = [...g.net.segs.values()].filter((sg) => Math.abs(sg.samp.pts[0].z - cz) < 3 && Math.abs(sg.samp.pts.at(-1).z - cz) < 3 && Math.abs((sg.samp.pts[0].x + sg.samp.pts.at(-1).x) / 2 - cx) < 80).map((sg) => ({ a: sg.samp.pts[0], b: sg.samp.pts.at(-1) }));
  for (const sg of [...g.net.segs.values()]) if (window.__cut.some((c) => c.a.x === sg.samp.pts[0].x && c.b.x === sg.samp.pts.at(-1).x)) g.bulldozeRoad(sg);
  d.run(28);
}, setup);
s = await state();
check(s.lines === 1, `the line is still there (${s.lines}): its stops weren't on the pieces that went`);
check(s.idle.length === 1 && /road between its stops is gone/.test(s.idle[0]), `its card says why it isn't running ("${(s.idle[0] || '').slice(0, 90)}")`);
check(s.buses === 0 && s.upkeep === 420, `the buses that can't go anywhere aren't billed: ${s.buses} buses, $${s.upkeep}/wk (just the depot's $420)`);
check(s.toasts.filter((m) => /can't run: a road between its stops is gone/.test(m)).length === 1, `the player is told once, when it happens (${s.toasts.filter((m) => /road between/.test(m)).length} message)`);

// rebuild the road: the line runs again
await page.evaluate(({ cx, cz }) => { const d = window.__dbg; for (const c of window.__cut) d.road(c.a.x, c.a.z, c.b.x, c.b.z, 'twoLane'); d.run(28); }, setup);
s = await state();
check(s.loop > 0 && s.buses === 3 && s.idle.length === 0, `road rebuilt: it runs again (loop ${s.loop} m, ${s.buses} buses billed)`);
check(s.toasts.some((m) => /has a way through again/.test(m)), 'and the player is told it is back');
check(s.last > 0, `and riders come back (${s.last} last week)`);
check(Math.abs(s.drift) <= 1, `the ledger balances (drift ${s.drift})`);

await browser.close();
if (errs.length) { console.log('page errors:', JSON.stringify(errs.slice(0, 3))); fails.push('page errors'); }
if (fails.length) { console.log(`FAIL: ${fails.length} problems`); process.exit(1); }
console.log('OK: a cut bus line stops, says why, stops costing, and returns with its road');
