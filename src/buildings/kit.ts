// Low-level geometry kit for procedural buildings. Emits NON-INDEXED triangles
// with position / normal / uv / color / tile, where uv is in "tile repeats"
// (the shader wraps it inside the facade texture array layer `tile`).
import * as THREE from 'three';
import type { Emitter } from '../contracts';
import { signSlot, T, TILE_M } from './atlas';

type V3 = [number, number, number];
export type Col = THREE.Color;

const tmp = new THREE.Color();
export const col = (hex: number | string) => new THREE.Color(hex as THREE.ColorRepresentation);

export class Kit {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private tile: number[] = [];
  readonly emitters: Emitter[] = [];
  /** Local transform applied to everything added (for rotated sub-parts). */
  private ox = 0;
  private oz = 0;
  private cy = 1;
  private sy = 0;

  /** Temporarily place/rotate sub-parts: fn runs with the frame applied. */
  at(x: number, z: number, yaw: number, fn: () => void) {
    const saved = [this.ox, this.oz, this.cy, this.sy];
    // compose: new = saved ∘ (translate x,z then rotate yaw)
    const [px, pz] = this.xf(x, z);
    const a = Math.atan2(this.sy, this.cy) + yaw;
    this.ox = px;
    this.oz = pz;
    this.cy = Math.cos(a);
    this.sy = Math.sin(a);
    fn();
    [this.ox, this.oz, this.cy, this.sy] = saved;
  }

  private xf(x: number, z: number): [number, number] {
    return [this.ox + x * this.cy + z * this.sy, this.oz - x * this.sy + z * this.cy];
  }
  private xn(nx: number, nz: number): [number, number] {
    return [nx * this.cy + nz * this.sy, -nx * this.sy + nz * this.cy];
  }

  private vert(p: V3, n: V3, u: number, v: number, c: Col, tile: number, shade = 1) {
    const [x, z] = this.xf(p[0], p[2]);
    const [nx, nz] = this.xn(n[0], n[2]);
    this.pos.push(x, p[1], z);
    this.nor.push(nx, n[1], nz);
    this.uv.push(u, v);
    this.col.push(c.r * shade, c.g * shade, c.b * shade);
    this.tile.push(tile);
  }

