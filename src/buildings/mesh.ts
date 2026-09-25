// MeshBuilder: emits non-indexed triangles with position/normal/uv/color, mapping
// atlas tiles onto faces. Repeating tiles are clipped cell-by-cell against the
// tile grid (no GL_REPEAT inside an atlas), optionally snapped so a whole number
// of window bays / floors fits each face.
import * as THREE from 'three';
import { T, Tile } from '../art';

export type RGB = readonly [number, number, number];
export type V3 = [number, number, number];

export interface Mat {
  t: Tile;
  tw: number; // meters per tile repeat along the face (<= 0: stretch over the face)
  th: number; // meters per tile repeat up the face
  c: RGB; // linear vertex tint
  bays?: number; // snap width to whole bays (tile holds this many)
  floors?: number; // snap height to whole floors
  ph?: number; // phase shift in bays (varies lit-window patterns)
  ao?: boolean; // ground-contact darkening on walls (default true)
  flipU?: boolean;
  flipV?: boolean;
}

const _c = new THREE.Color();
/** sRGB hex -> linear RGB tuple for vertex colors. */
export function rgb(hex: number): RGB {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}
export const WHITE: RGB = [1, 1, 1];

export function mulRGB(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function M(tile: string, tw: number, th: number, c: RGB | number = WHITE, o: Partial<Mat> = {}): Mat {
  return { t: T(tile), tw, th, c: typeof c === 'number' ? rgb(c) : c, ...o };
}

/** Stretch a whole tile over a face (signs, decals). */
export function S(tile: string, c: RGB | number = WHITE, o: Partial<Mat> = {}): Mat {
  return M(tile, 0, 0, c, { ao: false, ...o });
}

export interface BoxSpec {
  side?: Mat;
  f?: Mat | null; // +Z (street side)
  b?: Mat | null; // -Z
  r?: Mat | null; // +X
  l?: Mat | null; // -X
  top?: Mat | null;
  bottom?: Mat | null;
}

type P2 = { s: number; t: number };

function clipAxis(poly: P2[], axis: 's' | 't', v: number, keepGreater: boolean): P2[] {
  const out: P2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ain = keepGreater ? a[axis] >= v : a[axis] <= v;
    const bin = keepGreater ? b[axis] >= v : b[axis] <= v;
    if (ain) out.push(a);
    if (ain !== bin) {
      const k = (v - a[axis]) / (b[axis] - a[axis]);
      out.push({ s: a.s + (b.s - a.s) * k, t: a.t + (b.t - a.t) * k });
    }
  }
  return out;
}

export class MB {
  private P: number[] = [];
  private N: number[] = [];
  private UV: number[] = [];
  private C: number[] = [];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private stack: THREE.Matrix4[] = [];
  private ident = true;
  private tmp = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  groundY = 0;
  aoH = 2.6;
  aoK = 0.32;

  // ---------------------------------------------------------------- transforms
  push() {
    this.stack.push(this.m.clone());
    return this;
  }
  pop() {
    this.m.copy(this.stack.pop()!);
    this.sync();
    return this;
  }
  private sync() {
    this.ident = this.m.equals(IDENT);
    this.nm.getNormalMatrix(this.m);
  }
  translate(x: number, y: number, z: number) {
    this.m.multiply(M4.makeTranslation(x, y, z));
    this.sync();
    return this;
  }
  rotY(a: number) {
    this.m.multiply(M4.makeRotationY(a));
    this.sync();
    return this;
  }
  rotX(a: number) {
    this.m.multiply(M4.makeRotationX(a));
    this.sync();
    return this;
  }
  rotZ(a: number) {
    this.m.multiply(M4.makeRotationZ(a));
    this.sync();
    return this;
  }
  scale(x: number, y = x, z = x) {
    this.m.multiply(M4.makeScale(x, y, z));
    this.sync();
    return this;
  }

  get tris() {
    return this.P.length / 9;
  }

