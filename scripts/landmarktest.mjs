// Landmarks draw visitors (traffic pass, playtest 6: "built the stadium, nothing
// happens"; no trip ever went to a landmark). On the reference block, with Slop
// 69 Field placed beside one of its roads, stepping cars at game speed (an hour
// on the clock is 15 s at ▶, 300 steps) without rendering:
//  - the afternoon sends nobody to the game, and a few sightseers;
//  - game night (every evening, 5 to 10 pm) draws a crowd, 3% of the town's
//    people, on top of the other traffic: they leave home in the 90 minutes
//    before kickoff, arrive and pull into its lot, which is on screen, so only
//    cars that drove there fill it;
//  - after the game the crowd drives home, backing out of the stalls;
//  - the inspector says how many came today and when the games are;
//  - a landmark no road reaches draws nobody.
// usage: node scripts/landmarktest.mjs   (BASE_URL, default http://127.0.0.1:5173; SEED=n replays
// a run: it prints its seed, and the town it was built from)
// Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low' });
const r = await page.evaluate(() => {
  const g = window.__game, tr = g.traffic, P = g.parking, tgt = g.rts.target;
  tr.crosswalkWalkers = undefined; // cars only
  P.inView = () => true; // the lots are on screen: only cars that drive in and out change them
  // Slop 69 Field beside the nearest road that has room for it
  const place = (id, near) => {
    const segs = [...g.net.segs.values()].sort((a, b) => Math.hypot(a.samp.pts[0].x - near.x, a.samp.pts[0].z - near.z) - Math.hypot(b.samp.pts[0].x - near.x, b.samp.pts[0].z - near.z));
    for (const s of segs) for (const f of [0.5, 0.3, 0.7]) for (const side of [1, -1]) for (const off of [20, 35, 50, 70]) {
      const pts = s.samp.pts, i = Math.floor(f * (pts.length - 1)), a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const sp = g.landmarkSpot(id, a.x - (dz / L) * side * off, a.z + (dx / L) * side * off);
      if (sp.ok && sp.front && g.placeLandmark(id, { x: sp.x, z: sp.z })) {
        const lm = [...g.buildings.list.values()].find((x) => x.landmark === id);
        lm.state = 'active'; lm.progress = 1;
        return lm;
      }
    }
    return null;
  };
  const field = place('slop69Field', tgt);
  if (!field) return { field: null };
  // new trips by purpose, and the field's arrivals, while stepping from h0 to h1 on this day
  const launch = tr.launch.bind(tr);
  let trips = {};
  tr.launch = (...a) => { const c = launch(...a); if (c && (a[2] === field || a[3] === field)) trips[a[5]] = (trips[a[5]] ?? 0) + 1; return c; };
  // (cars seen backing out of a stall, over every window: a car still backing out at 1 am counts once)
  const seen = new Set();
  const run = (h0, h1) => {
    trips = {};
    const before = tr.visits.get(field)?.length ?? 0;
    let most = 0, backedOut = 0;
    for (let t = h0; t < h1 - 1e-9; t += 1 / 300) {
      const h = t % 24;
      tr.update(1 / 20, 1, h, g.sim.population, g.sim.jobsFilled, tgt);
      P.update(1 / 20, h, tgt.x, tgt.z, 500, () => tr.renderer.stats().active);
      most = Math.max(most, P.parkedAt(field).cars);
      for (const c of tr.cars) if (c.fromSpot?.b === field && !seen.has(c.id)) { seen.add(c.id); backedOut++; }
    }
    return { trips: { ...trips }, arrived: (tr.visits.get(field)?.length ?? 0) - before, most, left: P.parkedAt(field).cars, backedOut, spots: P.parkedAt(field).spots };
  };
  const pop = g.sim.population;
  const ordinary = run(12, 15.5); // the afternoon
  const game = run(15.5, 22); // game night, and the drive there
  const after = run(22, 25); // the drive home, to 2 am: who got there by 1 am, and the trips after
  // (fans still driving to the game at 1 am: a drive across the block takes hours on the clock, and someone who gets there
  // at a quarter to two can't be home-bound by two; sightseers, who come by day, aren't the crowd either)
  after.onTheWay = tr.cars.filter((c) => c.destB === field && c.purpose === 'going to the game' && c.crashed !== -1).length;
  const last = run(25, 26);
  for (const [k, n] of Object.entries(last.trips)) after.trips[k] = (after.trips[k] ?? 0) + n;
  after.lateArrived = last.arrived; after.backedOut += last.backedOut; after.left = last.left;
  // the inspector
  g.select({ kind: 'building', b: field });
  for (let k = 0; k < 3; k++) g.frame(0.3);
  const ins = document.querySelector('.inspector')?.textContent?.replace(/\s+/g, ' ') ?? '';
  // a megachurch with no road to it: Sunday morning, nobody comes
  let church = null;
  {
    let far = null;
    for (let k = 0; k < 40 && !far; k++) {
      const x = tgt.x + Math.cos(k) * (300 + k * 10), z = tgt.z + Math.sin(k) * (300 + k * 10);
      if (g.net.pickSeg(x, z, 90)) continue;
      const c = g.canPlaceLandmark('megachurch', x, z, 0);
      if (c.ok) far = { x, z };
    }
    if (far) {
      const b = g.buildings.placeLandmark('megachurch', far.x, far.z, 0);
      b.state = 'active'; b.progress = 1; b.offNet = g.linkProblem(b) ?? undefined;
      trips = {};
      const launch2 = tr.launch;
      let toChurch = 0;
      tr.launch = (...a) => { const c = launch2(...a); if (c && a[3] === b) toChurch++; return c; };
      for (let h = 8.5; h < 10.5; h += 1 / 300) tr.update(1 / 20, 1, h, g.sim.population, g.sim.jobsFilled, tgt);
      church = { off: b.offNet ?? null, trips: toChurch };
      tr.launch = launch2;
    }
  }
  return { field: field.label, pop, ordinary, game, after, ins, church };
});
if (!r.field) check('Slop 69 Field placed beside a road on the block', false);
else {
  const f = (x) => JSON.stringify(x.trips);
  const crowd = Math.round(Math.min(60, r.pop * 0.03));
  console.log(`  ${r.field}, ${r.game.spots} stalls; the town has ${r.pop.toLocaleString()} people, so a crowd of about ${crowd} cars`);
  console.log(`  the afternoon (noon to 3:30 pm):  trips ${f(r.ordinary)}, ${r.ordinary.arrived} arrived, up to ${r.ordinary.most} parked`);
  console.log(`  game night (3:30 to 10 pm):       trips ${f(r.game)}, ${r.game.arrived} arrived, up to ${r.game.most} parked`);
  console.log(`  after the game (10 pm to 2 am):   trips ${f(r.after)}, ${r.after.arrived} more arrived by 1 am and ${r.after.lateArrived} after, ${r.after.backedOut} backed out, ${r.after.left} still parked`);
  const toGame = r.game.trips['going to the game'] ?? 0;
  check(`the afternoon sends nobody to the game (${r.ordinary.trips['going to the game'] ?? 0})`, !r.ordinary.trips['going to the game']);
  check(`game night sends the crowd (${toGame} trips to the game, ${crowd} due)`, toGame >= Math.max(3, crowd * 0.8));
  // (a drive across the block takes 40 s to a minute and a half: a couple of hours on the
  // clock, longer for the crowd's left turns at a signal, so some arrive after 10 pm)
  const came = r.game.arrived + r.after.arrived + r.after.lateArrived;
  check(`they arrive (${r.game.arrived} by 10 pm and ${came} in all, against ${r.ordinary.arrived} in the afternoon)`, came >= Math.max(3, toGame * 0.7) && r.game.arrived > 2 * r.ordinary.arrived);
  check(`and park in its lot (up to ${r.game.most} of ${r.game.spots} stalls; ${r.ordinary.most} in the afternoon)`, r.game.most >= Math.min(r.game.spots * 0.6, toGame * 0.5) && r.game.most > r.ordinary.most);
  // (a lot lets three cars out at a time, each waiting for a gap in the road)
  // the crowd that got there by 1 am: four in five of them have set off home by 2 am
  const fans = toGame - r.after.onTheWay;
  check(`after the game the crowd drives home (${r.after.trips['heading home'] ?? 0} trips by 2 am for the ${fans} fans there by 1 am; ${r.after.onTheWay} still on the way at 1 am; ${r.after.backedOut} backed out of the stalls, ${r.after.left} of ${r.game.most} still parked at 2 am)`, (r.after.trips['heading home'] ?? 0) >= fans * 0.8 && r.after.backedOut >= Math.min(3, r.game.most) && r.after.left < r.game.most);
  const m = r.ins.match(/Visitors today\s*([\d,]+)/);
  check(`the inspector counts today's visitors (${m?.[1] ?? 'none shown'})`, !!m && Number(m[1].replace(/,/g, '')) > 0, r.ins.slice(0, 300));
  check('and says when the games are', /Game night: every evening, 5 pm to 10 pm/.test(r.ins), r.ins.slice(0, 400));
}
if (r.church) check(`a landmark no road reaches draws nobody (megachurch ${r.church.off}: ${r.church.trips} trips to its services)`, r.church.off && r.church.trips === 0);
else console.log('  (no room off the roads for the unconnected megachurch: skipped)');
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
