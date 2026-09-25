// Roadside billboards on poles, facing +Z. The design comes from art/billboards.ts;
// seed picks the design (seed mod set size) and the structure.
import { BILLBOARDS, BillboardDef } from '../art/billboards';
import { M, S } from './mesh';
import type { GenCtx } from './props';

const FACE_W = 12; // meters; faces keep the 512:160 atlas aspect

/** Stable seed -> design mapping, split into the merch and non-merch sets. */
export function billboardFor(seed: number, merch: boolean): BillboardDef {
  const set = BILLBOARDS.filter((b) => !!b.merch === merch);
  const i = ((seed % set.length) + set.length) % set.length;
  return set[i];
}

function face(g: GenCtx, x: number, y: number, w: number, def: BillboardDef, back: BillboardDef | null) {
  const { mb } = g;
  const h = w * (160 / 512);
  const frame = M('metal', 2, 2, 0x4a4e52);
  mb.box(x - w / 2 - 0.2, x + w / 2 + 0.2, y - 0.2, y + h + 0.2, -0.35, 0.05, { f: frame, b: back ? frame : M('bb:back', 4, 1.25), l: frame, r: frame, top: frame, bottom: frame });
  mb.panelZ(x, 0.1, w, y, y + h, S('bb:' + def.id));
  if (back) mb.panelZ(x, -0.4, w, y, y + h, S('bb:' + back.id), true);
  // catwalk + floodlights on arms
  mb.box(x - w / 2, x + w / 2, y - 0.35, y - 0.2, 0.05, 1.0, { side: M('grille', 2, 2, 0x6a6e72), top: M('grille', 2, 2, 0x6a6e72) });
  const n = Math.max(2, Math.round(w / 4));
  for (let i = 0; i < n; i++) {
    const lx = x - w / 2 + ((i + 0.5) * w) / n;
    mb.box(lx - 0.05, lx + 0.05, y + h + 0.2, y + h + 0.3, 0, 1.3, M('metal', 2, 2, 0x3a3e42));
    mb.box(lx - 0.35, lx + 0.35, y + h + 0.05, y + h + 0.35, 1.1, 1.5, { side: M('plain', 2, 2, 0x333333), top: M('plain', 2, 2, 0x333333), bottom: S('lampWhite') });
  }
}

export function buildBillboard(g: GenCtx, merch: boolean) {
  const { mb, rng, spec } = g;
  const def = billboardFor(spec.seed, merch);
  const style = merch ? 'monopole' : rng.pick(['monopole', 'monopole', 'monopole', 'wood', 'wood']);
  const steel = M('metal', 2, 2, 0x8a8e92);
  const pair = def.pair ? BILLBOARDS.find((b) => b.id === def.pair) : undefined;
  const others = BILLBOARDS.filter((b) => !b.merch && b.id !== def.id && !b.pair);
  const back = rng.chance(0.5) ? rng.pick(others) : null;
  if (pair) {
    // HELL IS REAL, right next to ADULT SUPERSTORE: one wide double structure
    const y = 9;
    mb.boxC(0, -0.8, 1.1, 1.1, 0, y, { side: steel, top: null });
    mb.box(-FACE_W - 0.4, FACE_W + 0.4, y - 0.6, y - 0.2, -0.9, -0.5, steel);
    face(g, -FACE_W / 2 - 0.2, y, FACE_W, def.id === 'hellIsReal' ? def : pair, null);
    face(g, FACE_W / 2 + 0.2, y, FACE_W, def.id === 'hellIsReal' ? pair : def, null);
    g.label = `Billboards: ${def.label} / ${pair.label}`;
    return;
  }
  if (style === 'wood') {
    const y = 3 + rng.float() * 1.5, w = FACE_W * 0.8;
    const wood = M('wood', 4, 4, 0x8a7058);
    for (const px of [-w * 0.32, w * 0.32]) mb.boxC(px, -0.6, 0.35, 0.35, 0, y + w * 0.3, { side: wood, top: wood });
    face(g, 0, y, w, def, back);
    g.label = `Billboard: ${def.label}`;
    return;
  }
  const y = 10 + rng.float() * 5;
  mb.lathe(0, -0.9, [[0.75, 0], [0.55, y]], 8, steel);
  mb.box(-1.2, 1.2, y - 0.8, y - 0.2, -1.5, -0.3, steel);
  face(g, 0, y, FACE_W, def, back);
  g.label = merch ? `Imagine Supply Co. billboard: ${def.label}` : `Billboard: ${def.label}`;
}
