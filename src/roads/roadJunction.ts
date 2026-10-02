// Where three or more roads meet: the shape of the junction as it is drawn.
//
// Each pair of neighbouring legs (by angle) meets at a corner. Where the angle
// is a real corner the curb runs round a filleted arc (a curb return, tangent to
// both legs' curb lines) and the sidewalks join in a slab behind it; where the
// two legs are straight through (the far side of a T) the slab is a plain
// connector so the sidewalk carries on. The legs are trimmed back far enough
// that their ribbons start where the arc meets the straight curb.
//
// Everything here is render-only geometry, but for where people cross each arm (armCrossing), which the people and
// the traffic use too. Directions and distances (s along a leg, lateral offsets) are relative
// to the node; the points in a Corner (curb path, outer edge) are in world metres.
import { clamp, closestOnSampled, lerp, locate, norm, sub, V2 } from '../core/math';
import type { RoadNetwork, RSeg } from './network';
import { carriageHalf, laneOffset, ROAD_TYPES } from './roadTypes';
import { CAR_CLEAR, CORNER_R_GROW, curbOffset, curbReturnRadius, BAR_DEPTH, FILLET_MIN, NOSE_CLEAR, STOP_GAP, STOP_LINE, ZEBRA_MAX, ZEBRA_MIN, ZEBRA_SETBACK, ZEBRA_STRIDE } from './roadSection';

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
  /** where the zebra crossing and the stop bar go on this leg */
  marks: LegMarks;
}

/** The paint across one leg of a junction, in metres from the node along the leg (see legMarks). */
export interface LegMarks {
  /** the zebra crossing spans z0 to z1 along the leg and `half` either side of its centreline */
  z0: number;
  z1: number;
  half: number;
  /** the stop bar's centre (the bar is 0.37 m deep) */
  bar: number;
  /** people cross this leg (armCrossing): false, no zebra is painted (the stop bar still is) */
  cross: boolean;
}

export interface Corner {
  /** the corner lies in the sector from leg `i` (its +side) to leg `j` (its -side) */
  i: number;
  j: number;
  kind: 'fillet' | 'straight' | 'none';
  /** the angle of the sector this corner closes (radians) */
  phi: number;
  /** curb radius (fillet) */
  radius: number;
  /** fillet: how close the cars' turning curves between the two legs come to the kerb arc (metres; see carClearance) */
  clear?: number;
  /** distance along each leg to where the two curb lines cross (the sharp corner the arc rounds off) */
  pI?: number;
  pJ?: number;
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

// The renderer asks for a node's shape many times over (each leg's mesh, its lamps and driveways, the paint), and solving the
// kerb returns against the cars' turning curves is the dear part, so the answer is kept until something it was made from moves.
const shapes = new WeakMap<RoadNetwork, Map<number, { key: number; J: Junction | null }>>();

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);

/** A hash of everything junctionShape reads about a node: the node itself and each leg's type, id, length, trims and end samples. */
function shapeKey(net: RoadNetwork, node: { x: number; z: number; segs: number[] }): number {
  let h = 2166136261;
  const mix = (v: number) => { f64[0] = v; h = Math.imul(h ^ u32[0], 16777619); h = Math.imul(h ^ u32[1], 16777619); };
  mix(node.x); mix(node.z);
  for (const id of node.segs) {
    const s = net.segs.get(id);
    if (!s) return NaN;
    const P = s.samp.pts, n = P.length;
    mix(s.id); mix(s.a); mix(s.trimA); mix(s.trimB); mix(s.length); { const t = ROAD_TYPES[s.type]; mix(t.width); mix(t.lanesPerDir); mix(t.laneW); mix(t.median); mix((t.oneWay ? 1 : 0) + (t.centerTurn ? 2 : 0) + (t.sidewalk > 0 ? 4 : 0)); }
    for (const q of [P[0], P[Math.min(1, n - 1)], P[Math.min(2, n - 1)], P[Math.max(0, n - 3)], P[Math.max(0, n - 2)], P[n - 1]]) { mix(q.x); mix(q.z); }
  }
  return h >>> 0;
}

