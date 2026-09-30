// Cars are solid (audit 2026-09-30: "the cars still need improvement"). On the
// reference block at morning rush, steps the traffic model directly (no
// rendering, so it's fast and the same on every preset) and checks that no two
// cars are ever drawn inside each other: not in a lane (a car pulling out of a
// driveway merged into a stopped queue, found at 8.6 pairs at any moment) and
// not inside a junction (cars on one turning curve don't follow each other, and
// all stop at its end when the exit is full). Also: no car waits more than 60 s
// away from a red light, and no heading snaps. Crashes, arrivals and the share
// of cars moving are printed so a fix that only stops cars shows up.
// usage: node scripts/carsolid.mjs   (BASE_URL, default http://127.0.0.1:5173;
// SECONDS of traffic to measure, default 120). Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SECONDS = Number(process.env.SECONDS || 120);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, quality: 'low' });
const r = await page.evaluate((SECONDS) => {
  const g = window.__game, tr = g.traffic, net = g.net;
  const step = () => tr.update(1 / 20, 1, 7.5, g.sim.population, g.sim.jobsFilled, g.rts.target);
  for (let i = 0; i < 1200; i++) step(); // a minute for the morning traffic to build
  const crashes0 = tr.crashes, cause0 = { ...tr.crashCause };
  // trips that ended normally: cars that leave the list without having crashed
  let finished = 0, prevIds = new Map();
  let samples = 0, laneOverlaps = 0, boxOverlaps = 0, moving = 0, total = 0, snaps = 0;
  const examples = [], still = new Map(), prevYaw = new Map();
  let longest = { s: 0 };
  const where = (c) => { const st = c.path[c.pi]; const seg = st && net.segs.get(st.seg); return `${c.kind}#${c.id} ${seg?.type ?? '?'} seg ${st?.seg} lane ${c.lane} s ${c.s.toFixed(1)} v ${c.v.toFixed(1)}${c.junction ? ' (in junction)' : ''}${c.pi === 0 ? ' (first road)' : ''}`; };
  for (let f = 0; f < SECONDS * 20; f++) {
    step();
    const ids = new Map(tr.cars.map((c) => [c.id, c.crashed]));
    for (const [id, crashed] of prevIds) if (!ids.has(id) && crashed <= 0) finished++;
    prevIds = ids;
    const cars = tr.cars.filter((c) => c.crashed <= 0 && c.dep <= 0 && c.arr < 0);
    for (const c of cars) {
      const y = c.ryaw ?? c.yaw, p = prevYaw.get(c.id);
      if (p !== undefined) { let d = Math.abs(y - p) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d; if (d > 0.35) snaps++; }
      prevYaw.set(c.id, y);
      // waiting, away from a red light (a queue behind a red is fine)
      const st = c.path[c.pi], seg = st && net.segs.get(st.seg);
      const atRed = seg && c.pi < c.path.length - 1 && !tr.isGreen(st.dir > 0 ? seg.b : seg.a, seg.id);
      const w = c.v < 0.3 && !atRed ? (still.get(c.id) ?? 0) + 1 / 20 : 0;
      still.set(c.id, w);
      if (w > longest.s) longest = { s: w, car: where(c) };
    }
    if (f % 10) continue;
    samples++;
    total += cars.length; moving += cars.filter((c) => c.v > 0.5).length;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], dx = a.x - b.x, dz = a.z - b.z;
      if (dx * dx + dz * dz > 144) continue;
      const y = a.ryaw ?? a.yaw, hx = Math.sin(y), hz = Math.cos(y);
      const along = Math.abs(dx * hx + dz * hz), across = Math.abs(dx * hz - dz * hx);
      if (!(along < ((a.len + b.len) / 2) * 0.8 && across < 1.4)) continue; // bodies overlap by 20% or more
      if (a.junction || b.junction) boxOverlaps++; else laneOverlaps++;
      if (examples.length < 6) examples.push(`${where(a)}  ×  ${where(b)}`);
    }
  }
  const cc = tr.crashCause;
  return {
    pop: g.sim.population, cars: tr.cars.length, samples,
    lanePerSample: laneOverlaps / samples, boxPerSample: boxOverlaps / samples, examples,
    longest: { s: +longest.s.toFixed(1), car: longest.car }, snaps, movingShare: moving / Math.max(1, total),
    crashes: tr.crashes - crashes0, byCause: { rear: cc.rear - cause0.rear, random: cc.random - cause0.random, junction: cc.junction - cause0.junction }, finished,
  };
}, SECONDS);
console.log(`${r.pop} residents, ${r.cars} cars, ${SECONDS} s of morning traffic: ${(r.movingShare * 100).toFixed(0)}% moving, ${r.finished} trips finished, ${r.crashes} crashes ${JSON.stringify(r.byCause)}`);
check(`no two cars inside each other in a lane (${r.lanePerSample.toFixed(2)} pairs at any moment)`, r.lanePerSample === 0, r.examples);
check(`no two cars inside each other in a junction (${r.boxPerSample.toFixed(2)} pairs at any moment)`, r.boxPerSample === 0, r.examples);
check(`no car waits over 60 s away from a red light (longest ${r.longest.s} s)`, r.longest.s <= 60, r.longest);
check(`no heading snaps over 0.35 rad in a frame (${r.snaps})`, r.snaps === 0);
check(`traffic still flows (${(r.movingShare * 100).toFixed(0)}% of cars moving, target at least 50%)`, r.movingShare >= 0.5);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
