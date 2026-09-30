// The vehicle geometry kit (docs/HANDOFF_CARS_LOOK.md, item 1). Every vehicle model is a list of parts merged into ONE
// geometry per level of detail; the vehicle shader (agents/vehicles.ts) tells the parts apart by four vertex attributes:
//   aTint  (rgb, sRGB bytes, + a = how much the car's own paint tints the part: 1 body panels, 0 fixed colours)
//   aInfo  (x zone, y wheel code 0 body / 1 steering wheel / 2 other wheel, z spare, w spare)
//   aHub   (wheel vertices: the hub position in body space, millimetres / 1.024, so a wheel turns about its own axle)
// plus position, normal and uv (uv only matters for decals). One geometry means one draw call per model per level of
// detail: paint, trim, glass, lamps and wheels used to be three meshes per kind.
//
// Coordinates: +z is the front of the car, +y up, +x the car's left. Origin on the ground under the middle of the car.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export type V3 = readonly [number, number, number];

/** What a part is made of. The shader lights each zone differently (agents/vehicles.ts). */
export const ZONE = {
  PAINT: 0, GLASS: 1, CHROME: 2, PLASTIC: 3, DECAL: 4, HEAD: 5, TAIL: 6, TURN: 7, REVERSE: 8, SIREN_RED: 9, SIREN_BLUE: 10,
  BEACON: 11, PANEL: 12, TYRE: 13, DARK: 14, STEEL: 15, MARKER: 16, WORKLIGHT: 17,
} as const;

/** Where the lamps sit, so the effects pass can put halos and road pools on them (body space, like the geometry). */
export interface LampSet {
  head: V3[]; tail: V3[]; reverse: V3[]; turnLeft: V3[]; turnRight: V3[]; beacon: V3[]; siren: V3[];
  /** the members of `siren` that flash blue (the rest flash red) */
  sirenBlue: V3[];
  /** where the exhaust comes out (body space); empty = low at the tail */
  exhaust: V3[];
  /** Front and rear extents for the road pool: [z of the nose, half width of the beam at the nose]. */
  nose: [number, number];
  tailZ: number;
  height: number;
}
export const newLamps = (): LampSet => ({ head: [], tail: [], reverse: [], turnLeft: [], turnRight: [], beacon: [], siren: [], sirenBlue: [], exhaust: [], nose: [2, 0.8], tailZ: -2, height: 0.7 });

export interface Part {
  g: THREE.BufferGeometry;
  rgb: readonly [number, number, number]; // sRGB 0..1
  paint: number;
  zone: number;
  wheel: number;
  hub: V3;
}

const M4 = new THREE.Matrix4();
const EU = new THREE.Euler();
const ZERO: V3 = [0, 0, 0];

export function hex(c: number): [number, number, number] {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

export function xf<G extends THREE.BufferGeometry>(g: G, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): G {
  EU.set(rx, ry, rz);
  M4.makeRotationFromEuler(EU).setPosition(x, y, z);
  g.applyMatrix4(M4);
  return g;
}

function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

/** Mirror a geometry across x = 0 and repair the triangle winding, so a left-hand part can be reused on the right. */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = flat(g).clone();
  for (const name of ['position', 'normal']) {
    const a = out.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (a) for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i));
  }
  for (const key of Object.keys(out.attributes)) {
    const a = out.getAttribute(key) as THREE.BufferAttribute;
    const n = a.count, s = a.itemSize;
    for (let i = 0; i < n; i += 3) for (let k = 0; k < s; k++) { // swap vertices 1 and 2 of each triangle
      const t = a.array[(i + 1) * s + k]; (a.array as Float32Array)[(i + 1) * s + k] = a.array[(i + 2) * s + k]; (a.array as Float32Array)[(i + 2) * s + k] = t;
    }
  }
  return out;
}

export function boxG(w: number, h: number, l: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  return xf(flat(new THREE.BoxGeometry(w, h, l)), x, y, z, rx, ry, rz);
}

