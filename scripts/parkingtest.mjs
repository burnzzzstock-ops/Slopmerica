// Live parking and drive-thru lines (audit round 7 #6: "an arriving car pulls in
// for 2.2 s and is deleted; a SprawlMart lot looks the same at 3 am as at noon;
// the drive-thru queue that spills onto the stroad doesn't exist"). On the
// reference block, stepping cars without rendering:
//  - lot occupancy by hour, for lots off screen (on screen only cars that drive
//    in and out change a lot): offices fill mid-morning and empty at night,
//    shops peak around noon and are near empty at 3 am;
//  - arriving cars pull into stalls and stay; leaving ones back out of them;
//  - a grand opening at a drive-thru fills its lane, the line spills onto the
//    road and holds the cars behind it in their lane, and it all clears.
// Then, per preset (Low, High), parked and moving car counts, and the frame
// time and draw calls with the parked cars and without (median of rendered
// frames on this software GPU, with, without, with again: compare the two, not
// the absolute numbers).
// usage: node scripts/parkingtest.mjs [low,high]   (BASE_URL, default http://127.0.0.1:5173)
// Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const presets = (process.argv[2] || 'low,high').split(',');
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const pct = (x) => `${Math.round(x * 100)}%`;

// ---- behaviour (once, on the first preset)
{
  const { page, errs } = await openBlock(browser, { base, quality: presets[0] });
  const r = await page.evaluate(() => {
    const g = window.__game, tr = g.traffic, P = g.parking, tgt = g.rts.target;
    tr.crosswalkWalkers = undefined; // cars only (people and cars: crosswalktest)
    P.inView = () => false; // every lot off screen: they follow the hour
    const step = (hour) => { tr.update(1 / 20, 1, hour, g.sim.population, g.sim.jobsFilled, tgt); P.update(1 / 20, hour, tgt.x, tgt.z, 500, () => tr.renderer.stats().active); };
    const cls = (b) => (b.zone === 'office' ? 'office' : b.zone === 'industry' ? 'industry' : b.zone.startsWith('res') ? 'home' : 'shop');
    const occ = {};
    let pulledIn = 0, backedOut = 0;
    const seen = new Set();
    for (const hour of [3, 7, 9, 12.5, 16, 19, 23]) {
      for (let f = 0; f < 1200; f++) {
        step(hour);
        for (const c of tr.cars) {
          if (c.toSpot && !seen.has('i' + c.id)) { seen.add('i' + c.id); pulledIn++; }
          if (c.fromSpot && !seen.has('o' + c.id)) { seen.add('o' + c.id); backedOut++; }
        }
      }
      const t = {};
      for (const b of g.buildings.list.values()) {
        const p = P.parkedAt(b);
        if (!p.spots) continue;
        const k = cls(b);
        t[k] ??= [0, 0];
        t[k][0] += p.cars; t[k][1] += p.spots;
      }
      occ[hour] = Object.fromEntries(Object.entries(t).map(([k, [a, n]]) => [k, { share: a / n, spots: n }]));
    }
    // a grand opening at a drive-thru: the line spills onto the road, then clears
    const thru = [...g.buildings.list.values()].filter((b) => tr.thruAt(b));
    let spill = null;
    if (thru.length) {
      const b = thru[0];
      let spills = 0, maxRoad = 0, heldBehind = 0, clearedAt = -1;
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
          if (i > 0 && q[i - 1].v < 0.5 && w.s - w.len - q[i - 1].s < 8 && q[i - 1].thruB !== b) heldBehind++;
        }
        if (f > 20 * 300 && s.onRoad === 0) clearedAt = f / 20;
      }
      spill = { b: b.label, places: tr.thruStats().find((x) => x.b === b).places, maxRoad, heldBehind, spills, clearedAt };
    }
    return { occ, pulledIn, backedOut, spill, parked: P.count, cap: P.cap };
  });
  const row = (h) => Object.entries(r.occ[h]).map(([k, v]) => `${k} ${pct(v.share)} of ${v.spots}`).join(', ');
  for (const h of Object.keys(r.occ).sort((a, b) => a - b)) console.log(`  ${String(h).padStart(4)}:00  ${row(h)}`);
  const o = (h, k) => r.occ[h]?.[k]?.share ?? NaN;
  if (r.occ[3].office) check(`offices fill mid-morning and empty at night (3 am ${pct(o(3, 'office'))}, 9 am ${pct(o(9, 'office'))}, 11 pm ${pct(o(23, 'office'))})`, o(9, 'office') >= 0.6 && o(3, 'office') <= 0.15 && o(23, 'office') <= 0.15);
  check(`shops peak around noon, near empty at 3 am (${pct(o(3, 'shop'))} at 3 am, ${pct(o(12.5, 'shop'))} at noon)`, o(12.5, 'shop') >= 0.4 && o(3, 'shop') <= 0.12);
  if (r.occ[3].home) check(`homes are full at night, emptier by day (${pct(o(3, 'home'))} at 3 am, ${pct(o(12.5, 'home'))} at noon)`, o(3, 'home') > o(12.5, 'home'));
  check(`arriving cars pull into stalls and stay (${r.pulledIn} in 7 hours)`, r.pulledIn > 5);
  check(`leaving cars back out of their stalls (${r.backedOut})`, r.backedOut > 3);
  if (r.spill) {
    console.log(`  grand opening at ${r.spill.b}: ${r.spill.places} places in the lane, up to ${r.spill.maxRoad} cars waiting on the road, ${r.spill.spills} feed posts, clear after ${r.spill.clearedAt} s`);
    check(`a grand opening spills the drive-thru line onto the road (${r.spill.maxRoad} waiting on it)`, r.spill.maxRoad > 0);
    check(`the spill holds the lane behind it (${r.spill.heldBehind} car-seconds held)`, r.spill.heldBehind > 0);
    check(`the feed says so (${r.spill.spills})`, r.spill.spills > 0);
    check(`and the line clears (${r.spill.clearedAt} s)`, r.spill.clearedAt > 0);
  } else check('the block has a drive-thru', false);
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await page.close();
}

// ---- counts and frame time per preset, with the parked cars and without
for (const q of presets) {
  const { page, errs, center } = await openBlock(browser, { base, quality: q });
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
