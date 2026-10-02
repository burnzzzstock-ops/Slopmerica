// One walk line (docs/AUDIT_ROUND8_SIM.md; handoff item 4). Where people
// cross a junction arm, where the cars wait for them and where the zebra is
// painted all come from one function (roadJunction.ts armCrossing): the walk
// from one sidewalk's end to the other's. On the reference block, seeded, cars
// and people stepped for SECONDS at midday with plenty of people out, every
// walker's position over an arm's lanes is logged, in the arm's own frame
// (metres from the node along it, metres across it), and checked:
//  - every arm people cross has a zebra under their path (the paint's span
//    along the arm covers every logged step, 0.3 m of slack);
//  - every arm with a zebra is one people may cross (no paint where nobody
//    walks: round 7 painted, and held cars 3 to 6.5 m back for, 10 sharp-cornered
//    arms that pedestrians.ts never lets anyone cross);
//  - nobody walks over an arm's lanes anywhere but its crossing (no corner
//    cut across the lanes);
//  - a car waiting at its line (stopped within 0.6 m of it) keeps its nose at
//    least 2 m short of where people walk over its lane.
// Prints, per arm, where people walked, the zebra and the waiting noses.
// usage: node scripts/walklinetest.mjs   (BASE_URL, default http://127.0.0.1:5173; SEED=n replays a run;
// SECONDS, default 180). Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
const SECONDS = Number(process.env.SECONDS || 180);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, seed: SEED, quality: 'low' });
const r = await page.evaluate(async ({ SECONDS, center }) => {
  const M = await import('/src/core/math.ts'), RJ = await import('/src/roads/roadJunction.ts'), RT = await import('/src/roads/roadTypes.ts');
  const g = window.__game, tr = g.traffic, P = g.peds, net = g.net;
  g.rts.setView(center.x, center.z, 320, 0.6, 0.9, true);
  let time = 0;
  const step = () => {
    time += 1 / 20;
    tr.update(1 / 20, 1, 12.5, g.sim.population, g.sim.jobsFilled, g.rts.target);
    P.population = 3000; // plenty of people out, whatever the town's size
    P.update(1 / 20, 1, g.rts.target, g.rts.distance, time);
  };
  for (let i = 0; i < 1200; i++) step();
  // every arm of every junction of three or more roads with sidewalks, in its own frame: d from the node along it,
  // lat across it (+ on the road's own side +1, as pedestrians.ts and roadJunction.ts count sides)
  const arms = new Map();
  for (const n of net.nodes.values()) {
    if (n.segs.length < 3) continue;
    for (const sid of n.segs) {
      const seg = net.segs.get(sid);
      if (!seg || RT.ROAD_TYPES[seg.type].sidewalk <= 0) continue;
      const m = RJ.legPaint(net, seg, n.id), atA = seg.a === n.id, trim = Math.max(0, (atA ? seg.trimA : seg.trimB) ?? 0);
      // (pedestrians.ts never takes anyone over an arm whose sidewalk ends more than 1.5 m past its trim)
      const shut = [1, -1].some((sd) => { const [a, b] = P.kerbs(seg, sd); return (atA ? a : seg.length - b) > trim + 1.5; });
      arms.set(`${n.id}:${sid}`, { node: n.id, seg: sid, name: seg.name, atA, trim, shut, half: RT.carriageHalf(RT.ROAD_TYPES[seg.type]), zebra: m.cross === false ? null : [m.z0, m.z1], crossers: new Set(), steps: 0, off: 0, offEx: null, cornerSteps: 0, cornerEx: null, walk: [] });
    }
  }
  const frame = (seg, atA, x, z) => {
    const c = M.closestOnSampled({ x, z }, seg.samp);
    const { i } = M.locate(seg.samp, c.s), a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
    return { d: atA ? c.s : seg.length - c.s, lat: ((x - c.pt.x) * -tz + (z - c.pt.z) * tx) / L };
  };
  let noseMin = Infinity, noseEx = null, held = 0;
  for (let f = 0; f < SECONDS * 20; f++) {
    step();
    for (const p of P.peds) {
      if (p.kind !== 'walk') continue;
      const seg0 = net.segs.get(p.seg), nodes = new Set(seg0 ? [seg0.a, seg0.b] : []);
      if (p.crossing) nodes.add(p.crossing.node);
      for (const nid of nodes) {
        const n = net.nodes.get(nid);
        if (!n || n.segs.length < 3 || Math.hypot(n.x - p.x, n.z - p.z) > 40) continue;
        for (const sid of n.segs) {
          const A = arms.get(`${nid}:${sid}`);
          if (!A) continue;
          const q = frame(net.segs.get(sid), A.atA, p.x, p.z);
          // over this arm's lanes, past the junction box's edge
          if (Math.abs(q.lat) > A.half - 0.2 || q.d < A.trim - 0.3 || q.d > A.trim + 25) continue;
          if (p.crossing && p.crossing.node === nid && p.crossing.segs.includes(sid)) {
            A.crossers.add(p.h); A.steps++;
            if (A.walk.length < 4000) A.walk.push([q.d, q.lat]);
            if (!A.zebra || q.d < A.zebra[0] - 0.3 || q.d > A.zebra[1] + 0.3) { A.off++; A.offEx ??= { d: +q.d.toFixed(2), lat: +q.lat.toFixed(2), zebra: A.zebra }; }
          } else { A.cornerSteps++; A.cornerEx ??= { walker: p.h, d: +q.d.toFixed(2), lat: +q.lat.toFixed(2), go: !!p.go }; }
        }
      }
    }
    if (f % 5) continue;
    // cars waiting at their line: their nose against where people walked over their lane
    for (const c of tr.cars) {
      if (c.crashed !== 0 || c.junction || c.dep > 0 || c.arr >= 0 || c.thru || c.v > 0.3 || c.pi >= c.path.length - 1) continue;
      if (!['red', 'walker', 'left: oncoming', 'no room past the box', 'all-way stop'].includes(c.hold)) continue;
      const st = c.path[c.pi], seg = net.segs.get(st.seg), nid = st.dir > 0 ? seg.b : seg.a, A = arms.get(`${nid}:${seg.id}`);
      if (!A) continue;
      // (at its line: a car the hold caught already past it, standing on the crosswalk, isn't the line's doing;
      // canCross keeps people off the crosswalk while one stands there)
      const exitS = tr.exitOf(seg, st.dir), nose = A.trim + (exitS - c.s);
      if (Math.abs(exitS - c.s - tr.stopBack(nid, seg.id, c.lane)) > 0.6) continue;
      held++;
      // the lane's span across the arm, in the arm's frame
      const T = RT.ROAD_TYPES[seg.type], lo = RT.laneOffset(T, c.lane) - T.laneW / 2, hi = lo + T.laneW;
      const [l0, l1] = st.dir > 0 ? [lo, hi] : [-hi, -lo];
      for (const [d, lat] of A.walk) {
        if (lat < l0 || lat > l1) continue;
        if (nose - d < noseMin) { noseMin = nose - d; noseEx = { car: c.id, arm: `${nid}:${seg.id}`, lane: c.lane, nose: +nose.toFixed(2), walked: +d.toFixed(2), hold: c.hold }; }
      }
    }
  }
  return {
    arms: [...arms.values()].map((A) => ({ ...A, crossers: A.crossers.size, walk: undefined, walkD: A.walk.length ? [Math.min(...A.walk.map((w) => w[0])), Math.max(...A.walk.map((w) => w[0]))] : null })),
    noseMin, noseEx, held,
  };
}, { SECONDS, center });
const f1 = (x) => (x === null || x === undefined ? '-' : x.toFixed(1));
for (const A of r.arms.filter((a) => a.crossers || a.zebra || a.cornerSteps).sort((a, b) => a.node - b.node || a.seg - b.seg)) {
  if (!A.crossers && !A.cornerSteps) continue;
  console.log(`  ${A.node}:${A.seg} (${A.name}): trim ${f1(A.trim)}; ${A.crossers} crossed, walking ${A.walkD ? `${f1(A.walkD[0])}-${f1(A.walkD[1])}` : '-'} m from the node; zebra ${A.zebra ? `${f1(A.zebra[0])}-${f1(A.zebra[1])}` : 'none'}${A.off ? `, ${A.off} steps off it` : ''}${A.cornerSteps ? `; ${A.cornerSteps} steps over its lanes off the crossing` : ''}`);
}
const crossed = r.arms.filter((a) => a.crossers), painted = r.arms.filter((a) => a.zebra), paintedIdle = painted.filter((a) => !a.crossers);
console.log(`  ${crossed.length} arms crossed, ${painted.length} with a zebra (${paintedIdle.length} of them nobody crossed in ${SECONDS} s); ${r.held} looks at a car waiting at its line`);
const off = crossed.filter((a) => a.off);
check(`every arm people cross has a zebra under their path (${off.length} of ${crossed.length} with steps off it)`, crossed.length > 0 && off.length === 0, off.map((a) => ({ arm: `${a.node}:${a.seg}`, off: a.off, ex: a.offEx })));
// (an arm with a zebra that nobody happened to cross in a few minutes is fine; one pedestrians.ts never lets anyone cross isn't)
const shut = r.arms.filter((a) => a.zebra && a.shut);
check(`no zebra where nobody may cross (${shut.length})`, shut.length === 0, shut.map((a) => `${a.node}:${a.seg}`));
const corner = r.arms.filter((a) => a.cornerSteps);
check(`nobody walks over an arm's lanes off its crossing (${corner.reduce((n, a) => n + a.cornerSteps, 0)} steps)`, corner.length === 0, corner.map((a) => ({ arm: `${a.node}:${a.seg}`, steps: a.cornerSteps, ex: a.cornerEx })));
check(`a car waiting at its line keeps 2 m short of where people walk over its lane (closest ${f1(r.noseMin)} m)`, !(r.noseMin < 2), r.noseEx);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
