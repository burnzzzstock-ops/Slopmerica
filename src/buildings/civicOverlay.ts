// Silhouette overlays for the city services whose default looks (Asset Vault models) read as plain boxes from the
// street: the sheriff's substation, the pump station, the sewage outfall and the treatment plant. GRAPHICS ONLY (docs/
// GRAPHICS_HANDOFF.md, item 4): geometry added on top of what buildVault() has already built, in the lot's local space
// (origin at the middle of the lot, +z the street side, y up), through the same MeshBuilder and the same atlas tiles.
//
// Why an overlay and not a change to the pack: the pack (public/vault, packed by scripts/vault-pack.mjs, tested by
// scripts/vaulttest.mjs) is 4,000 assets shared with the rest of the game (zoned lots, roadside attractions). These four
// families are also the looks of the services only when a service asks for them, so the additions are made here, once
// per service model (the model is cached), and the pack, its format and its tests are untouched.
//
// The overlays are placed for the plan the game picks for each service's lot (D5-1, A5-1, C3-1, D4-2: the plan that fills
// the lot best, see generateVaultService). They are keyed on the plan's code, so a different pack that picks another plan
// gets no overlay rather than a misplaced one. No random draws: nothing here touches g.rng, so nothing else moves.
import { M, type Mat } from './mesh';
import type { GenCtx } from './props';

const brick = () => M('brickTan', 2, 2);
const concrete = () => M('concrete', 4, 4);
const galv = () => M('corrugated', 3, 3, 0xd4d8dc);
const dark = () => M('metalPanel', 3, 3, 0x454b52);
const roofMetal = () => M('metalRoof', 4, 4, 0x8a9096);
const plain = (c: number) => M('plain', 2, 2, c);

type Overlay = (g: GenCtx) => void;

/** vent grilles on a wall of a rooftop box: dark slots across the face */
function louvers(g: GenCtx, side: '+z' | '+x', at: number, along: number, y0: number, y1: number, w: number, mat: Mat) {
  const o = 0.03;
  if (side === '+z') g.mb.box(along - w / 2, along + w / 2, y0, y1, at, at + o, { side: mat, f: mat, b: null, l: null, r: null, top: null });
  else g.mb.box(at, at + o, y0, y1, along - w / 2, along + w / 2, { side: mat, f: null, b: null, l: null, r: mat, top: null });
}

// ------------------------------------------------------------------ sheriff's substation (plan D5-1, roof at 7.0)
const sheriff: Overlay = (g) => {
  const mb = g.mb;
  const RY = 6.95;
  // a clock / bell cupola on the roof (a courthouse-in-miniature), with a hip roof
  mb.box(-1.0, 2.0, RY, 10.8, -2.5, 0.5, { side: brick(), top: null });
  mb.box(-1.25, 2.25, 10.5, 10.95, -2.75, 0.75, { side: concrete(), top: concrete() });
  mb.hip(-1.0, 2.0, -2.5, 0.5, 10.95, 1.9, dark(), 0.3);
  louvers(g, '+z', 0.53, 0.5, 8.4, 9.9, 1.3, plain(0xf1efe6)); // the clock face
  louvers(g, '+x', 2.03, -1.0, 8.4, 9.9, 1.3, plain(0xf1efe6));
  mb.cyl(0.5, -1.0, 0.09, 12.8, 14.3, 6, plain(0xc8ccd0), null); // a small vane pole
  // rooftop plant either side of it, at two heights
  mb.box(-6.8, -3.2, RY, 8.65, 1.4, 3.6, { side: galv(), top: dark() });
  louvers(g, '+z', 3.63, -5.0, 7.3, 8.3, 2.4, dark());
  mb.cyl(-5.0, 2.5, 0.65, 8.65, 8.9, 10, dark(), dark());
  mb.box(2.3, 4.9, RY, 8.35, 1.1, 3.3, { side: galv(), top: dark() });
  louvers(g, '+z', 3.33, 3.6, 7.3, 8.1, 1.8, dark());
};

// ------------------------------------------------------------------ pump station (plan A5-1, roof at 5.93)
const pump: Overlay = (g) => {
  const mb = g.mb;
  const RY = 5.9;
  // a galvanised surge tank standing on the roof on a concrete ring, domed
  mb.cyl(3.4, -3.0, 2.0, RY, RY + 0.6, 14, concrete(), concrete());
  mb.cyl(3.4, -3.0, 1.75, RY + 0.6, 9.4, 14, galv(), null);
  mb.cyl(3.4, -3.0, 1.85, 8.6, 8.85, 14, dark(), null); // a band
  mb.lathe(3.4, -3.0, [[1.85, 9.4], [1.45, 10.0], [0.0001, 10.8]], 14, dark());
  mb.cyl(3.4, -3.0, 0.14, 10.7, 12.0, 6, plain(0xc8ccd0), null); // its vent pipe
  // a vent penthouse with a shed roof, louvred on the street side
  mb.box(-5.3, -1.9, RY, 7.65, 1.3, 3.9, { side: brick(), top: null });
  mb.shed(-5.3, -1.9, 1.3, 3.9, 7.65, 0.6, roofMetal(), brick(), 0.25);
  louvers(g, '+z', 3.93, -3.6, 6.3, 7.3, 2.2, dark());
};

