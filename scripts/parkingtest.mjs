// Live parking and drive-thru lines (audit round 7 #6: "an arriving car pulls in
// for 2.2 s and is deleted; a SprawlMart lot looks the same at 3 am as at noon;
// the drive-thru queue that spills onto the stroad doesn't exist"). On the
// reference block, stepping cars without rendering:
//  - lot occupancy by hour, for lots off screen (on screen only cars that drive
//    in and out change a lot): each lot as full as its curve says (the
//    brand's, from scripts/parkingtags.mjs, or its kind's), offices full
//    mid-morning and empty at night, shops full by day and near empty at 3 am;
//  - arriving cars pull into stalls and stay; leaving ones back out of them;
//  - a grand opening at a drive-thru fills its lane, the line spills onto the
//    road and holds the cars behind it in their lane, and it all clears.
// Then, per preset (Low, High), parked and moving car counts, and the frame
// time and draw calls with the parked cars and without (median of rendered
// frames on this software GPU, with, without, with again: compare the two, not
// the absolute numbers).
// usage: node scripts/parkingtest.mjs [low,high]   (BASE_URL, default http://127.0.0.1:5173; SEED=n
// replays a run: it prints its seed, and the town it was built from)
// Exits 1 on failure.
import { launch } from './lib/browser.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
const presets = (process.argv[2] || 'low,high').split(',');
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await launch();
const pct = (x) => `${Math.round(x * 100)}%`;

