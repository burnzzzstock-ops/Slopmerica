// A drive-thru that is gone holds nobody. Opens a saved town (scripts/fixtures/saves/v2-drivethru-jam.json.gz) in which a
// burger place levelled up into a building with no drive-thru while cars were on their way to its window: three of them
// stood at its kerb waiting for a place in a line that no longer existed, two of them across both westbound lanes of the main
// street, and 26 cars behind them never moved again. Steps the traffic for ten minutes and checks that nobody waits on the
// road for a drive-thru that is not there, and that the street drains. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/thrugone.mjs   (MIN=10 minutes of traffic)
import { launch } from './lib/browser.mjs';
import { fixture } from './lib/fixtures.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed(), MIN = Number(process.env.MIN || 10);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();
const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low', save: fixture('saves/v2-drivethru-jam.json.gz'), center: { x: 525, z: 45 } });
const r = await page.evaluate((MIN) => {
  const g = window.__game, tr = g.traffic;
  tr.crosswalkWalkers = undefined;   // cars only, as carsolid does
  const h = 1 / 20, still = new Map(), drive = new Map(), rows = [];
  const waitingForNothing = () => tr.cars.filter((c) => c.thruB && !c.thru && !tr.thruAt(c.thruB)).map((c) => `${c.kind}#${c.id} for ${c.thruB.label}, ${Math.round(c.thruWait ?? 0)} s`);
  const atLoad = waitingForNothing();
  let stuckLate = 0, longestLate = 0, driveLongest = 0;
  for (let m = 0; m < MIN; m++) {
    for (let i = 0; i < 60 / h; i++) {
      tr.update(h, 1, 17.5, g.sim.population, g.sim.jobsFilled, g.rts.target);
      const live = new Set();
      for (const c of tr.cars) {
        live.add(c.id);
        // (on the road: a car still in its driveway waiting for a gap to pull out blocks nobody, and is counted apart)
        if (c.parked || c.thru || c.crashed !== 0 || c.v >= 0.05) { still.delete(c.id); drive.delete(c.id); }
        else if (c.dep > 0) { still.delete(c.id); drive.set(c.id, (drive.get(c.id) ?? 0) + h); }
        else still.set(c.id, (still.get(c.id) ?? 0) + h);
      }
      for (const id of still.keys()) if (!live.has(id)) still.delete(id);
      for (const id of drive.keys()) if (!live.has(id)) drive.delete(id);
    }
    const over = [...still.values()].filter((s) => s > 120);
    driveLongest = Math.max(driveLongest, ...drive.values(), 0);
    rows.push({ min: m + 1, onRoad: tr.cars.filter((c) => !c.parked).length, moving: tr.cars.filter((c) => !c.parked && c.v > 0.5).length, still2min: over.length, longest: Math.round(Math.max(0, ...still.values())) });
    if (m >= MIN / 2) { stuckLate = Math.max(stuckLate, over.length); longestLate = Math.max(longestLate, ...still.values(), 0); }
  }
  // who is still standing at the end, and what holds each (the tests and probes ask the traffic why a queue is not moving)
  const who = tr.cars.filter((c) => (still.get(c.id) ?? 0) > 120).map((c) => { const q = c.path?.[c.pi], seg = q && g.net.segs.get(q.seg); return `${c.kind}#${c.id} ${Math.round(still.get(c.id))} s on ${seg?.name ?? '?'} (seg ${q?.seg} dir ${q?.dir} lane ${c.lane}, s ${Math.round(c.s)} of ${Math.round(seg?.length ?? 0)}), held by ${c.hold ?? 'nothing'}, ${c.purpose ?? ''}${c.dep > 0 ? ', pulling out' : ''}${c.arr >= 0 ? ', pulling in' : ''}`; });
  return { atLoad, after: waitingForNothing(), rows, stuckLate, longestLate: Math.round(longestLate), who, driveLongest: Math.round(driveLongest) };
}, MIN);
for (const x of r.rows) console.log(`  minute ${x.min}: ${x.onRoad} on the road, ${x.moving} moving, ${x.still2min} still for over 2 minutes (longest ${x.longest} s)`);
for (const w of r.who) console.log(`  still standing: ${w}`);
console.log(`  (the longest wait in a driveway for a gap to pull out: ${r.driveLongest} s; printed, not checked)`);
check(`the saved town has cars on their way to a drive-thru that is gone (${r.atLoad.length}: ${r.atLoad.join('; ')})`, r.atLoad.length >= 2, r.atLoad);
check(`after ${MIN} minutes nobody is waiting for one (${r.after.length})`, r.after.length === 0, r.after);
check(`and the street has drained: in the second half no car on the road stood still for over 2 minutes (most at once ${r.stuckLate}, longest stand ${r.longestLate} s)`, r.stuckLate === 0, r.rows.slice(-3));
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
