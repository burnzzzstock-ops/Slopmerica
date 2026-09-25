// Shared lot furniture: pads, cars, trees, parking lots, signs, canopies,
// pumps, pools, rooftop junk. Everything goes into the same MeshBuilder.
import type { Emitter, LotSpec } from '../contracts';
import type { Rng } from '../core/rng';
import { hasTile } from '../art';
import { MB, M, S, rgb, RGB, WHITE, mulRGB, Mat } from './mesh';

export interface GenCtx {
  mb: MB;
  rng: Rng;
  spec: LotSpec;
  W: number;
  D: number;
  em: Emitter[];
  label: string;
  brand?: string;
}

/**
 * Keep a prop of half-extents (hx, hz) inside the lot. Only applies when no
 * transform is active (inside a rotated group the caller owns placement).
 */
export function inLot(g: GenCtx, x: number, z: number, hx: number, hz: number): [number, number] {
  if (!g.mb.identity) return [x, z];
  const c = (v: number, h: number, half: number) => (half - h < -half + h ? 0 : Math.max(-half + h, Math.min(half - h, v)));
  return [c(x, hx, g.W / 2), c(z, hz, g.D / 2)];
}

/** Half-extents of a w x l footprint rotated by yaw (l along local Z). */
function ext(w: number, l: number, yaw: number): [number, number] {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  return [(c * w + s * l) / 2, (s * w + c * l) / 2];
}

/** Record an emitter at a local point (respects the MeshBuilder transform). */
export function emit(g: GenCtx, kind: Emitter['kind'], x: number, y: number, z: number) {
  g.em.push({ kind, pos: g.mb.world(x, y, z) });
}

// ------------------------------------------------------------------ palettes
export const CAR_COLORS = [0xe8e8e6, 0x1a1a1c, 0xa9adb1, 0x6d7075, 0x7a1d1d, 0x1d2b4a, 0x2f4a3a, 0xc9c1a8, 0x8a1b1b, 0x3c5a8a, 0xd6d2c4, 0x2a2a2a, 0x5a3a24];
export const TRUCK_COLORS = [0xe8e8e6, 0x1a1a1c, 0x7a1d1d, 0x1d2b4a, 0xa9adb1, 0x3a4a2a, 0xb87a2a];

export const mats = {
  asphalt: () => M('asphalt', 8, 8),
  concrete: () => M('concretePad', 4, 4),
  lawn: () => M('lawn', 8, 8),
  dirt: () => M('dirt', 8, 8),
  gravel: () => M('gravel', 4, 4, 0xd8d0c0),
  plain: (c: number | RGB) => M('plain', 2, 2, c),
  metal: (c: number | RGB = 0xcfd3d6) => M('metal', 2, 2, c),
  dark: () => M('plain', 2, 2, 0x2a2b2d),
  leaf: (c: number | RGB) => M('leaf', 4, 4, c),
};

// ------------------------------------------------------------------ ground
/** Ground slab over the whole lot with a skirt so uneven terrain doesn't show gaps. */
export function lotPad(g: GenCtx, mat: Mat, y = 0.06) {
  const { mb, W, D } = g;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  mb.flat(x0, x1, z0, z1, y, mat);
  const sk = M('dirt', 8, 8, 0x9a8a70, { ao: false });
  mb.box(x0, x1, -0.8, y, z0, z1, { f: sk, b: sk, l: sk, r: sk, top: null });
}

export function patch(g: GenCtx, x0: number, x1: number, z0: number, z1: number, mat: Mat, y = 0.1) {
  if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return; // no room
  g.mb.flat(x0, x1, z0, z1, y, mat);
}

// ------------------------------------------------------------------ vehicles
export type CarKind = 'sedan' | 'suv' | 'pickup' | 'junk' | 'van' | 'lifted' | 'cyber';

