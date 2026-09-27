// The house style catalog: fifty-odd ways to live in SLOPMERICA, from the
// converted school bus to the Founder's Compound. Each style is a short
// recipe on a shared kit (profile-extruded bodies, so gambrels, saltboxes,
// A-frames and quonsets are one call; porches, garages, dormers, turrets),
// and every lot is then dressed from the satire catalog: junk and bandit
// signs on the cheap lots, HOA menace and inflatable eagles on the rich ones.
import { M, S, Mat, rgb, WHITE, mulRGB, type RGB } from './mesh';
import {
  GenCtx, lotPad, patch, car, tree, shrub, fence, poolInground, poolAbove, trampoline, burnBarrel, smoker, flagpole, dish,
  hoop, mailbox, porchSteps, acUnit, mats, picnicTable, emit, type CarKind,
} from './props';
import { decorate, occupy, isFree, type Area } from './satire';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type Z = [number, number]; // (z, y) in a cross-section

// ------------------------------------------------------------------ palettes
export const PAL = {
  siding: [0xe8e2d0, 0xd8d2c4, 0xc9c3b3, 0xb7c1c9, 0x9fb0a0, 0xe6d8a8, 0xc4b19a, 0xf2f0ea, 0xa9b8c7, 0x8f9a8a, 0xd9c3b0],
  beige: [0xd8d2c4, 0xcfc6b4, 0xc9c3b3, 0xbfb7a6, 0xd6cdb9, 0xb9b2a4],
  painted: [0x8ecfc9, 0xf2a7c3, 0xf7d774, 0xb7a3e0, 0x9fd18b, 0xf4b183, 0x7fb3e6],
  stucco: [0xe8d8b8, 0xdcc6a0, 0xf0e0c8, 0xe0b890, 0xf2e6d0, 0xd9b99a],
  bold: [0x2f3b4a, 0x3a4a3a, 0x5a2a2a, 0x1f2a36, 0x4a4a4a],
  roof: [0xc8c4c0, 0xa89888, 0x9a9896, 0xb8a898, 0xaaa49e, 0xb0a090, 0x8e8a86],
  metalRoof: [0x2a2a2c, 0x7a1d1d, 0x2a4a3a, 0x3a4a6a, 0xb8b8b2, 0x8a5a3a],
  trailer: [0xf1efe8, 0xe8f0e0, 0xf0e6c8, 0xe0ecf2, 0xf2e2d8, 0xdad6c8],
};

// ------------------------------------------------------------------ layout
export interface Lay {
  x0: number;
  x1: number;
  zb: number;
  zf: number;
  /** wall top (eave) */
  H: number;
  /** how far in front of zf the porch / stoop reaches */
  porch: number;
}

/** Front yard, back yard and usable house depth for a lot depth D. */
export function setbacks(D: number, front = 0) {
  const fs = clamp(D * 0.28, 2.2, 7);
  const bs = clamp(D * 0.16, 0.8, 9);
  const hd = clamp(D - fs - bs - front, 4.2, 11);
  const gz = D / 2 - fs;
  return { fs, bs, hd, gz, zf: gz - front };
}

/** A body w x d on the lot: centered-ish, pushed back by the porch depth. */
function site(g: GenCtx, w: number, d: number, porch = 0, xBias = 0): Lay {
  const { W, D, rng } = g;
  w = Math.min(w, W - 2);
  const sb = setbacks(D, porch);
  d = Math.min(d, sb.hd);
  const slack = Math.max(0, W - w - 2);
  const cx = clamp(xBias * slack * 0.5 + (rng.float() - 0.5) * slack * 0.4, -slack / 2, slack / 2);
  return { x0: cx - w / 2, x1: cx + w / 2, zf: sb.zf, zb: sb.zf - d, H: 2.8, porch };
}

// ------------------------------------------------------------------ kit
export const win = (g: GenCtx, name: string, litP = 0.6) => S(g.rng.chance(litP) ? name + 'Lit' : name);

type Open = { x0: number; x1: number; y0: number; y1: number; z: number };
/** Doors and garage doors on the front: street-side windows keep clear of them. */
function opening(g: GenCtx, x0: number, x1: number, y0: number, y1: number, z: number) {
  ((g as GenCtx & { opens?: Open[] }).opens ??= []).push({ x0, x1, y0, y1, z });
}
function blocked(g: GenCtx, x0: number, x1: number, y0: number, y1: number, z: number) {
  return ((g as GenCtx & { opens?: Open[] }).opens ?? []).some((o) => Math.abs(o.z - z) < 0.3 && x0 < o.x1 + 0.15 && x1 > o.x0 - 0.15 && y0 < o.y1 && y1 > o.y0);
}

function row(g: GenCtx, side: '+z' | '-z' | '+x' | '-x', a: number, b: number, wall: number, y: number, n: number, tile: string, w: number, h: number, skip: [number, number][] = []) {
  for (let i = 0; i < n; i++) {
    const t = a + ((i + 0.5) * (b - a)) / n;
    if (skip.some(([s0, s1]) => t > s0 - w / 2 && t < s1 + w / 2)) continue;
    if (side === '+z' && blocked(g, t - w / 2, t + w / 2, y, y + h, wall)) continue;
    g.mb.decal(side, t, y, wall, w, h, win(g, tile));
  }
}

/** Windows on all four faces of a body: floors x per-face counts from width. */
function windows(g: GenCtx, L: Lay, tile: string, o: { floors?: number; y0?: number; fh?: number; w?: number; h?: number; skipFront?: [number, number][]; front?: boolean; sides?: boolean; back?: boolean } = {}) {
  const floors = o.floors ?? 1, y0 = o.y0 ?? 0.9, fh = o.fh ?? 3, w = o.w ?? 1.1, h = o.h ?? 1.4;
  const W = L.x1 - L.x0, D = L.zf - L.zb;
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * fh;
    if (o.front !== false) row(g, '+z', L.x0 + 0.3, L.x1 - 0.3, L.zf, y, Math.max(1, Math.floor(W / 3)), tile, w, h, f === 0 ? o.skipFront : []);
    if (o.sides !== false) {
      row(g, '-x', L.zb + 0.4, L.zf - 0.4, L.x0, y, Math.max(1, Math.floor(D / 3.5)), tile, w * 0.9, h);
      row(g, '+x', L.zb + 0.4, L.zf - 0.4, L.x1, y, Math.max(1, Math.floor(D / 3.5)), tile, w * 0.9, h);
    }
    if (o.back !== false) row(g, '-z', L.x0 + 0.3, L.x1 - 0.3, L.zb, y, Math.max(1, Math.floor(W / 3.4)), tile, w, h);
  }
}

function door(g: GenCtx, x: number, z: number, y: number, tile: string, lights = 0.8, w = 1.0, h = 2.1) {
  if (blocked(g, x - w / 2, x + w / 2, y, y + h, z)) return;
  opening(g, x - w / 2 - (lights > 0 ? lights : 0), x + w / 2 + (lights > 0 ? lights : 0), y, y + h + 0.4, z);
  g.mb.decal('+z', x, y, z, w, h, S(tile));
  if (lights > 0) for (const dx of [-lights, lights]) g.mb.decal('+z', x + dx, y + h - 0.2, z + 0.03, 0.42, 0.55, S('lampWarm'));
}

/**
 * Extrude a convex cross-section (z, y) along x0..x1. The profile runs from
 * the front foot (zf, 0) to the back foot (zb, 0), up the back and over the
 * top to the front: counter-clockwise seen from +x. Vertical edges get the
 * wall, the rest the roof (overhanging `o` past the ends). End caps: `end`.
 */
export function extrude(g: GenCtx, x0: number, x1: number, prof: Z[], wall: Mat | null, roof: Mat, end: Mat | null = wall, o = 0.25) {
  const { mb } = g;
  if (end) {
    mb.poly(prof.map(([z, y]) => [x1, y, z]), end);
    mb.poly([...prof].reverse().map(([z, y]) => [x0, y, z]), end);
  }
  const yMin = Math.min(...prof.map((p) => p[1])) + 0.001;
  for (let i = 0; i < prof.length; i++) {
    const [za, ya] = prof[i], [zb, yb] = prof[(i + 1) % prof.length];
    if (ya < yMin && yb < yMin) continue; // the floor
    const vertical = Math.abs(za - zb) < 0.01;
    const m = vertical ? wall : roof;
    if (!m) continue;
    const e = vertical ? 0 : o;
    mb.poly([[x1 + e, ya, za], [x0 - e, ya, za], [x0 - e, yb, zb], [x1 + e, yb, zb]], m);
  }
}

// profiles (front foot first, counter-clockwise from +x)
export const P = {
  gable: (zb: number, zf: number, H: number, rise: number): Z[] => [[zf, 0], [zb, 0], [zb, H], [(zb + zf) / 2, H + rise], [zf, H]],
  gambrel: (zb: number, zf: number, H: number, rise: number): Z[] => {
    const d = zf - zb, k = d * 0.2;
    return [[zf, 0], [zb, 0], [zb, H], [zb + k, H + rise * 0.7], [(zb + zf) / 2, H + rise], [zf - k, H + rise * 0.7], [zf, H]];
  },
  saltbox: (zb: number, zf: number, H: number, rise: number): Z[] => {
    const d = zf - zb, zr = zf - d * 0.36;
    return [[zf, 0], [zb, 0], [zb, H - 2.4], [zr, H + rise], [zf, H]];
  },
  shed: (zb: number, zf: number, H: number, rise: number): Z[] => [[zf, 0], [zb, 0], [zb, H + rise], [zf, H]],
  shedF: (zb: number, zf: number, H: number, rise: number): Z[] => [[zf, 0], [zb, 0], [zb, H], [zf, H + rise]],
  aframe: (zb: number, zf: number, _H: number, rise: number): Z[] => [[zf, 0], [zb, 0], [(zb + zf) / 2, rise]],
  flat: (zb: number, zf: number, H: number): Z[] => [[zf, 0], [zb, 0], [zb, H], [zf, H]],
};

/** Quonset profile done carefully: front foot, back foot, then the arc from back to front. */
function quonsetProf(zb: number, zf: number, n = 8): Z[] {
  const r = (zf - zb) / 2, c = (zb + zf) / 2, out: Z[] = [[zf, 0], [zb, 0]];
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI;
    out.push([c - Math.cos(a) * r, Math.sin(a) * r * 0.95]);
  }
  return out;
}

/** Walls-only box (no top) for masses that get their own roof. */
function body(g: GenCtx, L: Lay, wall: Mat, front: Mat = wall, y0 = 0, H = L.H) {
  g.mb.box(L.x0, L.x1, y0, H, L.zb, L.zf, { side: wall, f: front, top: null });
}

type Roof = 'gable' | 'gableZ' | 'hip' | 'gambrel' | 'saltbox' | 'shed' | 'shedF' | 'flat' | 'mansard' | 'pyramid';
/** Walls + roof over a lay in one go. Returns the ridge height. */
function house(g: GenCtx, L: Lay, wall: Mat, roofM: Mat, roof: Roof, rise: number, o: { front?: Mat; parapet?: boolean; ov?: number } = {}) {
  const { mb } = g;
  const front = o.front ?? wall;
  switch (roof) {
    case 'gable':
    case 'gambrel':
    case 'saltbox':
    case 'shed':
    case 'shedF':
      extrude(g, L.x0, L.x1, P[roof](L.zb, L.zf, L.H, rise), wall, roofM, wall, o.ov ?? 0.3);
      if (front !== wall) mb.decal('+z', (L.x0 + L.x1) / 2, 0, L.zf, L.x1 - L.x0, roof === 'shedF' ? L.H + rise : L.H, front, 0.02);
      return L.H + rise;
    case 'gableZ':
      body(g, L, wall, front);
      mb.gable(L.x0, L.x1, L.zb, L.zf, L.H, rise, 'z', roofM, front, o.ov ?? 0.35);
      return L.H + rise;
    case 'hip':
    case 'pyramid':
      body(g, L, wall, front);
      mb.hip(L.x0, L.x1, L.zb, L.zf, L.H, rise, roofM, o.ov ?? 0.45);
      return L.H + rise;
    case 'flat':
      body(g, L, wall, front);
      if (o.parapet !== false) mb.parapet(L.x0, L.x1, L.zb, L.zf, L.H, 0.6, wall, M('flatRoof', 4, 4));
      else mb.flat(L.x0 - 0.3, L.x1 + 0.3, L.zb - 0.3, L.zf + 0.3, L.H, roofM);
      return L.H + 0.6;
    case 'mansard': {
      body(g, L, wall, front);
      const i = Math.min(1.2, (L.x1 - L.x0) * 0.2, (L.zf - L.zb) * 0.2), y = L.H, yk = L.H + rise;
      const xa = L.x0 - 0.3, xb = L.x1 + 0.3, za = L.zb - 0.3, zb = L.zf + 0.3;
      mb.poly([[xa, y, zb], [xb, y, zb], [xb - i, yk, zb - i], [xa + i, yk, zb - i]], roofM);
      mb.poly([[xb, y, za], [xa, y, za], [xa + i, yk, za + i], [xb - i, yk, za + i]], roofM);
      mb.poly([[xb, y, zb], [xb, y, za], [xb - i, yk, za + i], [xb - i, yk, zb - i]], roofM);
      mb.poly([[xa, y, za], [xa, y, zb], [xa + i, yk, zb - i], [xa + i, yk, za + i]], roofM);
      mb.flat(xa + i, xb - i, za + i, zb - i, yk, M('flatRoof', 4, 4));
      return yk;
    }
  }
}

/** Roof height along a gable-x profile at depth z (for dormers). */
function slopeY(L: Lay, rise: number, z: number) {
  const zc = (L.zb + L.zf) / 2, half = (L.zf - L.zb) / 2;
  return L.H + rise * (1 - Math.min(1, Math.abs(z - zc) / half));
}