// ---- behaviour (once, on the first preset)
{
  const { page, errs, center } = await openBlock(browser, { base, seed: SEED, quality: presets[0] });
  const r = await page.evaluate(async ({ seed, center }) => {
    const { occupancy } = await import('/src/agents/parking.ts');
    const { VEHICLE_SPECS } = await import('/src/agents/vehicles.ts');
    const { generateBuilding } = await import('/src/buildings/generator.ts');
    const { BRANDS } = await import('/src/art/brands.ts');
    // (the import yields to the page: seed again after it, so nothing that ran meanwhile shifts the numbers)
    window.__reseed?.(seed);
    const g = window.__game, tr = g.traffic, P = g.parking;
    // (the camera over the block's middle: the town opens looking at the end of the county road, which was the block's
    // middle only on the first reference town)
    const tgt = g.rts.target.clone();
    tgt.x = center.x; tgt.z = center.z;
    tr.crosswalkWalkers = undefined; // cars only (people and cars: crosswalktest)
    P.inView = () => false; // every lot off screen: they follow the hour
    const step = (hour) => { tr.update(1 / 20, 1, hour, g.sim.population, g.sim.jobsFilled, tgt); P.update(1 / 20, hour, tgt.x, tgt.z, 500, () => tr.renderer.stats().active); };
    const cls = (b) => (b.zone === 'office' ? 'office' : b.zone === 'industry' ? 'industry' : b.zone.startsWith('res') ? 'home' : 'shop');
    const occ = {};
    let pulledIn = 0, backedOut = 0;
    const seen = new Set();
    // trips that left a lot with a car parked in it as long as theirs (parking.ts take: the same kind, or one within
    // 0.4 m), and how many of them backed out of its stall: every one should
    const lots = P.lots, launch0 = tr.launch;
    let couldBack = 0, didBack = 0;
    tr.launch = function (...a) {
      const oB = a[2], len = VEHICLE_SPECS[a[4]]?.length ?? 0;
      const could = !!oB && !!lots.get(oB)?.taken.some((p) => p && p !== 'held' && Math.abs(VEHICLE_SPECS[p.kind].length - len) <= 0.4);
      const c = launch0.apply(this, a);
      if (c && could) { couldBack++; if (c.fromSpot) didBack++; }
      return c;
    };
    const lotsAt = [...g.buildings.list.values()].filter((b) => P.parkedAt(b).spots > 0).map((b) => `${b.label} (${P.parkedAt(b).spots})`);
    for (const hour of [3, 7, 9, 12.5, 16, 19, 23]) {
      for (let f = 0; f < 1200; f++) {
        step(hour);
        for (const c of tr.cars) {
          if (c.toSpot && !seen.has('i' + c.id)) { seen.add('i' + c.id); pulledIn++; }
          if (c.fromSpot && !seen.has('o' + c.id)) { seen.add('o' + c.id); backedOut++; }
        }
      }
      const t = {};
      let want = 0, all = 0;
      for (const b of g.buildings.list.values()) {
        const p = P.parkedAt(b);
        if (!p.spots) continue;
        const k = cls(b);
        t[k] ??= [0, 0];
        t[k][0] += p.cars; t[k][1] += p.spots;
        want += Math.round(p.spots * occupancy(b, hour)); all += p.spots;
      }
      occ[hour] = Object.fromEntries(Object.entries(t).map(([k, [a, n]]) => [k, { share: a / n, spots: n }]));
      occ[hour].all = { share: Object.values(t).reduce((n, [a]) => n + a, 0) / all, spots: all, want: want / all };
    }
    // a grand opening at a drive-thru: the line spills onto the road, then clears
    // (the block's own drive-thru if it has one. The town regrown in 1cbdb6b has none: its one McDougal's became a
    // Brisket Bunker, with no lane, when it levelled up. Then a shop lot gets one here, built by the game's own
    // generator as a drive-thru brand's building (fast food, or a coffee kiosk), on the stroad if it can be. Its lane
    // as the first town's: a coffee kiosk with four places; the shortest lane of four or more the generator gives a
    // stroad lot, the first such lot by id. (Cars already on their way to the lot pull into it as before: only trips
    // that set off once it has a lane go through the line. Not a lot cars are waiting at the kerb of for its drive-thru:
    // the Brisket Bunker has three since it lost its lane, and giving it one back would let them go and hide what they do
    // to the stroad.))
    let thru = [...g.buildings.list.values()].filter((b) => tr.thruAt(b)), made = null;
    if (!thru.length) {
      const food = BRANDS.filter((x) => (x.arch ?? []).some((a) => a === 'fastFood' || a === 'coffee') && x.zones.includes('comLow')).map((x) => x.id);
      const all = [...g.buildings.list.values()].filter((b) => b.zone === 'comLow' && b.state === 'active' && !tr.cars.some((c) => c.thruB === b));
      const onStroad = all.filter((b) => g.net.segs.get(b.seg)?.type === 'stroad4');
      let best = null;
      for (const b of (onStroad.length ? onStroad : all).sort((a, c) => a.id - c.id)) {
        for (const brand of food) {
          for (let k = 0; k < 3; k++) {
            const m = generateBuilding({ zone: 'comLow', level: b.level, widthCells: b.w, depthCells: b.d, seed: b.id * 7919 + k, brand });
            const n = (m.spots ?? []).filter((p) => p.kind === 'thru').length;
            if (n >= 4 && n < (best?.n ?? Infinity)) best = { b, m, n };
          }
        }
      }
      if (best) {
        const b = best.b;
        made = { was: b.label, road: g.net.segs.get(b.seg)?.name };
        b.model = best.m; b.label = best.m.label;
        thru = [b];
        // the traffic's answer for the rebuilt lot (a level-up swaps a building's model the same way). It had asked
        // this lot for a drive-thru before (above, and at every trip there) and kept "none"; the lot's new lanes are
        // only seen if that answer goes with the old model. Where it doesn't, the stale answer is dropped here so the
        // grand opening can be measured, and the check below fails with it.
        made.lane = !!tr.thruAt(b);
        if (!made.lane) tr.thruLanes.delete(b);
      }
    }
    let spill = null;
    if (thru.length) {
      const b = thru[0];
      let spills = 0, maxRoad = 0, heldBehind = 0, heldOthers = 0, clearedAt = -1;
      tr.onDriveThruSpill = () => spills++;
      tr.grandOpening(b);
      for (let f = 0; f < 20 * 900 && clearedAt < 0; f++) {
        step(12.5);
        if (f % 20) continue;
        const s = tr.thruStats().find((x) => x.b === b);
        maxRoad = Math.max(maxRoad, s.onRoad);
        // someone stopped in the lane behind a car waiting for room in the line
        for (const w of tr.cars.filter((c) => c.thruB === b && !c.thru && (c.thruWait ?? 0) > 0)) {
          const st = w.path[w.pi], q = tr.buckets.get(st.seg * 16 + (st.dir > 0 ? 0 : 8) + w.lane) ?? [], i = q.indexOf(w);
          // (whoever it is: the next customer for the line is stopped in the lane as surely as someone driving past.
          // Counting only the ones driving past, a run where everyone behind the line was a customer read as no one held:
          // seed 1 on 18 Nov, seven cars waiting on the road and 0 counted)
          if (i > 0 && q[i - 1].v < 0.5 && w.s - w.len - q[i - 1].s < 8) { heldBehind++; if (q[i - 1].thruB !== b) heldOthers++; }
        }
        if (f > 20 * 300 && s.onRoad === 0) clearedAt = f / 20;
      }
      spill = { b: b.label, made, places: tr.thruStats().find((x) => x.b === b).places, maxRoad, heldBehind, heldOthers, spills, clearedAt };
    }
    return { occ, pulledIn, backedOut, couldBack, didBack, lotsAt, spill, parked: P.count, cap: P.cap };
  }, { seed: SEED, center });
  const row = (h) => Object.entries(r.occ[h]).map(([k, v]) => `${k} ${pct(v.share)} of ${v.spots}${v.want !== undefined ? ` (its curves: ${pct(v.want)})` : ''}`).join(', ');
  for (const h of Object.keys(r.occ).sort((a, b) => a - b)) console.log(`  ${String(h).padStart(4)}:00  ${row(h)}`);
  const o = (h, k) => r.occ[h]?.[k]?.share ?? NaN;
  if (r.occ[3].office) check(`offices fill mid-morning and empty at night (3 am ${pct(o(3, 'office'))}, 9 am ${pct(o(9, 'office'))}, 11 pm ${pct(o(23, 'office'))})`, o(9, 'office') >= 0.6 && o(3, 'office') <= 0.15 && o(23, 'office') <= 0.15);
  const day = Math.max(...[9, 12.5, 16, 19].map((h) => o(h, 'shop')));
  check(`shops fill by day and are near empty at 3 am (${pct(o(3, 'shop'))} at 3 am, up to ${pct(day)} by day)`, day >= 0.4 && o(3, 'shop') <= 0.12);
  const off = Object.keys(r.occ).map((h) => Math.abs(r.occ[h].all.share - r.occ[h].all.want));
  check(`every hour, lots are as full as their curves say (within ${pct(Math.max(...off))}; 12% allowed: cars that drove in stay)`, Math.max(...off) <= 0.12);
  if (r.occ[3].home) check(`homes are full at night, emptier by day (${pct(o(3, 'home'))} at 3 am, ${pct(o(12.5, 'home'))} at noon)`, o(3, 'home') > o(12.5, 'home'));
  check(`arriving cars pull into stalls and stay (${r.pulledIn} in 7 hours)`, r.pulledIn > 5);
  // (every trip that left a lot with a car its length parked in it backs that car out of its stall, and more than three of
  // them, as before: the first reference town had lots at its offices and shops, and 17 backed out in the 7 hours. The
  // town regrown in 1cbdb6b has only the lots printed above, at three shops and a house, so how many back out is how many
  // trips leave those: 1 to 6 on seeds 1-6, and 5 to 10 with the three cars stranded at the Brisket Bunker's kerb let go,
  // which shut the stroad westward and keep the town over its traffic budget, so it starts few new trips at all)
  console.log(`  lots: ${r.lotsAt.join(', ')}`);
  check(`leaving cars back out of their stalls (${r.didBack} of the ${r.couldBack} trips that left a lot with a car their length in it; ${r.backedOut} backed out in all)`, r.didBack === r.couldBack && r.couldBack > 3);
  if (r.spill?.made) check(`a shop lot rebuilt as a drive-thru gets its lane (traffic.ts thruAt: ${r.spill.made.lane ? 'it does' : 'a "no drive-thru" kept from its old model hides the new lane'})`, r.spill.made.lane);
  if (r.spill) {
    if (r.spill.made) console.log(`  (the block has no drive-thru: ${r.spill.made.was} on ${r.spill.made.road} is rebuilt as ${r.spill.b} for the grand opening)`);
    console.log(`  grand opening at ${r.spill.b}: ${r.spill.places} places in the lane, up to ${r.spill.maxRoad} cars waiting on the road, ${r.spill.spills} feed posts, clear after ${r.spill.clearedAt} s`);
    check(`a grand opening spills the drive-thru line onto the road (${r.spill.maxRoad} waiting on it)`, r.spill.maxRoad > 0);
    check(`the spill holds the lane behind it (${r.spill.heldBehind} car-seconds held, ${r.spill.heldOthers} of them drivers who were not going there)`, r.spill.heldBehind > 0);
    check(`the feed says so (${r.spill.spills})`, r.spill.spills > 0);
    check(`and the line clears (${r.spill.clearedAt} s)`, r.spill.clearedAt > 0);
  } else check('the block has a drive-thru', false);
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await page.close();
}

