// Save → reload → Resume keeps what shapes the city's future: cleared trees
// and edited ground, the bankruptcy streak, the growth accumulator, the
// sim's random stream, this week's partial ledger, history, and the
// services' unbilled weekly imports. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=ponzi`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
const before = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, SV = window.__services;
  cancelAnimationFrame(g.raf);
  const S = g.startView();
  d.road(S.x - 120, S.z + 40, S.x + 120, S.z + 40, 'twoLane');
  d.zone(S.x, S.z + 70, 50, 'resLow');
  d.run(15);
  // terrain brush on a wooded patch away from the road
  const { terraformAt } = await import('/src/tools/terraform.ts');
  let spot = null;
  for (let r = 150; r < 900 && !spot; r += 40) for (let a = 0; a < 24; a++) {
    const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
    if (g.trees.countIn(x, z, 14) >= 4 && g.terrain.slope(x, z) < 0.25 && !g.net.pickSeg(x, z, 40) && g.terrain.h(x, z) > 3) { spot = { x, z }; break; }
  }
  const treesBefore = spot ? g.trees.countIn(spot.x, spot.z, 10) : -1;
  g.sim.money += 50000;
  const tf = spot ? terraformAt(g, spot.x, spot.z, 'raise') : null;
  const treesAfterBrush = spot ? g.trees.countIn(spot.x, spot.z, 10) : -1;
  // state the save must carry
  g.sim.bankruptWeeks = 3;
  SV.S.week.power = 12.5;
  d.run(3);
  d.save();
  const sim = g.sim;
  return {
    spot, treesBefore, treesAfterBrush, tf: tf?.reason,
    h: spot ? +g.terrain.h(spot.x, spot.z).toFixed(3) : 0,
    extra: JSON.parse(JSON.stringify(sim.serializeExtra())),
    week: { ...SV.S.week },
    money: Math.round(sim.money), day: Math.round(sim.day * 100) / 100,
  };
});
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.waitForSelector('#continue', { timeout: 120000 });
await page.click('#continue');
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
const after = await page.evaluate(({ spot }) => {
  const g = window.__game, SV = window.__services;
  cancelAnimationFrame(g.raf);
  return {
    trees: spot ? g.trees.countIn(spot.x, spot.z, 10) : -1,
    h: spot ? +g.terrain.h(spot.x, spot.z).toFixed(3) : 0,
    extra: JSON.parse(JSON.stringify(g.sim.serializeExtra())),
    week: { ...SV.S.week },
    money: Math.round(g.sim.money), day: Math.round(g.sim.day * 100) / 100,
  };
}, before);
const checks = [
  ['brush cleared trees in the test', before.spot && before.treesAfterBrush < before.treesBefore],
  ['cleared trees stay cleared after reload', after.trees <= before.treesAfterBrush],
  ['edited ground height kept', Math.abs(after.h - before.h) < 0.05],
  ['bankruptcy streak kept', after.extra.bankruptWeeks === before.extra.bankruptWeeks],
  ['growth accumulator kept', Math.abs(after.extra.growthAcc - before.extra.growthAcc) < 1e-9],
  ['random stream resumes where it was', after.extra.rng === before.extra.rng],
  ["this week's ledger kept", JSON.stringify(after.extra.ledger) === JSON.stringify(before.extra.ledger)],
  ["last week's totals kept", JSON.stringify(after.extra.lastWeek) === JSON.stringify(before.extra.lastWeek)],
  ['history kept', after.extra.history.length === before.extra.history.length],
  ['unbilled utility imports kept', Math.abs(after.week.power - before.week.power) < 1e-6],
  // the resumed game ticks a few frames before the test can pause it
  ['money and day kept', after.day >= before.day && after.day - before.day < 1 && Math.abs(after.money - before.money) <= Math.abs(before.money) * 0.02 + 5],
  ['no page errors', errs.length === 0],
];
let bad = 0;
for (const [label, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', label); if (!ok) bad++; }
if (bad) console.log(JSON.stringify({ before: { money: before.money, day: before.day, trees: before.treesAfterBrush }, after: { money: after.money, day: after.day, trees: after.trees }, errs: errs.slice(0, 3) }));
await browser.close();
process.exit(bad ? 1 : 0);
