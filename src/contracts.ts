// Shared contracts between the parallel workstreams (core game / atmosphere+people /
// buildings+vehicles+brands+feed). Additive changes only. If you must change an
// existing signature, note it loudly in your final report.
import type * as THREE from 'three';
export type { MapId } from './world/maps';
import type { MapId } from './world/maps';

// ------------------------------------------------------------------ time
/**
 * Sim calendar. Day 0 is March 20 (first day of spring). One game day passes in
 * ~2.5 real seconds at 1x speed, so a year is ~15 minutes. `hour` is the VISUAL
 * clock for day/night lighting and runs on its own, slower cycle.
 */
export interface GameTime {
  day: number; // days since game start
  dayOfYear: number; // 0..364, 0 = Mar 20
  year: number; // 0-based
  hour: number; // 0..24 visual time of day
}

// ------------------------------------------------------------------ seasons & weather
export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export type WeatherKind =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'storm' // thunderstorm with lightning
  | 'snow'
  | 'blizzard'
  | 'fog'
  | 'heatwave'
  | 'hurricane' // Florida special
  | 'wildfireSmoke'; // NorCal special

/** Gameplay multipliers the sim reads from the weather system (1 = neutral). */
export interface WeatherEffects {
  speedMul: number; // traffic speed
  crashMul: number; // crash chance
  buildMul: number; // construction speed
  demandMul: number; // growth demand
  outdoorPeopleMul: number; // how many pedestrians are outside
}

// ------------------------------------------------------------------ zoning & buildings
export type ZoneType = 'resLow' | 'resHigh' | 'comLow' | 'comHigh' | 'industry' | 'office';
export const ZONE_TYPES: ZoneType[] = ['resLow', 'resHigh', 'comLow', 'comHigh', 'industry', 'office'];
export const MAX_LEVEL: Record<ZoneType, number> = { resLow: 5, resHigh: 5, comLow: 5, comHigh: 5, industry: 5, office: 5 };

/**
 * One building lot, in LOCAL space: footprint centered on the origin,
 * x in [-W/2, W/2] along the road frontage, z in [-D/2, D/2] with the ROAD on
 * the +Z side (the front door faces +Z). W = widthCells * 8, D = depthCells * 8.
 * y = 0 is the (flattened) ground.
 */
export interface LotSpec {
  zone: ZoneType;
  level: number; // 1..MAX_LEVEL[zone]
  widthCells: number; // 1..4
  depthCells: number; // 1..4
  seed: number;
  brand?: string; // brand id for commercial/industrial/office, chosen by the generator if omitted
}

export interface Emitter {
  kind: 'smoke' | 'steam' | 'fire' | 'cigarette' | 'sparkle';
  pos: [number, number, number]; // local space
}

export interface BuildingModel {
  /**
   * Merged, NON-INDEXED geometry in local space with exactly these attributes:
   * position(3), normal(3), uv(2), color(3). All building/billboard/landmark
   * geometries share one material (see buildingMaterial()) so the core game can
   * merge many of them into chunk meshes.
   */
  geometry: THREE.BufferGeometry;
  height: number;
  label: string; // display name, e.g. "Possum Pete's Gas-N-Go" or "The Vue @ Creekside"
  brand?: string;
  emitters: Emitter[];
}

export type LandmarkId =
  | 'slopCannon' // giant cannon, GET IN THE CANNON
  | 'slop69Field' // ballpark
  | 'pigCabanaResort'
  | 'neuralFlyDatacenter'
  | 'propaneParadise'
  | 'fillErUpMegaStation'
  | 'megachurch'
  | 'waterTower';

// ------------------------------------------------------------------ vehicles
export type VehicleKind =
  | 'sedan'
  | 'hatchback'
  | 'suv'
  | 'minivan'
  | 'pickup'
  | 'liftedTruck'
  | 'cyberslop'
  | 'semi'
  | 'boxTruck'
  | 'police'
  | 'ambulance'
  | 'firetruck'
  | 'golfCart'
  | 'vwBus'
  | 'slopVan'
  | 'motorcycle'
  | 'towTruck';

// ------------------------------------------------------------------ people
export type PersonAction =
  | 'walk'
  | 'run'
  | 'idle'
  | 'smoke'
  | 'drink'
  | 'vape'
  | 'phone'
  | 'protest'
  | 'dance'
  | 'drum'
  | 'yoga'
  | 'sit'
  | 'lie'
  | 'fight';

// ------------------------------------------------------------------ particles
export type ParticleKind = 'smoke' | 'cigarette' | 'fire' | 'dust' | 'spark' | 'steam' | 'confetti' | 'money' | 'splash';

// ------------------------------------------------------------------ feed ("X, formerly Chirper")
export type FeedEventKind =
  | 'gameStart'
  | 'roadBuilt'
  | 'stroadBuilt'
  | 'highwayBuilt'
  | 'bridgeBuilt'
  | 'laneAdded' // ONE MORE LANE
  | 'roadBulldozed'
  | 'zoned'
  | 'buildingOpened'
  | 'buildingLeveled'
  | 'buildingDemolished'
  | 'crash'
  | 'drunkCrash'
  | 'pedestrianHit'
  | 'trafficJam'
  | 'communeFound'
  | 'communeProtest'
  | 'communeBribed'
  | 'communeSued'
  | 'communeLawsuitLost'
  | 'communeForever'
  | 'treesCut'
  | 'natureMilestone'
  | 'populationMilestone'
  | 'sprawlMilestone'
  | 'maxLevelReached'
  | 'lowMoney'
  | 'bankrupt'
  | 'taxRaised'
  | 'taxCut'
  | 'seasonChange'
  | 'weatherChange'
  | 'nightfall'
  | 'merchDrop'
  | 'ambient';

export interface FeedContext {
  city: string;
  map: MapId;
  population: number;
  money: number;
  naturePct: number; // 0..1 trees remaining
  sprawlPct: number; // 0..1 toward the endless-sprawl ending
  season?: Season;
  weather?: WeatherKind;
  road?: string;
  brand?: string;
  building?: string;
  commune?: string;
  amount?: number;
  count?: number;
}

export interface FeedPost {
  name: string;
  handle: string; // without @
  badge: 'blue' | 'gold' | 'gray' | null;
  avatar: { bg: string; emoji?: string; archetype?: number };
  text: string;
  image?: { kind: 'aiSlop' | 'merch' | 'meme'; caption: string; brand?: string };
  note?: string; // Community Notes
  replies?: { handle: string; text: string }[];
  likes: number;
  reposts: number;
  views: number;
}

// ------------------------------------------------------------------ audio
export type SfxKind =
  | 'click'
  | 'build'
  | 'bulldoze'
  | 'zone'
  | 'cash'
  | 'error'
  | 'notify'
  | 'crash'
  | 'honk'
  | 'siren'
  | 'thunder'
  | 'cannon'
  | 'levelUp';

/** What the soundscape should reflect around the camera, each 0..1 unless noted. */
export interface SoundMix {
  zoom: number; // 0 close .. 1 far
  nature: number; // birds/insects/creek
  traffic: number;
  construction: number;
  people: number;
  night: number;
  weather: WeatherKind;
  weatherIntensity: number;
  season: Season;
}