// ---- counts and frame time per preset, with the parked cars and without
for (const q of presets) {
  const { page, errs, center } = await openBlock(browser, { base, seed: SEED, quality: q });
  const m = await page.evaluate((center) => {
    const g = window.__game, P = g.parking;
    g.rts.setView(center.x, center.z, 320, 0.7, 0.6, true);
    window.__dbg.hour(12.5);
    for (let k = 0; k < 6; k++) g.frame(0.5); // the lots near the view fill
    const measure = () => {
      const ms = [], calls = [];
      for (let k = 0; k < 7; k++) { const t0 = performance.now(); g.frame(0.016); ms.push(performance.now() - t0); calls.push(g.renderer.info.render.calls); }
      const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
      return { ms: +med(ms).toFixed(1), calls: med(calls) };
    };
    measure(); // (warm-up: the first frames compile and upload)
    const on = { parked: P.count, moving: g.traffic.cars.length, ...measure() };
    const upd = P.update;
    P.update = () => {};
    for (const b of g.buildings.list.values()) P.clear(b);
    const off = { parked: P.count, moving: g.traffic.cars.length, ...measure() };
    P.update = upd;
    for (let k = 0; k < 6; k++) g.frame(0.5); // the lots fill again
    const on2 = measure();
    on.ms = +((on.ms + on2.ms) / 2).toFixed(1);
    return { on, off, cap: P.cap };
  }, center);
  console.log(`  ${q}: cap ${m.cap} parked; with parking ${m.on.parked} parked + ${m.on.moving} moving, ${m.on.ms} ms a frame, ${m.on.calls} calls; without ${m.off.moving} moving, ${m.off.ms} ms, ${m.off.calls} calls`);
  check(`${q}: parked cars stay within the preset's cap (${m.on.parked} of ${m.cap})`, m.on.parked > 0 && m.on.parked <= m.cap);
  check(`${q}: parked cars add no draw calls (${m.on.calls} vs ${m.off.calls})`, m.on.calls <= m.off.calls + 2);
  check(`${q}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
