import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry of the instanced citizen. Every piece is a small indexed mesh in the rest pose (arms hanging, feet flat, 1.78 m to the
// crown, facing +z, "left" parts on -x like the old model) tagged per vertex with (part, zone, feature, cell):
//   part    the bone it follows (PART); the vertex shader poses the bones
//   zone    what it is made of (ZONE); the fragment shader picks the colour and paints details from the rest position
//   feature 0 = always drawn; 1..72 = drawn when that bit of the person's feature mask is set (bitOf); 100+n = prop n (PROP);
//           200+n = scene prop n (a crate under someone sitting)
// One merged geometry per level of detail, so the whole population is two draw calls (near, far).

export const PART = {
  root: 0, pelvis: 1, chest: 2, head: 3, upperL: 4, upperR: 5, foreL: 6, foreR: 7,
  thighL: 8, thighR: 9, calfL: 10, calfR: 11, footL: 12, footR: 13,
} as const;

export const ZONE = {
  skin: 1, shirt: 2, pants: 3, shoe: 4, hair: 5, outer: 6, face: 7, prop: 8, light: 9, decal: 10, metal: 11,
  trim: 12, bag: 13, sole: 14, dark: 15, hivis: 16, white: 17, arm: 18, fore: 19, leg: 20, glass: 21, wood: 22, hat: 23, card: 24,
} as const;

/** Props are picked by action (smoke -> cigarette ...) or by the archetype's own; ids are what a prop piece's feature says (100 + id). */
export const PROP = {
  none: 0, cigarette: 1, beer: 2, vape: 3, phone: 4, sign: 5, drum: 6, tumbler: 7, briefcase: 8, clipboard: 9, laptop: 10,
  skateboard: 11, cane: 12, paddle: 13, basket: 14, blower: 15, sparkler: 16, tube: 17, coffee: 18, ruler: 19, flag: 20,
} as const;
export type PropName = keyof typeof PROP;

/** The feature bit of a named piece group (allocated in order of first use; 24 to a mask word, three words). */
const BIT_NAMES: string[] = [];
export function bitOf(name: string): number {
  let i = BIT_NAMES.indexOf(name);
  if (i < 0) { i = BIT_NAMES.push(name) - 1; if (i >= 72) throw new Error('person feature bits exhausted at ' + name); }
  return i;
}
export function bitNames(): readonly string[] { return BIT_NAMES; }

// --- measurements (metres, rest pose) ---------------------------------------------------------------------------------------
export const M = {
  crown: 1.78, headY: 1.635, neckY: 1.47, waistY: 1.04, pelvisY: 0.92,
  shoulderX: 0.215, shoulderY: 1.37, upperArm: 0.29, foreArm: 0.27, handLen: 0.10,
  hipX: 0.10, hipY: 0.90, thigh: 0.44, calf: 0.38, ankleY: 0.08, heel: 0.07, toe: 0.20,
} as const;
const { shoulderX: SX, hipX: HX } = M;

// --- builders -----------------------------------------------------------------------------------------------------------------
export interface Ring { y: number; rx: number; rz?: number; cx?: number; cz?: number }
export type Xf = { t?: [number, number, number]; s?: [number, number, number]; r?: [number, number, number] };

function bare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

export function xform(g: THREE.BufferGeometry, x: Xf): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...(x.t ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(x.r ?? [0, 0, 0]), 'XYZ')),
    new THREE.Vector3(...(x.s ?? [1, 1, 1])),
  );
  g.applyMatrix4(m);
  return g;
}

/** Flip triangles that face the inside of the shape (majority vote against the bounding-box centre), then smooth-shade. */
function outward(g: THREE.BufferGeometry, invert = false): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), idx = g.index!;
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  let vote = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); d.fromBufferAttribute(pos, idx.getX(i + 2));
    n.crossVectors(e.subVectors(b, a), d.sub(a));
    e.copy(a).add(b).add(d).multiplyScalar(1 / 3).sub(c);
    vote += Math.sign(n.dot(e)) * Math.min(1, n.length() * 200);
  }
  if ((vote < 0) !== invert) {
    for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A tube through elliptical rings (y up), smooth-shaded; ends optionally closed with a fan. `seg` sides, one vertex always points
 * straight forward (+z).
 */
export function loft(rings: Ring[], seg = 8, o: { top?: boolean; bottom?: boolean; rot?: number; invert?: boolean } = {}): THREE.BufferGeometry {
  const rot = o.rot ?? (Math.PI / 2 - (Math.PI * 2) / seg);
  const p: number[] = [], ix: number[] = [];
  for (const r of rings) {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2 + rot;
      p.push((r.cx ?? 0) + r.rx * Math.cos(a), r.y, (r.cz ?? 0) + (r.rz ?? r.rx) * Math.sin(a));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg), c = (i + 1) * seg + k, d = (i + 1) * seg + ((k + 1) % seg);
      ix.push(a, c, b, b, c, d);
    }
  }
  const cap = (ring: Ring, base: number, up: boolean) => {
    const ci = p.length / 3;
    p.push(ring.cx ?? 0, ring.y, ring.cz ?? 0);
    for (let k = 0; k < seg; k++) { const a = base + k, b = base + ((k + 1) % seg); if (up) ix.push(ci, b, a); else ix.push(ci, a, b); }
  };
  if (o.top) cap(rings[rings.length - 1], (rings.length - 1) * seg, true);
  if (o.bottom) cap(rings[0], 0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(ix);
  return outward(g, o.invert);
}

/** A closed ellipsoid centred at c: `rings` latitude bands, `seg` around. */
export function ellipsoid(rx: number, ry: number, rz: number, seg = 8, rings = 4, c: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const r: Ring[] = [];
  for (let i = 1; i < rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    r.push({ y: c[1] + ry * Math.sin(a), rx: rx * Math.cos(a), rz: rz * Math.cos(a), cx: c[0], cz: c[2] });
  }
  const g = loft(r, seg, { top: true, bottom: true });
  const pos = g.getAttribute('position'), n = seg * r.length;
  pos.setY(n, c[1] + ry); pos.setY(n + 1, c[1] - ry); // pull the two poles out to the true ellipsoid ends
  g.computeVertexNormals();
  return g;
}

