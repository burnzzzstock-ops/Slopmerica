// Where three or more roads meet: the shape of the junction as it is drawn.
//
// Each pair of neighbouring legs (by angle) meets at a corner. Where the angle
// is a real corner the curb runs round a filleted arc (a curb return, tangent to
// both legs' curb lines) and the sidewalks join in a slab behind it; where the
// two legs are straight through (the far side of a T) the slab is a plain
// connector so the sidewalk carries on. The legs are trimmed back far enough
// that their ribbons start where the arc meets the straight curb.
//
// Everything here is render-only geometry. Directions and distances (s along a leg, lateral offsets) are relative
// to the node; the points in a Corner (curb path, outer edge) are in world metres.
import { norm, sub, V2 } from '../core/math';
import type { RoadNetwork, RSeg } from './network';
import { carriageHalf, ROAD_TYPES } from './roadTypes';
import { curbOffset } from './roadSection';

export interface Leg {
  seg: RSeg;
  atA: boolean;
  /** unit vector from the node out along the leg */
  u: V2;
  /** u turned a quarter-turn towards the next leg (increasing angle) */
  r: V2;
  /** lateral offset of the curb line (carriageway + gutter) and of the outer edge of the walk */
  e: number;
  h: number;
  ang: number;
  /** where the leg's ribbon starts, from the node */
  trim: number;
}

export interface Corner {
  /** the corner lies in the sector from leg `i` (its +side) to leg `j` (its -side) */
  i: number;
  j: number;
  kind: 'fillet' | 'straight' | 'none';
  /** curb radius (fillet) */
  radius: number;
  /** distance along each leg to the tangent point, and to the walk's outer corner */
  sI: number;
  sJ: number;
  /** the sharp outer corner of the walk (fillet only) */
  pOut?: V2;
  /** the curb path from leg i's curb line at its trim to leg j's: [Qi, Ti, arc..., Tj, Qj] (straight: [Qi, Qj]) */
  curb: V2[];
  /** the walk's outer edge, from leg j's to leg i's: [Oj, (pOut), Oi] */
  outer: V2[];
}

export interface Junction {
  nodeId: number;
  x: number;
  z: number;
  legs: Leg[];
  corners: Corner[];
}

const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z });
const mul = (a: V2, k: number): V2 => ({ x: a.x * k, z: a.z * k });

function legDirection(net: RoadNetwork, s: RSeg, nodeId: number): V2 {
  void net;
  const atA = s.a === nodeId, pts = s.samp.pts;
  return atA
    ? norm(sub(pts[Math.min(2, pts.length - 1)], pts[0]))
    : norm(sub(pts[Math.max(0, pts.length - 3)], pts[pts.length - 1]));
}

/** Render-only trim at a junction from the intersecting carriageways alone (the old rule; a lone leg's trim is 0). */
export function baseTrim(net: RoadNetwork, seg: RSeg, nodeId: number): number {
  const node = net.nodes.get(nodeId);
  if (!node || node.segs.length < 2) return 0;
  const dir = legDirection(net, seg, nodeId);
  let trim = 0;
  for (const id of node.segs) {
    const other = net.segs.get(id);
    if (!other || other === seg) continue;
    const od = legDirection(net, other, nodeId);
    if (dir.x * od.x + dir.z * od.z < -0.9) continue;
    const sin = Math.abs(dir.x * od.z - dir.z * od.x);
    trim = Math.max(trim, carriageHalf(ROAD_TYPES[other.type]) / Math.max(0.35, sin));
  }
  return Math.min(trim, seg.length * 0.45);
}

const TWO_PI = Math.PI * 2;
const wrap = (a: number) => { while (a <= -Math.PI) a += TWO_PI; while (a > Math.PI) a -= TWO_PI; return a; };

