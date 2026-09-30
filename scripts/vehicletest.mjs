// Vehicle models and renderer checks that need no browser (docs/HANDOFF_CARS_LOOK.md, items 1-4). Loads the TypeScript with Vite's SSR loader
// and builds the real VehicleRenderer in Node (no GL is needed until something is drawn).
//   * 19 kinds + 40 more models = 59; every kind keeps its own base model; ids unique;
//   * every model fits its kind's size (VEHICLE_SPECS is used by the simulation; mirrors and the joke flag are the only things allowed out);
//   * triangle budgets: close ~2,500 (trucks and buses 5,000), near about 1,000, far about 200;
//   * draw calls: ONE mesh per model per level of detail (paint, glass, trim, tyres and lamps used to be three meshes per kind);
//   * the paint mix is real (about three-quarters white, black, grey and silver), finishes vary, one car in six is a beater, mud only on trucks;
//   * liveried kinds keep their fixed paint; the renderer never draws from Math.random (the simulation's stream is not touched);
//   * the optional API exists (setParked, setReversing, setHeadlights, setSiren, setEnvironment) and parked cars stop their wheels;
//   * wheels: forwards spins the top of the tyre forwards, backing up spins it back, a left turn steers toward the left.
// usage: node scripts/vehicletest.mjs      exits 1 on a failure
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
const V = await server.ssrLoadModule('/src/agents/vehicles.ts');
const M = await server.ssrLoadModule('/src/agents/models/vehicleModels.ts');
const P = await server.ssrLoadModule('/src/agents/models/vehiclePaint.ts');
const Wh = await server.ssrLoadModule('/src/agents/models/vehicleWheel.ts');
const THREE = await server.ssrLoadModule('three');
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };

// ------------------------------------------------------------------------------------------------------------ the models
const list = M.vehicleModelList();
const kinds = Object.keys(V.VEHICLE_SPECS);
check(`59 models: 19 kinds + 40 more (${list.length})`, list.length === 59, { kinds: kinds.length });
check('ids are unique', new Set(list.map((m) => m.id)).size === list.length);
check('every kind has its own base model, registered first', kinds.every((k) => list.find((m) => m.kind === k)?.id === k));
const extras = kinds.map((k) => `${k}:${list.filter((m) => m.kind === k).length - 1}`).join(' ');
console.log('     extra models per kind:', extras);
const truck = new Set(['semi', 'boxTruck', 'ambulance', 'firetruck', 'cityBus', 'garbageTruck', 'towTruck', 'liftedTruck', 'pickup']);
const rows = [];
for (const m of list) {
  const spec = V.VEHICLE_SPECS[m.kind];
  const model = M.buildVehicleModel(m.kind, spec, m.id);
  const tri = (g) => (g.index?.count ?? g.getAttribute('position').count) / 3;
  const box = new THREE.Box3();
  for (const g of [model.close, model.near]) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  rows.push({ id: m.id, kind: m.kind, close: tri(model.close), near: tri(model.near), far: tri(model.far), w: size.x, h: size.y, l: size.z, spec });
}
// (a rider stands taller than the motorbike's 1.3 m spec; the sim's box for a bike is the bike)
const tooBig = rows.filter((r) => r.l > r.spec.length * 1.04 + 0.1 || r.w > r.spec.width + 0.55 || r.h > (r.kind === 'motorcycle' ? 1.9 : r.spec.height * 1.06 + 0.2)).map((r) => `${r.id} ${r.w.toFixed(2)}x${r.h.toFixed(2)}x${r.l.toFixed(2)} vs ${r.spec.width}x${r.spec.height}x${r.spec.length}`);
check('every model fits its kind\'s size (mirrors and accessories allowed out a little)', tooBig.length === 0, tooBig);
const closeOver = rows.filter((r) => r.close > (truck.has(r.kind) ? 5000 : 2500) * (r.kind === 'liftedTruck' ? 1 : 1)).map((r) => `${r.id} ${r.close}`);
check('close level within budget (2,500; 5,000 for trucks and buses)', closeOver.length === 0, closeOver);
const nearOver = rows.filter((r) => r.near > (truck.has(r.kind) ? 1600 : 1200)).map((r) => `${r.id} ${r.near}`);
check('near level within budget (about 1,000; the old semi was 1,606)', nearOver.length === 0, nearOver);
const farOver = rows.filter((r) => r.far > 350).map((r) => `${r.id} ${r.far}`);
check('far level small (target 200, at most 350)', farOver.length === 0, farOver);
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(`     ${rows.length} models: close ${sum('close')} tris (avg ${Math.round(sum('close') / rows.length)}), near ${sum('near')} (avg ${Math.round(sum('near') / rows.length)}), far ${sum('far')} (avg ${Math.round(sum('far') / rows.length)}); old code: 19 kinds, near 19,906 (avg 1,048), far 2,720 (avg 143)`);
check('every model has lamps the effects pass can use (head, tail)', list.every((m) => { const l = M.buildVehicleModel(m.kind, V.VEHICLE_SPECS[m.kind], m.id).lamps; return l.head.length > 0 && l.tail.length > 0; }));

