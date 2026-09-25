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
import { ROAD_TYPES } from '../roads/roadTypes';
import type { RSeg } from '../roads/network';
import { CELL, HALF, WATER, WORLD } from '../config';
import { INFO_OVERLAY, Paint } from '../world/terrain';
import { Fields } from './pollution';
import { ProblemIcons, type Problem } from './serviceIcons';
import type { FeedContext, FeedEventKind, VehicleKind, ZoneType } from '../contracts';
import type { DemandKey } from './sim';
import { POLICY } from './policyEffects';

type ZB = Bld & { zone: ZoneType };

// ============================================================== definitions
export type SvcCat = 'power' | 'water' | 'sewage' | 'garbage' | 'fire' | 'police' | 'health' | 'education' | 'parks';
/** Coverage networks (drive-time reach). */
type Cov = 'fire' | 'police' | 'health' | 'school' | 'college' | 'parks' | 'garbage';
const COVS: Cov[] = ['fire', 'police', 'health', 'school', 'college', 'parks', 'garbage'];
type Util = 'power' | 'water' | 'sewage';
const UTILS: Util[] = ['power', 'water', 'sewage'];

interface SvcDef {
  id: ServiceModelId;
  cat: SvcCat;
  name: string;
  blurb: string;
  icon: string;
  w: number;
  d: number;
  cost: number;
  upkeep: number; // $/week
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

const SVC: SvcDef[] = [
  { id: 'gasPeaker', cat: 'power', name: 'Frack Gas Peaker', blurb: 'Cheap, fast, smells like a birthday candle in a gas station.', icon: '🔥', w: 4, d: 3, cost: 16000, upkeep: 90, buildDays: 8, unlock: 0, power: 14, pollution: 0.3, noise: 0.7, height: 16 },
  { id: 'coalPlant', cat: 'power', name: 'Clean Coal™ Plant', blurb: 'The ™ does a lot of work. Huge output, huge smoke.', icon: '🏭', w: 6, d: 6, cost: 38000, upkeep: 200, buildDays: 14, unlock: 0, power: 45, pollution: 1.2, noise: 0.9, height: 62 },
  { id: 'solarFarm', cat: 'power', name: 'Freedom Solar Farm', blurb: 'Zero emissions. Output drops at night and under clouds.', icon: '☀️', w: 6, d: 4, cost: 30000, upkeep: 40, buildDays: 10, unlock: 400, power: 10, height: 4 },
  { id: 'nuclearPlant', cat: 'power', name: 'Three Mile Island Jr.', blurb: 'Enough power for the whole county. What could go wrong.', icon: '☢️', w: 7, d: 7, cost: 220000, upkeep: 700, buildDays: 30, unlock: 5000, power: 220, noise: 0.5, height: 52 },
  { id: 'waterPump', cat: 'water', name: 'Artesian Tap Pump', blurb: 'Pumps river water. Must touch water. Keep it far from the sewage outfall.', icon: '🚰', w: 2, d: 2, cost: 9000, upkeep: 45, buildDays: 6, unlock: 0, water: 3200, nearWater: true, noise: 0.3, height: 7 },
  { id: 'wellTower', cat: 'water', name: 'Groundwater Well Tower', blurb: 'Works anywhere. Small output. Boil notice pending.', icon: '🗼', w: 2, d: 2, cost: 7000, upkeep: 30, buildDays: 6, unlock: 0, water: 800, height: 26 },
  { id: 'sewageOutfall', cat: 'sewage', name: 'Sewage Outfall', blurb: 'Straight into the river. Must touch water. Pollutes the neighborhood.', icon: '🚽', w: 2, d: 2, cost: 6000, upkeep: 25, buildDays: 5, unlock: 0, sewage: 3800, nearWater: true, pollution: 0.5, noise: 0.2, height: 4 },
  { id: 'treatmentPlant', cat: 'sewage', name: 'Poop Palace Treatment', blurb: 'Actually cleans it. Costs more. Smells less.', icon: '🧫', w: 5, d: 4, cost: 32000, upkeep: 150, buildDays: 12, unlock: 1000, sewage: 6000, nearWater: true, pollution: 0.06, noise: 0.3, height: 7 },
  { id: 'landfill', cat: 'garbage', name: 'Mt. Trashmore Landfill', blurb: 'Trucks collect trash within reach. Fills up. Stinks up the neighbors.', icon: '🗑️', w: 6, d: 6, cost: 14000, upkeep: 70, buildDays: 8, unlock: 0, store: 9000, collect: 36, cov: 'garbage', reach: 220, pollution: 0.3, noise: 0.5, vehicle: 'garbageTruck', height: 16 },
  { id: 'incinerator', cat: 'garbage', name: 'Freedom Incinerator', blurb: 'Burns 60 t/day forever and makes 8 MW. The smoke is a feature.', icon: '♨️', w: 4, d: 4, cost: 42000, upkeep: 180, buildDays: 12, unlock: 1200, collect: 60, cov: 'garbage', reach: 260, power: 8, pollution: 0.8, noise: 0.6, vehicle: 'garbageTruck', height: 44 },
  { id: 'fireStation', cat: 'fire', name: 'Volunteer Fire Dept.', blurb: 'Reaches buildings by drive time. Prevents fires and saves the ones that catch.', icon: '🚒', w: 3, d: 3, cost: 12000, upkeep: 80, buildDays: 6, unlock: 0, cov: 'fire', reach: 100, capacity: 260, noise: 0.3, vehicle: 'firetruck', height: 13 },
  { id: 'sheriff', cat: 'police', name: "Sheriff's Office", blurb: 'Keeps crime down within reach. Qualified immunity included.', icon: '🚓', w: 3, d: 3, cost: 11000, upkeep: 85, buildDays: 6, unlock: 0, cov: 'police', reach: 110, capacity: 2600, noise: 0.2, vehicle: 'police', height: 9 },
  { id: 'clinic', cat: 'health', name: 'Urgent Care (Out of Network)', blurb: 'Treats the sick within reach. You will receive a bill.', icon: '🩺', w: 3, d: 3, cost: 14000, upkeep: 95, buildDays: 6, unlock: 0, cov: 'health', reach: 110, capacity: 1800, vehicle: 'ambulance', height: 7 },
  { id: 'hospital', cat: 'health', name: "St. Deductible's Hospital", blurb: 'Big reach, big capacity, bigger deductible.', icon: '🏥', w: 5, d: 4, cost: 60000, upkeep: 320, buildDays: 14, unlock: 1500, cov: 'health', reach: 200, capacity: 8000, noise: 0.3, vehicle: 'ambulance', height: 25 },
  { id: 'school', cat: 'education', name: 'Charter School of Excellence™', blurb: 'Educated residents unlock level 3+ homes and better offices.', icon: '🏫', w: 4, d: 4, cost: 16000, upkeep: 100, buildDays: 8, unlock: 0, cov: 'school', reach: 130, capacity: 1600, noise: 0.2, height: 10 },
  { id: 'college', cat: 'education', name: 'Prosperity Gospel University', blurb: 'College grads unlock the top levels. Tuition is a spiritual journey.', icon: '🎓', w: 6, d: 5, cost: 70000, upkeep: 350, buildDays: 16, unlock: 2000, cov: 'college', reach: 320, capacity: 9000, height: 28 },
  { id: 'park', cat: 'parks', name: 'Pocket Park', blurb: 'Raises land value nearby. No skateboarding.', icon: '🌳', w: 2, d: 2, cost: 3000, upkeep: 8, buildDays: 3, unlock: 0, cov: 'parks', reach: 45, height: 9 },
];
export const SERVICE_DEFS = new Map<string, SvcDef>(SVC.map((d) => [d.id, d]));
for (const d of SVC) CUSTOM_BUILDINGS.set(d.id, { label: d.name, w: d.w, d: d.d, buildDays: d.buildDays, model: () => serviceModel(d.id, d.w, d.d), paint: d.id === 'park' ? Paint.Lawn : Paint.Paved });

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
const TRASH_EXPORT = 3.5, TRASH_PRICE = 22;
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

// ============================================================== state
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
}
interface FS {
  stored: number; // landfill tons
  load: number; // people/tons it's asked to serve
  quality: number; // capacity share 0..1
  out: number; // dispatched vehicles on the road
  contaminated: boolean;
  full: boolean;
}
interface UtilStat { supply: number; demand: number; served: number; imported: number; unserved: number }
const z0 = (): UtilStat => ({ supply: 0, demand: 0, served: 0, imported: 0, unserved: 0 });