/** The drawn shape of a junction of three or more legs, or null (fewer legs, or a gap wider than a straight-through side: those keep the old hull). */
export function junctionShape(net: RoadNetwork, nodeId: number): Junction | null {
  const node = net.nodes.get(nodeId);
  if (!node || node.segs.length < 3) return null;
  const legs: Leg[] = [];
  for (const id of node.segs) {
    const seg = net.segs.get(id);
    if (!seg) return null;
    const t = ROAD_TYPES[seg.type];
    if (t.sidewalk <= 0) return null; // highways, ramps and gravel lanes keep the plain hull
    const u = legDirection(net, seg, nodeId);
    legs.push({ seg, atA: seg.a === nodeId, u, r: { x: -u.z, z: u.x }, e: curbOffset(t), h: t.width / 2, ang: Math.atan2(u.z, u.x), trim: baseTrim(net, seg, nodeId) });
  }
  legs.sort((a, b) => a.ang - b.ang);
  const n = legs.length;
  const corners: Corner[] = [];
  for (let k = 0; k < n; k++) {
    const i = k, j = (k + 1) % n;
    const Li = legs[i], Lj = legs[j];
    let phi = Lj.ang - Li.ang;
    if (phi <= 0) phi += TWO_PI;
    if (phi > Math.PI + 0.06) return null; // a reflex gap: the node isn't inside its own legs
    const c: Corner = { i, j, kind: 'none', radius: 0, sI: 0, sJ: 0, curb: [], outer: [] };
    corners.push(c);
    if (phi < 0.35) continue;
    c.kind = 'straight';
    // intersection of the two curb lines (P) and of the two outer edges (Po), as distances along each leg from the node
    const cross = (a: V2, b: V2) => a.x * b.z - a.z * b.x;
    const solve = (ei: number, ej: number) => {
      // Li.u s + Li.r ei = Lj.u s' - Lj.r ej
      const rhs = { x: -(Li.r.x * ei + Lj.r.x * ej), z: -(Li.r.z * ei + Lj.r.z * ej) };
      const A = Li.u, B = mul(Lj.u, -1);
      const det = cross(A, B);
      return { s: cross(rhs, B) / det, sp: cross(A, rhs) / det };
    };
    const P = solve(Li.e, Lj.e), Po = solve(Li.h, Lj.h);
    // each leg's mouth must lie clear of its neighbour's road, so it starts beyond where their curbs (and walk edges) cross
    if (P.s > 0.2 && P.sp > 0.2 && phi < 2.8) {
      Li.trim = Math.max(Li.trim, Math.min(25, Math.max(P.s, Po.s) + 0.05));
      Lj.trim = Math.max(Lj.trim, Math.min(25, Math.max(P.sp, Po.sp) + 0.05));
    }
    if (phi >= 2.8 || phi < 0.9) continue; // straight through, or too sharp for a curb return: a plain connector
    if (P.s < 0.2 || P.sp < 0.2) continue; // the curb lines only meet behind the node (a wide road narrowing on a near-straight run)
    let r = Math.min(8.5, Math.max(3.2, 0.5 * (Li.e + Lj.e) + 1.2));
    const tanHalf = Math.tan(phi / 2);
    let T = r / tanHalf;
    // the tangent points must stay well inside both legs, and the fillet within 11 m of the corner
    // ... and no further out than 1.5 m past the network's own trim (the sim's stop lines and signal poles are set from it)
    const netRoom = (L: Leg, s0: number) => { const nt = L.atA ? L.seg.trimA : L.seg.trimB; return nt > 0.01 ? nt + 1.5 - s0 : 99; };
    const room = Math.min(0.42 * Li.seg.length - P.s, 0.42 * Lj.seg.length - P.sp, 11, netRoom(Li, P.s), netRoom(Lj, P.sp));
    if (T > room) { T = room; r = T * tanHalf; }
    // the arc bulges into the block by r (1 / sin(phi/2) - 1): keep its nearest point 0.6 m short of the walk's outer corner
    const outerCorner = add(mul(Li.u, Po.s), mul(Li.r, Li.h));
    for (let guard = 0; guard < 14 && r >= 2.2; guard++) {
      const O = add(mul(Li.u, P.s + r / tanHalf), mul(Li.r, Li.e + r));
      const Om = Math.hypot(O.x, O.z) || 1, ax = (O.x * (Om - r)) / Om, az = (O.z * (Om - r)) / Om, al = Math.hypot(ax, az) || 1;
      if (((outerCorner.x - ax) * ax + (outerCorner.z - az) * az) / al >= 0.6) break;
      r -= 0.4;
    }
    T = r / tanHalf;
    if (r < 2.2 || T <= 0) continue;
    c.kind = 'fillet';
    c.radius = r;
    c.sI = P.s + T;
    c.sJ = P.sp + T;
    c.pOut = add(node, add(mul(Li.u, Po.s), mul(Li.r, Li.h)));
    Li.trim = Math.max(Li.trim, c.sI, Po.s + 0.05);
    Lj.trim = Math.max(Lj.trim, c.sJ, Po.sp + 0.05);
  }
  for (const L of legs) L.trim = Math.min(L.trim, L.seg.length * 0.47);
  // the corners' curb paths and walk edges, from the final trims
  for (const c of corners) {
    const Li = legs[c.i], Lj = legs[c.j];
    // (a leg too short to hold its tangent point after the 47% cap falls back to a plain chamfer)
    if (c.kind === 'fillet' && (c.sI > Li.trim + 1e-6 || c.sJ > Lj.trim + 1e-6)) { c.kind = 'straight'; c.radius = 0; }
    const Qi = add(node, add(mul(Li.u, Li.trim), mul(Li.r, Li.e))), Qj = add(node, add(mul(Lj.u, Lj.trim), mul(Lj.r, -Lj.e)));
    const Oi = add(node, add(mul(Li.u, Li.trim), mul(Li.r, Li.h))), Oj = add(node, add(mul(Lj.u, Lj.trim), mul(Lj.r, -Lj.h)));
    if (c.kind === 'none') { c.curb = [Qi, Qj]; c.outer = []; continue; }
    if (c.kind === 'straight') { c.curb = [Qi, Qj]; c.outer = [Oj, Oi]; continue; }
    const Ti = add(node, add(mul(Li.u, c.sI), mul(Li.r, Li.e))), Tj = add(node, add(mul(Lj.u, c.sJ), mul(Lj.r, -Lj.e)));
    const O = add(Ti, mul(Li.r, c.radius));
    const a0 = Math.atan2(Ti.z - O.z, Ti.x - O.x), sweep = wrap(Math.atan2(Tj.z - O.z, Tj.x - O.x) - a0);
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / 0.22));
    const arc: V2[] = [];
    for (let s = 0; s <= steps; s++) { const a = a0 + (sweep * s) / steps; arc.push({ x: O.x + Math.cos(a) * c.radius, z: O.z + Math.sin(a) * c.radius }); }
    arc[0] = Ti; arc[arc.length - 1] = Tj;
    c.curb = [Qi, ...arc, Qj];
    c.outer = [Oj, c.pOut!, Oi];
  }
  // a shape that folds over itself (legs of very different widths at odd angles) is left to the plain hull
  const loop: V2[] = [];
  for (const c of corners) for (const p of c.curb) loop.push(p);
  if (!isSimple(loop)) return null;
  for (const c of corners) {
    if (c.kind === 'none' || isSimple([...c.curb, ...c.outer])) continue;
    if (c.kind === 'fillet') return null;
    c.kind = 'none'; // a sharp gap between two wide roads: the walks overlap, so no slab (the asphalt outline still closes)
    c.outer = [];
  }
  return { nodeId, x: node.x, z: node.z, legs, corners };
}

