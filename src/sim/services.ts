// City services & utilities: the consequence loop.
//
// - Utilities (power, water, sewage) flow along the road network. A building is
//   served only if its road is connected to a source with spare capacity
//   (plants, pumps, outfalls, or a capped, pricey import at an outside
//   connection). Shortages shed the buildings farthest from the sources first.
// - Coverage services (fire, police, health, schools, garbage, parks) are
//   reached by drive time over the road graph, and share their capacity among
//   everyone they reach (an overloaded clinic helps everybody a little less).
// - Consequences: no utility -> nobody moves in -> abandoned; trash piles up,
//   crime creeps, pollution makes people sick, fires spread without a station,
//   schools gate level-ups. Everything is explained in the inspector, the
//   demand tooltips and the info views.
import * as THREE from 'three';
import { registerInspector, registerPanel, registerSystem, registerTool, registerView, type ExtView } from '../ext/registry';
import type { Game } from '../game';
import { CUSTOM_BUILDINGS, isZoned, type Bld } from './buildings';
import { serviceModel, type ServiceModelId } from '../buildings/serviceModels';
import { generateVaultModel, generateVaultService } from '../buildings/generator';
import { VAULT_FAMILIES } from '../vault/families';
import { vaultFamilyAssets, vaultReady } from '../vault/vault';
import { ROAD_TYPES } from '../roads/roadTypes';
import type { RSeg } from '../roads/network';
import { CELL, HALF, WATER, WORLD } from '../config';
import { INFO_OVERLAY, Paint } from '../world/terrain';
import { Fields } from './pollution';
import { ProblemIcons, type Problem, type ProblemItem } from './serviceIcons';
import type { FeedContext, FeedEventKind, VehicleKind, ZoneType } from '../contracts';
import type { DemandKey, LossCause } from './sim';
import { POLICY } from './policyEffects';
import { crumb } from '../ui/bugreport';
import { frontageCandidates, frontageOn, inRect, rectCorners, specialAt, type Frontage } from './frontage';
import { pointAt, tangentAt } from '../core/math';
import { PlacementGhost } from '../tools/placementGhost';
import { lockText, milestoneAt, nameUnlock, unlockPop } from './milestones';

type ZB = Bld & { zone: ZoneType };

// ============================================================== definitions
export type SvcCat = 'power' | 'water' | 'sewage' | 'garbage' | 'fire' | 'police' | 'health' | 'education' | 'parks';
/** Coverage networks (drive-time reach). */
type Cov = 'fire' | 'police' | 'health' | 'school' | 'college' | 'parks' | 'garbage';
const COVS: Cov[] = ['fire', 'police', 'health', 'school', 'college', 'parks', 'garbage'];
type Util = 'power' | 'water' | 'sewage';
const UTILS: Util[] = ['power', 'water', 'sewage'];

interface SvcDef {
  id: SvcId;
  cat: SvcCat;
  name: string;
  blurb: string;
  icon: string;
  w: number;
  d: number;
  cost: number;
  upkeep: number; // $/week, fixed
  /**
   * Running cost that grows with use, on top of upkeep: fuel and chemicals
   * ($ per MW or kL your plants supply, per day), trucks ($ per ton collected,
   * per day), or staff ($ per person served, fire: per building, per week).
   * Without it one station served a whole town and big towns printed money.
   */
  run?: number;
  buildDays: number;
  unlock: number; // population
  power?: number; // MW
  water?: number; // kL/day
  sewage?: number; // kL/day
  store?: number; // landfill capacity (t)
  collect?: number; // garbage t/day
  cov?: Cov;
  reach?: number; // drive-time seconds
  capacity?: number; // people (fire: buildings) served at full quality
  nearWater?: boolean;
  pollution?: number; // emission per day
  noise?: number;
  vehicle?: VehicleKind;
  height: number; // for the placement ghost
}

/** a city service (serviceModels), or a vault roadside attraction ('va:' + family) */
type SvcId = ServiceModelId | `va:${string}`;

const SVC: SvcDef[] = [
  { id: 'gasPeaker', cat: 'power', name: 'Frack Gas Peaker', blurb: 'Cheap, fast, smells like a birthday candle in a gas station.', icon: '🔥', w: 4, d: 3, cost: 16000, upkeep: 120, run: 8, buildDays: 8, unlock: 0, power: 14, pollution: 0.3, noise: 0.7, height: 16 },
  { id: 'coalPlant', cat: 'power', name: 'Clean Coal™ Plant', blurb: 'The ™ does a lot of work. Huge output, huge smoke.', icon: '🏭', w: 6, d: 6, cost: 38000, upkeep: 320, run: 5, buildDays: 14, unlock: 0, power: 45, pollution: 1.2, noise: 0.9, height: 62 },
  { id: 'solarFarm', cat: 'power', name: 'Freedom Solar Farm', blurb: 'Zero emissions. Output drops at night and under clouds.', icon: '☀️', w: 6, d: 4, cost: 30000, upkeep: 90, buildDays: 10, unlock: 400, power: 10, height: 4 },
  { id: 'nuclearPlant', cat: 'power', name: 'Three Mile Island Jr.', blurb: 'Enough power for the whole county. What could go wrong.', icon: '☢️', w: 7, d: 7, cost: 220000, upkeep: 1400, run: 2, buildDays: 30, unlock: 5000, power: 220, noise: 0.5, height: 52 },
  { id: 'waterPump', cat: 'water', name: 'Artesian Tap Pump', blurb: 'Pumps river water. Must touch water. Keep it far from the sewage outfall.', icon: '🚰', w: 2, d: 2, cost: 9000, upkeep: 70, run: 0.03, buildDays: 6, unlock: 0, water: 3200, nearWater: true, noise: 0.3, height: 7 },
  { id: 'wellTower', cat: 'water', name: 'Groundwater Well Tower', blurb: 'Works anywhere. Small output. Boil notice pending (a joke: the water is fine).', icon: '🗼', w: 2, d: 2, cost: 7000, upkeep: 45, run: 0.05, buildDays: 6, unlock: 0, water: 800, height: 26 },
  { id: 'sewageOutfall', cat: 'sewage', name: 'Sewage Outfall', blurb: 'Straight into the river. Must touch water. Pollutes the neighborhood.', icon: '🚽', w: 2, d: 2, cost: 6000, upkeep: 35, run: 0.02, buildDays: 5, unlock: 0, sewage: 3800, nearWater: true, pollution: 0.5, noise: 0.2, height: 4 },
  { id: 'treatmentPlant', cat: 'sewage', name: 'Poop Palace Treatment', blurb: 'Actually cleans it. Costs more. Smells less.', icon: '🧫', w: 5, d: 4, cost: 32000, upkeep: 260, run: 0.05, buildDays: 12, unlock: 1000, sewage: 6000, nearWater: true, pollution: 0.06, noise: 0.3, height: 7 },
  { id: 'landfill', cat: 'garbage', name: 'Mt. Trashmore Landfill', blurb: 'Trucks collect trash within reach. Fills up. Stinks up the neighbors.', icon: '🗑️', w: 6, d: 6, cost: 14000, upkeep: 90, run: 2, buildDays: 8, unlock: 0, store: 9000, collect: 36, cov: 'garbage', reach: 220, pollution: 0.3, noise: 0.5, vehicle: 'garbageTruck', height: 16 },
  { id: 'incinerator', cat: 'garbage', name: 'Freedom Incinerator', blurb: 'Burns 60 t/day forever and makes 8 MW. The smoke is a feature.', icon: '♨️', w: 4, d: 4, cost: 42000, upkeep: 260, run: 2, buildDays: 12, unlock: 1200, collect: 60, cov: 'garbage', reach: 260, power: 8, pollution: 0.8, noise: 0.6, vehicle: 'garbageTruck', height: 44 },
  { id: 'fireStation', cat: 'fire', name: 'Volunteer Fire Dept.', blurb: 'Reaches buildings by drive time. Prevents fires and saves the ones that catch.', icon: '🚒', w: 3, d: 3, cost: 12000, upkeep: 120, run: 0.7, buildDays: 6, unlock: 0, cov: 'fire', reach: 100, capacity: 260, noise: 0.3, vehicle: 'firetruck', height: 13 },
  { id: 'sheriff', cat: 'police', name: "Sheriff's Office", blurb: 'Keeps crime down within reach. Qualified immunity included.', icon: '🚓', w: 3, d: 3, cost: 11000, upkeep: 120, run: 0.07, buildDays: 6, unlock: 0, cov: 'police', reach: 110, capacity: 1600, noise: 0.2, vehicle: 'police', height: 9 },
  { id: 'clinic', cat: 'health', name: 'Urgent Care (Out of Network)', blurb: 'Treats the sick within reach. You will receive a bill.', icon: '🩺', w: 3, d: 3, cost: 14000, upkeep: 130, run: 0.08, buildDays: 6, unlock: 0, cov: 'health', reach: 110, capacity: 1200, vehicle: 'ambulance', height: 7 },
  { id: 'hospital', cat: 'health', name: "St. Deductible's Hospital", blurb: 'Big reach, big capacity, bigger deductible.', icon: '🏥', w: 5, d: 4, cost: 60000, upkeep: 650, run: 0.08, buildDays: 14, unlock: 1500, cov: 'health', reach: 200, capacity: 6000, noise: 0.3, vehicle: 'ambulance', height: 25 },
  { id: 'school', cat: 'education', name: 'Charter School of Excellence™', blurb: 'Educated residents unlock level 3+ homes and better offices.', icon: '🏫', w: 4, d: 4, cost: 16000, upkeep: 140, run: 0.09, buildDays: 8, unlock: 0, cov: 'school', reach: 130, capacity: 1100, noise: 0.2, height: 10 },
  { id: 'college', cat: 'education', name: 'Prosperity Gospel University', blurb: 'College grads unlock the top levels. Tuition is a spiritual journey.', icon: '🎓', w: 6, d: 5, cost: 70000, upkeep: 750, run: 0.09, buildDays: 16, unlock: 2000, cov: 'college', reach: 320, capacity: 7000, height: 28 },
  { id: 'park', cat: 'parks', name: 'Pocket Park', blurb: 'Raises land value nearby. No skateboarding.', icon: '🌳', w: 2, d: 2, cost: 3000, upkeep: 20, buildDays: 3, unlock: 0, cov: 'parks', reach: 45, height: 9 },
];
/**
 * Roadside attractions from the Asset Vault (PR #7): bigger, stranger parks.
 * The World's Largest Fork raises land value like a pocket park, only more so.
 * Built from one plan of each family; they need the vault pack (without it
 * the menu hides them and a saved one stands as a plain park).
 */
for (const f of VAULT_FAMILIES) {
  const p = f.park;
  if (!p) continue;
  const cells = p.w * p.d, tier = cells <= 2 ? 0 : cells <= 4 ? 1 : 2;
  SVC.push({
    id: `va:${f.id}`, cat: 'parks', name: f.label, blurb: `${p.desc} ${f.satire}`, icon: p.icon, w: p.w, d: p.d,
    cost: [4500, 8000, 14000][tier], upkeep: [30, 55, 90][tier], buildDays: 4 + tier * 2, unlock: unlockPop.attraction(tier),
    cov: 'parks', reach: [55, 75, 100][tier], height: Math.max(3, p.h),
  });
}
const isAttraction = (id: string) => id.startsWith('va:');
/**
 * City services the vault drew its own versions of (the Very Clean Coal Plant,
 * the County Water Tower, Copay Castle for urgent care): with Looks set to the
 * vault (the default) they wear those; Classic keeps the originals. Smokestacks
 * keep their smoke.
 */
const VAULT_LOOK: Partial<Record<ServiceModelId, { family: string; stacks?: 'smoke' | 'steam' }>> = {
  gasPeaker: { family: 'gas-peaker-plant', stacks: 'smoke' }, coalPlant: { family: 'clean-coal-plant', stacks: 'smoke' }, solarFarm: { family: 'solar-farm' },
  waterPump: { family: 'pump-station' }, wellTower: { family: 'water-tower' }, sewageOutfall: { family: 'sewage-outfall' }, treatmentPlant: { family: 'wastewater-plant' },
  fireStation: { family: 'volunteer-firehouse' }, sheriff: { family: 'sheriff-substation' }, clinic: { family: 'copay-castle' }, hospital: { family: 'wallet-er' },
};
const LOOK_KEY = 'slopmerica.svcLook';
/** 'vault' (default) or 'classic' */
function svcLook(): 'vault' | 'classic' {
  try { return localStorage.getItem(LOOK_KEY) === 'classic' ? 'classic' : 'vault'; } catch { return 'vault'; }
}
const vaultLook = (id: string) => (vaultReady() && svcLook() === 'vault' ? VAULT_LOOK[id as ServiceModelId] : undefined);
// when each service unlocks comes from the milestone table (src/sim/milestones.ts)
for (const d of SVC) if (!d.id.startsWith('va:')) d.unlock = unlockPop.service(d.id);
for (const d of SVC) nameUnlock(`svc:${d.id}`, `${d.icon} ${d.name}`);
export const SERVICE_DEFS = new Map<string, SvcDef>(SVC.map((d) => [d.id, d]));
/** "1,800 people (Exurb)" */
const unlockAt = (pop: number) => `${pop.toLocaleString()} people${milestoneAt(pop) ? ` (${milestoneAt(pop)!.name})` : ''}`;
for (const d of SVC) {
  if (isAttraction(d.id)) {
    const fam = d.id.slice(3), variant = VAULT_FAMILIES.find((f) => f.id === fam)?.park?.variant ?? 0;
    CUSTOM_BUILDINGS.set(d.id, {
      label: d.name, w: d.w, d: d.d, buildDays: d.buildDays, paint: Paint.Lawn, main: vaultReady,
      model: () => (vaultReady() ? generateVaultModel(vaultFamilyAssets(fam)[variant], d.w, d.d) : null) ?? serviceModel('park', d.w, d.d),
    });
  } else {
    const classic = () => serviceModel(d.id as ServiceModelId, d.w, d.d);
    CUSTOM_BUILDINGS.set(d.id, {
      label: d.name, w: d.w, d: d.d, buildDays: d.buildDays, paint: d.id === 'park' ? Paint.Lawn : Paint.Paved,
      main: () => !!vaultLook(d.id),
      model: () => { const v = vaultLook(d.id); return (v ? generateVaultService(v.family, d.w, d.d, v.stacks) : null) ?? classic(); },
    });
  }
}
/**
 * A building unlocks when the city first reaches its population and stays
 * unlocked (playtest 4: a garbage crisis emptied the city below 1,200 and
 * took away the incinerator it needed to recover).
 */
const svcUnlocked = (g: Game, d: SvcDef) => g.sim.mode === 'sandbox' || g.sim.peakPop >= d.unlock;

const CATS: { id: SvcCat; icon: string; label: string }[] = [
  { id: 'power', icon: '⚡', label: 'Power' },
  { id: 'water', icon: '🚰', label: 'Water' },
  { id: 'sewage', icon: '🚽', label: 'Sewage' },
  { id: 'garbage', icon: '🗑️', label: 'Garbage' },
  { id: 'fire', icon: '🚒', label: 'Fire' },
  { id: 'police', icon: '🚓', label: 'Police' },
  { id: 'health', icon: '🏥', label: 'Health' },
  { id: 'education', icon: '🎓', label: 'Education' },
  { id: 'parks', icon: '🌳', label: 'Parks' },
];

/** What the outside world will sell you through a highway connection. */
const IMPORT_CAP: Record<Util, number> = { power: 2.2, water: 450, sewage: 420 };
/** $ per unit per day */
const IMPORT_PRICE: Record<Util, number> = { power: 16, water: 0.045, sewage: 0.04 };
const UNIT: Record<Util, string> = { power: 'MW', water: 'kL/day', sewage: 'kL/day' };
/** Trash the county waste contractor hauls away through outside connections (t/day, $/t). */
// $12/t: at $22 the contract for a 400-person town cost nearly all its residential tax
const TRASH_EXPORT = 3.5, TRASH_PRICE = 12;
/** Days of uncollected trash: icon / sickness+fire risk / critical (nobody moves in). */
const TRASH_ICON = 8, TRASH_BAD = 16, TRASH_CRIT = 30;

// ============================================================== per-building demand
const LVL = (b: Bld) => 1 + 0.08 * (b.level - 1);
const isRes = (b: ZB) => b.zone === 'resLow' || b.zone === 'resHigh';
function useOf(b: ZB, u: Util): number {
  const n = isRes(b) ? Math.max(b.occ, b.cap * 0.3) : Math.max(b.occ, b.cap * 0.4);
  let per: number;
  if (u === 'power') per = isRes(b) ? 0.0012 : b.zone === 'industry' ? 0.006 : b.zone === 'office' ? 0.0028 : 0.003;
  else {
    per = isRes(b) ? 0.25 : b.zone === 'industry' ? 1.0 : b.zone === 'office' ? 0.25 : 0.3;
    if (u === 'sewage') per *= 0.9;
  }
  const pol = u === 'power' ? POLICY.powerDemandMul(b) : POLICY.waterDemandMul(b);
  return n * per * LVL(b) * pol;
}
function trashOf(b: ZB): number {
  const per = isRes(b) ? 0.0025 : b.zone === 'industry' ? 0.012 : b.zone === 'office' ? 0.003 : 0.006;
  return Math.max(b.occ, b.cap * 0.3) * per * LVL(b) * POLICY.garbageMul(b);
}
function peopleOf(b: Bld): number {
  return isZoned(b) ? Math.max(b.occ, b.cap * 0.3) : 0;
}
const trashDaysOf = (b: ZB, bs: BS) => bs.garbage / Math.max(0.0005, trashOf(b));
/** days a building can stay critical before it's abandoned */
const ABANDON_DAYS = 14;
/**
 * Days an abandoned building stands before it's torn down. At 45 days with no warning, Appalachia lost a
 * third of its buildings when its landfill filled, before the player could act (docs/PLAYTEST_6.md). Now
 * the game says how many come down and when the first does: once any are within DEMOLISH_WARN[0] days (at
 * most every 10 days), and urgently within DEMOLISH_WARN[1] (at most every 5). The owner's call, 2026-10-02.
 */
const DEMOLISH_DAYS = 90;
const DEMOLISH_WARN = [30, 7];
/** "12 days", "5 months", "38 years" */
const spanOf = (days: number) => (days < 120 ? `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}` : days < 730 ? `${Math.round(days / 30.4)} months` : `${Math.round(days / 365)} years`);