const S = {
  b: new Map<number, BS>(),
  f: new Map<number, FS>(),
  fields: new Fields(),
  graphDirty: true,
  facSig: '',
  /** node -> component root */
  comp: new Map<number, number>(),
  /** component roots with an outside connection */
  compEdge: new Set<number>(),
  /** per utility: node -> drive time from the nearest source (shed order) */
  utilT: {} as Partial<Record<Util, Map<number, number>>>,
  /** per coverage network: node -> {t, owner facility id} */
  covT: {} as Partial<Record<Cov, Map<number, { t: number; o: number }>>>,
  util: { power: z0(), water: z0(), sewage: z0() } as Record<Util, UtilStat>,
  week: { power: 0, water: 0, sewage: 0, trash: 0 },
  counts: { noPower: 0, noWater: 0, noSewage: 0, trash: 0, fires: 0, burned: 0, abandoned: 0, crime: 0, sick: 0 },
  garbage: { made: 0, collected: 0, exported: 0, stored: 0, capacity: 0 },
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
    s = { pw: true, wa: true, se: true, bad: 0, ok: 0, garbage: 0, crime: 8, sick: 0.02, edu: 0.15, burning: 0, cov: { fire: 0, police: 0, health: 0, school: 0, college: 0, parks: 0, garbage: 0 }, dirty: false };
    S.b.set(b.id, s);
  }
  return s;
}
function fsOf(b: Bld): FS {
  let s = S.f.get(b.id);
  if (!s) S.f.set(b.id, (s = { stored: 0, load: 0, quality: 1, out: 0, contaminated: false, full: false }));
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
  for (const c of COVS) {
    const src: { node: number; t: number; o: number }[] = [];
    let maxR = 0;
    for (const f of fac) {
      if (f.def.cov !== c) continue;
      const s = segOf(g, f);
      if (!s) continue;
      const half = segTime(s) / 2;
      src.push({ node: s.a, t: half, o: f.id }, { node: s.b, t: half, o: f.id });
      maxR = Math.max(maxR, f.def.reach ?? 0);
    }
    S.covT[c] = src.length ? dijkstra(g, src, maxR * 1.05) : new Map();
  }
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
      if (!s || c === undefined) { setUtil(bs, u, false); st.unserved++; continue; }
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
      } else { setUtil(bs, u, false); st.unserved++; }
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
  let made = 0, collected = 0, stored = 0, capacity = 0;
  const cap = new Map<number, number>(); // facility -> tons it can still take today
  for (const f of fac) {
    if (f.def.cov !== 'garbage') continue;
    const fs = fsOf(f);
    if (f.def.store) { fs.full = fs.stored >= f.def.store; stored += fs.stored; capacity += f.def.store; }
    cap.set(f.id, fs.full ? 0 : f.def.collect ?? 0);
  }
  const owned = new Map<number, ZB[]>();
  for (const b of zoned) {
    if (b.state !== 'active' || b.abandoned !== undefined) continue;
    const bs = bsOf(b);
    const t = trashOf(b);
    bs.garbage += t;
    made += t;
    const hit = reachOf(g, b, S.covT.garbage);
    if (hit && bs.cov.garbage > 0) {
      let arr = owned.get(hit.o);
      if (!arr) owned.set(hit.o, (arr = []));
      arr.push(b);
    }
  }
  for (const [fid, arr] of owned) {
    const start = cap.get(fid) ?? 0;
    let left = start;
    if (left <= 0) continue;
    // route batching: the fullest bins first
    arr.sort((a, b) => bsOf(b).garbage - bsOf(a).garbage);
    for (const b of arr) {
      if (left <= 0) break;
      const bs = bsOf(b);
      const take = Math.min(bs.garbage * (0.35 + 0.65 * Math.min(1, bs.cov.garbage * 1.6)), left);
      bs.garbage -= take;
      left -= take;
      collected += take;
    }
    const f = g.buildings.list.get(fid);
    const d = f && defOf(f);
    if (f && d?.store) {
      const fs = fsOf(f);
      fs.stored = Math.min(d.store, fs.stored + (start - left));
      if (fs.stored >= d.store && !fs.full) {
        fs.full = true;
        post(g, 'landfillFull', { building: f.label }, 1);
        g.toast(`${f.label} is full. Build another landfill or an incinerator.`, true);
      }
    }
    // a truck goes out on the route now and then (the visible part)
    if (f && arr.length && Math.random() < 0.5) dispatchFrom(g, f, arr[0], 'collecting trash', arr[0].label);
  }
  // the county contractor hauls what nobody local picks up (capped, pricey)
  let exportLeft = TRASH_EXPORT;
  const uncovered = zoned.filter((b) => b.state === 'active' && b.abandoned === undefined && bsOf(b).cov.garbage <= 0 && bsOf(b).garbage > 0.05 && onEdgeNet(g, b));
  uncovered.sort((a, b) => bsOf(b).garbage - bsOf(a).garbage);
  for (const b of uncovered) {
    if (exportLeft <= 0) break;
    const bs = bsOf(b);
    const take = Math.min(bs.garbage, exportLeft);
    bs.garbage -= take;
    exportLeft -= take;
  }
  const exported = TRASH_EXPORT - exportLeft;
  S.week.trash += exported;
  if (exported > 0 && uncovered.length && Math.random() < 0.25) {
    const b = uncovered[0];
    g.traffic.dispatch('garbageTruck', 'edge', b, 'county waste contract', b.label, g.hour, { sober: true, local: false, onDone: (_c, ok) => { if (ok && g.buildings.list.has(b.id)) g.traffic.dispatch('garbageTruck', b, 'edge', 'hauling trash out of county', 'the next county', g.hour, { sober: true, local: false }); } });
  }
  S.garbage = { made, collected, exported, stored, capacity };
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
    const target = (0.02 + Math.min(0.3, polHere * 0.1) + (bs.wa ? 0 : 0.18) + (bs.se ? 0 : 0.12) + (trashDaysOf(b, bs) > TRASH_BAD ? 0.08 : 0) + (bs.dirty ? 0.12 : 0)) * (1 - 0.8 * bs.cov.health);
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
    if (isRes(b) && bs.sick > 0.2 && b.occ > 0 && Math.random() < bs.sick) b.occ--;
  }
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
  for (const b of zoned) {
    if (b.state !== 'active' || !g.buildings.list.has(b.id)) continue;
    const bs = bsOf(b);
    if (!bs.pw) c.noPower++;
    if (!bs.wa) c.noWater++;
    if (!bs.se) c.noSewage++;
    const td = trashDaysOf(b, bs);
    if (td > TRASH_ICON) c.trash++;
    if (bs.crime > 55) c.crime++;
    if (bs.sick > 0.15) c.sick++;
    const critical = !bs.pw || !bs.wa || !bs.se || td > TRASH_CRIT || bs.sick > 0.35;
    if (b.abandoned === undefined) {
      bs.bad = critical && S.day >= S.graceUntil ? bs.bad + 1 : Math.max(0, bs.bad - 3);
      if (bs.bad >= 14) { g.buildings.setAbandoned(b, true); bs.ok = 0; newlyAbandoned++; post(g, 'abandoned', { building: b.label }, 0.3); }
    } else {
      c.abandoned++;
      b.abandoned++;
      bs.ok = critical ? 0 : bs.ok + 1;
      if (bs.ok >= 4) { g.buildings.setAbandoned(b, false); bs.bad = 0; }
      else if (b.abandoned >= 45) { g.buildings.demolish(b, 'abandoned'); S.b.delete(b.id); }
    }
  }
  Object.assign(S.counts, c);
  const share = (n: number) => (zoned.length ? n / zoned.length : 0);
  if (c.noPower > 3 && share(c.noPower) > 0.05) post(g, 'blackout', { count: c.noPower }, 0.35);
  if (c.noWater > 3 && share(c.noWater) > 0.05) post(g, 'waterOutage', { count: c.noWater }, 0.3);
  if (c.noSewage > 3 && share(c.noSewage) > 0.05) post(g, 'sewageBackup', { count: c.noSewage }, 0.3);
  if (c.trash > 5 && share(c.trash) > 0.08) post(g, 'garbagePile', { count: c.trash }, 0.25);
  if (c.crime > 5 && share(c.crime) > 0.08) post(g, 'crimeWave', {}, 0.2);
  if (c.sick > 5 && share(c.sick) > 0.08) post(g, 'sickness', {}, 0.2);
  if (newlyAbandoned >= 3) g.toast(`${newlyAbandoned} buildings abandoned. Check the Services info views.`, true);
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
      add('res', -hit, `${miss} buildings missing utilities`);
      add('com', -hit * 0.6, 'buildings missing utilities');
      add('ind', -hit * 0.6, 'buildings missing utilities');
    }
    if (S.counts.crime / n > 0.1) add('res', -Math.min(15, (S.counts.crime / n) * 40), 'crime');
    if (S.counts.sick / n > 0.1) add('res', -Math.min(15, (S.counts.sick / n) * 40), 'sickness');
    let sch = 0;
    for (const bs of S.b.values()) sch += bs.cov.school;
    if (S.b.size > 10 && sch / S.b.size > 0.4) add('res', (sch / S.b.size) * 8, 'good schools');
  });
  H.weekly.push((add) => {
    const byCat = new Map<SvcCat, number>();
    for (const f of facilities(g, false)) {
      const up = f.state === 'active' ? f.def.upkeep : 0;
      byCat.set(f.def.cat, (byCat.get(f.def.cat) ?? 0) + up);
    }
    for (const c of CATS) { const v = byCat.get(c.id); if (v) add(`${c.label} upkeep`, v, 'services'); }
    for (const u of UTILS) {
      const cost = S.week[u] * IMPORT_PRICE[u];
      if (cost >= 1) add(`${u[0].toUpperCase() + u.slice(1)} imports`, cost, 'services');
      S.week[u] = 0;
    }
    if (S.week.trash * TRASH_PRICE >= 1) add('County waste contract', S.week.trash * TRASH_PRICE, 'services');
    S.week.trash = 0;
  });
}