export function car(g: GenCtx, x: number, z: number, yaw: number, kind?: CarKind, color?: number) {
  const { mb, rng } = g;
  kind ??= rng.pick<CarKind>(['sedan', 'sedan', 'suv', 'suv', 'pickup', 'pickup', 'van', 'lifted']);
  const junk = kind === 'junk';
  const col = junk ? rgb(rng.pick([0x8a5a3a, 0x6f5a48, 0x7d4a2a, 0x5a6a5a])) : rgb(color ?? rng.pick(kind === 'pickup' || kind === 'lifted' ? TRUCK_COLORS : CAR_COLORS));
  const body = junk ? M('rust', 2, 2, WHITE, { ao: false }) : M('metal', 2, 2, col, { ao: false });
  const glass = M('carWin', 2, 0.5, junk ? rgb(0x777777) : WHITE, { ao: false });
  const tire = M('plain', 2, 2, 0x1c1c1c, { ao: false });
  [x, z] = inLot(g, x, z, ...ext(2.1, 5.8, yaw));
  mb.push().translate(x, 0, z).rotY(yaw);
  let L = 4.5, Wd = 1.8, bodyH = 0.75, lift = 0.32, cabL = 2.2, cabH = 0.48, cabZ = -0.2;
  if (kind === 'suv') [L, Wd, bodyH, cabL, cabH, cabZ] = [4.8, 1.95, 0.9, 3.0, 0.62, -0.5];
  if (kind === 'van') [L, Wd, bodyH, cabL, cabH, cabZ] = [5.0, 1.95, 1.0, 3.6, 0.75, -0.4];
  if (kind === 'pickup') [L, Wd, bodyH, cabL, cabH, cabZ] = [5.6, 2.0, 0.9, 1.7, 0.6, 0.6];
  if (kind === 'lifted') [L, Wd, bodyH, lift, cabL, cabH, cabZ] = [5.8, 2.1, 0.95, 0.75, 1.8, 0.62, 0.6];
  if (kind === 'cyber') [L, Wd, bodyH, cabL, cabH, cabZ] = [5.6, 2.05, 0.9, 3.4, 0.5, -0.2];
  if (junk) lift = 0.18;
  // wheels (a dark slab under the body)
  if (!junk) mb.box(-Wd / 2 + 0.08, Wd / 2 - 0.08, 0, lift + 0.1, -L / 2 + 0.5, L / 2 - 0.5, { side: tire, top: null });
  else mb.box(-Wd / 2 + 0.3, Wd / 2 - 0.3, 0, lift, -L / 2 + 0.6, L / 2 - 0.6, { side: M('cinder', 3.2, 3.2), top: null });
  mb.box(-Wd / 2, Wd / 2, lift, lift + bodyH, -L / 2, L / 2, { side: body, top: body });
  if (kind === 'pickup' || kind === 'lifted') {
    // cab only; bed is the open body top (darker)
    mb.box(-Wd / 2 + 0.05, Wd / 2 - 0.05, lift + bodyH, lift + bodyH + cabH, cabZ - cabL / 2, cabZ + cabL / 2, { f: glass, b: glass, l: glass, r: glass, top: body });
    mb.flat(-Wd / 2 + 0.12, Wd / 2 - 0.12, -L / 2 + 0.15, cabZ - cabL / 2 - 0.1, lift + bodyH + 0.01, M('plain', 2, 2, mulRGB(col, 0.45)));
  } else if (kind === 'cyber') {
    // wedge
    mb.poly([[-Wd / 2, lift + bodyH, L / 2], [Wd / 2, lift + bodyH, L / 2], [Wd / 2, lift + bodyH + cabH + 0.3, 0], [-Wd / 2, lift + bodyH + cabH + 0.3, 0]], glass);
    mb.poly([[Wd / 2, lift + bodyH, -L / 2], [-Wd / 2, lift + bodyH, -L / 2], [-Wd / 2, lift + bodyH + cabH + 0.3, 0], [Wd / 2, lift + bodyH + cabH + 0.3, 0]], body);
    mb.poly([[-Wd / 2, lift + bodyH, -L / 2], [-Wd / 2, lift + bodyH, L / 2], [-Wd / 2, lift + bodyH + cabH + 0.3, 0]], body);
    mb.poly([[Wd / 2, lift + bodyH, L / 2], [Wd / 2, lift + bodyH, -L / 2], [Wd / 2, lift + bodyH + cabH + 0.3, 0]], body);
  } else {
    mb.box(-Wd / 2 + 0.08, Wd / 2 - 0.08, lift + bodyH, lift + bodyH + cabH, cabZ - cabL / 2, cabZ + cabL / 2, { f: glass, b: glass, l: glass, r: glass, top: body });
  }
  mb.pop();
}