// ============================================================== emergencies
/** A need that, left unmet, empties buildings (see consequences()). */
export type Need = 'power' | 'water' | 'sewage' | 'garbage' | 'health';
const NEED: Record<Need, { cat: SvcCat; icon: string; label: string; failing: string }> = {
  power: { cat: 'power', icon: '⚡', label: 'Power', failing: 'without power' },
  water: { cat: 'water', icon: '🚰', label: 'Water', failing: 'without water' },
  sewage: { cat: 'sewage', icon: '🚽', label: 'Sewage', failing: 'without sewage' },
  garbage: { cat: 'garbage', icon: '🗑️', label: 'Garbage', failing: 'piling up trash' },
  health: { cat: 'health', icon: '🏥', label: 'Health', failing: 'too sick to live in' },
};
export interface EmergencyNeed {
  need: Need;
  /** the Services category that fixes it */
  cat: SvcCat;
  icon: string;
  label: string;
  failing: string;
  buildings: number;
  residents: number;
  /** days until the first and the last of them are abandoned, if nothing changes */
  eta: [number, number];
  /** why it's failing, from the same numbers the Services panel shows */
  why: string;
}
/** What the city's services are doing to it right now (the HUD's emergency card). */
export interface EmergencyView {
  /** crit: a city-wide failure; warn: something to fix soon; recovering: a crisis just ended */
  level: 'none' | 'warn' | 'crit' | 'recovering';
  /** the failing needs, worst first */
  needs: EmergencyNeed[];
  /** buildings counting down to abandonment, and the residents in them */
  atRisk: number;
  residents: number;
  /** where they are: neighbourhoods, worst first, each with the building that empties soonest */
  hot: { x: number; z: number; n: number; residents: number; id: number }[];
  /** a slower failure that's coming (a landfill filling up) */
  forecast: string | null;
  /** days until it hits (0: a landfill is already full), null with no forecast */
  forecastDays: number | null;
  /** the crisis's state machine (the day it began, what it peaked at, the low point) */
  crisis: { since: number; cause: string; peakAtRisk: number; peakTrash: number; lowPop: number; popAtStart: number; endedAt: number };
  /** buildings with trash piling up right now, and buildings standing abandoned */
  trash: number;
  abandoned: number;
  day: number;
}

// ============================================================== state
/**
 * Why a building's trash is piling up (or that it's being collected):
 * full = its landfill is full, reach = no truck reaches it and the county
 * contract didn't take it, capacity = in reach but the trucks ran out of
 * room today and the city makes more than it collects, clearing = picked
 * up today (a backlog going down), queued = in reach and waiting its turn
 * while the city collects everything it makes.
 */
type TrashWhy = 'full' | 'reach' | 'capacity' | 'clearing' | 'queued';
interface BS {
  pw: boolean; wa: boolean; se: boolean;
  bad: number; // consecutive-ish critical days
  ok: number; // recovery days while abandoned
  garbage: number; // tons waiting
  crime: number; // 0..100
  sick: number; // 0..1
  edu: number; // 0..1
  burning: number; // days left burning
  cov: Record<Cov, number>;
  dirty: boolean; // served by contaminated water
  /** tons picked up today (a truck or the county contract) */
  pick: number;
  /** the garbage facility whose trucks reach it (-1: none) */
  via: number;
  trash: TrashWhy;
}
interface FS {
  stored: number; // landfill tons
  load: number; // people/tons it's asked to serve
  quality: number; // capacity share 0..1
  out: number; // dispatched vehicles on the road
  contaminated: boolean;
  full: boolean;
  /** landfill: tons added per day lately (for "full in N days") */
  rate: number;
  /** landfill: the highest fill warning given (0, 75, 90, 100 %) */
  warned: number;
  /** garbage: buildings its trucks serve, tons they took today, and whether they're at their limit */
  served?: number;
  took?: number;
  behind?: boolean;
}
/** unserved = noRoad + noLink + capped: why each cut-off building is cut off */
interface UtilStat { supply: number; demand: number; served: number; imported: number; unserved: number; noRoad: number; noLink: number; capped: number }
const z0 = (): UtilStat => ({ supply: 0, demand: 0, served: 0, imported: 0, unserved: 0, noRoad: 0, noLink: 0, capped: 0 });

const S = {
  b: new Map<number, BS>(),
  f: new Map<number, FS>(),
  fields: new Fields(),
  graphDirty: true,
  /** road components need recomputing (roads changed) */
  compDirty: true,
  /** special buildings' road links have been checked once (the first check after a load raises no alerts) */
  linksSeen: false,
  /** special buildings last seen linked (losing the link later, to a bulldozer, gets a toast) */
  linked: new Set<number>(),
  facSig: '',
  /** node -> component root */
  comp: new Map<number, number>(),
  /** component roots with an outside connection */
  compEdge: new Set<number>(),
  /** per utility: node -> drive time from the nearest source (shed order) */
  utilT: {} as Partial<Record<Util, Map<number, number>>>,
  /** per coverage network: node -> {t, owner facility id} */
  covT: {} as Partial<Record<Cov, Map<number, { t: number; o: number }>>>,
  /** the reach of full landfills (they collect nothing; this says whose buildings those are) */
  fullT: new Map<number, { t: number; o: number }>(),
  util: { power: z0(), water: z0(), sewage: z0() } as Record<Util, UtilStat>,
  week: { power: 0, water: 0, sewage: 0, trash: 0 },
  counts: { noPower: 0, noWater: 0, noSewage: 0, trash: 0, fires: 0, burned: 0, abandoned: 0, crime: 0, sick: 0 },
  garbage: {
    made: 0, collected: 0, exported: 0, stored: 0, capacity: 0,
    /** what the trucks could still take today (landfills that aren't full, incinerators) */
    room: 0,
    /** landfill tons added per day lately, and days until every landfill is full (Infinity: not filling) */
    fill: 0, daysLeft: Infinity,
    /** names of the full landfills, and the occupied buildings only they reach (no truck comes) */
    full: [] as string[],
    fullServed: 0,
    /** buildings with trash piling up, by why (see TrashWhy) */
    why: { full: 0, reach: 0, capacity: 0, clearing: 0, queued: 0 } as Record<TrashWhy, number>,
  },
  /** the city's service emergency: its state machine and today's assessment */
  crisis: { level: 'none' as 'none' | 'crit' | 'recovering', since: 0, cause: '' as string, peakAtRisk: 0, peakTrash: 0, lowPop: 0, popAtStart: 0, endedAt: 0 },
  emergency: null as EmergencyView | null,
  /** buildings abandoned on each of the last few days, newest last */
  abandonedDays: [] as number[],
  /** the day of the last warning that abandoned buildings come down soon, per DEMOLISH_WARN */
  demolishWarned: [] as number[],
  /** buildings cut off per utility yesterday (to note when a shortage starts) */
  cutWas: { power: 0, water: 0, sewage: 0 } as Record<Util, number>,
  icons: null as ProblemIcons | null,
  iconT: 0,
  fireT: 0,
  view: null as ViewId | null,
  overlayTex: null as THREE.DataTexture | null,
  overlayT: 0,
  day: 0,
  lastFeed: new Map<string, number>(),
  inited: false,
  perf: { ms: 0, n: 0 },
  /** no abandonment before this day (cities that existed before services) */
  graceUntil: 0,
  loaded: false,
  checkedLegacy: false,
};

function bsOf(b: Bld): BS {
  let s = S.b.get(b.id);
  if (!s) {
    s = { pw: true, wa: true, se: true, bad: 0, ok: 0, garbage: 0, crime: 8, sick: 0.02, edu: 0.15, burning: 0, cov: { fire: 0, police: 0, health: 0, school: 0, college: 0, parks: 0, garbage: 0 }, dirty: false, pick: 0, via: -1, trash: 'queued' };
    S.b.set(b.id, s);
  }
  return s;
}
function fsOf(b: Bld): FS {
  let s = S.f.get(b.id);
  if (!s) S.f.set(b.id, (s = { stored: 0, load: 0, quality: 1, out: 0, contaminated: false, full: false, rate: 0, warned: 0 }));
  return s;
}
const defOf = (b: Bld) => (b.zone === 'service' && b.kind ? SERVICE_DEFS.get(b.kind) : undefined);
type Fac = Bld & { def: SvcDef };
function facilities(g: Game, active = true): Fac[] {
  const out: Fac[] = [];
  for (const b of g.buildings.list.values()) {
    const d = defOf(b);
    if (d && (!active || b.state === 'active')) out.push(Object.assign(b, { def: d }));
  }
  return out;
}

/**
 * Each active facility's running cost for a week at today's use (SvcDef.run):
 * plants split what your own plants supply (imports are billed separately)
 * by capacity, dumps split the tons your trucks collect, stations pay per
 * person or building they serve, up to capacity.
 */
function runningCosts(g: Game, fac = facilities(g)): Map<number, number> {
  const out = new Map<number, number>();
  const sol = solarFactor(g);
  const capOf = (f: Fac, u: Util) => (f.def[u] ?? 0) * (f.def.id === 'solarFarm' ? sol : 1);
  for (const u of UTILS) {
    const cat: SvcCat = u;
    const plants = fac.filter((f) => f.def.cat === cat && capOf(f, u) > 0);
    const total = plants.reduce((a, f) => a + capOf(f, u), 0);
    const own = Math.max(0, S.util[u].served - S.util[u].imported);
    for (const f of plants) if (f.def.run) out.set(f.id, (own * capOf(f, u)) / total * f.def.run * 7);
  }
  const dumps = fac.filter((f) => f.def.collect);
  const cap = dumps.reduce((a, f) => a + (f.def.collect ?? 0), 0);
  for (const f of dumps) if (f.def.run) out.set(f.id, (S.garbage.collected * (f.def.collect ?? 0)) / cap * f.def.run * 7);
  for (const f of fac) {
    if (!f.def.run || !f.def.capacity) continue;
    out.set(f.id, Math.min(fsOf(f).load, f.def.capacity) * f.def.run);
  }
  return out;
}

/**
 * What a new building's running cost would come to a week at today's use, the
 * way the weekly bill counts it (runningCosts), and how that's worked out
 * (playtest: the clinic preview showed its $130 upkeep but left out the
 * $0.08 a person, and a water tower's $0.05/kL had to be multiplied out by
 * hand). Plants take their share of what your own plants would make once it
 * replaces imports; dumps their share of the town's trash; stations the people
 * (or, for fire, the buildings) in reach that nothing covers yet, and half of
 * those something does, up to capacity.
 */
export function estimateRun(g: Game, d: SvcDef, x: number, z: number): { perWk: number; how: string } | null {
  if (!d.run) return null;
  const money = (v: number) => `$${v < 1 ? v.toFixed(2) : Math.round(v).toLocaleString()}`;
  for (const u of UTILS) {
    const mine = (d[u] ?? 0) * (d.id === 'solarFarm' ? solarFactor(g) : 1);
    if (mine <= 0) continue;
    const others = facilities(g, false).filter((f) => f.def.cat === u && (f.def[u] ?? 0) > 0).reduce((a, f) => a + (f.def[u] ?? 0), 0);
    const made = Math.min(S.util[u].demand, others + mine) * (mine / (others + mine));
    return { perWk: made * d.run * 7, how: `${fmt(made, u)} × ${money(d.run)} × 7 days` };
  }
  if (d.collect) {
    const others = facilities(g, false).filter((f) => f.def.collect).reduce((a, f) => a + (f.def.collect ?? 0), 0);
    const tons = Math.min(S.garbage.made, others + d.collect) * (d.collect / (others + d.collect));
    return { perWk: tons * d.run * 7, how: `${tons.toFixed(1)} t/day × ${money(d.run)} × 7 days` };
  }
  if (d.capacity && d.cov && d.reach) {
    const c = d.cov as Cov, R = d.reach * 10; // drive time to a rough straight-line reach
    let load = 0;
    for (const b of g.buildings.near(x, z, R)) {
      if (!isZoned(b) || b.state !== 'active' || Math.hypot(b.x - x, b.z - z) > R) continue;
      const n = c === 'fire' ? 1 + (b.level - 1) * 0.5 : c === 'school' || c === 'college' ? (isRes(b) ? peopleOf(b) : 0) : peopleOf(b);
      const had = S.b.get(b.id)?.cov[c] ?? 0;
      load += n * (had >= 0.5 ? 0.5 : 1);
    }
    const served = Math.min(load, d.capacity);
    return { perWk: served * d.run, how: `${Math.round(served).toLocaleString()} ${c === 'fire' ? 'buildings' : 'people'} in reach × ${money(d.run)}` };
  }
  return null;
}

/** Stations serving more than they can handle, worst first, and where they are (the Next hint puts these ahead of zoning tips) */
export function overloadedServices(g: Game): { name: string; icon: string; cat: SvcCat; load: number; capacity: number; x: number; z: number }[] {
  const out: { name: string; icon: string; cat: SvcCat; load: number; capacity: number; x: number; z: number }[] = [];
  for (const f of facilities(g)) {
    if (!f.def.capacity) continue;
    const load = fsOf(f).load;
    if (load > f.def.capacity * 1.05) out.push({ name: f.def.name, icon: f.def.icon, cat: f.def.cat, load: Math.round(load), capacity: f.def.capacity, x: f.x, z: f.z });
  }
  return out.sort((a, b) => b.load / b.capacity - a.load / a.capacity);
}

/**
 * The people a new facility of this kind at (x, z) would take from each one of its kind now, by id: everyone
 * whose building it would be nearer by drive time, within its reach, as the one serving them counts them
 * (each building goes to its nearest by drive time, so a clinic on a lot round the corner from an
 * overloaded one can take next to none of its load). Reads only: for tools (the late-game bot's relief lot).
 */
export function takeFrom(g: Game, id: string, x: number, z: number): Record<number, number> {
  const d = SERVICE_DEFS.get(id), now = d?.cov ? S.covT[d.cov] : undefined, out: Record<number, number> = {};
  const p = d && now?.size ? g.net.pickSeg(x, z, 45) : null;
  if (!d || !now || !p) return out;
  const half = segTime(p.seg) / 2, reach = d.reach ?? 1;
  const mine = dijkstra(g, [{ node: p.seg.a, t: half, o: -1 }, { node: p.seg.b, t: half, o: -1 }], reach * 1.05);
  const fac = new Map(facilities(g).map((f) => [f.id, f]));
  for (const b of g.buildings.list.values()) {
    if (!isZoned(b)) continue;
    const was = reachOf(g, b, now), will = was && reachOf(g, b, mine), f = was && fac.get(was.o);
    if (was && will && f && will.t < was.t && will.t < reach && was.t < (f.def.reach ?? 1)) out[was.o] = (out[was.o] ?? 0) + peopleOf(b);
  }
  return out;
}

/** Facilities being built: they cost nothing until they open, then upkeep plus running (the budget should know) */
export function committedServices(g: Game): { n: number; perWk: number } {
  let n = 0, perWk = 0;
  for (const f of facilities(g, false)) {
    if (f.state === 'active') continue;
    n++;
    perWk += f.def.upkeep + (estimateRun(g, f.def, f.x, f.z)?.perWk ?? 0);
  }
  return { n, perWk };
}

/** "$12/MW a day", "$0.08 a week per person served": what SvcDef.run means for one def */
export function runText(d: SvcDef): string {
  if (!d.run) return '';
  const m = d.run < 1 ? `$${d.run.toFixed(2)}` : `$${d.run}`;
  if (d.cat === 'power') return `${m}/MW a day in fuel`;
  if (d.cat === 'water' || d.cat === 'sewage') return `${m}/kL pumped`;
  if (d.collect) return `${m}/t collected`;
  return d.cov === 'fire' ? `${m}/wk per building covered` : `${m}/wk per person served`;
}

// ============================================================== road graph
function segOf(g: Game, b: Bld): RSeg | null {
  let s = g.net.segs.get(b.seg);
  if (!s) {
    const p = g.net.pickSeg(b.x, b.z, 45);
    if (!p) return null;
    b.seg = p.seg.id;
    s = p.seg;
  }
  return s;
}
const segTime = (s: RSeg) => s.length / ROAD_TYPES[s.type].speed;
const isEdgeNode = (x: number, z: number) => Math.abs(x) > HALF - 40 || Math.abs(z) > HALF - 40;
/** Is this building's road network connected to the highway out of town? */
function onEdgeNet(g: Game, b: Bld): boolean {
  const s = segOf(g, b);
  const c = s && S.comp.get(s.a);
  return c !== undefined && c !== null && S.compEdge.has(c);
}

