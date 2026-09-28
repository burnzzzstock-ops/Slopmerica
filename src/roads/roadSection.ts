// The road cross-section, shared by everything that stands on or beside a road.
//
// Across a road with sidewalks, from the middle out (per side):
//
//   carriageway   asphalt, to carriageHalf(t)
//   gutter        a 0.30 m concrete pan at road level (the texture paints it)
//   curb face     a vertical step of CURB_REVEAL up to the walk
//   sidewalk      flat at WALK_TOP above the road's height, to the ribbon edge
//   verge         a short earth bank from the walk's edge down to the graded
//                 ground (terrain.gradeRoad leaves it GROUND_BELOW under the road)
//
// A driveway lowers the curb to (almost) road level with a ramp into the walk
// and short flares either side (segDriveways in roadMesh.ts says where).
//
// Heights are metres above the road's height `hs` (seg.hs). The road surface
// itself sits SURF_LIFT above it, so the walk is CURB_REVEAL above that.
import type { RoadType } from './roadTypes';
import { carriageHalf } from './roadTypes';

export const SURF_LIFT = 0.06;
/** curb face height (a 5 inch reveal, a little under the usual 6 so a walker's feet stay in the model's step) */
export const CURB_REVEAL = 0.12;
/** the sidewalk's top, above seg.hs: what walkers, benches and street trees stand on */
export const WALK_TOP = SURF_LIFT + CURB_REVEAL;
/** the concrete gutter pan between the carriageway and the curb (the road texture's 0.3 m past carriageHalf) */
export const GUTTER = 0.3;
/** graded ground sits this far under seg.hs beside a road (terrain.gradeRoad's target) */
export const GROUND_BELOW = 0.35;
/** lateral run of the earth bank from the walk's edge down to the graded ground */
export const VERGE_RUN = 0.8;
/** the curb's height where a driveway crosses it */
export const DRIVE_LIP = 0.012;
/** driveway: the ramp's flat part is DRIVE_FLAT either side of its centre, then it flares out over DRIVE_FLARE more */
export const DRIVE_FLAT = 1.2;
export const DRIVE_FLARE = 1.2;

/** lateral position of the curb face (the road's edge for a road without sidewalks) */
export function curbOffset(t: RoadType): number {
  return t.sidewalk > 0 ? carriageHalf(t) + GUTTER : t.width / 2;
}

/** how far into the walk a driveway's ramp reaches from the curb */
export function driveRamp(t: RoadType): number {
  return Math.min(0.9, t.sidewalk * 0.6);
}

/** curb height at arc length `d` on one side, given that block's driveways */
export function curbLipAt(drives: { d: number; side: number }[], side: number, d: number): number {
  let lip = CURB_REVEAL;
  for (const dr of drives) {
    if (dr.side !== side) continue;
    const e = Math.abs(dr.d - d);
    if (e >= DRIVE_FLAT + DRIVE_FLARE) continue;
    const k = e <= DRIVE_FLAT ? 0 : (e - DRIVE_FLAT) / DRIVE_FLARE;
    lip = Math.min(lip, DRIVE_LIP + (CURB_REVEAL - DRIVE_LIP) * k);
  }
  return lip;
}

/**
 * Height above seg.hs of the ground beside a road at lateral offset `off` from
 * its centreline: the walk (or the road's edge) out to the ribbon's edge, then
 * the earth bank, then the graded ground. Signs, hydrants and poles stand on it.
 */
export function edgeLift(t: RoadType, off: number): number {
  const hw = t.width / 2, top = t.sidewalk > 0 ? WALK_TOP : SURF_LIFT;
  const o = Math.abs(off);
  if (o <= hw) return top;
  const k = Math.min(1, (o - hw) / VERGE_RUN);
  return top + (-GROUND_BELOW - 0.02 - top) * k;
}