// ------------------------------------------------------------------ vegetation
export const LEAF_GREENS = [0x5f8a3a, 0x4f7a32, 0x6a9442, 0x557a3a, 0x7a9a4a, 0x46703a];

export function tree(g: GenCtx, x: number, z: number, s = 1, kind: 'round' | 'cone' | 'palm' | 'sad' = 'round') {
  const { mb, rng } = g;
  const reach = (kind === 'palm' ? 3.2 : kind === 'cone' ? 1.9 : kind === 'sad' ? 1.2 : 3.2) * s; // canopy radius incl. jitter
  [x, z] = inLot(g, x, z, reach, reach);
  const trunkM = M('plain', 2, 2, 0x5a4230);
  if (kind === 'palm') {
    const h = 7 * s;
    mb.boxC(x, z, 0.35 * s, 0.35 * s, 0, h, { side: M('wood', 4, 4, 0xc9b08a), top: null });
    const leaf = mats.leaf(rgb(0x4f8a3a));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rng.float() * 0.3;
      const dx = Math.sin(a), dz = Math.cos(a);
      const L = 3 * s;
      const px = -dz * 0.45 * s, pz = dx * 0.45 * s;
      const tip: [number, number, number] = [x + dx * L, h - 1.2 * s, z + dz * L];
      mb.poly([[x - px, h, z - pz], [x + px, h, z + pz], tip], leaf);
      mb.poly([[x + px, h, z + pz], [x - px, h, z - pz], tip], leaf);
    }
    return;
  }
  if (kind === 'cone') {
    const h = (6 + rng.float() * 3) * s;
    mb.boxC(x, z, 0.3 * s, 0.3 * s, 0, 1.4 * s, { side: trunkM, top: null });
    mb.cone(x, z, 1.8 * s, 1.0 * s, h, 7, mats.leaf(rgb(0x2f5a30)));
    return;
  }
  const sad = kind === 'sad';
  const th = (sad ? 1.6 : 2.2) * s;
  mb.boxC(x, z, 0.28 * s, 0.28 * s, 0, th + 0.5, { side: trunkM, top: null });
  const r = (sad ? 0.9 : 1.8 + rng.float() * 0.8) * s;
  const col = sad ? rgb(rng.pick([0x8a8a4a, 0x7a8a4a, 0x9a8a5a])) : rgb(rng.pick(LEAF_GREENS));
  mb.blob(x, th + r * 0.8, z, r, r * 0.85, r, mats.leaf(col), 0, 0.2, Math.floor(x * 13 + z * 7));
}

export function shrub(g: GenCtx, x: number, z: number, s = 1) {
  [x, z] = inLot(g, x, z, 0.8 * s, 0.8 * s);
  const col = rgb(g.rng.pick(LEAF_GREENS));
  g.mb.blob(x, 0.45 * s, z, 0.7 * s, 0.5 * s, 0.7 * s, mats.leaf(col), 0, 0.25, Math.floor(x * 31 + z * 17));
}

