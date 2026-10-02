// Goods trucks get out of the factory lots, and the junctions don't lock into
// rings (docs/AUDIT_ROUND8_SIM.md #1 and #2), on a Florida county the
// late-game bot grew to 2,800 people. The same town and seed twice: with this
// round's two fixes, and without them (as before):
//  - a vehicle longer than 8 m waiting at a lot's kerb is let out for 35 s in
//    50, not 12 in 30 (traffic.ts LONG_VEHICLE): a crawling queue has to move a
//    semi's whole length past the gate, and the goods trucks spent three
//    quarters of their time in the factory lots;
//  - a lane's front car held at the line for 20 s by a full lane past the box
//    takes another way out of the junction (REROUTE_T): rings of full blocks,
//    each waiting on the next, stood for good.
// Each run: DAYS game days at ▶▶▶ (everything stepped, nothing drawn): truck
// deliveries a week, the goods trucks' time in a lot, trucks that waited at a
// kerb over a minute, the share of cars moving. Then SOAK seconds of play of
// the town's traffic alone at ▶▶▶ (cars only), watching for a ring: each lane's
// front car held by "no room past the box" on a lane whose front car is held
// the same way, all the way round; and for the longest any lane's front car
// stands still.
// usage: node scripts/gridlocktest.mjs   (BASE_URL, default http://127.0.0.1:5173; SEED=n replays a run;
// TOWN=save.json, default shots/florida2800.json, grown once with the bot if missing; DAYS, default 120;
// SOAK, default 1800). Exits 1 on failure.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { ARGS, EXE, seededInit, seededRandom, testSeed } from './refblock.mjs';
import { installLatePlayer } from './lib/latePlayer.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
const TOWN = process.env.TOWN || 'shots/florida2800.json';
const DAYS = Number(process.env.DAYS || 120), SOAK = Number(process.env.SOAK || 1800);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });

/** a page with Math.random seeded and the game's own loop never started (refblock.mjs seededInit) */
async function seededPage(seed, save) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const errs = [], vault = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.text().startsWith('[vault]')) vault.push(m.text()); });
  await page.addInitScript((save) => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); if (save) localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, save);
  await page.addInitScript(seededInit, { seed, rng: seededRandom.toString() });
  return { page, errs, vault };
}

if (!existsSync(TOWN)) {
  // the bot grows a Florida county from nothing, seeded, so the same town every time
  console.log(`growing a Florida town to 2,800 people (once; saved to ${TOWN})`);
  const { page } = await seededPage(1, null);
  await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 300000 });
  await page.evaluate(installLatePlayer, {});
  let r = { pop: 0, day: 0 };
  while (r.pop < 2800 && r.day < 1500) r = await page.evaluate(() => window.__player.step(10));
  const save = await page.evaluate(() => { window.__dbg.save(); return localStorage.getItem('slopmerica.save.v1'); });
  await page.close();
  mkdirSync(TOWN.replace(/\/[^/]*$/, ''), { recursive: true });
  writeFileSync(TOWN, save);
  console.log(`  grown: ${r.pop.toLocaleString()} people on day ${r.day}`);
}
const save = readFileSync(TOWN, 'utf8');

