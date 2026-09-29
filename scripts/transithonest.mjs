// The transit panel's money is the budget's money. A bus line's card said
// "Fares $2,704/wk · running $2,433/wk", which reads as a small profit, while
// the budget also charged each depot's $420 a week under "SLOP Transit
// operations" and booked a loss. The panel now ends with the whole network
// (fares, costs with the depot, net) and that net is the budget's; a line that
// can't run (no depot) says so instead of quoting a running cost.
//   playtest 6: the panel and the budget disagreed by the depot's upkeep.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/transithonest.mjs
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

const built = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.transit; cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); } g.syncBlockers();
  d.unlockAll(); g.sim.earn(3e6 - g.sim.money, 'other', 'test funds');
  const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z);
  for (let k = -3; k <= 3; k++) { d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'); d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane'); }
  t.placeDepot(cx + 330, cz + 25);
  const depot = [...g.buildings.list.values()].find((b) => b.kind === 'busDepot'); if (depot) { depot.state = 'active'; depot.progress = 1; }
  d.zone(cx - 170, cz - 170, 150, 'resHigh'); d.zone(cx + 170, cz + 170, 150, 'resHigh'); d.zone(cx, cz, 90, 'comHigh'); d.zone(cx + 170, cz - 170, 120, 'industry');
  d.run(120);
  [[cx - 240, cz], [cx - 60, cz], [cx + 120, cz]].forEach(([x, z]) => t.addDraftPoint(x, z));
  t.finishDraft();
  const line = [...t.lines.values()][0]; if (line) line.buses = 3;
  d.run(28);
  return { lines: t.lines.size, depots: t.depots().length };
});
check(built.lines === 1 && built.depots === 1, `a depot and one line, run for four weeks (${built.lines} line, ${built.depots} depot)`);

const read = () => page.evaluate(() => {
  const g = window.__game, t = g.transit, el = document.createElement('div');
  t.renderPanel(el, () => {});
  const num = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
  const net = el.querySelector('[data-network]');
  const f = g.sim.forecastWeek();
  const ops = f.lines.filter((x) => x.kind === 'transit').reduce((n, x) => n + x.amount, 0); // income +, costs − ("SLOP Transit operations −2,853", "Bus fares +2,704")
  const m = net?.textContent.match(/fares \$([\d,]+)\/wk . costs \$([\d,]+)\/wk .* = ([−+])\$([\d,]+)\/wk/);
  return { text: net?.textContent.replace(/\s+/g, ' ') ?? null, fares: m ? num(m[1]) : null, costs: m ? num(m[2]) : null, netPanel: m ? (m[3] === '−' ? -1 : 1) * num(m[4]) : null, netBudget: Math.round(ops), idle: [...el.querySelectorAll('[data-idle]')].map((x) => x.textContent), drift: g.sim.ledgerDrift };
});
let s = await read();
console.log('  ', s.text);
check(s.text !== null, 'the panel ends with a whole-network row');
check(s.netPanel !== null && Math.abs(s.netPanel - s.netBudget) <= 1, `its net (${s.netPanel}) is the budget's transit net (${s.netBudget})`);
check(s.costs !== null && /1 depot × \$420/.test(s.text ?? ''), 'it names the depot upkeep the line cards leave out');

// the depot goes: the line can't run, says so, and the network costs nothing
const gone = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  for (const b of [...g.buildings.list.values()]) if (b.kind === 'busDepot') g.buildings.demolish(b, 'bulldozed');
  d.run(14);
  return true;
});
s = await read();
check(s.idle.length === 1 && /depot/.test(s.idle[0]), `without a depot the line says it is not running (${JSON.stringify(s.idle)})`);
check(s.netPanel !== null && Math.abs(s.netPanel - s.netBudget) <= 1, `and the network net still matches the budget (${s.netPanel} vs ${s.netBudget})`);
check(Math.abs(s.drift) <= 1, `the ledger balances (drift ${s.drift})`);

await browser.close();
if (errs.length) { console.log('page errors:', JSON.stringify(errs.slice(0, 3))); fails.push('page errors'); }
if (fails.length) { console.log(`FAIL: ${fails.length} problems`); process.exit(1); }
console.log('OK: the transit panel and the budget agree');