function buildComponents(g: Game) {
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c)! !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const n of g.net.nodes.keys()) parent.set(n, n);
  for (const s of g.net.segs.values()) {
    if (!parent.has(s.a) || !parent.has(s.b)) continue;
    const ra = find(s.a), rb = find(s.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  S.comp.clear();
  S.compEdge.clear();
  for (const n of g.net.nodes.values()) {
    const r = find(n.id);
    S.comp.set(n.id, r);
    if (isEdgeNode(n.x, n.z)) S.compEdge.add(r);
  }
  S.compDirty = false;
}

// ============================================================== special buildings' road link
// Landmarks can go down before any road reaches them (roads can come after),
// and a service's road can be an island. Either way it does nothing until a
// road links it to the county's road network (the one that reaches the
// highway): the building gets a red "no road" bubble, like Skylines.

/** Does this road join the county's road network (a route to the highway)? */
export function segLinked(g: Game, s: RSeg | null | undefined): boolean {
  if (!s) return false;
  if (S.compDirty) buildComponents(g);
  const c = S.comp.get(s.a);
  return c !== undefined && S.compEdge.has(c);
}

/** why a landmark, service or depot does nothing for lack of roads, or null when it's linked (or not a special building) */
export function linkProblem(g: Game, b: Bld): 'noRoad' | 'noLink' | null {
  if (b.zone !== 'landmark' && b.zone !== 'service') return null;
  // landmarks face the road they were squared to (or none); services keep the road they were placed on
  const s = b.zone === 'service' ? segOf(g, b) : g.net.pickSeg(b.x, b.z, Math.max(b.hw, b.hd) + 12)?.seg ?? null;
  if (!s) return 'noRoad';
  return segLinked(g, s) ? null : 'noLink';
}

/** what an unlinked special building is missing, and what to do about it */
export function roadLinkText(g: Game, b: Bld): string {
  const off = b.offNet ?? linkProblem(g, b);
  if (!off) return `${b.label} is connected to the road network.`;
  const lm = b.zone === 'landmark';
  const loses = lm ? 'it does nothing: no visitors, and no lift to land values around it' : b.kind === 'busDepot' ? 'no bus can leave it' : 'it serves nobody';
  return off === 'noRoad'
    ? `Not connected to the road network: no road reaches ${b.label}, so ${loses}. Draw a road to it from your streets (🛣️ Roads).`
    : `Not connected to the road network: the road at ${b.label} doesn't join the rest of your roads (no route to the highway), so ${lm ? loses : 'it only serves the buildings on that road'}. Connect it to your streets (🛣️ Roads).`;
}

/** flag every special building's link, and say so when one loses it (placed off the network, or its road bulldozed) */
function updateLinks(g: Game) {
  for (const b of g.buildings.list.values()) {
    if (b.zone !== 'landmark' && b.zone !== 'service') continue;
    const off = linkProblem(g, b) ?? undefined;
    if (off && !b.offNet && S.linksSeen) {
      const text = `🚧 ${b.label} isn't connected to the road network: ${b.zone === 'landmark' ? 'it does nothing' : off === 'noRoad' ? (b.kind === 'busDepot' ? 'no bus can leave it' : 'it serves nobody') : b.kind === 'busDepot' ? 'its buses can only run on its own road' : 'it only serves its own road'} until a road links it to your streets`;
      g.sim.alert('warn', text);
      // cut off by a bulldozer (placing one off the network already said so)
      if (S.linked.has(b.id)) g.toast(text, true);
    } else if (!off && b.offNet && S.linksSeen) g.sim.alert('info', `🛣️ ${b.label} is connected to the road network`);
    b.offNet = off;
    if (off) S.linked.delete(b.id); else S.linked.add(b.id);
  }
  S.linksSeen = true;
}

/** Binary-heap multi-source Dijkstra over nodes (edge cost = drive time). */
function dijkstra(g: Game, sources: { node: number; t: number; o: number }[], maxT: number): Map<number, { t: number; o: number }> {
  const best = new Map<number, { t: number; o: number }>();
  const heap: [number, number, number][] = []; // t, node, owner
  const push = (e: [number, number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  for (const s of sources) { const cur = best.get(s.node); if (!cur || s.t < cur.t) { best.set(s.node, { t: s.t, o: s.o }); push([s.t, s.node, s.o]); } }
  while (heap.length) {
    const [t, n, o] = pop();
    const cur = best.get(n);
    if (!cur || t > cur.t) continue;
    const node = g.net.nodes.get(n);
    if (!node) continue;
    for (const sid of node.segs) {
      const s = g.net.segs.get(sid);
      if (!s) continue;
      const m = s.a === n ? s.b : s.a;
      const nt = t + segTime(s) * (1 + Math.min(1.5, s.vc * 0.6));
      if (nt > maxT) continue;
      const e = best.get(m);
      if (!e || nt < e.t) { best.set(m, { t: nt, o }); push([nt, m, o]); }
    }
  }
  return best;
}

/** Drive time + owner for a building from a node-time map (via its road). */
function reachOf(g: Game, b: Bld, map: Map<number, { t: number; o: number }> | undefined): { t: number; o: number } | null {
  if (!map || !map.size) return null;
  const s = segOf(g, b);
  if (!s) return null;
  const half = segTime(s) / 2;
  const A = map.get(s.a), B = map.get(s.b);
  if (!A && !B) return null;
  if (A && (!B || A.t <= B.t)) return { t: A.t + half, o: A.o };
  return { t: B!.t + half, o: B!.o };
}

function rebuildGraph(g: Game) {
  buildComponents(g);
  const fac = facilities(g);
  // utilities: shed order = drive time from the nearest source (plants + imports)
  for (const u of UTILS) {
    const src: { node: number; t: number; o: number }[] = [];
    for (const f of fac) {
      if (!(f.def[u] ?? 0)) continue;
      const s = segOf(g, f);
      if (s) src.push({ node: s.a, t: 0, o: f.id }, { node: s.b, t: 0, o: f.id });
    }
    for (const n of g.net.nodes.values()) if (isEdgeNode(n.x, n.z)) src.push({ node: n.id, t: 30, o: -1 });
    const m = dijkstra(g, src, 1e9);
    const t = new Map<number, number>();
    for (const [k, v] of m) t.set(k, v.t);
    S.utilT[u] = t;
  }
  // a full landfill's trucks don't run, so it covers nobody: the buildings
  // nearest it go to the next facility in reach (playtest 4: a new landfill
  // left the piles nearest the full one untouched). Its own reach is kept
  // apart, to say why the buildings only it reaches are piling up.
  const fullLandfill = (f: Fac) => !!f.def.store && fsOf(f).stored >= f.def.store;
  const fullSrc: { node: number; t: number; o: number }[] = [];
  let fullR = 0;
  for (const c of COVS) {
    const src: { node: number; t: number; o: number }[] = [];
    let maxR = 0;
    for (const f of fac) {
      if (f.def.cov !== c) continue;
      const s = segOf(g, f);
      if (!s) continue;
      const half = segTime(s) / 2;
      const into = c === 'garbage' && fullLandfill(f) ? fullSrc : src;
      into.push({ node: s.a, t: half, o: f.id }, { node: s.b, t: half, o: f.id });
      if (into === fullSrc) fullR = Math.max(fullR, f.def.reach ?? 0);
      else maxR = Math.max(maxR, f.def.reach ?? 0);
    }
    S.covT[c] = src.length ? dijkstra(g, src, maxR * 1.05) : new Map();
  }
  S.fullT = fullSrc.length ? dijkstra(g, fullSrc, fullR * 1.05) : new Map();
  S.graphDirty = false;
}

// ============================================================== the daily tick
function daily(g: Game, day: number) {
  S.day = day;
  if (!S.checkedLegacy) {
    S.checkedLegacy = true;
    if (!S.loaded && g.sim.population > 300) {
      S.graceUntil = day + 30;
      g.toast('NEW: City Services! Your city now needs power, water, sewage and trash pickup. Open 🏛️ Services. Buildings start leaving in 30 days.');
    }
  }
  const fac = facilities(g);
  const sig = fac.map((f) => f.id).join(',');
  if (sig !== S.facSig) { S.facSig = sig; S.graphDirty = true; }
  if (S.graphDirty || day % 7 === 0) rebuildGraph(g);

  const zoned: ZB[] = [];
  for (const b of g.buildings.list.values()) if (isZoned(b)) zoned.push(b);
  for (const id of S.b.keys()) if (!g.buildings.list.has(id)) S.b.delete(id);
  for (const id of S.f.keys()) if (!g.buildings.list.has(id)) S.f.delete(id);

  allocateUtilities(g, fac, zoned);
  coverage(g, fac, zoned);
  updateLinks(g);
  garbage(g, fac, zoned);
  wellbeing(g, zoned);
  fires(g, zoned);
  if (day % 2 === 0) fields(g, fac, zoned);
  consequences(g, zoned);
  S.overlayT = 0; // repaint the info view with fresh data
  S.iconT = 0;
}

function solarFactor(g: Game): number {
  const w = g.weather.kind;
  const cloud = w === 'clear' || w === 'heatwave' ? 1 : w === 'cloudy' || w === 'fog' || w === 'wildfireSmoke' ? 0.55 : 0.3;
  const season = g.weather.season === 'winter' ? 0.7 : g.weather.season === 'summer' ? 1.1 : 0.9;
  return 0.5 * cloud * season; // day/night average
}

function allocateUtilities(g: Game, fac: Fac[], zoned: ZB[]) {
  const sol = solarFactor(g);
  // contaminated intakes: a pump within 500 m of an outfall drinks its output
  const outfalls = fac.filter((f) => f.def.id === 'sewageOutfall');
  for (const f of fac) if (f.def.id === 'waterPump') fsOf(f).contaminated = outfalls.some((o) => Math.hypot(o.x - f.x, o.z - f.z) < 500);
  for (const u of UTILS) {
    const st = (S.util[u] = z0());
    const supply = new Map<number, number>();
    const dirtyComp = new Set<number>();
    for (const f of fac) {
      let cap = f.def[u] ?? 0;
      if (!cap) continue;
      if (f.def.id === 'solarFarm') cap *= sol;
      const s = segOf(g, f);
      if (!s) continue;
      const c = S.comp.get(s.a);
      if (c === undefined) continue;
      supply.set(c, (supply.get(c) ?? 0) + cap);
      st.supply += cap;
      if (u === 'water' && fsOf(f).contaminated) dirtyComp.add(c);
    }
    let importLeft = IMPORT_CAP[u];
    // consumers sorted by distance from sources: the outskirts go dark first
    const tmap = S.utilT[u];
    const list: { b: ZB; use: number; c: number; t: number }[] = [];
    for (const b of zoned) {
      const bs = bsOf(b);
      if (b.state !== 'active' || b.abandoned !== undefined) { setUtil(bs, u, true); continue; }
      const s = segOf(g, b);
      const c = s ? S.comp.get(s.a) : undefined;
      if (!s || c === undefined) { setUtil(bs, u, false); st.unserved++; st.noRoad++; continue; }
      const t = Math.min(tmap?.get(s.a) ?? 1e9, tmap?.get(s.b) ?? 1e9);
      const use = useOf(b, u);
      st.demand += use;
      list.push({ b, use, c, t });
    }
    list.sort((a, b) => a.t - b.t || a.b.id - b.b.id);
    for (const it of list) {
      const bs = bsOf(it.b);
      const have = supply.get(it.c) ?? 0;
      if (have >= it.use) { supply.set(it.c, have - it.use); setUtil(bs, u, true); st.served += it.use; }
      else if (S.compEdge.has(it.c) && importLeft + have >= it.use) {
        const need = it.use - have;
        supply.set(it.c, 0);
        importLeft -= need;
        st.imported += need;
        setUtil(bs, u, true);
        st.served += it.use;
      } else {
        setUtil(bs, u, false);
        st.unserved++;
        // no plant on its roads and no road to the highway, or the highway's sold out
        if (S.compEdge.has(it.c)) st.capped++; else st.noLink++;
      }
      if (u === 'water') bs.dirty = bs.wa && dirtyComp.has(it.c);
    }
    S.week[u] += st.imported;
  }
}
function setUtil(bs: BS, u: Util, v: boolean) {
  if (u === 'power') bs.pw = v; else if (u === 'water') bs.wa = v; else bs.se = v;
}

function coverage(g: Game, fac: Fac[], zoned: ZB[]) {
  // pass 1: drive-time quality + the load each facility is asked to carry
  const byId = new Map(fac.map((f) => [f.id, f]));
  for (const f of fac) fsOf(f).load = 0;
  const tq = new Map<number, Partial<Record<Cov, { q: number; o: number }>>>();
  for (const b of zoned) {
    const r: Partial<Record<Cov, { q: number; o: number }>> = {};
    for (const c of COVS) {
      const hit = reachOf(g, b, S.covT[c]);
      if (!hit) continue;
      const f = byId.get(hit.o);
      if (!f) continue;
      const q = Math.max(0, 1 - Math.pow(hit.t / (f.def.reach ?? 1), 2));
      if (q <= 0) continue;
      r[c] = { q, o: hit.o };
      fsOf(f).load += c === 'fire' ? 1 + (b.level - 1) * 0.5 : c === 'garbage' || c === 'parks' ? 0 : c === 'school' || c === 'college' ? (isRes(b) ? peopleOf(b) : 0) : peopleOf(b);
    }
    tq.set(b.id, r);
  }
  for (const f of fac) {
    const fs = fsOf(f);
    fs.quality = f.def.capacity ? Math.min(1, f.def.capacity / Math.max(1, fs.load)) : 1;
  }
  // pass 2: coverage = time quality x capacity share
  for (const b of zoned) {
    const bs = bsOf(b), r = tq.get(b.id)!;
    for (const c of COVS) {
      const e = r[c];
      bs.cov[c] = e ? e.q * fsOf(byId.get(e.o)!).quality : 0;
    }
    if (!bs.wa) bs.cov.fire *= 0.4; // no water pressure, no hydrants
  }
}

function garbage(g: Game, fac: Fac[], zoned: ZB[]) {
  let made = 0, collected = 0, stored = 0, capacity = 0, room = 0;
  const cap = new Map<number, number>(); // facility -> tons it can still take today
  for (const f of fac) {
    if (f.def.cov !== 'garbage') continue;
    const fs = fsOf(f);
    if (f.def.store) { fs.full = fs.stored >= f.def.store; stored += fs.stored; capacity += f.def.store; }
    cap.set(f.id, fs.full ? 0 : f.def.collect ?? 0);
    room += fs.full ? 0 : f.def.collect ?? 0;
  }
  const owned = new Map<number, ZB[]>();
  for (const b of zoned) {
    if (b.state !== 'active' || b.abandoned !== undefined) continue;
    const bs = bsOf(b);
    const t = trashOf(b);
    bs.garbage += t;
    bs.pick = 0;
    bs.via = -1;
    made += t;
    const hit = reachOf(g, b, S.covT.garbage);
    if (hit && bs.cov.garbage > 0) {
      bs.via = hit.o;
      let arr = owned.get(hit.o);
      if (!arr) owned.set(hit.o, (arr = []));
      arr.push(b);
    } else {
      // only a full landfill reaches it: that landfill's building, collected by nobody
      const full = reachOf(g, b, S.fullT), fd = full && g.buildings.list.get(full.o);
      if (full && fd && full.t < (defOf(fd)?.reach ?? 0)) bs.via = full.o;
    }
  }
  // facilities whose trucks can't keep up with what their buildings make
  const behind = new Set<number>();
  for (const f of fac) if (f.def.cat === 'garbage') { const fs = fsOf(f); fs.served = 0; fs.took = 0; fs.behind = false; }
  for (const [fid, arr] of owned) {
    const start = cap.get(fid) ?? 0;
    let left = start;
    if (left <= 0) continue;
    let makes = 0;
    for (const b of arr) makes += trashOf(b);
    if (makes > start * 0.98) behind.add(fid);
    // route batching: the fullest bins first
    arr.sort((a, b) => bsOf(b).garbage - bsOf(a).garbage);
    for (const b of arr) {
      if (left <= 0) break;
      const bs = bsOf(b);
      const take = Math.min(bs.garbage * (0.35 + 0.65 * Math.min(1, bs.cov.garbage * 1.6)), left);
      bs.garbage -= take;
      bs.pick += take;
      left -= take;
      collected += take;
    }
    const f = g.buildings.list.get(fid);
    const d = f && defOf(f);
    if (f) { const fs = fsOf(f); fs.served = arr.length; fs.took = start - left; fs.behind = behind.has(fid); }
    if (f && d?.store) {
      const fs = fsOf(f);
      const was = fs.stored;
      fs.stored = Math.min(d.store, fs.stored + (start - left));
      fs.rate = fs.rate > 0 ? fs.rate * 0.85 + (fs.stored - was) * 0.15 : fs.stored - was;
      landfillWarnings(g, f, d, fs, arr.length);
    }
    // a truck goes out on the route now and then (the visible part)
    if (f && arr.length && Math.random() < 0.5) dispatchFrom(g, f, arr[0], 'collecting trash', arr[0].label);
  }
  // the county contractor hauls what no local truck reaches (capped, pricey); a
  // full landfill's own buildings aren't its business (as before full landfills stopped covering)
  let exportLeft = TRASH_EXPORT;
  const uncovered = zoned.filter((b) => b.state === 'active' && b.abandoned === undefined && bsOf(b).cov.garbage <= 0 && bsOf(b).via < 0 && bsOf(b).garbage > 0.05 && onEdgeNet(g, b));
  uncovered.sort((a, b) => bsOf(b).garbage - bsOf(a).garbage);
  for (const b of uncovered) {
    if (exportLeft <= 0) break;
    const bs = bsOf(b);
    const take = Math.min(bs.garbage, exportLeft);
    bs.garbage -= take;
    bs.pick += take;
    exportLeft -= take;
  }
  const exported = TRASH_EXPORT - exportLeft;
  S.week.trash += exported;
  if (exported > 0 && uncovered.length && Math.random() < 0.25) {
    const b = uncovered[0];
    g.traffic.dispatch('garbageTruck', 'edge', b, 'county waste contract', b.label, g.hour, { sober: true, local: false, onDone: (_c, ok) => { if (ok && g.buildings.list.has(b.id)) g.traffic.dispatch('garbageTruck', b, 'edge', 'hauling trash out of county', 'the next county', g.hour, { sober: true, local: false }); } });
  }
  // why each building's trash is where it is (the panel, the card and the icons say it)
  const why: Record<TrashWhy, number> = { full: 0, reach: 0, capacity: 0, clearing: 0, queued: 0 };
  let fullServed = 0;
  for (const b of zoned) {
    if (b.state !== 'active' || b.abandoned !== undefined) continue;
    const bs = bsOf(b);
    bs.trash = bs.pick > 0 ? 'clearing' : bs.via < 0 ? 'reach' : S.f.get(bs.via)?.full ? 'full' : behind.has(bs.via) ? 'capacity' : 'queued';
    if (bs.trash === 'full') fullServed++;
    if (trashDaysOf(b, bs) > TRASH_ICON) why[bs.trash]++;
  }
  // when the landfills fill up at today's pace
  let fill = 0, left = 0;
  const full: string[] = [];
  for (const f of fac) {
    if (!f.def.store) continue;
    const fs = fsOf(f);
    if (fs.full) { full.push(f.label); continue; }
    fill += Math.max(0, fs.rate);
    left += f.def.store - fs.stored;
  }
  S.garbage = { made, collected, exported, stored, capacity, room, fill, daysLeft: fill > 0.05 ? left / fill : Infinity, full, fullServed, why };
}

/**
 * A landfill filling up warns at 75% and 90% with the days it has left, and
 * when it's full says what that does: its trucks stop, and every building
 * they served starts piling up trash.
 */
function landfillWarnings(g: Game, f: Bld, d: SvcDef, fs: FS, served: number) {
  const store = d.store!, pctFull = fs.stored / store;
  const days = fs.rate > 0.05 ? (store - fs.stored) / fs.rate : null;
  const pace = days !== null ? `about ${spanOf(days)} left at ${fs.rate.toFixed(fs.rate < 10 ? 1 : 0)} t/day` : 'filling slowly';
  if (fs.stored >= store && !fs.full) {
    fs.full = true;
    fs.warned = 100;
    S.graphDirty = true; // it stops covering: its buildings go to the next facility in reach, if any
    post(g, 'landfillFull', { building: f.label }, 1);
    // the rest of the garbage system may already handle the whole town (playtest: a full site read as an
    // emergency while another one took all the trash)
    const others = facilities(g).filter((o) => o.id !== f.id && o.def.collect && !fsOf(o).full).reduce((a, o) => a + (o.def.collect ?? 0), 0);
    if (others >= S.garbage.made && others > 0) {
      g.sim.alert('info', `🗑️ ${f.label} full (${store.toLocaleString()} t): its trucks stopped; your other sites (${others} t/day) handle the town's ${S.garbage.made.toFixed(1)} t/day`);
      g.toast(`${f.label} is full and its trucks stopped, but your other garbage sites (${others} t/day) handle all of the town's trash (${S.garbage.made.toFixed(1)} t/day). It still costs $${d.upkeep}/wk while it sits idle: bulldoze it if you don't need it.`);
    } else {
      const msg = `${f.label} is full: its trucks stopped, and the ${served} building${served === 1 ? '' : 's'} they served will pile up trash (people start leaving in about ${TRASH_CRIT - TRASH_ICON + ABANDON_DAYS} days). Build another landfill or an incinerator (Services → Garbage).`;
      g.sim.alert('crit', `🗑️ ${f.label} full (${store.toLocaleString()} t): trucks stopped`);
      g.toast(msg, true);
    }
  } else if (pctFull >= 0.9 && fs.warned < 90) {
    fs.warned = 90;
    g.sim.alert('warn', `🗑️ ${f.label} 90% full: ${pace}`);
    g.toast(`${f.label} is 90% full: ${pace}. When it's full its trucks stop. Build another landfill or an incinerator now (Services → Garbage).`, true);
  } else if (pctFull >= 0.75 && fs.warned < 75) {
    fs.warned = 75;
    g.sim.alert('warn', `🗑️ ${f.label} 75% full: ${pace}`);
    g.toast(`${f.label} is 75% full: ${pace}. Plan another landfill or an incinerator (Services → Garbage).`);
  }
}

function wellbeing(g: Game, zoned: ZB[]) {
  const unemp = g.sim.unemployment;
  for (const b of zoned) {
    if (b.state !== 'active') continue;
    const bs = bsOf(b);
    // crime: density, poverty, unemployment; police coverage prevents and clears
    const dens = { resLow: 0.5, resHigh: 1.1, comLow: 0.9, comHigh: 1.3, industry: 0.8, office: 0.6 }[b.zone];
    const poor = b.lv < 25 ? 1.5 : b.lv < 45 ? 1.1 : 0.8;
    const pol = bs.cov.police;
    bs.crime += 0.9 * dens * poor * (1 + unemp * 3) * (1 - 0.85 * pol) * POLICY.crimeMul(b) - (0.25 + 2.2 * pol);
    if (b.abandoned !== undefined) bs.crime += 0.8;
    bs.crime = Math.max(0, Math.min(100, bs.crime));
    if (bs.crime > 70 && pol > 0.2 && Math.random() < 0.08) {
      const hit = reachOf(g, b, S.covT.police);
      const st = hit && g.buildings.list.get(hit.o);
      if (st) dispatchFrom(g, st, b, 'responding to a call', b.label);
    }
    // health: pollution, no water/sewage, trash, dirty water; clinics treat
    const polHere = S.fields.sample(S.fields.pol, b.x, b.z);
    const polSick = Math.min(0.3, polHere * 0.1), trashSick = trashDaysOf(b, bs) > TRASH_BAD ? 0.08 : 0;
    const target = (0.02 + polSick + (bs.wa ? 0 : 0.18) + (bs.se ? 0 : 0.12) + trashSick + (bs.dirty ? 0.12 : 0)) * (1 - 0.8 * bs.cov.health);
    bs.sick += (target - bs.sick) * 0.15;
    if (bs.sick > 0.18 && bs.cov.health > 0.2 && Math.random() < 0.05) {
      const hit = reachOf(g, b, S.covT.health);
      const st = hit && g.buildings.list.get(hit.o);
      if (st) dispatchFrom(g, st, b, 'on a call', b.label);
    }
    // education drifts toward what the local schools can provide
    const eTarget = Math.min(1, (0.15 + 0.5 * bs.cov.school + 0.4 * bs.cov.college) * POLICY.educationMul(b));
    bs.edu += (eTarget - bs.edu) * 0.04;
    // sick people move out
    if (isRes(b) && bs.sick > 0.2 && b.occ > 0 && Math.random() < bs.sick) { b.occ--; g.sim.lose(1, sickRoot(bs, polSick, trashSick)); }
  }
}

/** What made a building sick, as a loss cause: the biggest thing feeding its sickness. */
function sickRoot(bs: BS, polSick: number, trashSick: number): LossCause {
  const parts: [LossCause, number][] = [['pollution', polSick], ['water', (bs.wa ? 0 : 0.18) + (bs.dirty ? 0.12 : 0)], ['sewage', bs.se ? 0 : 0.12], ['garbage', trashSick]];
  const [cause, v] = parts.sort((a, b) => b[1] - a[1])[0];
  return v >= 0.03 ? cause : 'health';
}

function fires(g: Game, zoned: ZB[]) {
  const w = g.weather.kind;
  const wx = w === 'heatwave' ? 2 : w === 'wildfireSmoke' ? 2.5 : w === 'rain' || w === 'storm' || w === 'snow' || w === 'blizzard' || w === 'hurricane' ? 0.4 : 1;
  for (const b of zoned) {
    if (b.state !== 'active' || !g.buildings.list.has(b.id)) continue;
    const bs = bsOf(b);
    if (bs.burning > 0) {
      const fire = bs.cov.fire;
      if (fire > 0.05 && Math.random() < 0.3 + 0.65 * fire) {
        bs.burning = 0;
        b.levelProgress = 0;
        continue;
      }
      bs.burning -= 1;
      // spreads to the neighbors when nobody's coming
      if (fire < 0.3) for (const n of g.buildings.near(b.x, b.z, 22)) if (n !== b && isZoned(n) && Math.random() < 0.18) igniteBuilding(g, n);
      if (bs.burning <= 0) {
        S.counts.burned++;
        post(g, 'buildingBurned', { building: b.label }, 0.8);
        g.terrain.paintCircle(b.x, b.z, Math.min(b.hw, b.hd) + 2, Paint.Scorched);
        g.particles.emit('smoke', b.x, b.y + 4, b.z, { count: 40, spread: b.hw });
        g.buildings.demolish(b, 'fire');
        S.b.delete(b.id);
      }
      continue;
    }
    const zm = b.zone === 'industry' ? 2.5 : b.zone === 'comHigh' ? 1.3 : b.zone === 'resHigh' ? 1.2 : 1;
    const trash = trashDaysOf(b, bs) > TRASH_BAD ? 1.8 : 1;
    const p = 0.00005 * zm * (1 + 0.15 * (b.level - 1)) * trash * (bs.pw ? 1 : 1.4) * wx * (1 - 0.6 * bs.cov.fire) * (b.abandoned !== undefined ? 3 : 1) * POLICY.fireRiskMul(b);
    if (Math.random() < p) igniteBuilding(g, b);
  }
}

/** Set a building on fire (fire stations respond). Also used by disasters. */
export function igniteBuilding(g: Game, b: Bld) {
  if (!isZoned(b) || b.state !== 'active') return;
  const bs = bsOf(b);
  if (bs.burning > 0) return;
  bs.burning = 3;
  S.counts.fires++;
  post(g, 'buildingFire', { building: b.label }, 0.5);
  const hit = reachOf(g, b, S.covT.fire);
  const st = hit && g.buildings.list.get(hit.o);
  if (st) dispatchFrom(g, st, b, 'responding to a fire', b.label);
}

function dispatchFrom(g: Game, from: Bld, to: Bld, purpose: string, dest: string) {
  const d = defOf(from);
  if (!d?.vehicle || from.state !== 'active') return;
  const fs = fsOf(from);
  if (fs.out >= 3) return;
  const kind = d.vehicle;
  const car = g.traffic.dispatch(kind, from, to, purpose, dest, g.hour, {
    sober: true,
    onDone: (_c, arrived) => {
      fs.out = Math.max(0, fs.out - 1);
      if (arrived && g.buildings.list.has(from.id) && g.buildings.list.has(to.id)) g.traffic.dispatch(kind, to, from, 'heading back to base', from.label, g.hour, { sober: true });
    },
  });
  if (car) fs.out++;
}

function fields(g: Game, fac: Fac[], zoned: ZB[]) {
  const F = S.fields;
  for (const f of fac) if (f.def.pollution) F.addEmission(f.x, f.z, f.def.pollution * (f.def.store ? 0.4 + Math.min(1, fsOf(f).stored / f.def.store) : 1));
  for (const b of zoned) {
    if (b.state !== 'active' || b.abandoned !== undefined) continue;
    if (b.zone === 'industry') F.addEmission(b.x, b.z, 0.0028 * Math.max(b.occ, b.cap * 0.5) * (1 + 0.1 * (b.level - 1)));
    if (trashDaysOf(b, bsOf(b)) > TRASH_BAD) F.addEmission(b.x, b.z, 0.01);
  }
  const wind = g.weather.wind;
  F.stepPollution(2, wind.x, wind.y);
  F.rebuildNoise((stamp) => {
    for (const s of g.net.segs.values()) {
      const T = ROAD_TYPES[s.type];
      const base = 0.12 + T.lanesPerDir * 0.1 + (s.type === 'highway' ? 0.25 : 0);
      const lvl = base * (0.4 + Math.min(1.2, s.vc));
      const pts = s.samp.pts;
      const step = Math.max(1, Math.floor(pts.length / Math.max(1, s.length / 48)));
      for (let i = 0; i < pts.length; i += step) stamp(pts[i].x, pts[i].z, lvl, 1);
    }
    for (const b of zoned) {
      if (b.state !== 'active') continue;
      if (b.zone === 'industry') stamp(b.x, b.z, 0.45, 1.5);
      else if (b.zone === 'comHigh') stamp(b.x, b.z, 0.3, 1);
      else if (b.zone === 'comLow') stamp(b.x, b.z, 0.18, 0.6);
    }
    for (const f of fac) if (f.def.noise) stamp(f.x, f.z, f.def.noise, 2);
  });
  let hot = 0;
  for (const v of F.pol) if (v > 2) hot++;
  if (hot > 6) post(g, 'pollution', {}, 0.15);
}

function consequences(g: Game, zoned: ZB[]) {
  const c = { noPower: 0, noWater: 0, noSewage: 0, trash: 0, crime: 0, sick: 0, abandoned: 0 };
  let newlyAbandoned = 0;
  // abandoned buildings within a warning's days of coming down: how many, the soonest, and what keeps people out
  const coming = DEMOLISH_WARN.map(() => ({ n: 0, soonest: Infinity, by: new Map<Need, number>() }));
  for (const b of zoned) {
    if (b.state !== 'active' || !g.buildings.list.has(b.id)) continue;
    const bs = bsOf(b);
    if (!bs.pw) c.noPower++;
    if (!bs.wa) c.noWater++;
    if (!bs.se) c.noSewage++;
    const td = trashDaysOf(b, bs);
    // an abandoned building's trash stays where it was, but it isn't piling up any more
    if (td > TRASH_ICON && b.abandoned === undefined) c.trash++;
    if (bs.crime > 55) c.crime++;
    if (bs.sick > 0.15) c.sick++;
    const critical = !bs.pw || !bs.wa || !bs.se || td > TRASH_CRIT || bs.sick > 0.35;
    if (b.abandoned === undefined) {
      bs.bad = critical && S.day >= S.graceUntil ? bs.bad + 1 : Math.max(0, bs.bad - 3);
      if (bs.bad >= ABANDON_DAYS) {
        // its residents leave with it: book them to what emptied it (setAbandoned zeroes occ)
        if (isRes(b) && b.occ > 0) loseToNeeds(g, b, bs, td);
        g.buildings.setAbandoned(b, true); bs.ok = 0; newlyAbandoned++; post(g, 'abandoned', { building: b.label }, 0.3);
      }
    } else {
      c.abandoned++;
      b.abandoned++;
      bs.ok = critical ? 0 : bs.ok + 1;
      if (bs.ok >= 4) { g.buildings.setAbandoned(b, false); bs.bad = 0; }
      else if (b.abandoned >= DEMOLISH_DAYS) { g.buildings.demolish(b, 'abandoned'); S.b.delete(b.id); }
      else if (critical) {
        const left = DEMOLISH_DAYS - b.abandoned, need: Need = !bs.pw ? 'power' : !bs.wa ? 'water' : !bs.se ? 'sewage' : td > TRASH_CRIT ? 'garbage' : 'health';
        DEMOLISH_WARN.forEach((w, i) => {
          if (left > w) return;
          const k = coming[i];
          k.n++; k.soonest = Math.min(k.soonest, left); k.by.set(need, (k.by.get(need) ?? 0) + 1);
        });
      }
    }
  }
  // how many abandoned buildings come down soon, when the first does, and what brings their people back
  // (the urgent warning first; each again only after a while, not for every building as it crosses)
  for (let i = DEMOLISH_WARN.length - 1; i >= 0; i--) {
    const k = coming[i], every = i === DEMOLISH_WARN.length - 1 ? 5 : 10;
    if (!k.n || S.day - (S.demolishWarned[i] ?? -1e9) < every) continue;
    S.demolishWarned[i] = S.day;
    let top: Need = 'garbage', topN = 0;
    for (const [need, n] of k.by) if (n > topN) { topN = n; top = need; }
    const one = k.n === 1, what = `${k.n} abandoned building${one ? '' : 's'}`;
    g.sim.alert(i === DEMOLISH_WARN.length - 1 ? 'crit' : 'warn', `🏚️ ${what} within ${DEMOLISH_WARN[i]} days: the first comes down in ${k.soonest} days (${NEED[top].failing})`);
    g.toast(`${what} will be torn down within ${DEMOLISH_WARN[i]} days, the first in ${k.soonest}: ${one ? "it's" : "they're"} ${NEED[top].failing}. Fix it in Services → ${NEED[top].label} and people move back in, or bulldoze ${one ? 'it' : 'them'}.`, true);
    break;
  }
  Object.assign(S.counts, c);
  const share = (n: number) => (zoned.length ? n / zoned.length : 0);
  if (c.noPower > 3 && share(c.noPower) > 0.05) post(g, 'blackout', { count: c.noPower }, 0.35);
  if (c.noWater > 3 && share(c.noWater) > 0.05) post(g, 'waterOutage', { count: c.noWater }, 0.3);
  if (c.noSewage > 3 && share(c.noSewage) > 0.05) post(g, 'sewageBackup', { count: c.noSewage }, 0.3);
  if (c.trash > 5 && share(c.trash) > 0.08) post(g, 'garbagePile', { count: c.trash }, 0.25);
  if (c.crime > 5 && share(c.crime) > 0.08) post(g, 'crimeWave', {}, 0.2);
  if (c.sick > 5 && share(c.sick) > 0.08) post(g, 'sickness', {}, 0.2);
  S.abandonedDays.push(newlyAbandoned);
  if (S.abandonedDays.length > 3) S.abandonedDays.shift();
  for (const u of UTILS) {
    const n = S.util[u].unserved;
    if (n > 3 && S.cutWas[u] <= 3) g.sim.alert('warn', `${NEED[u].icon} ${n} buildings cut off from ${u}`);
    S.cutWas[u] = n;
  }
  assess(g, zoned);
  if (newlyAbandoned >= 3) {
    const top = S.emergency?.needs[0];
    g.toast(top ? `${newlyAbandoned} buildings abandoned over ${top.label.toLowerCase()}. Fix it in Services → ${NEED[top.need].label}.` : `${newlyAbandoned} buildings abandoned. Check the Services info views.`, true);
  }
}

/** Book a building's residents to the needs that emptied it (split evenly when several failed). */
function loseToNeeds(g: Game, b: ZB, bs: BS, td: number) {
  const causes = new Set<LossCause>();
  if (!bs.pw) causes.add('power');
  if (!bs.wa) causes.add('water');
  if (!bs.se) causes.add('sewage');
  if (td > TRASH_CRIT) causes.add('garbage');
  if (bs.sick > 0.35) causes.add(sickRoot(bs, Math.min(0.3, S.fields.sample(S.fields.pol, b.x, b.z) * 0.1), td > TRASH_BAD ? 0.08 : 0));
  if (!causes.size) causes.add('demand');
  for (const c of causes) g.sim.lose(b.occ / causes.size, c);
}

/** Why a need is failing, in the Services panel's own numbers. */
function needWhy(need: Need): string {
  if (need === 'garbage') {
    const G = S.garbage, W = G.why, parts: string[] = [];
    if (W.full) parts.push(`${G.full.length === 1 ? `${G.full[0]} is full` : `${G.full.length} landfills are full`}, so the trucks serving ${W.full} of them are idle`);
    if (W.reach) parts.push(`${W.reach} ${W.reach === 1 ? 'is' : 'are'} out of every truck's reach${G.exported >= TRASH_EXPORT - 0.01 ? ` and the county contract is maxed (${TRASH_EXPORT} t/day)` : ''}`);
    if (W.capacity) parts.push(`${W.capacity} wait on trucks at their daily limit (${G.room.toFixed(0)} t/day for ${G.made.toFixed(0)} t/day made)`);
    return parts.join('; ') || 'trash is piling up';
  }
  if (need === 'health') return 'residents are too sick to stay: a clinic in reach treats them; pollution, dirty water and trash make them sick';
  const st = S.util[need], parts: string[] = [];
  // counts only when there's more than one cause (with one, it's all of them, and a
  // building abandoned since the morning's count can't make the numbers disagree)
  const n = (v: number) => ((st.capped ? 1 : 0) + (st.noLink ? 1 : 0) + (st.noRoad ? 1 : 0) > 1 ? `${v} ` : '');
  if (st.capped) parts.push(`${n(st.capped)}past the highway's import limit: they need ${fmt(st.demand, need)}, your plants make ${fmt(st.supply, need)}, and imports top out at ${fmt(IMPORT_CAP[need], need)}`);
  if (st.noLink) parts.push(`${n(st.noLink)}on roads with no ${UTIL_SOURCE[need]} and no route to the highway`);
  if (st.noRoad) parts.push(`${n(st.noRoad)}not on a road`);
  return parts.join('; ') || 'cut off';
}
const UTIL_SOURCE: Record<Util, string> = { power: 'plant', water: 'pump', sewage: 'outfall' };

/**
 * Buildings cut off from several utilities at once (a road network with no
 * way to the highway) are one problem, not three: one line for all of them.
 * Only the same buildings merge: ten homes with no power and ten shops with
 * no sewage are two problems, even with the same counts.
 */
function mergeUtilities(needs: EmergencyNeed[], ids: Map<Need, number[]>): EmergencyNeed[] {
  const utils = needs.filter((x) => x.need === 'power' || x.need === 'water' || x.need === 'sewage');
  const same = (a: Need, b: Need) => {
    const p = ids.get(a), q = ids.get(b);
    return !!p && !!q && p.length === q.length && p.every((v, i) => v === q[i]);
  };
  const groups: EmergencyNeed[][] = [];
  for (const u of utils) {
    const grp = groups.find((gr) => same(gr[0].need, u.need));
    if (grp) grp.push(u); else groups.push([u]);
  }
  if (!groups.some((gr) => gr.length > 1)) return needs;
  const list = (a: string[], or = 'and') => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} ${or} ${a[a.length - 1]}`);
  let out = needs;
  for (const grp of groups) {
    if (grp.length < 2) continue;
    const kinds = grp.map((x) => x.need as Util);
    const noLink = grp.every((x) => /^on roads with no \w+ and no route to the highway$/.test(x.why));
    const merged: EmergencyNeed = {
      ...grp[0], icon: grp.map((x) => x.icon).join(''), label: 'Utilities', failing: `without ${list(kinds)}`,
      eta: [Math.min(...grp.map((x) => x.eta[0])), Math.max(...grp.map((x) => x.eta[1]))],
      why: noLink ? `on roads with no ${list(kinds.map((k) => UTIL_SOURCE[k]), 'or')} and no route to the highway` : grp.map((x) => `${x.need}: ${x.why}`).join('; '),
    };
    out = [merged, ...out.filter((x) => !grp.includes(x))];
  }
  return out.sort((a, b) => b.residents - a.residents || b.buildings - a.buildings);
}

/**
 * The daily emergency assessment: which needs are failing, how many
 * buildings and residents that puts on the clock to abandonment, how long
 * they have, and where they are. A failure big enough to empty a real share
 * of the city is an emergency (the HUD keeps a card up and slows the clock);
 * a smaller one, or a landfill that will fill soon, is a warning.
 */
function assess(g: Game, zoned: ZB[]) {
  const agg = new Map<Need, { buildings: number; residents: number; lo: number; hi: number }>();
  /** which buildings each utility has failed, so only identical outages merge */
  const ids = new Map<Need, number[]>();
  const cells = new Map<string, { x: number; z: number; n: number; residents: number; id: number; eta: number }>();
  let atRisk = 0, residents = 0, active = 0;
  const grace = Math.max(0, S.graceUntil - S.day);
  for (const b of zoned) {
    if (b.state !== 'active' || b.abandoned !== undefined || !g.buildings.list.has(b.id)) continue;
    active++;
    const bs = bsOf(b), td = trashDaysOf(b, bs);
    const needs: Need[] = [];
    if (!bs.pw) needs.push('power');
    if (!bs.wa) needs.push('water');
    if (!bs.se) needs.push('sewage');
    // piling up and nobody's coming for it (a backlog being collected is recovering)
    if (td > TRASH_CRIT || (td > TRASH_ICON && (bs.trash === 'full' || bs.trash === 'reach' || bs.trash === 'capacity'))) needs.push('garbage');
    if (bs.sick > 0.35 && !needs.length) needs.push('health');
    if (!needs.length) continue;
    const critical = !bs.pw || !bs.wa || !bs.se || td > TRASH_CRIT || bs.sick > 0.35;
    const eta = (critical ? 0 : Math.ceil(TRASH_CRIT - td)) + Math.max(1, ABANDON_DAYS - bs.bad) + grace;
    const people = isRes(b) ? b.occ : 0;
    atRisk++;
    residents += people;
    for (const n of needs) {
      const a = agg.get(n) ?? { buildings: 0, residents: 0, lo: Infinity, hi: 0 };
      a.buildings++;
      a.residents += people;
      a.lo = Math.min(a.lo, eta);
      a.hi = Math.max(a.hi, eta);
      agg.set(n, a);
      if (n === 'power' || n === 'water' || n === 'sewage') {
        const l = ids.get(n);
        if (l) l.push(b.id); else ids.set(n, [b.id]);
      }
    }
    const key = `${Math.floor(b.x / 240)},${Math.floor(b.z / 240)}`;
    const cell = cells.get(key) ?? { x: 0, z: 0, n: 0, residents: 0, id: b.id, eta };
    cell.x += b.x; cell.z += b.z; cell.n++; cell.residents += people;
    if (eta < cell.eta) { cell.eta = eta; cell.id = b.id; }
    cells.set(key, cell);
  }
  const needs: EmergencyNeed[] = mergeUtilities([...agg].map(([need, a]) => ({ need, ...NEED[need], buildings: a.buildings, residents: a.residents, eta: [a.lo, a.hi] as [number, number], why: needWhy(need) }))
    .sort((a, b) => b.residents - a.residents || b.buildings - a.buildings), ids);
  const hot = [...cells.values()].map((c) => ({ x: c.x / c.n, z: c.z / c.n, n: c.n, residents: c.residents, id: c.id })).sort((a, b) => b.residents + b.n * 3 - (a.residents + a.n * 3)).slice(0, 6);
  const G = S.garbage;
  const forecast = G.fullServed && !G.why.full ? `🗑️ ${G.full.length === 1 ? `${G.full[0]} is full` : `${G.full.length} landfills are full`}: the ${G.fullServed} building${G.fullServed === 1 ? '' : 's'} only it reaches will pile up trash`
    : G.daysLeft < 60 ? `🗑️ Landfills full in about ${spanOf(G.daysLeft)} at ${G.fill.toFixed(G.fill < 10 ? 1 : 0)} t/day (${Math.round(G.stored).toLocaleString()} / ${Math.round(G.capacity).toLocaleString()} t)` : null;
  const pop = g.sim.population;
  const recent = S.abandonedDays.reduce((a, v) => a + v, 0);
  const crit = atRisk > 0 && (residents >= Math.max(30, pop * 0.08) || atRisk >= Math.max(10, active * 0.06) || recent >= Math.max(5, active * 0.03));
  const warn = atRisk >= 3 || !!forecast;
  const C = S.crisis;
  // a garbage emergency isn't over because the city emptied: abandoned
  // buildings keep their trash, and nothing comes back while the only
  // landfill is full (the playtest's city sat at 9 people until a new one)
  const trashStuck = G.full.length > 0 && G.room < Math.max(1, G.made);
  const holding = C.level === 'crit' && C.cause === 'garbage' && trashStuck;
  if (holding && !needs.some((x) => x.need === 'garbage'))
    needs.unshift({ need: 'garbage', ...NEED.garbage, buildings: 0, residents: 0, eta: [0, 0], why: `${G.full.length === 1 ? `${G.full[0]} is full` : `${G.full.length} landfills are full`} and nothing else collects trash, so anything that comes back piles up again` });
  let onset = false;
  if (crit || holding) {
    if (C.level !== 'crit') {
      const top = needs[0];
      Object.assign(C, { level: 'crit', since: S.day, cause: top.need, peakAtRisk: atRisk, peakTrash: S.counts.trash, lowPop: pop, popAtStart: pop, endedAt: 0 });
      g.sim.alert('crit', `🚨 ${top.label} emergency: ${atRisk} buildings, ${residents.toLocaleString()} residents on the clock (first abandoned in ~${top.eta[0]} days)`);
      onset = true;
    } else {
      C.cause = needs[0].need;
      C.peakAtRisk = Math.max(C.peakAtRisk, atRisk);
      C.peakTrash = Math.max(C.peakTrash, S.counts.trash);
      C.lowPop = Math.min(C.lowPop, pop);
    }
  } else if (C.level === 'crit') {
    C.level = 'recovering';
    C.endedAt = S.day;
    C.lowPop = Math.min(C.lowPop, pop);
    g.sim.alert('info', `✅ Recovering from the ${NEED[C.cause as Need]?.label.toLowerCase() ?? 'service'} emergency: ${C.peakAtRisk} → ${atRisk} buildings at risk`);
  } else if (C.level === 'recovering') {
    C.lowPop = Math.min(C.lowPop, pop);
    if (S.day - C.endedAt > 30 || (atRisk === 0 && S.counts.trash <= 5 && S.day - C.endedAt > 7)) C.level = 'none';
  }
  S.emergency = {
    level: C.level === 'crit' ? 'crit' : C.level === 'recovering' ? 'recovering' : warn ? 'warn' : 'none',
    needs, atRisk, residents, hot, forecast, forecastDays: !forecast ? null : G.fullServed && !G.why.full ? 0 : G.daysLeft, crisis: { ...C }, trash: S.counts.trash, abandoned: S.counts.abandoned, day: S.day,
  };
  if (onset) g.ui.emergency?.(S.emergency);
}

/** Feed post with a per-kind cooldown in game days. */
function post(g: Game, kind: FeedEventKind, ctx: Partial<FeedContext>, chance: number) {
  const last = S.lastFeed.get(kind) ?? -1e9;
  if (S.day - last < 12 || Math.random() > chance) return;
  S.lastFeed.set(kind, S.day);
  g.feed.push(kind, ctx);
}

// ============================================================== sim hooks
function initHooks(g: Game) {
  const H = g.sim.hooks;
  g.sim.serviceCostPerCapita = 0; // real facilities are billed instead
  // the College's first graduates (owner, 2026-09-30; docs/PLAYTEST_6.md: nothing said
  // what it did once built): the first home to reach level 5 in its reach says so, once
  // (a town loaded with level-5 homes already has its graduates)
  let graduated = false;
  g.buildings.onLevel = ((orig) => (b: Bld) => {
    orig?.(b);
    if (graduated || !isZoned(b) || !isRes(b) || b.level < 5 || !(S.b.get(b.id)?.cov.college ?? 0)) return;
    graduated = true;
    for (const o of g.buildings.list.values()) if (o !== b && isZoned(o) && isRes(o) && o.level >= 5) return;
    let college: Bld | undefined;
    for (const o of g.buildings.list.values()) if (o.kind === 'college' && (!college || Math.hypot(o.x - b.x, o.z - b.z) < Math.hypot(college.x - b.x, college.z - b.z))) college = o;
    let n = 0;
    for (const o of g.buildings.list.values()) if (isZoned(o) && isRes(o) && (S.b.get(o.id)?.cov.college ?? 0) > 0 && (S.b.get(o.id)?.edu ?? 0) >= 0.7) n++;
    g.toast(`🎓 First graduates from ${college?.label ?? 'the university'}: ${n} home${n === 1 ? '' : 's'} in its reach can now grow to level 5.`);
  })(g.buildings.onLevel);
  H.vacancy.push((b) => {
    if (!isZoned(b) || b.state !== 'active') return null;
    const bs = S.b.get(b.id);
    if (!bs) return null;
    if (bs.burning > 0) return 'On fire!';
    const miss = [!bs.pw && 'electricity', !bs.wa && 'running water', !bs.se && 'sewage'].filter(Boolean);
    if (miss.length) return `No ${miss.join(', no ')}`;
    if (trashDaysOf(b, bs) > TRASH_CRIT) return 'Trash piled to the roof (no garbage pickup)';
    if (bs.sick > 0.35) return 'Everyone here is sick';
    return null;
  });
  H.levelCap.push((b) => {
    if (!isZoned(b)) return null;
    const bs = S.b.get(b.id);
    if (!bs) return null;
    if (!bs.pw || !bs.wa || !bs.se) return { max: b.level, why: 'Needs power, water and sewage to grow' };
    let cap: { max: number; why: string } | null = null;
    const lower = (max: number, why: string) => { if (!cap || max < cap.max) cap = { max, why }; };
    const z = b.zone;
    if (z === 'resLow' || z === 'resHigh') {
      if (bs.edu < 0.35) lower(2, 'Needs a school nearby (education)');
      else if (bs.edu < 0.7) lower(4, 'Needs college grads (build a university)');
      if (bs.cov.health < 0.3) lower(3, 'Needs healthcare within reach');
    } else if (z === 'office') {
      if (bs.edu < 0.3) lower(1, 'Offices need educated workers (build a school)');
      else if (bs.edu < 0.6) lower(3, 'Needs college grads (build a university)');
    } else if (z === 'comLow' || z === 'comHigh') {
      if (bs.edu < 0.3) lower(3, 'Needs educated workers (build a school)');
    } else if (z === 'industry') {
      if (bs.cov.fire < 0.3) lower(2, 'Needs fire coverage to expand');
    }
    return cap;
  });
  H.landValue.push((b) => {
    if (!isZoned(b)) return 0;
    const bs = S.b.get(b.id);
    if (!bs) return 0;
    const z = b.zone, res = isRes(b);
    const cv = bs.cov;
    let v = 0;
    if (res) v += cv.fire * 4 + cv.police * 5 + cv.health * 5 + cv.school * 4 + cv.parks * 10;
    else if (z === 'office') v += cv.fire * 3 + cv.police * 3 + cv.parks * 5;
    else if (z === 'industry') v += cv.fire * 3 + cv.police * 2;
    else v += cv.fire * 3 + cv.police * 4 + cv.parks * 4;
    const pol = Math.min(1, S.fields.sample(S.fields.pol, b.x, b.z) / 2.5);
    const noise = Math.min(1, S.fields.sample(S.fields.noise, b.x, b.z));
    v -= pol * (res ? 28 : z === 'office' ? 18 : z === 'industry' ? 4 : 12);
    v -= noise * (res ? 14 : z === 'office' ? 6 : 2);
    v -= (bs.crime / 100) * 16;
    if (trashDaysOf(b, bs) > TRASH_ICON) v -= 6;
    v -= Math.min(12, bs.sick * 30);
    return v;
  });
  H.demand.push((d, why) => {
    const n = Math.max(1, S.b.size);
    const add = (k: DemandKey, v: number, text: string) => { if (Math.abs(v) < 1) return; d[k] += v; why[k].push(`${text} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))}`); };
    const miss = Math.max(S.counts.noPower, S.counts.noWater, S.counts.noSewage);
    if (miss > 0) {
      const hit = Math.min(35, (miss / n) * 80);
      add('res', -hit, `${miss} building${miss === 1 ? '' : 's'} missing utilities`);
      add('com', -hit * 0.6, 'buildings missing utilities');
      add('ind', -hit * 0.6, 'buildings missing utilities');
    }
    if (S.counts.crime / n > 0.1) add('res', -Math.min(15, (S.counts.crime / n) * 40), 'crime');
    if (S.counts.sick / n > 0.1) add('res', -Math.min(15, (S.counts.sick / n) * 40), 'sickness');
    let sch = 0;
    for (const bs of S.b.values()) sch += bs.cov.school;
    if (S.b.size > 10 && sch / S.b.size > 0.4) add('res', (sch / S.b.size) * 8, 'good schools');
  });
  // the week's bill: what was actually imported, or (forecast) today's daily rate × 7
  H.weekly.push((add, forecast) => {
    const byCat = new Map<SvcCat, number>();
    const run = runningCosts(g);
    for (const f of facilities(g, false)) {
      const up = f.state === 'active' ? f.def.upkeep + (run.get(f.id) ?? 0) : 0;
      byCat.set(f.def.cat, (byCat.get(f.def.cat) ?? 0) + up);
    }
    for (const c of CATS) { const v = byCat.get(c.id); if (v) add(`${c.label} upkeep`, v, 'services'); }
    for (const u of UTILS) {
      const cost = (forecast ? S.util[u].imported * 7 : S.week[u]) * IMPORT_PRICE[u];
      if (cost >= 1) add(`${u[0].toUpperCase() + u.slice(1)} imports`, cost, 'services');
      if (!forecast) S.week[u] = 0;
    }
    const trash = forecast ? S.garbage.exported * 7 : S.week.trash;
    if (trash * TRASH_PRICE >= 1) add('County waste contract', trash * TRASH_PRICE, 'services');
    if (!forecast) S.week.trash = 0;
  });
}

// ============================================================== valid sites
/**
 * While placing a service: green rings on the curb in front of every spot
 * around the view where it fits, checked a few a frame, nearest first.
 * Playtesters took many tries to find room for a hospital, a university or
 * an incinerator against a red ghost; the rules stay, now you can see them.
 */
const SITE_STEP = 16, SITE_R = 420, SITE_BUDGET = 24, SITE_MAX = 160;
const sites = { key: '', queue: [] as Frontage[], found: [] as { x: number; y: number; z: number }[], mesh: null as THREE.InstancedMesh | null };
const siteM = new THREE.Matrix4(), siteQ = new THREE.Quaternion(), siteP = new THREE.Vector3(), siteS = new THREE.Vector3();

function sitesFrame(g: Game) {
  const d = SERVICE_DEFS.get(placing);
  const on = !!d && g.tools.active === 'ext' && g.tools.extTool === 'svcPlace' && !built;
  if (!sites.mesh) {
    if (!on) return;
    const geo = new THREE.RingGeometry(2.2, 3.2, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x5dff7a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    sites.mesh = new THREE.InstancedMesh(geo, mat, SITE_MAX);
    sites.mesh.name = 'svc-sites'; sites.mesh.frustumCulled = false; sites.mesh.renderOrder = 6; sites.mesh.count = 0;
    g.scene.add(sites.mesh);
  }
  sites.mesh.visible = on;
  if (!on || !d) { sites.key = ''; return; }
  const T = g.rts.target, X = Math.round(T.x / 150) * 150, Z = Math.round(T.z / 150) * 150;
  const hw = (d.w * CELL) / 2, hd = (d.d * CELL) / 2;
  // new view block, roads, buildings or a money bracket: look again
  const key = `${placing}|${X},${Z}|${g.net.segs.size}|${g.buildings.list.size}|${Math.floor(g.sim.money / 5000)}`;
  if (key !== sites.key) {
    sites.key = key; sites.found = []; sites.queue = [];
    for (const seg of g.net.segsNear(X - SITE_R, Z - SITE_R, X + SITE_R, Z + SITE_R)) {
      if (seg.over || seg.type === 'highway') continue;
      for (let at = SITE_STEP / 2; at < seg.length; at += SITE_STEP) {
        const p = pointAt(seg.samp, at), t = tangentAt(seg.samp, at);
        for (const side of [1, -1]) {
          const f = frontageOn(g.net, seg, at, p.x - t.z * side * 20, p.z + t.x * side * 20, hd);
          if (f) sites.queue.push(f);
        }
      }
    }
    sites.queue.sort((a, b) => Math.hypot(b.x - T.x, b.z - T.z) - Math.hypot(a.x - T.x, a.z - T.z)); // nearest at the end
  }
  let changed = false;
  for (let n = 0; n < SITE_BUDGET && sites.queue.length && sites.found.length < SITE_MAX; n++) {
    const f = sites.queue.pop()!;
    if (sites.found.some((q) => Math.hypot(q.x - f.door.x, q.z - f.door.z) < hw * 1.5)) continue;
    if (canPlaceService(g, placing, f.x, f.z, f.yaw).ok) { sites.found.push({ x: f.door.x, y: f.roadY + 0.4, z: f.door.z }); changed = true; }
  }
  const m = sites.mesh;
  if (changed || m.count !== sites.found.length) {
    const k = Math.max(1, Math.min(hw, hd) * 0.3 / 3.2);
    siteS.set(k, 1, k);
    sites.found.forEach((q, i) => { siteP.set(q.x, q.y, q.z); siteM.compose(siteP, siteQ, siteS); m.setMatrixAt(i, siteM); });
    m.count = sites.found.length;
    m.instanceMatrix.needsUpdate = true;
  }
}

// ============================================================== frame: fires, icons, overlays
function frame(g: Game, dt: number) {
  sitesFrame(g);
  if (!S.icons) return;
  S.icons.tick(dt);
  // burning buildings: flames + smoke near the camera
  S.fireT -= dt;
  if (S.fireT <= 0) {
    S.fireT = 0.12;
    const cam = g.rts.target;
    for (const [id, bs] of S.b) {
      if (bs.burning <= 0) continue;
      const b = g.buildings.list.get(id);
      if (!b || Math.abs(b.x - cam.x) > 1600 || Math.abs(b.z - cam.z) > 1600) continue;
      const h = Math.max(4, b.model.height * 0.6);
      g.particles.emit('fire', b.x + (Math.random() - 0.5) * b.hw, b.y + h * Math.random(), b.z + (Math.random() - 0.5) * b.hd, { count: 3, spread: b.hw * 0.5 });
      g.particles.emit('smoke', b.x, b.y + h + 2, b.z, { count: 2, spread: b.hw * 0.4, size: 2 });
    }
  }
  S.iconT -= dt;
  if (S.iconT <= 0) { S.iconT = 0.6; refreshIcons(g); }
  if (S.view) {
    S.overlayT -= dt;
    if (S.overlayT <= 0) { S.overlayT = 1.2; paintView(g, S.view); }
  }
}

/** the problem a building's icon shows when it has several, worst first */
const PROBLEM_ORDER: Problem[] = ['fire', 'abandoned', 'power', 'water', 'sewage', 'garbage', 'sick', 'crime'];

/**
 * A building's worst problem, or, in an info view (`only`), its worst of that
 * view's problems: a home with no power and trash piling up still shows in
 * the Garbage view.
 */
function problemOf(b: Bld, only?: Problem[]): Problem | null {
  // landmarks, services and depots: the one problem they show is a missing road link
  if (b.zone === 'landmark' || b.zone === 'service') return b.offNet && (!only || only.includes('road')) ? 'road' : null;
  if (!isZoned(b) || b.state !== 'active') return null;
  const bs = S.b.get(b.id);
  if (!bs) return null;
  const has = (p: Problem) => {
    switch (p) {
      case 'fire': return bs.burning > 0;
      case 'abandoned': return b.abandoned !== undefined;
      case 'power': return !bs.pw;
      case 'water': return !bs.wa;
      case 'sewage': return !bs.se;
      case 'garbage': return trashDaysOf(b, bs) > TRASH_ICON;
      case 'sick': return bs.sick > 0.15;
      case 'crime': return bs.crime > 55;
      default: return false;
    }
  };
  for (const p of only ?? PROBLEM_ORDER) if (has(p)) return p;
  return null;
}

/** What a building's problem icon means, and what fixes it (hovering the icon shows this). */
export function problemText(g: Game, id: number): string | null {
  const b = g.buildings.list.get(id) as ZB | undefined;
  if (!b) return null;
  const bs = S.b.get(b.id);
  const p = problemOf(b, S.view ? VIEW_PROBLEMS[S.view] : undefined);
  if (p === 'road') return `🚧 ${roadLinkText(g, b)}`;
  if (!p || !bs) return null;
  const days = Math.round(trashDaysOf(b, bs)), via = bs.via >= 0 ? g.buildings.list.get(bs.via) : undefined;
  const trash: Record<TrashWhy, string> = {
    full: `${via?.label ?? 'its landfill'} is full, so its trucks stopped. Build another landfill or an incinerator within reach (Services → Garbage).`,
    reach: 'no garbage truck reaches it, and the county contract is full. Build a landfill within reach (Services → Garbage).',
    capacity: `the trucks that reach it (${via?.label ?? 'a landfill'}) are at their daily limit. Add a landfill or an incinerator (Services → Garbage).`,
    clearing: 'the trucks are collecting it again: the backlog is clearing.',
    queued: 'waiting its turn on the trucks: the backlog is clearing.',
  };
  // the building that fixes it, if the town hasn't unlocked it yet: say when it will
  const FIX: Partial<Record<Problem, string>> = { crime: 'sheriff', sick: 'clinic', education: 'school', garbage: 'landfill', fire: 'fireStation' };
  const fixDef = FIX[p] ? SERVICE_DEFS.get(FIX[p]!) : undefined;
  const notYet = fixDef && !svcUnlocked(g, fixDef) ? ` (${fixDef.name} unlocks at ${unlockAt(fixDef.unlock)}; until then it's a cost of growing)` : '';
  const why: Record<Problem, string> = {
    fire: 'On fire! A fire station within reach puts it out; without one it can spread (Services → Fire).',
    abandoned: `Abandoned: its people moved out. It comes down in ${Math.max(0, DEMOLISH_DAYS - (b.abandoned ?? 0))} days unless its utilities and services come back; or bulldoze it.`,
    power: 'No electricity: its roads reach no power plant and no highway to import from. Build a plant or connect its roads (Services → Power).',
    water: 'No running water: its roads reach no pump and no highway to import from. Build one or connect its roads (Services → Water).',
    sewage: 'No sewage: its roads reach no outfall and no highway to export to. Build one or connect its roads (Services → Sewage).',
    garbage: `Trash piling up for ${days} days: ${trash[bs.trash]}`,
    sick: `Sick residents (${Math.round(bs.sick * 100)}%): no clinic within reach. Sick people move out (Services → Health).`,
    crime: 'High crime: no sheriff within reach. Crime drives people and shops away (Services → Police).',
    education: 'Needs a school within reach to grow (Services → Education).',
    pollution: 'Polluted: too close to industry or a dirty plant.',
    road: 'Not connected to the road network.',
  };
  return `${b.label}: ${why[p]}${notYet}`;
}