// ------------------------------------------------------------------------------------------------------------ paint and wear
let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const N = 20000, buckets = { neutral: 0, blueRed: 0, other: 0 }, finishes = [0, 0, 0, 0];
let beaters = 0, mud = 0, mudNonTruck = 0, primer = 0;
const cars = ['sedan', 'suv', 'hatchback', 'minivan', 'pickup', 'liftedTruck'];
const lin2s = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
for (let i = 0; i < N; i++) {
  const kind = cars[i % cars.length];
  const look = P.pickLook(kind, undefined, false, rnd);
  const [r, g, b] = look.rgb.map(lin2s);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn <= 30) buckets.neutral++; else if (b - Math.max(r, g) > 20 || (r - Math.max(g, b) > 55 && g < 110)) buckets.blueRed++; else buckets.other++;
  finishes[look.finish]++;
  if (look.age > 0.55) beaters++;
  if (look.special >= 8) { mud++; if (kind !== 'liftedTruck' && kind !== 'pickup') mudNonTruck++; }
  if (look.special % 8 > 0) primer++;
}
const share = (n) => n / N;
check(`about three-quarters of cars are white, black, grey or silver (${(share(buckets.neutral) * 100).toFixed(0)}%)`, share(buckets.neutral) > 0.68 && share(buckets.neutral) < 0.84);
check(`blue and red next (${(share(buckets.blueRed) * 100).toFixed(0)}%), the rest is accents (${(share(buckets.other) * 100).toFixed(0)}%)`, share(buckets.blueRed) > 0.07 && share(buckets.other) < 0.16);
check(`finishes vary: solid ${(share(finishes[0]) * 100).toFixed(0)}%, metallic ${(share(finishes[1]) * 100).toFixed(0)}%, matte ${(share(finishes[2]) * 100).toFixed(0)}%, pearl ${(share(finishes[3]) * 100).toFixed(0)}%`, finishes[0] > N * 0.2 && finishes[1] > N * 0.3 && finishes[2] + finishes[3] > N * 0.02);
check(`about one car in six is a beater (${(share(beaters) * 100).toFixed(0)}%), some with a primer panel or another car's door (${(share(primer) * 100).toFixed(0)}%)`, share(beaters) > 0.11 && share(beaters) < 0.24 && share(primer) > 0.06);
check(`mud only on pickups and lifted trucks (${mud} mud, ${mudNonTruck} elsewhere)`, mud > 0 && mudNonTruck === 0);
const cyber = P.pickLook('cyberslop', undefined, false, rnd);
check('the Cyberslop stays stainless', cyber.finish === 3 && cyber.rgb.every((c) => c > 0.4 && c < 0.8));

// ------------------------------------------------------------------------------------------------------------ the renderer
const scene = new THREE.Scene();
const realRandom = Math.random; let randomCalls = 0; Math.random = () => { randomCalls++; return realRandom(); };
const R = new V.VehicleRenderer(scene, 400);
while (R.pending.length) R.warm(); // (Three itself draws ids from Math.random when it makes an object, so build every model first)
randomCalls = 0;
check('choosing a paint, a look and a model for 2,000 cars never draws from Math.random (the simulation\'s stream stays its own)', (() => {
  const hs = [];
  for (let i = 0; i < 2000; i++) { const h = R.add(kinds[i % kinds.length], V.FIXED_PAINT[kinds[i % kinds.length]] ?? 0xf2f2f2); if (h >= 0) hs.push(h); if (hs.length > 300) R.remove(hs.shift()); }
  for (const h of hs) R.remove(h);
  return randomCalls === 0;
})(), { randomCalls });
Math.random = realRandom;
for (const m of ['setParked', 'setReversing', 'setHeadlights', 'setSiren', 'setEnvironment', 'setLodOverride']) check(`optional API: ${m}`, typeof R[m] === 'function');
check('the required API is unchanged: add, remove, set, setBraking, setTurn, setDamaged, setNight, updateLod, flush, pick, stats, dispose',
  ['add', 'remove', 'set', 'setBraking', 'setTurn', 'setDamaged', 'setNight', 'updateLod', 'flush', 'pick', 'stats', 'dispose'].every((m) => typeof R[m] === 'function'));
