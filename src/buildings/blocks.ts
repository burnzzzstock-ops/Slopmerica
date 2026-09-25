// Building blocks: facade material presets (meters per tile, bays/floors per tile;
// these must match the painters in art/facades.ts) and multi-storey helpers.
import type { Rng } from '../core/rng';
import { M, S, Mat, RGB, WHITE, rgb, mulRGB } from './mesh';
import { GenCtx, hvac, waterTank, mast, dish, rooftopBillboard } from './props';
import { BILLBOARDS } from '../art/billboards';

type C = RGB | number;
const ph = (r?: Rng) => (r ? r.int(0, 7) : 0);

export const FAC = {
  aptBrick: (r?: Rng, c: C = WHITE) => M('aptBrick', 12, 12, c, { bays: 4, floors: 4, ph: ph(r) }),
  aptSiding: (r?: Rng, c: C = WHITE) => M('aptSiding', 12, 12, c, { bays: 4, floors: 4, ph: ph(r) }),
  fiveOver: (r?: Rng, c: C = WHITE) => M('fiveOver', 12.8, 12.8, c, { bays: 4, floors: 4, ph: ph(r) }),
  podium: (r?: Rng, c: C = WHITE) => M('podium', 16, 4.5, c, { bays: 4, floors: 1, ph: ph(r) }),
  midrise: (r?: Rng, c: C = WHITE) => M('midrise', 12.8, 12.8, c, { bays: 4, floors: 4, ph: ph(r) }),
  towerResi: (r?: Rng, c: C = WHITE) => M('towerResi', 12.8, 12.8, c, { bays: 8, floors: 4, ph: ph(r) }),
  megablock: (r?: Rng, c: C = WHITE) => M('megablock', 12, 12, c, { bays: 4, floors: 4, ph: ph(r) }),
  glassA: (r?: Rng, c: C = WHITE) => M('glassA', 12, 15.2, c, { bays: 8, floors: 4, ph: ph(r) }),
  glassB: (r?: Rng, c: C = WHITE) => M('glassB', 12, 15.2, c, { bays: 8, floors: 4, ph: ph(r) }),
  glassC: (r?: Rng, c: C = WHITE) => M('glassC', 12, 15.2, c, { bays: 8, floors: 4, ph: ph(r) }),
  officeBand: (r?: Rng, c: C = WHITE) => M('officeBand', 12, 14.4, c, { bays: 8, floors: 4, ph: ph(r) }),
  neon: (r?: Rng, c: C = WHITE) => M('neonFacade', 12, 14, c, { bays: 4, floors: 4, ph: ph(r) }),
  storefront: (r?: Rng, c: C = WHITE) => M('storefront', 8, 4, c, { bays: 2, floors: 1, ph: ph(r) }),
  officeLow: (r?: Rng, c: C = WHITE) => M('officeLow', 12, 3.6, c, { bays: 4, floors: 1, ph: ph(r) }),
  docks: (c: C = WHITE) => M('docks', 16, 5, c, { bays: 4, floors: 1 }),
  factoryWin: (r?: Rng, c: C = WHITE) => M('factoryWin', 16, 6, c, { bays: 4, floors: 1, ph: ph(r) }),
};

/** Floor-to-floor heights for the facade presets. */
export const FLOOR = { apt: 3, fiveOver: 3.2, podium: 4.5, midrise: 3.2, tower: 3.2, mega: 3, glass: 3.8, band: 3.6, neon: 3.5, shop: 4, office: 3.6 };

export const WALL = {
  concrete: (c: C = WHITE) => M('concrete', 4, 4, c),
  brick: (c: C = WHITE) => M('brick', 2, 2, c),
  brickTan: (c: C = WHITE) => M('brickTan', 2, 2, c),
  brickDark: (c: C = WHITE) => M('brickDark', 2, 2, c),
  stucco: (c: C = 0xece6da) => M('stucco', 4, 4, c),
  cinder: (c: C = WHITE) => M('cinder', 3.2, 3.2, c),
  tiltup: (c: C = WHITE) => M('tiltup', 8, 8, c),
  metalPanel: (c: C = WHITE) => M('metalPanel', 4, 4, c),
  corrugated: (c: C = WHITE) => M('corrugated', 4, 4, c),
  rusty: () => M('corrugatedRust', 4, 4),
  dc: (c: C = WHITE) => M('dcWall', 4, 4, c),
};

export const ROOF = {
  flat: (c: C = WHITE) => M('flatRoof', 8, 8, c),
  gravel: (c: C = WHITE) => M('gravelRoof', 8, 8, c),
  metal: (c: C = WHITE) => M('metalRoof', 4, 4, c),
  shingles: (c: C = 0xb0aaa4) => M('shingles', 4, 4, c),
};

