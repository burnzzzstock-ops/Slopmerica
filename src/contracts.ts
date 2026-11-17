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
  /** chimney: wood-stove / fireplace smoke, only when it's cold enough to light one */
  kind: 'smoke' | 'chimney' | 'steam' | 'fire' | 'cigarette' | 'sparkle';
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
  /**
   * Where live cars park, in local space like the geometry (traffic pass,
   * audit round 7 #6): lot stalls and driveways ('stall', 'drive'), and a
   * drive-thru lane in queue order from the window back ('thru', `q` 0 = at the
   * window), then the way out after it ('out', in order). The baked cars these
   * replace are left out of the geometry. Missing: no live parking there.
   */
  spots?: ParkSpot[];
}

/** A place a car parks or queues on a lot: local x, z and the way the car faces (see BuildingModel.spots). */
export interface ParkSpot {
  x: number;
  z: number;
  yaw: number;
  kind: 'stall' | 'drive' | 'thru' | 'out';
  /** drive-thru lanes: which lane (a kiosk can have two), and the place in it */
  lane?: number;
  q?: number;
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
  | 'towTruck'
  | 'cityBus'
  | 'garbageTruck';

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
  | 'driveThruLine' // traffic pass: a drive-thru line spilled onto the road (plain line; the owner's to reword)
  | 'drunkCrash'
  | 'pedestrianHit'
  | 'trafficJam'
  | 'communeFound'
  | 'communeProtest'
  | 'communeBribed'
  | 'communeSued'
  | 'communeLawsuitLost' // the commune lost the county's lawsuit and has to go
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
  | 'ambient'
  // city services (src/sim/services.ts)
  | 'serviceBuilt'
  | 'blackout'
  | 'waterOutage'
  | 'sewageBackup'
  | 'garbagePile'
  | 'landfillFull'
  | 'buildingFire'
  | 'buildingBurned'
  | 'abandoned'
  | 'crimeWave'
  | 'sickness'
  | 'pollution';

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
  /** 0..1: how much water is around the view (the creek bed) */
  water?: number;
  traffic: number;
  construction: number;
  people: number;
  night: number;
  weather: WeatherKind;
  weatherIntensity: number;
  season: Season;
}

// ------------------------------------------------------------------ world events (the simulation -> what shows and sounds it)
/**
 * What happens in the world, said once, for anything that shows or sounds it. The simulation emits these on
 * `game.sim.events` (the same bus as its 'day', 'week' and 'milestone'); renderers, effects and audio subscribe.
 * A handler must never change the simulation: the same city has to come out with nobody listening.
 *
 * Positions are world metres (x and z span -WORLD/2..WORLD/2, y is up; ground height comes from the terrain). Ids are
 * the live ids of `game.buildings.list` (bldId) and `game.net.segs` (segId). Events fire at the simulation's fixed step,
 * so several can arrive between two drawn frames; none carries an object that is reused after the handler returns.
 *
 * `milestone` is the event the sim has always had: a population tier is `{ kind: 'tier', value: <tier index 0..9> }`.
 */
export type WorldEvents = {
  /** a building under construction moved on; progress 0..1, and exactly 1 once, when it opens */
  construction: { bldId: number; progress: number };
  /** a building is gone (bulldozed, burnt down, abandoned and cleared): its footprint centre, size (m) and height (m) */
  demolished: { bldId: number; x: number; z: number; w: number; d: number; height: number; cause: 'bulldoze' | 'fire' | 'abandoned' | 'disaster' | 'collapse' };
  /** a building grew a level (its model has already been swapped) */
  levelUp: { bldId: number; level: number };
  /** a disaster changed phase. intensity 0..1; radius in metres around (x, z) */
  disaster: { kind: DisasterKind; phase: 'warn' | 'hit' | 'response' | 'end'; x: number; z: number; radius: number; intensity: number };
  /** water standing on the ground: (x, z, depth m) triples of flooded cells, `cellM` metres square; an empty list means it drained */
  flood: { cells: Float32Array; cellM: number };
  /** the burning edge of a wildfire: (x, z) pairs in order along the front; an empty list means it is out */
  fireFront: { points: Float32Array };
  /** two or more cars hit each other. severity 0 (fender bender) .. 1 (a wreck that closes the road) */
  crash: { x: number; z: number; severity: number; segId: number };
  /** money moved: delta > 0 came in. `kind` says where from, for the tick's colour and sound */
  moneyTick: { delta: number; kind: MoneyKind; x?: number; z?: number };
  /** zoning was painted (zone) or erased (null) over `cells` lots; (x, z) is the stroke's middle, r its reach in metres */
  zonePainted: { zone: ZoneType | null; cells: number; x: number; z: number; r: number };
  /** new road segments exist (a stroke can make several) */
  roadBuilt: { segIds: number[] };
  /** ONE MORE LANE: a road was widened in place to a bigger type */
  laneAdded: { segId: number; lanes: number };
  /** trees came down around (x, z) within r metres: how many, and why */
  treesCleared: { x: number; z: number; r: number; count: number; cause: 'road' | 'building' | 'tool' | 'fire' | 'disaster' };
  /** the Ponzi ending moved on: 0 = solvent, 1 = roads crumbling, 2 = chains closing, 3 = pop-ups, 4 = empty lots, 5 = the deer are back */
  collapseStage: { stage: number };
  /** the last tree is gone; (x, z) is where it stood */
  paradisePaved: { x: number; z: number };
};
export type DisasterKind = 'hurricane' | 'landslide' | 'wildfire' | 'floridaMan' | 'flood' | 'heatwave';
export type MoneyKind = 'tax' | 'fee' | 'grant' | 'loan' | 'upkeep' | 'build' | 'refund' | 'service' | 'disaster' | 'other';