// liveries
const camera = new THREE.PerspectiveCamera(50, 1.6, 1, 5000); camera.position.set(0, 8, 0); camera.lookAt(0, 0, 100); camera.updateMatrixWorld(true);
for (const k of Object.keys(V.FIXED_PAINT)) {
  const h = R.add(k, V.FIXED_PAINT[k]); const b = R.batches.get(k); const i = R.slots[h].instance;
  const want = new THREE.Color(V.FIXED_PAINT[k]);
  check(`livery kept: ${k}`, Math.abs(b.paint[i * 3] - want.r) < 1e-4 && Math.abs(b.paint[i * 3 + 1] - want.g) < 1e-4 && Math.abs(b.paint[i * 3 + 2] - want.b) < 1e-4);
  R.remove(h);
}
// draw calls, on the same 100-car scene through the new renderer and through the frozen old one (OLD=/path/to/old/tree, default ../snap/before):
// a town like the reference block (the traffic mix, 8% of cars within 46 m of the camera, 20% out to 180 m, the rest farther)
const scene100 = () => {
  let s2 = 7; const rr = () => (s2 = (s2 * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 100 }, () => {
    const kind = V.randomVehicleKind(rr), u = rr();
    return { kind, d: u < 0.08 ? 12 + rr() * 32 : u < 0.28 ? 50 + rr() * 125 : 190 + rr() * 900, x: (rr() - 0.5) * 30 };
  });
};
const drawsFor = async (mod, THREE3) => {
  const cam = new THREE3.PerspectiveCamera(50, 1.6, 1, 5000); cam.position.set(0, 8, 0); cam.lookAt(0, 0, 100); cam.updateMatrixWorld(true);
  const sc = new THREE3.Scene(), r = new mod.VehicleRenderer(sc, 400);
  while (r.pending?.length) r.warm();
  const hs = scene100().map(({ kind, d, x }) => { const h = r.add(kind, 0xf2f2f2); r.set(h, x, 0, d, 0); return h; });
  for (let k = 0; k < 24; k++) { r.updateLod(cam); r.flush(); } // (the close level of a model is built the first time a car comes into range, one a frame)
  const drawn = r.object.children.filter((o) => (o.isInstancedMesh ? o.count > 0 && !o.name.endsWith('-pick') : o.isMesh && o.geometry?.instanceCount > 0 && o.visible !== false));
  const tris = drawn.reduce((a, o) => a + (o.isInstancedMesh ? ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) * o.count : 0), 0);
  const out = { calls: drawn.length, tris: Math.round(tris), close: drawn.filter((o) => o.name.endsWith('-close')).length, fx: drawn.filter((o) => o.name === 'vehicle-fx').length };
  for (const h of hs) r.remove(h);
  return out;
};
// start-up: the renderer builds only near and far geometry for the 19 kinds (everything else on demand)
{
  const t0 = performance.now(); const tmp = new V.VehicleRenderer(new THREE.Scene(), 400); const ms = performance.now() - t0; tmp.dispose();
  console.log(`     start-up (build the 19 kinds' meshes): ${ms.toFixed(0)} ms in Node`);
  globalThis.__startMs = ms;
}
const now = await drawsFor(V, THREE);
console.log(`     100-car town, new renderer: ${now.calls} draw calls (${now.close} for close-range models, ${now.fx} effects), ${now.tris} triangles drawn`);
try {
  const oldRoot = process.env.OLD || '../snap/before';
  const oldServer = await createServer({ root: oldRoot, configFile: false, server: { middlewareMode: true, watch: null, hmr: false, port: 5299 }, appType: 'custom', logLevel: 'silent' });
  const OV = await oldServer.ssrLoadModule('/src/agents/vehicles.ts');
  const OT = await oldServer.ssrLoadModule('three');
  const before = await drawsFor(OV, OT);
  console.log(`     the same town, frozen old renderer: ${before.calls} draw calls, ${before.tris} triangles drawn`);
  const t1 = performance.now(); const oldR = new OV.VehicleRenderer(new OT.Scene(), 400); const oldMs = performance.now() - t1; oldR.dispose();
  console.log(`     start-up of the old renderer: ${oldMs.toFixed(0)} ms in Node (new ${globalThis.__startMs.toFixed(0)} ms)`);
  check('the same town costs no more draw calls than before, even with the close level and the effects', now.calls <= before.calls, { now: now.calls, before: before.calls });
  await oldServer.close();
} catch (e) { console.log('     (no frozen old renderer to compare with:', String(e.message).split('\n')[0], ')'); }
check('the effects (halos, road pools, siren tint, exhaust, dust, spray) are one call in all', now.fx <= 1);