// ============================================================== frame: fires, icons, overlays
function frame(g: Game, dt: number) {
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

function problemOf(b: Bld): Problem | null {
  if (!isZoned(b) || b.state !== 'active') return null;
  const bs = S.b.get(b.id);
  if (!bs) return null;
  if (bs.burning > 0) return 'fire';
  if (b.abandoned !== undefined) return 'abandoned';
  if (!bs.pw) return 'power';
  if (!bs.wa) return 'water';
  if (!bs.se) return 'sewage';
  if (trashDaysOf(b, bs) > TRASH_ICON) return 'garbage';
  if (bs.sick > 0.15) return 'sick';
  if (bs.crime > 55) return 'crime';
  return null;
}

function refreshIcons(g: Game) {
  const cam = g.rts.target;
  const items: { x: number; y: number; z: number; p: Problem; id: number }[] = [];
  for (const b of g.buildings.near(cam.x, cam.z, 1500)) {
    const p = problemOf(b);
    if (!p) continue;
    items.push({ x: b.x, y: b.y + b.model.height + 5, z: b.z, p, id: b.id });
    if (items.length >= 600) break;
  }
  S.icons!.set(items);
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
let placing: ServiceModelId = 'gasPeaker';
let ghost: THREE.Group | null = null;
let ghostMat: THREE.MeshBasicMaterial | null = null;
let lastCheck: { ok: boolean; reason?: string; snapped?: boolean } | null = null;
let panelCat: SvcCat = 'power';

function rectCorners(x: number, z: number, hw: number, hd: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => ({ x: x + a * c + b * s, z: z - a * s + b * c }));
}
function inRect(px: number, pz: number, x: number, z: number, hw: number, hd: number, yaw: number, pad = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = px - x, dz = pz - z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= hw + pad && Math.abs(lz) <= hd + pad;
}

export function canPlaceService(g: Game, id: ServiceModelId, x: number, z: number): { ok: boolean; reason?: string; yaw: number } {
  const d = SERVICE_DEFS.get(id)!;
  const hw = (d.w * CELL) / 2, hd = (d.d * CELL) / 2;
  const pick = g.net.pickSeg(x, z, Math.max(hw, hd) + 40);
  let yaw = 0;
  if (pick) {
    const pts = pick.seg.samp.pts;
    const p = pts[Math.min(pts.length - 1, Math.round((pick.s / pick.seg.length) * (pts.length - 1)))];
    yaw = Math.atan2(p.x - x, p.z - z);
  }
  if (g.sim.mode !== 'sandbox' && g.sim.population < d.unlock) return { ok: false, yaw, reason: `Unlocks at ${d.unlock.toLocaleString()} people` };
  if (!g.terrain.inBounds(x, z, Math.max(hw, hd) + 12)) return { ok: false, yaw, reason: 'Outside the county' };
  if (g.net.allowed && !g.net.allowed(x, z)) return { ok: false, yaw, reason: "You don't own this land yet. Buy it in 🏞️ Land." };
  if (!pick) return { ok: false, yaw, reason: 'Needs a road within 40 m' };
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
      return { ok: false, yaw, reason: `Overlaps ${b.label}` };
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
  if (d.cost > g.sim.spendable()) return { ok: false, yaw, reason: 'Not enough money' };
  return { ok: true, yaw };
}

/** Problems moving the building a bit can fix (not money, unlocks or land). */
const snappable = (reason?: string) => !!reason && !/money|Unlocks|own this land|county/i.test(reason);

/**
 * The cursor spot, or the nearest valid spot around it (shore plants search
 * wider), so placing doesn't need pixel-perfect aim. null = nothing close works.
 */
export function findServiceSpot(g: Game, id: ServiceModelId, x: number, z: number): { x: number; z: number; yaw: number; snapped: boolean; reason?: string } {
  const here = canPlaceService(g, id, x, z);
  if (here.ok) return { x, z, yaw: here.yaw, snapped: false };
  if (!snappable(here.reason)) return { x, z, yaw: here.yaw, snapped: false, reason: here.reason };
  const maxR = SERVICE_DEFS.get(id)!.nearWater ? 110 : 60;
  for (let r = 8; r <= maxR; r += 8) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 14));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const c = canPlaceService(g, id, px, pz);
      if (c.ok) return { x: px, z: pz, yaw: c.yaw, snapped: true };
    }
  }
  return { x, z, yaw: here.yaw, snapped: false, reason: here.reason };
}

