import type { BuildingModel } from '../contracts';
import { col, Kit } from './kit';
import { T } from './atlas';

/** A deliberately municipal bus garage, complete with three bays and two buses that already need washing. */
export function busDepotModel(): BuildingModel {
  const k = new Kit();
  const concrete = col(0xb8b3a8);
  const dark = col(0x292b31);
  const slopBlue = col(0x1777a8);
  const busWhite = col(0xe7e9e5);
  const yellow = col(0xf1c232);

  k.slab(-20, -16, 20, 16, 0.04, T.PARKING, col(0x8f8d87));
  k.box(0, -3, 38, 23, 0.05, 8.2, [T.GARAGE, T.CONCRETE, T.CONCRETE, T.CONCRETE], concrete, T.ROOF_FLAT, dark, { fit: true });
  // Three oversized bay doors across the public-facing wall.
  for (const x of [-12, 0, 12]) {
    k.box(x, 8.62, 8.5, 0.24, 0.15, 6.5, T.GARAGE, col(0x676b70), T.METAL, dark, { ao: false });
    k.box(x, 8.82, 0.3, 0.3, 0.15, 7.2, T.SOLID, yellow, T.SOLID, yellow, { ao: false });
  }
  // Parked buses make the purpose legible even before the player opens the inspector.
  for (const x of [-7, 7]) {
    k.box(x, 12.3, 3.1, 7.5, 0.12, 2.45, T.SOLID, busWhite, T.ROOF_FLAT, busWhite, { ao: false });
    k.box(x, 15.55, 2.75, 0.12, 1.05, 2.15, T.CAR_GLASS, dark, null, dark, { ao: false });
    k.box(x, 12.3, 3.16, 0.12, 0.8, 1.25, T.SOLID, slopBlue, null, slopBlue, { ao: false });
    for (const dz of [-2.3, 2.3]) for (const dx of [-1.58, 1.58]) k.cyl(x + dx, 12.3 + dz, 0.42, 0.05, 0.75, 8, T.SOLID, dark);
  }
  // The atlas has no transit sign slot; a bright physical signboard still reads as civic branding.
  k.box(0, 8.85, 25, 0.45, 8.6, 11.6, T.SOLID, slopBlue, T.METAL, dark, { ao: false });
  for (const x of [-10, -6, -2, 2, 6, 10]) k.glowBox(x, 10.15, 9.1, 0.55, 'glowWarm', 2.2);
  k.cyl(-17, -12, 0.22, 0, 9, 8, T.METAL, dark);
  k.cyl(17, -12, 0.22, 0, 9, 8, T.METAL, dark);

  return { geometry: k.build(), height: 12, label: "SLOP TRANSIT — We're Basically Uber", emitters: [] };
}