/** One run of the town: DAYS at ▶▶▶ with this round's fixes or without, then (soak) its traffic alone for SOAK seconds of play */
async function run(long, soak) {
  const { page, errs, vault } = await seededPage(SEED, save);
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForSelector('#continue', { timeout: 300000 });
  await page.click('#continue');
  await page.waitForFunction(() => window.__game && window.__dbg && window.__game.freight, null, { timeout: 300000 });
  const r = await page.evaluate(({ SEED, DAYS, SOAK, long, soak }) => {
    const g = window.__game, tr = g.traffic, F = g.freight;
    cancelAnimationFrame(g.raf);
    window.__reseed(SEED);
    if (!long) { tr.longVehicle = Infinity; tr.rerouteAfter = Infinity; }
    g.sim.speed = 3;
    // rings: each lane's front car stopped by "no room past the box", on a lane (any lane
    // of the road and way it wants) whose front car is stopped the same way, round to itself
    const rings = () => {
      const held = new Map(), bySegDir = new Map();
      for (const [k, q] of tr.buckets) {
        const c = q[q.length - 1];
        if (!c || c.crashed !== 0 || c.v >= 0.3 || c.hold !== 'no room past the box') continue;
        const nx = c.path[c.pi + 1];
        if (!nx) continue;
        held.set(k, nx.seg * 16 + (nx.dir > 0 ? 0 : 8));
        const sd = k - (k % 8);
        if (!bySegDir.has(sd)) bySegDir.set(sd, []);
        bySegDir.get(sd).push(k);
      }
      let n = 0, cars = 0;
      const done = new Set();
      for (const k of held.keys()) {
        if (done.has(k)) continue;
        const on = new Map(), path = [];
        let cur = k;
        while (cur !== undefined && !done.has(cur) && !on.has(cur)) {
          on.set(cur, path.length); path.push(cur);
          const next = bySegDir.get(held.get(cur)) ?? [];
          cur = next.find((x) => on.has(x)) ?? next[0];
        }
        if (cur !== undefined && on.has(cur)) { n++; for (const x of path.slice(on.get(cur))) cars += tr.buckets.get(x)?.length ?? 0; }
        for (const x of path) done.add(x);
      }
      return { n, cars };
    };
    const truck = (c) => /deliver/.test(c.purpose ?? '') && c.crashed === 0;
    const t0 = F.stats().totals, day0 = g.sim.day;
    const kerb = new Map(), seen = new Map();
    let longestKerb = 0, over60 = 0, trips = 0, moving = 0, total = 0, ringSamples = 0, ringCars = 0, inLot = 0, onTrip = 0;
    const frames = Math.ceil((DAYS * 2.5) / 4 / 0.1);
    for (let f = 0; f < frames; f++) {
      g.frame(0.1, false);
      if (f % 5) continue; // every 2 s of traffic
      const live = new Set();
      for (const c of tr.cars) {
        if (!truck(c)) continue;
        live.add(c.id); seen.set(c.id, true);
        onTrip++; if (c.dep > 0) inLot++;
        // waiting at the kerb for a gap: the pull-out time left is held where the nose meets the road
        if (c.dep > 0 && !c.committed && (c.wait ?? 0) > 0 && c.dep <= 1.44) {
          const k = (kerb.get(c.id) ?? 0) + 2; kerb.set(c.id, k);
          if (k === 62) over60++;
          longestKerb = Math.max(longestKerb, k);
        } else kerb.delete(c.id);
      }
      for (const id of seen.keys()) if (!live.has(id)) { trips++; seen.delete(id); }
      for (const c of tr.cars) { if (c.crashed !== 0 || c.dep > 0 || c.arr >= 0 || c.thru) continue; total++; if (c.v > 0.5) moving++; }
      const R = rings();
      if (R.n) { ringSamples++; ringCars = Math.max(ringCars, R.cars); }
    }
    const t1 = F.stats().totals;
    const out = { days: Math.round(g.sim.day - day0), pop: g.sim.population, cars: tr.cars.length, delivered: Math.round(t1.localDelivered - t0.localDelivered), imported: Math.round(t1.imported - t0.imported), trips, longestKerb, over60, inLot: inLot / Math.max(1, onTrip), moving: moving / Math.max(1, total), ringSamples, ringCars };
    if (soak) {
      // the town's traffic alone at ▶▶▶ (the clock turning as in the game: 24 hours in 6 minutes of play at ▶),
      // cars only: the people aren't stepped here, and someone left standing on a crosswalk held its cars for good
      tr.crosswalkWalkers = undefined;
      let soakRings = 0, soakCars = 0, longestHead = 0, headEx = null;
      const still = new Map();
      for (let k = 0; k < SOAK * 10; k++) {
        g.hour = (g.hour + (0.1 * 4 * 24) / 360) % 24;
        tr.update(0.1, 4, g.hour, g.sim.population, g.sim.jobsFilled, g.rts.target);
        if (k % 20) continue;
        const R = rings();
        if (R.n) { soakRings++; soakCars = Math.max(soakCars, R.cars); }
        const heads = new Set();
        for (const q of tr.buckets.values()) {
          const c = q[q.length - 1];
          if (!c || c.crashed !== 0 || c.v >= 0.3) continue;
          heads.add(c.id);
          const t = (still.get(c.id) ?? 0) + 8; still.set(c.id, t);
          if (t > longestHead) {
            // (what held it, where: a failing run says)
            const st = c.path[c.pi], seg = g.net.segs.get(st.seg), node = seg && (st.dir > 0 ? seg.b : seg.a);
            longestHead = t;
            // (and the cars in that junction's box: where each is going and what holds it)
            const box = (tr.junctionCars.get(node) ?? []).filter((o) => o.junction).map((o) => {
              const nx = o.path[o.pi + 1], ns = nx && g.net.segs.get(nx.seg), k = ns ? ns.id * 16 + (nx.dir > 0 ? 0 : 8) + o.junction.lane2 : -1, q = tr.buckets.get(k) ?? [];
              const rear = q[0], head = q[q.length - 1], entry = ns ? tr.entryOf(ns, nx.dir) : 0;
              return { car: o.id, v: +o.v.toFixed(2), t: +o.junction.t.toFixed(2), from: o.junction.fromSeg, next: nx?.seg ?? null, lane2: o.junction.lane2, len: +o.len.toFixed(1), rerouted: o.pi === 0,
                exitLane: { cars: q.length, room: rear ? +(rear.s - rear.len - entry).toFixed(1) : null, rear: rear ? { car: rear.id, v: +rear.v.toFixed(2), hold: rear.hold ?? null, dep: rear.dep > 0 } : null, head: head ? { car: head.id, v: +head.v.toFixed(2), hold: head.hold ?? null, still: still.get(head.id) ?? 0 } : null } };
            });
            headEx = { car: c.id, hold: c.hold ?? null, seg: st.seg, node, lights: tr.signals.has(node), toLine: seg ? +(tr.exitOf(seg, st.dir) - c.s).toFixed(1) : null, next: c.path[c.pi + 1]?.seg ?? null, box };
          }
        }
        for (const id of still.keys()) if (!heads.has(id)) still.delete(id);
      }
      Object.assign(out, { soakRings, soakCars, longestHead, headEx, soakCarsNow: tr.cars.length, reroutes: tr.reroutes });
    }
    return out;
  }, { SEED, DAYS, SOAK, long, soak });
  await page.close();
  return { ...r, errs, vault };
}

