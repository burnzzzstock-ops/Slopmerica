import type { BuildingModel } from '../contracts';

/** A stable visual height for equal towers, independent of order and neighbors.
 * Odd multipliers and reversible xor shifts permute the saved 32-bit identities,
 * avoiding the repeated height pattern of a single linear multiplication. */
export function towerInstanceScale(id: number): number {
  let signature = id | 0;
  signature = Math.imul(signature ^ (signature >>> 16), 0x7feb352d);
  signature = Math.imul(signature ^ (signature >>> 15), 0x846ca68b);
  signature = (signature ^ (signature >>> 16)) >>> 0;
  return 0.94 + signature / 0xffffffff * 0.12;
}

/** The batch keeps sharing its original vertices. Only rendered height and
 * emitter positions follow the instance matrix; parking retains its exact data. */
export function scaledTowerModel(source: BuildingModel, scale: number): BuildingModel {
  return { ...source, height: source.height * scale,
    emitters: source.emitters.map(emitter => ({ ...emitter,
      pos: [emitter.pos[0], emitter.pos[1] * scale, emitter.pos[2]] })) };
}