/** an info view shows only its own service's bubbles (the playtest: a crisis buried the map in icons) */
const VIEW_PROBLEMS: Partial<Record<ViewId, Problem[]>> = { power: ['power'], water: ['water'], sewage: ['sewage'], garbage: ['garbage'], fire: ['fire'], police: ['crime'], health: ['sick'] };
/** zoomed out past this, a neighbourhood's bubbles merge into one with a count */
const CLUSTER_FROM = 600;
/** which problem a merged bubble shows when two are equally common */
const SEVERITY: Problem[] = ['fire', 'road', 'power', 'water', 'sewage', 'garbage', 'sick', 'abandoned', 'crime', 'education', 'pollution'];
const PROBLEM_WORDS: Record<Problem, string> = {
  power: 'without power', water: 'without water', sewage: 'without sewage', garbage: 'piling up trash', fire: 'on fire',
  crime: 'with high crime', sick: 'with sick residents', abandoned: 'abandoned', education: 'needing a school', pollution: 'polluted',
  road: 'not connected to the road network',
};

function refreshIcons(g: Game) {
  updateLinks(g);
  const cam = g.rts.target, dist = g.rts.distance, merge = dist > CLUSTER_FROM;
  const only = S.view ? VIEW_PROBLEMS[S.view] : undefined;
  const raw: ProblemItem[] = [];
  for (const b of g.buildings.near(cam.x, cam.z, merge ? Math.min(4000, Math.max(1500, dist * 1.3)) : 1500)) {
    const p = problemOf(b, only);
    if (!p) continue;
    raw.push({ x: b.x, y: b.y + b.model.height + 5, z: b.z, p, id: b.id });
    if (!merge && raw.length >= 600) break;
  }
  S.icons!.set(merge ? clusterIcons(raw, Math.min(360, Math.max(90, dist * 0.16))) : raw);
}