let spotCache: { id: string; x: number; z: number; r: ReturnType<typeof findServiceSpot> } | null = null;
function spotFor(g: Game, id: ServiceModelId, x: number, z: number) {
  if (spotCache && spotCache.id === id && Math.hypot(spotCache.x - x, spotCache.z - z) < 3) return spotCache.r;
  const r = findServiceSpot(g, id, x, z);
  spotCache = { id, x, z, r };
  return r;
}

function ensureGhost(g: Game) {
  if (ghost) return ghost;
  ghostMat = new THREE.MeshBasicMaterial({ color: 0x57e389, transparent: true, opacity: 0.35, depthWrite: false });
  ghost = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
  box.position.y = 0.5;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 3), ghostMat);
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 0.05, 0.62);
  ghost.add(box, arrow);
  ghost.visible = false;
  g.scene.add(ghost);
  return ghost;
}

function updateGhost(g: Game, p: THREE.Vector3 | null) {
  const gh = ensureGhost(g);
  if (!p) { gh.visible = false; lastCheck = null; return; }
  const d = SERVICE_DEFS.get(placing)!;
  const spot = spotFor(g, placing, p.x, p.z);
  const ok = !spot.reason;
  lastCheck = { ok, reason: spot.reason, snapped: spot.snapped };
  gh.visible = true;
  gh.position.set(spot.x, g.terrain.h(spot.x, spot.z), spot.z);
  gh.rotation.y = spot.yaw;
  gh.scale.set(d.w * CELL, Math.max(6, d.height * 0.6), d.d * CELL);
  ghostMat!.color.setHex(ok ? (spot.snapped ? 0x9be36a : 0x57e389) : 0xff5a4a);
}