// ------------------------------------------------------------------ parking
export interface Stall {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Stroad-grade parking between z0 and z1 (z1 nearest the road). Rows of 5.5 m
 * stalls on 6.5 m aisles, stall lines from the atlas. Fills ~occ of stalls
 * with cars and plants one sad tree per row end if there is room.
 */
export function parkingLot(g: GenCtx, x0: number, x1: number, z0: number, z1: number, occ = 0.3, o: { trees?: boolean; lamps?: boolean } = {}): Stall[] {
  const { mb, rng } = g;
  const stalls: Stall[] = [];
  mb.flat(x0, x1, z0, z1, 0.08, mats.asphalt());
  const depth = z1 - z0;
  const rowD = 5.5, aisle = 6.5;
  // layout from the road side: aisle, row, row, aisle, row, row ...
  let z = z1;
  const rows: { za: number; zb: number; aisleSide: 1 | -1 }[] = [];
  z -= Math.min(aisle, Math.max(3, depth - rowD));
  while (z - rowD >= z0 - 0.01) {
    rows.push({ za: z - rowD, zb: z, aisleSide: 1 });
    z -= rowD;
    if (z - rowD >= z0 - 0.01) {
      rows.push({ za: z - rowD, zb: z, aisleSide: -1 });
      z -= rowD;
    }
    z -= aisle;
  }
  const endPad = o.trees && x1 - x0 > 20 ? 3 : 0;
  for (const r of rows) {
    const rx0 = x0 + endPad, rx1 = x1 - endPad;
    const stallMat = M('parking', 10.8, 5.5, WHITE, { bays: 4, flipV: r.aisleSide < 0 });
    mb.flat(rx0, rx1, r.za, r.zb, 0.1, stallMat);
    const n = Math.max(1, Math.round((rx1 - rx0) / 2.7));
    const sw = (rx1 - rx0) / n;
    for (let i = 0; i < n; i++) {
      const sx = rx0 + (i + 0.5) * sw, sz = (r.za + r.zb) / 2;
      const yaw = r.aisleSide > 0 ? Math.PI : 0;
      stalls.push({ x: sx, z: sz, yaw });
      if (rng.chance(occ)) car(g, sx + (rng.float() - 0.5) * 0.3, sz + r.aisleSide * 0.2, yaw + (rng.float() - 0.5) * 0.08);
    }
    if (endPad) {
      for (const ex of [x0 + endPad / 2, x1 - endPad / 2]) {
        mb.box(ex - endPad / 2 + 0.2, ex + endPad / 2 - 0.2, 0.08, 0.28, r.za + 0.3, r.zb - 0.3, { side: M('concretePad', 4, 4), top: M('mulch', 2, 2) });
        tree(g, ex, (r.za + r.zb) / 2, 0.75, rng.chance(0.3) ? 'sad' : 'round');
      }
    }
  }
  if (o.lamps !== false && rows.length) {
    const nl = Math.max(1, Math.floor((x1 - x0) / 22));
    for (let i = 0; i < nl; i++) lampPost(g, x0 + ((i + 0.5) * (x1 - x0)) / nl, rows[0].za - 0.2, 8.5, 2);
  }
  return stalls;
}

export function lampPost(g: GenCtx, x: number, z: number, h = 8, heads = 1) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, heads > 1 ? 1.5 : 0.6, 0.3);
  const pole = M('metal', 2, 2, 0x6a6e72);
  mb.boxC(x, z, 0.22, 0.22, 0, h, { side: pole, top: null });
  for (let k = 0; k < heads; k++) {
    const dx = heads === 1 ? 0 : k === 0 ? -0.9 : 0.9;
    mb.boxC(x + dx, z, 1.1, 0.45, h - 0.25, 0.25, { side: M('plain', 2, 2, 0x444648), top: M('plain', 2, 2, 0x444648), bottom: S('lampWarm') });
  }
}

// ------------------------------------------------------------------ signs
/** Pole sign carrying a brand panel (and optional gas price board). */
export function poleSign(g: GenCtx, x: number, z: number, h: number, w: number, tile: string, o: { price?: boolean; tilt?: number; lit?: boolean } = {}) {
  const { mb } = g;
  w = Math.min(w, g.W - 1);
  [x, z] = inLot(g, x, z, w / 2 + 0.1, 0.5);
  const pw = w, ph = w / 4;
  const steel = M('metal', 2, 2, 0x8a8e92);
  const cab = M('plain', 2, 2, 0x2a2b2d);
  mb.boxC(x - pw * 0.28, z, 0.35, 0.35, 0, h, { side: steel, top: null });
  mb.boxC(x + pw * 0.28, z, 0.35, 0.35, 0, h, { side: steel, top: null });
  // brand panel, double-sided
  const sm = S(hasTile(tile) ? tile : 'sign:vacant');
  mb.box(x - pw / 2, x + pw / 2, h, h + ph, z - 0.3, z + 0.3, { f: sm, b: sm, l: cab, r: cab, top: cab });
  if (o.price) {
    const pbw = pw * 0.55, pbh = pbw * 1.1;
    const pm = S('priceBoard');
    mb.box(x - pbw / 2, x + pbw / 2, h - pbh - 0.3, h - 0.3, z - 0.25, z + 0.25, { f: pm, b: pm, l: cab, r: cab, top: cab });
  }
}