// ------------------------------------------------------------------ world fields (what the look and the sound read)
/** Every info view the game has or is getting. A view the simulation has no numbers for yet gives a null field. */
export type InfoViewId =
  | 'traffic' | 'landValue' | 'power' | 'water' | 'sewage' | 'garbage' | 'fire' | 'police' | 'health' | 'education' | 'pollution' | 'noise'
  | 'valuePerAcre' | 'commute' | 'roadCondition' | 'flood' | 'heat';

/** How a field's numbers read: which end is good, and what the ends are called. */
export interface FieldLegend {
  title: string;
  /** printed after a value ("%", "min", "$/acre"); '' for none */
  unit: string;
  lowLabel: string;
  highLabel: string;
  /** which end is the good one, so the ramp can run red-to-green, green-to-red or a neutral ramp */
  ramp: 'goodHigh' | 'badHigh' | 'neutral';
}

/**
 * One info view as numbers over the whole map. `data` is row-major, w x h cells of `cellM` metres: cell (i, j) covers
 * x from -WORLD/2 + i*cellM, z from -WORLD/2 + j*cellM. NaN means "nothing to show here" (draw no colour). Colour by
 * (value - min) / (max - min), clamped. `version` goes up whenever the numbers changed, so upload the texture only then.
 * The object and its array are reused between calls for the same view: copy what you keep.
 */
export interface ScalarField {
  view: InfoViewId;
  w: number;
  h: number;
  cellM: number;
  data: Float32Array;
  min: number;
  max: number;
  legend: FieldLegend;
  version: number;
}

/** Something the camera can follow. Ids: `game.traffic.cars[].id`, `game.peds.peds[].id`, `game.buildings.list` keys. */
export type ViewTarget = { kind: 'car'; id: number } | { kind: 'person'; id: number } | { kind: 'building'; id: number };
/** Where a ViewTarget is right now: position (m), heading (radians, 0 = +z, as the models face), speed (m/s) and its size (m). */
export interface ViewPose { x: number; y: number; z: number; yaw: number; speed: number; radius: number }

/**
 * `game.fields`: the simulation's state, read-only, for rendering and audio. Cheap enough to call per frame unless
 * noted; nothing here changes the simulation.
 */
export interface WorldFields {
  /** the numbers behind an info view (recomputed at most once a game day; call it when the view is shown) */
  fieldFor(view: InfoViewId): ScalarField | null;
  /** 1 = freshly paved .. 0 = back to gravel */
  roadCondition(segId: number): number;
  /** game days since the building opened (0 while it is under construction) */
  buildingAge(bldId: number): number;
  /** 1 = kept up .. 0 = abandoned and failing */
  buildingCondition(bldId: number): number;
  /** air pollution at a point: 0 = clean, 1 = what makes people sick, can go higher */
  pollutionAt(x: number, z: number): number;
  /** the whole town's smog, 0..1: how far the sky and the grade should lean toward sepia */
  smog(): number;
  /** the share of the map's trees still standing, 0..1 */
  naturePct(): number;
  /** where a follow target is now, or null when it no longer exists (stop following) */
  poseOf(target: ViewTarget): ViewPose | null;
}