function dormers(g: GenCtx, L: Lay, rise: number, n: number, roofM: Mat, wall: Mat, tile = 'winHouse', back = false) {
  const { mb } = g;
  const zc = (L.zb + L.zf) / 2;
  const zFace = back ? L.zb + 0.9 : L.zf - 0.9;
  const yb = slopeY(L, rise, zFace);
  const w = Math.min(2.2, ((L.x1 - L.x0) / n) * 0.7);
  for (let i = 0; i < n; i++) {
    const x = L.x0 + ((i + 0.5) * (L.x1 - L.x0)) / n;
    const h = Math.min(1.7, L.H + rise - yb - 0.2);
    if (h < 0.8) return;
    if (!back) {
      mb.box(x - w / 2, x + w / 2, yb - 0.3, yb + h, zc, zFace, { f: wall, l: wall, r: wall, top: null, b: null });
      mb.gable(x - w / 2, x + w / 2, zc, zFace, yb + h, 0.7, 'z', roofM, wall, 0.15, 0.1);
      mb.decal('+z', x, yb + 0.1, zFace, w * 0.55, h - 0.3, win(g, tile, 0.5));
    } else {
      mb.box(x - w / 2, x + w / 2, yb - 0.3, yb + h, zFace, zc, { b: wall, l: wall, r: wall, top: null, f: null });
      mb.gable(x - w / 2, x + w / 2, zFace, zc, yb + h, 0.7, 'z', roofM, wall, 0.15, 0.1);
      mb.decal('-z', x, yb + 0.1, zFace, w * 0.55, h - 0.3, win(g, tile, 0.5));
    }
  }
}

function chimney(g: GenCtx, x: number, z: number, top: number, mat: Mat, smoke = 0.3) {
  g.mb.boxC(x, z, 0.9, 0.9, 0, top, { side: mat });
  g.mb.boxC(x, z, 1.05, 1.05, top, 0.2, M('plain', 2, 2, 0x5a5550));
  if (g.rng.chance(smoke)) g.em.push({ kind: 'chimney', pos: [x, top + 0.4, z] });
}

type PorchKind = 'stoop' | 'full' | 'posts' | 'columns' | 'deck' | 'portico';
/** Something to stand on at the front door, with its own little roof. */
function porch(g: GenCtx, L: Lay, kind: PorchKind, doorX: number, o: { roof?: Mat; post?: Mat; floor?: Mat; h?: number; y?: number } = {}) {
  const { mb } = g;
  const d = L.porch;
  const floor = o.floor ?? M('deck', 4, 4, 0xb0a090);
  const post = o.post ?? M('plain', 2, 2, 0xf2f0ea);
  const roofM = o.roof ?? M('shingles', 4, 4, rgb(g.rng.pick(PAL.roof)));
  const y = o.y ?? 0.35, h = o.h ?? 2.7;
  if (kind === 'stoop' || d < 1) {
    porchSteps(g, doorX, L.zf, 1.6, 0.3);
    return;
  }
  const x0 = kind === 'portico' ? doorX - 1.6 : L.x0, x1 = kind === 'portico' ? doorX + 1.6 : L.x1;
  mb.box(x0, x1, 0, y, L.zf, L.zf + d, { side: M('concretePad', 4, 4), top: floor, b: null });
  porchSteps(g, doorX, L.zf + d, 1.6, y);
  const n = Math.max(2, Math.round((x1 - x0) / 2.8));
  for (let i = 0; i <= n; i++) {
    const x = x0 + 0.25 + ((x1 - x0 - 0.5) * i) / n;
    if (kind === 'columns' || kind === 'portico') mb.cyl(x, L.zf + d - 0.3, 0.2, y, y + h + 0.3, 8, post);
    else mb.boxC(x, L.zf + d - 0.2, 0.2, 0.2, y, h, { side: post, top: null });
  }
  if (kind === 'portico') {
    mb.gable(x0 - 0.2, x1 + 0.2, L.zf, L.zf + d + 0.2, y + h + 0.3, 1.2, 'z', roofM, post, 0.15);
  } else if (kind !== 'deck') mb.shed(x0, x1, L.zf, L.zf + d, y + h, 0.5, roofM, null, 0.25);
  else {
    // a railing instead of a roof
    mb.box(x0, x1, y, y + 1, L.zf + d - 0.05, L.zf + d, { f: M('fence', 4, 1, 0xd8d0c0), b: M('fence', 4, 1, 0xd8d0c0), l: null, r: null, top: null });
  }
}

type GarageKind = 'none' | 'front' | 'flush' | 'carport' | 'detached';
/**
 * A garage: beside the house ('front' pokes toward the street, 'carport',
 * 'detached' sits back), or 'flush' inside the front of the house. Beside
 * needs room on the lot; without it a garage goes flush (or not at all).
 */
function garage(g: GenCtx, L: Lay, kind: GarageKind, side: -1 | 1, wall: Mat, roofM: Mat, cars = 2): { gx: number; gw: number; ga: number; gb: number; gz: number } | null {
  const { mb, W, D } = g;
  if (kind === 'none') return null;
  let ga: number, gb: number, gz = L.zf, zBack = L.zf - Math.min(6.5, L.zf - L.zb);
  if (kind !== 'flush') {
    const room = (s: number) => (s < 0 ? L.x0 - (-W / 2 + 0.4) : W / 2 - 0.4 - L.x1);
    if (room(side) < 2.9 && room(-side) > room(side)) side = -side as -1 | 1;
    const r = room(side);
    if (r < 2.9) {
      if (kind === 'detached' || L.x1 - L.x0 < 7) return null;
      kind = 'flush';
    } else {
      const w = Math.min(cars * 3.1, r);
      ga = side < 0 ? L.x0 - w : L.x1;
      gb = side < 0 ? L.x0 : L.x1 + w;
      if (kind === 'front') gz = Math.min(D / 2 - 3, L.zf + 1.6 + L.porch * 0.5);
      if (kind === 'detached') { zBack = Math.max(-D / 2 + 0.6, L.zb - 1.5); gz = zBack + 6; }
    }
  }
  if (kind === 'flush') {
    const w = Math.min(cars * 3.1, L.x1 - L.x0 - 3);
    if (w < 2.8) return null;
    ga = side < 0 ? L.x0 : L.x1 - w;
    gb = side < 0 ? L.x0 + w : L.x1;
  }
  ga = ga!; gb = gb!;
  const gx = (ga + gb) / 2, w = gb - ga;
  if (kind === 'carport') {
    for (const px of [ga + 0.2, gb - 0.2]) for (const pz of [zBack + 0.5, gz - 0.3]) mb.boxC(px, pz, 0.15, 0.15, 0, 2.5, { side: M('metal', 2, 2), top: null });
    mb.shed(ga, gb, zBack, gz, 2.5, 0.3, M('metalRoof', 4, 4, 0xa8a8a2), null, 0.2);
  } else if (kind !== 'flush') {
    mb.box(ga, gb, 0, 2.8, zBack, gz, { side: wall, top: null, b: kind === 'detached' ? wall : null });
    mb.gable(ga, gb, zBack, gz, 2.8, 1.4, kind === 'front' ? 'z' : 'x', roofM, wall, 0.35);
  }
  const bays = w > 5.5 ? 2 : 1;
  if (kind !== 'carport') for (let i = 0; i < bays; i++) mb.decal('+z', ga + ((i + 0.5) * w) / bays, 0, gz, w / bays - 0.6, 2.2, S(w / bays > 4.5 ? 'garage2' : 'garage1'), 0.08);
  opening(g, ga, gb, 0, 2.3, gz);
  occupy(g, ga - 0.2, gb + 0.2, zBack, gz);
  return { gx, gw: w, ga, gb, gz };
}

/** Driveway to the street from z, and what's parked on it (sometimes it's a boat). */
function drive(g: GenCtx, x: number, w: number, zFrom: number, mat: Mat = mats.concrete(), kinds: CarKind[] = ['suv', 'pickup', 'sedan', 'van']) {
  const { D, rng } = g;
  const x0 = x - w / 2, x1 = x + w / 2, z1 = D / 2;
  patch(g, x0, x1, zFrom, z1, mat, 0.1);
  const room = z1 - zFrom;
  let done = room >= 3 && rng.chance(0.4) && decorate(g, 'driveway', { x0: x0 - 0.2, x1: x1 + 0.2, z0: zFrom + 0.2, z1: z1 - 0.2 }, 1) > 0;
  if (!done && room >= 5.2 && rng.chance(0.75)) car(g, x, z1 - 2.9, Math.PI, rng.pick(kinds));
  occupy(g, x0, x1, zFrom, z1);
}

/** A walk from the door to the sidewalk. */
function walk(g: GenCtx, x: number, zFrom: number, w = 1.2) {
  patch(g, x - w / 2, x + w / 2, zFrom, g.D / 2, mats.concrete(), 0.1);
  occupy(g, x - w / 2, x + w / 2, zFrom, g.D / 2);
}

/** Find a free spot for something of radius r in an area (and take it). */
function spot(g: GenCtx, a: Area, r: number): [number, number] | null {
  for (let t = 0; t < 10; t++) {
    const x = a.x0 + r + g.rng.float() * Math.max(0, a.x1 - a.x0 - 2 * r);
    const z = a.z0 + r + g.rng.float() * Math.max(0, a.z1 - a.z0 - 2 * r);
    const box = { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
    if (box.x1 > a.x1 + 0.01 || box.z1 > a.z1 + 0.01) continue;
    if (!isFree(g, box)) continue;
    occupy(g, box.x0, box.x1, box.z0, box.z1);
    return [x, z];
  }
  return null;
}

export type Vibe = 'junk' | 'plain' | 'hoa' | 'rich';
/**
 * Everything around the house: the satire (front and back), trees that fit
 * between it, shrubs along the front, the mailbox, fences, a flag.
 */
export function yardLife(g: GenCtx, L: Lay, vibe: Vibe, o: { fence?: boolean; trees?: number; shrubs?: boolean; frontN?: number; backN?: number } = {}) {
  const { W, D, rng } = g;
  occupy(g, L.x0 - 0.3, L.x1 + 0.3, L.zb - 0.3, L.zf + L.porch + 0.2);
  const front: Area = { x0: -W / 2 + 0.3, x1: W / 2 - 0.3, z0: L.zf + L.porch + 0.3, z1: D / 2 - 0.5 };
  const back: Area = { x0: -W / 2 + 0.5, x1: W / 2 - 0.5, z0: -D / 2 + 0.5, z1: L.zb - 0.5 };
  const lvl = g.spec.level;
  mailbox(g, W / 2 - 0.7, D / 2 - 0.6);
  occupy(g, W / 2 - 1.0, W / 2 - 0.4, D / 2 - 0.9, D / 2 - 0.3);
  // the satire: two to five things a lot, loudest out front
  const fN = o.frontN ?? (vibe === 'junk' ? rng.int(2, 4) : vibe === 'hoa' ? rng.int(1, 3) : rng.int(2, 3));
  const bN = o.backN ?? rng.int(2, vibe === 'junk' ? 4 : 3);
  // the curb strip first (bandit signs, bulk trash day, the little library), then the yards
  decorate(g, 'curb', { x0: -W / 2 + 0.3, x1: W / 2 - 1.2, z0: D / 2 - 1.5, z1: D / 2 - 0.15 }, rng.int(0, vibe === 'junk' ? 2 : 1));
  decorate(g, 'frontYard', front, fN);
  decorate(g, 'backYard', back, bN);
  // shrubs across the front of the house, trees wherever there's room
  if (o.shrubs !== false && vibe !== 'junk') for (let x = L.x0 + 0.6; x < L.x1 - 0.4; x += 1.3) {
    const b = { x0: x - 0.5, x1: x + 0.5, z0: L.zf + L.porch + 0.1, z1: L.zf + L.porch + 1.1 };
    if (isFree(g, b)) shrub(g, x, L.zf + L.porch + 0.6, 0.6 + rng.float() * 0.3);
  }
  const nt = o.trees ?? (vibe === 'hoa' ? 1 : rng.int(1, 3));
  for (let i = 0; i < nt; i++) {
    const s = i === 0 ? spot(g, back, 1.6) : spot(g, rng.chance(0.5) ? front : back, 1.4);
    if (s) tree(g, s[0], s[1], 0.5 + rng.float() * 0.45, vibe === 'hoa' ? 'sad' : rng.chance(0.25) ? 'cone' : 'round');
  }
  if (o.fence ?? (D >= 16 && vibe !== 'junk')) {
    const zf = L.zb - 0.4;
    const t = vibe === 'rich' ? 'fence' : rng.pick(['fence', 'fence', 'chainlink']);
    fence(g, -W / 2 + 0.2, zf, -W / 2 + 0.2, -D / 2 + 0.2, 1.8, t);
    fence(g, W / 2 - 0.2, -D / 2 + 0.2, W / 2 - 0.2, zf, 1.8, t);
    fence(g, -W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, -D / 2 + 0.2, 1.8, t);
  }
  if (lvl >= 2 && W >= 10 && rng.chance(0.45)) {
    const b = { x0: -W / 2 + 0.4, x1: -W / 2 + 1.0, z0: D / 2 - 1.0, z1: D / 2 - 0.4 };
    if (isFree(g, b)) flagpole(g, -W / 2 + 0.7, D / 2 - 0.7, 6.5 + lvl * 0.6, 1.9 + lvl * 0.3);
  }
}

// ------------------------------------------------------------------ the catalog
export interface HouseStyle {
  id: string;
  lv: [number, number];
  minW?: number;
  minD?: number;
  weight?: number;
  build(g: GenCtx): string;
}
export const STYLES: HouseStyle[] = [];
const style = (s: HouseStyle) => STYLES.push(s);
const pickName = (g: GenCtx, names: string[]) => g.rng.pick(names);
const wallOf = (g: GenCtx, tile: string, cols: number[], tw = 4, th = 4) => M(tile, tw, th, rgb(g.rng.pick(cols)));

// ---- L1: the bottom of the ladder --------------------------------------------------
style({ id: 'skoolie', lv: [1, 2], minW: 14, minD: 14, build(g) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawnDry', 8, 8));
  const L = site(g, 2.6, 11, 2.4);
  const cx = (L.x0 + L.x1) / 2, z0 = L.zb, z1 = L.zb + 11;
  const paint = rng.pick([0xf2c230, 0x6ac0a0, 0xd08aff, 0x8ecfc9, 0xff9a5a]);
  mb.box(cx - 1.25, cx + 1.25, 0.5, 3.1, z0, z1, { side: M('plain', 2, 2, paint), top: M('plain', 2, 2, 0xe8e8e8) });
  for (let i = 0; i < 7; i++) { const z = z0 + 1 + i * 1.3; for (const s of ['+x', '-x'] as const) mb.decal(s, z, 1.8, s === '+x' ? cx + 1.25 : cx - 1.25, 1.0, 0.8, win(g, 'winTrailer', 0.5)); }
  mb.decal('+z', cx, 1.6, z1, 2.0, 1.0, M('carWin', 2, 1));
  for (const z of [z0 + 2, z1 - 2]) for (const dx of [-1.1, 1.1]) mb.push().translate(cx + dx, 0.5, z).rotZ(Math.PI / 2), mb.cyl(0, 0, 0.5, -0.2, 0.2, 8, M('plain', 2, 2, 0x1b1b1c)), mb.pop();
  // the porch built off the side door: pallets and a tarp
  mb.box(cx + 1.25, cx + 4, 0, 0.4, z0 + 3, z0 + 7, { side: M('wood', 2, 2, 0xc8a070), top: M('deck', 3, 3, 0xb89a70) });
  mb.poly([[cx + 1.25, 2.9, z0 + 7], [cx + 4.4, 2.3, z0 + 7], [cx + 4.4, 2.3, z0 + 3], [cx + 1.25, 2.9, z0 + 3]], M('plain', 2, 2, rng.pick([0x2a6fb0, 0x6a8a3a, 0x8a8a8a])));
  mb.poly([[cx + 4.4, 2.3, z0 + 3], [cx + 4.4, 2.3, z0 + 7], [cx + 1.25, 2.9, z0 + 7], [cx + 1.25, 2.9, z0 + 3]], M('plain', 2, 2, 0x4a4a4a));
  for (const z of [z0 + 3.2, z0 + 6.8]) mb.boxC(cx + 4.2, z, 0.1, 0.1, 0, 2.3, { side: M('wood', 2, 2), top: null });
  mb.box(cx - 1.2, cx + 1.2, 3.1, 3.2, z0 + 1, z0 + 6, M('solar', 1, 1.6));
  emit(g, 'smoke', cx - 0.8, 3.8, z0 + 8.5);
  const Lb: Lay = { x0: cx - 1.3, x1: cx + 4.4, zb: z0, zf: z1, H: 3, porch: 0 };
  if (W >= 12) car(g, clamp(cx - 4, -W / 2 + 1.5, W / 2 - 1.5), D / 2 - 3.2, Math.PI, 'junk');
  yardLife(g, Lb, 'junk', { fence: false });
  return pickName(g, ['Converted School Bus ("Skoolie")', 'Skoolie (Van Life, But Bigger)', 'The Magic School Bus (Repossessed)']);
} });

