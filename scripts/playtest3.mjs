// Third playtest report (Growth Ponzi, Holler County, bankrupt at 190
// residents): the county road the map starts with no longer bills the town;
// a road's preview says what it commits you to (upkeep now and aged, trees,
// homes, whether it connects) and undo puts the trees back; demand says what
// to do next with lot and job counts; the budget shows aging road costs and
// the way to break even; the meters card lists nearer goals. Exits nonzero on
// failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); });
await page.goto(`${base}/#skip&map=appalachia&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, s = g.sim, t = g.tools, net = g.net;
  cancelAnimationFrame(g.raf);
  const start = s.forecastWeek();
  const county = [...net.segs.values()].filter((q) => q.name === 'Old County Road');
  const countyLen = Math.round(county.reduce((a, q) => a + q.length, 0));
  // a street through the woods off the county road's town end, drawn with the tool
  const S = g.startView();
  const end = [...net.nodes.values()].filter((n) => n.segs.length === 1).sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[0];
  const V = g.camera.position.constructor;
  const P = (x, z) => new V(x, g.terrain.h(x, z), z);
  const ev = (type, ts) => ({ button: 0, pointerType: 'mouse', timeStamp: ts, type, shiftKey: false });
  // find a wooded direction from the end
  let best = null;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2, x = end.x + Math.cos(ang) * 180, z = end.z + Math.sin(ang) * 180;
    const pts = []; for (let k = 0; k <= 45; k++) pts.push({ x: end.x + (x - end.x) * k / 45, z: end.z + (z - end.z) * k / 45 });
    const n = g.trees.countAlong(pts, 8);
    const plan = net.plan(net.snap(end.x, end.z), { p0: { x: end.x, z: end.z }, p1: { x: end.x, z: end.z }, p2: { x, z }, p3: { x, z } }, 'twoLane');
    if (plan.ok && (!best || n > best.n)) best = { x, z, n };
  }
  t.roadType = 'twoLane'; t.roadMode = 'straight'; t.set('road');
  t.move(P(end.x, end.z), ev('pointermove', 1000), false);
  t.down(P(end.x, end.z), ev('pointerdown', 1000)); t.up(P(end.x, end.z), ev('pointerup', 1000), false);
  t.move(P(best.x, best.z), ev('pointermove', 2000), false); t.update();
  const tip = t.tip?.text ?? '';
  const aliveBefore = g.trees.alive;
  t.down(P(best.x, best.z), ev('pointerdown', 9000)); t.up(P(best.x, best.z), ev('pointerup', 9000), false);
  const aliveAfterBuild = g.trees.alive;
  t.cancel(); t.set('inspect');
  g.undo();
  const toasts = [...document.querySelectorAll('.toasts .toast')].map((e) => e.textContent);
  const aliveAfterUndo = g.trees.alive;
  // a road out in the middle of nowhere says it isn't connected
  t.set('road');
  // somewhere we own, well away from every road
  let fx = S.x, fz = S.z;
  for (let k = 0; k < 400; k++) {
    const x = S.x + ((k % 20) - 10) * 40, z = S.z + (Math.floor(k / 20) - 10) * 40;
    if (net.segsNear(x - 60, z - 60, x + 180, z + 60).length) continue;
    const cub = { p0: { x, z }, p1: { x: x + 40, z }, p2: { x: x + 80, z }, p3: { x: x + 120, z } };
    if (net.plan({ kind: 'free', x, z }, cub, 'twoLane').ok) { fx = x; fz = z; break; }
  }
  t.move(P(fx, fz), ev('pointermove', 20000), false);
  t.down(P(fx, fz), ev('pointerdown', 20000)); t.up(P(fx, fz), ev('pointerup', 20000), false);
  t.move(P(fx + 120, fz), ev('pointermove', 21000), false); t.update();
  const lonely = t.tip?.text ?? '';
  t.cancel(); t.set('inspect');
  // widening the county road: the town pays only the difference
  const before = net.upkeep();
  const seg = county[county.length - 1];
  net.upgrade(seg.id, 'stroad6');
  const widened = net.upkeep() - before;
  return { start: start.net, startLines: start.lines.map((l) => `${l.label} ${l.amount}`), countyLen, tip, trees: best.n, aliveBefore, aliveAfterBuild, aliveAfterUndo, undoToast: toasts[toasts.length - 1] ?? '', lonely, widened: Math.round(widened), segLen: Math.round(seg.length) };
});
console.log(JSON.stringify(r));
check(`a new county costs nothing a week before you build (${r.start}/wk; ${r.countyLen} m of Old County Road is the state's)`, r.start === 0, r.startLines);
check(`widening the county road bills only the extra lanes (+$${r.widened}/wk for ${r.segLen} m)`, r.widened > 0 && r.widened < r.segLen * 1.0, r);
check(`the road preview says upkeep, aged upkeep, trees and what it joins ("${r.tip}")`, /\+\$\d+\/wk upkeep \(→ \$\d+\/wk as it ages\)/.test(r.tip) && /clears ~\d+ trees?/.test(r.tip) && /joins Old County Road/.test(r.tip), r.tip);
check(`building it clears trees (${r.aliveBefore} → ${r.aliveAfterBuild})`, r.aliveAfterBuild < r.aliveBefore, r);
check(`undo puts them back (${r.aliveAfterUndo}; "${r.undoToast}")`, r.aliveAfterUndo === r.aliveBefore && /trees replanted/.test(r.undoToast), r);
check(`a road touching nothing says so ("${r.lonely}")`, /not connected to any road/.test(r.lonely), r.lonely);

// demand: counts and a next step; budget outlook; goals
const ui = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, s = g.sim, S = g.startView();
  const end = [...g.net.nodes.values()].filter((n) => n.segs.length === 1).sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[0];
  d.road(end.x, end.z, end.x + 200, end.z + 10, 'twoLane');
  d.zone(end.x + 100, end.z + 30, 40, 'resLow');
  d.run(20);
  g.ui.openDemand('res'); g.ui.update(0.3);
  const card = document.querySelector('.demand-pop')?.textContent ?? '';
  const next = g.ui.nextStep();
  g.ui.closeDemand();
  document.querySelector('#tb-treasury')?.click(); g.ui.update(0.3);
  const budget = document.querySelector('.subpanel')?.textContent ?? '';
  document.querySelector('#tb-meters')?.click(); g.ui.update(0.3);
  const meters = document.querySelector('.meter-pop')?.textContent ?? '';
  const bars = document.querySelector('.dbar')?.getAttribute('title') ?? '';
  return { card, next, budget, meters, bars, pop: s.population };
});
check(`the demand card counts homes, lots and jobs vs workers`, /Homes\d+/.test(ui.card.replace(/\s+/g, '')) && /Emptyzonedlots\d+/.test(ui.card.replace(/\s+/g, '')) && /Jobs·workers/.test(ui.card.replace(/\s+/g, '')), ui.card.slice(0, 300));
check(`and says what to do next ("${ui.next}")`, /^(Wait|Zone|Build a street|Grow)/.test(ui.next) && ui.card.includes('Next:'), ui.next);
check(`hovering the demand bars says it too ("${ui.bars.slice(0, 80)}…")`, /^Next: /.test(ui.bars), ui.bars);
check(`the budget shows road costs as they age and the way to break even`, /Roads cost more as they age: \$[\d,]+\/wk now → \$[\d,]+\/wk in a year → \$[\d,]+\/wk in four/.test(ui.budget) && /(To break even|pays its own way)/.test(ui.budget), ui.budget.slice(0, 400));
check(`the meters card lists nearer goals`, /Next goals/.test(ui.meters) && /Reach [\d,]+ people/.test(ui.meters), ui.meters.slice(0, 300));
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