  /** True when no transform is active (local == lot space). */
  get identity() {
    return this.ident;
  }

  /** A local point in lot space (applies the current transform). */
  world(x: number, y: number, z: number): V3 {
    if (this.ident) return [x, y, z];
    this.tmp.set(x, y, z).applyMatrix4(this.m);
    return [this.tmp.x, this.tmp.y, this.tmp.z];
  }

  // ---------------------------------------------------------------- raw emit
  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: RGB, ao: boolean) {
    let wy = y;
    if (this.ident) {
      this.P.push(x, y, z);
      this.N.push(nx, ny, nz);
    } else {
      this.tmp.set(x, y, z).applyMatrix4(this.m);
      this.P.push(this.tmp.x, this.tmp.y, this.tmp.z);
      wy = this.tmp.y;
      this.tmpN.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
      this.N.push(this.tmpN.x, this.tmpN.y, this.tmpN.z);
    }
    this.UV.push(u, v);
    let k = 1;
    if (ao) {
      const h = (wy - this.groundY) / this.aoH;
      if (h < 1) k = 1 - this.aoK * (1 - Math.max(0, h)) * (1 - Math.max(0, h));
    }
    this.C.push(c[0] * k, c[1] * k, c[2] * k);
  }

  /** Emit a triangle with explicit per-vertex data. */
  triRaw(p: V3[], n: V3[], uv: [number, number][], c: RGB, ao = false) {
    for (let i = 0; i < 3; i++) this.vert(p[i][0], p[i][1], p[i][2], n[i][0], n[i][1], n[i][2], uv[i][0], uv[i][1], c, ao);
  }

  // ---------------------------------------------------------------- planar polygons
  /**
   * Convex planar polygon, counter-clockwise seen from the front. The tile is
   * repeated in face space (u along the face horizontally, v up the face).
   */
  poly(pts: V3[], mat: Mat, frame?: { u: V3; v: V3 }) {
    const [a, b, c] = pts;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) return;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    let U: V3, V: V3;
    if (frame) {
      U = frame.u;
      V = frame.v;
    } else if (Math.abs(ny) > 0.985) {
      U = [1, 0, 0];
      V = [0, nz, -ny]; // N x U: texture "up" points away from the street on the ground
    } else {
      // U = normalize(Y x N), V = N x U
      const ux = nz, uz = -nx;
      const ul = Math.hypot(ux, uz);
      U = [ux / ul, 0, uz / ul];
      V = [ny * U[2] - nz * U[1], nz * U[0] - nx * U[2], nx * U[1] - ny * U[0]];
    }
    const d = nx * a[0] + ny * a[1] + nz * a[2];
    const poly2: P2[] = pts.map((p) => ({ s: p[0] * U[0] + p[1] * U[1] + p[2] * U[2], t: p[0] * V[0] + p[1] * V[1] + p[2] * V[2] }));
    let smin = Infinity, smax = -Infinity, tmin = Infinity, tmax = -Infinity;
    for (const q of poly2) {
      smin = Math.min(smin, q.s);
      smax = Math.max(smax, q.s);
      tmin = Math.min(tmin, q.t);
      tmax = Math.max(tmax, q.t);
    }
    const vertical = Math.abs(ny) < 0.5;
    const ao = (mat.ao ?? true) && vertical;
    const t0 = mat.t;
    const du = t0.u1 - t0.u0, dv = t0.v1 - t0.v0;
    const emit = (q: P2[], s0: number, tt0: number, tw: number, th: number, ci: number, cj: number) => {
      // fan-triangulate the clipped cell polygon
      const P3 = q.map((p) => [U[0] * p.s + V[0] * p.t + nx * d, U[1] * p.s + V[1] * p.t + ny * d, U[2] * p.s + V[2] * p.t + nz * d] as V3);
      const UVs = q.map((p) => {
        let fu = (p.s - s0) / tw - ci;
        let fv = (p.t - tt0) / th - cj;
        fu = Math.min(1, Math.max(0, fu));
        fv = Math.min(1, Math.max(0, fv));
        if (mat.flipU) fu = 1 - fu;
        if (mat.flipV) fv = 1 - fv;
        return [t0.u0 + fu * du, t0.v0 + fv * dv] as [number, number];
      });
      for (let i = 1; i < q.length - 1; i++) {
        this.vert(P3[0][0], P3[0][1], P3[0][2], nx, ny, nz, UVs[0][0], UVs[0][1], mat.c, ao);
        this.vert(P3[i][0], P3[i][1], P3[i][2], nx, ny, nz, UVs[i][0], UVs[i][1], mat.c, ao);
        this.vert(P3[i + 1][0], P3[i + 1][1], P3[i + 1][2], nx, ny, nz, UVs[i + 1][0], UVs[i + 1][1], mat.c, ao);
      }
    };
    if (mat.tw <= 0 || mat.th <= 0) {
      emit(poly2, smin, tmin, Math.max(1e-6, smax - smin), Math.max(1e-6, tmax - tmin), 0, 0);
      return;
    }
    let tw = mat.tw, th = mat.th;
    const fw = smax - smin, fh = tmax - tmin;
    if (mat.bays) {
      const bw = tw / mat.bays;
      const nb = Math.max(1, Math.round(fw / bw));
      tw = (fw / nb) * mat.bays;
    }
    if (mat.floors) {
      const fl = th / mat.floors;
      const nf = Math.max(1, Math.round(fh / fl));
      th = (fh / nf) * mat.floors;
    }
    let s0 = smin, tt0 = tmin;
    if (mat.ph) s0 -= mat.ph * (tw / (mat.bays ?? 1));
    const i0 = Math.floor((smin - s0) / tw + 1e-6), i1 = Math.ceil((smax - s0) / tw - 1e-6);
    const j0 = Math.floor((tmin - tt0) / th + 1e-6), j1 = Math.ceil((tmax - tt0) / th - 1e-6);
    if ((i1 - i0) * (j1 - j0) > 4000) {
      emit(poly2, smin, tmin, fw, fh, 0, 0);
      return;
    }
    for (let j = j0; j < j1; j++) {
      const ta = tt0 + j * th, tb = ta + th;
      let row = clipAxis(poly2, 't', ta, true);
      row = clipAxis(row, 't', tb, false);
      if (row.length < 3) continue;
      for (let i = i0; i < i1; i++) {
        const sa = s0 + i * tw, sb = sa + tw;
        let cell = clipAxis(row, 's', sa, true);
        cell = clipAxis(cell, 's', sb, false);
        if (cell.length < 3) continue;
        emit(cell, s0, tt0, tw, th, i, j);
      }
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, mat: Mat) {
    this.poly([a, b, c, d], mat);
  }

  // ---------------------------------------------------------------- boxes
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, spec: BoxSpec | Mat) {
    const s: BoxSpec = 't' in spec ? { side: spec as Mat, top: spec as Mat } : (spec as BoxSpec);
    const side = s.side;
    const f = s.f === undefined ? side : s.f;
    const b = s.b === undefined ? side : s.b;
    const r = s.r === undefined ? side : s.r;
    const l = s.l === undefined ? side : s.l;
    const top = s.top === undefined ? side : s.top;
    if (f) this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], f);
    if (b) this.poly([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], b);
    if (r) this.poly([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], r);
    if (l) this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], l);
    if (top) this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], top);
    if (s.bottom) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], s.bottom);
  }

  /** Box by center (x, z), size (w, d), base y and height h. */
  boxC(x: number, z: number, w: number, d: number, y: number, h: number, spec: BoxSpec | Mat) {
    this.box(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, spec);
  }

  /** Vertical rectangle facing +Z (or -Z if back) centered at x, spanning y0..y1 at depth z. */
  panelZ(x: number, z: number, w: number, y0: number, y1: number, mat: Mat, back = false) {
    const a = x - w / 2, b = x + w / 2;
    if (!back) this.poly([[a, y0, z], [b, y0, z], [b, y1, z], [a, y1, z]], mat);
    else this.poly([[b, y0, z], [a, y0, z], [a, y1, z], [b, y1, z]], mat);
  }

  /** Vertical rectangle facing +X (or -X) centered at z. */
  panelX(x: number, z: number, w: number, y0: number, y1: number, mat: Mat, neg = false) {
    const a = z + w / 2, b = z - w / 2;
    if (!neg) this.poly([[x, y0, a], [x, y0, b], [x, y1, b], [x, y1, a]], mat);
    else this.poly([[x, y0, b], [x, y0, a], [x, y1, a], [x, y1, b]], mat);
  }

  /** Flat horizontal rectangle (ground decals, pads) at height y. */
  flat(x0: number, x1: number, z0: number, z1: number, y: number, mat: Mat) {
    this.poly([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], mat);
  }

  /** A decal on a wall: n = outward normal ('+z' | '-z' | '+x' | '-x'). */
  decal(side: '+z' | '-z' | '+x' | '-x', along: number, y: number, wallPos: number, w: number, h: number, mat: Mat, off = 0.06) {
    const y0 = y, y1 = y + h;
    switch (side) {
      case '+z':
        this.panelZ(along, wallPos + off, w, y0, y1, mat);
        break;
      case '-z':
        this.panelZ(along, wallPos - off, w, y0, y1, mat, true);
        break;
      case '+x':
        this.panelX(wallPos + off, along, w, y0, y1, mat);
        break;
      case '-x':
        this.panelX(wallPos - off, along, w, y0, y1, mat, true);
        break;
    }
  }

  // ---------------------------------------------------------------- roofs
  /**
   * Gable roof over [x0,x1]x[z0,z1] from eave height y to ridge y+rise.
   * axis 'x': ridge runs along X (slopes face +/-Z). Gable ends use `end`.
   */
  gable(x0: number, x1: number, z0: number, z1: number, y: number, rise: number, axis: 'x' | 'z', roof: Mat, end: Mat | null, o = 0.35, th = 0.18) {
    if (axis === 'z') {
      this.push();
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      this.translate(cx, 0, cz).rotY(Math.PI / 2);
      const hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
      this.gable(-hd, hd, -hw, hw, y, rise, 'x', roof, end, o, th);
      this.pop();
      return;
    }
    const zc = (z0 + z1) / 2, half = (z1 - z0) / 2;
    const slope = rise / half;
    const ye = y - o * slope;
    const xa = x0 - o, xb = x1 + o, za = z0 - o, zb = z1 + o;
    const yr = y + rise;
    // slopes
    this.poly([[xa, ye, zb], [xb, ye, zb], [xb, yr, zc], [xa, yr, zc]], roof);
    this.poly([[xb, ye, za], [xa, ye, za], [xa, yr, zc], [xb, yr, zc]], roof);
    // fascia / thickness strips
    const fas = { ...roof, tw: 0, th: 0 };
    this.poly([[xa, ye - th, zb], [xb, ye - th, zb], [xb, ye, zb], [xa, ye, zb]], fas);
    this.poly([[xb, ye - th, za], [xa, ye - th, za], [xa, ye, za], [xb, ye, za]], fas);
    // gable ends
    if (end) {
      this.poly([[x0, y, z0], [x0, y, z1], [x0, yr, zc]], end);
      this.poly([[x1, y, z1], [x1, y, z0], [x1, yr, zc]], end);
    }
    // soffit under the overhang (faces down)
    const sof = { ...fas, c: mulRGB(roof.c, 0.6) };
    this.poly([[xa, ye, zb], [xa, ye, z1], [xb, ye, z1], [xb, ye, zb]], sof);
    this.poly([[xa, ye, za], [xb, ye, za], [xb, ye, z0], [xa, ye, z0]], sof);
  }

  /** Hip roof; the ridge runs along the longer axis. */
  hip(x0: number, x1: number, z0: number, z1: number, y: number, rise: number, roof: Mat, o = 0.35) {
    const w = x1 - x0, d = z1 - z0;
    if (d > w) {
      this.push();
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      this.translate(cx, 0, cz).rotY(Math.PI / 2);
      this.hip(-d / 2, d / 2, -w / 2, w / 2, y, rise, roof, o);
      this.pop();
      return;
    }
    const half = d / 2;
    const slope = rise / half;
    const ye = y - o * slope;
    const xa = x0 - o, xb = x1 + o, za = z0 - o, zb = z1 + o;
    const zc = (z0 + z1) / 2, yr = y + rise;
    const inset = half + o;
    const ra = Math.min(xa + inset, (xa + xb) / 2), rb = Math.max(xb - inset, (xa + xb) / 2);
    this.poly([[xa, ye, zb], [xb, ye, zb], [rb, yr, zc], [ra, yr, zc]], roof);
    this.poly([[xb, ye, za], [xa, ye, za], [ra, yr, zc], [rb, yr, zc]], roof);
    this.poly([[xa, ye, za], [xa, ye, zb], [ra, yr, zc]], roof);
    this.poly([[xb, ye, zb], [xb, ye, za], [rb, yr, zc]], roof);
    const sof = { ...roof, tw: 0, th: 0, c: mulRGB(roof.c, 0.6) };
    this.poly([[xa, ye, za], [xb, ye, za], [xb, ye, zb], [xa, ye, zb]], sof);
  }

  /** Mono-pitch roof rising toward -Z. */
  shed(x0: number, x1: number, z0: number, z1: number, y: number, rise: number, roof: Mat, side: Mat | null, o = 0.3) {
    const yl = y, yh = y + rise;
    this.poly([[x0 - o, yl, z1 + o], [x1 + o, yl, z1 + o], [x1 + o, yh, z0 - o], [x0 - o, yh, z0 - o]], roof);
    this.poly([[x1 + o, yh, z0 - o], [x0 - o, yh, z0 - o], [x0 - o, yh - 0.2, z0 - o], [x1 + o, yh - 0.2, z0 - o]].reverse() as V3[], { ...roof, tw: 0, th: 0 });
    if (side) {
      this.poly([[x0, y, z0], [x0, y, z1], [x0, yh, z0]], side);
      this.poly([[x1, y, z1], [x1, y, z0], [x1, yh, z0]], side);
      this.poly([[x1, y, z0], [x0, y, z0], [x0, yh, z0], [x1, yh, z0]], side);
    }
  }

  /** Flat roof with parapet walls around [x0,x1]x[z0,z1] at height y. */
  parapet(x0: number, x1: number, z0: number, z1: number, y: number, h: number, wall: Mat, roof: Mat, t = 0.3) {
    this.flat(x0, x1, z0, z1, y + 0.02, roof);
    const cap = { ...wall, tw: 0, th: 0, ao: false };
    const inner = { ...wall, c: mulRGB(wall.c, 0.8), ao: false };
    // outer faces continue the wall; inner faces + cap
    this.box(x0, x1, y, y + h, z1 - t, z1, { f: wall, b: inner, l: cap, r: cap, top: cap });
    this.box(x0, x1, y, y + h, z0, z0 + t, { f: inner, b: wall, l: cap, r: cap, top: cap });
    this.box(x0, x0 + t, y, y + h, z0 + t, z1 - t, { l: wall, r: inner, f: null, b: null, top: cap });
    this.box(x1 - t, x1, y, y + h, z0 + t, z1 - t, { r: wall, l: inner, f: null, b: null, top: cap });
  }

  // ---------------------------------------------------------------- surfaces of revolution
  /**
   * Lathe around the local Y axis at (cx, cz). profile: [radius, y] bottom to
   * top. The tile repeats `reps` times around (auto from tw) and every th
   * meters along the profile. Smooth normals.
   */
  lathe(cx: number, cz: number, profile: [number, number][], seg: number, mat: Mat, o: { capTop?: Mat | null; capBottom?: Mat | null; a0?: number; a1?: number } = {}) {
    const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2;
    const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
    // cumulative profile length
    const L = [0];
    for (let i = 1; i < profile.length; i++) L.push(L[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
    const rMax = Math.max(...profile.map((p) => p[0]));
    const circ = rMax * Math.abs(a1 - a0);
    const stretch = mat.tw <= 0;
    const reps = stretch ? 1 : Math.min(seg, Math.max(1, Math.round(circ / mat.tw)));
    const segPer = Math.max(1, Math.ceil(seg / reps));
    const nSeg = segPer * reps;
    // long tanks/stacks: cap vertical repeats so tile cuts don't explode the triangle count
    const total = Math.max(1e-6, L[L.length - 1]);
    const th = stretch ? total : Math.max(mat.th, total / 6);
    const t0 = mat.t;
    const du = t0.u1 - t0.u0, dv = t0.v1 - t0.v0;
    // profile normals (2D, per vertex)
    const pn: [number, number][] = profile.map((_, i) => {
      const p0 = profile[Math.max(0, i - 1)], p1 = profile[Math.min(profile.length - 1, i + 1)];
      const dr = p1[0] - p0[0], dy = p1[1] - p0[1];
      const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    for (let k = 0; k < nSeg; k++) {
      const ta = a0 + ((a1 - a0) * k) / nSeg, tb = a0 + ((a1 - a0) * (k + 1)) / nSeg;
      // stretch: one tile across the whole sweep; tiled: one tile per rep
      const ua = stretch ? k / nSeg : (k % segPer) / segPer;
      const ub = stretch ? (k + 1) / nSeg : ua + 1 / segPer;
      const ca = Math.cos(ta), sa = Math.sin(ta), cb = Math.cos(tb), sb = Math.sin(tb);
      for (let i = 0; i < profile.length - 1; i++) {
        const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
        const v0 = L[i] / th, v1 = L[i + 1] / th;
        // split along v at tile boundaries
        const cuts = [v0];
        if (!stretch) for (let q = Math.floor(v0) + 1; q < v1 - 1e-6; q++) cuts.push(q);
        cuts.push(v1);
        for (let q = 0; q < cuts.length - 1; q++) {
          const fa = (cuts[q] - v0) / (v1 - v0 || 1), fb = (cuts[q + 1] - v0) / (v1 - v0 || 1);
          const ra = r0 + (r1 - r0) * fa, ya = y0 + (y1 - y0) * fa;
          const rb = r0 + (r1 - r0) * fb, yb = y0 + (y1 - y0) * fb;
          const base = Math.floor(cuts[q] + 1e-6);
          const va = Math.min(1, cuts[q] - base), vb = Math.min(1, cuts[q + 1] - base);
          const n0 = pn[i], n1 = pn[i + 1];
          const nA: [number, number] = [n0[0] + (n1[0] - n0[0]) * fa, n0[1] + (n1[1] - n0[1]) * fa];
          const nB: [number, number] = [n0[0] + (n1[0] - n0[0]) * fb, n0[1] + (n1[1] - n0[1]) * fb];
          const P00: V3 = [cx + ra * sa, ya, cz + ra * ca];
          const P10: V3 = [cx + ra * sb, ya, cz + ra * cb];
          const P11: V3 = [cx + rb * sb, yb, cz + rb * cb];
          const P01: V3 = [cx + rb * sa, yb, cz + rb * ca];
          const N00: V3 = [nA[0] * sa, nA[1], nA[0] * ca];
          const N10: V3 = [nA[0] * sb, nA[1], nA[0] * cb];
          const N11: V3 = [nB[0] * sb, nB[1], nB[0] * cb];
          const N01: V3 = [nB[0] * sa, nB[1], nB[0] * ca];
          const U = (u: number, v: number): [number, number] => {
            let fu = u;
            let fv = v;
            if (mat.flipU) fu = 1 - fu;
            if (mat.flipV) fv = 1 - fv;
            return [t0.u0 + fu * du, t0.v0 + fv * dv];
          };
          const uv00 = U(ua, va), uv10 = U(ub, va), uv11 = U(ub, vb), uv01 = U(ua, vb);
          const ao = mat.ao ?? true;
          if (ra > 1e-6) this.triRaw([P00, P10, P11], [N00, N10, N11], [uv00, uv10, uv11], mat.c, ao);
          if (rb > 1e-6) this.triRaw([P00, P11, P01], [N00, N11, N01], [uv00, uv11, uv01], mat.c, ao);
        }
      }
    }
    const cap = (y: number, r: number, m: Mat, up: boolean) => {
      const pts: V3[] = [];
      const n = Math.max(6, Math.min(nSeg, 24));
      for (let k = 0; k < n; k++) {
        const a = a0 + ((a1 - a0) * k) / n;
        pts.push([cx + r * Math.sin(a), y, cz + r * Math.cos(a)]);
      }
      if (!full) pts.push([cx + r * Math.sin(a1), y, cz + r * Math.cos(a1)], [cx, y, cz]);
      // increasing angle winds counter-clockwise seen from above
      this.poly(up ? pts : pts.reverse(), m);
    };
    if (o.capTop) cap(profile[profile.length - 1][1], profile[profile.length - 1][0], o.capTop, true);
    if (o.capBottom) cap(profile[0][1], profile[0][0], o.capBottom, false);
  }

  cyl(cx: number, cz: number, r: number, y0: number, y1: number, seg: number, mat: Mat, cap: Mat | null = mat) {
    this.lathe(cx, cz, [[r, y0], [r, y1]], seg, mat, { capTop: cap });
  }

  cone(cx: number, cz: number, r: number, y0: number, h: number, seg: number, mat: Mat) {
    this.lathe(cx, cz, [[r, y0], [0.0001, y0 + h]], seg, mat);
  }

  /** Low-poly blob (icosahedron) for foliage, bushes, puffs. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, mat: Mat, detail = 0, jitter = 0.15, seed = 1) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const t0 = mat.t;
    let h = seed * 9301 + 49297;
    const jit = new Map<string, number>();
    const P: V3[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let j = jit.get(key);
      if (j === undefined) {
        h = (h * 9301 + 49297) % 233280;
        j = 1 + (h / 233280 - 0.5) * 2 * jitter;
        jit.set(key, j);
      }
      P.push([cx + x * rx * j, cy + y * ry * j, cz + z * rz * j]);
    }
    for (let i = 0; i < P.length; i += 3) {
      const [a, b, c] = [P[i], P[i + 1], P[i + 2]];
      const n = faceNormal(a, b, c);
      const cl = (x: number) => Math.min(0.98, Math.max(0.02, x * 0.5 + 0.5));
      const uv = [a, b, c].map((p) => [t0.u0 + cl((p[0] - cx) / rx) * (t0.u1 - t0.u0), t0.v0 + cl((p[1] - cy) / ry) * (t0.v1 - t0.v0)] as [number, number]);
      this.triRaw([a, b, c], [n, n, n], uv, mat.c, false);
    }
    g.dispose();
  }

  // ---------------------------------------------------------------- output
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.N), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.UV), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.C), 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  maxY() {
    let m = 0;
    for (let i = 1; i < this.P.length; i += 3) if (this.P[i] > m) m = this.P[i];
    return m;
  }
}

const IDENT = new THREE.Matrix4();
const M4 = new THREE.Matrix4();

export function faceNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
