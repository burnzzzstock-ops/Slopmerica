// The contract between the simulation and whatever shows and sounds it (src/contracts.ts: WorldEvents, WorldFields, ViewTarget).
// On the reference block: game.fields answers every question with sane numbers, a field's shape matches what it says,
// follow targets resolve to where the thing is and to null once it is gone, and every world event that is wired fires with
// the payload the contract gives it. Each wired event is made to happen on the block by script (a road, One More Lane,
// zoning, growth, a bulldozer, a crash, money in a finite treasury, a wildfire) and must fire; the ones whose systems do
// not exist yet (flood, collapseStage, paradisePaved) are listed, not failed.
// usage: BASE_URL=http://127.0.0.1:5173 node scripts/contracttest.mjs
import { launch } from './lib/browser.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await launch();
const { page, errs, center } = await openBlock(browser, { base, quality: 'low', width: 900, height: 600, seed: testSeed() });
let bad = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) bad++; };

const r = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, F = g.fields;
  const seen = (window.__seen = {});
  const NAMES = ['construction', 'demolished', 'levelUp', 'disaster', 'flood', 'fireFront', 'crash', 'moneyTick', 'zonePainted', 'roadBuilt', 'laneAdded', 'treesCleared', 'collapseStage', 'paradisePaved', 'milestone'];
  // (a copy of each payload as it arrives, typed arrays as plain lists; fireFront also notes whether it came as a Float32Array)
  for (const n of NAMES) g.sim.events.on(n, (p) => {
    const c = JSON.parse(JSON.stringify(p, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
    if (n === 'fireFront') c.isF32 = p.points instanceof Float32Array;
    (seen[n] ??= []).push(c);
  });
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

// ---- the world events, each made to happen on the block by script
// the game's own copy of the disasters module (Vite can serve it with a ?t= stamp; a bare import would be a second copy)
const MOD = `(async () => { const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\\/src\\/sim\\/disasters\\.ts/.test(n)); return import(u ? new URL(u).pathname + new URL(u).search : '/src/sim/disasters.ts'); })()`;
const ev = await page.evaluate(async ({ center, mod }) => {
  const g = window.__game, d = window.__dbg, seen = window.__seen;
  const count = (n) => (seen[n] ?? []).length;
  const since = (n, k) => (seen[n] ?? []).slice(k);
  const out = {};
  // a road away from the block's streets: the first of a few spots that will take one
  let k = count('roadBuilt'), made = 0;
  const before = new Set(g.net.segs.keys());
  for (const [dx, dz] of [[420, -260], [-420, 300], [500, 380], [-380, -420], [650, 0], [0, 650]]) {
    const x = center.x + dx, z = center.z + dz;
    const r = d.road(x, z, x + 160, z + 40, 'twoLane');
    if (typeof r === 'number' && r > 0) { made = r; out.roadAt = { x, z }; break; }
  }
  const newSegs = [...g.net.segs.keys()].filter((id) => !before.has(id));
  out.road = { made, newSegs, events: since('roadBuilt', k) };
  // One More Lane on one of its pieces
  k = count('laneAdded');
  const seg = g.net.segs.get(newSegs[0]);
  const upgraded = seg ? g.upgradeRoads([seg]).ok : false;
  out.lane = { upgraded, segId: seg?.id, type: seg?.type, events: since('laneAdded', k) };
  // zoning along it
  k = count('zonePainted');
  const zoned = out.roadAt ? d.zone(out.roadAt.x + 80, out.roadAt.z + 20, 40, 'resLow') : 0;
  out.zone = { zoned, events: since('zonePainted', k) };
  // growth: construction, openings and level-ups
  const kc = count('construction'), kl = count('levelUp');
  d.run(30);
  // (the reference town is full grown: its buildings stand at the level their services allow. A level-up is the same call whoever
  // makes it, so one building is levelled by hand when none came due in the 30 days)
  if (!since('levelUp', kl).length) { const up = [...g.buildings.list.values()].find((b) => b.state === 'active' && b.abandoned === undefined && ['resLow', 'comLow', 'industry'].includes(b.zone) && b.level < 5); if (up) g.buildings.levelUp(up); }
  out.grow = { construction: since('construction', kc), levelUps: since('levelUp', kl), constructionAll: seen.construction ?? [] };
  // the bulldozer
  k = count('demolished');
  const victim = [...g.buildings.list.values()].find((b) => b.state === 'active' && b.zone !== 'service' && b.zone !== 'landmark');
  const want = victim && { bldId: victim.id, x: victim.x, z: victim.z, w: 2 * victim.hw, d: 2 * victim.hd, height: victim.model.height, cause: 'bulldoze' };
  if (victim) g.buildings.demolish(victim, 'bulldozed');
  out.demolish = { want, events: since('demolished', k) };
  // a crash: the fastest car on the road hits the scenery (a test may call Traffic.crash with one car)
  k = count('crash');
  const car = g.traffic.cars.filter((c) => c.crashed === 0 && c.v > 1).sort((a, b) => b.v - a.v)[0];
  const carAt = car && { x: car.x, z: car.z, v: car.v };
  const cseg = car ? g.net.pickSeg(car.x, car.z, 8)?.seg : undefined;
  if (car) g.traffic.crash([car], cseg, false);
  out.crash = { carAt, segId: cseg?.id ?? -1, events: since('crash', k) };
  // money: the block is a sandbox (endless money), which says nothing; a finite treasury says each movement
  k = count('moneyTick');
  const money = g.sim.money;
  g.sim.spend(1234, 'contract test', 'construction');
  out.money = { sandbox: since('moneyTick', k) };
  k = count('moneyTick');
  g.sim.money = 100000;
  g.sim.spend(1234, 'contract test', 'construction');
  g.sim.earn(500, 'resTax', 'contract test');
  g.sim.money = money;
  out.money.finite = since('moneyTick', k);
  // a wildfire (the block is in NorCal), from its warning to its end
  const kd = count('disaster'), kf = count('fireFront');
  const { triggerDisaster, setDisasters, disasterState } = await (0, eval)(mod);
  const sys = window.__ext.systems.find((s) => s.id === 'disasters');
  const was = disasterState().enabled;
  setDisasters(true);
  const day = Math.floor(g.sim.day);
  const lot = [...g.buildings.list.values()].find((b) => b.state === 'active');
  triggerDisaster(g, 'wildfire', lot.x, lot.z);
  sys.daily(g, day + 1);
  sys.daily(g, day + 2);
  sys.daily(g, day + 5);
  out.disaster = { events: since('disaster', kd), fronts: since('fireFront', kf), over: disasterState().event === null };
  setDisasters(was);
  out.trees = seen.treesCleared ?? [];
  return out;
}, { center, mod: MOD });

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
r.seen = await page.evaluate(() => window.__seen);
const fired = Object.keys(r.seen), quiet = r.names.filter((n) => !fired.includes(n));
console.log(`     events seen on the block (14 days, then the script): ${fired.map((n) => `${n} x${r.seen[n].length}`).join(', ') || 'none'}`);
console.log(`     not seen: ${quiet.join(', ') || 'none'}`);
const shapes = {
  construction: (p) => Number.isInteger(p.bldId) && p.progress >= 0 && p.progress <= 1,
  demolished: (p) => Number.isInteger(p.bldId) && [p.x, p.z, p.w, p.d, p.height].every(Number.isFinite) && typeof p.cause === 'string',
  levelUp: (p) => Number.isInteger(p.bldId) && p.level >= 2,
  crash: (p) => [p.x, p.z].every(Number.isFinite) && p.severity >= 0 && p.severity <= 1 && Number.isInteger(p.segId),
  moneyTick: (p) => Number.isFinite(p.delta) && p.delta !== 0 && typeof p.kind === 'string',
  roadBuilt: (p) => Array.isArray(p.segIds) && p.segIds.length > 0,
  laneAdded: (p) => Number.isInteger(p.segId) && p.lanes > 0,
  zonePainted: (p) => p.cells > 0 && [p.x, p.z, p.r].every(Number.isFinite),
  treesCleared: (p) => p.count > 0 && [p.x, p.z, p.r].every(Number.isFinite) && p.r > 0 && ['road', 'building', 'tool', 'fire', 'disaster'].includes(p.cause),
  disaster: (p) => ['hurricane', 'landslide', 'wildfire', 'floridaMan', 'flood', 'heatwave'].includes(p.kind) && ['warn', 'hit', 'response', 'end'].includes(p.phase)
    && [p.x, p.z].every(Number.isFinite) && p.radius > 0 && p.intensity >= 0 && p.intensity <= 1,
  fireFront: (p) => p.isF32 && Array.isArray(p.points) && p.points.length % 2 === 0 && p.points.every(Number.isFinite),
};
// (the shapes above, tightened to the contract's closed sets)
const and = (n, more) => { const base = shapes[n]; shapes[n] = (p) => base(p) && more(p); };
and('demolished', (p) => ['bulldoze', 'fire', 'abandoned', 'disaster', 'collapse'].includes(p.cause) && p.w > 0 && p.d > 0 && p.height > 0);
and('zonePainted', (p) => Number.isInteger(p.cells) && (p.zone === null || typeof p.zone === 'string') && p.r > 0);
and('roadBuilt', (p) => p.segIds.every(Number.isInteger));
and('moneyTick', (p) => ['tax', 'fee', 'grant', 'loan', 'upkeep', 'build', 'refund', 'service', 'disaster', 'other'].includes(p.kind)
  && (p.x === undefined) === (p.z === undefined) && (p.x === undefined || [p.x, p.z].every(Number.isFinite)));
const short = (p) => JSON.stringify(p)?.slice(0, 160);
for (const n of fired) {
  if (!shapes[n]) continue;
  const bad1 = r.seen[n].find((p) => !shapes[n](p));
  check(!bad1, `every '${n}' payload has the contract's shape (${r.seen[n].length}; e.g. ${short(r.seen[n][0])}${bad1 ? `; not: ${short(bad1)}` : ''})`);
}
// every event whose system exists must fire (the script above makes each one happen)
const MUST_FIRE = ['construction', 'demolished', 'levelUp', 'disaster', 'fireFront', 'crash', 'moneyTick', 'zonePainted', 'roadBuilt', 'laneAdded', 'treesCleared'];
for (const n of MUST_FIRE) check(fired.includes(n), `'${n}' fired`);

// ---- what each scripted action said
const e = ev;
check(e.road.made > 0 && e.road.events.length === 1 && [...e.road.events[0].segIds].sort().join() === [...e.road.newSegs].sort().join(),
  `a road build says roadBuilt once, with the pieces it made (${e.road.made} piece(s): ${short(e.road.events.map((p) => p.segIds))})`);
check(e.lane.upgraded && e.lane.events.length === 1 && e.lane.events[0].segId === e.lane.segId && e.lane.events[0].lanes === 4,
  `One More Lane says laneAdded for that piece with its lanes now (piece ${e.lane.segId}, ${e.lane.type}: ${short(e.lane.events)})`);
check(e.zone.zoned > 0 && e.zone.events.length === 1 && e.zone.events[0].cells === e.zone.zoned && e.zone.events[0].zone === 'resLow',
  `a zoning click says zonePainted once, with the lots it changed (${e.zone.zoned}: ${short(e.zone.events)})`);
// construction: tenths on the way up, then 1 exactly once per opening (a level-up starts its site again after the 1)
const runs = {};
for (const p of e.grow.constructionAll) (runs[p.bldId] ??= []).push(p.progress);
let opened = 0, tenthsOk = true, orderOk = true;
for (const list of Object.values(runs)) {
  for (let i = 0; i < list.length; i++) {
    const v = list[i], next = list[i + 1];
    if (Math.abs(v * 10 - Math.round(v * 10)) > 1e-9) tenthsOk = false;
    if (v === 1) { opened++; if (next === 1) orderOk = false; }
    else if (next !== undefined && next <= v) orderOk = false;
  }
}
check(e.grow.construction.length > 0 && opened > 0 && tenthsOk && orderOk,
  `construction comes in tenths, rising, and 1 once when a site opens (${Object.keys(runs).length} sites, ${opened} openings, ${e.grow.constructionAll.length} events)`);
check(e.grow.levelUps.length > 0 && e.grow.levelUps.every((p) => p.level >= 2), `a building levelling up says so (${e.grow.levelUps.length})`);
const dm = e.demolish;
check(!!dm.want && dm.events.length === 1 && Object.keys(dm.want).every((k) => dm.events[0][k] === dm.want[k]),
  `bulldozing a building says demolished once, with its centre, size, height and 'bulldoze' (${short(dm.events[0])})`);
const cr = e.crash, sev = cr.carAt ? Math.min(1, cr.carAt.v / 40) : NaN;
check(!!cr.carAt && cr.events.length === 1 && Math.abs(cr.events[0].severity - sev) < 1e-6 && cr.events[0].segId === cr.segId && Math.hypot(cr.events[0].x - cr.carAt.x, cr.events[0].z - cr.carAt.z) < 1e-6,
  `a crash says where, on which road and how bad (a car at ${cr.carAt?.v.toFixed(1)} m/s: severity ${cr.events[0]?.severity.toFixed(3)}, expected ${sev.toFixed(3)})`);
const mo = e.money;
check(mo.sandbox.length === 0, 'sandbox money (endless) says no moneyTick');
check(mo.finite.length === 2 && mo.finite[0].delta === -1234 && mo.finite[0].kind === 'build' && mo.finite[1].delta === 500 && mo.finite[1].kind === 'tax',
  `a finite treasury says each movement, signed and by kind (${short(mo.finite)})`);
const ds = e.disaster;
check(ds.over && ds.events.map((p) => p.phase).join() === 'warn,hit,response,end' && ds.events.every((p) => p.kind === 'wildfire'),
  `a wildfire says warn, hit, response, end (${ds.events.map((p) => p.phase).join(', ')})`);
check(ds.fronts.length >= 2 && ds.fronts.slice(0, -1).every((p) => p.points.length === 14) && ds.fronts[ds.fronts.length - 1].points.length === 0,
  `its front moves as seven points and ends empty (${ds.fronts.map((p) => p.points.length / 2).join(', ')} points)`);
const causes = [...new Set(e.trees.map((p) => p.cause))].sort();
check(e.trees.length > 0 && e.trees.every((p) => p.count > 0), `trees coming down are said, never with 0 (${e.trees.length} events, causes: ${causes.join(', ')})`);

check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(bad ? `FAIL ${bad} check(s)` : 'OK   the contract holds');
process.exit(bad ? 1 : 0);