/** a merged bubble's problem: the commonest, the most severe on a tie */
const dominant = (mix: Partial<Record<Problem, number>>) => (Object.keys(mix) as Problem[]).sort((a, b) => mix[b]! - mix[a]! || SEVERITY.indexOf(a) - SEVERITY.indexOf(b))[0];

/**
 * One bubble per grid cell of `cell` m holding three or more: its commonest
 * problem, and a count. Then bubbles closer than half a cell (either side of a
 * cell edge) merge too, so none sit on top of each other.
 */
function clusterIcons(raw: ProblemItem[], cell: number): ProblemItem[] {
  const cells = new Map<string, ProblemItem[]>();
  for (const it of raw) {
    const k = `${Math.floor(it.x / cell)},${Math.floor(it.z / cell)}`;
    const arr = cells.get(k);
    if (arr) arr.push(it); else cells.set(k, [it]);
  }
  const out: ProblemItem[] = [];
  let id = -1;
  for (const arr of cells.values()) {
    if (arr.length < 3) { out.push(...arr); continue; }
    const mix: Partial<Record<Problem, number>> = {};
    let x = 0, z = 0, y = 0;
    for (const it of arr) { mix[it.p] = (mix[it.p] ?? 0) + 1; x += it.x; z += it.z; y = Math.max(y, it.y); }
    out.push({ x: x / arr.length, y: y + 6, z: z / arr.length, p: dominant(mix), id: id--, n: arr.length, mix });
  }
  out.sort((a, b) => (b.n ?? 1) - (a.n ?? 1));
  const merged: ProblemItem[] = [];
  for (const it of out) {
    const m = merged.find((o) => Math.hypot(o.x - it.x, o.z - it.z) < cell * 0.5);
    if (!m) { merged.push(it); continue; }
    const na = m.n ?? 1, nb = it.n ?? 1, n = na + nb;
    const mix: Partial<Record<Problem, number>> = { ...(m.mix ?? { [m.p]: 1 }) };
    for (const [p, c] of Object.entries(it.mix ?? { [it.p]: 1 }) as [Problem, number][]) mix[p] = (mix[p] ?? 0) + c;
    Object.assign(m, { x: (m.x * na + it.x * nb) / n, z: (m.z * na + it.z * nb) / n, y: Math.max(m.y, it.y), n, mix, p: dominant(mix), id: m.id < 0 ? m.id : id-- });
  }
  return merged;
}

