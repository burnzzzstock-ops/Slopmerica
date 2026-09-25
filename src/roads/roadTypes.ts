// Road catalog. The One More Lane button walks up the `next` chain.

export type RoadTypeId = 'gravel' | 'twoLane' | 'stroad4' | 'stroad6' | 'stroad8' | 'highway';

export interface RoadType {
  id: RoadTypeId;
  name: string;
  blurb: string;
  lanesPerDir: number;
  laneW: number;
  centerTurn: boolean; // the "suicide lane"
  median: number; // divided highway median width
  sidewalk: number; // per side, 0 = none
  width: number; // total
  speed: number; // m/s free-flow
  costPerM: number;
  upkeepPerM: number; // $ per meter per game week
  zoneable: boolean;
  signals: boolean; // gets traffic lights at 3+ way junctions
  capacityPerLane: number; // vehicles per hour
  fedGrant: number; // share of construction the feds pay (the Ponzi)
  next?: RoadTypeId;
  unlockPop: number;
  icon: string;
}

function mk(t: Omit<RoadType, 'width'>): RoadType {
  const lanes = t.lanesPerDir * 2 * t.laneW + (t.centerTurn ? t.laneW : 0) + t.median;
  return { ...t, width: lanes + t.sidewalk * 2 + 0.6 };
}

export const ROAD_TYPES: Record<RoadTypeId, RoadType> = {
  gravel: mk({
    id: 'gravel', name: 'Holler Gravel Road', blurb: 'Dirt cheap. Literally dirt.', lanesPerDir: 1, laneW: 3.2, centerTurn: false, median: 0,
    sidewalk: 0, speed: 11, costPerM: 3, upkeepPerM: 0.12, zoneable: true, signals: false, capacityPerLane: 500, fedGrant: 0, next: 'twoLane', unlockPop: 0, icon: '🪨',
  }),
  twoLane: mk({
    id: 'twoLane', name: 'Two-Lane Road', blurb: 'Sidewalks! How European.', lanesPerDir: 1, laneW: 3.5, centerTurn: false, median: 0,
    sidewalk: 2.6, speed: 14, costPerM: 8, upkeepPerM: 0.35, zoneable: true, signals: false, capacityPerLane: 800, fedGrant: 0, next: 'stroad4', unlockPop: 0, icon: '🛣️',
  }),
  stroad4: mk({
    id: 'stroad4', name: 'Freedom Stroad', blurb: '4 lanes + a center turn lane. Half street, half road, bad at both.', lanesPerDir: 2, laneW: 3.5, centerTurn: true, median: 0,
    sidewalk: 1.6, speed: 20, costPerM: 22, upkeepPerM: 1.0, zoneable: true, signals: true, capacityPerLane: 900, fedGrant: 0.5, next: 'stroad6', unlockPop: 0, icon: '🇺🇸',
  }),
  stroad6: mk({
    id: 'stroad6', name: 'MEGA Stroad', blurb: '6 lanes. It will fix traffic this time.', lanesPerDir: 3, laneW: 3.5, centerTurn: true, median: 0,
    sidewalk: 1.4, speed: 22, costPerM: 40, upkeepPerM: 1.7, zoneable: true, signals: true, capacityPerLane: 950, fedGrant: 0.8, next: 'stroad8', unlockPop: 600, icon: '🦅',
  }),
  stroad8: mk({
    id: 'stroad8', name: 'Katy Stroad', blurb: '8 lanes + turn lane. Everything is bigger. Including the commute.', lanesPerDir: 4, laneW: 3.5, centerTurn: true, median: 0,
    sidewalk: 1.2, speed: 24, costPerM: 62, upkeepPerM: 2.6, zoneable: true, signals: true, capacityPerLane: 950, fedGrant: 0.8, unlockPop: 2500, icon: '🤠',
  }),
  highway: mk({
    id: 'highway', name: 'Slopway (I-69)', blurb: 'Divided highway. No zoning, no driveways, no mercy.', lanesPerDir: 3, laneW: 3.6, centerTurn: false, median: 3,
    sidewalk: 0, speed: 31, costPerM: 70, upkeepPerM: 3.4, zoneable: false, signals: false, capacityPerLane: 1900, fedGrant: 0.9, unlockPop: 1500, icon: '🚀',
  }),
};

export const ROAD_ORDER: RoadTypeId[] = ['gravel', 'twoLane', 'stroad4', 'stroad6', 'stroad8', 'highway'];

/** Lateral offset (right of centerline, meters) of lane k (0 = innermost) for travel in +tangent direction. */
export function laneOffset(t: RoadType, k: number): number {
  const inner = (t.centerTurn ? t.laneW / 2 : 0) + t.median / 2;
  return inner + (k + 0.5) * t.laneW;
}

/** Outer edge of the driving surface (where the sidewalk starts). */
export function carriageHalf(t: RoadType): number {
  return t.lanesPerDir * t.laneW + (t.centerTurn ? t.laneW / 2 : 0) + t.median / 2;
}
