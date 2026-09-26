// Road frontage for special buildings (services, depots, landmarks): the spot
// where a building sits square to the nearest road, its front edge a short
// apron back from the curb, facing the street. The ghost, the placement
// check and the final building all use the same transform.
import { clamp, lerp, locate, pointAt, tangentAt, type V2 } from '../core/math';
import type { RoadNetwork, RSeg } from '../roads/network';
import { isZoned, type Buildings } from './buildings';

/** metres of apron between the road's edge and the building's front */
export const SETBACK = 2.5;

export interface Frontage {
  x: number;
  z: number;
  /** faces the road: local +z points at it */
  yaw: number;
  seg: RSeg;
  /** road surface height where the building meets it */
  roadY: number;
  /** the entrance: the middle of the front edge */
  door: V2;
}

/**
 * The frontage spot on the road nearest (x, z) within `reach` metres of its
 * edge, on the side of the road the point is on, for a building `hd` metres
 * deep (half-depth). `shift` slides it along the road. null = no road near.
 */
export function frontageAt(net: RoadNetwork, x: number, z: number, hd: number, reach: number, shift = 0): Frontage | null {
  const pick = net.pickSeg(x, z, reach);
  if (!pick || pick.seg.over) return null;
  return frontageOn(net, pick.seg, pick.s + shift, x, z, hd);
}

export function frontageOn(net: RoadNetwork, seg: RSeg, s: number, x: number, z: number, hd: number): Frontage | null {
  if (s < 0 || s > seg.length) return null;
  s = clamp(s, 0, seg.length);
  const p = pointAt(seg.samp, s);
  const t = tangentAt(seg.samp, s);
  let nx = -t.z, nz = t.x;
  if ((x - p.x) * nx + (z - p.z) * nz < 0) { nx = -nx; nz = -nz; }
  const edge = net.type(seg.type).width / 2 + SETBACK;
  const { i, f } = locate(seg.samp, s);
  const hs = seg.hs;
  const roadY = hs.length ? lerp(hs[Math.min(i, hs.length - 1)], hs[Math.min(i + 1, hs.length - 1)], f) : 0;
  return {
    x: p.x + nx * (edge + hd), z: p.z + nz * (edge + hd),
    yaw: Math.atan2(-nx, -nz), seg, roadY,
    door: { x: p.x + nx * edge, z: p.z + nz * edge },
  };
}

/**
 * Candidate frontage spots around the cursor, nearest first: the spot opposite
 * the cursor, then sliding along the same road both ways.
 */
export function* frontageCandidates(net: RoadNetwork, x: number, z: number, hd: number, reach: number, slide = 48): Generator<Frontage> {
  const pick = net.pickSeg(x, z, reach);
  if (!pick || pick.seg.over) return;
  for (let k = 0; k <= slide; k += 6) {
    for (const sgn of k ? [1, -1] : [1]) {
      const f = frontageOn(net, pick.seg, pick.s + sgn * k, x, z, hd);
      if (f) yield f;
    }
  }
}

export function rectCorners(x: number, z: number, hw: number, hd: number, yaw: number): V2[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => ({ x: x + a * c + b * s, z: z - a * s + b * c }));
}

export function inRect(px: number, pz: number, x: number, z: number, hw: number, hd: number, yaw: number, pad = 0): boolean {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = px - x, dz = pz - z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= hw + pad && Math.abs(lz) <= hd + pad;
}

/** Does a hw x hd footprint at (x, z, yaw) cover any road's pavement? */
export function footprintHitsRoad(net: RoadNetwork, x: number, z: number, hw: number, hd: number, yaw: number): boolean {
  const r = hw + hd + 14;
  for (const s of net.segsNear(x - r, z - r, x + r, z + r)) {
    const half = net.type(s.type).width / 2;
    for (const p of s.samp.pts) if (inRect(p.x, p.z, x, z, hw, hd, yaw, half)) return true;
  }
  return false;
}

/** The first building a footprint would overlap, if any. */
export function footprintHitsBuilding(bs: Buildings, x: number, z: number, hw: number, hd: number, yaw: number) {
  const cs = rectCorners(x, z, hw, hd, yaw);
  for (const b of bs.near(x, z, hw + hd + 40)) {
    if (cs.some((p) => bs.contains(b, p.x, p.z, 0.5)) || bs.corners(b).some((p) => inRect(p.x, p.z, x, z, hw, hd, yaw)) || bs.contains(b, x, z)) return b;
  }
  return null;
}

/** A service, depot or landmark already standing on a frontage spot, if any. */
export function specialAt(bs: Buildings, f: Frontage, hw: number, hd: number) {
  const b = footprintHitsBuilding(bs, f.x, f.z, hw, hd, f.yaw);
  return b && !isZoned(b) ? b : null;
}