/** What a merged bubble stands for (hovering it says this). */
function clusterText(it: ProblemItem): string {
  const parts = (Object.entries(it.mix ?? {}) as [Problem, number][]).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${n} ${PROBLEM_WORDS[p]}`);
  return `${it.n} buildings with problems here: ${parts.join(', ')}. Zoom in to see each one.`;
}

// ---------------------------------------------------------------- info views
type ViewId = 'power' | 'water' | 'sewage' | 'garbage' | 'fire' | 'police' | 'health' | 'education' | 'pollution' | 'noise';
const VIEW_COV: Partial<Record<ViewId, Cov[]>> = { fire: ['fire'], police: ['police'], health: ['health'], education: ['school', 'college'], garbage: ['garbage'] };
const OV_N = 192;

function overlayTex(): THREE.DataTexture {
  if (!S.overlayTex) {
    S.overlayTex = new THREE.DataTexture(new Uint8Array(OV_N * OV_N * 4), OV_N, OV_N);
    S.overlayTex.magFilter = THREE.LinearFilter;
    S.overlayTex.minFilter = THREE.LinearFilter;
    S.overlayTex.colorSpace = THREE.SRGBColorSpace;
  }
  return S.overlayTex;
}

/** red -> amber -> green, 0..255 */
function ramp(q: number, out: [number, number, number]) {
  const t = Math.max(0, Math.min(1, q));
  if (t < 0.5) { out[0] = 225; out[1] = Math.round(50 + 330 * t); out[2] = 40; }
  else { out[0] = Math.round(225 - 350 * (t - 0.5)); out[1] = 215; out[2] = Math.round(40 + 60 * (t - 0.5)); }
  return out;
}

function paintView(g: Game, v: ViewId) {
  const tex = overlayTex();
  const D = tex.image.data as Uint8Array;
  D.fill(0);
  const cell = WORLD / OV_N;
  const put = (x: number, z: number, r: number, gg: number, b: number, a: number, rad = 1) => {
    const ci = Math.floor((x + HALF) / cell), cj = Math.floor((z + HALF) / cell);
    for (let dj = -rad; dj <= rad; dj++)
      for (let di = -rad; di <= rad; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= OV_N || j >= OV_N) continue;
        const k = (j * OV_N + i) * 4;
        const aa = Math.round(a * (di || dj ? 0.7 : 1));
        if (aa <= D[k + 3]) continue;
        D[k] = r; D[k + 1] = gg; D[k + 2] = b; D[k + 3] = aa;
      }
  };
  const col: [number, number, number] = [0, 0, 0];
  const covs = VIEW_COV[v];
  if (covs) {
    // coverage painted along the roads, by drive time from the facilities
    const fac = new Map(facilities(g).map((f) => [f.id, f]));
    for (const s of g.net.segs.values()) {
      const pts = s.samp.pts;
      const tt = segTime(s);
      for (let i = 0; i < pts.length; i += 2) {
        const f = i / Math.max(1, pts.length - 1);
        let best = 0;
        for (const c of covs) {
          const m = S.covT[c];
          const A = m?.get(s.a), B = m?.get(s.b);
          for (const e of [A && { t: A.t + tt * f, o: A.o }, B && { t: B.t + tt * (1 - f), o: B.o }]) {
            if (!e) continue;
            const fd = fac.get(e.o);
            if (!fd) continue;
            const q = Math.max(0, 1 - Math.pow(e.t / (fd.def.reach ?? 1), 2)) * fsOf(fd).quality;
            if (q > best) best = q;
          }
        }
        if (best > 0.02) { ramp(best, col); put(pts[i].x, pts[i].z, col[0], col[1], col[2], 215, 2); }
        else put(pts[i].x, pts[i].z, 170, 40, 40, 110, 1);
      }
    }
  } else if (v === 'power' || v === 'water' || v === 'sewage') {
    // roads colored by network state: supplied / short / no source
    const src = new Set<number>();
    for (const f of facilities(g)) if ((f.def[v] ?? 0) > 0) { const s = segOf(g, f); if (s) src.add(S.comp.get(s.a) ?? -1); }
    const short = S.util[v].unserved > 0;
    for (const s of g.net.segs.values()) {
      const c = S.comp.get(s.a) ?? -1;
      const has = src.has(c) || S.compEdge.has(c);
      const [r, gg, b] = !has ? [120, 120, 130] : short ? [240, 160, 40] : v === 'power' ? [250, 225, 60] : v === 'water' ? [60, 170, 250] : [170, 120, 60];
      const pts = s.samp.pts;
      for (let i = 0; i < pts.length; i += 2) put(pts[i].x, pts[i].z, r, gg, b, has ? 200 : 110, 1);
    }
  } else {
    const F = v === 'pollution' ? S.fields.pol : S.fields.noise;
    const scale = v === 'pollution' ? 2.5 : 1.6;
    for (let j = 0; j < OV_N; j++)
      for (let i = 0; i < OV_N; i++) {
        const q = Math.min(1, S.fields.sample(F, -HALF + (i + 0.5) * cell, -HALF + (j + 0.5) * cell) / scale);
        if (q < 0.03) continue;
        const k = (j * OV_N + i) * 4;
        if (v === 'pollution') { D[k] = Math.round(150 + 90 * q); D[k + 1] = Math.round(140 - 70 * q); D[k + 2] = Math.round(40 + 20 * q); }
        else { D[k] = Math.round(170 + 80 * q); D[k + 1] = Math.round(80 - 40 * q); D[k + 2] = Math.round(220 - 60 * q); }
        D[k + 3] = Math.round(60 + 190 * Math.sqrt(q));
      }
  }
  tex.needsUpdate = true;
  INFO_OVERLAY.tex.value = tex;
  // buildings
  const c = new THREE.Color();
  const good = new THREE.Color(0x4fd05a), bad = new THREE.Color(0xe0302a), mid = new THREE.Color(0xf2b01e), svc = new THREE.Color(0x6ad0ff);
  const cat: SvcCat | null = v === 'pollution' || v === 'noise' ? null : (v as SvcCat);
  g.overlays.tintBuildings((b) => {
    if (b.zone === 'service') return defOf(b)?.cat === cat ? svc : c.setRGB(0.55, 0.55, 0.58);
    if (!isZoned(b)) return c.setRGB(0.55, 0.55, 0.58);
    const bs = S.b.get(b.id);
    if (!bs || b.state !== 'active') return c.setRGB(0.7, 0.7, 0.72);
    const q3 = (q: number) => (q < 0.5 ? c.copy(bad).lerp(mid, Math.max(0, q) * 2) : c.copy(mid).lerp(good, Math.min(1, (q - 0.5) * 2)));
    switch (v) {
      case 'power': return bs.pw ? good : bad;
      case 'water': return !bs.wa ? bad : bs.dirty ? mid : good;
      case 'sewage': return bs.se ? good : bad;
      case 'garbage': return q3(1 - Math.min(1, trashDaysOf(b, bs) / TRASH_BAD));
      case 'fire': return bs.burning > 0 ? bad : q3(bs.cov.fire);
      case 'police': return q3(1 - bs.crime / 80);
      case 'health': return q3(1 - bs.sick / 0.3);
      case 'education': return q3(bs.edu);
      case 'pollution': return q3(1 - Math.min(1, S.fields.sample(S.fields.pol, b.x, b.z) / 2.5));
      case 'noise': return q3(1 - Math.min(1, S.fields.sample(S.fields.noise, b.x, b.z) / 1.6));
    }
    return null;
  });
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmt = (n: number, u: Util) => (u === 'power' ? `${n.toFixed(n < 10 ? 1 : 0)} ${UNIT[u]}` : `${Math.round(n).toLocaleString()} ${UNIT[u]}`);
function avgCov(covs: Cov[]): number {
  let s = 0, n = 0;
  for (const bs of S.b.values()) { let m = 0; for (const c of covs) m = Math.max(m, bs.cov[c]); s += m; n++; }
  return n ? s / n : 0;
}

function legendFor(v: ViewId): string {
  const bar = (a: string, b: string, c: string, l0: string, l1: string) => `<div class="lg-bar" style="background:linear-gradient(90deg,${a},${b},${c})"></div><div class="lg-ends"><span>${l0}</span><span>${l1}</span></div>`;
  const dot = (c: string, t: string) => `<span class="lg-dot" style="background:${c}"></span>${t} `;
  if (v === 'power' || v === 'water' || v === 'sewage') {
    const st = S.util[v];
    return `<b>${fmt(st.served, v)}</b> used · <b>${fmt(st.supply, v)}</b> built · import cap ${fmt(IMPORT_CAP[v], v)}<br>
      Importing <b>${fmt(st.imported, v)}</b> ($${Math.round(st.imported * IMPORT_PRICE[v] * 7)}/wk) · <b class="${st.unserved ? 'neg' : ''}">${st.unserved}</b> buildings cut off<br>
      ${dot('#4fd05a', 'served')}${dot('#e0302a', 'cut off')}${v === 'water' ? dot('#f2b01e', 'contaminated') : ''}${dot('#787882', 'no source on this road network')}
      <small>Utilities flow along roads. A shortage cuts off the buildings farthest from a source first.</small>`;
  }
  if (v === 'pollution') return `${bar('#8c8c28', '#c07030', '#f04020', 'clean', 'toxic')}<small>Industry, plants, landfills and outfalls emit. It drifts downwind and fades slowly. Lowers land value and makes people sick.</small>`;
  if (v === 'noise') return `${bar('#6040a0', '#c050c0', '#ff5070', 'quiet', 'loud')}<small>Busy roads, industry and big commercial. Lowers residential land value.</small>`;
  let extra = '';
  if (v === 'garbage') {
    const G = S.garbage;
    extra = `Making <b>${G.made.toFixed(1)} t/day</b> · collecting <b>${G.collected.toFixed(1)} t/day</b> · county contractor hauls <b>${G.exported.toFixed(1)}</b> (cap ${TRASH_EXPORT} t/day, $${TRASH_PRICE}/t)<br>Landfill <b>${Math.round(G.stored).toLocaleString()} / ${Math.round(G.capacity).toLocaleString()} t</b> · ${S.counts.trash} buildings with trash piling up<br>`;
  } else if (v === 'fire') extra = `${S.counts.fires} fires so far · ${S.counts.burned} burned down<br>`;
  else if (v === 'police') extra = `${S.counts.crime} high-crime buildings<br>`;
  else if (v === 'health') extra = `${S.counts.sick} buildings with many sick residents<br>`;
  else if (v === 'education') {
    let e = 0;
    for (const bs of S.b.values()) e += bs.edu;
    extra = `Average education <b>${pct(S.b.size ? e / S.b.size : 0)}</b> (35% unlocks level 3 homes, 70% level 5)<br>`;
  }
  return `${extra}Coverage <b>${pct(avgCov(VIEW_COV[v]!))}</b> of buildings${bar('#e13228', '#f2c81e', '#4fd05a', 'out of reach', 'fast response')}<small>Coverage = drive time on the road network × facility capacity. Overloaded facilities help everyone a little less.</small>`;
}

const VIEWS: { id: ViewId; icon: string; label: string }[] = [
  { id: 'power', icon: '⚡', label: 'Power' },
  { id: 'water', icon: '🚰', label: 'Water' },
  { id: 'sewage', icon: '🚽', label: 'Sewage' },
  { id: 'garbage', icon: '🗑️', label: 'Garbage' },
  { id: 'fire', icon: '🚒', label: 'Fire' },
  { id: 'police', icon: '🚓', label: 'Crime' },
  { id: 'health', icon: '🏥', label: 'Health' },
  { id: 'education', icon: '🎓', label: 'Education' },
  { id: 'pollution', icon: '🏭', label: 'Pollution' },
  { id: 'noise', icon: '🔊', label: 'Noise' },
];
const viewObjs = new Map<ViewId, ExtView>();
for (const v of VIEWS) {
  const ev: ExtView = {
    id: `svc:${v.id}`,
    icon: v.icon,
    label: v.label,
    enable: (g) => { S.view = v.id; if (S.graphDirty) rebuildGraph(g); paintView(g, v.id); INFO_OVERLAY.on.value = 1; },
    disable: (g) => { if (S.view === v.id) { S.view = null; INFO_OVERLAY.on.value = 0; } g.overlays.resetBuildingColors(); },
    legend: () => `<div class="svc-legend">${legendFor(v.id)}</div>`,
  };
  viewObjs.set(v.id, ev);
  registerView(ev);
}
const VIEW_FOR_CAT: Partial<Record<SvcCat, ViewId>> = { power: 'power', water: 'water', sewage: 'sewage', garbage: 'garbage', fire: 'fire', police: 'police', health: 'health', education: 'education' };

// ============================================================== placement tool
let placing: SvcId = 'gasPeaker';
let ghost: PlacementGhost | null = null;
let lastCheck: { ok: boolean; reason?: string; snapped?: boolean; road?: string; linked?: boolean; run?: { perWk: number; how: string } | null } | null = null;
let panelCat: SvcCat = 'power';


export function canPlaceService(g: Game, id: SvcId, x: number, z: number, yawIn?: number): { ok: boolean; reason?: string; yaw: number; blocker?: Bld } {
  const d = SERVICE_DEFS.get(id)!;
  const hw = (d.w * CELL) / 2, hd = (d.d * CELL) / 2;
  const pick = g.net.pickSeg(x, z, Math.max(hw, hd) + 40);
  let yaw = yawIn ?? 0;
  if (pick && yawIn === undefined) {
    const pts = pick.seg.samp.pts;
    const p = pts[Math.min(pts.length - 1, Math.round((pick.s / pick.seg.length) * (pts.length - 1)))];
    yaw = Math.atan2(p.x - x, p.z - z);
  }
  if (!svcUnlocked(g, d)) return { ok: false, yaw, reason: `Unlocks at ${unlockAt(d.unlock)}, and stays unlocked` };
  if (!g.terrain.inBounds(x, z, Math.max(hw, hd) + 12)) return { ok: false, yaw, reason: 'Outside the county' };
  if (g.net.allowed && !g.net.allowed(x, z)) return { ok: false, yaw, reason: "You don't own this land yet. Buy it in 🏞️ Land." };
  if (!pick) return { ok: false, yaw, reason: d.nearWater ? 'Needs a road within 40 m: run one down to the shore first' : 'Needs a road within 40 m' };
  const cs = rectCorners(x, z, hw, hd, yaw);
  let lo = Infinity, hi = -Infinity;
  for (const p of [...cs, { x, z }]) { const h = g.terrain.h(p.x, p.z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  // shore plants may hang a corner over the bank (the pad gets filled in)
  if (d.nearWater ? g.terrain.h(x, z) < WATER + 0.35 : lo < WATER + 0.6) return { ok: false, yaw, reason: 'Not in the water' };
  if (hi - Math.max(lo, WATER) > Math.max(d.nearWater ? 11 : 7, Math.max(hw, hd) * (d.nearWater ? 0.6 : 0.35))) return { ok: false, yaw, reason: 'Too steep here' };
  const r = hw + hd + 14;
  for (const s of g.net.segsNear(x - r, z - r, x + r, z + r)) {
    const half = ROAD_TYPES[s.type].width / 2;
    for (const p of s.samp.pts) if (inRect(p.x, p.z, x, z, hw, hd, yaw, half)) return { ok: false, yaw, reason: 'Overlaps a road' };
  }
  for (const b of g.buildings.near(x, z, hw + hd + 40)) {
    if (cs.some((p) => g.buildings.contains(b, p.x, p.z, 0.5)) || g.buildings.corners(b).some((p) => inRect(p.x, p.z, x, z, hw, hd, yaw)) || g.buildings.contains(b, x, z))
      return { ok: false, yaw, reason: `Overlaps ${b.label}`, blocker: b };
  }
  if (g.communes.at(x, z)) return { ok: false, yaw, reason: 'Hippies live here' };
  if (d.nearWater) {
    let wet = false;
    const R = Math.max(hw, hd);
    for (let a = 0; a < 16 && !wet; a++)
      for (const rr of [R + 4, R + 14, R + 26, R + 40]) {
        const ang = (a / 16) * Math.PI * 2;
        if (g.terrain.h(x + Math.cos(ang) * rr, z + Math.sin(ang) * rr) < WATER - 0.3) { wet = true; break; }
      }
    if (!wet) return { ok: false, yaw, reason: 'Must be on a river or lake shore (within 40 m of water)' };
  }
  const broke = g.sim.cantAfford(d.cost);
  if (broke) return { ok: false, yaw, reason: broke };
  return { ok: true, yaw };
}

/** Problems moving the building a bit can fix (not money, unlocks or land). */
const snappable = (reason?: string) => !!reason && !/money|Needs \$|Unlocks|own this land|county/i.test(reason);

export interface ServiceSpot { x: number; z: number; yaw: number; snapped: boolean; reason?: string; front?: Frontage; blocker?: Bld }

/**
 * Where the building goes for a cursor at (x, z): square to the nearest road,
 * its front a short apron back from the curb and facing the street, sliding
 * along that road to the nearest spot that works. Shore plants that can't
 * reach the water from the street may sit back on the bank, facing the road.
 * The ghost, the click and the final building all use this transform.
 */
export function findServiceSpot(g: Game, id: SvcId, x: number, z: number): ServiceSpot {
  const d = SERVICE_DEFS.get(id)!;
  const hd = (d.d * CELL) / 2;
  const here = canPlaceService(g, id, x, z);
  if (!here.ok && !snappable(here.reason)) return { x, z, yaw: here.yaw, snapped: false, reason: here.reason };
  // pointing straight at a building means "that one", not "somewhere near it":
  // no snapping, so a double-click doesn't buy a second office next door
  const on = g.buildings.at(x, z);
  if (on) return { x, z, yaw: here.yaw, snapped: false, reason: `${on.label} is already here`, blocker: on };
  const hw = (d.w * CELL) / 2;
  let first: string | undefined;
  let blocker: Bld | undefined;
  let k = 0;
  for (const f of frontageCandidates(g.net, x, z, hd, hd + 40)) {
    // the spot facing the cursor already holds a special building: that one,
    // not "slide along and build another" (four quick clicks bought four)
    if (k === 0) { const on = specialAt(g.buildings, f, hw, hd); if (on) return { x: f.x, z: f.z, yaw: f.yaw, snapped: false, reason: `${on.label} is already here`, front: f, blocker: on }; }
    const c = canPlaceService(g, id, f.x, f.z, f.yaw);
    if (c.ok) return { x: f.x, z: f.z, yaw: f.yaw, snapped: k > 0, front: f };
    if (first === undefined) { first = c.reason; blocker = c.blocker; }
    k++;
  }
  if (d.nearWater) {
    if (here.ok) return { x, z, yaw: here.yaw, snapped: false };
    for (let r = 8; r <= 110; r += 8) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 14));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const c = canPlaceService(g, id, px, pz);
        if (c.ok) return { x: px, z: pz, yaw: c.yaw, snapped: true };
      }
    }
  }
  return { x, z, yaw: here.yaw, snapped: false, reason: first ?? here.reason ?? 'Needs a road within 40 m', blocker: first !== undefined ? blocker : here.blocker };
}

let spotCache: { id: string; x: number; z: number; r: ServiceSpot } | null = null;
function spotFor(g: Game, id: SvcId, x: number, z: number) {
  if (spotCache && spotCache.id === id && Math.hypot(spotCache.x - x, spotCache.z - z) < 3) return spotCache.r;
  const r = findServiceSpot(g, id, x, z);
  spotCache = { id, x, z, r };
  return r;
}

function ensureGhost(g: Game) {
  return (ghost ??= new PlacementGhost(g.scene, 'svc-ghost'));
}

function updateGhost(g: Game, p: THREE.Vector3 | null) {
  const gh = ensureGhost(g);
  if (!p) { gh.hide(); lastCheck = null; return; }
  const d = SERVICE_DEFS.get(placing)!;
  const spot = spotFor(g, placing, p.x, p.z);
  const ok = !spot.reason;
  lastCheck = { ok, reason: spot.reason, snapped: spot.snapped, road: spot.front?.seg.name, linked: !spot.front || segLinked(g, spot.front.seg), run: ok ? estimateRun(g, d, spot.x, spot.z) : null };
  const hw = (d.w * CELL) / 2, hd = (d.d * CELL) / 2;
  const y = g.buildings.padHeight(spot.x, spot.z, hw, hd, spot.yaw);
  gh.show(`svc|${placing}|${vaultLook(placing) ? 'vault' : 'classic'}`, () => CUSTOM_BUILDINGS.get(placing)!.model().geometry, spot.x, y, spot.z, spot.yaw, hw, hd, ok, spot.front?.door ?? null);
  // what's in the way, outlined where it stands (hard to pick out at a distance or at night)
  gh.showBlocker(!ok && spot.blocker ? spot.blocker : null);
}

/** Place a service building (the tool, tests and future AI all use this). */
export function placeService(g: Game, id: SvcId, x: number, z: number, yaw?: number): Bld | null {
  spotCache = null;
  const d = SERVICE_DEFS.get(id)!;
  const chk = canPlaceService(g, id, x, z, yaw);
  if (!chk.ok) { g.toast(chk.reason ?? 'Nope', true); g.audio.play('error'); return null; }
  g.trees.recordCuts();
  const b = g.buildings.placeCustom(d.id, x, z, chk.yaw);
  const trees = g.trees.takeCuts();
  if (!b) return null;
  g.sim.spend(d.cost, d.name, 'construction');
  g.pushUndo({ kind: 'place', bldId: b.id, refund: d.cost, label: d.name, trees });
  crumb(`placed ${d.name}`);
  S.graphDirty = true;
  g.audio.play('build');
  g.particles.emit('dust', b.x, b.y + 2, b.z, { count: 40, spread: b.hw });
  g.floatText(`✅ ${d.name}`, new THREE.Vector3(b.x, b.y + d.height, b.z), '#9dff3c');
  post(g, 'serviceBuilt', { building: d.name }, 0.6);
  if (linkProblem(g, b)) g.toast(`🚧 ${d.name} is built, but its road doesn't join the rest of your roads (no route to the highway): it only serves the buildings on that road. Connect it to your streets (🛣️ Roads).`, true);
  return b;
}