/** Place a service building (the tool, tests and future AI all use this). */
export function placeService(g: Game, id: ServiceModelId, x: number, z: number): Bld | null {
  spotCache = null;
  const d = SERVICE_DEFS.get(id)!;
  const chk = canPlaceService(g, id, x, z);
  if (!chk.ok) { g.toast(chk.reason ?? 'Nope', true); g.audio.play('error'); return null; }
  g.sim.spend(d.cost, d.name, 'construction');
  const b = g.buildings.placeCustom(d.id, x, z, chk.yaw);
  if (!b) return null;
  S.graphDirty = true;
  g.audio.play('build');
  g.particles.emit('dust', b.x, b.y + 2, b.z, { count: 40, spread: b.hw });
  post(g, 'serviceBuilt', { building: d.name }, 0.6);
  return b;
}

registerTool({
  id: 'svcPlace',
  touchLift: 64,
  move: (g, p) => updateGhost(g, p),
  up: (g, p, _e, wasDrag) => {
    if (!p || wasDrag) return;
    const spot = spotFor(g, placing, p.x, p.z);
    if (placeService(g, placing, spot.x, spot.z)) spotCache = null;
    updateGhost(g, p);
  },
  cancel: () => { if (ghost) ghost.visible = false; lastCheck = null; },
  tip: () => {
    const d = SERVICE_DEFS.get(placing)!;
    if (lastCheck && !lastCheck.ok) return { text: `${d.name}: ${lastCheck.reason}`, bad: true };
    return { text: `${d.icon} ${d.name} · $${d.cost.toLocaleString()} · $${d.upkeep}/wk${lastCheck?.snapped ? ' · 📍 snapped to the nearest good spot' : ''}` };
  },
});