/** True when no two non-adjacent edges of the closed polygon cross (repeated points are ignored). */
export function isSimple(poly: V2[]): boolean {
  const P: V2[] = [];
  for (const p of poly) if (!P.length || Math.hypot(p.x - P[P.length - 1].x, p.z - P[P.length - 1].z) > 0.01) P.push(p);
  while (P.length > 1 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].z - P[P.length - 1].z) <= 0.01) P.pop();
  const n = P.length;
  if (n < 3) return false;
  const cr = (a: V2, b: V2, c: V2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = P[j], d = P[(j + 1) % n];
      if (cr(c, d, a) * cr(c, d, b) < -1e-9 && cr(a, b, c) * cr(a, b, d) < -1e-9) return false;
    }
  }
  return true;
}

/** Where a leg's ribbon starts along the segment, seen from the node (what visualTrim was, now with the curb returns). */
export function visualTrim(net: RoadNetwork, seg: RSeg, nodeId: number): number {
  const J = junctionShape(net, nodeId);
  if (J) for (const L of J.legs) if (L.seg === seg) return L.trim;
  return baseTrim(net, seg, nodeId);
}

/** Ear-clipping triangulation of a simple polygon (x, z), returned as index triples that face up (+y). */
export function triangulate(poly: V2[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; area += p.x * q.z - q.x * p.z; }
  const idx = Array.from({ length: n }, (_, i) => (area > 0 ? i : n - 1 - i));
  const out: number[] = [];
  const cr = (a: V2, b: V2, c: V2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const inTri = (p: V2, a: V2, b: V2, c: V2) => cr(a, b, p) >= -1e-9 && cr(b, c, p) >= -1e-9 && cr(c, a, p) >= -1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 4000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      const turn = cr(poly[a], poly[b], poly[c]);
      if (Math.abs(turn) <= 1e-9) { idx.splice(k, 1); clipped = true; break; } // a repeated or collinear vertex adds nothing
      if (turn < 0) continue;
      let inside = false;
      for (const q of idx) if (q !== a && q !== b && q !== c && inTri(poly[q], poly[a], poly[b], poly[c])) { inside = true; break; }
      if (inside) continue;
      out.push(a, c, b);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) { for (let k = 1; k < idx.length - 1; k++) out.push(idx[0], idx[k + 1], idx[k]); return out; }
  }
  if (idx.length === 3) out.push(idx[0], idx[2], idx[1]);
  return out;
}