// touch: a tap previews the building there; the action-bar Build places it
let planned: THREE.Vector3 | null = null;
/**
 * The building the last click bought. Until the pointer leaves it, the tip
 * confirms the purchase and a second click on it does nothing (the playtest
 * saw a red "already here" right after a good build, from the tool re-checking
 * the spot it had just filled).
 */
let built: { id: number; t: number; x: number; z: number } | null = null;
/** still on what was just built: over it, or hardly moved from the click (it may have slid along the road) */
const onBuilt = (g: Game, p: THREE.Vector3 | null) => {
  const b = built && g.buildings.list.get(built.id);
  if (!b || !p || !built) return false;
  return g.buildings.contains(b, p.x, p.z, 6) || Math.hypot(p.x - built.x, p.z - built.z) < Math.max(10, g.rts.distance * 0.03);
};

registerTool({
  id: 'svcPlace',
  touchLift: 64,
  placing: () => { const d = SERVICE_DEFS.get(placing); return d ? `${d.icon} ${d.name}` : null; },
  move: (g, p) => {
    if (planned) return;
    if (built && onBuilt(g, p)) { ghost?.hide(); lastCheck = null; return; }
    built = null;
    updateGhost(g, p);
  },
  up: (g, p, e, wasDrag) => {
    if (!p || wasDrag) return;
    if (e.pointerType !== 'mouse') {
      built = null;
      planned = p.clone();
      updateGhost(g, planned);
      return;
    }
    // a second click on what was just built is a double-click, not another purchase
    if (built && onBuilt(g, p)) return;
    built = null;
    const spot = spotFor(g, placing, p.x, p.z);
    const b = placeService(g, placing, spot.x, spot.z, spot.yaw);
    if (b) { spotCache = null; built = { id: b.id, t: g.time, x: p.x, z: p.z }; ghost?.hide(); lastCheck = null; return; }
    updateGhost(g, p);
  },
  pending: () => (planned ? { cost: lastCheck?.ok ? SERVICE_DEFS.get(placing)!.cost : null } : null),
  confirm: (g) => {
    if (!planned) return;
    const spot = spotFor(g, placing, planned.x, planned.z);
    const b = placeService(g, placing, spot.x, spot.z, spot.yaw);
    if (b) { spotCache = null; built = { id: b.id, t: g.time, x: planned.x, z: planned.z }; planned = null; ghost?.hide(); lastCheck = null; }
    else updateGhost(g, planned);
  },
  cancel: () => { planned = null; built = null; ghost?.hide(); lastCheck = null; },
  tip: (g) => {
    const d = SERVICE_DEFS.get(placing)!;
    const b = built && g.buildings.list.get(built.id);
    // just bought: say so (phones for a few seconds, desktop until the pointer moves off it)
    if (built && b && (g.isTouch ? g.time - built.t < 3 : onBuilt(g, g.tools.hoverPoint))) {
      const def = defOf(b) ?? d;
      return { text: `✅ Built ${def.icon} ${def.name}: ${usd(def.cost)} paid, ${usd(def.upkeep)}/wk upkeep${def.run ? ` + ${runText(def)}` : ''}. ${g.isTouch ? 'Tap where the next one goes.' : 'Move off it to place another.'}`, good: true };
    }
    if (lastCheck && !lastCheck.ok) return { text: `${d.name}: ${lastCheck.reason}${snappable(lastCheck.reason) ? ' · green rings: spots where it fits' : ''}`, bad: true };
    if (g.isTouch && !planned) return { text: `${d.icon} ${d.name} · $${d.cost.toLocaleString()} · tap where it goes` };
    // what this purchase does to the budget, from the same forecast the HUD shows:
    // its upkeep, its running cost at today's use, and what's already being built
    const run = lastCheck?.run ?? null, com = committedServices(g);
    const after = g.sim.afterSpend(d.cost, d.upkeep + (run?.perWk ?? 0) + com.perWk);
    const runBit = run ? ` + ≈${usd(run.perWk)}/wk running (${run.how})` : d.run ? ` + ${runText(d)}` : '';
    const comBit = com.n ? ` · ${com.n} being built add ${usd(com.perWk)}/wk when ${com.n === 1 ? 'it opens' : 'they open'}` : '';
    return { text: `${d.icon} ${d.name} · $${d.cost.toLocaleString()} now + $${d.upkeep}/wk${runBit}${comBit} · ${after.text}${lastCheck?.road ? ` · fronts ${esc(lastCheck.road)}${lastCheck.snapped ? ' (slid to the nearest spot that fits)' : ''}` : lastCheck?.snapped ? ' · 📍 moved to the nearest good spot' : ''}${lastCheck?.road && !lastCheck.linked ? ` · 🚧 ${esc(lastCheck.road)} doesn't join the rest of your roads: it would only serve that road` : ''}${planned ? ' · tap Build, or tap elsewhere to move it' : ''}`, bad: after.credit || (!!lastCheck?.road && !lastCheck.linked) };
  },
});

// ============================================================== panel
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
/** the cheapest local building for a category that the city can build now */
function cheapestLocal(g: Game, c: SvcCat, has: (d: SvcDef) => boolean): SvcDef | null {
  return SVC.filter((d) => d.cat === c && has(d) && svcUnlocked(g, d)).sort((a, b) => a.cost - b.cost)[0] ?? null;
}

/**
 * What a category's status means: covered by your own buildings, covered by
 * a paid fallback (imports, the county contract), or actually short; what it
 * costs; and what building the cheapest local option would change.
 */
function statusLine(c: SvcCat, g: Game): string {
  if (c === 'power' || c === 'water' || c === 'sewage') {
    const st = S.util[c], perWk = (units: number) => units * IMPORT_PRICE[c] * 7;
    const short = st.unserved > 0;
    const plural = (n: number) => `${n} building${n === 1 ? '' : 's'}`;
    const causes = [st.noLink && `${plural(st.noLink)} on roads with no plant and no route to the highway, where imports come in`, st.capped && `${plural(st.capped)} past the import limit`, st.noRoad && `${plural(st.noRoad)} not on a road`].filter(Boolean).join('; ');
    const head = short ? `⚠️ <b>${plural(st.unserved)} cut off</b>: ${causes}`
      : st.demand <= 0 ? 'Nobody needs any yet'
      : st.imported > 0.001 ? `✅ Everyone supplied · <b>${pct(st.imported / st.demand)} imported</b>` : '✅ Everyone supplied by your own plants';
    const rows = [`${head}`, `Needed ${fmt(st.demand, c)} · your plants ${fmt(st.supply, c)} · imported ${fmt(st.imported, c)} (<b>${usd(perWk(st.imported))}/wk</b>; the highway sells at most ${fmt(IMPORT_CAP[c], c)})`];
    if (c === 'water') { let dirty = 0; for (const bs of S.b.values()) if (bs.dirty) dirty++; if (dirty) rows.push(`<b class="neg">${dirty} buildings drink sewage-tainted water</b> (a pump within 500 m of an outfall): people get sick`); }
    const d = cheapestLocal(g, c, (x) => !!x[c]);
    if (d && (st.imported > 0.001 || short)) {
      const out = (d[c] ?? 0) * (d.id === 'solarFarm' ? solarFactor(g) : 1);
      const made = Math.min(out, st.imported);
      const save = perWk(made) - d.upkeep - made * (d.run ?? 0) * 7;
      const fix = st.noLink ? `. Build it on the cut-off roads, or connect those roads to the highway` : st.capped ? `: covers what the highway can't sell` : save > 0 ? `: saves about <b class="pos">${usd(save)}/wk</b> on imports` : `: costs about ${usd(-save)}/wk more than importing`;
      rows.push(`<span class="svc-trade">${d.icon} A ${esc(d.name)} (${usd(d.cost)} + ${usd(d.upkeep)}/wk${d.run ? ` + ${runText(d)}` : ''}) makes ${fmt(out, c)}${fix}${d.nearWater ? ' (must touch water)' : ''}.</span>`);
    }
    return `<div class="svc-stat ${short ? 'bad' : ''}">${rows.join('<br>')}</div>`;
  }
  if (c === 'garbage') {
    const G = S.garbage, W = G.why, piling = S.counts.trash;
    const head = piling ? `⚠️ <b>Trash piling up at ${piling} building${piling === 1 ? '' : 's'}</b> (sickness, fire risk, nobody moves in)` : G.made <= 0.01 ? 'No trash yet' : G.exported > 0.01 ? '✅ All trash handled · the county contractor hauls some (paid)' : '✅ All trash handled by your trucks';
    const rows = [head, `Made ${G.made.toFixed(1)} t/day · your trucks ${G.collected.toFixed(1)} · county contract ${G.exported.toFixed(1)} t/day (<b>${usd(G.exported * TRASH_PRICE * 7)}/wk</b>; takes at most ${TRASH_EXPORT} t/day)${G.capacity ? ` · landfill ${Math.round(G.stored).toLocaleString()}/${Math.round(G.capacity).toLocaleString()} t` : ''}`];
    // why the trash is piling up: no room left, no truck in reach, trucks at their limit, or a backlog clearing
    if (G.full.length) rows.push(`<b class="neg">🚫 Trucks idle: ${esc(G.full.length === 1 ? `${G.full[0]} is full` : `${G.full.length} landfills are full`)}.</b> A full landfill takes no more trash, so its trucks stop.`);
    const whyBits = [
      W.full && `<b class="neg">${W.full}</b> served by a full landfill`,
      W.reach && `<b class="neg">${W.reach}</b> out of every truck's reach${G.exported >= TRASH_EXPORT - 0.01 ? ' (county contract maxed)' : ''}: build closer`,
      W.capacity && `<b class="neg">${W.capacity}</b> waiting on trucks at their limit (${G.room.toFixed(0)} t/day for ${G.made.toFixed(0)} made): add capacity`,
      W.clearing + W.queued && `<b>${W.clearing + W.queued}</b> clearing a backlog: trucks are collecting, give it time`,
    ].filter(Boolean);
    if (piling && whyBits.length) rows.push(`Why: ${whyBits.join(' · ')}`);
    if (G.capacity && !G.full.length && G.daysLeft < Infinity) rows.push(`${G.daysLeft < 45 ? '⚠️ ' : ''}Landfills full in <b class="${G.daysLeft < 45 ? 'neg' : ''}">about ${spanOf(G.daysLeft)}</b> at ${G.fill.toFixed(G.fill < 10 ? 1 : 0)} t/day. Then their trucks stop.`);
    const d = cheapestLocal(g, 'garbage', (x) => !!x.collect);
    if (d && (G.exported > 0.01 || piling || G.daysLeft < 45)) rows.push(`<span class="svc-trade">${d.icon} A ${esc(d.name)} (${usd(d.cost)} + ${usd(d.upkeep)}/wk) collects ${d.collect} t/day within ${((d.reach ?? 0) / 60).toFixed(1)} min${d.store ? ` and holds ${d.store.toLocaleString()} t` : ' and never fills'}${G.exported > 0.01 ? `: saves about <b class="pos">${usd(Math.min(d.collect ?? 0, G.exported) * TRASH_PRICE * 7 - d.upkeep)}/wk</b> on the contract` : ''}.</span>`);
    return `<div class="svc-stat ${piling || G.full.length ? 'bad' : ''}">${rows.join('<br>')}</div>`;
  }
  const covs: Record<string, Cov[]> = { fire: ['fire'], police: ['police'], health: ['health'], education: ['school', 'college'], parks: ['parks'] };
  const why: Record<string, string> = {
    fire: 'Buildings out of reach can catch fire, and fires spread.',
    police: 'Crime lowers land value and makes people move out.',
    health: 'Sick residents move out; a clinic in reach treats them.',
    education: 'Schools let homes reach level 3+ and offices grow; college grads unlock the top levels.',
    parks: 'Parks raise land value nearby.',
  };
  const risk = c === 'fire' ? S.counts.fires : c === 'police' ? S.counts.crime : c === 'health' ? S.counts.sick : 0;
  const riskText = risk ? ` · <b class="neg">${risk} building${risk === 1 ? '' : 's'} ${c === 'fire' ? 'on fire' : c === 'police' ? 'with high crime' : 'with sick residents'} now</b>` : '';
  const cov = avgCov(covs[c]);
  const head = S.b.size === 0 ? 'No buildings to cover yet' : cov <= 0.001 ? `No ${CATS.find((x) => x.id === c)?.label.toLowerCase()} coverage yet` : `Covers ${pct(cov)} of buildings`;
  return `<div class="svc-stat ${risk ? 'bad' : ''}">${head}${riskText}<br><span class="svc-trade">${why[c]}</span></div>`;
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!); }