/** Monument / low sign on a brick base near the curb. */
export function monumentSign(g: GenCtx, x: number, z: number, w: number, tile: string, base: Mat = M('brickTan', 2, 2)) {
  const { mb } = g;
  w = Math.min(w, g.W - 1.6);
  [x, z] = inLot(g, x, z, w / 2 + 0.3, 0.4);
  const h = w / 4;
  mb.boxC(x, z, w + 0.6, 0.8, 0, 0.7, base);
  const sm = S(tile);
  mb.box(x - w / 2, x + w / 2, 0.7, 0.7 + h, z - 0.25, z + 0.25, { f: sm, b: sm, l: base, r: base, top: base });
}

/** Wall-mounted sign box on the street face (+Z) of a wall at depth zWall. */
export function wallSign(g: GenCtx, x: number, y: number, zWall: number, w: number, tile: string, h = w / 4, depth = 0.25) {
  const { mb } = g;
  const cab = M('plain', 2, 2, 0x1d1d1f);
  mb.box(x - w / 2, x + w / 2, y, y + h, zWall, zWall + depth, { f: S(tile), b: null, l: cab, r: cab, top: cab, bottom: cab });
}

/** Sign on a side wall facing +X or -X. */
export function sideSign(g: GenCtx, xWall: number, y: number, z: number, w: number, tile: string, dir: 1 | -1, h = w / 4) {
  const { mb } = g;
  const cab = M('plain', 2, 2, 0x1d1d1f);
  const d = 0.25 * dir;
  const xa = Math.min(xWall, xWall + d), xb = Math.max(xWall, xWall + d);
  mb.box(xa, xb, y, y + h, z - w / 2, z + w / 2, { f: cab, b: cab, r: dir > 0 ? S(tile) : null, l: dir < 0 ? S(tile) : null, top: cab, bottom: cab });
}

// ------------------------------------------------------------------ gas stations
export function canopy(g: GenCtx, x0: number, x1: number, z0: number, z1: number, h: number, brandId: string) {
  const { mb } = g;
  const colM = M('metal', 2, 2, 0xe8e8e6);
  const nCols = Math.max(2, Math.round((x1 - x0) / 8));
  for (let i = 0; i < nCols; i++) {
    const cx = x0 + 2 + (i * (x1 - x0 - 4)) / (nCols - 1);
    for (const cz of [z0 + 2.5, z1 - 2.5]) mb.boxC(cx, cz, 0.5, 0.5, 0, h, { side: colM, top: null });
  }
  const fascia = hasTile('canopy:' + brandId) ? M('canopy:' + brandId, 8, 1.1, WHITE, { ao: false }) : M('plain', 2, 2, 0xb3202a);
  mb.box(x0, x1, h, h + 1.1, z0, z1, { side: fascia, top: M('metal', 2, 2, 0xd6d8da), bottom: M('canopyLight', 3, 3, WHITE) });
}

export function pumpIsland(g: GenCtx, x: number, z: number) {
  const { mb } = g;
  mb.boxC(x, z, 1.2, 4.4, 0, 0.18, M('concretePad', 4, 4, 0xe8e0c0));
  for (const dz of [-1.1, 1.1]) {
    const pm = S('pump');
    mb.box(x - 0.45, x + 0.45, 0.18, 1.95, z + dz - 0.35, z + dz + 0.35, { f: pm, b: pm, l: M('plain', 2, 2, 0xdadad6), r: M('plain', 2, 2, 0xdadad6), top: M('plain', 2, 2, 0xb3202a) });
  }
  // bollards
  for (const dz of [-2.1, 2.1]) mb.cyl(x, z + dz, 0.12, 0, 1.0, 6, M('plain', 2, 2, 0xf2c230));
}

// ------------------------------------------------------------------ rooftop & yard junk
export function hvac(g: GenCtx, x: number, y: number, z: number, s = 1) {
  const { mb } = g;
  mb.boxC(x, z, 1.8 * s, 1.2 * s, y, 1.0 * s, { side: M('grille', 2, 2, 0xc8c8c4), top: S('hvac') });
}