style({ id: 'rvPorch', lv: [1, 2], minD: 14, build(g) {
  const { mb, rng, W } = g;
  lotPad(g, M('dirt', 8, 8));
  const L = site(g, 2.6, 9.5, 2.2);
  const cx = (L.x0 + L.x1) / 2, z0 = L.zb, z1 = L.zb + 9.5;
  mb.box(cx - 1.25, cx + 1.25, 0.6, 3.5, z0, z1, { side: M('trailer', 3.2, 2.6, 0xf2efe4), top: M('plain', 2, 2, 0xdedad0) });
  mb.box(cx - 1.26, cx + 1.26, 1.6, 2.0, z0, z1, M('plain', 2, 2, rng.pick([0x2a6fb0, 0xb3151d, 0x6a4a2a, 0x3a7a3a])));
  mb.decal('+z', cx, 1.5, z1, 2.1, 1.1, M('carWin', 2, 1));
  mb.box(cx - 1.2, cx + 1.2, 0, 0.6, z0, z1, { side: M('lattice', 4, 0.8), top: null });
  // the stick-built room off the side, which is now most of the house
  const aw = Math.min(5, W / 2 - cx - 1.6);
  if (aw > 2.5) {
    const La: Lay = { x0: cx + 1.25, x1: cx + 1.25 + aw, zb: z0 + 1, zf: z0 + 7, H: 2.6, porch: 0 };
    body(g, La, M('wood', 3, 3, rng.pick([0xc8b89a, 0x9aa08a, 0xd8ccb8])));
    g.mb.shed(La.x0, La.x1, La.zb, La.zf, La.H, 0.6, M('corrugated', 4, 4, 0xa8aaa8), null, 0.2);
    mb.decal('+z', La.x0 + aw / 2, 0, La.zf, 0.9, 2, S('doorTrailer'));
    mb.decal('+x', (La.zb + La.zf) / 2, 1.2, La.x1, 1.2, 0.9, win(g, 'winTrailer'));
  }
  const Lb: Lay = { x0: cx - 1.3, x1: cx + 1.3 + Math.max(0, aw), zb: z0, zf: z1, H: 3.5, porch: 0 };
  yardLife(g, Lb, 'junk', { fence: false });
  return pickName(g, ['RV (Permanently Temporary)', 'RV + Addition + Addition', 'Winnebago, Stick-Built Wing']);
} });

style({ id: 'tinyHouse', lv: [1, 3], minD: 8, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 2.6, 7.2, 1.2);
  L.H = 2.9;
  const wall = wallOf(g, 'wood', [0x9aa08a, 0x6a8a9a, 0xc8a070, 0x3a4a3a]);
  const roofM = M('metalRoof', 3, 3, rgb(rng.pick(PAL.metalRoof)));
  mb.box(L.x0 + 0.2, L.x1 - 0.2, 0, 0.7, L.zb + 0.4, L.zf - 0.4, M('plain', 2, 2, 0x2a2a2a)); // the trailer it's still on
  L.H = 3.5;
  extrude(g, L.x0, L.x1, P.gable(L.zb, L.zf, L.H, 1.1).map(([z, y]) => [z, y === 0 ? 0.7 : y] as Z), wall, roofM, wall);
  door(g, (L.x0 + L.x1) / 2, L.zf, 0.7, 'doorGlass', 0.6, 0.9, 2.0);
  windows(g, L, 'winModern', { y0: 1.8, w: 0.9, h: 1.0, front: false });
  mb.decal('+z', (L.x0 + L.x1) / 2, 3.6, L.zf, 0.9, 0.7, win(g, 'winModern'));
  porchSteps(g, (L.x0 + L.x1) / 2, L.zf, 1.2, 0.7, M('wood', 2, 2, 0xa07a50));
  yardLife(g, L, g.spec.level >= 3 ? 'plain' : 'junk', { fence: false, trees: 2 });
  return pickName(g, ['Tiny House (400 sq ft of Freedom)', 'Tiny House on Wheels (Wheels Seized)', 'Tiny House (Composting Toilet Edition)']);
} });

style({ id: 'container', lv: [1, 3], minD: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('gravel', 6, 6, 0xd0c8b8));
  const L = site(g, 7.4, 6.2, 1.6);
  L.H = 2.6;
  const cols = [0xb3151d, 0x1d3a8a, 0x2a6a3a, 0xff7a1a, 0x8a8e92, 0xd8c040];
  const two = rng.chance(0.55);
  for (let k = 0; k < (two ? 2 : 1); k++) {
    const y = k * 2.6, dz = k ? 1.2 : 0;
    const zb2 = L.zb + (k ? dz : 0), zf2 = k ? L.zb + dz + 2.44 : L.zb + 2.44;
    mb.box(L.x0, L.x1, y, y + 2.6, zb2, zf2, M('corrugated', 2, 2, rgb(rng.pick(cols))));
    if (!k) mb.box(L.x0, L.x1, 0, 2.6, L.zf - 2.44, L.zf, M('corrugated', 2, 2, rgb(rng.pick(cols))));
  }
  mb.decal('+z', (L.x0 + L.x1) / 2, 0.3, L.zf, 4.5, 2.1, win(g, 'winModern', 0.5));
  if (two) mb.decal('+z', (L.x0 + L.x1) / 2, 2.9, L.zb + 3.64, 4, 1.8, win(g, 'winModern', 0.5));
  door(g, L.x1 - 1, L.zf, 0, 'doorMetal', 0);
  porch(g, L, 'deck', L.x1 - 1);
  const Lb: Lay = { ...L, H: two ? 5.2 : 2.6 };
  yardLife(g, Lb, 'plain', { fence: false });
  return pickName(g, ['Shipping Container Home (Architecturally Significant)', 'Container Living Concept', 'Two Containers & A Dream']);
} });

style({ id: 'quonset', lv: [1, 2], minD: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('dirt', 8, 8));
  const L = site(g, 10, 7, 0.6);
  const prof = quonsetProf(L.zb, L.zf);
  // the arch runs across the lot; its end faces the street
  mb.push().translate((L.x0 + L.x1) / 2, 0, (L.zb + L.zf) / 2).rotY(Math.PI / 2).translate(-(L.x0 + L.x1) / 2, 0, -(L.zb + L.zf) / 2);
  const cx = (L.x0 + L.x1) / 2, hz = (L.zf - L.zb) / 2;
  extrude(g, cx - (L.x1 - L.x0) / 2, cx + (L.x1 - L.x0) / 2, prof, null, M(rng.chance(0.5) ? 'corrugatedRust' : 'corrugated', 3, 3), M('plain', 2, 2, 0x8a8a84), 0.05);
  mb.pop();
  mb.decal('+z', cx, 0, L.zf + (L.x1 - L.x0) / 2 - hz, 1.0, 2.0, S('doorMetal'));
  mb.decal('+z', cx + 1.6, 1.2, L.zf + (L.x1 - L.x0) / 2 - hz, 1.3, 0.8, win(g, 'winTrailer'));
  const Lb: Lay = { x0: cx - hz, x1: cx + hz, zb: (L.zb + L.zf) / 2 - (L.x1 - L.x0) / 2, zf: (L.zb + L.zf) / 2 + (L.x1 - L.x0) / 2, H: hz, porch: 0.6 };
  yardLife(g, Lb, 'junk', { fence: false });
  return pickName(g, ['Quonset Hut, Mostly Rust', 'Army Surplus Quonset (Cozy)', 'Metal Arch Home (Echoes)']);
} });

style({ id: 'shotgun', lv: [1, 3], minD: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 4.4, 11, 2);
  L.H = 3.4;
  const wall = wallOf(g, 'siding', rng.chance(0.5) ? PAL.painted : PAL.siding);
  const roofM = M('metalRoof', 3, 3, rgb(rng.pick(PAL.metalRoof)));
  house(g, L, wall, roofM, 'gableZ', 1.6, { ov: 0.3 });
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx + 0.9, L.zf, 0.5, 'doorFront', 0.6);
  mb.decal('+z', cx - 0.9, 1.1, L.zf, 1.0, 2.0, win(g, 'winTall', 0.5));
  porch(g, L, 'posts', cx + 0.9, { roof: roofM, y: 0.5 });
  windows(g, L, 'winHouse', { front: false, back: false });
  const Lb = { ...L };
  yardLife(g, Lb, rng.chance(0.5) ? 'junk' : 'plain', { fence: false, trees: 1 });
  return pickName(g, ['Shotgun House', 'Shotgun House (Actual Shotgun Included)', 'Camelback Shotgun']);
} });

style({ id: 'deerCamp', lv: [1, 1], minD: 8, build(g) {
  const { mb, rng, W } = g;
  lotPad(g, M('dirt', 8, 8));
  const L = site(g, 5.4, 5, 1.8);
  L.H = 2.5;
  const wall = M('wood', 3, 3, 0x7a5a3a);
  house(g, L, wall, M('corrugatedRust', 3, 3), 'shed', 0.8);
  mb.decal('+z', (L.x0 + L.x1) / 2 - 1, 0, L.zf, 0.9, 2, S('doorFront', 0x7a6a58));
  mb.decal('+z', (L.x0 + L.x1) / 2 + 1.2, 1.1, L.zf, 0.9, 0.9, rng.chance(0.5) ? S('winBoard') : win(g, 'winHouse', 0.4));
  // blue tarp lean-to
  if (L.x1 + 3 < W / 2) {
    const tarp = M('plain', 2, 2, 0x2a6fb0);
    mb.poly([[L.x1, 2.4, L.zf], [L.x1 + 3, 1.2, L.zf], [L.x1 + 3, 1.2, L.zb], [L.x1, 2.4, L.zb]], tarp);
    mb.poly([[L.x1 + 3, 1.2, L.zb], [L.x1 + 3, 1.2, L.zf], [L.x1, 2.4, L.zf], [L.x1, 2.4, L.zb]], tarp);
    for (const z of [L.zb + 0.2, L.zf - 0.2]) mb.boxC(L.x1 + 2.9, z, 0.1, 0.1, 0, 1.2, { side: M('wood', 2, 2), top: null });
  }
  mb.cyl(L.x0 + 1, L.zb + 1, 0.15, 3, 4.6, 6, M('plain', 2, 2, 0x333333));
  g.em.push({ kind: 'chimney', pos: [L.x0 + 1, 4.8, L.zb + 1] });
  burnBarrel(g, L.x0 - 1.2, L.zf + 1.5);
  yardLife(g, L, 'junk', { fence: false, trees: 2 });
  return pickName(g, ['Deer Camp (Year-Round)', 'Hunting Shack (Opening Day Every Day)', 'Holler Lean-To w/ Tarp']);
} });

