// Actuated lights (docs/AUDIT_ROUND8_SIM.md #3). At the evening rush on the
// reference block, node 45 (Wildflower Dr x Old County Road, a T) gave its
// quiet stem 11 s of every 27 while Wildflower Dr's queue went round twice:
// 6 cars a minute into the box from it, waiting 57 s on average. Now a green
// with nobody waiting for it (no car near its lines, nobody on foot waiting to
// walk in it or on its crosswalks) goes to its yellow as soon as someone waits
// on another's (traffic.ts CALL_DIST, WALK_CALL). And a left out of one of two
// roads that share a green waited 110-130 s for gaps in the other's traffic,
// one on each change: now that road's green leads the other's while its lefts
// wait (traffic.ts LEAD_T). The same town and seed three times, cars and people
// stepped for SECONDS of game time at hour HOUR: with fixed 11 s greens
// (tr.actuated = false), actuated without the leading greens (tr.leadLefts =
// false), then both. Each run: cars a minute into the box at node 45 and at all
// the lights, per arm the time from stopping in the queue to the box (lefts
// apart), and the longest anyone on foot waited at the kerb of a junction with
// lights.
// usage: node scripts/lightstest.mjs   (BASE_URL, default http://127.0.0.1:5173; SEED=n replays a run;
// NODE, default 45; SECONDS, default 240; HOUR, default 17.5). Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
const NODE = Number(process.env.NODE || 45), SECONDS = Number(process.env.SECONDS || 240), HOUR = Number(process.env.HOUR || 17.5);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });

async function run(actuated, lead) {
  const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low' });
  const r = await page.evaluate(({ NODE, SECONDS, HOUR, actuated, lead }) => {
    const g = window.__game, tr = g.traffic, P = g.peds, net = g.net, node = net.nodes.get(NODE);
    tr.actuated = actuated;
    tr.leadLefts = lead;
    let time = 0;
    const step = () => {
      time += 1 / 20;
      tr.update(1 / 20, 1, HOUR, g.sim.population, g.sim.jobsFilled, g.rts.target);
      P.population = 3000; // plenty of people out, whatever the town's size
      P.update(1 / 20, 1, g.rts.target, g.rts.distance, time);
    };
    for (let i = 0; i < 1200; i++) step();
    const arms = node.segs.map((id) => net.segs.get(id)).filter(Boolean);
    const A = new Map(arms.map((s) => [s.id, { seg: s.id, name: s.name, into: 0, waits: [], lefts: [] }]));
    const queuedAt = new Map(), inBox = new Set();
    let t = 0, overlaps = 0, intoAll = 0, kerbMax = 0;
    for (let f = 0; f < SECONDS * 20; f++) {
      step(); t += 1 / 20;
      for (const c of tr.cars) {
        if (!c.junction || inBox.has(c.id) || !tr.signals.has(c.junction.node)) continue;
        inBox.add(c.id);
        intoAll++;
        const a = c.junction.node === NODE && A.get(c.junction.fromSeg);
        if (!a) continue;
        a.into++;
        if (queuedAt.has(c.id)) (c.turn > 0 ? a.lefts : a.waits).push(t - queuedAt.get(c.id));
      }
      for (const s of arms) {
        const dir = s.b === NODE ? 1 : -1, exitS = tr.exitOf(s, dir);
        for (let k = 0; k < 4; k++) for (const c of tr.buckets.get(s.id * 16 + (dir > 0 ? 0 : 8) + k) ?? []) if (c.crashed === 0 && c.pi < c.path.length - 1 && exitS - c.s < 80 && c.v < 1 && !queuedAt.has(c.id)) queuedAt.set(c.id, t);
      }
      // people held at the kerb of a junction with lights
      for (const p of P.peds) {
        if (!(p.kerbWait > 0)) continue;
        const seg = net.segs.get(p.seg);
        if (seg && tr.signals.has(p.s > seg.length / 2 ? seg.b : seg.a)) kerbMax = Math.max(kerbMax, p.kerbWait);
      }
      // two cars in the box from different phases, their bodies overlapping
      if (f % 10 === 0) {
        const box = (tr.junctionCars.get(NODE) ?? []).filter((c) => c.crashed === 0 && c.junction);
        const sig = tr.signalState(NODE);
        for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
          const a = box[i], b = box[j];
          if (sig.phaseOf.get(a.junction.fromSeg) === sig.phaseOf.get(b.junction.fromSeg)) continue;
          if (Math.hypot(a.x - b.x, a.z - b.z) < (a.len + b.len) / 4 + 1) overlaps++;
        }
      }
    }
    const stat = (xs) => (xs.length ? { n: xs.length, mean: +(xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(1), max: +Math.max(...xs).toFixed(1) } : { n: 0, mean: 0, max: 0 });
    const into = [...A.values()].reduce((x, a) => x + a.into, 0);
    return {
      arms: [...A.values()].map((a) => ({ seg: a.seg, name: a.name, perMin: +(a.into / (SECONDS / 60)).toFixed(1), waits: stat(a.waits), lefts: stat(a.lefts) })),
      perMin: +(into / (SECONDS / 60)).toFixed(1), allPerMin: +(intoAll / (SECONDS / 60)).toFixed(1), lights: tr.signals.size, kerbMax: +kerbMax.toFixed(1), overlaps, leads: tr.leads ?? 0,
    };
  }, { NODE, SECONDS, HOUR, actuated, lead });
  await page.close();
  return { ...r, errs };
}