// ============================================================== panel
function statusLine(c: SvcCat): string {
  if (c === 'power' || c === 'water' || c === 'sewage') {
    const st = S.util[c];
    const short = st.unserved > 0;
    return `<div class="svc-stat ${short ? 'bad' : ''}">${fmt(st.served, c)} used · ${fmt(st.supply, c)} built · importing ${fmt(st.imported, c)}${short ? ` · <b>${st.unserved} cut off</b>` : ''}</div>`;
  }
  if (c === 'garbage') { const G = S.garbage; return `<div class="svc-stat ${S.counts.trash ? 'bad' : ''}">${G.made.toFixed(1)} t/day made · ${G.collected.toFixed(1)} collected · ${G.exported.toFixed(1)} hauled out of county · landfill ${Math.round(G.stored)}/${Math.round(G.capacity)} t</div>`; }
  const covs: Record<string, Cov[]> = { fire: ['fire'], police: ['police'], health: ['health'], education: ['school', 'college'], parks: ['parks'] };
  return `<div class="svc-stat">Coverage ${pct(avgCov(covs[c]))} of buildings</div>`;
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!); }

registerPanel({
  id: 'services',
  icon: '🏛️',
  label: 'Services',
  order: 35,
  render(el, g, rerender) {
    const pop = g.sim.population;
    const sandbox = g.sim.mode === 'sandbox';
    const list = SVC.filter((d) => d.cat === panelCat);
    const sel = SERVICE_DEFS.get(placing);
    el.innerHTML = `
      <div class="sp-title">City Services <small>Power, water and sewage flow along roads. Services reach buildings by drive time.</small></div>
      <div class="sp-row svc-cats">${CATS.map((c) => `<button class="chip ${c.id === panelCat ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>`).join('')}</div>
      ${statusLine(panelCat)}
      <div class="sp-grid">${list.map((d) => {
        const locked = !sandbox && pop < d.unlock;
        const on = g.tools.active === 'ext' && g.tools.extTool === 'svcPlace' && placing === d.id;
        return `<button class="card ${on ? 'on' : ''}" data-svc="${d.id}" ${locked ? 'disabled' : ''} title="${esc(d.blurb)}"><span class="ci">${d.icon}</span><b>${esc(d.name)}</b><small>${locked ? `🔒 ${d.unlock.toLocaleString()} pop` : `$${d.cost.toLocaleString()} · $${d.upkeep}/wk`}</small></button>`;
      }).join('')}</div>
      <div class="svc-blurb">${esc(sel && sel.cat === panelCat ? sel.blurb : list[0]?.blurb ?? '')}</div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      panelCat = b.dataset.cat as SvcCat;
      const v = VIEW_FOR_CAT[panelCat];
      g.overlays.setExt(v ? viewObjs.get(v)! : null);
      rerender();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-svc]').forEach((b) => b.addEventListener('click', () => {
      placing = b.dataset.svc as ServiceModelId;
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
});