export function box(w: number, h: number, d: number, x: Xf = {}): THREE.BufferGeometry {
  return xform(bare(new THREE.BoxGeometry(w, h, d)), x);
}

export function cylinder(r0: number, r1: number, h: number, seg = 6, x: Xf = {}): THREE.BufferGeometry {
  return xform(bare(new THREE.CylinderGeometry(r1, r0, h, seg, 1, false)), x);
}

/** A slab extruded along x from a closed profile of (z, y) points (any simple polygon, holes not allowed), half-width `hw`, flat-shaded. */
export function slab(profile: [number, number][], hw: number, x: Xf = {}): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 2 * hw, bevelEnabled: false, steps: 1 });
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g.translate(0, 0, -hw);
  // shape x -> z, shape y -> y, extrusion -> x: swapping two axes mirrors the mesh, so the winding is turned back
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  const n = g.getAttribute('position').count, ix: number[] = [];
  for (let i = 0; i < n; i += 3) ix.push(i, i + 2, i + 1);
  g.setIndex(ix);
  g.computeVertexNormals();
  return xform(g, x);
}

/** drop the triangles whose centre `drop` says to, and the vertices nothing uses any more (open hoods, half-shells, a beard) */
export function carve(g: THREE.BufferGeometry, drop: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), idx = g.index!;
  const keep: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (!drop(x, y, z)) keep.push(a, b, c);
  }
  const remap = new Map<number, number>(), p: number[] = [], ix: number[] = [];
  for (const v of keep) {
    let n = remap.get(v);
    if (n === undefined) { n = p.length / 3; remap.set(v, n); p.push(pos.getX(v), pos.getY(v), pos.getZ(v)); }
    ix.push(n);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  out.setIndex(ix);
  out.computeVertexNormals();
  return out;
}

// --- tagging & catalogue ------------------------------------------------------------------------------------------------------
export interface Piece { name: string; geometry: THREE.BufferGeometry; part: number; zone: number; feature: number }

function piece(name: string, g: THREE.BufferGeometry, part: number, zone: number, feature: number | string = 0, cell = 0): Piece {
  const geo = bare(g);
  const feat = typeof feature === 'string' ? bitOf(feature) + 1 : feature;
  const n = geo.getAttribute('position').count;
  const tag = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { tag[i * 4] = part; tag[i * 4 + 1] = zone; tag[i * 4 + 2] = feat; tag[i * 4 + 3] = cell; }
  geo.setAttribute('aTag', new THREE.BufferAttribute(tag, 4));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  return { name, geometry: geo, part, zone, feature: feat };
}

export type LodName = 'near' | 'far';

/** Every piece of a level of detail, in the rest pose. */
export function buildPieces(lod: LodName): Piece[] {
  return lod === 'near' ? nearPieces() : farPieces();
}

/** a hand-held prop, in the right forearm's frame: the hand is at (0.215, 0.775, 0), the prop lies along +z out of the fist */
const HAND = { x: SX, y: 0.775 };
const propFeature = (name: PropName) => 100 + PROP[name];

