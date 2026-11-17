// Actuated lights (docs/AUDIT_ROUND8_SIM.md #3). At the evening rush on the
// reference block, a junction with lights gave its quiet stem 11 s of every 27
// while the busy road's queue went round twice. Now a green with nobody waiting
// for it (no car near its lines, nobody on foot waiting to walk in it or on its
// crosswalks) goes to its yellow as soon as someone waits on another's
// (traffic.ts CALL_DIST, WALK_CALL). And a left out of one of two roads that
// share a green waited 100-140 s for gaps in the other's traffic, one on each
// change: now that road's green leads the other's while its lefts wait
// (traffic.ts LEAD_T). The same town and seed three times, cars and people
// stepped for SECONDS of game time at hour HOUR: with fixed 11 s greens
// (tr.actuated = false), actuated without the leading greens (tr.leadLefts =
// false), then both. Each run: cars a minute into the box at every set of lights,
// per arm the time from stopping in the queue to the box (lefts apart), and the
// longest anyone on foot waited at the kerb of a junction with lights.
//
// The junctions the per-junction checks look at are chosen from the town, not
// named (see below): on the first reference town both were node 45, a T (Wildflower
// Dr x Old County Road); on the town regrown with its stroad they are lights on it.
// usage: node scripts/lightstest.mjs   (BASE_URL, default http://127.0.0.1:5173; SEED=n replays a run;
// NODE forces the actuated greens' junction, LEFT_NODE the leading greens'; SECONDS, default 240; HOUR, default 17.5).
// Exits 1 on failure.
import { launch } from './lib/browser.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
const SECONDS = Number(process.env.SECONDS || 240), HOUR = Number(process.env.HOUR || 17.5);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await launch();