// ============================================================== inspector
registerInspector((sel, g) => {
  if (sel.kind !== 'building') return null;
  const b = sel.b;
  const d = defOf(b);
  if (d) {
    const fs = fsOf(b);
    const rows: string[] = [`<div><span>Upkeep</span><b>$${d.upkeep}/wk</b></div>`];
    for (const u of UTILS) if (d[u]) rows.push(`<div><span>Supplies</span><b>${fmt(d.id === 'solarFarm' ? (d[u] ?? 0) * solarFactor(g) : d[u] ?? 0, u)}</b></div>`);
    if (d.store) rows.push(`<div><span>Landfill</span><b class="${fs.full ? 'neg' : ''}">${Math.round(fs.stored).toLocaleString()} / ${d.store.toLocaleString()} t</b></div>`);
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
    g.net.events.on('changed', () => { S.graphDirty = true; });
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
    return { v: 1, bld, fac, pol: S.fields.save(), counts: S.counts, grace: S.graceUntil };
  },
  load(g, data) {
    const d = data as { bld?: [number, number, number, number, number, number, number?][]; fac?: [number, number, number][]; pol?: [number, number][]; counts?: typeof S.counts; grace?: number } | undefined;
    if (!d) return;
    S.loaded = true;
    S.graceUntil = d.grace ?? 0;
    const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
    const byPos = new Map<string, Bld>();
    for (const b of g.buildings.list.values()) byPos.set(key(b.x, b.z), b);
    for (const [x, zz, garbage, crime, edu, sick, gone] of d.bld ?? []) {
      const b = byPos.get(key(x, zz));
      if (!b) continue;
      Object.assign(bsOf(b), { garbage, crime, edu, sick });
      if (gone !== undefined && gone >= 0 && isZoned(b)) { g.buildings.setAbandoned(b, true); b.abandoned = gone; }
    }
    for (const [x, zz, stored] of d.fac ?? []) { const b = byPos.get(key(x, zz)); if (b) fsOf(b).stored = stored; }
    S.fields.load(d.pol);
    if (d.counts) Object.assign(S.counts, d.counts);
    S.graphDirty = true;
  },
});

/** Read-only snapshot for other systems and tests. */
export function servicesSnapshot() {
  return { util: S.util, counts: { ...S.counts }, garbage: { ...S.garbage }, facilities: S.f.size, buildings: S.b.size };
}
(globalThis as unknown as { __services?: unknown }).__services = { snapshot: servicesSnapshot, place: placeService, canPlace: canPlaceService, findSpot: findServiceSpot, S };