/**
 * Every landfill and incinerator on one board (playtest 5: "a per-landfill
 * dashboard"): how full, what comes in, how long it lasts, whom it serves,
 * what it costs. A row flies to the site.
 */
function garbageBoard(g: Game): string {
  const sites = [...g.buildings.list.values()].filter((b) => defOf(b)?.cat === 'garbage');
  if (!sites.length) return '';
  const run = runningCosts(g);
  const G = S.garbage;
  const rows = sites.map((b) => {
    const d = defOf(b)!, fs = fsOf(b);
    const open = b.state === 'active';
    const cost = d.upkeep + Math.round(run.get(b.id) ?? 0);
    let fill = '', left = '';
    if (!open) left = `opens in ~${Math.max(1, Math.ceil((b.buildDays ?? 6) * (1 - b.progress)))} d`;
    else if (d.store) {
      const pct = Math.min(1, fs.stored / d.store);
      const days = fs.rate > 0.05 ? (d.store - fs.stored) / fs.rate : null;
      fill = `<span class="gb-bar ${pct >= 0.9 ? 'bad' : pct >= 0.75 ? 'warn' : ''}"><i style="width:${Math.round(pct * 100)}%"></i></span>${Math.round(pct * 100)}% of ${d.store.toLocaleString()} t`;
      left = pct >= 1 ? '<b class="neg">full: trucks stopped</b>' : days === null ? 'not filling' : `full in ~${spanOf(days)}`;
    } else {
      fill = `burns up to ${d.collect} t/day`;
      left = 'never fills';
    }
    const load = open ? `${(fs.took ?? 0).toFixed((fs.took ?? 0) < 10 ? 1 : 0)} t/day from ${fs.served ?? 0} building${fs.served === 1 ? '' : 's'}${fs.behind ? ' · <b class="neg">trucks at their limit</b>' : ''}` : '—';
    return `<button class="gb-row" data-goto="${b.id}" title="Show ${esc(b.label)} on the map"><span class="gb-name">${d.icon} ${esc(b.label)}</span><span class="gb-fill">${fill}</span><span class="gb-in">${load}</span><span class="gb-left">${left}</span><span class="gb-cost">$${cost.toLocaleString()}/wk</span></button>`;
  });
  const total = G ? `<div class="gb-total">Town makes ${G.made.toFixed(G.made < 10 ? 1 : 0)} t/day · trucks collect ${G.collected.toFixed(G.collected < 10 ? 1 : 0)}${G.exported > 0.05 ? ` · the county hauls ${G.exported.toFixed(1)} (pricey)` : ''}${Number.isFinite(G.daysLeft) ? ` · all landfills full in ~${spanOf(G.daysLeft)}` : ''}</div>` : '';
  return `<div class="gb"><div class="gb-head">Your garbage sites</div>${rows.join('')}${total}</div>`;
}

registerPanel({
  id: 'services',
  icon: '🏛️',
  label: 'Services',
  order: 35,
  render(el, g, rerender) {
    const pop = g.sim.population;
    const list = SVC.filter((d) => d.cat === panelCat && (!isAttraction(d.id) || vaultReady()));
    const sel = SERVICE_DEFS.get(placing);
    el.innerHTML = `
      <div class="sp-title">City Services <small>Power, water and sewage flow along roads. Services reach buildings by drive time.</small></div>
      <div class="sp-row svc-cats">${CATS.map((c) => `<button class="chip ${c.id === panelCat ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>`).join('')}</div>
      <div class="svc-live">${statusLine(panelCat, g)}</div>
      <div class="svc-board">${panelCat === 'garbage' ? garbageBoard(g) : ''}</div>
      <div class="sp-grid">${list.map((d) => {
        const locked = !svcUnlocked(g, d);
        const on = g.tools.active === 'ext' && g.tools.extTool === 'svcPlace' && placing === d.id;
        // what it does, in numbers: output for plants, reach for everything else
        const does = d.power ? fmt(d.power, 'power') : d.water ? fmt(d.water, 'water') : d.sewage ? fmt(d.sewage, 'sewage') : d.collect ? `${d.collect} t/day` : d.reach ? `${(d.reach / 60).toFixed(1)} min reach` : '';
        // the unlock rule, said where it matters: earned once, kept for good
        const rule = !d.unlock || g.sim.mode === 'sandbox' ? '' : locked ? ` Unlocks at ${unlockAt(d.unlock)}, and stays unlocked even if the city shrinks.` : pop < d.unlock ? ` Earned at ${unlockAt(d.unlock)}: yours to keep while the city is smaller.` : '';
        return `<button class="card ${on ? 'on' : ''}" data-svc="${d.id}" ${locked ? 'disabled' : ''} title="${esc(d.blurb + rule)}${d.run ? ` Costs $${d.upkeep}/wk plus ${esc(runText(d))}.` : ''}"><span class="ci">${d.icon}</span><b>${esc(d.name)}</b><small>${locked ? lockText(d.unlock) : `$${d.cost.toLocaleString()} · $${d.upkeep}/wk${d.run ? '+' : ''}${does ? ` · ${does}` : ''}`}</small></button>`;
      }).join('')}</div>
      <div class="svc-blurb">${esc(sel && sel.cat === panelCat ? sel.blurb : list[0]?.blurb ?? '')}</div>
      ${vaultReady() ? `<div class="sp-row svc-look">Looks: <button class="chip ${svcLook() === 'vault' ? 'on' : ''}" data-look="vault" title="The Asset Vault's versions: the Very Clean Coal Plant, the County Water Tower, Copay Castle...">🏛️ Asset Vault</button><button class="chip ${svcLook() === 'classic' ? 'on' : ''}" data-look="classic">Classic</button></div>` : ''}`;
    el.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      // one active tool: switching category puts the other category's
      // building away (ghost, warning and click handler together)
      if (panelCat !== b.dataset.cat && g.tools.active === 'ext' && g.tools.extTool === 'svcPlace') g.tools.set('inspect');
      panelCat = b.dataset.cat as SvcCat;
      const v = VIEW_FOR_CAT[panelCat];
      g.overlays.setExt(v ? viewObjs.get(v)! : null);
      rerender();
    }));
    el.querySelector('.svc-board')?.addEventListener('click', (e) => {
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-goto]')?.dataset.goto);
      const b = g.buildings.list.get(id);
      if (!b) return;
      g.rts.setView(b.x, b.z, Math.min(g.rts.distance, 420));
      g.select({ kind: 'building', b });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-look]').forEach((b) => b.addEventListener('click', () => {
      const look = b.dataset.look === 'classic' ? 'classic' : 'vault';
      if (look === svcLook()) return;
      try { localStorage.setItem(LOOK_KEY, look); } catch { /* private mode: this session only */ }
      // every service with a vault version changes clothes now
      for (const x of g.buildings.list.values()) if (x.zone === 'service' && x.kind && VAULT_LOOK[x.kind as ServiceModelId]) g.buildings.restyleCustom(x);
      rerender();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-svc]').forEach((b) => b.addEventListener('click', () => {
      placing = b.dataset.svc as SvcId; built = null;
      g.tools.setExt('svcPlace');
      const v = VIEW_FOR_CAT[panelCat];
      if (v) g.overlays.setExt(viewObjs.get(v)!);
      rerender();
    }));
  },
  close(g) {
    if (g.tools.active === 'ext' && g.tools.extTool === 'svcPlace') g.tools.set('inspect');
    if (S.view) g.overlays.setExt(null);
  },
  // the emergency card's "Fix …": that category, with its info view on (affected buildings in red)
  focus(g, key) {
    const cat = CATS.find((c) => c.id === key)?.id;
    if (!cat) return;
    if (panelCat !== cat && g.tools.active === 'ext' && g.tools.extTool === 'svcPlace') g.tools.set('inspect');
    panelCat = cat;
    const v = VIEW_FOR_CAT[cat];
    g.overlays.setExt(v ? viewObjs.get(v)! : null);
  },
  // the status line follows the city while the panel stays open
  refresh(el, g) {
    const live = el.querySelector('.svc-live');
    if (!live) return;
    const html = statusLine(panelCat, g);
    if (live.innerHTML !== html) live.innerHTML = html;
    const board = el.querySelector('.svc-board');
    const bh = panelCat === 'garbage' ? garbageBoard(g) : '';
    if (board && board.innerHTML !== bh) board.innerHTML = bh;
  },
});

// ============================================================== inspector
registerInspector((sel, g) => {
  if (sel.kind !== 'building') return null;
  const b = sel.b;
  const d = defOf(b);
  if (d) {
    const fs = fsOf(b);
    const active = b.state === 'active';
    const run = active ? Math.round(runningCosts(g).get(b.id) ?? 0) : 0;
    const rows: string[] = [`<div><span>Upkeep</span><b>$${d.upkeep}/wk</b></div>`];
    if (!active) {
      // under construction: nothing billed yet; say when it opens and what it will cost
      const est = estimateRun(g, d, b.x, b.z);
      rows.push(`<div><span>Opens in</span><b>~${Math.max(1, Math.ceil((b.buildDays ?? 6) * (1 - b.progress)))} day${Math.ceil((b.buildDays ?? 6) * (1 - b.progress)) === 1 ? '' : 's'}</b></div>`);
      rows.push(`<div><span>Then costs</span><b>$${d.upkeep}/wk${est ? ` + ≈${usd(est.perWk)}/wk running` : ''}</b></div>`);
    } else if (d.run) {
      // the running cost multiplied out, so the units reconcile (kL/day to $/wk)
      const perUnit = d.run < 1 ? `$${d.run.toFixed(2)}` : `$${d.run}`;
      const u = UTILS.find((x) => (d[x] ?? 0) > 0);
      const how = u ? `${fmt(run / (d.run * 7), u)} × ${perUnit} × 7 days` : d.collect ? `${(run / (d.run * 7)).toFixed(1)} t/day × ${perUnit} × 7 days` : d.capacity ? `${Math.round(run / d.run).toLocaleString()} ${d.cov === 'fire' ? 'buildings' : 'people'} served × ${perUnit}` : runText(d);
      rows.push(`<div><span>Running cost</span><b>$${run.toLocaleString()}/wk <small>(${how})</small></b></div>`);
    }
    for (const u of UTILS) if (d[u]) rows.push(`<div><span>Supplies</span><b>${fmt(d.id === 'solarFarm' ? (d[u] ?? 0) * solarFactor(g) : d[u] ?? 0, u)}</b></div>`);
    if (d.store) {
      const days = fs.rate > 0.05 ? Math.round((d.store - fs.stored) / fs.rate) : null;
      rows.push(`<div><span>Landfill</span><b class="${fs.full ? 'neg' : ''}">${Math.round(fs.stored).toLocaleString()} / ${d.store.toLocaleString()} t</b></div>`);
      rows.push(`<div><span>Full in</span><b class="${fs.full || (days !== null && days < 45) ? 'neg' : ''}">${fs.full ? 'Full: trucks idle' : days !== null ? `~${spanOf(days)} (${fs.rate.toFixed(fs.rate < 10 ? 1 : 0)} t/day)` : 'not filling'}</b></div>`);
    }
    if (d.collect) rows.push(`<div><span>Collects</span><b>${d.collect} t/day</b></div>`);
    if (d.reach) rows.push(`<div><span>Reach</span><b>${(d.reach / 60).toFixed(1)} min drive</b></div>`);
    if (d.capacity) rows.push(`<div><span>Load</span><b class="${fs.quality < 1 ? 'neg' : ''}">${Math.round(fs.load).toLocaleString()} / ${d.capacity.toLocaleString()}${fs.quality < 1 ? ' overloaded' : ''}</b></div>`);
    const warn = [!segOf(g, b) && 'No road connection: not working.', d.id === 'waterPump' && fs.contaminated && 'Drinking from a sewage outfall! People are getting sick.'].filter(Boolean);
    return `<p class="in-blurb">${esc(d.blurb)}</p>${warn.map((w) => `<p class="in-warn">${w}</p>`).join('')}<div class="in-stats">${rows.join('')}</div>`;
  }
  if (!isZoned(b)) return null;
  const bs = S.b.get(b.id);
  if (!bs) return null;
  const yes = (v: boolean) => (v ? '<b class="pos">✓</b>' : '<b class="neg">✗</b>');
  const bar = (q: number) => { const v = Math.max(0, Math.min(1, q)); return `<i class="svc-q"><i style="width:${Math.round(v * 100)}%;background:${v > 0.6 ? '#4fd05a' : v > 0.25 ? '#f2b01e' : '#e0302a'}"></i></i>`; };
  const td = trashDaysOf(b, bs);
  return `<div class="svc-util"><span>⚡ ${yes(bs.pw)}</span><span>🚰 ${yes(bs.wa)}${bs.dirty ? ' <small class="neg">dirty</small>' : ''}</span><span>🚽 ${yes(bs.se)}</span><span>🗑️ ${td > TRASH_ICON ? `<b class="neg">${Math.round(td)}d</b>` : '<b class="pos">ok</b>'}</span></div>
    <div class="svc-covs">
      <div><span>🚒 Fire</span>${bar(bs.cov.fire)}</div><div><span>🚓 Police</span>${bar(bs.cov.police)}</div>
      <div><span>🏥 Health</span>${bar(bs.cov.health)}</div><div><span>🎓 Educ.</span>${bar(bs.edu)}</div>
      <div><span>🦹 Safety</span>${bar(1 - bs.crime / 100)}</div><div><span>🤒 Wellness</span>${bar(1 - bs.sick / 0.35)}</div>
    </div>`;
});

// ============================================================== system + save
registerSystem({
  id: 'services',
  init(g) {
    if (S.inited) return;
    S.inited = true;
    initHooks(g);
    S.icons = new ProblemIcons(g.scene);
    g.problemAt = (cx, cy) => {
      const hit = S.icons?.pick(g.camera, g.renderer.domElement.getBoundingClientRect(), cx, cy);
      return hit ? { id: hit.id, text: (hit.n ?? 1) > 1 ? clusterText(hit) : problemText(g, hit.id) } : null;
    };
    g.emergency = () => S.emergency;
    g.net.events.on('changed', () => { S.graphDirty = true; S.compDirty = true; });
    g.linkProblem = (b) => linkProblem(g, b);
    g.roadLinkText = (b) => roadLinkText(g, b);
    g.linkedRoad = (seg) => segLinked(g, seg);
  },
  daily: (g, day) => { const t0 = performance.now(); daily(g, day); S.perf.ms += performance.now() - t0; S.perf.n++; },
  frame: (g, dt) => frame(g, dt),
  save(g) {
    const bld: [number, number, number, number, number, number, number][] = [];
    for (const [id, bs] of S.b) {
      const b = g.buildings.list.get(id);
      if (b) bld.push([Math.round(b.x), Math.round(b.z), +bs.garbage.toFixed(2), Math.round(bs.crime), +bs.edu.toFixed(2), +bs.sick.toFixed(2), b.abandoned ?? -1]);
    }
    const fac: [number, number, number][] = [];
    for (const [id, fs] of S.f) { const b = g.buildings.list.get(id); if (b && fs.stored > 0) fac.push([Math.round(b.x), Math.round(b.z), Math.round(fs.stored)]); }
    return { v: 1, bld, fac, pol: S.fields.save(), counts: S.counts, grace: S.graceUntil, week: { ...S.week }, crisis: { ...S.crisis } };
  },
  load(g, data) {
    const d = data as { bld?: [number, number, number, number, number, number, number?][]; fac?: [number, number, number][]; pol?: [number, number][]; counts?: typeof S.counts; grace?: number; week?: typeof S.week; crisis?: typeof S.crisis } | undefined;
    if (!d) return;
    S.loaded = true;
    S.linksSeen = false;
    S.graceUntil = d.grace ?? 0;
    // utility imports and trash hauled so far this week, billed at week's end
    if (d.week) S.week = { ...S.week, ...d.week };
    const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
    const byPos = new Map<string, Bld>();
    for (const b of g.buildings.list.values()) byPos.set(key(b.x, b.z), b);
    for (const [x, zz, garbage, crime, edu, sick, gone] of d.bld ?? []) {
      const b = byPos.get(key(x, zz));
      if (!b) continue;
      Object.assign(bsOf(b), { garbage, crime, edu, sick });
      if (gone !== undefined && gone >= 0 && isZoned(b)) { g.buildings.setAbandoned(b, true); b.abandoned = gone; }
    }
    for (const [x, zz, stored] of d.fac ?? []) {
      const b = byPos.get(key(x, zz));
      if (!b) continue;
      const fs = fsOf(b), store = defOf(b)?.store ?? Infinity;
      fs.stored = stored;
      // warnings already given before the save aren't given again
      fs.warned = stored >= store ? 100 : stored >= store * 0.9 ? 90 : stored >= store * 0.75 ? 75 : 0;
    }
    S.fields.load(d.pol);
    if (d.counts) Object.assign(S.counts, d.counts);
    if (d.crisis && typeof d.crisis === 'object') Object.assign(S.crisis, d.crisis);
    S.graphDirty = true;
  },
});

/** Read-only snapshot for other systems and tests. */
export function servicesSnapshot() {
  return { util: S.util, counts: { ...S.counts }, garbage: { ...S.garbage }, facilities: S.f.size, buildings: S.b.size, emergency: S.emergency };
}
(globalThis as unknown as { __services?: unknown }).__services = { snapshot: servicesSnapshot, place: placeService, canPlace: canPlaceService, findSpot: findServiceSpot, S, mergeUtilities, problemText, estimateRun: (g: Game, id: string, x: number, z: number) => estimateRun(g, SERVICE_DEFS.get(id)!, x, z), committedServices, overloadedServices, takeFrom, runningCosts: (g: Game) => runningCosts(g) };
