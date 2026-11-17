// The contract between the simulation and whatever shows and sounds it (src/contracts.ts: WorldEvents, WorldFields, ViewTarget).
// On the reference block: game.fields answers every question with sane numbers, a field's shape matches what it says,
// follow targets resolve to where the thing is and to null once it is gone, and every world event that is wired fires with
// the payload the contract gives it. Events not wired yet are listed, not failed: the list shrinks as systems land.
// usage: BASE_URL=http://127.0.0.1:5173 node scripts/contracttest.mjs
import { launch } from './lib/browser.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await launch();
const { page, errs } = await openBlock(browser, { base, quality: 'low', width: 900, height: 600, seed: testSeed() });
let bad = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) bad++; };

const r = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, F = g.fields;
  const seen = {};
  const NAMES = ['construction', 'demolished', 'levelUp', 'disaster', 'flood', 'fireFront', 'crash', 'moneyTick', 'zonePainted', 'roadBuilt', 'laneAdded', 'treesCleared', 'collapseStage', 'paradisePaved', 'milestone'];
  for (const n of NAMES) g.sim.events.on(n, (p) => { (seen[n] ??= []).push(JSON.parse(JSON.stringify(p, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)))); });
  d.run(12);
  const out = { seen: {}, fields: {}, poses: {} };
  for (const v of ['pollution', 'noise', 'landValue', 'traffic', 'power', 'water', 'sewage', 'garbage', 'fire', 'police', 'health', 'education', 'valuePerAcre', 'commute', 'roadCondition', 'flood', 'heat']) {
    const f = F.fieldFor(v);
    if (!f) { out.fields[v] = null; continue; }
    let n = 0, lo = Infinity, hi = -Infinity;
    for (const x of f.data) if (!Number.isNaN(x)) { n++; lo = Math.min(lo, x); hi = Math.max(hi, x); }
    out.fields[v] = { view: f.view, w: f.w, h: f.h, cellM: f.cellM, len: f.data.length, isF32: f.data instanceof Float32Array, min: f.min, max: f.max, legend: f.legend, version: f.version, n, lo, hi, span: f.w * f.cellM };
  }
  const v1 = F.fieldFor('pollution').version;
  F.fieldFor('pollution');
  const sameDay = F.fieldFor('pollution').version === v1;
  d.run(2);
  const nextDay = F.fieldFor('pollution').version > v1;
  out.cache = { sameDay, nextDay };
  // follow targets
  const car = g.traffic.cars.find((c) => c.crashed === -1) ?? g.traffic.cars[0];
  const b = [...g.buildings.list.values()].find((b) => b.state === 'active');
  out.poses.car = car ? { pose: F.poseOf({ kind: 'car', id: car.id }), at: { x: car.x, z: car.z } } : null;
  out.poses.building = { pose: F.poseOf({ kind: 'building', id: b.id }), at: { x: b.x, z: b.z } };
  out.poses.gone = [F.poseOf({ kind: 'car', id: -5 }), F.poseOf({ kind: 'building', id: -5 }), F.poseOf({ kind: 'person', id: -5 })];
  const ped = g.peds.peds[0];
  out.poses.person = ped ? { pose: F.poseOf({ kind: 'person', id: ped.id }), at: { x: ped.x, z: ped.z }, ids: g.peds.peds.map((p) => p.id) } : null;
  const seg = [...g.net.segs.values()][0];
  out.scalars = { road: F.roadCondition(seg.id), roadGone: F.roadCondition(-5), age: F.buildingAge(b.id), cond: F.buildingCondition(b.id), pol: F.pollutionAt(b.x, b.z), smog: F.smog(), nature: F.naturePct(), simNature: g.sim.naturePct };
  out.seen = seen; out.names = NAMES;
  out.cars = g.traffic.cars.length; out.world = 6144;
  return out;
});