/** A cylinder about an axis ('x', 'y' or 'z'); rTop is the +axis end. */
export function cylG(rTop: number, rBot: number, len: number, seg: number, axis: 'x' | 'y' | 'z', x = 0, y = 0, z = 0, open = false): THREE.BufferGeometry {
  const g = flat(new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open));
  if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
}

export function sphereG(r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, wSeg = 8, hSeg = 5): THREE.BufferGeometry {
  const g = flat(new THREE.SphereGeometry(r, wSeg, hSeg));
  g.scale(sx, sy, sz);
  return g.translate(x, y, z);
}

/** A flat quad a-b-c-d (counter-clockwise seen from the front), optional uv. */
export function quadG(a: V3, b: V3, c: V3, d: V3, uv: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]], 2));
  g.computeVertexNormals();
  return g;
}

/** A flat rectangle facing +z (or -z when `back`), turned about y by `ry`: 2 triangles, for lenses and plates seen from one side. */
export function planeG(w: number, h: number, x: number, y: number, z: number, ry = 0, back = false): THREE.BufferGeometry {
  const g = flat(new THREE.PlaneGeometry(w, h));
  if (back) g.rotateY(Math.PI);
  return xf(g, x, y, z, 0, ry, 0);
}

/** A flat disc facing along +x (or -x when `side` < 0): a fan of `seg` triangles, for wheel faces that are only seen from outside. */
export function discG(r: number, seg: number, x: number, y: number, z: number, side = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    // outline in (z, y); winding chosen so the face looks along `side`
    const p0: V3 = [0, 0, 0], p1: V3 = [0, Math.sin(a0) * r, Math.cos(a0) * r], p2: V3 = [0, Math.sin(a1) * r, Math.cos(a1) * r];
    pos.push(...(side > 0 ? [...p0, ...p2, ...p1] : [...p0, ...p1, ...p2]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g.translate(x, y, z);
}

/** A flat filled outline, facing along +x (side > 0) or -x: outline x -> z, y -> y. A spoke star or a badge for one triangulation. */
export function shapeG(pts: ReadonlyArray<readonly [number, number]>, x: number, y: number, z: number, side = 1): THREE.BufferGeometry {
  const g = flat(new THREE.ShapeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)))));
  g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2); // the shape faces +z; turn it to face +x / -x (a star is symmetric, so which way its x runs doesn't matter)
  return g.translate(x, y, z);
}

/** A flat strip on a vehicle's side (x > 0 is the car's left) facing outward: two triangles instead of a box, for stripes, slats and panel lines. */
export function sideQuadG(x: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return x < 0 ? quadG([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]) : quadG([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1]);
}
/** The same across the rear (facing -z) or the front (facing +z). */
export function endQuadG(z: number, x0: number, x1: number, y0: number, y1: number): THREE.BufferGeometry {
  return z < 0 ? quadG([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]) : quadG([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
}

export function triG(a: V3, b: V3, c: V3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Extrude a 2D outline. `plane` names the two axes of the outline: 'yz' is a side profile (outline x -> z, y -> y, extruded along x),
 * 'xz' a plan, 'xy' a front view. The result is centred on `at` along the extrusion axis with thickness `depth`.
 */
export function extrudeG(pts: ReadonlyArray<readonly [number, number]>, depth: number, plane: 'yz' | 'xz' | 'xy', at: V3 = ZERO): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = flat(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 }));
  g.translate(0, 0, -depth / 2); // extruded along z, centred
  if (plane === 'yz') g.rotateY(-Math.PI / 2); // outline x -> +z, outline y -> +y, depth along x
  else if (plane === 'xz') g.rotateX(Math.PI / 2); // outline x -> x, outline y -> +z, depth along y
  return g.translate(at[0], at[1], at[2]);
}

/**
 * A lofted surface through rings of points (every ring has the same number of points, ordered round the section: up the +x side,
 * over the top, down the -x side, seen with the loft running toward +z; that order faces the surface outward). Faces are
 * smoothed across shallow angles and creased across sharp ones (toCreasedNormals), the way sheet metal reads.
 * `tint` gives one rgba per ring point (rgb sRGB 0..1, a paint amount), shared by every ring, so a body can shade its own
 * sill, bumper and wheel arches dark without extra parts.
 */