export function acUnit(g: GenCtx, x: number, z: number) {
  [x, z] = inLot(g, x, z, 0.5, 0.5);
  g.mb.boxC(x, z, 0.9, 0.9, 0.06, 0.8, { side: M('grille', 2, 2, 0xd8d8d4), top: S('acUnit') });
}

export function waterTank(g: GenCtx, x: number, y: number, z: number, s = 1) {
  const { mb } = g;
  const wood = M('wood', 4, 4, 0xb49a78);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mb.boxC(x + dx * 1.0 * s, z + dz * 1.0 * s, 0.18, 0.18, y, 2 * s, { side: M('metal', 2, 2, 0x333333), top: null });
  mb.cyl(x, z, 1.6 * s, y + 2 * s, y + 4.6 * s, 10, wood, null);
  mb.cone(x, z, 1.75 * s, y + 4.6 * s, 1.1 * s, 10, M('metalRoof', 4, 4, 0x6a6a64));
}

export function mast(g: GenCtx, x: number, y: number, z: number, h: number) {
  const { mb } = g;
  mb.boxC(x, z, 0.14, 0.14, y, h, { side: M('metal', 2, 2, 0x9a9ea2), top: null });
  mb.boxC(x, z, 0.3, 0.3, y + h, 0.3, S('neonRed'));
}

export function dish(g: GenCtx, x: number, y: number, z: number, s = 1) {
  const { mb } = g;
  mb.push().translate(x, y, z).rotX(-0.9);
  mb.lathe(0, 0, [[0.01, 0], [0.5 * s, 0.12 * s], [0.6 * s, 0.25 * s]], 8, M('plain', 2, 2, 0xe6e6e2), { capTop: null });
  mb.pop();
}

export function dumpster(g: GenCtx, x: number, z: number, yaw = 0) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, ...ext(2.0, 1.4, yaw));
  mb.push().translate(x, 0, z).rotY(yaw);
  mb.boxC(0, 0, 2.0, 1.4, 0, 1.3, { side: S('dumpster'), top: M('plain', 2, 2, 0x1f3a27) });
  mb.pop();
}

export function fence(g: GenCtx, x0: number, z0: number, x1: number, z1: number, h = 1.8, tile = 'fence') {
  const { mb } = g;
  const L = Math.hypot(x1 - x0, z1 - z0);
  const fm = M(tile, 4, 2 * (h / 1.8), WHITE, { ao: false });
  const nx = (z1 - z0) / L * 0.03, nz = -(x1 - x0) / L * 0.03;
  // two faces so it reads from both sides
  mb.poly([[x0 + nx, 0, z0 + nz], [x1 + nx, 0, z1 + nz], [x1 + nx, h, z1 + nz], [x0 + nx, h, z0 + nz]], fm);
  mb.poly([[x1 - nx, 0, z1 - nz], [x0 - nx, 0, z0 - nz], [x0 - nx, h, z0 - nz], [x1 - nx, h, z1 - nz]], fm);
}

export function poolInground(g: GenCtx, x: number, z: number, w: number, d: number) {
  const { mb } = g;
  mb.flat(x - w / 2 - 1.2, x + w / 2 + 1.2, z - d / 2 - 1.2, z + d / 2 + 1.2, 0.12, M('concretePad', 4, 4, 0xe8e2d4));
  mb.flat(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0.15, M('pool', 4, 4));
}

export function poolAbove(g: GenCtx, x: number, z: number, r = 2.2) {
  const { mb } = g;
  r = Math.min(r, g.W / 2 - 0.6, g.D / 2 - 0.6);
  [x, z] = inLot(g, x, z, r + 0.1, r + 0.1);
  mb.cyl(x, z, r, 0, 1.2, 12, M('corrugated', 4, 4, 0x6fa8dc), null);
  mb.lathe(x, z, [[r - 0.05, 1.12], [0.01, 1.12]], 12, M('pool', 4, 4));
}

