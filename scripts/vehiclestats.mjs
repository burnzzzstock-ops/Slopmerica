// Vehicle model cost, without a browser (docs/HANDOFF_CARS_LOOK.md item 1): loads the TypeScript through Vite's SSR loader
// and prints, for every vehicle model the renderer can draw, its triangles per level of detail, how long it took to build,
// and its bounding box next to the size the simulation gives that kind (VEHICLE_SPECS: a model may never poke out of it).
// usage: node scripts/vehiclestats.mjs   (exits 1 when a model is over budget or outside its kind's size)
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
const V = await server.ssrLoadModule('/src/agents/vehicles.ts');
const M = await server.ssrLoadModule('/src/agents/models/vehicleModels.ts');
const THREE = await server.ssrLoadModule('three');
const tri = (g) => g ? (g.index?.count ?? g.getAttribute('position').count) / 3 : 0;
let bad = 0;
const rows = [];
const t0 = performance.now();
const list = M.vehicleModelList ? M.vehicleModelList() : Object.keys(V.VEHICLE_SPECS).map((k) => ({ kind: k, id: k }));
for (const m of list) {
  const spec = V.VEHICLE_SPECS[m.kind];
  const t = performance.now();
  const model = M.vehicleModelList ? M.buildVehicleModel(m.kind, spec, m.id) : M.buildVehicleModel(m.kind, spec);
  const ms = performance.now() - t;
  // old code: { near: {shell, detail, lights}, far: {...} }; new code: { close, near, far } are single geometries
  const lod = (l) => !l ? 0 : l.shell ? tri(l.shell) + tri(l.detail) + tri(l.lights) : tri(l);
  const box = new THREE.Box3(), body = new THREE.Box3();
  const nearG = model.near.shell ? [model.near.shell, model.near.detail] : [model.close ?? model.near];
  for (const g of nearG) if (g) { g.computeBoundingBox(); box.union(g.boundingBox); }
  if (model.near.shell) { model.near.shell.computeBoundingBox(); body.copy(model.near.shell.boundingBox); } else body.copy(box);
  const size = box.getSize(new THREE.Vector3());
  const row = { id: m.id, kind: m.kind, close: lod(model.close), near: lod(model.near), far: lod(model.far), ms: +ms.toFixed(1), w: +size.x.toFixed(2), h: +size.y.toFixed(2), l: +size.z.toFixed(2), specW: spec.width, specH: spec.height, specL: spec.length };
  rows.push(row);
}
console.log('id'.padEnd(24), 'close'.padStart(6), 'near'.padStart(6), 'far'.padStart(5), '  ms', '   w×h×l (model)      spec');
for (const r of rows) {
  // the same limits scripts/vehicletest.mjs gates on (mirrors, a bike's rider and accessories may stick out a little)
  const over = r.l > r.specL * 1.04 + 0.1 || r.w > r.specW + 0.55 || r.h > (r.kind === 'motorcycle' ? 1.9 : r.specH * 1.06 + 0.2);
  const big = ['semi', 'boxTruck', 'ambulance', 'firetruck', 'cityBus', 'garbageTruck', 'towTruck', 'liftedTruck', 'pickup'].includes(r.kind);
  const flags = [over ? 'OUTSIDE-SIZE' : '', r.close > (big ? 5000 : 2500) ? 'CLOSE-OVER' : '', r.near > (big ? 1600 : 1200) ? 'NEAR-OVER' : '', r.far > 350 && r.far !== r.near ? 'FAR-OVER' : ''].filter(Boolean);
  if (flags.length) bad++;
  console.log(r.id.padEnd(24), String(r.close).padStart(6), String(r.near).padStart(6), String(r.far).padStart(5), String(r.ms).padStart(5), `  ${r.w}×${r.h}×${r.l}`.padEnd(22), `${r.specW}×${r.specH}×${r.specL}`, flags.join(' '));
}
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(`${rows.length} models · triangles close ${sum('close')} near ${sum('near')} far ${sum('far')} · build ${(performance.now() - t0).toFixed(0)} ms total`);
await server.close();
process.exit(bad ? 1 : 0);