export function loftG(rings: ReadonlyArray<ReadonlyArray<V3>>, opts: { tint?: ReadonlyArray<readonly [number, number, number, number]>; closeFirst?: boolean; closeLast?: boolean; closed?: boolean; crease?: number } = {}): THREE.BufferGeometry {
  const n = rings[0].length, closed = opts.closed !== false;
  const pos: number[] = [], tint: number[] = [], idx: number[] = [];
  for (const ring of rings) for (let j = 0; j < n; j++) {
    pos.push(...ring[j]);
    const t = opts.tint?.[j] ?? [1, 1, 1, 1];
    tint.push(t[0], t[1], t[2], t[3]);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + ((j + 1) % n), d = (i + 1) * n + j;
    idx.push(a, c, d, a, b, c);
  }
  const cap = (base: number, flipped: boolean) => { for (let j = 1; j < n - 1; j++) idx.push(...(flipped ? [base, base + j + 1, base + j] : [base, base + j, base + j + 1])); };
  if (opts.closeFirst) cap(0, true); // the rear cap faces -z, the front cap +z (ring order: up +x, over the top, down -x)
  if (opts.closeLast) cap((rings.length - 1) * n, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 4));
  g.setIndex(idx);
  return toCreasedNormals(g, opts.crease ?? 0.72);
}