export function trampoline(g: GenCtx, x: number, z: number) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, 1.95, 1.95);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    mb.boxC(x + Math.sin(a) * 1.6, z + Math.cos(a) * 1.6, 0.08, 0.08, 0, 0.9, { side: M('metal', 2, 2, 0x444444), top: null });
  }
  mb.lathe(x, z, [[1.8, 0.9], [0.01, 0.92]], 10, M('plain', 2, 2, 0x1a1a1a));
  mb.lathe(x, z, [[1.85, 0.8], [1.85, 0.95]], 10, M('plain', 2, 2, 0x2f6fd6), { capTop: null });
}

export function burnBarrel(g: GenCtx, x: number, z: number) {
  [x, z] = inLot(g, x, z, 0.4, 0.4);
  g.mb.cyl(x, z, 0.35, 0, 0.9, 7, M('rust', 2, 2), M('plain', 2, 2, 0x1a1a1a));
  emit(g, 'smoke', x, 1.1, z);
  emit(g, 'fire', x, 0.95, z);
}

export function smoker(g: GenCtx, x: number, z: number, yaw = 0) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, 0.6, 0.6);
  mb.push().translate(x, 0, z).rotY(yaw);
  mb.boxC(0, 0, 0.9, 0.9, 0, 0.6, { side: M('metal', 2, 2, 0x333333), top: null });
  mb.lathe(0, 0, [[0.45, 0.6], [0.45, 1.6]], 8, M('plain', 2, 2, 0x222222), { capTop: M('plain', 2, 2, 0x222222) });
  mb.cyl(0.35, 0, 0.08, 1.6, 2.4, 5, M('plain', 2, 2, 0x222222));
  emit(g, 'smoke', 0.35, 2.5, 0);
  mb.pop();
}

export function flagpole(g: GenCtx, x: number, z: number, h = 7, fw = 2.2) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, 0.2, 0.2);
  // the flag flies toward +X: never wider than the lot allows
  if (mb.identity) fw = Math.max(0.8, Math.min(fw, g.W / 2 - x - 0.2));
  mb.boxC(x, z, 0.12, 0.12, 0, h, { side: M('metal', 2, 2, 0xd8d8d8), top: null });
  const fh = fw * 0.625;
  const fm = S('flag');
  mb.poly([[x + 0.06, h - fh, z], [x + 0.06 + fw, h - fh - 0.1, z], [x + 0.06 + fw, h - 0.1, z], [x + 0.06, h, z]], fm);
  mb.poly([[x + 0.06 + fw, h - fh - 0.1, z], [x + 0.06, h - fh, z], [x + 0.06, h, z], [x + 0.06 + fw, h - 0.1, z]], { ...fm, flipU: true });
}

export function tubeMan(g: GenCtx, x: number, z: number, color: number) {
  const { mb, rng } = g;
  [x, z] = inLot(g, x, z, 1.5, 0.5);
  const m = M('plain', 2, 2, color);
  mb.push().translate(x, 0, z).rotZ((rng.float() - 0.5) * 0.4);
  mb.cyl(0, 0, 0.3, 0, 4.5, 6, m);
  mb.push().translate(0, 3.6, 0).rotZ(1.2);
  mb.cyl(0, 0, 0.12, 0, 1.4, 5, m);
  mb.pop();
  mb.push().translate(0, 3.4, 0).rotZ(-1.0);
  mb.cyl(0, 0, 0.12, 0, 1.4, 5, m);
  mb.pop();
  mb.pop();
}

export function boatTrailer(g: GenCtx, x: number, z: number, yaw: number) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, ...ext(1.9, 5.4, yaw));
  mb.push().translate(x, 0, z).rotY(yaw);
  mb.boxC(0, 0, 1.6, 5.2, 0.3, 0.2, M('plain', 2, 2, 0x333333));
  const hull = M('plain', 2, 2, 0xf2f2ee, { ao: false }), deck = M('plain', 2, 2, 0x2a6fb0);
  mb.box(-0.9, 0.9, 0.5, 1.3, -2.4, 1.2, { side: hull, top: deck, f: null });
  // bow wedge
  mb.poly([[0, 0.5, 2.6], [0.9, 0.5, 1.2], [0.9, 1.3, 1.2], [0, 1.3, 2.6]], hull);
  mb.poly([[-0.9, 0.5, 1.2], [0, 0.5, 2.6], [0, 1.3, 2.6], [-0.9, 1.3, 1.2]], hull);
  mb.poly([[0.9, 1.3, 1.2], [-0.9, 1.3, 1.2], [0, 1.3, 2.6]], deck);
  mb.pop();
}