/** The drawn shape of a junction of three or more legs, or null (fewer legs, or a gap wider than a straight-through side: those keep the old hull). */
export function junctionShape(net: RoadNetwork, nodeId: number, opts?: { radius?: (ei: number, ej: number, phi: number) => number }): Junction | null {
  const node = net.nodes.get(nodeId);
  if (!node || node.segs.length < 3) return null;
  if (opts) return buildShape(net, node, nodeId, opts);
  let byNode = shapes.get(net);
  if (!byNode) shapes.set(net, (byNode = new Map()));
  const key = shapeKey(net, node), hit = byNode.get(nodeId);
  if (hit && hit.key === key && Number.isFinite(key)) return hit.J;
  const J = buildShape(net, node, nodeId);
  byNode.set(nodeId, { key, J });
  return J;
}

function buildShape(net: RoadNetwork, node: { x: number; z: number; segs: number[] }, nodeId: number, opts?: { radius?: (ei: number, ej: number, phi: number) => number }): Junction | null {
  const legs: Leg[] = [];
  for (const id of node.segs) {
    const seg = net.segs.get(id);
    if (!seg) return null;
    const t = ROAD_TYPES[seg.type];
    if (t.sidewalk <= 0) return null; // highways, ramps and gravel lanes keep the plain hull
    const u = legDirection(net, seg, nodeId);
    legs.push({ seg, atA: seg.a === nodeId, u, r: { x: -u.z, z: u.x }, e: curbOffset(t), h: t.width / 2, ang: Math.atan2(u.z, u.x), trim: baseTrim(net, seg, nodeId), marks: { z0: 0, z1: 0, half: 0, bar: 0, cross: true } });
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
    const c: Corner = { i, j, phi, kind: 'none', radius: 0, sI: 0, sJ: 0, curb: [], outer: [] };
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
    // the curb-return radius comes from the two roads and the angle (roadSection.ts curbReturnRadius: 3 m between two-lane
    // streets at a right angle, where it was 5; roadSection.ts has the reasoning); the clamps below only ever make it smaller
    let r = (opts?.radius ?? curbReturnRadius)(Li.e, Lj.e, phi);
    const tanHalf = Math.tan(phi / 2);
    let T = r / tanHalf;
    // the tangent points must stay well inside both legs, and the fillet within 11 m of the corner
    // ... and no further out than 1.5 m past the network's own trim (the sim's stop lines and signal poles are set from it)
    const netRoom = (L: Leg, s0: number) => { const nt = L.atA ? L.seg.trimA : L.seg.trimB; return nt > 0.01 ? nt + 1.5 - s0 : 99; };
    const room = Math.min(0.42 * Li.seg.length - P.s, 0.42 * Lj.seg.length - P.sp, 11, netRoom(Li, P.s), netRoom(Lj, P.sp));
    if (T > room) { T = room; r = T * tanHalf; }
    // the arc bulges into the block by r (1 / sin(phi/2) - 1): keep its nearest point 0.6 m short of the walk's outer corner
    const outerCorner = add(mul(Li.u, Po.s), mul(Li.r, Li.h));
    const bulgeOk = (rr: number) => {
      const O = add(mul(Li.u, P.s + rr / tanHalf), mul(Li.r, Li.e + rr));
      const Om = Math.hypot(O.x, O.z) || 1, ax = (O.x * (Om - rr)) / Om, az = (O.z * (Om - rr)) / Om, al = Math.hypot(ax, az) || 1;
      return ((outerCorner.x - ax) * ax + (outerCorner.z - az) * az) / al >= 0.6;
    };
    for (let guard = 0; guard < 20 && r >= FILLET_MIN && !bulgeOk(r); guard++) r -= 0.25;
    let clear: number | undefined;
    if (r >= FILLET_MIN && !opts?.radius) {
      // never so tight that a car's turning curve comes within CAR_CLEAR of the kerb: grow the arc (within the room the clamps
      // above left, and the walk's corner) until it clears them. This reads the network's trims and lanes, it moves nothing.
      const at = (a: V2, b: V2, x: number, y: number) => add(node, add(mul(a, x), mul(b, y)));
      for (let grow = 0; grow < 16; grow++) {
        const Tg = r / tanHalf;
        clear = carClearance(Li, Lj, at(Li.u, Li.r, P.s + Tg, Li.e + r), r, at(Li.u, Li.r, P.s + Tg, Li.e), at(Lj.u, Lj.r, P.sp + Tg, -Lj.e));
        if (clear >= CAR_CLEAR || r >= CORNER_R_GROW) break;
        const r2 = r + 0.25;
        if (r2 / tanHalf > room || !bulgeOk(r2)) break;
        r = r2;
        clear = undefined;
      }
    }
    T = r / tanHalf;
    if (r < FILLET_MIN || T <= 0) continue;
    c.kind = 'fillet';
    c.radius = r;
    c.clear = clear;
    c.pI = P.s;
    c.pJ = P.sp;
    c.sI = P.s + T;
    c.sJ = P.sp + T;
    c.pOut = add(node, add(mul(Li.u, Po.s), mul(Li.r, Li.h)));
    Li.trim = Math.max(Li.trim, c.sI, Po.s + 0.05);
    Lj.trim = Math.max(Lj.trim, c.sJ, Po.sp + 0.05);
  }
  for (const L of legs) L.trim = Math.min(L.trim, L.seg.length * 0.47);
  // the corners' curb paths and walk edges, from the final trims. A leg's mouth is taken on the leg's real centreline (which
  // bends: the tangent points below assume it runs straight for a few metres), the same place roadMesh.ts lays its ribbon from.
  const mouth = legs.map((L) => {
    const seg = L.seg, { i, f } = locate(seg.samp, clamp(L.atA ? L.trim : seg.length - L.trim, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1], t = norm(sub(b, a)), sg = L.atA ? 1 : -1;
    return { p: { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) }, r: { x: -t.z * sg, z: t.x * sg } };
  });
  const layout = () => {
    for (const c of corners) {
      const Li = legs[c.i], Lj = legs[c.j], Mi = mouth[c.i], Mj = mouth[c.j];
      // (a leg too short to hold its tangent point after the 47% cap falls back to a plain chamfer)
      if (c.kind === 'fillet' && (c.sI > Li.trim + 1e-6 || c.sJ > Lj.trim + 1e-6)) { c.kind = 'straight'; c.radius = 0; }
      const Qi = add(Mi.p, mul(Mi.r, Li.e)), Qj = add(Mj.p, mul(Mj.r, -Lj.e));
      const Oi = add(Mi.p, mul(Mi.r, Li.h)), Oj = add(Mj.p, mul(Mj.r, -Lj.h));
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
  };
  // the asphalt's outline as roadMesh.ts draws it: the corners' curbs in order (a tangent point within 0.3 m of the mouth merges into it)
  const outline = () => {
    const loop: V2[] = [];
    for (const c of corners) {
      const cb = c.curb.slice();
      if (c.kind === 'fillet') {
        if (Math.hypot(cb[0].x - cb[1].x, cb[0].z - cb[1].z) < 0.3) cb.splice(1, 1);
        const q = cb.length;
        if (Math.hypot(cb[q - 1].x - cb[q - 2].x, cb[q - 1].z - cb[q - 2].z) < 0.3) cb.splice(q - 2, 1);
      }
      for (const p of cb) loop.push(p);
    }
    return loop;
  };
  layout();
  // A shape that folds over itself (legs of very different widths at odd angles, or a leg that bends away from its tangent points)
  // or a corner slab that does, first loses some of its curb return, and only then is left to the plain hull: the arc that breaks
  // a slab, else the biggest, is eased 0.5 m at a time (a grown arc is what usually folds), and below FILLET_MIN it becomes a chamfer.
  const sound = () => isSimple(outline()) && corners.every((c) => c.kind !== 'fillet' || isSimple([...c.curb, ...c.outer]));
  for (let guard = 0; guard < 40 && !sound(); guard++) {
    const broken = corners.filter((c) => c.kind === 'fillet' && !isSimple([...c.curb, ...c.outer]));
    const pool = broken.length ? broken : corners.filter((c) => c.kind === 'fillet');
    if (!pool.length) return null;
    const c = pool.reduce((x, y) => (y.radius > x.radius ? y : x));
    c.radius -= 0.5;
    if (c.radius < FILLET_MIN) { c.kind = 'straight'; c.radius = 0; }
    else { const T = c.radius / Math.tan(c.phi / 2); c.sI = c.pI! + T; c.sJ = c.pJ! + T; }
    layout();
  }
  if (!sound()) return null;
  for (const c of corners) {
    if (c.kind === 'none' || isSimple([...c.curb, ...c.outer])) continue;
    if (c.kind === 'fillet') return null;
    c.kind = 'none'; // a sharp gap between two wide roads: the walks overlap, so no slab (the asphalt outline still closes)
    c.outer = [];
  }
  for (let k = 0; k < n; k++) legs[k].marks = legMarks(net, nodeId, legs, corners, k);
  return { nodeId, x: node.x, z: node.z, legs, corners };
}

/**
 * A car's place and heading at a leg's stop line (arriving) or entry (leaving) on lane `lane`: the same frame traffic.ts
 * builds with frameAt / lanePos when a car enters a junction (the network's trim, the lane's offset from the centreline).
 */
function laneFrame(L: Leg, arriving: boolean, lane: number): { p: V2; t: V2 } {
  const seg = L.seg, trim = L.atA ? seg.trimA : seg.trimB;
  const { i, f } = locate(seg.samp, clamp(L.atA ? trim : seg.length - trim, 0, seg.length));
  const a = seg.samp.pts[i], b = seg.samp.pts[i + 1], tt = norm(sub(b, a));
  // (cars arriving drive towards the node, cars leaving away from it; a leg that starts at the node runs along its samples)
  const dir = arriving === L.atA ? -1 : 1;
  const t = { x: tt.x * dir, z: tt.z * dir }, off = laneOffset(ROAD_TYPES[seg.type], lane);
  return { p: { x: lerp(a.x, b.x, f) - t.z * off, z: lerp(a.z, b.z, f) + t.x * off }, t };
}

/**
 * How close the cars' turning curves between legs i and j come to the kerb arc (centre O, radius r, from Ti to Tj), in metres,
 * from the kerb lane of one leg to the kerb lane of the other and back. The curve is traffic.ts's: a cubic from the lane at
 * the stop line to the lane at the next leg's entry, its inner control points 0.42 of their distance along the two headings.
 * (scripts/junctionmouth.mjs re-derives it on its own and checks the result; if traffic.ts changes the curve, change this.)
 */
function carClearance(Li: Leg, Lj: Leg, O: V2, r: number, Ti: V2, Tj: V2): number {
  const a0 = Math.atan2(Ti.z - O.z, Ti.x - O.x), sweep = wrap(Math.atan2(Tj.z - O.z, Tj.x - O.x) - a0);
  let best = Infinity;
  for (const [S, N] of [[Li, Lj], [Lj, Li]] as [Leg, Leg][]) {
    const f0 = laneFrame(S, true, ROAD_TYPES[S.seg.type].lanesPerDir - 1), f3 = laneFrame(N, false, ROAD_TYPES[N.seg.type].lanesPerDir - 1);
    const k = Math.hypot(f3.p.x - f0.p.x, f3.p.z - f0.p.z) * 0.42;
    const c1 = { x: f0.p.x + f0.t.x * k, z: f0.p.z + f0.t.z * k }, c2 = { x: f3.p.x - f3.t.x * k, z: f3.p.z - f3.t.z * k };
    for (let m = 0; m <= 10; m++) {
      const u = m / 10, v = 1 - u, w0 = v * v * v, w1 = 3 * v * v * u, w2 = 3 * v * u * u, w3 = u * u * u;
      const qx = w0 * f0.p.x + w1 * c1.x + w2 * c2.x + w3 * f3.p.x, qz = w0 * f0.p.z + w1 * c1.z + w2 * c2.z + w3 * f3.p.z;
      const t = wrap(Math.atan2(qz - O.z, qx - O.x) - a0) / sweep;
      const d = t >= 0 && t <= 1 ? Math.hypot(qx - O.x, qz - O.z) - r : Math.min(Math.hypot(qx - Ti.x, qz - Ti.z), Math.hypot(qx - Tj.x, qz - Tj.z));
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Where the zebra crossing and the stop bar go across one leg of a junction, so the paint sits where people walk and
 * the cars stand.
 *
 * People cross the leg on its walk line (armCrossing: from one sidewalk's end to the other's; at the trim on most legs,
 * a little skewed past it where a corner pushes one sidewalk's end back), and a car waiting at the line holds its nose
 * STOP_LINE behind where that line crosses its lane (crossingStop). The zebra covers the walk line, with half a stride
 * either side, centred on it where it can be; never nearer the node than ZEBRA_SETBACK past the kerb line of the road it
 * crosses (measured at the zebra's two ends, so a skewed junction is cleared on its acute side too); 1.8 to 2.4 m wide,
 * more where the line is skewed. The stop bar follows STOP_GAP behind it, NOSE_CLEAR short of the nearest waiting nose.
 * Where the crossing road's kerb pushes the zebra out that far, it keeps its width and the bar slides back under the
 * car's bumper rather than the crossing under its wheels. A leg nobody crosses (a sharp corner) gets no zebra.
 */
function legMarks(net: RoadNetwork, nodeId: number, legs: Leg[], corners: Corner[], k: number): LegMarks {
  const n = legs.length, L = legs[k];
  const half = Math.max(1, carriageHalf(ROAD_TYPES[L.seg.type]) - 0.2);
  let clear = 0;
  for (const [c, other] of [[corners[k], legs[(k + 1) % n]], [corners[(k + n - 1) % n], legs[(k + n - 1) % n]]] as [Corner, Leg][]) {
    if (c.phi >= 2.8) continue; // straight across: no road crosses here
    const s = (other.e + half * Math.cos(c.phi)) / Math.sin(c.phi);
    if (Number.isFinite(s) && s > 0) clear = Math.max(clear, Math.min(s, 25));
  }
  const trim = L.atA ? L.seg.trimA : L.seg.trimB, cr = armCrossing(net, L.seg, nodeId);
  // the walk line's span along the leg, and the nearest waiting nose (a leg with no box of the network's own: the drawn trim)
  let lo = L.trim, hi = L.trim, nose = L.trim + STOP_LINE;
  if (trim > 0.01) {
    lo = cr.open ? Math.min(cr.plus, cr.minus) : trim;
    hi = cr.open ? Math.max(cr.plus, cr.minus) : trim;
    nose = trim + STOP_LINE;
    if (cr.open) {
      nose = Infinity;
      for (let lane = 0; lane < ROAD_TYPES[L.seg.type].lanesPerDir; lane++) nose = Math.min(nose, trim + crossingStop(cr, L.seg, nodeId, lane));
    }
  }
  const z0 = Math.max(clear > 0 ? clear + ZEBRA_SETBACK : 0, Math.min(lo - ZEBRA_STRIDE, (lo + hi) / 2 - ZEBRA_MAX / 2));
  const z1 = Math.max(z0 + ZEBRA_MIN, hi + ZEBRA_STRIDE, Math.min(z0 + ZEBRA_MAX, nose - NOSE_CLEAR - BAR_DEPTH - STOP_GAP));
  return { z0, z1, half, bar: z1 + STOP_GAP + BAR_DEPTH / 2, cross: cr.open || trim <= 0.01 };
}

/** The paint for a leg of a node that gets no drawn junction shape (the plain hull): the old fixed offsets from the ribbon's start. */
export function hullMarks(net: RoadNetwork, seg: RSeg, nodeId: number): LegMarks {
  const trim = baseTrim(net, seg, nodeId);
  return { z0: trim + 0.7, z1: trim + 3.5, half: Math.max(1, carriageHalf(ROAD_TYPES[seg.type]) - 0.5), bar: trim + 4.45, cross: true };
}

/** The paint for one leg of a node: from the drawn junction when it has one, else the plain hull's. */
export function legPaint(net: RoadNetwork, seg: RSeg, nodeId: number, J: Junction | null = junctionShape(net, nodeId)): LegMarks {
  if (J) for (const L of J.legs) if (L.seg === seg) return L.marks;
  return hullMarks(net, seg, nodeId);
}

/**
 * Where a road's sidewalk on this side ends at each end (distances along the road from its a end): the kerb at the
 * junction box's edge, where people step off to cross. At a sharp corner the box edge is still on the other road, or where
 * a turning truck swings, so the sidewalk stops short of that road (clear of its lanes by 2.5 m). A road with no box at
 * that end runs on to the node. (Was pedestrians.ts kerbs; people walk it, armCrossing takes the crossings from it.)
 */
export function sidewalkEnds(net: RoadNetwork, seg: RSeg, side: 1 | -1): [number, number] {
  const nA = net.nodes.get(seg.a), nB = net.nodes.get(seg.b);
  const T = ROAD_TYPES[seg.type], off = (T.sidewalk > 0 ? T.width / 2 - T.sidewalk / 2 : T.width / 2 + 1.3) * side;
  const clearOf = (node: typeof nA, at: number) => {
    const { i, f } = locate(seg.samp, clamp(at, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1], tan = norm(sub(b, a));
    const pt = { x: lerp(a.x, b.x, f) - tan.z * off, z: lerp(a.z, b.z, f) + tan.x * off };
    for (const id of node?.segs ?? []) {
      const o = id !== seg.id && net.segs.get(id);
      // (clear of its lanes by 2.5 m: a long truck turning in cuts the corner)
      if (o && closestOnSampled(pt, o.samp).d < carriageHalf(ROAD_TYPES[o.type]) + 2.5) return false;
    }
    return true;
  };
  const tA = seg.trimA ?? 0, tB = seg.trimB ?? 0, half = seg.length / 2;
  let a = tA > 0 ? tA : 0, b = seg.length - (tB > 0 ? tB : 0);
  while (a < Math.min(half - 1, tA + 20) && !clearOf(nA, a)) a += 0.5;
  while (b > Math.max(half + 1, seg.length - tB - 20) && !clearOf(nB, b)) b -= 0.5;
  return a < b - 1 ? [a, b] : [half - 0.5, half + 0.5];
}

/** People cross an arm only where neither sidewalk ends more than this far past its trim (m; beyond it, a sharp corner). */
export const CROSS_SETBACK_MAX = 1.5;

/**
 * Where people cross one arm of a junction: the walk line, straight from where the sidewalk ends on one side of the road
 * to where it ends on the other (pedestrians.ts walks it), in metres from the node along the arm at each side (`plus` on
 * the road's own side +1, `minus` on -1; the sidewalks' centre lines are `off` m either side of the centreline). An arm
 * whose sidewalk ends more than CROSS_SETBACK_MAX past its trim on either side is `open: false`: nobody crosses it there,
 * nobody waits for walkers on it, and it gets no zebra. traffic.ts stops each lane short of the walk line over it
 * (crossingStop), roadJunction.ts paints the zebra over it (legMarks).
 */
export interface ArmCrossing { plus: number; minus: number; off: number; trim: number; open: boolean }
const crossings = new Map<string, { key: string; c: ArmCrossing }>();
export function armCrossing(net: RoadNetwork, seg: RSeg, nodeId: number): ArmCrossing {
  const nA = net.nodes.get(seg.a), nB = net.nodes.get(seg.b);
  const key = `${seg.length}|${seg.trimA}|${seg.trimB}|${nA?.segs.join(',')}|${nB?.segs.join(',')}`;
  const k = `${seg.id}:${nodeId}`, hit = crossings.get(k);
  if (hit && hit.key === key) return hit.c;
  const atA = seg.a === nodeId, T = ROAD_TYPES[seg.type];
  const end = (side: 1 | -1) => { const [a, b] = sidewalkEnds(net, seg, side); return atA ? a : seg.length - b; };
  const trim = Math.max(0, (atA ? seg.trimA : seg.trimB) ?? 0), plus = end(1), minus = end(-1);
  const c: ArmCrossing = { plus, minus, off: T.sidewalk > 0 ? T.width / 2 - T.sidewalk / 2 : T.width / 2 + 1.3, trim, open: Math.max(plus, minus) <= trim + CROSS_SETBACK_MAX };
  crossings.set(k, { key, c });
  return c;
}

/** The walk line's distance from the node where it crosses `lat` m across the arm (+ on the road's side +1). */
export function crossingAt(c: ArmCrossing, lat: number): number {
  return lerp(c.minus, c.plus, clamp((lat + c.off) / (2 * c.off), 0, 1));
}

/**
 * How far short of the arm's trim a car arriving at the node in `lane` (all its arriving lanes if none) holds its nose:
 * STOP_LINE behind where people walk over that lane, the walk line at the lane's two edges (on an arm nobody crosses,
 * STOP_LINE behind the trim). Capped at 6 m past STOP_LINE.
 */
export function crossingStop(c: ArmCrossing, seg: RSeg, nodeId: number, lane?: number): number {
  if (!c.open) return STOP_LINE;
  const T = ROAD_TYPES[seg.type], arriving = seg.b === nodeId ? 1 : -1;
  let far = c.trim;
  for (let k = 0; k < T.lanesPerDir; k++) {
    if (lane !== undefined && k !== lane) continue;
    // (a one-way's lanes fill the carriageway: laneOffset counts them from its left)
    const lo = laneOffset(T, k) - T.laneW / 2, hi = lo + T.laneW;
    for (const lat of [lo, hi]) far = Math.max(far, crossingAt(c, lat * arriving));
  }
  return STOP_LINE + clamp(far - c.trim, 0, 6);
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