/** A walled volume with facade on all four sides and optional flat roof + parapet. */
export function block(g: GenCtx, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, fac: Mat, o: { side?: Mat; roof?: Mat | null; parapet?: number; cap?: Mat } = {}) {
  const side = o.side ?? fac;
  g.mb.box(x0, x1, y0, y1, z0, z1, { f: fac, b: side, l: side, r: side, top: null });
  if (o.roof !== null) {
    if (o.parapet) g.mb.parapet(x0, x1, z0, z1, y1, o.parapet, o.cap ?? WALL.concrete(0xb8b4ac), o.roof ?? ROOF.flat());
    else g.mb.flat(x0, x1, z0, z1, y1, o.roof ?? ROOF.flat());
  }
}

/** Rooftop clutter scaled by level: HVAC, tanks, masts, dishes, billboards. */
export function roofJunk(g: GenCtx, x0: number, x1: number, z0: number, z1: number, y: number, amount = 1, o: { tanks?: number; billboards?: number; masts?: number } = {}) {
  const { rng } = g;
  const w = x1 - x0, d = z1 - z0;
  const n = Math.max(1, Math.round((w * d) / 90 * amount));
  for (let i = 0; i < n; i++) hvac(g, x0 + 1.5 + rng.float() * (w - 3), y, z0 + 1.5 + rng.float() * (d - 3), 0.8 + rng.float() * 0.5);
  for (let i = 0; i < (o.tanks ?? 0); i++) waterTank(g, x0 + 2.5 + rng.float() * Math.max(0.1, w - 5), y, z0 + 2.5 + rng.float() * Math.max(0.1, d - 5), 0.8 + rng.float() * 0.4);
  for (let i = 0; i < (o.masts ?? 0); i++) mast(g, x0 + 1 + rng.float() * (w - 2), y, z0 + 1 + rng.float() * (d - 2), 4 + rng.float() * 8);
  if (rng.chance(0.4 * amount)) dish(g, x0 + 1.2, y + 0.2, z1 - 1.2, 1);
  const bbFit = Math.max(0, Math.floor((d - 0.5) / 2.5)); // stacked billboards step back 2.5 m each
  for (let i = 0; i < Math.min(o.billboards ?? 0, bbFit); i++) {
    const bb = rng.pick(BILLBOARDS);
    const bw = Math.min(w - 1, 12 + rng.float() * 4);
    rooftopBillboard(g, (x0 + x1) / 2 + (rng.float() - 0.5) * (w - bw), y + i * (bw * 0.33 + 2.2), z1 - 1.5 - i * 2.5, bw, 'bb:' + bb.id);
  }
}

/** Balcony slabs with glass or iron rails on the +Z face. */
export function balconies(g: GenCtx, x0: number, x1: number, zFace: number, y0: number, floors: number, fh: number, bayW: number, o: { rail?: Mat; slab?: Mat; depth?: number; every?: number; skip?: number } = {}) {
  const { mb, rng } = g;
  const n = Math.max(1, Math.floor((x1 - x0) / bayW));
  const bw = (x1 - x0) / n;
  const slab = o.slab ?? M('concretePad', 4, 4, 0xd8d4cc, { ao: false });
  const rail = o.rail ?? M('plain', 2, 2, 0x2a2a2a, { ao: false });
  const dep = o.depth ?? 1.3;
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < n; i++) {
      if ((i + f) % (o.every ?? 1) !== 0 || rng.chance(o.skip ?? 0)) continue;
      const bx0 = x0 + i * bw + 0.35, bx1 = x0 + (i + 1) * bw - 0.35;
      const y = y0 + f * fh;
      mb.box(bx0, bx1, y, y + 0.18, zFace, zFace + dep, { f: slab, l: slab, r: slab, top: slab, bottom: slab, b: null });
      mb.box(bx0, bx1, y + 0.18, y + 1.05, zFace + dep - 0.05, zFace + dep, { f: rail, b: rail, l: rail, r: rail, top: rail });
    }
  }
}

/** Neon strip glowing at night (vertical sign blade). */
export function neonBlade(g: GenCtx, x: number, y: number, z: number, h: number, tile = 'neonPink') {
  g.mb.box(x - 0.15, x + 0.15, y, y + h, z, z + 0.9, { side: S(tile), top: S(tile) });
}

/** Cap a floor count so the tower stays within `k` x its narrowest footprint side. */
export function capFloors(floors: number, fh: number, W: number, D: number, base = 0, k = 7.5) {
  const maxH = k * Math.min(W, D);
  return Math.max(3, Math.min(floors, Math.floor((maxH - base) / fh)));
}

export function tint(c: number, k = 1): RGB {
  return mulRGB(rgb(c), k);
}