export function picnicTable(g: GenCtx, x: number, z: number) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, 1.0, 0.9);
  const w = M('wood', 4, 4, 0xa07a50);
  mb.boxC(x, z, 1.8, 0.8, 0.72, 0.06, w);
  mb.boxC(x, z - 0.65, 1.8, 0.3, 0.42, 0.05, w);
  mb.boxC(x, z + 0.65, 1.8, 0.3, 0.42, 0.05, w);
}

export function propaneCage(g: GenCtx, x: number, z: number) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, 0.95, 0.45);
  mb.boxC(x, z, 1.8, 0.8, 0, 1.4, { side: M('grille', 2, 2, 0xdfe6f0), top: M('plain', 2, 2, 0x1d4fa3) });
  mb.box(x - 0.9, x + 0.9, 1.4, 1.8, z + 0.4, z + 0.42, { f: S('sign:myOwnPropane'), b: null, l: null, r: null, top: null });
}

export function vending(g: GenCtx, x: number, z: number, faceZ = 1) {
  const { mb } = g;
  [x, z] = inLot(g, x, z, 0.5, 0.45);
  const vm = S('vending');
  mb.boxC(x, z, 0.9, 0.8, 0, 1.9, { f: faceZ > 0 ? vm : M('plain', 2, 2, 0x111111), b: faceZ < 0 ? vm : M('plain', 2, 2, 0x111111), l: M('plain', 2, 2, 0x111111), r: M('plain', 2, 2, 0x111111), top: M('plain', 2, 2, 0x111111) });
}

export function iceBox(g: GenCtx, x: number, z: number) {
  [x, z] = inLot(g, x, z, 0.85, 0.45);
  g.mb.boxC(x, z, 1.6, 0.8, 0, 1.4, { f: S('iceBox'), side: M('plain', 2, 2, 0xf4f6f8), top: M('plain', 2, 2, 0xf4f6f8) });
}

export function hoop(g: GenCtx, x: number, z: number) {
  const { mb } = g;
  mb.boxC(x, z, 0.12, 0.12, 0, 3.2, { side: M('metal', 2, 2, 0x333333), top: null });
  mb.box(x - 0.6, x + 0.6, 2.9, 3.7, z + 0.1, z + 0.14, { f: S('boardGame'), b: M('plain', 2, 2, 0xffffff), top: null, l: null, r: null });
}

export function mailbox(g: GenCtx, x: number, z: number) {
  const { mb } = g;
  mb.boxC(x, z, 0.1, 0.1, 0, 1.0, { side: M('wood', 4, 4, 0x6a5040), top: null });
  mb.boxC(x, z, 0.25, 0.5, 1.0, 0.25, M('plain', 2, 2, 0x222222));
}

export function porchSteps(g: GenCtx, x: number, zFront: number, w: number, h: number, mat: Mat = M('concretePad', 4, 4, 0xd0c8b8)) {
  const n = Math.max(1, Math.round(h / 0.2));
  for (let i = 0; i < n; i++) g.mb.box(x - w / 2, x + w / 2, 0, h - i * (h / n), zFront, zFront + 0.3 * (i + 1), { side: mat, top: mat, b: null });
}

export function rooftopBillboard(g: GenCtx, x: number, y: number, z: number, w: number, tile: string, yaw = 0) {
  const { mb } = g;
  const h = w * (160 / 512);
  mb.push().translate(x, y, z).rotY(yaw);
  const steel = M('metal', 2, 2, 0x5a5e62);
  for (const dx of [-w * 0.3, w * 0.3]) mb.boxC(dx, -0.4, 0.25, 0.25, 0, 2.2, { side: steel, top: null });
  mb.box(-w / 2, w / 2, 2.2, 2.2 + h, -0.3, 0, { f: S(tile), b: M('bb:back', 4, 1.25), l: steel, r: steel, top: steel });
  mb.box(-w / 2, w / 2, 2.0, 2.2, 0, 0.9, { side: steel, top: M('grille', 2, 2, 0x777777) });
  mb.pop();
}