/** Monotone cubic through control points (z, value): no overshoot, so a hood line or a wheelbase stays where it was drawn. */
export function curve(pts: ReadonlyArray<readonly [number, number]>): (z: number) => number {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (z: number) => {
    if (z <= xs[0]) return ys[0];
    if (z >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (z > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (z - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------------------------------------
// The builder: parts in, one merged geometry out.

export class ModelBuilder {
  readonly parts: Part[] = [];
  readonly lamps: LampSet = newLamps();
  /** 0 close (< ~40 m), 1 near, 2 far. Builders skip small parts and use fewer segments as the level rises. */
  constructor(readonly lod: 0 | 1 | 2, readonly L: number, readonly W: number, readonly H: number) {}

  get close(): boolean { return this.lod === 0; }
  /** A segment count for round parts: full at close range, then fewer. */
  seg(close: number, near: number, far = 6): number { return this.lod === 0 ? close : this.lod === 1 ? near : far; }

  add(g: THREE.BufferGeometry, color: number | readonly [number, number, number], zone: number = ZONE.PAINT, paint = 0, wheel = 0, hub: V3 = ZERO): void {
    this.parts.push({ g: flat(g), rgb: typeof color === 'number' ? hex(color) : color, paint, zone, wheel, hub });
  }
  /** A body panel: takes the car's paint (already sRGB white so the paint colour comes through unchanged). */
  body(g: THREE.BufferGeometry, tint = 1): void { this.add(g, [1, 1, 1], ZONE.PAINT, tint); }
  /** Add g and its mirror image across x = 0. */
  pair(g: THREE.BufferGeometry, color: number | readonly [number, number, number], zone: number = ZONE.PAINT, paint = 0): void {
    this.add(g, color, zone, paint); this.add(mirrorX(g), color, zone, paint);
  }

  triangles(): number {
    let t = 0; for (const p of this.parts) t += p.g.getAttribute('position').count / 3; return t;
  }

  /** Merge into the renderer's vertex layout. */
  finish(): THREE.BufferGeometry {
    const gs: THREE.BufferGeometry[] = [];
    for (const p of this.parts) {
      const g = p.g.clone();
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const n = g.getAttribute('position').count;
      const tint = new Float32Array(n * 4), info = new Float32Array(n * 4), hub = new Float32Array(n * 3);
      const own = g.getAttribute('tint') as THREE.BufferAttribute | undefined;
      for (let i = 0; i < n; i++) {
        if (own) { tint[i * 4] = own.getX(i) * p.rgb[0]; tint[i * 4 + 1] = own.getY(i) * p.rgb[1]; tint[i * 4 + 2] = own.getZ(i) * p.rgb[2]; tint[i * 4 + 3] = own.getW(i) * p.paint; }
        else { tint[i * 4] = p.rgb[0]; tint[i * 4 + 1] = p.rgb[1]; tint[i * 4 + 2] = p.rgb[2]; tint[i * 4 + 3] = p.paint; }
        info[i * 4] = p.zone; info[i * 4 + 1] = p.wheel;
        hub[i * 3] = p.hub[0]; hub[i * 3 + 1] = p.hub[1]; hub[i * 3 + 2] = p.hub[2];
      }
      g.deleteAttribute('tint');
      g.setAttribute('aTint', new THREE.BufferAttribute(tint, 4));
      g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
      g.setAttribute('aHub', new THREE.BufferAttribute(hub, 3));
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      g.setIndex(null);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aTint', 'aInfo', 'aHub'].includes(k)) g.deleteAttribute(k);
      gs.push(g);
    }
    const merged = mergeGeometries(gs, false);
    if (!merged) throw new Error('vehicle kit: could not merge parts');
    for (const g of gs) g.dispose();
    return quantize(merged);
  }
}

/** Pack the merged geometry into the small vertex layout the vehicle shader reads (about 33 bytes a vertex). */
function quantize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const normal = g.getAttribute('normal') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const tint = g.getAttribute('aTint') as THREE.BufferAttribute, info = g.getAttribute('aInfo') as THREE.BufferAttribute, hub = g.getAttribute('aHub') as THREE.BufferAttribute;
  const nrm = new Int8Array(n * 3), uvs = new Uint16Array(n * 2), tin = new Uint8Array(n * 4), inf = new Uint8Array(n * 4), hb = new Int16Array(n * 3);
  for (let i = 0; i < n; i++) {
    nrm[i * 3] = Math.round(normal.getX(i) * 127); nrm[i * 3 + 1] = Math.round(normal.getY(i) * 127); nrm[i * 3 + 2] = Math.round(normal.getZ(i) * 127);
    uvs[i * 2] = Math.round(clamp(uv.getX(i), 0, 1) * 65535); uvs[i * 2 + 1] = Math.round(clamp(uv.getY(i), 0, 1) * 65535);
    for (let k = 0; k < 4; k++) { tin[i * 4 + k] = Math.round(clamp(tint.array[i * 4 + k], 0, 1) * 255); inf[i * 4 + k] = Math.round(info.array[i * 4 + k]); }
    for (let k = 0; k < 3; k++) hb[i * 3 + k] = Math.round(hub.array[i * 3 + k] * 1024);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2, true));
  out.setAttribute('aTint', new THREE.BufferAttribute(tin, 4, true));
  out.setAttribute('aInfo', new THREE.BufferAttribute(inf, 4, false));
  out.setAttribute('aHub', new THREE.BufferAttribute(hb, 3, false));
  out.computeBoundingBox(); out.computeBoundingSphere();
  g.dispose();
  return out;
}

export function triCount(g: THREE.BufferGeometry | undefined): number {
  return g ? (g.index?.count ?? g.getAttribute('position').count) / 3 : 0;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Wheels

export interface WheelSpec {
  r: number;          // tyre outer radius
  tw: number;         // tyre width
  rim: number;        // rim radius (fraction of r)
  style: 'star' | 'steel' | 'mud' | 'dually' | 'spoke' | 'cover' | 'truck' | 'bike' | 'cart';
  spokes?: number;
  rimColor?: number;
  both?: boolean;     // a wheel with a face on both sides (a motorcycle's)
  dual?: boolean;     // a second tyre inboard on every axle but the steering one (a dually)
}

/** A wheel for one side; axle along x. `steer` marks the front (steering) axle. Detail by level: close 14 x 5 tyre, star, dark well and disc; near a 10 x 3 tyre and a disc; far a hexagonal drum. */
export function addWheel(mb: ModelBuilder, cx: number, cy: number, cz: number, w: WheelSpec, steer: boolean, inner = false): void {
  const side = Math.sign(cx) || 1, code = steer ? 1 : 2, hub: V3 = [cx, cy, cz];
  const r = w.r, tw = w.tw, rimR = r * w.rim;
  const seg = mb.seg(14, 10, 6);
  const bulge = w.style === 'mud' ? 0.02 : 0.012;
  // tyre profile (radius, axial): rim edge, sidewall, tread shoulder, tread, and back
  const prof: Array<[number, number]> = mb.lod === 0
    ? [[rimR * 0.97, 0.42], [r * 0.9 + bulge, 0.5], [r, 0.3], [r, -0.3], [r * 0.9 + bulge, -0.5], [rimR * 0.97, -0.42]]
    : mb.lod === 1 ? [[r * 0.92, 0.5], [r, 0.32], [r, -0.32], [r * 0.92, -0.5]] : [[r, 0.5], [r, -0.5]];
  const tyre = flat(new THREE.LatheGeometry(prof.map(([rad, ax]) => new THREE.Vector2(rad, ax * tw)), seg));
  tyre.rotateZ(Math.PI / 2).translate(cx, cy, cz); // lathe axis y -> x
  mb.add(tyre, 0x111213, ZONE.TYRE, 0, code, hub);
  if (mb.lod === 2) return; // far: a bare hexagonal drum (12 triangles)
  if (inner) return; // the inboard tyre of a dually is only a tyre
  // mud lugs / dually tread blocks
  if (w.style === 'mud' && mb.close) {
    const lugs = 20;
    for (let i = 0; i < lugs; i++) {
      const a = (i / lugs) * Math.PI * 2;
      const lug = boxG(tw * 0.86, r * 0.1, r * 0.2, 0, 0, 0);
      lug.translate(0, r + r * 0.005, 0).rotateX(a).translate(cx, cy, cz);
      mb.add(lug, 0x151617, ZONE.TYRE, 0, code, hub);
    }
  }
  const outer = cx + side * (tw * 0.5 - 0.025);
  const rimColor = w.rimColor ?? 0xaeb4b8;
  if (mb.lod === 1) { mb.add(discG(rimR * 0.95, 10, outer, cy, cz, side), w.style === 'star' || w.style === 'spoke' ? 0x8d9498 : (w.rimColor ?? 0x7d8386), w.style === 'steel' || w.style === 'truck' ? ZONE.STEEL : ZONE.CHROME, 0, code, hub); return; }
  if (w.style === 'star' || w.style === 'spoke') {
    mb.add(discG(rimR * 0.96, 12, outer - side * 0.012, cy, cz, side), 0x1d1f21, ZONE.DARK, 0, code, hub); // the dark well between the spokes
    const n = w.spokes ?? 5, star: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, half = w.style === 'spoke' ? 0.07 : 0.16;
      star.push([Math.cos(a - half) * rimR * 0.97, Math.sin(a - half) * rimR * 0.97], [Math.cos(a + half) * rimR * 0.97, Math.sin(a + half) * rimR * 0.97]);
      const m = a + Math.PI / n;
      star.push([Math.cos(m) * rimR * 0.34, Math.sin(m) * rimR * 0.34]);
    }
    mb.add(shapeG(star, outer, cy, cz, side), rimColor, ZONE.CHROME, 0, code, hub);
  } else {
    // steel or covered wheel: a flat disc with a dark centre cap
    mb.add(discG(rimR * 0.95, 12, outer, cy, cz, side), w.style === 'cover' ? 0xb8bdc0 : (w.rimColor ?? 0x8b9094), w.style === 'cover' ? ZONE.CHROME : ZONE.STEEL, 0, code, hub);
    mb.add(discG(rimR * 0.3, 8, outer + side * 0.004, cy, cz, side), 0x2a2d30, ZONE.DARK, 0, code, hub);
  }
  if (w.both) mb.add(discG(rimR * 0.95, 10, cx - side * (tw * 0.5 - 0.025), cy, cz, -side), w.rimColor ?? 0xaeb4b8, ZONE.CHROME, 0, code, hub);
  // brake disc seen through the spokes
  if (w.style !== 'bike') mb.add(discG(rimR * 0.78, 10, cx + side * (tw * 0.5 - 0.09), cy, cz, side), 0x74777a, ZONE.STEEL, 0, code, hub);
}