const off = await run(false, SOAK > 0);
const on = await run(true, SOAK > 0);
const week = (r) => Math.round(r.delivered / (r.days / 7));
const row = (n, r) => console.log(`  ${n}: ${r.pop.toLocaleString()} people, ${r.cars} cars; goods trucks ${Math.round(r.inLot * 100)}% of their time in a lot, ${r.over60} waited at a kerb over a minute (longest ${r.longestKerb} s); ${week(r)} units a week delivered by truck (${r.delivered}; county-line imports ${r.imported}), ${r.trips} truck trips finished; ${Math.round(r.moving * 100)}% of cars moving; rings at ${r.ringSamples} moments`);
console.log(`${DAYS} days at ▶▶▶ on ${TOWN}:`);
row('trucks let out longer, a held front car takes another way', on);
row('as before', off);
for (const r of [on, off]) if (r.vault.length) console.log(`  (${r.vault.join('; ')}: not the usual town)`);
// (the goods by truck are reported, not checked: over 120 days a dozen or so truck trips finish, and
// which seed it is moves them more than either fix does; over three seeds the courtesy alone gave +21%)
check(`traffic still moves (${Math.round(on.moving * 100)}% of cars moving against ${Math.round(off.moving * 100)}%)`, on.moving >= off.moving * 0.9);
if (SOAK > 0) {
  for (const [n, r] of [['with', on], ['without', off]]) console.log(`  soak ${n}: ${SOAK} s of play at ▶▶▶ (${(SOAK * 4) / 15} hours on the clock), ${r.soakCarsNow} cars at the end; a ring at ${r.soakRings} moments (up to ${r.soakCars} cars); the longest a lane's front car stood still ${r.longestHead} s; ${r.reroutes} front cars took another way out`);
  check(`a ${Math.round(SOAK / 60)}-minute soak at ▶▶▶ is rarely ringed (${on.soakRings} moments against ${off.soakRings}: a quarter at most)`, on.soakRings <= off.soakRings / 4);
  check(`and no lane stands still for good (the longest ${on.longestHead} s against ${off.longestHead} s: a third at most)`, on.longestHead <= off.longestHead / 3, on.headEx);
}
check('no page errors', on.errs.length === 0 && off.errs.length === 0, [...on.errs, ...off.errs].slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