// ---- fields
for (const v of ['pollution', 'noise', 'landValue']) {
  const f = r.fields[v];
  check(!!f, `fieldFor('${v}') gives a field`);
  if (!f) continue;
  check(f.view === v && f.isF32 && f.len === f.w * f.h, `${v}: ${f.w} x ${f.h} cells in a Float32Array of that many values`);
  check(Math.abs(f.span - r.world) < 1e-6, `${v}: cells of ${f.cellM} m span the whole map (${f.span} m)`);
  check(f.max > f.min && f.legend && f.legend.title && ['goodHigh', 'badHigh', 'neutral'].includes(f.legend.ramp) && f.legend.lowLabel && f.legend.highLabel, `${v}: a range (${f.min}..${f.max}) and a legend ("${f.legend?.title}", ${f.legend?.lowLabel} to ${f.legend?.highLabel})`);
  check(f.n > 0 && f.lo >= 0, `${v}: the town has numbers in it (${f.n} cells, ${f.lo.toFixed(2)}..${f.hi.toFixed(2)})`);
}
check(r.cache.sameDay && r.cache.nextDay, 'a field is rebuilt once a game day, and its version says when (same day: same version; two days on: a higher one)');
const pending = Object.entries(r.fields).filter(([, f]) => f === null).map(([v]) => v);
console.log(`     views with no field yet (null): ${pending.join(', ') || 'none'}`);

// ---- scalars
const s = r.scalars;
check(s.road > 0 && s.road <= 1 && s.roadGone === 1, `roadCondition is 0..1 (${s.road.toFixed(3)}), 1 for a road that does not exist`);
check(s.age > 0 && s.cond === 1, `a lived-in building has an age (${s.age.toFixed(0)} days) and condition 1`);
check(s.pol >= 0 && s.smog >= 0 && s.smog <= 1, `pollution at a point (${s.pol.toFixed(3)}) and the town's smog (${s.smog.toFixed(3)}) are in range`);
check(s.nature === s.simNature && s.nature > 0 && s.nature <= 1, `naturePct is the simulation's (${s.nature.toFixed(4)})`);

// ---- follow targets
const near = (p, at) => p && Math.hypot(p.pose.x - at.x, p.pose.z - at.z) < 0.01;
check(r.poses.car && near(r.poses.car, r.poses.car.at) && r.poses.car.pose.radius > 0.5, `a car resolves to where it is (${r.cars} cars; radius ${r.poses.car?.pose.radius.toFixed(1)} m)`);
check(near(r.poses.building, r.poses.building.at) && r.poses.building.pose.speed === 0, 'a building resolves to its lot');
check(r.poses.gone.every((p) => p === null), 'a target that is gone resolves to null');
if (r.poses.person) check(near(r.poses.person, r.poses.person.at) && new Set(r.poses.person.ids).size === r.poses.person.ids.length, `a person resolves to where they are, and no two people share a number (${r.poses.person.ids.length} people)`);
else console.log('     no people were out in this run (the camera decides today); the person target is not exercised');

// ---- events
const fired = Object.keys(r.seen), quiet = r.names.filter((n) => !fired.includes(n));
console.log(`     events seen in 14 days on the block: ${fired.map((n) => `${n} x${r.seen[n].length}`).join(', ') || 'none'}`);
console.log(`     not seen (not wired yet, or nothing of the kind happened): ${quiet.join(', ')}`);
const shapes = {
  construction: (p) => Number.isInteger(p.bldId) && p.progress >= 0 && p.progress <= 1,
  demolished: (p) => Number.isInteger(p.bldId) && [p.x, p.z, p.w, p.d, p.height].every(Number.isFinite) && typeof p.cause === 'string',
  levelUp: (p) => Number.isInteger(p.bldId) && p.level >= 2,
  crash: (p) => [p.x, p.z].every(Number.isFinite) && p.severity >= 0 && p.severity <= 1 && Number.isInteger(p.segId),
  moneyTick: (p) => Number.isFinite(p.delta) && p.delta !== 0 && typeof p.kind === 'string',
  roadBuilt: (p) => Array.isArray(p.segIds) && p.segIds.length > 0,
  laneAdded: (p) => Number.isInteger(p.segId) && p.lanes > 0,
  zonePainted: (p) => p.cells > 0 && [p.x, p.z, p.r].every(Number.isFinite),
  treesCleared: (p) => p.count > 0 && [p.x, p.z, p.r].every(Number.isFinite),
};
for (const n of fired) if (shapes[n]) check(r.seen[n].every(shapes[n]), `every '${n}' payload has the contract's shape (e.g. ${JSON.stringify(r.seen[n][0])})`);
// events that must fire on the block in this run (the list grows as each is wired; see MUST_FIRE)
const MUST_FIRE = (process.env.MUST_FIRE ?? '').split(',').filter(Boolean);
for (const n of MUST_FIRE) check(fired.includes(n), `'${n}' fired`);

check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(bad ? `FAIL ${bad} check(s)` : 'OK   the contract holds');
process.exit(bad ? 1 : 0);