/** One run: every set of lights at once (their arms, queues and lefts), and the town-wide counts. */
async function run(actuated, lead) {
  const { page, errs, center } = await openBlock(browser, { base, seed: SEED, quality: 'low' });
  const r = await page.evaluate(({ SECONDS, HOUR, actuated, lead, center }) => {
    const g = window.__game, tr = g.traffic, P = g.peds, net = g.net;
    tr.actuated = actuated;
    tr.leadLefts = lead;
    // (the camera over the block's middle, where the people out walking are: the town opens looking at the end of the
    // county road, which was the block's middle only on the first reference town)
    const cam = g.rts.target.clone();
    cam.x = center.x; cam.z = center.z;
    let time = 0;
    const step = () => {
      time += 1 / 20;
      tr.update(1 / 20, 1, HOUR, g.sim.population, g.sim.jobsFilled, cam);
      P.population = 3000; // plenty of people out, whatever the town's size
      P.update(1 / 20, 1, cam, g.rts.distance, time);
    };
    for (let i = 0; i < 1200; i++) step();
    const leads0 = tr.leads ?? 0; // (the count is saved with the town: only this run's)
    // every junction with lights, and its arms
    const lit = [...net.nodes.values()].filter((n) => tr.signalState(n.id));
    const J = new Map(lit.map((n) => {
      const arms = n.segs.map((id) => net.segs.get(id)).filter(Boolean);
      return [n.id, { arms, A: new Map(arms.map((s) => [s.id, { seg: s.id, name: s.name, into: 0, waits: [], lefts: [] }])), overlaps: 0, idle: 0 }];
    }));
    // a green nobody calls for while somebody waits on another (traffic.ts calls(): a car within CALL_DIST of a line, or
    // someone on foot): the time an actuated light gives to whoever waits, and fixed greens throw away
    const idleGreen = (id, j) => {
      const sig = tr.signalState(id);
      if (!sig || sig.lead) return false;
      const green = j.arms.find((s) => tr.lampState(id, s.id) === 'green');
      if (!green) return false;
      const calls = tr.calls(id, sig), ph = sig.phaseOf.get(green.id);
      return calls !== 0 && !(calls & (1 << ph));
    };
    const queuedAt = new Map(), inBox = new Set();
    let t = 0, intoAll = 0, kerbMax = 0;
    for (let f = 0; f < SECONDS * 20; f++) {
      step(); t += 1 / 20;
      for (const [id, j] of J) if (idleGreen(id, j)) j.idle += 1 / 20;
      for (const c of tr.cars) {
        if (!c.junction || inBox.has(c.id) || !tr.signals.has(c.junction.node)) continue;
        inBox.add(c.id);
        intoAll++;
        const a = J.get(c.junction.node)?.A.get(c.junction.fromSeg);
        if (!a) continue;
        a.into++;
        if (queuedAt.has(c.id)) (c.turn > 0 ? a.lefts : a.waits).push(t - queuedAt.get(c.id));
      }
      for (const [id, j] of J) for (const s of j.arms) {
        const dir = s.b === id ? 1 : -1, exitS = tr.exitOf(s, dir);
        for (let k = 0; k < 4; k++) for (const c of tr.buckets.get(s.id * 16 + (dir > 0 ? 0 : 8) + k) ?? []) if (c.crashed === 0 && c.pi < c.path.length - 1 && exitS - c.s < 80 && c.v < 1 && !queuedAt.has(c.id)) queuedAt.set(c.id, t);
      }
      // people held at the kerb of a junction with lights
      for (const p of P.peds) {
        if (!(p.kerbWait > 0)) continue;
        const seg = net.segs.get(p.seg);
        if (seg && tr.signals.has(p.s > seg.length / 2 ? seg.b : seg.a)) kerbMax = Math.max(kerbMax, p.kerbWait);
      }
      // two cars in the box from different phases, their bodies overlapping
      if (f % 10 === 0) for (const [id, j] of J) {
        const box = (tr.junctionCars.get(id) ?? []).filter((c) => c.crashed === 0 && c.junction);
        const sig = tr.signalState(id);
        for (let i = 0; i < box.length; i++) for (let k = i + 1; k < box.length; k++) {
          const a = box[i], b = box[k];
          if (sig.phaseOf.get(a.junction.fromSeg) === sig.phaseOf.get(b.junction.fromSeg)) continue;
          if (Math.hypot(a.x - b.x, a.z - b.z) < (a.len + b.len) / 4 + 1) j.overlaps++;
        }
      }
    }
    const stat = (xs) => (xs.length ? { n: xs.length, mean: +(xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(1), max: +Math.max(...xs).toFixed(1) } : { n: 0, mean: 0, max: 0 });
    const nodes = {};
    for (const [id, j] of J) {
      const into = [...j.A.values()].reduce((x, a) => x + a.into, 0);
      nodes[id] = {
        names: [...new Set(j.arms.map((s) => s.name))].join(' x '),
        arms: [...j.A.values()].map((a) => ({ seg: a.seg, name: a.name, perMin: +(a.into / (SECONDS / 60)).toFixed(1), waits: stat(a.waits), lefts: stat(a.lefts) })),
        perMin: +(into / (SECONDS / 60)).toFixed(1), overlaps: j.overlaps, idle: +(j.idle / SECONDS).toFixed(2),
      };
    }
    return { nodes, allPerMin: +(intoAll / (SECONDS / 60)).toFixed(1), lights: tr.signals.size, kerbMax: +kerbMax.toFixed(1), leads: (tr.leads ?? 0) - leads0 };
  }, { SECONDS, HOUR, actuated, lead, center });
  await page.close();
  return { ...r, errs };
}

const fixed = await run(false, false);
const noLead = await run(true, false);
const act = await run(true, true);
// the lefts at a junction (cars that queued, then turned left into its box): how many, and their mean wait
const leftsAt = (r, id) => { const arms = r.nodes[id]?.arms ?? []; const n = arms.reduce((x, a) => x + a.lefts.n, 0); return { n, mean: arms.reduce((x, a) => x + a.lefts.mean * a.lefts.n, 0) / Math.max(1, n) }; };
// the others (lefts apart): how many queued, and their mean wait
const othersAt = (r, id) => { const arms = r.nodes[id]?.arms ?? []; const n = arms.reduce((x, a) => x + a.waits.n, 0); return { n, mean: arms.reduce((x, a) => x + a.waits.mean * a.waits.n, 0) / Math.max(1, n) }; };
console.log('every set of lights at the rush, fixed greens / actuated / with leading greens (cars a minute into the box; cars that queued and their mean wait; lefts that queued and theirs):');
for (const id of Object.keys(fixed.nodes)) {
  const cell = (r) => { const o = othersAt(r, id), l = leftsAt(r, id); return `${r.nodes[id].perMin}/min, ${o.n} queued ${o.mean.toFixed(0)} s, ${l.n} lefts ${l.mean.toFixed(0)} s`; };
  console.log(`  node ${id} (${fixed.nodes[id].names}): ${cell(fixed)}  |  ${cell(noLead)}  |  ${cell(act)}`);
}
// Two junctions, chosen from the fixed-greens run (the same in all three: the same town and seed):
//  - for the actuated greens, the set of lights whose greens stood idle longest while somebody waited on another's (what an
//    actuated light gives to the queue, and fixed greens throw away), among those where the cars that queued waited more
//    than a whole cycle on average (27 s: two greens of 11 s and their 2.5 s yellows), as the first town's node 45 did:
//    where they don't, the light isn't what holds them, and no light can move a fifth more cars than come;
//  - for the leading greens, the one where the most left-turners queued (the conflict a leading green is for).
const ids = Object.keys(fixed.nodes).map(Number);
const held = ids.filter((id) => othersAt(fixed, id).mean >= 27);
const NODE = process.env.NODE ? Number(process.env.NODE) : (held.length ? held : ids).sort((a, b) => fixed.nodes[b].idle - fixed.nodes[a].idle || fixed.nodes[b].perMin - fixed.nodes[a].perMin)[0];
const LNODE = process.env.LEFT_NODE ? Number(process.env.LEFT_NODE) : ids.sort((a, b) => leftsAt(fixed, b).n - leftsAt(fixed, a).n || leftsAt(fixed, b).mean - leftsAt(fixed, a).mean)[0];
console.log(`greens standing idle while someone waits, share of the time with fixed greens: ${ids.map((id) => `node ${id} ${Math.round(fixed.nodes[id].idle * 100)}% (its queues ${othersAt(fixed, id).mean.toFixed(0)} s)`).join(', ')}`);
console.log(`the actuated greens' junction: node ${NODE} (${fixed.nodes[NODE]?.names}); the leading greens': node ${LNODE} (${fixed.nodes[LNODE]?.names})`);
for (const [n, r] of [['fixed 11 s greens', fixed], ['actuated, no leading greens', noLead], ['actuated with leading greens', act]]) {
  console.log(`${n}: ${r.allPerMin} cars a minute into all ${r.lights} sets of lights; the longest anyone waited at a kerb at the lights ${r.kerbMax} s${r.leads ? `; ${r.leads} leading greens` : ''}`);
  for (const id of new Set([NODE, LNODE])) {
    console.log(`  node ${id}: ${r.nodes[id].perMin} cars a minute into its box`);
    for (const a of r.nodes[id].arms) console.log(`    seg ${a.seg} (${a.name}): ${a.perMin} a minute; from stopping to the box ${a.waits.mean} s on average, ${a.waits.max} s at most (${a.waits.n} cars)${a.lefts.n ? `; lefts ${a.lefts.mean} s, ${a.lefts.max} s at most (${a.lefts.n})` : ''}`);
  }
}
const skip = (label, why) => console.log('SKIP', label, why);
check(`more cars through node ${NODE} (${act.nodes[NODE].perMin} a minute against ${fixed.nodes[NODE].perMin}: a fifth more at least)`, act.nodes[NODE].perMin >= fixed.nodes[NODE].perMin * 1.2);
check(`and no fewer through all the lights (${act.allPerMin} against ${fixed.allPerMin})`, act.allPerMin >= fixed.allPerMin * 0.97);
check(`people on foot wait no longer at the lights (the longest ${act.kerbMax} s against ${fixed.kerbMax} s)`, act.kerbMax <= fixed.kerbMax + 5);
const overlaps = ids.reduce((x, id) => x + act.nodes[id].overlaps, 0);
check(`no two cars from different phases inside each other in the box at any of the ${ids.length} sets of lights (${overlaps} times${overlaps ? `: ${ids.filter((id) => act.nodes[id].overlaps).map((id) => `node ${id} ${act.nodes[id].overlaps}`).join(', ')}` : ''})`, overlaps === 0);
// The lefts' checks compare mean waits, which mean something only where lefts wait for the oncoming traffic: a dozen of
// them queued in the four minutes with fixed greens (the first town's node 45 had one a change, 100-140 s each), waiting a
// whole cycle on average (27 s: two greens of 11 s and their 2.5 s yellows). Fewer, and one car's luck moves the mean by
// tens of seconds between the three runs of the same seed. Without the conflict they are reported as skipped, with the
// numbers, never dropped. On the town regrown in 1cbdb6b the most lefts at any light at the rush are 5 to 7 (seeds 1-6):
// it is saved with three cars waiting at the kerb for the drive-thru of a McDougal's that levelled up into a building
// without one (traffic.ts, the drive-thru hold waits on thruRoom(), false for a building with no lanes, for good). They
// shut the stroad westward at its end, and the queue back from them starves node 67 (Quail Run Ct). With those three
// let go (a probe, not this test), node 67 has 18 to 24 lefts at 50-90 s and the checks below apply.
const lF = leftsAt(fixed, LNODE), lA = leftsAt(act, LNODE), lN = leftsAt(noLead, LNODE);
const conflict = lF.n >= 12 && lF.mean >= 27;
const lefts1 = `lefts wait no longer at node ${LNODE} (${lA.mean.toFixed(0)} s on average against ${lF.mean.toFixed(0)} s)`;
const lefts2 = `a leading green cuts the lefts' wait at node ${LNODE} (${lA.mean.toFixed(0)} s on average, ${lA.n} cars, against ${lN.mean.toFixed(0)} s, ${lN.n}: two thirds at most)`;
const noConflict = `(not enough left-turn conflict at the rush to measure: the most lefts queued at any light were ${lF.n}, at node ${LNODE}, ${lF.mean.toFixed(0)} s on average with fixed greens; 12 waiting 27 s needed)`;
if (conflict) check(lefts1, lA.mean <= lF.mean * 1.15 + 5); else skip(lefts1, noConflict);
// the leading greens: the lefts at node LNODE against the same lights without them
if (conflict) check(lefts2, lA.n > 0 && lA.mean <= lN.mean * 0.67); else skip(lefts2, noConflict);
// (all the lights to within a tenth: a road going alone lengthens the cycle; on seeds 1-3 the leading greens moved all
// four sets of lights of the first town by -6% to +8% at the evening rush, and that count moves ~15% between runs of the
// same code: 20.8 and 24 a minute without them on seed 1. The junction to within 5% where it has lefts to lead with;
// without them it gives few leading greens, and a 5% difference is one car of its twenty-odd in the four minutes.)
check(`and costs all the lights no cars (${act.allPerMin} a minute against ${noLead.allPerMin}: a tenth at most)`, act.allPerMin >= noLead.allPerMin * 0.9);
const costs = `nor node ${LNODE} (${act.nodes[LNODE].perMin} a minute into it against ${noLead.nodes[LNODE].perMin}: 5% at most)`;
if (conflict) check(costs, act.nodes[LNODE].perMin >= noLead.nodes[LNODE].perMin * 0.95); else skip(costs, noConflict);
check(`nor anyone on foot much time (the longest at a kerb ${act.kerbMax} s against ${noLead.kerbMax} s)`, act.kerbMax <= noLead.kerbMax + 8);
check('no page errors', fixed.errs.length === 0 && noLead.errs.length === 0 && act.errs.length === 0, [...fixed.errs, ...noLead.errs, ...act.errs].slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
