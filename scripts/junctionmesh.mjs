// The DRAWN junction meshes, without a browser (docs/cars-look/junction.md). Loads the road renderer through Vite's SSR loader with
// a stub canvas and a stub terrain, builds the reference block's meshes (scripts/refblock.mjs' saved town) and runs, on the real
// triangles, what scripts/roadjunction.mjs runs in a page: casts a ray straight down at a 1 m grid over each junction's roads'
// full-width strips within 14 m of the node and counts the spots where nothing at all is drawn (holes, target 0), and counts
// the asphalt and zebra triangles that face down (target 0). Same numbers on the old code and the new, in seconds.
// usage: node scripts/junctionmesh.mjs [--nodes 45,49] [--quiet]     (run from the checkout to measure)
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--nodes')?.split(',').map(Number);

// ---- a canvas that draws nothing: the renderer paints its road textures into canvases, and only their existence matters here
const noop = () => undefined;
const ctx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4), width: w, height: h });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k === 'measureText') return () => ({ width: 10 });
    return t[k] ?? noop;
  },
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
const THREE = await server.ssrLoadModule('three');
const NET = await server.ssrLoadModule('/src/roads/network.ts');
const MESH = await server.ssrLoadModule('/src/roads/roadMesh.ts');
const RT = await server.ssrLoadModule('/src/roads/roadTypes.ts');
const { ROAD_TYPES } = RT;

const terrain = { h: () => 10, coverAt: () => 0, inBounds: () => true, gradeRoad() {}, forgetRoad() {}, raycast: () => null };
const net = new NET.RoadNetwork(terrain, { cut() {} });
net.map = { id: 'flat' };
net.restore(JSON.parse(readFileSync('shots/lookbook/town.json', 'utf8')).roads);
const rr = new MESH.RoadRenderer(net, { capabilities: { getMaxAnisotropy: () => 4 } });
const t0 = performance.now();
rr.update();
const buildMs = performance.now() - t0;

const surfaces = [...rr.typeMeshes.values(), rr.junctionMesh, rr.concMesh];
for (const m of [...surfaces, rr.crosswalkMesh]) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const hit = (x, z) => { ray.set(new THREE.Vector3(x, 400, z), down); ray.far = 900; return ray.intersectObjects(surfaces, false).length > 0; };
const anySurface = (x, z) => hit(x, z) || hit(x + 0.013, z + 0.017);

const dirOf = (s, nodeId) => {
  const pts = s.samp.pts, atA = s.a === nodeId;
  const p = atA ? pts[0] : pts[pts.length - 1], q = atA ? pts[Math.min(2, pts.length - 1)] : pts[Math.max(0, pts.length - 3)];
  const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
  return { x: (q.x - p.x) / l, z: (q.z - p.z) / l };
};
const nodes = [...net.nodes.values()].filter((n) => n.segs.length >= 3 && (!only || only.includes(n.id)));
let miss = 0, tot = 0, junctions = 0;
const worst = [];
for (const n of nodes) {
  const segs = n.segs.map((id) => net.segs.get(id));
  if (!only && segs.some((s) => !s || ROAD_TYPES[s.type].sidewalk <= 0 || s.length < 30 || s.over)) continue;
  const legs = segs.map((s) => ({ s, h: ROAD_TYPES[s.type].width / 2, line: [] }));
  for (const L of legs) {
    const pts = L.s.samp.pts, atA = L.s.a === n.id;
    let run = 0;
    for (let k = 0; k < pts.length; k++) {
      const p = atA ? pts[k] : pts[pts.length - 1 - k];
      if (L.line.length) run += Math.hypot(p.x - L.line[L.line.length - 1].x, p.z - L.line[L.line.length - 1].z);
      L.line.push(p);
      if (run > 14) break;
    }
  }
  const near = (L, x, z) => { let best = Infinity; for (let k = 0; k + 1 < L.line.length; k++) { const a = L.line[k], b = L.line[k + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, raw = ((x - a.x) * dx + (z - a.z) * dz) / l2; if (k === 0 && raw < 0) return Infinity; const t = Math.max(0, Math.min(1, raw)); best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))); } return best; };
  let m = 0, c = 0;
  const spots = [];
  for (let x = -14; x <= 14; x += 1) for (let z = -14; z <= 14; z += 1) {
    if (!legs.some((L) => near(L, n.x + x, n.z + z) <= L.h - 0.3)) continue;
    c++;
    if (!anySurface(n.x + x, n.z + z)) { m++; if (spots.length < (args.includes("--holes") ? 999 : 4)) spots.push([+(n.x + x).toFixed(1), +(n.z + z).toFixed(1)]); }
  }
  miss += m; tot += c; junctions++;
  if (m) worst.push({ node: n.id, types: segs.map((s) => s.type).join(','), holes: m, of: c, at: spots });
}
const facing = (mesh) => {
  const P = mesh.geometry.getAttribute('position'), I = mesh.geometry.index;
  if (!P) return { down: 0, of: 0 };
  let dn = 0, of = 0;
  const cnt = I ? I.count : P.count;
  for (let k = 0; k + 2 < cnt; k += 3) {
    const a = I ? I.getX(k) : k, b = I ? I.getX(k + 1) : k + 1, c2 = I ? I.getX(k + 2) : k + 2;
    of++;
    if ((P.getZ(b) - P.getZ(a)) * (P.getX(c2) - P.getX(a)) - (P.getX(b) - P.getX(a)) * (P.getZ(c2) - P.getZ(a)) < -1e-9) dn++;
  }
  return { down: dn, of };
};
const tris = (m) => (m.geometry.index ? m.geometry.index.count / 3 : 0);
const allTris = surfaces.reduce((a, m) => a + tris(m), 0) + tris(rr.crosswalkMesh);
const res = {
  junctions, holes: miss, gridPoints: tot, worst,
  zebra: facing(rr.crosswalkMesh), junctionAsphalt: facing(rr.junctionMesh),
  triangles: { junctionMesh: tris(rr.junctionMesh), zebra: tris(rr.crosswalkMesh), concrete: tris(rr.concMesh), roadMeshes: [...rr.typeMeshes.values()].reduce((a, m) => a + tris(m), 0), total: allTris },
  streetDetailInstances: rr.details.group.children.filter((o) => o.isInstancedMesh).reduce((a, o) => a + o.count, 0),
  buildMs: Math.round(buildMs),
};
if (!args.includes('--quiet')) console.log(JSON.stringify(res, null, 1));
let bad = 0;
const check = (label, ok) => { console.log(ok ? 'OK  ' : 'FAIL', label); if (!ok) bad++; };
check(`no holes: ${res.holes} of ${res.gridPoints} grid points in the roads' full-width strips have nothing drawn (${res.junctions} junctions; target 0)`, res.holes === 0);
check(`zebra strips face up: ${res.zebra.down} of ${res.zebra.of} triangles face down`, res.zebra.of > 0 && res.zebra.down === 0);
check(`junction asphalt faces up: ${res.junctionAsphalt.down} of ${res.junctionAsphalt.of} triangles face down`, res.junctionAsphalt.of > 0 && res.junctionAsphalt.down === 0);
await server.close();
process.exit(bad ? 1 : 0);