function nearPieces(): Piece[] {
  const P: Piece[] = [];
  const add = (name: string, g: THREE.BufferGeometry, part: number, zone: number, feature: number | string = 0, cell = 0) => { P.push(piece(name, g, part, zone, feature, cell)); };
  const pair = (name: string, make: (s: -1 | 1) => THREE.BufferGeometry, partL: number, partR: number, zone: number, feature: number | string = 0) => {
    add(name + 'L', make(-1), partL, zone, feature); add(name + 'R', make(1), partR, zone, feature);
  };

  // ---- head & neck. The face is the three middle rings of the head's front, lifted 2 mm, so the picture sits on the facets.
  const headRings: Ring[] = [
    { y: 1.500, rx: 0.050, rz: 0.065, cz: 0.014 },
    { y: 1.575, rx: 0.112, rz: 0.114, cz: 0.004 },
    { y: 1.650, rx: 0.128, rz: 0.128 },
    { y: 1.725, rx: 0.112, rz: 0.118, cz: -0.006 },
    { y: 1.775, rx: 0.058, rz: 0.070, cz: -0.010 },
  ];
  add('head', loft(headRings, 8, { top: true }), PART.head, ZONE.skin);
  add('neck', loft([{ y: 1.40, rx: 0.058 }, { y: 1.52, rx: 0.054 }], 6), PART.head, ZONE.skin);
  {
    // the face: the three middle rings' front three vertices, copied 2 mm out along the head's own normals (so it shades as the head)
    const head = P[0].geometry, hp = head.getAttribute('position'), hn = head.getAttribute('normal');
    const p: number[] = [], n: number[] = [], ix: number[] = [];
    for (const ring of [1, 2, 3]) for (const k of [2, 1, 0]) { // vertex k of a ring sits at 45 + 45 k degrees: 135, 90, 45
      const v = ring * 8 + k;
      p.push(hp.getX(v) + hn.getX(v) * 0.002, hp.getY(v) + hn.getY(v) * 0.002, hp.getZ(v) + hn.getZ(v) * 0.002);
      n.push(hn.getX(v), hn.getY(v), hn.getZ(v));
    }
    for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) { const a = i * 3 + k; ix.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setIndex(ix);
    // wind it like the head's front faces (outward), without recomputing normals
    const gp = g.getAttribute('position'), a0 = new THREE.Vector3().fromBufferAttribute(gp, 0), a1 = new THREE.Vector3().fromBufferAttribute(gp, 1), a3 = new THREE.Vector3().fromBufferAttribute(gp, 3);
    if (new THREE.Vector3().crossVectors(a1.clone().sub(a0), a3.clone().sub(a0)).z < 0) { const ii = g.index!; for (let i = 0; i < ii.count; i += 3) { const t = ii.getX(i + 1); ii.setX(i + 1, ii.getX(i + 2)); ii.setX(i + 2, t); } }
    add('face', g, PART.head, ZONE.face);
  }
  add('nose', xform(bare(new THREE.ConeGeometry(0.018, 0.04, 3)), { t: [0, 1.638, 0.138], r: [Math.PI / 2, 0, 0] }), PART.head, ZONE.skin);

  // ---- torso, pelvis
  add('chest', loft([
    { y: 0.92, rx: 0.202, rz: 0.134 },
    { y: 1.20, rx: 0.186, rz: 0.114, cz: 0.004 },
    { y: 1.355, rx: 0.212, rz: 0.108 },
    { y: 1.425, rx: 0.100, rz: 0.075 },
  ], 8), PART.chest, ZONE.shirt);
  add('pelvis', loft([
    { y: 0.835, rx: 0.124, rz: 0.084 },
    { y: 0.930, rx: 0.180, rz: 0.112 },
    { y: 1.040, rx: 0.160, rz: 0.100 },
  ], 8), PART.pelvis, ZONE.pants);

  // ---- arms (hanging), legs
  pair('upperArm', (s) => loft([
    { y: 1.40, rx: 0.060, cx: s * SX }, { y: 1.24, rx: 0.053, cx: s * SX }, { y: 1.09, rx: 0.046, cx: s * SX },
  ], 6, { top: true }), PART.upperL, PART.upperR, ZONE.arm);
  pair('foreArm', (s) => loft([
    { y: 1.10, rx: 0.045, cx: s * SX }, { y: 0.96, rx: 0.048, cx: s * SX }, { y: 0.83, rx: 0.035, cx: s * SX },
  ], 6), PART.foreL, PART.foreR, ZONE.fore);
  pair('hand', (s) => ellipsoid(0.038, 0.066, 0.028, 6, 2, [s * SX, 0.77, 0.004]), PART.foreL, PART.foreR, ZONE.skin);
  pair('thigh', (s) => loft([
    { y: 0.925, rx: 0.090, cx: s * HX }, { y: 0.74, rx: 0.088, cx: s * HX }, { y: 0.56, rx: 0.068, cx: s * HX }, { y: 0.455, rx: 0.048, cx: s * HX },
  ], 6, { bottom: true }), PART.thighL, PART.thighR, ZONE.leg);
  pair('calf', (s) => loft([
    { y: 0.495, rx: 0.050, cx: s * HX }, { y: 0.35, rx: 0.060, cx: s * HX, cz: -0.008 }, { y: 0.17, rx: 0.043, cx: s * HX }, { y: 0.09, rx: 0.038, cx: s * HX },
  ], 6, { top: true }), PART.calfL, PART.calfR, ZONE.leg);
  // shoe: lofted along y then laid down (loft y -> forward z, loft z -> down); heel at -0.078, toe at +0.205, sole on y = 0
  pair('shoe', (s) => xform(loft([
    { y: -0.078, rx: 0.040, rz: 0.042, cz: -0.042 },
    { y: 0.070, rx: 0.050, rz: 0.042, cz: -0.040 },
    { y: 0.205, rx: 0.036, rz: 0.025, cz: -0.024 },
  ], 6, { top: true, bottom: true }), { t: [s * HX, 0, 0], r: [Math.PI / 2, 0, 0] }), PART.footL, PART.footR, ZONE.shoe);

  // ---- clothes that change the outline
  // garments share the ring heights of the body under them (chest 1.00 / 1.20 / 1.355 / 1.425, pelvis .835 / .93 / 1.04), so the
  // belly and shoulder stretch of a build moves cloth and body together and one never pokes through the other
  const jacket = (bot: number, sleeveless = false): Ring[] => [
    { y: bot, rx: 0.220, rz: 0.156 }, { y: 1.04, rx: 0.208, rz: 0.138 }, { y: 1.20, rx: 0.212, rz: 0.136, cz: 0.004 },
    { y: 1.355, rx: sleeveless ? 0.222 : 0.240, rz: 0.120 }, { y: 1.425, rx: 0.106, rz: 0.088 },
  ];
  add('jacket', loft(jacket(0.84), 8), PART.chest, ZONE.outer, 'jacket');
  add('jacketShort', loft(jacket(0.94), 8), PART.chest, ZONE.outer, 'jacketShort');
  // vests go over jackets: a little wider than the jacket they may sit on
  const vestRings = (bot: number): Ring[] => [
    { y: bot, rx: 0.232, rz: 0.168 }, { y: 1.04, rx: 0.220, rz: 0.150 }, { y: 1.20, rx: 0.224, rz: 0.148, cz: 0.004 },
    { y: 1.355, rx: 0.252, rz: 0.13 }, { y: 1.425, rx: 0.112, rz: 0.094 },
  ];
  add('vestOver', loft(vestRings(0.96), 8), PART.chest, ZONE.outer, 'vestOver');
  add('hivisVest', loft(vestRings(0.98), 8), PART.chest, ZONE.hivis, 'hivisVest');
  add('coat', loft([
    { y: 0.62, rx: 0.27, rz: 0.19 }, { y: 0.93, rx: 0.225, rz: 0.155 }, { y: 1.04, rx: 0.215, rz: 0.146 }, { y: 1.20, rx: 0.222, rz: 0.142, cz: 0.004 },
    { y: 1.355, rx: 0.24, rz: 0.12 }, { y: 1.425, rx: 0.106, rz: 0.088 },
  ], 8), PART.chest, ZONE.outer, 'coat', 2);
  add('robe', loft([{ y: 0.22, rx: 0.32, rz: 0.27 }, { y: 0.55, rx: 0.27, rz: 0.22 }, { y: 0.90, rx: 0.20, rz: 0.15 }, { y: 1.02, rx: 0.17, rz: 0.11 }], 8), PART.pelvis, ZONE.shirt, 'robe', 2);
  add('hoodShirt', loft([{ y: 1.33, rx: 0.135, rz: 0.075, cz: -0.075 }, { y: 1.42, rx: 0.12, rz: 0.095, cz: -0.085 }, { y: 1.51, rx: 0.07, rz: 0.06, cz: -0.075 }], 8), PART.chest, ZONE.shirt, 'hoodShirt');
  add('hoodOuter', loft([{ y: 1.33, rx: 0.145, rz: 0.08, cz: -0.075 }, { y: 1.42, rx: 0.13, rz: 0.10, cz: -0.088 }, { y: 1.52, rx: 0.075, rz: 0.065, cz: -0.078 }], 8), PART.chest, ZONE.outer, 'hoodOuter');
  add('bib', box(0.19, 0.24, 0.02, { t: [0, 1.15, 0.108] }), PART.chest, ZONE.outer, 'bib');
  add('merchBack', box(0.22, 0.11, 0.012, { t: [0, 1.22, -0.118], r: [0, 0, -0.1] }), PART.chest, ZONE.decal, 'merchBack');

  // ---- hair and hats: shells that follow the head's own rings, a few millimetres out
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const headAt = (y: number) => {
    for (let i = 0; i < headRings.length - 1; i++) {
      const a = headRings[i], b = headRings[i + 1];
      if (y <= b.y) { const t = (y - a.y) / (b.y - a.y); return { rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz ?? a.rx, b.rz ?? b.rx, t), cz: lerp(a.cz ?? 0, b.cz ?? 0, t) }; }
    }
    return { rx: 0.02, rz: 0.03, cz: -0.012 };
  };
  // ring heights: the hairline / brim line, then the head's own ring heights above it, so the shell has the same kinks as the skull
  const shell = (y0: number, dr: number, dome = 0.02): Ring[] => {
    const ys = [y0, ...headRings.map((r) => r.y).filter((y) => y > y0 + 0.004)];
    const r = ys.map((y) => { const h = headAt(y); return { y, rx: h.rx + dr, rz: h.rz + dr, cz: h.cz }; });
    const last = r[r.length - 1];
    r.push({ y: last.y + dome + dr * 0.5, rx: last.rx * 0.35, rz: last.rz * 0.35, cz: last.cz });
    return r;
  };
  add('hairCap', loft(shell(1.70, 0.010), 8, { top: true }), PART.head, ZONE.hair, 'hairCap');
  add('hairLong', loft([{ y: 1.30, rx: 0.13, rz: 0.06, cz: -0.10 }, { y: 1.45, rx: 0.14, rz: 0.075, cz: -0.095 }, { y: 1.58, rx: 0.135, rz: 0.09, cz: -0.075 }, { y: 1.70, rx: 0.13, rz: 0.11, cz: -0.04 }], 8), PART.head, ZONE.hair, 'hairLong', 1);
  add('hairTail', loft([{ y: 1.37, rx: 0.028, rz: 0.028, cz: -0.245 }, { y: 1.52, rx: 0.036, rz: 0.036, cz: -0.21 }, { y: 1.68, rx: 0.04, rz: 0.04, cz: -0.15 }], 6, { top: true, bottom: true }), PART.head, ZONE.hair, 'hairTail', 1);
  add('hairMullet', loft([{ y: 1.44, rx: 0.10, rz: 0.05, cz: -0.115 }, { y: 1.57, rx: 0.12, rz: 0.07, cz: -0.10 }, { y: 1.70, rx: 0.128, rz: 0.10, cz: -0.05 }], 8), PART.head, ZONE.hair, 'hairMullet', 1);
  add('hairBun', ellipsoid(0.055, 0.05, 0.055, 6, 2, [0, 1.80, -0.085]), PART.head, ZONE.hair, 'hairBun');
  add('hairFin', slab([[-0.14, 1.70], [-0.09, 1.83], [0.05, 1.88], [0.13, 1.78], [0.125, 1.72], [-0.05, 1.75]], 0.02), PART.head, ZONE.hair, 'hairFin');

  add('capCrown', loft(shell(1.685, 0.022), 8, { top: true }), PART.head, ZONE.hat, 'capCrown');
  add('capBrim', slab([[0.10, 1.715], [0.245, 1.70], [0.25, 1.71], [0.105, 1.735]], 0.088), PART.head, ZONE.hat, 'capBrim');
  add('beanie', loft(shell(1.665, 0.026, 0.035), 8, { top: true }), PART.head, ZONE.hat, 'beanie');
  add('hardCrown', loft(shell(1.68, 0.028, 0.03), 8, { top: true }), PART.head, ZONE.hat, 'hardCrown');
  add('hardBrim', slab([[0.11, 1.705], [0.215, 1.695], [0.22, 1.705], [0.12, 1.73]], 0.105), PART.head, ZONE.hat, 'hardBrim');
  add('foilCone', xform(bare(new THREE.ConeGeometry(0.15, 0.36, 5)), { t: [0, 1.93, -0.005] }), PART.head, ZONE.metal, 'foilCone');
  add('sunCrown', loft(shell(1.69, 0.024, 0.02), 8, { top: true }), PART.head, ZONE.hat, 'sunCrown');
  add('sunBrim', loft([{ y: 1.70, rx: 0.34, rz: 0.34 }, { y: 1.715, rx: 0.15, rz: 0.15 }], 10), PART.head, ZONE.hat, 'sunBrim');
  add('cowboyCrown', loft(shell(1.69, 0.02, 0.09), 8, { top: true }), PART.head, ZONE.hat, 'cowboyCrown');
  add('cowboyBrim', loft([{ y: 1.695, rx: 0.30, rz: 0.26 }, { y: 1.715, rx: 0.14, rz: 0.14 }], 10), PART.head, ZONE.hat, 'cowboyBrim');

  // ---- more hair, headwear and face gear
  add('hairBob', carve(loft([{ y: 1.50, rx: 0.14, rz: 0.14, cz: -0.02 }, { y: 1.60, rx: 0.152, rz: 0.15, cz: -0.02 }, { y: 1.70, rx: 0.14, rz: 0.14, cz: -0.01 }], 8), (x, _y, z) => z > 0.05), PART.head, ZONE.hair, 'hairBob', 1);
  add('hairCurls', xform(ellipsoid(0.185, 0.14, 0.18, 8, 4), { t: [0, 1.80, -0.03] }), PART.head, ZONE.hair, 'hairCurls');
  add('hairBald', carve(loft([{ y: 1.58, rx: 0.132, rz: 0.134, cz: 0.0 }, { y: 1.66, rx: 0.138, rz: 0.138, cz: -0.004 }], 8), (_x, _y, z) => z > 0.0), PART.head, ZONE.hair, 'hairBald');
  for (const s of [-1, 1]) add('hairPig' + s, xform(loft([{ y: 1.36, rx: 0.03, rz: 0.03 }, { y: 1.52, rx: 0.04, rz: 0.04 }, { y: 1.68, rx: 0.036, rz: 0.036 }], 6, { top: true, bottom: true }), { t: [s * 0.17, 0, -0.03], r: [0, 0, s * 0.18] }), PART.head, ZONE.hair, 'pigtails', 1);
  add('beard3d', carve(loft([{ y: 1.475, rx: 0.05, rz: 0.055, cz: 0.07 }, { y: 1.52, rx: 0.11, rz: 0.11, cz: 0.035 }, { y: 1.585, rx: 0.122, rz: 0.12, cz: 0.012 }], 8), (_x, _y, z) => z < -0.02), PART.head, ZONE.hair, 'beard3d');
  add('flatCrown', loft(shell(1.69, 0.02, 0.0), 8, { top: true }), PART.head, ZONE.hat, 'flatcap');
  add('flatPeak', slab([[0.09, 1.72], [0.19, 1.705], [0.195, 1.715], [0.10, 1.74]], 0.09), PART.head, ZONE.hat, 'flatcap');
  add('visorBand', loft([{ y: 1.695, rx: 0.14, rz: 0.142, cz: -0.004 }, { y: 1.735, rx: 0.125, rz: 0.13, cz: -0.006 }], 8), PART.head, ZONE.hat, 'visor');
  add('visorBrim', slab([[0.11, 1.715], [0.27, 1.70], [0.275, 1.71], [0.115, 1.735]], 0.10), PART.head, ZONE.hat, 'visor');
  add('helmet', loft(shell(1.655, 0.03, 0.05), 8, { top: true }), PART.head, ZONE.hat, 'helmet');
  add('headphonesBand', slab([[-0.02, 1.83], [0.02, 1.83], [0.13, 1.75], [0.15, 1.66], [0.12, 1.66], [0.10, 1.74], [0.0, 1.79], [-0.10, 1.74], [-0.12, 1.66], [-0.15, 1.66], [-0.13, 1.75]], 0.012, { r: [0, Math.PI / 2, 0] }), PART.head, ZONE.dark, 'headphones');
  for (const s of [-1, 1]) add('cup' + s, cylinder(0.05, 0.05, 0.045, 8, { t: [s * 0.14, 1.66, 0.0], r: [0, 0, Math.PI / 2] }), PART.head, ZONE.dark, 'headphones');
  add('headband', loft([{ y: 1.700, rx: 0.135, rz: 0.137, cz: -0.004 }, { y: 1.722, rx: 0.13, rz: 0.134, cz: -0.005 }], 8), PART.head, ZONE.trim, 'headband');
  add('flowers', loft([{ y: 1.706, rx: 0.14, rz: 0.142, cz: -0.004 }, { y: 1.73, rx: 0.132, rz: 0.136, cz: -0.006 }], 8), PART.head, ZONE.decal, 'flowers');
  add('hoodUp', carve(loft([{ y: 1.46, rx: 0.15, rz: 0.15, cz: -0.03 }, { y: 1.60, rx: 0.17, rz: 0.17, cz: -0.02 }, { y: 1.72, rx: 0.16, rz: 0.165, cz: -0.02 }, { y: 1.80, rx: 0.09, rz: 0.11, cz: -0.03 }], 8, { top: true }), (_x, y, z) => z > 0.075 && y > 1.5), PART.head, ZONE.shirt, 'hoodUp');
  add('shadesHead', box(0.2, 0.03, 0.05, { t: [0, 1.75, 0.075], r: [-0.5, 0, 0] }), PART.head, ZONE.dark, 'shadesHead');

  // ---- clothes that change the outline
  add('skirtLong', loft([{ y: 0.40, rx: 0.29, rz: 0.25 }, { y: 0.70, rx: 0.25, rz: 0.20 }, { y: 0.93, rx: 0.205, rz: 0.14 }, { y: 1.04, rx: 0.168, rz: 0.11 }], 8), PART.pelvis, ZONE.shirt, 'dress', 2);
  add('apronBib', box(0.20, 0.24, 0.016, { t: [0, 1.20, 0.13] }), PART.chest, ZONE.outer, 'apron');
  add('apronSkirt', box(0.27, 0.33, 0.016, { t: [0, 0.85, 0.128] }), PART.pelvis, ZONE.outer, 'apron');
  for (const k of [-1, 0, 1]) add('pouch' + k, box(0.08, 0.09, 0.05, { t: [k * 0.095, 1.06, 0.13] }), PART.chest, ZONE.dark, 'pouches');
  add('badge', box(0.075, 0.10, 0.012, { t: [0, 1.17, 0.125] }), PART.chest, ZONE.white, 'badge');
  for (const s of [-1, 1]) add('boot' + s, loft([{ y: 0.07, rx: 0.056, cx: s * HX }, { y: 0.25, rx: 0.064, cx: s * HX }], 6, { top: true }), s < 0 ? PART.calfL : PART.calfR, ZONE.shoe, 'boots');

  // ---- bags
  add('backpack', box(0.30, 0.38, 0.15, { t: [0, 1.20, -0.185] }), PART.chest, ZONE.bag, 'backpack');
  add('bigpackA', box(0.34, 0.50, 0.22, { t: [0, 1.15, -0.21] }), PART.chest, ZONE.bag, 'bigpack');
  add('bigpackRoll', cylinder(0.075, 0.075, 0.40, 8, { t: [0, 1.42, -0.22], r: [0, 0, Math.PI / 2] }), PART.chest, ZONE.dark, 'bigpack');
  add('deliveryBag', box(0.46, 0.44, 0.36, { t: [0, 1.20, -0.29] }), PART.chest, ZONE.bag, 'delivery');
  add('messenger', box(0.34, 0.24, 0.11, { t: [0.19, 0.93, -0.10], r: [0, 0, -0.1] }), PART.pelvis, ZONE.bag, 'messenger');
  add('tote', box(0.30, 0.32, 0.10, { t: [-0.29, 0.80, 0.0] }), PART.pelvis, ZONE.bag, 'tote');
  add('fanny', box(0.22, 0.11, 0.09, { t: [0, 0.98, 0.135] }), PART.pelvis, ZONE.bag, 'fanny');
  add('toolbelt', loft([{ y: 0.905, rx: 0.195, rz: 0.135 }, { y: 0.985, rx: 0.19, rz: 0.13 }], 8), PART.pelvis, ZONE.dark, 'toolbelt');
  for (const s of [-1, 1]) add('toolpouch' + s, box(0.07, 0.15, 0.09, { t: [s * 0.2, 0.86, 0.02] }), PART.pelvis, ZONE.bag, 'toolbelt');
  add('chairBag', cylinder(0.055, 0.055, 0.95, 6, { t: [0, 1.15, -0.13], r: [0, 0, 0.55] }), PART.chest, ZONE.bag, 'chairbag');
  add('camera', box(0.14, 0.09, 0.08, { t: [0, 1.15, 0.15] }), PART.chest, ZONE.dark, 'camera');

  // ---- hand-held props: in the right forearm's frame, out of the fist along +z (so they end up upright when the elbow is bent)
  const hx = HAND.x, hy = HAND.y;
  add('cigarette', cylinder(0.0055, 0.0055, 0.10, 5, { t: [hx - 0.005, hy - 0.01, 0.075], r: [Math.PI / 2, 0, 0] }), PART.foreR, ZONE.white, propFeature('cigarette'));
  add('ember', xform(ellipsoid(0.008, 0.008, 0.008, 5, 2), { t: [hx - 0.005, hy - 0.01, 0.128] }), PART.foreR, ZONE.light, propFeature('cigarette'));
  add('beerCan', cylinder(0.034, 0.034, 0.13, 8, { t: [hx, hy - 0.005, 0.07], r: [Math.PI / 2, 0, 0] }), PART.foreR, ZONE.prop, propFeature('beer'));
  add('beerTop', cylinder(0.030, 0.030, 0.014, 8, { t: [hx, hy - 0.005, 0.14], r: [Math.PI / 2, 0, 0] }), PART.foreR, ZONE.metal, propFeature('beer'));
  add('vape', box(0.03, 0.03, 0.13, { t: [hx, hy - 0.01, 0.085] }), PART.foreR, ZONE.dark, propFeature('vape'));
  add('vapeTip', box(0.026, 0.026, 0.012, { t: [hx, hy - 0.01, 0.155] }), PART.foreR, ZONE.light, propFeature('vape'));
  add('phone', box(0.072, 0.15, 0.011, { t: [hx, hy - 0.02, 0.035] }), PART.foreR, ZONE.dark, propFeature('phone'));
  add('phoneScreen', box(0.062, 0.135, 0.004, { t: [hx, hy - 0.02, 0.04] }), PART.foreR, ZONE.light, propFeature('phone'));
  // a sign: a pole out of the fist along the forearm's line (so it points up when the arm is raised) with the board at the far end
  add('signPole', cylinder(0.014, 0.014, 0.86, 5, { t: [hx, hy - 0.40, 0.0] }), PART.foreR, ZONE.wood, propFeature('sign'));
  add('signBoard', box(0.56, 0.38, 0.022, { t: [hx, hy - 0.82, 0.0] }), PART.foreR, ZONE.card, propFeature('sign'));
  add('tumblerCup', cylinder(0.036, 0.042, 0.2, 8, { t: [hx, hy - 0.005, 0.11], r: [Math.PI / 2, 0, 0] }), PART.foreR, ZONE.bag, propFeature('tumbler'));
  add('tumblerHandle', box(0.012, 0.09, 0.03, { t: [hx + 0.06, hy - 0.005, 0.04] }), PART.foreR, ZONE.bag, propFeature('tumbler'));
  add('tumblerLid', cylinder(0.038, 0.038, 0.02, 8, { t: [hx, hy - 0.005, 0.215], r: [Math.PI / 2, 0, 0] }), PART.foreR, ZONE.white, propFeature('tumbler'));
  add('coffeeCup', cylinder(0.032, 0.04, 0.115, 8, { t: [hx, hy - 0.005, 0.075], r: [Math.PI / 2, 0, 0] }), PART.foreR, ZONE.white, propFeature('coffee'));
  add('coffeeLid', cylinder(0.042, 0.042, 0.018, 8, { t: [hx, hy - 0.005, 0.14], r: [Math.PI / 2, 0, 0] }), PART.foreR, ZONE.dark, propFeature('coffee'));
  add('briefcaseHandle', box(0.02, 0.09, 0.15, { t: [hx, hy - 0.07, 0.0] }), PART.foreR, ZONE.dark, propFeature('briefcase'));
  add('briefcase', box(0.075, 0.30, 0.42, { t: [hx + 0.02, hy - 0.26, 0.0] }), PART.foreR, ZONE.dark, propFeature('briefcase'));
  add('clipboard', box(0.23, 0.31, 0.014, { t: [hx, hy - 0.10, 0.04] }), PART.foreR, ZONE.wood, propFeature('clipboard'));
  add('clipPaper', box(0.2, 0.27, 0.006, { t: [hx, hy - 0.09, 0.05] }), PART.foreR, ZONE.white, propFeature('clipboard'));
  add('laptop', box(0.04, 0.24, 0.34, { t: [hx - 0.05, hy - 0.02, 0.06] }), PART.foreR, ZONE.metal, propFeature('laptop'));
  add('skateboard', box(0.19, 0.78, 0.02, { t: [hx, hy - 0.22, 0.09] }), PART.foreR, ZONE.wood, propFeature('skateboard'));
  add('cane', cylinder(0.013, 0.013, 0.86, 5, { t: [hx, hy - 0.40, 0.0] }), PART.foreR, ZONE.wood, propFeature('cane'));
  add('caneHook', box(0.04, 0.03, 0.09, { t: [hx, hy + 0.05, 0.03] }), PART.foreR, ZONE.wood, propFeature('cane'));
  add('paddleFace', box(0.19, 0.25, 0.014, { t: [hx, hy - 0.30, 0.0], r: [0, Math.PI / 2, 0] }), PART.foreR, ZONE.bag, propFeature('paddle'));
  add('paddleHandle', cylinder(0.014, 0.014, 0.13, 5, { t: [hx, hy - 0.10, 0.0] }), PART.foreR, ZONE.dark, propFeature('paddle'));
  add('basketBowl', loft([{ y: hy - 0.36, rx: 0.10, cx: hx }, { y: hy - 0.22, rx: 0.16, cx: hx }, { y: hy - 0.16, rx: 0.17, cx: hx }], 8, { bottom: true }), PART.foreR, ZONE.wood, propFeature('basket'));
  add('basketHandle', slab([[-0.16, hy - 0.16], [-0.12, hy - 0.02], [0.12, hy - 0.02], [0.16, hy - 0.16], [0.14, hy - 0.16], [0.10, hy - 0.05], [-0.10, hy - 0.05], [-0.14, hy - 0.16]], 0.008, { t: [hx, 0, 0] }), PART.foreR, ZONE.wood, propFeature('basket'));
  add('blowerTube', cylinder(0.03, 0.045, 0.62, 6, { t: [hx, hy - 0.36, 0.0] }), PART.foreR, ZONE.dark, propFeature('blower'));
  add('blowerMotor', box(0.13, 0.2, 0.15, { t: [hx, hy - 0.02, 0.0] }), PART.foreR, ZONE.hivis, propFeature('blower'));
  add('tubeRoll', cylinder(0.042, 0.042, 0.66, 6, { t: [hx, hy - 0.10, 0.06] }), PART.foreR, ZONE.white, propFeature('tube'));
  add('ruler', box(0.03, 0.95, 0.008, { t: [hx, hy - 0.52, 0.0] }), PART.foreR, ZONE.wood, propFeature('ruler'));
  // a hand drum hung at the belly
  add('drum', cylinder(0.17, 0.17, 0.25, 10, { t: [0, 1.0, 0.27], r: [Math.PI / 2, 0, 0] }), PART.pelvis, ZONE.prop, propFeature('drum'));
  add('drumHead', cylinder(0.165, 0.165, 0.012, 10, { t: [0, 1.0, 0.40], r: [Math.PI / 2, 0, 0] }), PART.pelvis, ZONE.white, propFeature('drum'));

  // ---- a crate to sit on (scene prop 1)
  add('crate', box(0.34, 0.36, 0.34, { t: [0, 0.18, 0.02] }), PART.root, ZONE.wood, 201);
  return P;
}