const fixed = await run(false, false);
const noLead = await run(true, false);
const act = await run(true, true);
for (const [n, r] of [['fixed 11 s greens', fixed], ['actuated, no leading greens', noLead], ['actuated with leading greens', act]]) {
  console.log(`${n}: ${r.perMin} cars a minute into node ${NODE}'s box, ${r.allPerMin} into all ${r.lights} sets of lights; the longest anyone waited at a kerb at the lights ${r.kerbMax} s${r.leads ? `; ${r.leads} leading greens` : ''}`);
  for (const a of r.arms) console.log(`  seg ${a.seg} (${a.name}): ${a.perMin} a minute; from stopping to the box ${a.waits.mean} s on average, ${a.waits.max} s at most (${a.waits.n} cars)${a.lefts.n ? `; lefts ${a.lefts.mean} s, ${a.lefts.max} s at most (${a.lefts.n})` : ''}`);
}
check(`more cars through node ${NODE} (${act.perMin} a minute against ${fixed.perMin}: a fifth more at least)`, act.perMin >= fixed.perMin * 1.2);
check(`and no fewer through all the lights (${act.allPerMin} against ${fixed.allPerMin})`, act.allPerMin >= fixed.allPerMin * 0.97);
const lefts = (r) => r.arms.reduce((x, a) => x + a.lefts.mean * a.lefts.n, 0) / Math.max(1, r.arms.reduce((x, a) => x + a.lefts.n, 0));
check(`lefts wait no longer (${lefts(act).toFixed(0)} s on average against ${lefts(fixed).toFixed(0)} s)`, lefts(act) <= lefts(fixed) * 1.15 + 5);
check(`people on foot wait no longer at the lights (the longest ${act.kerbMax} s against ${fixed.kerbMax} s)`, act.kerbMax <= fixed.kerbMax + 5);
check(`no two cars from different phases inside each other in the box (${act.overlaps} times)`, act.overlaps === 0);
// the leading greens: the lefts at node NODE against the same lights without them
const leftsAt = (r) => { const n = r.arms.reduce((x, a) => x + a.lefts.n, 0); return { n, mean: r.arms.reduce((x, a) => x + a.lefts.mean * a.lefts.n, 0) / Math.max(1, n) }; };
const lA = leftsAt(act), lN = leftsAt(noLead);
check(`a leading green cuts the lefts' wait at node ${NODE} (${lA.mean.toFixed(0)} s on average, ${lA.n} cars, against ${lN.mean.toFixed(0)} s, ${lN.n}: two thirds at most)`, lA.n > 0 && lA.mean <= lN.mean * 0.67);
// (all the lights to within a tenth: a road going alone lengthens the cycle; on seeds 1-3 the leading greens moved all
// four sets of lights by -6% to +8% at the evening rush, and that count moves ~15% between runs of the same code: 20.8
// and 24 a minute without them on seed 1)
check(`and costs the junction no cars (${act.perMin} a minute into node ${NODE} against ${noLead.perMin}; all the lights ${act.allPerMin} against ${noLead.allPerMin})`, act.perMin >= noLead.perMin * 0.95 && act.allPerMin >= noLead.allPerMin * 0.9);
check(`nor anyone on foot much time (the longest at a kerb ${act.kerbMax} s against ${noLead.kerbMax} s)`, act.kerbMax <= noLead.kerbMax + 8);
check('no page errors', fixed.errs.length === 0 && noLead.errs.length === 0 && act.errs.length === 0, [...fixed.errs, ...noLead.errs, ...act.errs].slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
