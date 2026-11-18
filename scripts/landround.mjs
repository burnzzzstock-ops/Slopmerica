// Land value and level-ups are spread over three days' steps: every building has one turn in each round of 96 steps, on the
// step its id falls on, and no step carries the whole county. (It was the whole county in one step every third day: 27 to 42 ms
// on a county of 14,000, half of it the models of the buildings that levelled up at once.)
// On the reference town: over one round every zoned building is looked at exactly once, and over two rounds exactly twice; the
// busiest step looks at a handful, not all of them; each one's turn is the step its id falls on; a building made in the
// middle of a round has its first turn within three days; and buildings still level up. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/landround.mjs      (SEED=n for another county's dice)
import { launch } from './lib/browser.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); if (!ok) bad++; };

const browser = await launch();
const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low', width: 900, height: 600 });
const out = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, B = g.buildings;
  cancelAnimationFrame(g.raf);
  const { STEPS_PER_DAY } = await import('/src/core/time.ts');
  const ROUND = 3 * STEPS_PER_DAY;
  // every look at a building's land value goes through the hooks: count them, by building and by step
  let now = [];
  g.sim.hooks.landValue.push((b) => { now.push(b.id); return 0; });
  const zoned = () => [...B.list.values()].filter((b) => b.zone !== 'service' && b.zone !== 'landmark');
  let ups = 0;
  const was = B.onLevel; B.onLevel = (b) => { ups++; was?.(b); };
  const stepNo = () => Math.round(g.sim.day * STEPS_PER_DAY);
  const run = (steps) => {
    const per = [], seen = new Map(), offTurn = [];
    for (let i = 0; i < steps; i++) {
      now = [];
      g.step();
      const turn = stepNo() % ROUND;
      per.push(now.length);
      for (const id of now) { seen.set(id, (seen.get(id) ?? 0) + 1); if (id % ROUND !== turn) offTurn.push([id, turn]); }
    }
    return { per, seen, offTurn };
  };
  const ids0 = new Set(zoned().map((b) => b.id));
  const one = run(ROUND);
  const stay = [...ids0].filter((id) => B.list.has(id));   // (a building bulldozed or burned in the round is not counted)
  const R = { zoned: ids0.size, stayed: stay.length, round: ROUND,
    once: stay.filter((id) => one.seen.get(id) === 1).length, most: Math.max(...one.per), busySteps: one.per.filter((n) => n > 0).length, total: one.per.reduce((n, x) => n + x, 0), offTurn: one.offTurn.length };
  const two = run(2 * ROUND);
  const stay2 = stay.filter((id) => B.list.has(id));
  R.twice = stay2.filter((id) => two.seen.get(id) === 2).length; R.stayed2 = stay2.length; R.most2 = Math.max(...two.per); R.offTurn2 = two.offTurn.length;
  // a building made in the middle of a round: its first turn comes within the round
  const S = g.startView();
  d.road(S.x + 700, S.z + 700, S.x + 900, S.z + 700, 'twoLane');
  d.zone(S.x + 800, S.z + 730, 90, 'resLow');
  const before = new Set(B.list.keys());
  let fresh = null, waited = 0;
  for (let i = 0; i < 40 * STEPS_PER_DAY && !fresh; i++) { g.step(); fresh = [...B.list.values()].find((b) => !before.has(b.id) && b.zone === 'resLow') ?? null; }
  if (fresh) { now = []; for (waited = 1; waited <= ROUND; waited++) { now = []; g.step(); if (now.includes(fresh.id)) break; } }
  R.fresh = fresh ? { id: fresh.id, waited } : null;
  // and a level-up happens on the building's own turn: one a level under what its land earns, full and nearly ready
  const cand = zoned().filter((b) => b.state === 'active' && b.abandoned === undefined && b.level >= 2 && b.level === Math.min(g.sim.levelCap(b).max, 1 + Math.floor(b.lv / 18)));
  const b = cand[0] ?? null;
  if (b) {
    const levelWas = b.level;
    b.level = levelWas - 1; b.levelProgress = 0.99; b.occ = b.cap;
    let at = null, early = 0;
    const was2 = B.onLevel; B.onLevel = (x) => { if (x === b && at === null) at = stepNo() % ROUND; was2?.(x); };
    for (let i = 0; i < ROUND && at === null; i++) { g.step(); if (at === null && b.level !== levelWas - 1) early++; }
    R.up = { id: b.id, turn: b.id % ROUND, at, level: [levelWas - 1, b.level], early };
  } else R.up = null;
  R.ups = ups;
  return R;
});

check(`the reference town has zoned buildings to look at (${out.zoned}; ${out.stayed} of them stood through the round)`, out.stayed >= 60, out);
check(`over one round of ${out.round} steps every one of them is looked at exactly once (${out.once} of ${out.stayed}; ${out.total} looks in all)`, out.once === out.stayed, out);
check(`no step carries the county: the busiest step looks at ${out.most} buildings of ${out.stayed}, and ${out.busySteps} of the ${out.round} steps have some`, out.most <= Math.max(6, Math.ceil(out.stayed / 12)) && out.busySteps >= Math.min(out.round, out.stayed) * 0.4, out);
check(`each one's turn is the step its id falls on (${out.offTurn + out.offTurn2} looks on another step)`, out.offTurn === 0 && out.offTurn2 === 0, out);
check(`over two more rounds, exactly twice (${out.twice} of ${out.stayed2}; the busiest step ${out.most2})`, out.twice === out.stayed2 && out.most2 <= Math.max(6, Math.ceil(out.stayed / 12)), out);
check(`a home that grows in the middle of a round has its first turn within three days (${out.fresh ? `after ${out.fresh.waited} steps` : 'no home grew'})`, !!out.fresh && out.fresh.waited <= out.round, out.fresh);
check(`a building a level under what its land earns, full and nearly ready, levels up on its own turn and not before (building ${out.up?.id}: turn ${out.up?.turn}, levelled on ${out.up?.at}, level ${out.up?.level?.join(' to ')})`,
  !!out.up && out.up.at === out.up.turn && out.up.level[1] === out.up.level[0] + 1 && out.up.early === 0, out.up);
check(`no errors on the page (${errs.length})`, errs.length === 0, errs.slice(0, 3));

await browser.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