// ---- L2: working class ------------------------------------------------------------
style({ id: 'splitLevel', lv: [2, 3], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 13, 8, 0.4);
  const brick = M(rng.pick(['brickTan', 'brick']), 2, 2);
  const wall = wallOf(g, 'siding', [0xc4b19a, 0x9fb0a0, 0xd9c3b0, 0xa9b8c7, 0xe6d8a8]);
  const roofM = M('shingles', 4, 4, rgb(rng.pick(PAL.roof)));
  const left = rng.chance(0.5);
  const xm = left ? L.x0 + (L.x1 - L.x0) * 0.45 : L.x0 + (L.x1 - L.x0) * 0.55;
  const low: Lay = { ...L, x0: left ? L.x0 : xm, x1: left ? xm : L.x1, H: 2.6 };
  const high: Lay = { ...L, x0: left ? xm : L.x0, x1: left ? L.x1 : xm, H: 4.6 };
  body(g, low, wall, brick);
  mb.gable(low.x0, low.x1, low.zb, low.zf, low.H, 1.3, 'x', roofM, wall, 0.5);
  mb.box(high.x0, high.x1, 0, 1.6, high.zb, high.zf, { side: brick, top: null });
  mb.box(high.x0, high.x1, 1.6, high.H, high.zb, high.zf, { side: wall, top: null });
  mb.gable(high.x0, high.x1, high.zb, high.zf, high.H, 1.3, 'x', roofM, wall, 0.5);
  mb.decal('+z', (high.x0 + high.x1) / 2, 0, high.zf, Math.min(5, high.x1 - high.x0 - 1), 2.1, S('garage2'));
  mb.decal('+z', (high.x0 + high.x1) / 2, 2.6, high.zf, 2.6, 1.3, win(g, 'winPicture'));
  const dx = (low.x0 + low.x1) / 2;
  door(g, dx - 1, low.zf, 0.3, rng.pick(['doorFront', 'doorBlue']), 0.7);
  mb.decal('+z', dx + 1.4, 0.9, low.zf, 2.2, 1.3, win(g, 'winPicture'));
  porchSteps(g, dx - 1, low.zf, 1.4, 0.3);
  windows(g, low, 'winHouse', { front: false });
  windows(g, high, 'winHouse', { front: false, y0: 2.4 });
  drive(g, (high.x0 + high.x1) / 2, 5, high.zf);
  walk(g, dx - 1, low.zf + 0.9);
  yardLife(g, L, 'plain');
  return pickName(g, ['Split-Level (1974)', 'Tri-Level Ranch', 'Split-Level (Shag Carpet Still Inside)']);
} });

style({ id: 'capeCod', lv: [2, 4], build(g) {
  const { mb, rng, W } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, W >= 14 ? 10 : 7, 7, 1.2);
  L.H = 2.8;
  const wall = wallOf(g, rng.chance(0.4) ? 'sidingV' : 'siding', [0xf2f0ea, 0xe8e2d0, 0xb7c1c9, 0xd9c3b0, 0x9fb0a0]);
  const roofM = M('shingles', 4, 4, rgb(rng.pick(PAL.roof)));
  const rise = 3.4;
  extrude(g, L.x0, L.x1, P.gable(L.zb, L.zf, L.H, rise), wall, roofM, wall, 0.3);
  const gr = W >= 14 ? garage(g, L, rng.chance(0.5) ? 'detached' : 'carport', rng.chance(0.5) ? -1 : 1, wall, roofM, 1) : null;
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0.25, rng.pick(['doorBlue', 'doorBlack', 'doorFront']), 0.8);
  row(g, '+z', L.x0 + 0.3, L.x1 - 0.3, L.zf, 0.9, 4, 'winShutter', 1.2, 1.3, [[cx - 0.8, cx + 0.8]]);
  dormers(g, L, rise, W >= 14 ? 3 : 2, roofM, wall);
  windows(g, L, 'winHouse', { front: false, back: false });
  mb.decal('-z', cx, 0.9, L.zb, 2.2, 1.3, win(g, 'winPicture'));
  chimney(g, L.x0 + 0.6, (L.zb + L.zf) / 2, L.H + rise + 0.8, M('brick', 2, 2));
  porch(g, L, 'stoop', cx);
  walk(g, cx, L.zf + 0.9);
  if (gr) drive(g, gr.gx, 3.2, gr.gz);
  yardLife(g, L, g.spec.level >= 4 ? 'hoa' : 'plain');
  return pickName(g, ['Cape Cod (Nowhere Near a Cape)', 'Cape Cod', 'Cape Cod w/ Dormers']);
} });

style({ id: 'craftsman', lv: [2, 4], build(g) {
  const { mb, rng, W } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, W >= 14 ? 10.5 : 7, 8, 2.4);
  L.H = 3.0;
  const wall = wallOf(g, 'siding', [0x5a6a4a, 0x8a6a4a, 0x6a7a8a, 0xb89a6a, 0x4a5a5a, 0xa08a6a]);
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x8a7a6a, 0x7a6a5a, 0x9a8a7a])));
  house(g, L, wall, roofM, 'gableZ', 2.0, { ov: 0.7 });
  const gr = W >= 14 ? garage(g, L, 'detached', rng.chance(0.5) ? -1 : 1, wall, roofM, 1) : null;
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx - 0.8, L.zf, 0.45, 'doorGlass', 0.7);
  mb.decal('+z', cx + 1.4, 0.9, L.zf, 2.4, 1.4, win(g, 'winPicture'));
  mb.decal('+z', cx, 3.4, L.zf, 1.6, 0.9, win(g, 'winHouse'));
  // the tapered stone-base porch posts
  const d = L.porch, y = 0.45;
  mb.box(L.x0, L.x1, 0, y, L.zf, L.zf + d, { side: M('stone', 2, 2), top: M('deck', 4, 4, 0x8a6a4a), b: null });
  for (const x of [L.x0 + 0.4, L.x1 - 0.4]) {
    mb.boxC(x, L.zf + d - 0.4, 0.7, 0.7, y, 1.0, M('stone', 2, 2));
    mb.boxC(x, L.zf + d - 0.4, 0.34, 0.34, y + 1.0, 1.6, { side: M('plain', 2, 2, 0xf2f0ea), top: null });
  }
  mb.gable(L.x0 - 0.1, L.x1 + 0.1, L.zf - 0.2, L.zf + d + 0.1, y + 2.6, 1.1, 'z', roofM, wall, 0.5);
  porchSteps(g, cx - 0.8, L.zf + d, 1.6, y);
  windows(g, L, 'winHouse', { front: false });
  if (gr) drive(g, gr.gx, 3, gr.gz, M('gravel', 4, 4, 0xd8d0c0));
  walk(g, cx - 0.8, L.zf + d + 0.9);
  yardLife(g, L, 'plain');
  return pickName(g, ['Craftsman Bungalow', 'Craftsman (Sears Kit, 1924)', 'Bungalow (Original Details Ripped Out)']);
} });

style({ id: 'aframe', lv: [2, 4], build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 7, 9, 2.4);
  const rise = Math.min(9, (L.x1 - L.x0) * 1.2);
  const roofM = M(rng.chance(0.5) ? 'shingles' : 'metalRoof', 4, 4, rgb(rng.pick([0x5a3a2a, 0x2a2a2c, 0x7a1d1d, 0x3a4a3a])));
  const wood = M('wood', 3, 3, rgb(rng.pick([0xc8a070, 0x9a7a50, 0xb08a5a])));
  // ridge runs toward the street: the triangle faces it
  const cx = (L.x0 + L.x1) / 2, hw = (L.x1 - L.x0) / 2;
  mb.push().translate(cx, 0, (L.zb + L.zf) / 2).rotY(Math.PI / 2).translate(-cx, 0, -(L.zb + L.zf) / 2);
  const zc = (L.zb + L.zf) / 2;
  extrude(g, cx - (L.zf - L.zb) / 2, cx + (L.zf - L.zb) / 2, P.aframe(zc - hw, zc + hw, 0, rise), null, roofM, wood, 0.4);
  mb.pop();
  // the glass wall on the triangle
  mb.poly([[cx - hw * 0.7, 0.4, L.zf + 0.05], [cx + hw * 0.7, 0.4, L.zf + 0.05], [cx, rise * 0.7, L.zf + 0.05]], M('glassPlain', 1.5, 1.5));
  door(g, cx, L.zf + 0.08, 0.4, 'doorGlass', 0);
  porch(g, L, 'deck', cx);
  const Lb: Lay = { ...L, H: rise };
  yardLife(g, Lb, 'plain', { fence: false, trees: 3 });
  return pickName(g, ['A-Frame Chalet', 'A-Frame (Airbnb, $389/Night)', 'Ski Chalet (No Mountain)']);
} });

style({ id: 'logCabin', lv: [2, 4], build(g) {
  const { mb, rng, W } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, W >= 14 ? 10 : 7, 7.5, 2.2);
  L.H = 2.9;
  const log = M('wood', 1.2, 0.35, rgb(rng.pick([0x8a5a32, 0x9a6a3a, 0x7a4a2a])));
  const roofM = M('metalRoof', 3, 3, rgb(rng.pick([0x2a4a3a, 0x7a1d1d, 0x2a2a2c])));
  extrude(g, L.x0, L.x1, P.gable(L.zb, L.zf, L.H, 2.2), log, roofM, log, 0.5);
  // log ends poking out at the corners
  for (const x of [L.x0, L.x1]) for (const z of [L.zb, L.zf]) for (let y = 0.2; y < L.H; y += 0.4) mb.push().translate(x, y, z).rotX(Math.PI / 2), mb.cyl(0, 0, 0.16, -0.3, 0.3, 6, M('wood', 1, 1, 0x6a4a2a)), mb.pop();
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0.45, 'doorFront', 0.8);
  row(g, '+z', L.x0 + 0.3, L.x1 - 0.3, L.zf, 1.0, 2, 'winHouse', 1.2, 1.3, [[cx - 0.8, cx + 0.8]]);
  porch(g, L, 'posts', cx, { roof: roofM, post: M('wood', 2, 2, 0x6a4a2a), y: 0.45 });
  windows(g, L, 'winHouse', { front: false });
  chimney(g, L.x1 - 0.2, (L.zb + L.zf) / 2, L.H + 3, M('stone', 2, 2), 0.6);
  yardLife(g, L, 'plain', { fence: false, trees: 3 });
  return pickName(g, ['Log Home Kit (Some Assembly Required)', 'Log Cabin (Satellite Dish Included)', 'Rustic Log Home']);
} });

style({ id: 'duplex', lv: [2, 3], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawnDry', 8, 8));
  const L = site(g, 14, 8, 1.2);
  const wall = wallOf(g, 'siding', PAL.beige);
  const brick = M('brickTan', 2, 2);
  const roofM = M('shingles', 4, 4, rgb(rng.pick(PAL.roof)));
  L.H = 2.8;
  house(g, L, wall, roofM, 'hip', 1.8, { front: brick });
  const cx = (L.x0 + L.x1) / 2;
  // mirror image: two doors, two picture windows, two sad lawn chairs
  for (const s of [-1, 1]) {
    door(g, cx + s * 1.2, L.zf, 0.25, rng.pick(['doorFront', 'doorBlue']), 0.6);
    mb.decal('+z', cx + s * 4.2, 0.9, L.zf, 2.4, 1.3, win(g, 'winPicture'));
    porchSteps(g, cx + s * 1.2, L.zf, 1.2, 0.25);
    walk(g, cx + s * 1.2, L.zf + 0.9, 1);
  }
  mb.boxC(cx, L.zf + 0.3, 0.1, 0.6, 0, 1.8, { side: M('fence', 1, 1), top: null }); // the privacy divider
  windows(g, L, 'winHouse', { front: false });
  acUnit(g, L.x0 + 1, L.zb - 0.7);
  acUnit(g, L.x1 - 1, L.zb - 0.7);
  yardLife(g, L, 'junk');
  return pickName(g, ['Duplex (Landlord Lives in Florida)', 'Duplex (Other Side Smokes)', 'Up-Down Duplex']);
} });

style({ id: 'dogtrot', lv: [2, 3], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 13, 6.5, 2.2);
  L.H = 2.8;
  const wood = M('wood', 3, 3, rgb(rng.pick([0xd8ccb8, 0xb8a888, 0x9aa08a])));
  const roofM = M('metalRoof', 3, 3, rgb(rng.pick(PAL.metalRoof)));
  const bw = (L.x1 - L.x0 - 3) / 2;
  for (const [a, b] of [[L.x0, L.x0 + bw], [L.x1 - bw, L.x1]]) {
    mb.box(a, b, 0.4, L.H, L.zb, L.zf, { side: wood, top: null });
    mb.decal('+z', (a + b) / 2, 1.2, L.zf, 1.1, 1.3, win(g, 'winHouse'));
  }
  mb.box(L.x0 + bw, L.x1 - bw, 0, 0.4, L.zb, L.zf, { side: wood, top: M('deck', 3, 3) }); // the breezeway
  extrude(g, L.x0, L.x1, P.gable(L.zb, L.zf, L.H, 1.9).map(([z, y]) => [z, y] as Z).slice(0), null, roofM, wood, 0.4);
  porch(g, L, 'posts', (L.x0 + L.x1) / 2, { roof: roofM, post: M('wood', 2, 2), y: 0.4 });
  for (const [x, z] of [[L.x0 + bw + 0.8, L.zf - 1.5], [L.x1 - bw - 0.8, L.zb + 1.5]]) g.mb.box(x - 0.3, x + 0.3, 0.4, 0.9, z - 0.3, z + 0.3, M('wood', 1, 1, 0x6a4a2a)); // rocking chairs, roughly
  yardLife(g, L, 'plain', { fence: false });
  return pickName(g, ['Dogtrot House (Dog Not Included)', 'Dogtrot (Breezeway, No A/C)', 'Dogtrot Cabin']);
} });

