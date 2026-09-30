// Cars and people at crosswalks (audit round 7, item #5: "cars never check for
// walkers"). On the reference block, with the camera over it so people are out,
// steps cars and walkers together (no rendering) for three minutes of midday
// and checks that nobody on foot is ever inside a car's body, that people do
// cross junction arms, that some wait at the kerb for a gap or the walk phase,
// and that cars stop for people on the crosswalk. Then it compares traffic with
// the cars stopping for people and with them ignoring people, three minutes at
// a time in the order with, without, without, with, twice (so the town's own
// drift cancels out). With as many people out as the town ever shows, stopping
// for them mustn't cost more than a tenth of the cars moving or 15% of trips
// finished (trips come in bursts: about 5% either way is noise over 12 minutes).
// usage: node scripts/crosswalktest.mjs   (BASE_URL, default http://127.0.0.1:5173)
// Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, quality: 'low' });
const r = await page.evaluate((center) => {
  const g = window.__game, tr = g.traffic, P = g.peds;
  g.rts.setView(center.x, center.z, 320, 0.6, 0.9, true);
  const hour = 12.5;
  let time = 0;
  const step = () => {
    time += 1 / 20;
    tr.update(1 / 20, 1, hour, g.sim.population, g.sim.jobsFilled, g.rts.target);
    P.population = 3000; // plenty of people out, whatever the town's size
    P.update(1 / 20, 1, g.rts.target, g.rts.distance, time);
  };
  for (let i = 0; i < 1200; i++) step();
  const yields0 = tr.pedYields ?? 0;
  let inside = 0, samples = 0, walkers = 0;
  const crossed = new Set(), waited = new Set(), examples = [];
  // traffic flow: share of cars moving, and trips finished
  const flow = () => {
    let moving = 0, total = 0, finished = 0, prev = new Set();
    const windows = [];
    return {
      windows,
      start() { prev = new Set(tr.cars.map((c) => c.id)); windows.push(finished); },
      tick() {
        const ids = new Set(tr.cars.map((c) => c.id));
        for (const c of tr.cars) if (c.crashed === 0 && c.dep <= 0 && c.arr < 0) { total++; if (c.v > 0.5) moving++; }
        for (const id of prev) if (!ids.has(id)) finished++;
        prev = ids;
      },
      get() { return { moving: moving / Math.max(1, total), finished, windows: windows.map((w, i) => (windows[i + 1] ?? finished) - w) }; },
    };
  };
  for (let f = 0; f < 3600; f++) {
    step();
    for (const p of P.peds) {
      if (p.crossing) crossed.add(p.h);
      if ((p.kerbWait ?? 0) > 0) waited.add(p.h);
    }
    if (f % 5) continue;
    samples++;
    const cars = tr.cars.filter((c) => c.crashed === 0 && c.dep <= 0 && c.arr < 0 && !c.thru);
    for (const p of P.peds) {
      if (p.kind !== 'walk') continue;
      walkers++;
      for (const c of cars) {
        const dx = p.x - c.x, dz = p.z - c.z;
        if (dx * dx + dz * dz > (c.len / 2 + 3) ** 2) continue;
        // (along the car's path from its front to its rear, where the traffic has it:
        // a long truck drawn as one rigid body cuts inside a corner it turns)
        let hit = false;
        for (let b = 0; b <= c.len && !hit; b += Math.min(1, c.len / 4)) { const q = tr.pathPoint(c, b); hit = (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < 1.2 * 1.2; }
        if (hit) { inside++; if (examples.length < 4) examples.push({ walker: p.label, crossing: !!p.crossing, car: c.kind, v: +c.v.toFixed(1), inBox: !!c.junction }); }
      }
    }
  }
  // the same town and hour with the cars stopping for people, and ignoring them
  const hook = tr.crosswalkWalkers;
  const withPeople = flow(), without = flow();
  for (const stop of [true, false, false, true, true, false, false, true]) {
    tr.crosswalkWalkers = stop ? hook : undefined;
    const m = stop ? withPeople : without;
    m.start();
    for (let f = 0; f < 3600; f++) { step(); m.tick(); }
  }
  tr.crosswalkWalkers = hook;
  return { samples, walkers, inside, crossed: crossed.size, waited: waited.size, yields: (tr.pedYields ?? 0) - yields0, examples, flowWith: withPeople.get(), flowWithout: without.get() };
}, center);
console.log(`${r.walkers} walker-samples over 3 minutes: ${r.crossed} people crossed a junction arm, ${r.waited} waited at the kerb, cars stopped for someone ${r.yields} times`);
check(`nobody on foot is ever inside a car (${r.inside} times)`, r.inside === 0, r.examples);
check(`people cross junction arms (${r.crossed})`, r.crossed > 10);
check(`some wait at the kerb for a gap or the walk phase (${r.waited})`, r.waited > 0);
check(`cars stop for people on the crosswalk (${r.yields} times)`, r.yields > 0);
const fw = r.flowWith, fo = r.flowWithout, pct = (x) => `${Math.round(x * 100)}%`;
console.log(`traffic with people out: ${pct(fw.moving)} of cars moving, ${fw.finished} trips finished (${fw.windows.join(' + ')}); with cars ignoring them: ${pct(fo.moving)}, ${fo.finished} (${fo.windows.join(' + ')})`);
check(`stopping for people keeps cars moving (${pct(fw.moving)} vs ${pct(fo.moving)})`, fw.moving >= fo.moving * 0.9);
check(`stopping for people keeps trips finishing (${fw.finished} vs ${fo.finished})`, fw.finished >= fo.finished * 0.85);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