// ------------------------------------------------------------------ sewage outfall (plan C3-1, headwall top at 5.53)
const outfall: Overlay = (g) => {
  const mb = g.mb;
  // a gauge house on the headwall
  mb.box(-4.6, -1.4, 5.5, 7.7, -7.25, -6.05, { side: galv(), top: null });
  mb.shed(-4.6, -1.4, -7.25, -6.05, 7.7, 0.55, roofMetal(), galv(), 0.2);
  // a stink stack at the end of the wall, banded
  mb.cyl(5.7, -6.75, 0.7, 5.5, 11.4, 12, concrete(), null);
  mb.cyl(5.7, -6.75, 0.76, 9.4, 10.0, 12, plain(0xc8102e), null);
  mb.cyl(5.7, -6.75, 0.76, 10.0, 10.6, 12, plain(0xf1efe6), null);
  mb.cyl(5.7, -6.75, 0.85, 11.2, 11.6, 12, dark(), dark());
  // a trash-rack walkway across the three pipes, on two piers, with an open rail (top bar and posts)
  mb.box(-4.7, 4.7, 4.0, 4.3, -2.5, -0.7, { side: dark(), top: dark() });
  for (const x of [-1.75, 1.75]) mb.box(x - 0.35, x + 0.35, 0.0, 4.0, -2.3, -0.9, concrete());
  const rail = plain(0xd8b21a);
  for (const z of [-2.45, -0.75]) {
    mb.box(-4.7, 4.7, 5.1, 5.22, z - 0.05, z + 0.05, rail);
    for (let i = 0; i <= 5; i++) mb.box(-4.7 + i * 1.88 - 0.05, -4.7 + i * 1.88 + 0.05, 4.3, 5.1, z - 0.05, z + 0.05, rail);
  }
};

// ------------------------------------------------------------------ treatment plant (plan D4-2, office roof at 5.98)
const plant: Overlay = (g) => {
  const mb = g.mb;
  // two egg-shaped digesters behind the basins, with gas domes
  for (const x of [-13.5, -4.5]) {
    mb.lathe(x, -9.5, [[3.8, 0.1], [3.8, 6.2], [3.4, 7.1], [2.4, 8.2], [1.2, 9.0], [0.0001, 9.4]], 18, concrete(), { capBottom: null });
    mb.cyl(x, -9.5, 0.95, 9.3, 10.2, 10, galv(), null);
    mb.cone(x, -9.5, 1.05, 10.2, 0.6, 10, dark());
    mb.cyl(x, -9.5, 3.86, 4.2, 4.5, 18, dark(), null); // a rib
  }
  // the exhaust stack behind the office
  mb.cyl(16.6, -10.5, 1.35, 0, 2.5, 12, concrete(), concrete());
  mb.cyl(16.6, -10.5, 0.9, 2.5, 15.5, 12, concrete(), null);
  mb.cyl(16.6, -10.5, 0.96, 12.0, 12.8, 12, plain(0xc8102e), null);
  mb.cyl(16.6, -10.5, 0.96, 12.8, 13.6, 12, plain(0xf1efe6), null);
  mb.cyl(16.6, -10.5, 1.0, 15.0, 15.5, 12, dark(), dark());
  // a sludge thickener at the front: a low round tank with a bridge across it
  mb.cyl(12.8, 8.6, 3.0, 0.1, 3.4, 16, concrete(), plain(0x5a6a3a));
  mb.box(9.6, 16.0, 3.4, 3.75, 8.3, 8.9, { side: dark(), top: dark() });
};

const OVERLAYS: Record<string, Overlay> = {
  'sheriff-substation|D5-1': sheriff,
  'pump-station|A5-1': pump,
  'sewage-outfall|C3-1': outfall,
  'wastewater-plant|D4-2': plant,
};

/** Add the silhouette overlay for this service look, if there is one for this plan. Returns whether it did. */
export function civicOverlay(g: GenCtx, family: string, plan: string): boolean {
  const o = OVERLAYS[`${family}|${plan}`];
  if (!o) return false;
  o(g);
  return true;
}