style({ id: 'shouse', lv: [2, 4], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('gravel', 6, 6, 0xd0c8b8));
  const L = site(g, 14, 9, 0.6);
  L.H = 4.6;
  const wall = M('metalPanel', 3, 3, rgb(rng.pick([0xe8e4dc, 0x9a8a78, 0x5a6a5a, 0x7a1d1d])));
  const roofM = M('metalRoof', 3, 3, rgb(rng.pick([0x2a2a2c, 0x7a1d1d, 0x3a4a3a])));
  extrude(g, L.x0, L.x1, P.gable(L.zb, L.zf, L.H, 1.4), wall, roofM, wall, 0.3);
  const gx = L.x0 + 3.5;
  mb.decal('+z', gx, 0, L.zf, 5.5, 3.8, S('rollup', 0xe8e4dc));
  door(g, L.x1 - 3, L.zf, 0.2, 'doorGlass', 0.8);
  row(g, '+z', L.x1 - 6, L.x1 - 0.5, L.zf, 1.0, 2, 'winModern', 1.3, 1.5, [[L.x1 - 3.6, L.x1 - 2.4]]);
  porch(g, { ...L, x0: L.x1 - 6, porch: 2 }, 'posts', L.x1 - 3, { roof: roofM, post: M('wood', 2, 2, 0x6a4a2a), y: 0.2 });
  windows(g, L, 'winModern', { front: false, y0: 1.2 });
  drive(g, gx, 5.5, L.zf, mats.gravel(), ['lifted', 'pickup']);
  yardLife(g, L, 'plain', { fence: false });
  return pickName(g, ['Shouse (Shop + House)', 'Pole Barn Home', 'Barndo Lite']);
} });

style({ id: 'foursquare', lv: [2, 4], build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 8, 8, 2.4);
  L.H = 6.2;
  const wall = wallOf(g, rng.chance(0.5) ? 'brick' : 'siding', rng.chance(0.5) ? PAL.siding : [0xffffff], 4, 4);
  const roofM = M('shingles', 4, 4, rgb(rng.pick(PAL.roof)));
  house(g, L, wall, roofM, 'pyramid', 2.4, { ov: 0.6 });
  const cx = (L.x0 + L.x1) / 2;
  dormers(g, { ...L, zb: L.zf - (L.x1 - L.x0), zf: L.zf }, 2.4, 1, roofM, wall);
  door(g, cx - 1.6, L.zf, 0.4, rng.pick(['doorFront', 'doorGlass']), 0.7);
  windows(g, L, 'winHouse', { floors: 2, skipFront: [[cx - 2.4, cx - 0.8]] });
  porch(g, L, 'columns', cx - 1.6, { y: 0.4 });
  walk(g, cx - 1.6, L.zf + L.porch + 0.9);
  yardLife(g, L, 'plain');
  return pickName(g, ['American Foursquare', 'Foursquare (Sears Catalog #117)', 'Four-Square (All Four Rooms Haunted)']);
} });

style({ id: 'doublewideAdd', lv: [1, 2], minW: 14, minD: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawnDry', 8, 8));
  const L = site(g, 14, 7.6, 0.6);
  L.H = 3.0;
  const col = rgb(rng.pick(PAL.trailer));
  mb.box(L.x0, L.x1, 0, 0.6, L.zb, L.zf, { side: M('lattice', 4, 0.8), top: null });
  mb.box(L.x0, L.x1, 0.6, L.H, L.zb, L.zf, { side: M('trailer', 4, 3, col), top: null });
  mb.gable(L.x0, L.x1, L.zb, L.zf, L.H, 0.6, 'x', M('metalRoof', 4, 4, 0xb8b8b2), M('trailer', 4, 3, col), 0.2, 0.1);
  row(g, '+z', L.x0 + 0.4, L.x1 - 0.4, L.zf, 1.5, 5, 'winTrailer', 1.3, 0.75, [[-1, 1]]);
  // the addition: different siding, different roof, different decade
  const ax0 = rng.chance(0.5) ? L.x0 + 1 : L.x1 - 5.5, ax1 = ax0 + 4.5;
  mb.box(ax0, ax1, 0, 2.7, L.zf, L.zf + 3.2, { side: M('siding', 4, 4, rgb(rng.pick(PAL.siding))), top: null, b: null });
  mb.shed(ax0, ax1, L.zf - 0.3, L.zf + 3.2, 2.7, 0.4, M('shingles', 4, 4, 0x8a8a84), null, 0.2);
  mb.decal('+z', (ax0 + ax1) / 2, 0, L.zf + 3.2, 0.9, 2, S('doorFront'));
  mb.decal('+z', ax0 + 0.8, 1, L.zf + 3.2, 1, 1, win(g, 'winHouse'));
  porchSteps(g, (ax0 + ax1) / 2, L.zf + 3.2, 1.4, 0.3, M('wood', 2, 2, 0x9a8a78));
  const Lb = { ...L, porch: 3.4 };
  if (rng.chance(0.6)) dish(g, L.x1 - 1, 3.4, L.zb + 1, 0.8);
  yardLife(g, Lb, 'junk', { fence: false });
  return pickName(g, ['Double-Wide + Addition', 'Double-Wide (Addition Pending Permit)', 'Double-Wide w/ Florida Room']);
} });

// ---- L3: the middle ---------------------------------------------------------------
style({ id: 'colonial', lv: [3, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 12, 8, 1.6);
  L.H = 5.8;
  const brickFront = rng.chance(0.4);
  const wall = wallOf(g, 'siding', [0xf2f0ea, 0xe8e2d0, 0xd8d2c4, 0xb7c1c9, 0xa9b8c7, 0x7a1d1d]);
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x5a5a5a, 0x6a625a, 0x4a4a4e])));
  house(g, L, wall, roofM, 'gable', 2.6, { front: brickFront ? M('brick', 2, 2) : wall });
  const gr = garage(g, L, 'flush', rng.chance(0.5) ? -1 : 1, wall, roofM, 1);
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0.3, 'doorBlack', 0.9, 1.1, 2.2);
  mb.decal('+z', cx, 2.6, L.zf + 0.02, 1.8, 0.5, S('winPalladian'));
  windows(g, L, 'winShutter', { floors: 2, fh: 2.9, w: 1.3, skipFront: [[cx - 0.9, cx + 0.9]] });
  porch(g, L, 'portico', cx);
  chimney(g, L.x0 + 0.4, (L.zb + L.zf) / 2, L.H + 3.2, M('brick', 2, 2));
  if (rng.chance(0.5)) chimney(g, L.x1 - 0.4, (L.zb + L.zf) / 2, L.H + 3.2, M('brick', 2, 2), 0);
  if (gr) drive(g, gr.gx, 5, L.zf);
  walk(g, cx, L.zf + L.porch + 0.9);
  yardLife(g, L, 'hoa');
  return pickName(g, ['Center-Hall Colonial', 'Colonial Revival (Vinyl)', 'Georgian Colonial (Est. 2004)']);
} });

style({ id: 'dutchColonial', lv: [3, 4], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 11, 8, 1.6);
  L.H = 3.0;
  const wall = wallOf(g, 'siding', [0xf2f0ea, 0xe6d8a8, 0xb7c1c9, 0xd9c3b0]);
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x5a5a5a, 0x7a6a5a])));
  extrude(g, L.x0, L.x1, P.gambrel(L.zb, L.zf, L.H, 4.4), wall, roofM, wall, 0.4);
  const gr = garage(g, L, 'carport', rng.chance(0.5) ? -1 : 1, wall, roofM, 1);
  const cx = (L.x0 + L.x1) / 2;
  // a long shed dormer across the gambrel
  const yb = L.H + 3.08, zfD = L.zf - 0.3;
  mb.box(L.x0 + 1, L.x1 - 1, L.H + 0.6, yb, (L.zb + L.zf) / 2, zfD, { f: wall, l: wall, r: wall, top: null, b: null });
  mb.shed(L.x0 + 1, L.x1 - 1, (L.zb + L.zf) / 2, zfD, yb, 0.6, roofM, null, 0.2);
  row(g, '+z', L.x0 + 1.2, L.x1 - 1.2, zfD, L.H + 1.1, 3, 'winHouse', 1.1, 1.2);
  door(g, cx, L.zf, 0.3, 'doorBlue', 0.8);
  row(g, '+z', L.x0 + 0.3, L.x1 - 0.3, L.zf, 0.9, 4, 'winShutter', 1.2, 1.3, [[cx - 0.8, cx + 0.8]]);
  porch(g, L, 'portico', cx);
  windows(g, L, 'winHouse', { front: false, back: false });
  if (gr) drive(g, gr.gx, 3.2, gr.gz);
  walk(g, cx, L.zf + L.porch + 0.9);
  yardLife(g, L, 'plain');
  return pickName(g, ['Dutch Colonial (Gambrel, Obviously)', 'Dutch Colonial', 'Barn-Roof Colonial']);
} });

style({ id: 'saltbox', lv: [3, 4], build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 9, 8, 1.2);
  L.H = 5.6;
  const wall = wallOf(g, 'wood', [0x7a3a2a, 0x5a4a3a, 0x9a8a78, 0x3a3a3a], 3, 3);
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x5a5a5a, 0x6a625a])));
  extrude(g, L.x0, L.x1, P.saltbox(L.zb, L.zf, L.H, 2.2), wall, roofM, wall, 0.3);
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0.25, 'doorBlack', 0.8);
  windows(g, L, 'winHouse', { floors: 2, fh: 2.7, skipFront: [[cx - 0.7, cx + 0.7]], back: false });
  chimney(g, cx, L.zf - (L.zf - L.zb) * 0.36, L.H + 3.2, M('brick', 2, 2), 0.5);
  porch(g, L, 'stoop', cx);
  walk(g, cx, L.zf + 0.9);
  yardLife(g, L, 'plain');
  return pickName(g, ['Saltbox (New England, Allegedly)', 'Saltbox Colonial', 'Saltbox (Pepper Not Included)']);
} });

style({ id: 'tudor', lv: [3, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 12, 8, 0.4);
  L.H = 5.6;
  const stucco = M('stucco', 4, 4, 0xefe6d0), brick = M('brickDark', 2, 2);
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x5a4a44, 0x4a4a4e, 0x6a5a50])));
  body(g, L, stucco, stucco);
  const fx = L.x0 + (L.x1 - L.x0) * (rng.chance(0.5) ? 0.3 : 0.7), fw = 4.2;
  const gr = garage(g, L, 'flush', fx > (L.x0 + L.x1) / 2 ? -1 : 1, brick, roofM, 2);
  mb.box(L.x0, L.x1, 0, 2.6, L.zb, L.zf, { side: brick, top: null });
  mb.gable(L.x0, L.x1, L.zb, L.zf, L.H, 3.2, 'x', roofM, stucco, 0.4);
  // the steep front gable with half-timbering
  mb.box(fx - fw / 2, fx + fw / 2, 0, L.H, L.zf - 0.5, L.zf + 1.2, { f: stucco, l: stucco, r: stucco, top: null, b: null });
  mb.gable(fx - fw / 2, fx + fw / 2, L.zf - 3, L.zf + 1.2, L.H, 4.2, 'z', roofM, stucco, 0.3);
  const tim = M('plain', 2, 2, 0x3a2a1e);
  for (const dx of [-fw / 2 + 0.1, -0.7, 0.7, fw / 2 - 0.1]) mb.box(fx + dx - 0.09, fx + dx + 0.09, 2.6, L.H, L.zf + 1.2, L.zf + 1.26, tim);
  mb.box(fx - fw / 2, fx + fw / 2, 2.6, 2.78, L.zf + 1.2, L.zf + 1.26, tim);
  for (const s of [-1, 1]) { mb.push().translate(fx + s * 1.45, 4.6, L.zf + 1.23).rotZ(-s * 0.7); mb.box(-0.08, 0.08, -0.75, 0.75, 0, 0.05, tim); mb.pop(); }
  mb.decal('+z', fx, 3.4, L.zf + 1.2, 1.4, 1.3, win(g, 'winHouse'));
  door(g, fx, L.zf + 1.2, 0, 'doorBlack', 0.8, 1.1, 2.3);
  windows(g, L, 'winHouse', { floors: 2, fh: 2.8, skipFront: [[fx - fw / 2, fx + fw / 2]] });
  chimney(g, L.x0 + 0.5, L.zf - 1, L.H + 4.5, brick, 0.4);
  if (gr) drive(g, gr.gx, 5, L.zf);
  walk(g, fx, L.zf + 1.5);
  yardLife(g, L, 'hoa');
  return pickName(g, ['Tudor Revival', 'Stockbroker Tudor', 'Tudor (Half-Timbered, Half-Vinyl)']);
} });

style({ id: 'victorian', lv: [3, 5], build(g) {
  const { mb, rng, W } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, W >= 14 ? 10 : 7, 9, 2.4);
  L.H = 6.0;
  const col = rng.pick(PAL.painted);
  const wall = M('siding', 4, 4, col), trim = M('plain', 2, 2, rng.pick([0xffffff, 0x7a1d1d, 0x2a4a6a, 0xf7d774]));
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x5a4a5a, 0x4a4a4e, 0x6a3a3a])));
  house(g, L, wall, roofM, 'gableZ', 3.8, { ov: 0.3 });
  const cx = (L.x0 + L.x1) / 2;
  // the turret, because every painted lady has one
  const tx = clamp(rng.chance(0.5) ? L.x0 + 0.6 : L.x1 - 0.6, -W / 2 + 1.9, W / 2 - 1.9);
  mb.cyl(tx, L.zf - 0.2, 1.5, 0, L.H + 1.6, 10, wall, null);
  mb.cone(tx, L.zf - 0.2, 1.8, L.H + 1.6, 4.2, 10, roofM);
  mb.decal('+z', tx, 3.6, L.zf + 1.3, 0.7, 1.3, win(g, 'winTall'));
  mb.decal('+z', cx, L.H + 0.8, L.zf, 1.1, 1.6, win(g, 'winTall', 0.5));
  // gingerbread trim band under the gable
  mb.box(L.x0 - 0.2, L.x1 + 0.2, L.H - 0.3, L.H, L.zf, L.zf + 0.12, trim);
  door(g, tx > cx ? L.x0 + 1.4 : L.x1 - 1.4, L.zf, 0.5, 'doorGlass', 0.7);
  windows(g, L, 'winTall', { floors: 2, fh: 2.8, w: 0.9, h: 1.8, skipFront: [[tx - 1.6, tx + 1.6]] });
  porch(g, L, 'posts', tx > cx ? L.x0 + 1.4 : L.x1 - 1.4, { roof: roofM, post: trim, y: 0.5 });
  walk(g, tx > cx ? L.x0 + 1.4 : L.x1 - 1.4, L.zf + L.porch + 0.9);
  yardLife(g, L, 'plain');
  return pickName(g, ['Painted Lady (Victorian)', 'Queen Anne Victorian', 'Victorian (Now 6 Apartments)']);
} });