// parked cars, wheels, backing up
{
  const h = R.add('sedan', 0xffffff, { exact: true }), b = R.batches.get('sedan'), i = R.slots[h].instance;
  R.set(h, 0, 0, 0, 0); R.flush();
  R.set(h, 0, 0, 1, 0); const forward = b.spin[i];
  check('rolling forwards turns the wheels forwards (spin grows)', forward > 0, { forward });
  R.set(h, 0, 0, 0, 0); const back = b.spin[i];
  check('backing up turns them back', back < forward, { forward, back });
  check('backing up lights the reverse lamps by itself', b.reverseTimer[i] > 0);
  R.setParked(h, true);
  const s0 = b.spin[i]; R.set(h, 0, 0, 3, 0); R.flush();
  check('a parked car\'s wheels do not turn (the lamps go off)', b.spin[i] === s0 && b.parked[i] === 1 && b.headlights[i] === 1);
  R.setParked(h, false);
  R.remove(h);
}
// suspension: a 6 cm step in the road under a car kicks the body, which then settles within a second and stays within a few centimetres (purely a drawing effect)
{
  const h = R.add('sedan', 0xffffff, { exact: true }), b = R.batches.get('sedan'), i = R.slots[h].instance;
  R.set(h, 0, 0, 20, 0); R.flush(1 / 60);
  let peak = 0, y = 0;
  for (let f = 0; f < 240; f++) { if (f === 10) y = 0.06; R.set(h, 0, y, 20 + f * 0.3, 0); R.flush(1 / 60); peak = Math.max(peak, Math.abs(b.heave[i])); }
  check(`a 6 cm step in the road moves the body (peak ${(peak * 100).toFixed(1)} cm) and it settles (${(Math.abs(b.heave[i]) * 1000).toFixed(1)} mm after 4 s)`, peak > 0.004 && peak < 0.06 && Math.abs(b.heave[i]) < 0.004, { peak, end: b.heave[i] });
  R.setParked(h, true);
  for (let f = 0; f < 90; f++) R.flush(1 / 60);
  check('a parked car sits still on its springs', Math.abs(b.heave[i]) < 1e-3 && Math.abs(b.pitch[i]) < 1e-3 && Math.abs(b.roll[i]) < 1e-3);
  R.remove(h);
}
// the shader's turn, written twice (GLSL and JS): rolling and steering follow the conventions in vehicleWheel.ts
{
  const r = 0.33, spin = 0.2;
  const top = Wh.spinYZ(r, 0, spin), bottom = Wh.spinYZ(-r, 0, spin);
  check('spin: the top of the tyre moves toward the front of the car, the bottom toward the back', top[1] > 0 && bottom[1] < 0, { top, bottom });
  check('rolling: a wheel that turns v / r a second while its hub moves at v has its bottom point still on the road', (() => {
    const v = 10, dt = 0.01, w = v / r; const b1 = Wh.spinYZ(-r, 0, w * dt); const groundVelocity = v + (b1[1] - 0) / dt; return Math.abs(groundVelocity) < 0.2 * v;
  })());
  const nose = Wh.steerXZ(0, 1, 0.3);
  check('steer: a left turn (positive) moves the front of the wheel toward the car\'s left (+x)', nose[0] > 0 && nose[1] > 0, { nose });
  // the same two rotations as the OLD shader wrote them (mat2(wc, -ws, ws, wc) for the spin, mat2(sc, ss, -ss, sc) for the steer): the checks above fail on them
  const oldSpin = (y, z, a) => [Math.cos(a) * y + Math.sin(a) * z, -Math.sin(a) * y + Math.cos(a) * z];
  const oldSteer = (x, z, a) => [Math.cos(a) * x - Math.sin(a) * z, Math.sin(a) * x + Math.cos(a) * z];
  check('(the old shader\'s spin turned the top of a rolling tyre toward the BACK of the car)', oldSpin(r, 0, spin)[1] < 0, { top: oldSpin(r, 0, spin) });
  check('(the old shader\'s steer turned the front of a wheel toward the RIGHT for a left turn)', oldSteer(0, 1, 0.3)[0] < 0, { nose: oldSteer(0, 1, 0.3) });
  const glsl = Wh.WHEEL_GLSL;
  check('the shader uses those same two rotations', glsl.includes('mat2(wc, ws, -ws, wc)') && glsl.includes('mat2(sc, -ss, ss, sc)'));
}
R.dispose();
await server.close();
console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
