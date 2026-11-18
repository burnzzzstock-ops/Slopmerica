// The county keeps a row for every week it closes (game.sim.weeks): what the weekly bill brought in and took out, the
// one-time money of that week, and the treasury after it. The Statistics drawer's money chart is drawn from it.
// On a small county with money (Ponzi mode): five weeks give five rows, seven days apart; each row's net is its income less
// its expense, and from one row to the next the treasury moves by exactly net + oneTime (the ledger's own reconciliation);
// the newest row is the closed week's ledger; the rows come back from a save; two years of weeks are kept and no more; and a
// sandbox, which has no money to count, keeps none. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/weekstest.mjs      (SEED=n for another county's dice)
import { launch } from './lib/browser.mjs';
import { seededInit, seededRandom, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); if (!ok) bad++; };

const browser = await launch();
const errs = [];
const open = async (mode, fresh = true) => {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => errs.push(e.message));
  if (fresh) await page.addInitScript(seededInit, { seed: SEED, rng: seededRandom.toString() });
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
  return page;
};
const ready = (page) => page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });

// ---- a county with money: a street of homes and shops, five weeks
const page = await open('ponzi');
await page.goto(`${base}/#skip&map=norcal&mode=ponzi&seed=${SEED}`, { waitUntil: 'load', timeout: 120000 });
await ready(page);
const five = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, s = g.sim;
  cancelAnimationFrame(g.raf);
  const { RECURRING, ONE_TIME } = await import('/src/sim/sim.ts');
  const S = g.startView();
  d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane');
  d.zone(S.x - 60, S.z + 40, 60, 'resLow');
  d.zone(S.x + 60, S.z + 40, 50, 'comLow');
  const start = Math.round(s.money), day0 = Math.floor(s.day);
  d.run(35);
  const L = s.lastWeek;
  return { start, day0, weeks: s.weeks.map((w) => ({ ...w })), money: Math.round(s.money), day: s.day,
    lastRecurring: Math.round(RECURRING.reduce((n, k) => n + L[k], 0)), lastOneTime: Math.round(ONE_TIME.reduce((n, k) => n + L[k], 0)), drift: s.ledgerDrift, cashTo: s.lastWeekCash.to };
});
const W = five.weeks ?? [];
check(`five weeks, five rows (${W.length}), seven days apart (days ${W.map((w) => w.day).join(', ')})`, W.length === 5 && W.every((w, i) => w.day % 7 === 0 && (i === 0 || w.day - W[i - 1].day === 7)), five);
check(`each row's net is its income less its expense, and neither is below zero (income ${W.map((w) => w.income).join(', ')}; expense ${W.map((w) => w.expense).join(', ')})`,
  W.length > 0 && W.every((w) => w.net === w.income - w.expense && w.income >= 0 && w.expense >= 0), W);
check(`the bill is not empty: money came in or went out in the last week (in ${W.at(-1)?.income}, out ${W.at(-1)?.expense})`, (W.at(-1)?.income ?? 0) + (W.at(-1)?.expense ?? 0) > 0, W.at(-1));
// from one row to the next the treasury moves by what the row says (a dollar of rounding a week at most)
const moves = W.map((w, i) => (i === 0 ? null : w.money - W[i - 1].money - (w.net + w.oneTime))).slice(1);
check(`from row to row the treasury moves by net + oneTime (off by ${moves.join(', ')} dollars)`, moves.length === 4 && moves.every((m) => Math.abs(m) <= 1), W);
check(`the newest row is the week the ledger just closed (net ${W.at(-1)?.net} and ${five.lastRecurring}; one-time ${W.at(-1)?.oneTime} and ${five.lastOneTime}; the ledger out by ${five.drift})`,
  W.length > 0 && W.at(-1).net === five.lastRecurring && W.at(-1).oneTime === five.lastOneTime && Math.abs(five.drift) <= 1, five);
check(`and its treasury is the treasury the close was reconciled at (${W.at(-1)?.money} and ${five.cashTo})`, W.length > 0 && W.at(-1).money === five.cashTo, five);

// ---- through a save
await page.evaluate(() => window.__dbg.save());
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('#continue', { timeout: 120000 });
await page.click('#continue');
await ready(page);
const back = await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); return g.sim.weeks.map((w) => ({ ...w })); });
check(`the rows come back from a save (${back.length} of ${W.length}, the same numbers)`, JSON.stringify(back) === JSON.stringify(W), { back, W });

// ---- two years are kept and no more: 110 weeks on from here
const long = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg;
  const { WEEKS_KEPT } = await import('/src/sim/sim.ts');
  g.sim.money += 5e6;   // (so nothing goes bankrupt on the way)
  for (let i = 0; i < 110; i += 10) { d.run(70); await new Promise((r) => setTimeout(r, 0)); }
  const w = g.sim.weeks;
  return { kept: WEEKS_KEPT, n: w.length, first: w[0]?.day, last: w.at(-1)?.day, day: Math.floor(g.sim.day), ended: g.sim.ended };
});
check(`after ${long.day} days the county remembers its last ${long.kept} weeks and no more (${long.n} rows, days ${long.first} to ${long.last})`,
  long.n === long.kept && long.last === Math.floor(long.day / 7) * 7 && long.first === long.last - (long.kept - 1) * 7, long);
await page.close();

// ---- a sandbox has no money to count
const sand = await open('sandbox');
await sand.goto(`${base}/#skip&map=norcal&mode=sandbox&seed=${SEED}`, { waitUntil: 'load', timeout: 120000 });
await ready(sand);
const none = await sand.evaluate(() => { const g = window.__game, d = window.__dbg; cancelAnimationFrame(g.raf); d.run(15); return { n: g.sim.weeks.length, money: g.sim.money === Infinity ? 'endless' : g.sim.money }; });
check(`a sandbox keeps none (${none.n} rows after two weeks; its money is ${none.money})`, none.n === 0 && none.money === 'endless', none);
check(`no errors on the page (${errs.length})`, errs.length === 0, errs.slice(0, 3));

await browser.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