style({ id: 'midCentury', lv: [3, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 8, 0.6);
  L.H = 2.8;
  const wall = M(rng.chance(0.5) ? 'wood' : 'stucco', 3, 3, rgb(rng.pick([0xc8a070, 0xe8e0d0, 0x9a8a6a, 0xd8c8a8])));
  const accent = M('plain', 2, 2, rng.pick([0xf2a93a, 0x2a8a8a, 0xd8503a, 0x3a6a9a]));
  const roofM = M('flatRoof', 4, 4, 0xa8a49e);
  extrude(g, L.x0, L.x1, P.shedF(L.zb, L.zf, L.H, 1.0), wall, roofM, wall, 1.2);
  const gr = garage(g, L, 'carport', rng.chance(0.5) ? -1 : 1, wall, roofM, 1);
  // clerestory glass under the lifted front, a big glass wall, the breeze-block screen
  mb.decal('+z', (L.x0 + L.x1) / 2, L.H - 0.6, L.zf, L.x1 - L.x0 - 0.6, 0.9, M('glassPlain', 1.5, 1.5));
  mb.decal('+z', L.x0 + 3.2, 0.1, L.zf, 5, 2.2, win(g, 'winModern', 0.6));
  mb.box(L.x1 - 5.5, L.x1 - 3, 0, 2.2, L.zf + 0.6, L.zf + 0.9, M('grille', 1, 1, 0xf2f0ea));
  door(g, L.x1 - 2, L.zf, 0.05, 'doorGlass', 0);
  mb.decal('+z', L.x1 - 2, 0.05, L.zf + 0.02, 1.0, 2.1, accent);
  if (gr) drive(g, gr.gx, 3, gr.gz);
  windows(g, L, 'winModern', { front: false });
  yardLife(g, L, 'plain', { trees: 2 });
  return pickName(g, ['Mid-Century Modern (Flipped, Gray Floors)', 'Eichler-ish', 'Atomic Ranch']);
} });

style({ id: 'prairie', lv: [3, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 8, 1.8);
  L.H = 5.4;
  const wall = M(rng.chance(0.5) ? 'brickTan' : 'stucco', 2, 2, rgb(rng.pick([0xe8dcc8, 0xd8c8a8, 0xffffff])));
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x6a5a4a, 0x5a5a5a])));
  house(g, L, wall, roofM, 'hip', 1.3, { ov: 0.9 });
  mb.box(L.x0 - 0.1, L.x1 + 0.1, 2.6, 2.9, L.zb - 0.1, L.zf + 0.1, M('plain', 2, 2, 0x6a4a2a)); // the band
  row(g, '+z', L.x0 + 0.4, L.x1 - 0.4, L.zf, 3.3, 5, 'winModern', 1.5, 1.2);
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0.35, 'doorGlass', 0.9);
  row(g, '+z', L.x0 + 0.4, L.x1 - 0.4, L.zf, 0.9, 4, 'winModern', 1.6, 1.4, [[cx - 0.8, cx + 0.8]]);
  porch(g, L, 'full', cx, { roof: roofM, post: wall, y: 0.35 });
  windows(g, L, 'winModern', { front: false, floors: 2, fh: 2.6 });
  yardLife(g, L, 'hoa');
  return pickName(g, ['Prairie Style (No Prairie)', 'Prairie School', 'Frank Lloyd Wrong']);
} });

style({ id: 'townhome', lv: [3, 4], build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 6.4, 10, 0.4);
  L.H = 8.6;
  const wall = wallOf(g, rng.chance(0.5) ? 'brick' : 'siding', rng.chance(0.5) ? PAL.beige : [0x3a4a5a, 0x5a3a3a, 0xf2f0ea]);
  const roofM = M('shingles', 4, 4, rgb(rng.pick(PAL.roof)));
  house(g, L, wall, roofM, rng.chance(0.5) ? 'gableZ' : 'flat', 1.6);
  const cx = (L.x0 + L.x1) / 2;
  mb.decal('+z', cx - 0.8, 0, L.zf, 3.2, 2.2, S('garage1'));
  door(g, cx + 2, L.zf, 0.2, 'doorBlack', 0.4, 0.9);
  row(g, '+z', L.x0 + 0.3, L.x1 - 0.3, L.zf, 3.4, 2, 'winHouse', 1.3, 1.5);
  row(g, '+z', L.x0 + 0.3, L.x1 - 0.3, L.zf, 6.3, 2, 'winHouse', 1.3, 1.5);
  mb.box(L.x0 + 0.5, L.x1 - 0.5, 3.0, 3.1, L.zf, L.zf + 1.2, M('deck', 2, 2)); // the "balcony"
  mb.box(L.x0 + 0.5, L.x1 - 0.5, 3.1, 4.0, L.zf + 1.15, L.zf + 1.2, { f: M('fence', 2, 1, 0x2a2a2a), b: M('fence', 2, 1, 0x2a2a2a), l: null, r: null, top: null });
  windows(g, L, 'winHouse', { front: false, floors: 3, sides: false });
  drive(g, cx - 0.8, 3.4, L.zf);
  yardLife(g, L, 'hoa', { fence: false, trees: 1 });
  return pickName(g, ['Townhome (Skinny, 3 Stories of Stairs)', 'Luxury Townhome (Vinyl)', 'Row Home, End Unit']);
} });

style({ id: 'stilts', lv: [3, 5], build(g) {
  const { mb, rng, W } = g;
  lotPad(g, M('gravel', 6, 6, 0xe8dcc0));
  const L = site(g, W >= 14 ? 10 : 7, 8, 2.8);
  const y0 = 3.2;
  const wall = wallOf(g, 'siding', [0x8ecfc9, 0xf7d774, 0xf2f0ea, 0x7fb3e6, 0xf4b183]);
  const roofM = M('metalRoof', 3, 3, rgb(rng.pick([0xd8d8d0, 0x3a6a8a, 0x2a2a2c])));
  for (const x of [L.x0 + 0.3, (L.x0 + L.x1) / 2, L.x1 - 0.3]) for (const z of [L.zb + 0.3, L.zf - 0.3, L.zf + L.porch - 0.3]) mb.boxC(x, z, 0.3, 0.3, 0, y0, { side: M('wood', 2, 2, 0x8a7a60), top: null });
  mb.box(L.x0, L.x1, y0, y0 + 2.9, L.zb, L.zf, { side: wall, top: null, bottom: M('wood', 2, 2) });
  mb.hip(L.x0, L.x1, L.zb, L.zf, y0 + 2.9, 1.6, roofM, 0.6);
  mb.box(L.x0, L.x1, y0 - 0.2, y0, L.zf, L.zf + L.porch, { side: M('wood', 2, 2), top: M('deck', 3, 3), bottom: M('wood', 2, 2) });
  mb.box(L.x0, L.x1, y0, y0 + 1, L.zf + L.porch - 0.05, L.zf + L.porch, { f: M('fence', 3, 1, 0xf2f0ea), b: M('fence', 3, 1, 0xf2f0ea), l: null, r: null, top: null });
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, y0, 'doorGlass', 0.8);
  windows(g, { ...L }, 'winModern', { y0: y0 + 0.9, skipFront: [[cx - 0.8, cx + 0.8]] });
  // stairs up the side
  if (L.x1 + 1.2 < W / 2) for (let i = 0; i < 10; i++) mb.box(L.x1 + 0.1, L.x1 + 1.1, i * 0.32, i * 0.32 + 0.12, L.zf + L.porch - 0.3 - i * 0.3, L.zf + L.porch - i * 0.3, M('wood', 1, 1));
  car(g, cx, (L.zb + L.zf) / 2, Math.PI, rng.pick<CarKind>(['suv', 'lifted', 'van']));
  const Lb: Lay = { ...L, H: y0 + 2.9 };
  yardLife(g, Lb, 'plain', { fence: false, shrubs: false });
  return pickName(g, ['Beach House on Stilts (No Beach)', 'Stilt House (Flood Zone Z)', 'Raised Cottage (Insurance: LOL)']);
} });

style({ id: 'adobe', lv: [3, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('gravel', 6, 6, 0xd8c8a8));
  const L = site(g, 12, 8, 1.4);
  L.H = 3.2;
  const wall = M('stucco', 4, 4, rgb(rng.pick([0xd8a878, 0xc89868, 0xe0b890, 0xd09a70])));
  house(g, L, wall, M('flatRoof', 4, 4), 'flat', 0);
  const gr = garage(g, L, 'carport', L.x0 + L.x1 > 0 ? -1 : 1, wall, M('flatRoof', 4, 4), 1);
  // a second, smaller block on top and the vigas poking out
  const up: Lay = { ...L, x0: L.x0 + 1.5, x1: L.x0 + 6, zb: L.zb + 1, zf: L.zf - 2, H: 6.0 };
  mb.box(up.x0, up.x1, L.H, up.H, up.zb, up.zf, { side: wall, top: null });
  mb.parapet(up.x0, up.x1, up.zb, up.zf, up.H, 0.5, wall, M('flatRoof', 4, 4));
  for (let x = L.x0 + 0.6; x < L.x1; x += 1.2) mb.push().translate(x, L.H - 0.3, L.zf).rotX(Math.PI / 2), mb.cyl(0, 0, 0.12, -0.1, 0.5, 6, M('wood', 1, 1, 0x6a4a2a)), mb.pop();
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx + 2, L.zf, 0.1, 'doorFront', 0.8, 1.1, 2.2);
  windows(g, L, 'winModern', { skipFront: [[cx + 1.2, cx + 2.8]] });
  row(g, '+z', up.x0 + 0.3, up.x1 - 0.3, up.zf, L.H + 0.8, 2, 'winModern', 1, 1.2);
  const sx = Math.max(-g.W / 2 + 0.7, L.x0 - 0.8);
  mb.cyl(sx, L.zf + 1.2, 0.5, 0, 1.6, 8, M('plain', 2, 2, 0x3a7a3a)); // saguaro, sort of
  mb.cyl(sx, L.zf + 1.2, 0.3, 1.6, 3.2, 8, M('plain', 2, 2, 0x3a7a3a));
  occupy(g, sx - 0.6, sx + 0.6, L.zf + 0.6, L.zf + 1.8);
  if (gr) drive(g, gr.gx, 3, gr.gz, mats.gravel());
  yardLife(g, L, 'plain', { fence: false, shrubs: false });
  return pickName(g, ['Pueblo Revival (Scottsdale Edition)', 'Adobe (Stucco Over Foam)', 'Santa Fe Style (In Ohio)']);
} });

style({ id: 'dome', lv: [3, 4], build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 8, 8, 1.6);
  const cx = (L.x0 + L.x1) / 2, cz = (L.zb + L.zf) / 2, r = Math.min(4, (L.x1 - L.x0) / 2);
  mb.blob(cx, 0, cz, r, r * 0.9, r, M('plain', 2, 2, rng.pick([0xe8e4dc, 0xd8d0c0, 0xc8d8e0])), 1, 0.0, 5);
  mb.decal('+z', cx, 0, cz + r - 0.3, 1.1, 2.1, S('doorGlass'));
  for (const a of [-0.8, 0.8]) mb.decal('+z', cx + Math.sin(a) * r * 0.8, 1.2, cz + Math.cos(a) * r * 0.8 - 0.2, 1, 1, M('glassPlain', 1, 1));
  mb.box(cx - r * 0.5, cx + r * 0.5, r * 0.85, r * 0.87, cz - 1, cz + 1, M('solar', 1, 1.6));
  const Lb: Lay = { x0: cx - r, x1: cx + r, zb: cz - r, zf: cz + r - 0.4, H: r, porch: 0.6 };
  walk(g, cx, cz + r);
  yardLife(g, Lb, 'plain', { fence: false });
  return pickName(g, ['Geodesic Dome (Leaks)', 'Dome Home (Bucky Would Be Proud)', 'Monolithic Dome (Tornado-Proof, Allegedly)']);
} });

// ---- L4/L5: the top ---------------------------------------------------------------
style({ id: 'tuscan', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 9, 2.6);
  L.H = 6.0;
  const wall = M('stucco', 4, 4, rgb(rng.pick([0xe0c090, 0xd8b080, 0xe8d0a8, 0xc8a070])));
  const stone = M('stone', 3, 3);
  const roofM = M('metalRoof', 1.2, 1.2, rgb(rng.pick([0xc86a3a, 0xb85a2a, 0xd07a4a])));
  house(g, L, wall, roofM, 'hip', 2.2, { ov: 0.6 });
  const gr = garage(g, L, 'front', rng.chance(0.5) ? -1 : 1, wall, roofM, 3);
  mb.box(L.x0, L.x1, 0, 1.2, L.zb, L.zf, { side: stone, top: null });
  const cx = (L.x0 + L.x1) / 2;
  // arched entry tower
  mb.box(cx - 1.8, cx + 1.8, 0, L.H + 1.6, L.zf - 0.4, L.zf + 1.2, { f: stone, l: stone, r: stone, top: null, b: null });
  mb.hip(cx - 1.8, cx + 1.8, L.zf - 0.4, L.zf + 1.2, L.H + 1.6, 1.2, roofM, 0.4);
  mb.decal('+z', cx, 0.2, L.zf + 1.2, 1.9, 3.2, S('doorDouble'));
  mb.decal('+z', cx, 4.0, L.zf + 1.2, 1.4, 2.1, win(g, 'winTall'));
  windows(g, L, 'winTall', { floors: 2, fh: 3, w: 1.0, h: 1.9, skipFront: [[cx - 1.8, cx + 1.8]] });
  // lions on the pillars, a fountain in the middle of the car turnaround
  for (const s of [-1, 1]) {
    mb.boxC(cx + s * 2.6, L.zf + L.porch, 0.8, 0.8, 0, 1.4, M('stone', 2, 2, 0xe8e0d0));
    mb.blob(cx + s * 2.6, 1.8, L.zf + L.porch, 0.35, 0.4, 0.5, M('plain', 2, 2, 0xe8e0d0), 0, 0.2, 3);
  }
  mb.box(L.x0, L.x1, 0, 0.3, L.zf, L.zf + L.porch, { side: stone, top: M('concretePad', 3, 3, 0xe8dcc8), b: null });
  if (gr) drive(g, gr.gx, gr.gw, gr.gz, M('gravel', 3, 3, 0xe8dcc8), ['suv', 'cyber', 'lifted']);
  walk(g, cx, L.zf + L.porch, 2);
  yardLife(g, L, 'rich', { trees: 2 });
  if (g.rng.chance(0.6)) tree(g, L.x0 - 1.2, L.zf + 1, 0.8, 'cone');
  return pickName(g, ['Tuscan-Inspired (Ohio)', 'Tuscan Villa (Faux Stone Veneer)', 'Mediterranean Estate (Landlocked)']);
} });

