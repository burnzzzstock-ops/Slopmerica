// Junction check (docs/ART_DIRECTION.md, graphics handoff item 1). On the reference block it
// measures the *drawn* junctions by casting rays down onto the road meshes, so the same script
// runs against the old code and the new:
//
//   corner radius   how far the asphalt reaches past the sharp corner where the two curb lines
//                   would meet, turned into the radius of the circular arc that would reach that
//                   far (reach = r (1 / sin(phi/2) - 1)). A square corner reads 0 (the old asphalt
//                   stopped 0.4 m short of that point), a curb return of 4 to 8 m reads 4 to 8.
//   holes           spots (1 m grid) inside the roads' full-width strips within 14 m of the node
//                   where no road surface is drawn at all: the notches at the old corners
//   crosswalk       triangles of the zebra strips that face down (the old strips were wound the
//                   wrong way on some arms and rendered dark olive)
//   junction        triangles of the asphalt mesh that face down (must be 0)
//
// usage: BASE_URL=http://127.0.0.1:5175 node scripts/roadjunction.mjs [quality]
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'low';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, quality });
const m = await page.evaluate(async () => {
  const g = window.__game;
  const { ROAD_TYPES, carriageHalf } = await import('/src/roads/roadTypes.ts');
  const Ray = g.rts.ray.constructor, V3 = g.camera.position.constructor;
  const roads = g.roads;
  const typeMeshes = [...roads.typeMeshes.entries()];
  const all = [...roads.typeMeshes.values(), roads.junctionMesh, roads.concMesh];
  for (const o of all) o.updateMatrixWorld(true);
  const ray = new Ray();
  const hits = (x, z, objs) => { ray.set(new V3(x, 400, z), new V3(0, -1, 0)); ray.far = 900; const out = []; for (const o of objs) for (const h of ray.intersectObject(o, false)) out.push({ o, h }); return out; };
  // (a ray that lands exactly on a shared triangle edge can slip between the two, so a point counts as a hole only when a second ray a hair away misses too)
  const anySurface = (x, z) => hits(x, z, all).length > 0 || hits(x + 0.013, z + 0.017, all).length > 0;
  const asphalt = (x, z) => {
    for (const { o, h } of hits(x, z, [roads.junctionMesh, ...roads.typeMeshes.values()])) {
      if (o === roads.junctionMesh) return true;
      const id = typeMeshes.find(([, mesh]) => mesh === o)[0], t = ROAD_TYPES[id];
      const off = (h.uv.x * 2 - 1) * (t.width / 2);
      if (Math.abs(off) <= carriageHalf(t) - 0.05) return true;
    }
    return false;
  };
  const dirOf = (s, nodeId) => {
    const pts = s.samp.pts, atA = s.a === nodeId;
    const p = atA ? pts[0] : pts[pts.length - 1], q = atA ? pts[Math.min(2, pts.length - 1)] : pts[Math.max(0, pts.length - 3)];
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    return { x: (q.x - p.x) / l, z: (q.z - p.z) / l };
  };
  const c0 = g.startView();
  const nodes = [...g.net.nodes.values()].filter((n) => n.segs.length >= 3 && Math.hypot(n.x - c0.x, n.z - c0.z) < 520)
    .sort((a, b) => Math.hypot(a.x - c0.x, a.z - c0.z) - Math.hypot(b.x - c0.x, b.z - c0.z));
  const radii = [], holes = { n: 0, of: 0, junctions: 0, at: [] };
  let used = 0;
  for (const n of nodes) {
    const segs = n.segs.map((id) => g.net.segs.get(id));
    if (segs.some((s) => !s || ROAD_TYPES[s.type].sidewalk <= 0 || s.length < 30 || s.over)) continue;
    if (used++ >= 22) break;
    const legs = segs.map((s) => { const u = dirOf(s, n.id), t = ROAD_TYPES[s.type]; return { s, u, r: { x: -u.z, z: u.x }, e: carriageHalf(t) + 0.3, h: t.width / 2, ang: Math.atan2(u.z, u.x) }; }).sort((a, b) => a.ang - b.ang);
    // each leg's real centreline, the first 14 m from the node (the roads bend a little, so a straight strip would drift off the ribbon)
    for (const L of legs) {
      const pts = L.s.samp.pts, atA = L.s.a === n.id, line = [];
      let run = 0;
      for (let k = 0; k < pts.length; k++) {
        const p = atA ? pts[k] : pts[pts.length - 1 - k];
        if (line.length) run += Math.hypot(p.x - line[line.length - 1].x, p.z - line[line.length - 1].z);
        line.push(p);
        if (run > 14) break;
      }
      L.line = line;
    }
    // (distance to the leg's centreline, one-sided: nothing behind the node counts)
    const near = (L, x, z) => { let best = Infinity; for (let k = 0; k + 1 < L.line.length; k++) { const a = L.line[k], b = L.line[k + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, raw = ((x - a.x) * dx + (z - a.z) * dz) / l2; if (k === 0 && raw < 0) return Infinity; const t = Math.max(0, Math.min(1, raw)); best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))); } return best; };
    // holes: 1 m grid over the union of the roads' full-width strips, out to 14 m
    let miss = 0, tot = 0;
    for (let x = -14; x <= 14; x += 1) for (let z = -14; z <= 14; z += 1) {
      if (!legs.some((L) => near(L, n.x + x, n.z + z) <= L.h - 0.3)) continue;
      tot++;
      if (!anySurface(n.x + x, n.z + z)) { miss++; if (holes.at.length < 6) { const L = legs.find((q) => near(q, n.x + x, n.z + z) <= q.h - 0.3); holes.at.push([+(n.x + x).toFixed(1), +(n.z + z).toFixed(1), `node ${n.id} ${L.s.type} d=${near(L, n.x + x, n.z + z).toFixed(2)} h=${L.h} line0=${JSON.stringify(L.line[0])} line1=${JSON.stringify(L.line[1])}`]); } }
    }
    holes.n += miss; holes.of += tot; holes.junctions++;
    // corner radius at the near-right-angle corners
    for (let k = 0; k < legs.length; k++) {
      const Li = legs[k], Lj = legs[(k + 1) % legs.length];
      let phi = Lj.ang - Li.ang; if (phi <= 0) phi += Math.PI * 2;
      if (phi < 1.2 || phi > 2.0) continue;
      // P: where the two curb lines meet. Li.u s + Li.r ei = Lj.u s' - Lj.r ej
      const rhs = { x: -(Li.r.x * Li.e + Lj.r.x * Lj.e), z: -(Li.r.z * Li.e + Lj.r.z * Lj.e) };
      const A = Li.u, B = { x: -Lj.u.x, z: -Lj.u.z }, det = A.x * B.z - A.z * B.x;
      const s = (rhs.x * B.z - rhs.z * B.x) / det;
      const P = { x: Li.u.x * s + Li.r.x * Li.e, z: Li.u.z * s + Li.r.z * Li.e };
      const dP = Math.hypot(P.x, P.z), d = { x: P.x / dP, z: P.z / dP };
      let last = 0;
      for (let q = 0; q <= dP + 7; q += 0.04) if (asphalt(n.x + d.x * q, n.z + d.z * q)) last = q;
      const reach = last - dP;
      radii.push({ node: n.id, phi: +phi.toFixed(2), reach: +reach.toFixed(2), r: Math.max(0, reach) / (1 / Math.sin(phi / 2) - 1) });
    }
  }
  // the winding of the zebra strips and the asphalt mesh
  const down = (mesh) => {
    const geo = mesh.geometry, P = geo.getAttribute('position'), I = geo.index;
    if (!P) return { down: 0, of: 0 };
    let dn = 0, of = 0;
    const where = [];
    const cnt = I ? I.count : P.count;
    for (let k = 0; k + 2 < cnt; k += 3) {
      const a = I ? I.getX(k) : k, b = I ? I.getX(k + 1) : k + 1, c = I ? I.getX(k + 2) : k + 2;
      const ux = P.getX(b) - P.getX(a), uz = P.getZ(b) - P.getZ(a), vx = P.getX(c) - P.getX(a), vz = P.getZ(c) - P.getZ(a);
      of++;
      if (uz * vx - ux * vz < -1e-9) { dn++; if (where.length < 6) where.push([+((P.getX(a) + P.getX(b) + P.getX(c)) / 3).toFixed(1), +((P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3).toFixed(1)]); }
    }
    return { down: dn, of, where };
  };
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
  return {
    corners: radii.length, junctions: holes.junctions,
    radius: { median: med(radii.map((r) => r.r)), min: Math.min(...radii.map((r) => r.r)), max: Math.max(...radii.map((r) => r.r)) },
    holes, crosswalk: down(roads.crosswalkMesh), junction: down(roads.junctionMesh), sample: radii.slice(0, 6),
  };
});
console.log(JSON.stringify(m));
check(`corner radius: median ${m.radius.median.toFixed(2)} m over ${m.corners} corners (range ${m.radius.min.toFixed(2)} to ${m.radius.max.toFixed(2)}; target median >= 3.2, min >= 2)`, m.corners >= 6 && m.radius.median >= 3.2 && m.radius.min >= 2, m.radius);
check(`no notches at the corners: ${m.holes.n} of ${m.holes.of} grid points in the roads' full-width strips have no road surface (${m.junctions} junctions; target 0)`, m.holes.n === 0, m.holes);
check(`zebra strips face up: ${m.crosswalk.down} of ${m.crosswalk.of} triangles face down (target 0)`, m.crosswalk.of > 0 && m.crosswalk.down === 0, m.crosswalk);
check(`junction asphalt faces up: ${m.junction.down} of ${m.junction.of} triangles face down (target 0)`, m.junction.of > 0 && m.junction.down === 0, m.junction);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
