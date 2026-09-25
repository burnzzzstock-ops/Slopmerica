// Small 2D geometry kit for roads, zones and agents. Roads live in the XZ plane;
// heights are sampled separately from the terrain.

export interface V2 {
  x: number;
  z: number;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const v2 = (x: number, z: number): V2 => ({ x, z });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: V2, b: V2) => a.x * b.x + a.z * b.z;
export const cross = (a: V2, b: V2) => a.x * b.z - a.z * b.x;
export const len = (a: V2) => Math.hypot(a.x, a.z);
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: V2, b: V2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const norm = (a: V2): V2 => {
  const l = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / l, z: a.z / l };
};
/** Left-hand perpendicular (rotate +90° looking down from +Y with X east, Z south). */
export const perp = (a: V2): V2 => ({ x: -a.z, z: a.x });
export const angleOf = (a: V2) => Math.atan2(a.z, a.x);
export const mid = (a: V2, b: V2): V2 => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---------- cubic bezier ----------
export interface Cubic {
  p0: V2;
  p1: V2;
  p2: V2;
  p3: V2;
}

export function bezPoint(c: Cubic, t: number): V2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    z: a * c.p0.z + b * c.p1.z + d * c.p2.z + e * c.p3.z,
  };
}

export function bezTangent(c: Cubic, t: number): V2 {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, d = 3 * t * t;
  const x = a * (c.p1.x - c.p0.x) + b * (c.p2.x - c.p1.x) + d * (c.p3.x - c.p2.x);
  const z = a * (c.p1.z - c.p0.z) + b * (c.p2.z - c.p1.z) + d * (c.p3.z - c.p2.z);
  return norm({ x, z });
}

/** Straight line as a cubic. */
export function lineCubic(a: V2, b: V2): Cubic {
  return { p0: a, p1: lerpV(a, b, 1 / 3), p2: lerpV(a, b, 2 / 3), p3: b };
}

/** Quadratic (a, control, b) promoted to cubic. */
export function quadCubic(a: V2, c: V2, b: V2): Cubic {
  return {
    p0: a,
    p1: { x: a.x + (2 / 3) * (c.x - a.x), z: a.z + (2 / 3) * (c.z - a.z) },
    p2: { x: b.x + (2 / 3) * (c.x - b.x), z: b.z + (2 / 3) * (c.z - b.z) },
    p3: b,
  };
}

export function lerpV(a: V2, b: V2, t: number): V2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** de Casteljau split at t. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerpV(c.p0, c.p1, t), p12 = lerpV(c.p1, c.p2, t), p23 = lerpV(c.p2, c.p3, t);
  const p012 = lerpV(p01, p12, t), p123 = lerpV(p12, p23, t);
  const m = lerpV(p012, p123, t);
  return [
    { p0: c.p0, p1: p01, p2: p012, p3: m },
    { p0: m, p1: p123, p2: p23, p3: c.p3 },
  ];
}

export function reverseCubic(c: Cubic): Cubic {
  return { p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 };
}

/** Polyline approximation: points + cumulative length + parameter t for each point. */
export interface Sampled {
  pts: V2[];
  ts: number[];
  cum: number[];
  length: number;
}

export function sampleCubic(c: Cubic, step = 2): Sampled {
  // rough length for sample count
  let rough = 0;
  let prev = c.p0;
  for (let i = 1; i <= 16; i++) {
    const p = bezPoint(c, i / 16);
    rough += dist(prev, p);
    prev = p;
  }
  const n = Math.max(2, Math.ceil(rough / step));
  const pts: V2[] = [];
  const ts: number[] = [];
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = bezPoint(c, t);
    if (i > 0) acc += dist(pts[i - 1], p);
    pts.push(p);
    ts.push(t);
    cum.push(acc);
  }
  return { pts, ts, cum, length: acc };
}

/** Index + fraction for an arc length s along a sampled curve. */
export function locate(s: Sampled, d: number): { i: number; f: number } {
  const cum = s.cum;
  if (d <= 0) return { i: 0, f: 0 };
  if (d >= s.length) return { i: cum.length - 2, f: 1 };
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= d) lo = m;
    else hi = m;
  }
  const seg = cum[hi] - cum[lo] || 1;
  return { i: lo, f: (d - cum[lo]) / seg };
}

