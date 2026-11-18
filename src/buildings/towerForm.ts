// Tower massing is cosmetic: hash the model's existing random state without
// advancing it. Raw lot seeds cannot be used here because the model cache
// deliberately shares a look between several lot seeds.
import { hash2 } from '../core/rng';
import { M, type MB, type Mat } from './mesh';

export type Plate = { x0: number; x1: number; z0: number; z1: number };
type TowerForm = { kind: number; width: number; depth: number; shoulder: number };

export function towerForm(state: number, W: number, D: number): TowerForm {
  return { kind: Math.floor(hash2(W, D, state) * 6),
    width: 0.75 + hash2(W, D, state ^ 0x7f4a) * 0.5,
    depth: 0.75 + hash2(W, D, state ^ 0x2e31) * 0.5,
    shoulder: (hash2(W, D, state ^ 0x61c9) - 0.5) * 0.12 };
}

/** A readable street wall below a shaft that occupies 75–85% of each side. */
export function towerShaft(p: Plate, form: TowerForm): Plate {
  const width = p.x1 - p.x0, depth = p.z1 - p.z0;
  const insetX = width * (1 - (0.75 + (form.width - 0.75) * 0.2));
  const insetZ = depth * (1 - (0.75 + (form.depth - 0.75) * 0.2));
  const biasX = [0.5, 0.7, 0.3, 0.5, 0.65, 0.5][form.kind];
  const biasZ = [0.5, 0.5, 0.5, 0.7, 0.65, 0.5][form.kind];
  return { x0: p.x0 + insetX * biasX, x1: p.x1 - insetX * (1 - biasX),
    z0: p.z0 + insetZ * biasZ, z1: p.z1 - insetZ * (1 - biasZ) };
}

/** Existing atlas materials, a ground-floor shopfront and a low stone cornice. */
export function towerPodium(mb: MB, p: Plate, height: number, shop: Mat, brick: Mat) {
  const { x0, x1, z0, z1 } = p;
  mb.box(x0, x1, 0, 4, z0, z1, { f: shop, side: brick, top: null });
  mb.box(x0, x1, 4, height - 0.35, z0, z1, { side: brick, top: null });
  // The cornice stays inside the old lot bounds; the wall below is recessed.
  const trim = M('plain', 0, 0, 0xcac1ac);
  mb.box(x0 - 0.12, x1 + 0.12, height - 0.35, height, z0 - 0.12, z1 + 0.12,
    { side: trim, top: M('gravelRoof', 8, 8, 0xaaa79b) });
}

/** Six silhouettes: centred tiers, left/right shoulder, slab, corner and needle. */
export function setback(p: Plate, form: TowerForm, amount = 1): Plate {
  const margins = [
    [0.15, 0.15, 0.15, 0.15], [0.29, 0.05, 0.12, 0.12],
    [0.05, 0.29, 0.12, 0.12], [0.09, 0.09, 0.31, 0.07],
    [0.24, 0.06, 0.24, 0.06], [0.21, 0.21, 0.19, 0.19],
  ][form.kind];
  // On narrow infill a shoulder still reads, but keep a usable core.
  const w = p.x1 - p.x0, d = p.z1 - p.z0;
  const ax = Math.min(amount * form.width, Math.max(0, w - 3.2) / (w * (margins[0] + margins[1])));
  const az = Math.min(amount * form.depth, Math.max(0, d - 3.2) / (d * (margins[2] + margins[3])));
  return { x0: p.x0 + w * margins[0] * ax, x1: p.x1 - w * margins[1] * ax,
    z0: p.z0 + d * margins[2] * az, z1: p.z1 - d * margins[3] * az };
}

/** Refit existing rooftop equipment without changing its random draw count. */
export function fitPlate(mb: MB, from: Plate, to: Plate) {
  // Old neon crowns could have inverted depth on a 4x1 lot. Never amplify or
  // mirror their equipment when fitting it to the now-valid narrow roof.
  mb.push().translate((to.x0 + to.x1) / 2, 0, (to.z0 + to.z1) / 2)
    .scale(Math.min(1, (to.x1 - to.x0) / Math.max(3.2, from.x1 - from.x0)), 1,
      Math.min(1, (to.z1 - to.z0) / Math.max(3.2, from.z1 - from.z0)))
    .translate(-(from.x0 + from.x1) / 2, 0, -(from.z0 + from.z1) / 2);
}

export function shoulderHeight(form: TowerForm) {
  return [0.46, 0.62, 0.76, 0.68, 0.54, 0.82][form.kind] + form.shoulder;
}