style({ id: 'columned', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 9, 3.2);
  L.H = 6.4;
  const wall = M(rng.chance(0.5) ? 'brick' : 'siding', 3, 3, rgb(rng.pick([0xffffff, 0xf2f0ea, 0xe8e2d0])));
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x3a3a3e, 0x4a4a4e])));
  house(g, L, wall, roofM, 'hip', 2.4);
  const gr = garage(g, L, 'detached', rng.chance(0.5) ? -1 : 1, wall, roofM, 2);
  const cx = (L.x0 + L.x1) / 2;
  // two-story columns across the whole front, a pediment over the middle
  const white = M('plain', 2, 2, 0xffffff);
  mb.box(L.x0, L.x1, 0, 0.5, L.zf, L.zf + L.porch, { side: white, top: M('concretePad', 3, 3, 0xf2f0ea), b: null });
  for (let i = 0; i < 6; i++) mb.cyl(L.x0 + 0.5 + ((L.x1 - L.x0 - 1) * i) / 5, L.zf + L.porch - 0.5, 0.3, 0.5, L.H, 10, white);
  mb.box(L.x0 - 0.2, L.x1 + 0.2, L.H, L.H + 0.5, L.zf - 0.3, L.zf + L.porch, white);
  mb.gable(cx - 3, cx + 3, L.zf, L.zf + L.porch, L.H + 0.5, 1.6, 'z', roofM, white, 0.2);
  door(g, cx, L.zf, 0.5, 'doorDouble', 1.2, 1.8, 2.6);
  mb.decal('+z', cx, 3.6, L.zf + 0.02, 2.2, 1.8, S('winPalladian'));
  windows(g, L, 'winShutter', { floors: 2, fh: 3.1, w: 1.3, h: 1.7, skipFront: [[cx - 1.4, cx + 1.4]] });
  chimney(g, L.x0 + 0.5, (L.zb + L.zf) / 2, L.H + 3.4, M('brick', 2, 2), 0.2);
  chimney(g, L.x1 - 0.5, (L.zb + L.zf) / 2, L.H + 3.4, M('brick', 2, 2), 0);
  walk(g, cx, L.zf + L.porch, 2.4);
  if (gr) drive(g, gr.gx, 5, gr.gz, mats.concrete(), ['suv', 'cyber']);
  yardLife(g, L, 'rich', { trees: 2 });
  return pickName(g, ['Columned Georgian (Vinyl Columns)', 'The Little White House (HOA Approved)', 'Neoclassical (Columns Hollow)']);
} });

style({ id: 'chateau', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 9, 1.8);
  L.H = 6.0;
  const wall = M(rng.chance(0.5) ? 'stone' : 'stucco', 3, 3, rgb(rng.pick([0xe8e0d0, 0xd8d0c0, 0xf2eadc])));
  const roofM = M('metalRoof', 2, 2, rgb(rng.pick([0x3a3e46, 0x2a2e36, 0x4a4e56])));
  house(g, L, wall, roofM, 'mansard', 2.8);
  const gr = garage(g, L, 'detached', rng.chance(0.5) ? -1 : 1, wall, roofM, 2);
  const cx = (L.x0 + L.x1) / 2;
  // dormers poking out of the mansard, twin turrets with pointy hats
  for (let i = 0; i < 4; i++) {
    const x = L.x0 + 1.5 + ((L.x1 - L.x0 - 3) * i) / 3;
    mb.box(x - 0.6, x + 0.6, L.H + 0.3, L.H + 1.9, L.zf - 0.8, L.zf + 0.15, { f: wall, l: wall, r: wall, top: null, b: null });
    mb.gable(x - 0.6, x + 0.6, L.zf - 0.8, L.zf + 0.15, L.H + 1.9, 0.7, 'z', roofM, wall, 0.1);
    mb.decal('+z', x, L.H + 0.5, L.zf + 0.15, 0.8, 1.2, win(g, 'winTall'));
  }
  for (const x0 of [L.x0, L.x1]) { const x = clamp(x0, -g.W / 2 + 1.7, g.W / 2 - 1.7); mb.cyl(x, L.zf, 1.4, 0, L.H + 2.4, 10, wall, null); mb.cone(x, L.zf, 1.6, L.H + 2.4, 4.4, 10, roofM); }
  door(g, cx, L.zf, 0.4, 'doorDouble', 1.2, 1.8, 2.6);
  windows(g, L, 'winTall', { floors: 2, fh: 3, w: 1.0, h: 1.9, skipFront: [[cx - 1.2, cx + 1.2]] });
  porch(g, L, 'portico', cx, { post: M('plain', 2, 2, 0xf2f0ea), roof: roofM, y: 0.4 });
  if (gr) drive(g, gr.gx, 5, gr.gz, mats.gravel(), ['suv', 'cyber']);
  walk(g, cx, L.zf + L.porch, 2);
  yardLife(g, L, 'rich');
  return pickName(g, ['Château de Cul-de-Sac', 'French Provincial (Provinces: Texas)', 'Mansard Manor']);
} });

style({ id: 'modernBox', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 13, 9, 0.6);
  L.H = 3.2;
  const white = M('stucco', 4, 4, rgb(rng.pick([0xf4f3ef, 0xe8e8e4, 0x2a2a2c])));
  const wood = M('wood', 2, 2, 0xb08a5a);
  house(g, L, white, M('flatRoof', 4, 4), 'flat', 0, { parapet: false });
  const gr = garage(g, L, 'flush', 1, white, M('flatRoof', 4, 4), 2);
  mb.decal('+z', (L.x0 + L.x1) / 2, 0.1, L.zf, L.x1 - L.x0 - 2, 2.8, win(g, 'winModern', 0.7));
  // the cantilevered upper box, turned and sticking out over the lawn
  const up: Lay = { ...L, x0: L.x0 + 2, x1: L.x1 + 0.5, zb: L.zb + 1, zf: L.zf + 2, H: 6.4 };
  mb.box(up.x0, up.x1, L.H, up.H, up.zb, up.zf, { side: wood, top: M('flatRoof', 4, 4), bottom: M('plain', 2, 2, 0x2a2a2a) });
  mb.decal('+z', (up.x0 + up.x1) / 2, L.H + 0.3, up.zf, up.x1 - up.x0 - 1, 2.6, M('glassPlain', 2, 2));
  mb.box(up.x0 + 1, up.x1 - 1, up.H, up.H + 0.1, up.zb + 1, up.zf - 1, M('solar', 1, 1.6));
  door(g, L.x0 + 1.2, L.zf, 0.05, 'doorGlass', 0, 1.1, 2.6);
  if (gr) drive(g, gr.gx, 5, L.zf, mats.concrete(), ['cyber', 'suv']);
  windows(g, L, 'winModern', { front: false });
  yardLife(g, { ...L, H: up.H }, 'rich', { trees: 1 });
  return pickName(g, ["Architect's Divorce House", 'Modern Box (Very Gray Inside)', 'Contemporary (Cantilevered for No Reason)']);
} });

style({ id: 'castle', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 13, 9, 1.4);
  L.H = 6.4;
  const wall = M('stone', 3, 3, rgb(rng.pick([0xd8d0c0, 0xc8c0b0, 0xe8e0d0])));
  house(g, L, wall, M('flatRoof', 4, 4), 'flat', 0);
  const gr = garage(g, L, 'detached', rng.chance(0.5) ? -1 : 1, wall, M('shingles', 4, 4, 0x5a5a5a), 2);
  // vinyl battlements
  for (let x = L.x0; x < L.x1 - 0.3; x += 1.2) mb.box(x, x + 0.6, L.H + 0.6, L.H + 1.3, L.zf - 0.35, L.zf, wall);
  for (const x of [L.x0, L.x1]) {
    mb.cyl(x, L.zf, 1.6, 0, L.H + 3, 10, wall);
    for (let a = 0; a < 8; a += 2) mb.boxC(x + Math.sin((a / 8) * Math.PI * 2) * 1.4, L.zf + Math.cos((a / 8) * Math.PI * 2) * 1.4, 0.6, 0.6, L.H + 3, 0.7, wall);
  }
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0, 'doorDouble', 1.1, 1.9, 2.8);
  windows(g, L, 'winTall', { floors: 2, fh: 3, w: 0.8, h: 1.6, skipFront: [[cx - 1.2, cx + 1.2]] });
  mb.cyl(L.x1, L.zf, 0.06, L.H + 3.7, L.H + 7, 5, M('metal', 2, 2));
  mb.poly([[L.x1 + 0.05, L.H + 5.6, L.zf], [L.x1 + 2.2, L.H + 5.5, L.zf], [L.x1 + 2.2, L.H + 6.9, L.zf], [L.x1 + 0.05, L.H + 7, L.zf]], S('sat:flag:team'));
  if (gr) drive(g, gr.gx, 5, gr.gz, mats.gravel(), ['lifted', 'suv']);
  walk(g, cx, L.zf, 2);
  yardLife(g, L, 'rich');
  return pickName(g, ['Castle (Vinyl Battlements)', 'Suburban Keep', "A Man's Home Is His Castle (Literally)"]);
} });

style({ id: 'lodge', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 9, 2.8);
  L.H = 3.2;
  const log = M('wood', 1.2, 0.35, rgb(rng.pick([0x8a5a32, 0x9a6a3a])));
  const stone = M('stone', 3, 3);
  const roofM = M('metalRoof', 3, 3, rgb(rng.pick([0x2a4a3a, 0x5a3a2a, 0x2a2a2c])));
  extrude(g, L.x0, L.x1, P.gable(L.zb, L.zf, L.H, 4.2), log, roofM, log, 0.6);
  const gr = garage(g, L, 'front', L.x0 + L.x1 > 0 ? -1 : 1, log, roofM, 3);
  const cx = (L.x0 + L.x1) / 2;
  // the big glass great-room gable facing the street
  mb.box(cx - 3, cx + 3, 0, L.H, L.zf - 0.2, L.zf + 2, { f: log, l: log, r: log, top: null, b: null });
  mb.gable(cx - 3, cx + 3, L.zf - 2, L.zf + 2, L.H, 4.4, 'z', roofM, log, 0.6);
  mb.poly([[cx - 2.4, L.H + 0.1, L.zf + 2.05], [cx + 2.4, L.H + 0.1, L.zf + 2.05], [cx, L.H + 3.8, L.zf + 2.05]], M('glassPlain', 1.5, 1.5));
  mb.decal('+z', cx, 0.4, L.zf + 2, 4.4, 2.6, win(g, 'winModern', 0.8));
  chimney(g, L.x0 + 0.3, (L.zb + L.zf) / 2, L.H + 5.8, stone, 0.5);
  porch(g, { ...L, zf: L.zf + 2, porch: 0.8 }, 'stoop', cx);
  windows(g, L, 'winModern', { front: false });
  if (gr) drive(g, gr.gx, gr.gw, gr.gz, M('gravel', 3, 3, 0xd8d0c0), ['lifted', 'suv']);
  yardLife(g, { ...L, porch: 2.8 }, 'rich', { trees: 3 });
  return pickName(g, ["Rustic Lodge (4,000 sq ft of 'Cozy')", 'Log Mansion', 'Mountain Modern (Flat County)']);
} });