export function pointAt(s: Sampled, d: number): V2 {
  const { i, f } = locate(s, d);
  return lerpV(s.pts[i], s.pts[i + 1], f);
}

export function tangentAt(s: Sampled, d: number): V2 {
  const { i } = locate(s, d);
  return norm(sub(s.pts[i + 1], s.pts[i]));
}

export function tAt(s: Sampled, d: number): number {
  const { i, f } = locate(s, d);
  return lerp(s.ts[i], s.ts[i + 1], f);
}

/** Segment-segment intersection; returns params (u on ab, v on cd) or null. */
export function segIntersect(a: V2, b: V2, c: V2, d: V2): { u: number; v: number } | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const ca = sub(c, a);
  const u = cross(ca, s) / den;
  const v = cross(ca, r) / den;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/** Closest point on segment ab to p; returns param and distance. */
export function closestOnSeg(p: V2, a: V2, b: V2): { t: number; d: number; pt: V2 } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1e-9;
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  const pt = { x: a.x + ab.x * t, z: a.z + ab.z * t };
  return { t, d: dist(p, pt), pt };
}

/** Closest point on a sampled polyline. Returns arc length along it. */
export function closestOnSampled(p: V2, s: Sampled): { d: number; s: number; pt: V2; t: number } {
  let best = { d: Infinity, s: 0, pt: s.pts[0], t: 0 };
  for (let i = 0; i < s.pts.length - 1; i++) {
    const r = closestOnSeg(p, s.pts[i], s.pts[i + 1]);
    if (r.d < best.d) {
      const segLen = s.cum[i + 1] - s.cum[i];
      best = { d: r.d, s: s.cum[i] + segLen * r.t, pt: r.pt, t: lerp(s.ts[i], s.ts[i + 1], r.t) };
    }
  }
  return best;
}

export function pointInPoly(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Oriented rectangle overlap test via separating axes. Rect = center, half extents, angle. */
export interface ORect {
  cx: number;
  cz: number;
  hw: number; // half size along local x (angle direction)
  hd: number; // half size along local z
  ang: number;
}

export function rectCorners(r: ORect): V2[] {
  const c = Math.cos(r.ang), s = Math.sin(r.ang);
  const ax = { x: c, z: s }, az = { x: -s, z: c };
  const out: V2[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    out.push({ x: r.cx + ax.x * r.hw * sx + az.x * r.hd * sz, z: r.cz + ax.z * r.hw * sx + az.z * r.hd * sz });
  }
  return out;
}

export function rectsOverlap(a: ORect, b: ORect): boolean {
  const ca = rectCorners(a), cb = rectCorners(b);
  const axes = [a.ang, a.ang + Math.PI / 2, b.ang, b.ang + Math.PI / 2];
  for (const ang of axes) {
    const ax = { x: Math.cos(ang), z: Math.sin(ang) };
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of ca) { const d = dot(p, ax); amin = Math.min(amin, d); amax = Math.max(amax, d); }
    for (const p of cb) { const d = dot(p, ax); bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

/** Monotone chain convex hull. */
export function convexHull(points: V2[]): V2[] {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
  if (pts.length < 3) return pts;
  const lower: V2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 1])) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: V2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 1])) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Uniform grid spatial hash for anything with an id. */
export class SpatialHash<T> {
  private cells = new Map<number, T[]>();
  constructor(public size: number) {}
  private key(ix: number, iz: number) {
    return ((ix + 4096) << 13) | (iz + 4096);
  }
  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
    const s = this.size;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++)
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const k = this.key(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(item);
      }
  }
  remove(item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
    const s = this.size;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++)
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const arr = this.cells.get(this.key(ix, iz));
        if (!arr) continue;
        const i = arr.indexOf(item);
        if (i >= 0) arr.splice(i, 1);
      }
  }
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Set<T> = new Set()): Set<T> {
    const s = this.size;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++)
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const arr = this.cells.get(this.key(ix, iz));
        if (arr) for (const it of arr) out.add(it);
      }
    return out;
  }
  clear() {
    this.cells.clear();
  }
}
