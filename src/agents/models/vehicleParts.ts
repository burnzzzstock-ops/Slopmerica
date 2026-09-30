// Add-ons shared by many vehicles: light bars, roof racks, ladders, stacks, bumpers, bed rails, box bodies. Each takes the builder and
// dimensions and respects its level of detail.
import { boxG, cylG, ModelBuilder, ZONE, type V3 } from './vehicleKit';
import { beamG } from './vehicleBody';
import { endDecalG, sideDecalG, DECAL_TILE } from './vehicleDecals';

/** A roof light bar: red on one side, blue on the other (the sheriff, the tow truck's amber, the ambulance). */
export function lightBar(mb: ModelBuilder, y: number, z: number, halfW: number, opts: { red?: boolean; blue?: boolean; amber?: boolean; clear?: boolean } = { red: true, blue: true }): void {
  mb.add(boxG(halfW * 2, 0.045, 0.3, 0, y, z), 0x141516, ZONE.PLASTIC, 0);
  const n = mb.close ? 3 : 2, seg = (halfW * 2 - 0.1) / (n * 2);
  for (let i = 0; i < n * 2; i++) {
    const x = -halfW + 0.05 + seg * (i + 0.5);
    const left = i >= n;
    const zone = opts.amber ? ZONE.BEACON : left ? (opts.red !== false ? ZONE.SIREN_RED : ZONE.SIREN_BLUE) : (opts.blue !== false ? ZONE.SIREN_BLUE : ZONE.SIREN_RED);
    mb.add(boxG(seg * 0.92, 0.085, 0.27, x, y + 0.06, z), zone === ZONE.SIREN_RED ? 0xd0141f : zone === ZONE.SIREN_BLUE ? 0x1a5cff : 0xffb020, zone, 0);
    const lamp: V3 = [x, y + 0.1, z];
    mb.lamps.siren.push(lamp);
    if (zone === ZONE.SIREN_BLUE) mb.lamps.sirenBlue.push(lamp);
  }
  mb.lamps.beacon.push([0, y + 0.1, z]);
}

/** Ladder rack / roof rack: two rails and cross bars, at the given height over a z range. */
export function roofRack(mb: ModelBuilder, y: number, z0: number, z1: number, halfW: number, load?: 'ladder' | 'none'): void {
  for (const s of [-1, 1]) mb.add(boxG(0.04, 0.04, z0 - z1, s * halfW, y, (z0 + z1) / 2), 0x2a2d30, ZONE.PLASTIC, 0);
  const bars = mb.close ? 5 : 3;
  for (let i = 0; i < bars; i++) mb.add(boxG(halfW * 2, 0.035, 0.04, 0, y, z1 + ((z0 - z1) * i) / (bars - 1)), 0x2a2d30, ZONE.PLASTIC, 0);
  if (mb.lod < 2) for (const zz of [z0, z1]) for (const sx of [-1, 1]) mb.add(boxG(0.04, 0.16, 0.04, sx * halfW, y - 0.08, zz), 0x2a2d30, ZONE.PLASTIC, 0);
  if (load === 'ladder' && mb.lod < 2) {
    for (const s of [-1, 1]) mb.add(boxG(0.05, 0.07, (z0 - z1) * 1.05, s * halfW * 0.6, y + 0.07, (z0 + z1) / 2), 0xd0d3d6, ZONE.CHROME, 0);
    if (mb.close) for (let i = 0; i < 9; i++) mb.add(boxG(halfW * 1.2, 0.03, 0.03, 0, y + 0.07, z1 + ((z0 - z1) * i) / 8), 0xd0d3d6, ZONE.CHROME, 0);
  }
}

/** Two big vertical exhaust stacks behind a truck cab. */
export function stacks(mb: ModelBuilder, x: number, y0: number, y1: number, z: number): void {
  for (const s of [-1, 1]) {
    mb.add(cylG(0.075, 0.075, y1 - y0, mb.seg(10, 6), 'y', s * x, (y0 + y1) / 2, z, false), 0xb9bec2, ZONE.CHROME, 0);
    mb.add(cylG(0.085, 0.075, 0.06, mb.seg(10, 6), 'y', s * x, y1, z, false), 0x25272a, ZONE.PLASTIC, 0);
  }
}

/** A row of rounded ribs on a box body side, so a long flat wall reads as sheet metal. */
export function ribs(mb: ModelBuilder, x: number, y0: number, y1: number, z0: number, z1: number, step: number, color: number, zone: number = ZONE.PANEL): void {
  if (mb.lod > 0) return;
  for (let z = z0 + step / 2; z < z1; z += step) mb.add(boxG(0.02, y1 - y0, 0.05, x, (y0 + y1) / 2, z), color, zone, 0);
}

/** A hitch/tow receiver and a rear step bar. */
export function rearHitch(mb: ModelBuilder, y: number, z: number, w = 0.6): void {
  mb.add(boxG(w, 0.1, 0.16, 0, y, z), 0x1a1b1c, ZONE.STEEL, 0);
}

export { beamG, endDecalG, sideDecalG, DECAL_TILE };
export type { V3 };