  /** Quad a-b-c-d counter-clockwise seen from the front (normal side). */
  quad(a: V3, b: V3, c: V3, d: V3, uvs: [number, number][], color: Col, tile: number, shades: number[] = [1, 1, 1, 1]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const P = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) this.vert(P[i], n, uvs[i][0], uvs[i][1], color, tile, shades[i]);
  }

  tri(a: V3, b: V3, c: V3, uvs: [number, number][], color: Col, tile: number) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const P = [a, b, c];
    for (let i = 0; i < 3; i++) this.vert(P[i], n, uvs[i][0], uvs[i][1], color, tile);
  }

  /**
   * Vertical wall from (x0,z0) to (x1,z1), facing right of the direction of
   * travel (so walk a footprint counter-clockwise seen from above... i.e. with
   * +Z toward the viewer, go left-to-right along the front).
   * fit: stretch tiles so windows land whole on the wall; floors: v repeats.
   */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile: number, color: Col, opts: { fit?: boolean; floors?: number; vFrom?: number; ao?: boolean } = {}) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.01 || y1 - y0 < 0.01) return;
    const [tu, tv] = TILE_M[tile] ?? [3, 3];
    let u1 = L / tu;
    if (opts.fit) u1 = Math.max(1, Math.round(L / tu));
    const vb = opts.vFrom ?? 0;
    let v0 = (y0 - vb) / tv, v1 = (y1 - vb) / tv;
    if (opts.floors) {
      v0 = 0;
      v1 = opts.floors;
    }
    const s0 = opts.ao === false ? 1 : 0.78;
    this.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [[0, v0], [u1, v0], [u1, v1], [0, v1]], color, tile, [s0, s0, 1, 1]);
  }

  /** Horizontal rectangle (top-facing unless down). uv from world meters. */
  slab(x0: number, z0: number, x1: number, z1: number, y: number, tile: number, color: Col, down = false) {
    const [tu, tv] = TILE_M[tile] ?? [4, 4];
    const uv = (x: number, z: number): [number, number] => [x / tu, -z / tv];
    if (!down) this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [uv(x0, z1), uv(x1, z1), uv(x1, z0), uv(x0, z0)], color, tile);
    else this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [uv(x0, z0), uv(x1, z0), uv(x1, z1), uv(x0, z1)], color, tile);
  }

  /** Axis-aligned box. walls: tile for all sides or [front(+Z), right(+X), back, left]. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, walls: number | number[], wallColor: Col, top: number | null = T.ROOF_FLAT, topColor?: Col, opts: { fit?: boolean; floors?: number; bottom?: boolean; ao?: boolean } = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const ws = Array.isArray(walls) ? walls : [walls, walls, walls, walls];
    const o = { fit: opts.fit, floors: opts.floors, ao: opts.ao };
    this.wall(x0, z1, x1, z1, y0, y1, ws[0], wallColor, o); // front
    this.wall(x1, z1, x1, z0, y0, y1, ws[1], wallColor, o); // right
    this.wall(x1, z0, x0, z0, y0, y1, ws[2], wallColor, o); // back
    this.wall(x0, z0, x0, z1, y0, y1, ws[3], wallColor, o); // left
    if (top !== null) this.slab(x0, z0, x1, z1, y1, top, topColor ?? wallColor);
    if (opts.bottom) this.slab(x0, z0, x1, z1, y0, T.SOLID, wallColor, true);
  }

  /** Gable roof. ridgeX: ridge runs along X (gables face ±X). */
  gable(cx: number, cz: number, w: number, d: number, y: number, rise: number, ridgeX: boolean, roof: Col, gableColor: Col, gableTile: number = T.SIDING, over = 0.45) {
    const x0 = cx - w / 2 - over, x1 = cx + w / 2 + over, z0 = cz - d / 2 - over, z1 = cz + d / 2 + over;
    const yt = y + rise;
    const [tu, tv] = TILE_M[T.SHINGLE];
    if (ridgeX) {
      const slope = Math.hypot(d / 2 + over, rise);
      this.quad([x0, y, z1], [x1, y, z1], [x1, yt, cz], [x0, yt, cz], [[0, 0], [(x1 - x0) / tu, 0], [(x1 - x0) / tu, slope / tv], [0, slope / tv]], roof, T.SHINGLE);
      this.quad([x1, y, z0], [x0, y, z0], [x0, yt, cz], [x1, yt, cz], [[0, 0], [(x1 - x0) / tu, 0], [(x1 - x0) / tu, slope / tv], [0, slope / tv]], roof, T.SHINGLE);
      // gable ends (inset to the wall plane)
      const gx0 = cx - w / 2, gx1 = cx + w / 2, gz0 = cz - d / 2, gz1 = cz + d / 2;
      const [gu, gv] = TILE_M[gableTile];
      this.tri([gx1, y, gz1], [gx1, y, gz0], [gx1, yt, cz], [[0, y / gv], [d / gu, y / gv], [d / 2 / gu, yt / gv]], gableColor, gableTile);
      this.tri([gx0, y, gz0], [gx0, y, gz1], [gx0, yt, cz], [[0, y / gv], [d / gu, y / gv], [d / 2 / gu, yt / gv]], gableColor, gableTile);
      // eave undersides
      this.slab(x0, z0, x1, z0 + over, y - 0.01, T.SOLID, gableColor, true);
      this.slab(x0, z1 - over, x1, z1, y - 0.01, T.SOLID, gableColor, true);
    } else {
      const slope = Math.hypot(w / 2 + over, rise);
      this.quad([x1, y, z1], [x1, y, z0], [cx, yt, z0], [cx, yt, z1], [[0, 0], [(z1 - z0) / tu, 0], [(z1 - z0) / tu, slope / tv], [0, slope / tv]], roof, T.SHINGLE);
      this.quad([x0, y, z0], [x0, y, z1], [cx, yt, z1], [cx, yt, z0], [[0, 0], [(z1 - z0) / tu, 0], [(z1 - z0) / tu, slope / tv], [0, slope / tv]], roof, T.SHINGLE);
      const gx0 = cx - w / 2, gx1 = cx + w / 2, gz0 = cz - d / 2, gz1 = cz + d / 2;
      const [gu, gv] = TILE_M[gableTile];
      this.tri([gx0, y, gz1], [gx1, y, gz1], [cx, yt, gz1], [[0, y / gv], [w / gu, y / gv], [w / 2 / gu, yt / gv]], gableColor, gableTile);
      this.tri([gx1, y, gz0], [gx0, y, gz0], [cx, yt, gz0], [[0, y / gv], [w / gu, y / gv], [w / 2 / gu, yt / gv]], gableColor, gableTile);
      this.slab(x0, z0, x0 + over, z1, y - 0.01, T.SOLID, gableColor, true);
      this.slab(x1 - over, z0, x1, z1, y - 0.01, T.SOLID, gableColor, true);
    }
  }

  /** Hip roof (four sloped faces). */
  hip(cx: number, cz: number, w: number, d: number, y: number, rise: number, roof: Col, over = 0.5) {
    const x0 = cx - w / 2 - over, x1 = cx + w / 2 + over, z0 = cz - d / 2 - over, z1 = cz + d / 2 + over;
    const yt = y + rise;
    const inset = Math.min(w, d) / 2 + over;
    const [tu, tv] = TILE_M[T.SHINGLE];
    const rx0 = Math.min(cx, x0 + inset), rx1 = Math.max(cx, x1 - inset), rz0 = Math.min(cz, z0 + inset), rz1 = Math.max(cz, z1 - inset);
    const sl = Math.hypot(inset, rise) / tv;
    if (w >= d) {
      this.quad([x0, y, z1], [x1, y, z1], [rx1, yt, cz], [rx0, yt, cz], [[0, 0], [(x1 - x0) / tu, 0], [(rx1 - x0) / tu, sl], [(rx0 - x0) / tu, sl]], roof, T.SHINGLE);
      this.quad([x1, y, z0], [x0, y, z0], [rx0, yt, cz], [rx1, yt, cz], [[0, 0], [(x1 - x0) / tu, 0], [(x1 - rx0) / tu, sl], [(x1 - rx1) / tu, sl]], roof, T.SHINGLE);
      this.tri([x1, y, z1], [x1, y, z0], [rx1, yt, cz], [[0, 0], [(z1 - z0) / tu, 0], [(z1 - z0) / 2 / tu, sl]], roof, T.SHINGLE);
      this.tri([x0, y, z0], [x0, y, z1], [rx0, yt, cz], [[0, 0], [(z1 - z0) / tu, 0], [(z1 - z0) / 2 / tu, sl]], roof, T.SHINGLE);
    } else {
      this.quad([x1, y, z1], [x1, y, z0], [cx, yt, rz0], [cx, yt, rz1], [[0, 0], [(z1 - z0) / tu, 0], [(z1 - rz0) / tu, sl], [(z1 - rz1) / tu, sl]], roof, T.SHINGLE);
      this.quad([x0, y, z0], [x0, y, z1], [cx, yt, rz1], [cx, yt, rz0], [[0, 0], [(z1 - z0) / tu, 0], [(rz1 - z0) / tu, sl], [(rz0 - z0) / tu, sl]], roof, T.SHINGLE);
      this.tri([x0, y, z1], [x1, y, z1], [cx, yt, rz1], [[0, 0], [(x1 - x0) / tu, 0], [(x1 - x0) / 2 / tu, sl]], roof, T.SHINGLE);
      this.tri([x1, y, z0], [x0, y, z0], [cx, yt, rz0], [[0, 0], [(x1 - x0) / tu, 0], [(x1 - x0) / 2 / tu, sl]], roof, T.SHINGLE);
    }
  }

  /** Vertical cylinder (tanks, silos, stacks, columns). */
  cyl(cx: number, cz: number, r: number, y0: number, y1: number, seg: number, tile: number, color: Col, cap: Col | null = color, r1 = r) {
    const [tu, tv] = TILE_M[tile] ?? [3, 3];
    const circ = 2 * Math.PI * r;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, rr: number, y: number): V3 => [cx + Math.sin(a) * rr, y, cz + Math.cos(a) * rr];
      const u0 = (i / seg) * circ / tu, u1 = ((i + 1) / seg) * circ / tu;
      this.quad(p(a0, r, y0), p(a1, r, y0), p(a1, r1, y1), p(a0, r1, y1), [[u0, y0 / tv], [u1, y0 / tv], [u1, y1 / tv], [u0, y1 / tv]], color, tile, [0.85, 0.85, 1, 1]);
      if (cap && r1 > 0.01) this.tri(p(a0, r1, y1), p(a1, r1, y1), [cx, y1, cz], [[0, 0], [1, 0], [0.5, 0.5]], cap, T.SOLID);
    }
  }

  /** Horizontal cylinder along X (propane tanks, pipes). */
  hcyl(cx: number, cy: number, cz: number, r: number, len: number, seg: number, color: Col) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, x: number): V3 => [x, cy + Math.cos(a) * r, cz + Math.sin(a) * r];
      this.quad(p(a0, cx - len / 2), p(a1, cx - len / 2), p(a1, cx + len / 2), p(a0, cx + len / 2), [[0, 0], [1, 0], [1, 1], [0, 1]], color, T.SOLID);
      // domed-ish ends
      this.tri(p(a0, cx + len / 2), p(a1, cx + len / 2), [cx + len / 2 + r * 0.5, cy, cz], [[0, 0], [1, 0], [0.5, 1]], color, T.SOLID);
      this.tri(p(a1, cx - len / 2), p(a0, cx - len / 2), [cx - len / 2 - r * 0.5, cy, cz], [[0, 0], [1, 0], [0.5, 1]], color, T.SOLID);
    }
  }

  /** Two-sided brand sign (w x h) centered at x,y,z facing +Z rotated by yaw. */
  sign(x: number, y: number, z: number, w: number, h: number, id: string, yaw = 0, twoSided = true, back?: Col, glow = 1) {
    const s = signSlot(id);
    if (!s) return;
    this.at(x, z, yaw, () => {
      // signs ignore vertex color for albedo; its brightness scales the night glow
      const c = col(0xffffff).multiplyScalar(glow);
      this.quad([-w / 2, y - h / 2, 0.06], [w / 2, y - h / 2, 0.06], [w / 2, y + h / 2, 0.06], [-w / 2, y + h / 2, 0.06], [[0, s.v0], [1, s.v0], [1, s.v1], [0, s.v1]], c, s.layer);
      if (twoSided) this.quad([w / 2, y - h / 2, -0.06], [-w / 2, y - h / 2, -0.06], [-w / 2, y + h / 2, -0.06], [w / 2, y + h / 2, -0.06], [[0, s.v0], [1, s.v0], [1, s.v1], [0, s.v1]], c, s.layer);
      else if (back) this.quad([w / 2, y - h / 2, -0.06], [-w / 2, y - h / 2, -0.06], [-w / 2, y + h / 2, -0.06], [w / 2, y + h / 2, -0.06], [[0, 0], [1, 0], [1, 1], [0, 1]], back, T.SOLID);
    });
  }

  /** Cylinder/strut between two arbitrary points (logs, poles, ropes, lattice). */
  tube(a: V3, b: V3, r: number, seg: number, color: Col, tile: number = T.SOLID, r1 = r) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = d.length();
    if (L < 1e-4) return;
    d.normalize();
    const up = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(d, up).normalize();
    const v = new THREE.Vector3().crossVectors(u, d).normalize();
    const [tu, tv] = TILE_M[tile] ?? [1, 1];
    const ring = (p: V3, rr: number, t: number): V3 => {
      const c = Math.cos(t), s = Math.sin(t);
      return [p[0] + (u.x * c + v.x * s) * rr, p[1] + (u.y * c + v.y * s) * rr, p[2] + (u.z * c + v.z * s) * rr];
    };
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
      const uu0 = ((i / seg) * 2 * Math.PI * r) / tu, uu1 = (((i + 1) / seg) * 2 * Math.PI * r) / tu;
      this.quad(ring(a, r, t0), ring(a, r, t1), ring(b, r1, t1), ring(b, r1, t0), [[uu0, 0], [uu1, 0], [uu1, L / tv], [uu0, L / tv]], color, tile);
    }
  }

  /** Small cube that glows at night (bulbs, lanterns, embers). */
  glowBox(x: number, y: number, z: number, s: number, id = 'glowWarm', glow = 3) {
    const sl = signSlot(id);
    if (!sl) return;
    const c = col(0xffffff).multiplyScalar(glow);
    const h = s / 2;
    const uv: [number, number][] = [[0.1, sl.v0], [0.9, sl.v0], [0.9, sl.v1], [0.1, sl.v1]];
    const P = (dx: number, dy: number, dz: number): V3 => [x + dx * h, y + dy * h, z + dz * h];
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), uv, c, sl.layer);
    this.quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), uv, c, sl.layer);
    this.quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), uv, c, sl.layer);
    this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), uv, c, sl.layer);
    this.quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), uv, c, sl.layer);
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), uv, c, sl.layer);
  }

  /** Crossed flame blades (emissive) standing at x,y,z. */
  flame(x: number, y: number, z: number, h: number, w: number, glow = 4) {
    const sl = signSlot('flame');
    if (!sl) return;
    const c = col(0xffffff).multiplyScalar(glow);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
      const uvs: [number, number][] = [[0, sl.v0], [1, sl.v0], [0.5, sl.v1]];
      this.tri([x - dx, y, z - dz], [x + dx, y, z + dz], [x, y + h, z], uvs, c, sl.layer);
      this.tri([x + dx, y, z + dz], [x - dx, y, z - dz], [x, y + h, z], uvs, c, sl.layer);
    }
  }

  /** Pole sign: post(s) + two-sided sign box. */
  pylon(x: number, z: number, height: number, w: number, h: number, id: string, yaw = 0) {
    const post = col(0x5a5f66);
    this.at(x, z, yaw, () => {
      this.box(0, 0, 0.45, 0.45, 0, height - h / 2, T.SOLID, post, T.SOLID);
      this.box(0, 0, w + 0.3, 0.5, height - h / 2 - 0.15, height + h / 2 + 0.15, T.SOLID, col(0x2c2f33), T.SOLID);
      this.sign(0, height, 0.2, w, h, id, 0, false);
      this.sign(0, height, -0.2, w, h, id, Math.PI, false);
    });
  }

  /** A parked car / pickup / SUV (~20 triangles), facing +Z. */
  car(x: number, z: number, yaw: number, color: Col, kind: 'sedan' | 'suv' | 'pickup' | 'van' = 'sedan') {
    const dark = col(0x1a1c20);
    const glass = col(0xffffff);
    this.at(x, z, yaw, () => {
      const L = kind === 'pickup' ? 5.3 : kind === 'suv' ? 4.8 : kind === 'van' ? 5 : 4.5;
      const W = kind === 'sedan' ? 1.8 : 1.95;
      const bodyH = kind === 'sedan' ? 0.75 : 0.95;
      this.box(0, 0, W, L, 0.28, 0.28 + bodyH, T.SOLID, color, T.SOLID, color, { ao: false });
      this.box(0, 0, W * 0.96, L * 0.96, 0.12, 0.3, T.SOLID, dark, null, undefined, { ao: false });
      const cabL = kind === 'pickup' ? 2.1 : kind === 'van' || kind === 'suv' ? L * 0.7 : 2.4;
      const cabZ = kind === 'pickup' ? 0.9 : kind === 'van' ? -0.2 : -0.15;
      const cabH = kind === 'sedan' ? 0.6 : 0.75;
      const y0 = 0.28 + bodyH;
      this.box(0, cabZ, W * 0.9, cabL, y0, y0 + cabH, T.CAR_GLASS, glass, T.SOLID, color, { ao: false });
    });
  }

  emit(kind: Emitter['kind'], x: number, y: number, z: number) {
    const [px, pz] = this.xf(x, z);
    this.emitters.push({ kind, pos: [px, y, pz] });
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('tile', new THREE.Float32BufferAttribute(this.tile, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export function shade(c: Col, k: number) {
  return tmp.copy(c).multiplyScalar(k).clone();
}