function farPieces(): Piece[] {
  const P: Piece[] = [];
  const add = (name: string, g: THREE.BufferGeometry, part: number, zone: number, feature: number | string = 0, cell = 0) => { P.push(piece(name, g, part, zone, feature, cell)); };
  add('head', loft([{ y: 1.50, rx: 0.06 }, { y: 1.65, rx: 0.13 }, { y: 1.775, rx: 0.07 }], 5, { top: true, bottom: true }), PART.head, ZONE.skin);
  add('chest', loft([{ y: 0.93, rx: 0.19, rz: 0.12 }, { y: 1.30, rx: 0.205, rz: 0.11 }, { y: 1.44, rx: 0.08, rz: 0.06 }], 5, { top: true }), PART.chest, ZONE.shirt);
  add('pelvis', loft([{ y: 0.84, rx: 0.13, rz: 0.085 }, { y: 1.04, rx: 0.17, rz: 0.10 }], 6, { bottom: true }), PART.pelvis, ZONE.pants);
  for (const s of [-1, 1] as const) {
    add('arm' + s, loft([{ y: 1.40, rx: 0.06, cx: s * SX }, { y: 1.09, rx: 0.048, cx: s * SX }], 4), s < 0 ? PART.upperL : PART.upperR, ZONE.arm);
    add('fore' + s, loft([{ y: 1.10, rx: 0.046, cx: s * SX }, { y: 0.74, rx: 0.038, cx: s * SX }], 4), s < 0 ? PART.foreL : PART.foreR, ZONE.fore);
    add('leg' + s, loft([{ y: 0.925, rx: 0.09, cx: s * HX }, { y: 0.09, rx: 0.045, cx: s * HX }], 4, { top: true }), s < 0 ? PART.thighL : PART.thighR, ZONE.leg);
    add('shoe' + s, box(0.09, 0.075, 0.27, { t: [s * HX, 0.038, 0.06] }), s < 0 ? PART.footL : PART.footR, ZONE.shoe);
  }
  add('hairCap', loft([{ y: 1.70, rx: 0.135, rz: 0.14, cz: -0.004 }, { y: 1.79, rx: 0.06, rz: 0.07, cz: -0.010 }], 5, { top: true }), PART.head, ZONE.hair, 'hairCap');
  add('hairLong', box(0.24, 0.32, 0.07, { t: [0, 1.50, -0.11] }), PART.head, ZONE.hair, 'hairLong', 1);
  add('hairTail', box(0.06, 0.28, 0.06, { t: [0, 1.52, -0.19] }), PART.head, ZONE.hair, 'hairTail', 1);
  add('hairMullet', box(0.2, 0.2, 0.06, { t: [0, 1.56, -0.11] }), PART.head, ZONE.hair, 'hairMullet', 1);
  add('hairBun', ellipsoid(0.055, 0.05, 0.055, 4, 2, [0, 1.80, -0.085]), PART.head, ZONE.hair, 'hairBun');
  add('hairFin', box(0.04, 0.12, 0.26, { t: [0, 1.80, 0.0] }), PART.head, ZONE.hair, 'hairFin');
  add('hairBob', box(0.29, 0.22, 0.24, { t: [0, 1.58, -0.03] }), PART.head, ZONE.hair, 'hairBob', 1);
  add('hairCurls', ellipsoid(0.185, 0.14, 0.18, 6, 2, [0, 1.80, -0.03]), PART.head, ZONE.hair, 'hairCurls');
  // hats: one crown, one peaked brim and one wide brim serve every hat of the near figure ('hatCrown', 'hatBrim', 'wideBrim' are set by
  // resolveLook when a person wears any of them): at this distance nobody tells a beanie from a hard hat by its shape
  add('hatCrown', loft([{ y: 1.685, rx: 0.15, rz: 0.15 }, { y: 1.78, rx: 0.10, rz: 0.10 }], 5, { top: true }), PART.head, ZONE.hat, 'hatCrown');
  add('hatBrim', box(0.18, 0.02, 0.15, { t: [0, 1.71, 0.19] }), PART.head, ZONE.hat, 'hatBrim');
  add('foilCone', xform(bare(new THREE.ConeGeometry(0.15, 0.36, 4)), { t: [0, 1.93, 0] }), PART.head, ZONE.metal, 'foilCone');
  add('wideBrim', loft([{ y: 1.70, rx: 0.32, rz: 0.30 }, { y: 1.715, rx: 0.15, rz: 0.15 }], 6), PART.head, ZONE.hat, 'wideBrim');
  // clothes over the body: two rings, five sides
  const jf = (bot: number, w = 1): Ring[] => [{ y: bot, rx: 0.22 * w, rz: 0.155 * w }, { y: 1.40, rx: 0.17 * w, rz: 0.11 * w }];
  add('jacket', loft(jf(0.84), 5), PART.chest, ZONE.outer, 'jacket');
  add('jacketShort', loft(jf(0.94), 5), PART.chest, ZONE.outer, 'jacketShort');
  add('vestOver', loft(jf(0.96, 1.06), 5), PART.chest, ZONE.outer, 'vestOver');
  add('hivisVest', loft(jf(0.98, 1.06), 5), PART.chest, ZONE.hivis, 'hivisVest');
  add('coat', loft([{ y: 0.62, rx: 0.27, rz: 0.19 }, { y: 1.40, rx: 0.17, rz: 0.11 }], 5), PART.chest, ZONE.outer, 'coat', 2);
  add('robe', loft([{ y: 0.22, rx: 0.32, rz: 0.27 }, { y: 1.02, rx: 0.17, rz: 0.11 }], 5), PART.pelvis, ZONE.shirt, 'robe', 2);
  add('skirtLong', loft([{ y: 0.40, rx: 0.29, rz: 0.25 }, { y: 1.04, rx: 0.168, rz: 0.11 }], 5), PART.pelvis, ZONE.shirt, 'dress');
  add('hoodShirt', box(0.24, 0.16, 0.10, { t: [0, 1.42, -0.09] }), PART.chest, ZONE.shirt, 'hoodShirt');
  add('hoodOuter', box(0.24, 0.16, 0.10, { t: [0, 1.42, -0.09] }), PART.chest, ZONE.outer, 'hoodOuter');
  add('backpack', box(0.30, 0.38, 0.15, { t: [0, 1.20, -0.185] }), PART.chest, ZONE.bag, 'backpack');
  add('bigpackA', box(0.34, 0.56, 0.22, { t: [0, 1.20, -0.21] }), PART.chest, ZONE.bag, 'bigpack');
  add('deliveryBag', box(0.46, 0.44, 0.36, { t: [0, 1.20, -0.29] }), PART.chest, ZONE.bag, 'delivery');
  add('chairBag', cylinder(0.055, 0.055, 0.95, 4, { t: [0, 1.15, -0.13], r: [0, 0, 0.55] }), PART.chest, ZONE.bag, 'chairbag');
  add('signPole', box(0.03, 0.86, 0.03, { t: [HAND.x, HAND.y - 0.40, 0.0] }), PART.foreR, ZONE.wood, propFeature('sign'));
  add('signBoard', box(0.56, 0.38, 0.03, { t: [HAND.x, HAND.y - 0.82, 0.0] }), PART.foreR, ZONE.card, propFeature('sign'));
  add('drum', cylinder(0.17, 0.17, 0.32, 5, { t: [0, 1.0, 0.3], r: [Math.PI / 2, 0, 0] }), PART.pelvis, ZONE.prop, propFeature('drum'));
  add('crate', box(0.34, 0.36, 0.34, { t: [0, 0.18, 0.02] }), PART.root, ZONE.wood, 201);
  return P;
}

/** One merged geometry (indexed, position/normal/aTag). */
export function mergePieces(pieces: Piece[]): THREE.BufferGeometry {
  const g = mergeGeometries(pieces.map((p) => p.geometry), false);
  if (!g) throw new Error('Could not merge the citizen pieces');
  g.computeBoundingSphere();
  return g;
}
