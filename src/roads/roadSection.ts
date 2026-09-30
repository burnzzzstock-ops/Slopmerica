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

// ---------------------------------------------------------------- junction corners and markings
//
// Everything below is drawing only. The cars run on the network's own numbers (seg.trimA / trimB, laneOffset, the curves
// traffic.ts builds between them) and nothing here may move those: roadJunction.ts reads them, it never writes them.
//
// Curb returns. Real kerb-return radii at a right-angle corner (recalled from NACTO's Urban Street Design Guide, the FHWA
// intersection primer and ITE's residential street guidance, see docs/cars-look/junction.md): local streets 3 to 4.5 m
// (dense urban 1.5 to 3), collectors about 6, arterials 7.5 to 12 m. A US local street is 8 to 9 m wide with a parked lane
// each side, so its curb radius of 4.5 m is an effective turning radius near 7. These roads have no parked lane, so the
// curb carries the whole turn: the radius below is about the smallest that still leaves the game's own turning curves (the
// cubic each car follows from one leg's stop line to the next leg's entry, traffic.ts) 1.3 m of asphalt between the curve
// and the kerb, i.e. 0.35 m to spare beside a 1.9 m car, at every junction angle (scripts/junctionmouth.mjs --sweep).
/** kerb radius of a right-angle corner between two roads: bounds of the value curbReturnRadius starts from */
export const CORNER_R_MIN = 2.4;
export const CORNER_R_MAX = 3.6;
/** the smallest arc worth drawing: a corner that would need less stays a plain chamfer between the two kerbs */
export const FILLET_MIN = 1.5;
/** the biggest a kerb return may get, as a multiple of its right-angle radius (a very obtuse corner's arc is nearly straight) */
export const CORNER_R_STRETCH = 2.4;
/** how much asphalt (m) must lie between the cars' turning curves and the kerb: half a 1.9 m car plus 0.35 m; a corner whose
 * formula radius leaves less is rounded wider, up to CORNER_R_GROW, where the room and the walk's corner allow */
export const CAR_CLEAR = 1.3;
export const CORNER_R_GROW = 7;

/**
 * Curb-return radius for the corner between two legs whose curb lines are `ei` and `ej` from their centrelines, with the
 * corner spanning `phi` radians (90 degrees = square).
 *
 * At a right angle it is 3 m between two-lane streets (was 5), 3.6 m where a two-lane street meets a stroad and 3.6 m
 * between stroads, so a big road does not get a big flare: the smaller of the two roads counts three times as much as the
 * bigger, because the wide road's extra lanes give a turning car room to swing.
 *
 * Across the angle the flare keeps one length, the tangent distance T = r / tan(phi/2) = the right-angle radius: an acute
 * corner gets a small radius (its tip is far from the cars' curves), an obtuse corner a bigger one (the game's turning
 * curves cut close to an obtuse corner's apex, so it needs the asphalt), and the area of the flare stays about the same.
 */
export function curbReturnRadius(ei: number, ej: number, phi: number): number {
  const lo = Math.min(ei, ej), hi = Math.max(ei, ej);
  const r90 = Math.min(CORNER_R_MAX, Math.max(CORNER_R_MIN, 0.35 + 0.7 * (0.75 * lo + 0.25 * hi)));
  return Math.min(r90 * CORNER_R_STRETCH, r90 * Math.tan(phi / 2));
}

/** Zebra crossing and stop bar (metres). The crosswalk sits this far past the crossing road's kerb line ... */
export const ZEBRA_SETBACK = 0.45;
/** ... is this wide (the MUTCD's minimum for a crosswalk is 1.8 m; 2.4 is the usual ladder)... */
export const ZEBRA_MIN = 1.8, ZEBRA_MAX = 2.4;
/** ... and ends this far short of a stopped car's nose. The network stops a car's centre 1.5 m short of its trim, so a
 * 4.5 m car's nose is about NOSE_BACK short of the trim: that is where the stop bar goes. */
export const NOSE_BACK = 0.75;
export const ZEBRA_CLEAR = 0.85;
/** the transverse line at each end of a crosswalk is this deep; the textured strip between them stops short of it */
export const ZEBRA_EDGE = 0.26;
/** the stop bar's depth is 0.37 m; it sits STOP_GAP behind the zebra's far edge */
export const STOP_GAP = 0.6;

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