style({ id: 'gatedEstate', lv: [5, 5], minW: 14, minD: 20, build(g) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 9, 1.2);
  L.zf -= 2; L.zb -= 2;
  L.H = 6.2;
  const wall = M('stucco', 4, 4, rgb(rng.pick(PAL.stucco)));
  const roofM = M('shingles', 4, 4, rgb(rng.pick([0x6a5a4a, 0x5a5a5a])));
  house(g, L, wall, roofM, 'hip', 2.6, { front: M('stone', 3, 3) });
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0.3, 'doorDouble', 1.2, 1.8, 2.6);
  windows(g, L, 'winTall', { floors: 2, fh: 3, w: 1.0, h: 1.9, skipFront: [[cx - 1.2, cx + 1.2]] });
  porch(g, L, 'portico', cx, { y: 0.3 });
  // the gate, the wall, the fountain, the name on the pillar
  const gz = D / 2 - 0.6;
  for (const s of [-1, 1]) {
    mb.box(s < 0 ? -W / 2 + 0.2 : 2.2, s < 0 ? -2.2 : W / 2 - 0.2, 0, 1.6, gz - 0.25, gz + 0.25, M('stone', 3, 3));
    mb.boxC(s * 2.2, gz, 0.8, 0.8, 0, 2.4, M('stone', 2, 2));
    mb.blob(s * 2.2, 2.7, gz, 0.4, 0.3, 0.4, M('plain', 2, 2, 0xffe8a0), 0, 0.1, 2);
  }
  mb.box(-2, 2, 0, 1.9, gz - 0.04, gz + 0.04, { f: M('chainlink', 1, 1, 0x1a1a1a), b: M('chainlink', 1, 1, 0x1a1a1a), l: null, r: null, top: null });
  occupy(g, -W / 2, W / 2, gz - 0.4, D / 2);
  const fz = (L.zf + L.porch + gz) / 2;
  mb.cyl(cx, fz, 1.6, 0, 0.5, 12, M('stone', 2, 2), M('pool', 2, 2));
  mb.cyl(cx, fz, 0.3, 0.5, 1.8, 8, M('stone', 2, 2));
  emit(g, 'steam', cx, 1.9, fz);
  occupy(g, cx - 1.8, cx + 1.8, fz - 1.8, fz + 1.8);
  patch(g, -2, 2, L.zf + L.porch, gz, M('gravel', 3, 3, 0xe8dcc8), 0.1);
  occupy(g, -2, 2, L.zf + L.porch, gz);
  const pd = Math.min(L.zb + D / 2 - 3, 5);
  if (pd > 2.5) { poolInground(g, cx, L.zb - pd / 2 - 1.6, Math.min(L.x1 - L.x0 - 2, 10), pd); occupy(g, cx - 6, cx + 6, L.zb - pd - 3, L.zb - 0.2); }
  yardLife(g, L, 'rich', { fence: true });
  return pickName(g, ['Gated Estate (Gate Always Open)', 'Private Estate (Zillow Famous)', 'The Estates at Estate Estates']);
} });

style({ id: 'founder', lv: [5, 5], minW: 14, build(g) {
  const { mb, rng, D } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 9, 1.4);
  L.H = 3.4;
  const dark = M('metalPanel', 3, 3, 0x2a2a2c), glass = M('glassPlain', 2, 2);
  mb.box(L.x0, L.x1, 0, L.H, L.zb, L.zf, { side: dark, f: glass, top: M('solar', 1, 1.6) });
  const up: Lay = { ...L, x0: L.x0 + 3, x1: L.x1 - 1, zb: L.zb - 0.5, zf: L.zf - 1, H: 7 };
  mb.box(up.x0, up.x1, L.H, up.H, up.zb, up.zf, { side: glass, top: M('solar', 1, 1.6), l: dark, r: dark });
  mb.decal('+z', (L.x0 + L.x1) / 2, 0.1, L.zf + 0.02, L.x1 - L.x0 - 2, 3, win(g, 'winModern', 0.9));
  mb.decal('+z', (up.x0 + up.x1) / 2, L.H + 0.2, up.zf + 0.02, up.x1 - up.x0 - 1, 3.2, win(g, 'winModern', 0.9));
  // charging wall, the matte truck, a sauna, the cold plunge, the "office" yurt
  for (let i = 0; i < 3; i++) mb.box(L.x0 + 0.4 + i * 1.3, L.x0 + 0.8 + i * 1.3, 0, 1.6, L.zf + 0.6, L.zf + 0.9, { side: M('plain', 2, 2, 0xe8e8e8), f: M('plain', 2, 2, 0x3fd0ff) });
  car(g, L.x0 + 2, D / 2 - 3, Math.PI, 'cyber', 0x9aa0a6);
  occupy(g, L.x0 + 0.5, L.x0 + 3.6, L.zf, D / 2);
  const zb = L.zb - 1;
  if (zb + D / 2 > 5) {
    mb.box(L.x0 + 1, L.x0 + 3.4, 0, 2.4, zb - 2.4, zb, { side: M('wood', 2, 2, 0x8a5a32), top: M('metalRoof', 2, 2, 0x2a2a2c) });
    mb.cyl(L.x1 - 2, zb - 1.4, 1, 0, 0.9, 12, M('metal', 2, 2, 0x8a8e92), M('pool', 2, 2, 0xbfe8ff));
    occupy(g, L.x0 + 0.8, L.x1 - 0.8, zb - 2.6, zb);
  }
  const Lb: Lay = { ...L, H: up.H };
  yardLife(g, Lb, 'rich', { trees: 1, frontN: 1 });
  return pickName(g, ["Founder's Compound", 'Tech Bro Modern (Biohacking Wing)', 'Smart Home (Too Smart)']);
} });

style({ id: 'prepper', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng, W, D } = g;
  lotPad(g, M('dirt', 8, 8));
  const L = site(g, 11, 8, 0.8);
  L.H = 3.0;
  const wall = M('cinder', 3, 3, 0xb8b4ac);
  house(g, L, wall, M('metalRoof', 3, 3, 0x3a4a2a), 'shed', 0.8);
  for (let i = 0; i < 4; i++) { const x = L.x0 + 0.4 + ((i + 0.5) * (L.x1 - L.x0 - 0.8)) / 4; if (Math.abs(x - (L.x0 + L.x1) / 2) > 1) mb.decal('+z', x, 1.3, L.zf, 1, 0.7, S('winBoard')); }
  door(g, (L.x0 + L.x1) / 2, L.zf, 0, 'doorMetal', 0.6);
  mb.box(L.x0, L.x1, L.H + 0.9, L.H + 1.0, L.zb, L.zf, M('solar', 1, 1.6));
  // the watchtower, the perimeter, the berm
  const tx = L.x1 + 3.1 < W / 2 ? L.x1 + 1.8 : L.x0 - 3.1 > -W / 2 ? L.x0 - 1.8 : NaN;
  if (!Number.isNaN(tx)) for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) mb.boxC(tx + dx, L.zf - 1 + dz, 0.15, 0.15, 0, 5, { side: M('wood', 2, 2), top: null });
  if (!Number.isNaN(tx)) {
    mb.box(tx - 1.1, tx + 1.1, 5, 6.6, L.zf - 2.1, L.zf + 0.1, { side: M('plain', 2, 2, 0x4a5a3a), top: M('metalRoof', 2, 2, 0x3a4a2a) });
    occupy(g, tx - 1.3, tx + 1.3, L.zf - 2.2, L.zf + 0.2);
  }
  fence(g, -W / 2 + 0.3, D / 2 - 0.3, W / 2 - 0.3, D / 2 - 0.3, 2.2, 'chainlink');
  for (let x = -W / 2 + 1; x < W / 2 - 1; x += 2) mb.push().translate(x, 2.25, D / 2 - 0.3).rotZ(Math.PI / 2), mb.cyl(0, 0, 0.12, -1, 1, 6, M('metal', 2, 2, 0x8a8e92)), mb.pop(); // razor wire, sort of
  mb.blob(0, 0, -D / 2 + 2.5, W / 2 - 1, 1.2, 1.8, M('lawnDry', 4, 4), 1, 0.2, 9);
  occupy(g, -W / 2, W / 2, -D / 2, -D / 2 + 4.4);
  car(g, clamp(Number.isNaN(tx) ? 0 : tx, -W / 2 + 1.5, W / 2 - 1.5), D / 2 - 3.5, Math.PI, 'lifted', 0x3a4a2a);
  yardLife(g, L, 'junk', { fence: false, frontN: 2, backN: 1 });
  return pickName(g, ['Prepper Compound', 'Bug-Out Estate (Never Bugged Out)', 'Self-Sufficient Homestead (Amazon Deliveries Daily)']);
} });

style({ id: 'fallingNoWater', lv: [5, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 13, 8, 1.2);
  L.H = 2.8;
  const conc = M('concrete', 3, 3, 0xefe6d0), stone = M('stone', 3, 3, 0xb8a888);
  // stacked, sliding trays, one stone chimney mass holding it all together
  const trays: [number, number, number, number, number][] = [[L.x0, L.x1 - 2, L.zb, L.zf, 0], [L.x0 + 2, L.x1, L.zb + 1, L.zf + 1.4, 3], [L.x0 + 1, L.x1 - 3, L.zb + 0.5, L.zf - 1, 6]];
  for (const [x0, x1, z0, z1, y] of trays) {
    mb.box(x0, x1, y + 0.5, y + 2.9, z0 + 0.6, z1 - 0.6, { side: M('glassPlain', 2, 2), top: null });
    mb.box(x0 - 0.3, x1 + 0.3, y + 2.9, y + 3.3, z0, z1, conc);
    mb.box(x0, x1, y, y + 0.5, z0, z1, conc);
  }
  mb.box(L.x0 + 3, L.x0 + 4.4, 0, 10.5, L.zb + 1.5, L.zb + 3, stone);
  mb.decal('+z', (L.x0 + L.x1) / 2 - 1, 0.6, L.zf - 0.6, 5, 2.2, win(g, 'winModern', 0.8));
  mb.flat(L.x0 - 2, L.x0, L.zf - 2, L.zf + 1, 0.12, M('pool', 2, 2)); // the dry creek, filled with a hose
  const Lb: Lay = { ...L, zf: L.zf + 1.4, H: 9.3 };
  yardLife(g, Lb, 'rich', { trees: 3, fence: false });
  return pickName(g, ['Fallingwater (No Water)', 'Organic Architecture (Leaks Organically)', 'Cantilever Estate']);
} });

style({ id: 'resort', lv: [5, 5], minW: 14, minD: 20, build(g) {
  const { mb, rng, D, W } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 8, 1.8);
  L.zf += 1; L.zb += 1;
  L.H = 6.0;
  const wall = M('stucco', 4, 4, rgb(rng.pick([0xf4f3ef, 0xf2e6d0, 0xe8f0f0])));
  const roofM = M('metalRoof', 1.2, 1.2, rgb(rng.pick([0xc86a3a, 0xd8d8d0])));
  house(g, L, wall, roofM, 'hip', 2, { ov: 0.8 });
  const gr = garage(g, L, 'flush', rng.chance(0.5) ? -1 : 1, wall, roofM, 2);
  const cx = (L.x0 + L.x1) / 2;
  door(g, cx, L.zf, 0.3, 'doorDouble', 1.2, 1.8, 2.6);
  windows(g, L, 'winModern', { floors: 2, fh: 3, w: 1.4, h: 1.8, skipFront: [[cx - 1.2, cx + 1.2]] });
  porch(g, L, 'portico', cx, { roof: roofM, y: 0.3 });
  // the backyard water park: pool, slide, lazy-river loop, palms
  const pz = (L.zb - D / 2) / 2;
  const pw = Math.min(W - 4, 12), pd = Math.min(L.zb + D / 2 - 2.5, 6);
  if (pd > 3) {
    poolInground(g, 0, pz, pw, pd);
    mb.push().translate(pw / 2 - 1, 0, pz - pd / 2 + 0.6).rotY(0.3);
    mb.boxC(0, 0, 1, 1, 0, 3.2, M('plain', 2, 2, 0xffd23f));
    mb.push().translate(0, 1.6, 1.6).rotX(0.6); mb.box(-0.4, 0.4, 0, 0.15, -2, 2, M('plain', 2, 2, 0x3fd0ff)); mb.pop();
    mb.pop();
    occupy(g, -pw / 2 - 1.2, pw / 2 + 1.2, pz - pd / 2 - 1.2, pz + pd / 2 + 1.2);
  }
  for (const x of [-W / 2 + 1.5, W / 2 - 1.5]) tree(g, x, L.zb - 1.2, 0.9, 'palm');
  if (gr) drive(g, gr.gx, 5, L.zf, M('concretePad', 3, 3, 0xe8dcc8), ['suv', 'cyber']);
  walk(g, cx, L.zf + L.porch, 2);
  yardLife(g, L, 'rich', { fence: true, backN: 0 });
  return pickName(g, ['Resort-Style Living (HOA Fee $2k/mo)', 'Staycation Estate', 'Backyard Water Park Home']);
} });

style({ id: 'barndo', lv: [4, 5], minW: 14, build(g) {
  const { mb, rng } = g;
  lotPad(g, M('lawn', 8, 8));
  const L = site(g, 14, 10, 3);
  L.H = 5.2;
  const light = rng.chance(0.6);
  const wall = M('metalPanel', 3, 3, rgb(light ? rng.pick([0xf4f3ef, 0xe8e4dc, 0xd8d0c0]) : rng.pick([0x3a3a3c, 0x7a1d1d, 0x4a5a4a])));
  const roofM = M('metalRoof', 3, 3, rgb(light ? rng.pick([0x2a2a2c, 0x3a3a3c, 0x7a1d1d]) : rng.pick([0xd8d8d0, 0xb8b8b2])));
  extrude(g, L.x0, L.x1, P.gable(L.zb, L.zf, L.H, 2.4), wall, roofM, wall, 0.4);
  const cx = (L.x0 + L.x1) / 2;
  mb.decal('+z', L.x0 + 3, 0, L.zf, 4.8, 3.6, S('rollup', 0x2a2a2a));
  door(g, cx + 2, L.zf, 0.3, 'doorGlass', 0.9, 1.8, 2.5);
  row(g, '+z', cx + 3.4, L.x1 - 0.3, L.zf, 0.8, 2, 'winModern', 1.3, 2.2);
  porch(g, { ...L, x0: cx }, 'posts', cx + 2, { roof: roofM, post: M('wood', 2, 2, 0x6a4a2a), y: 0.3 });
  mb.decal('+z', cx + 2, 3.2, L.zf + L.porch + 0.2, 2.2, 0.55, S('gather'), 0.1);
  windows(g, L, 'winModern', { front: false, floors: 2, fh: 2.6 });
  drive(g, L.x0 + 3, 5, L.zf, mats.gravel(), ['lifted', 'cyber']);
  yardLife(g, L, 'rich', { fence: false, trees: 2 });
  return pickName(g, ['Barndominium Estate', 'Barndo (Shiplap Interior)', 'Luxury Barn (No Animals)']);
} });

/** Styles that fit this lot (level, width, depth). */
export function stylesFor(level: number, W: number, D: number) {
  // most need a 2-cell-deep lot for a front yard, the house and a back yard
  return STYLES.filter((s) => level >= s.lv[0] && level <= s.lv[1] && W >= (s.minW ?? 0) && D >= (s.minD ?? 16));
}

