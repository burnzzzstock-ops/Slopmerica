// Traffic: trips between buildings (and out of town), A* routing with BPR
// congestion costs, IDM car-following per lane, signals at stroad junctions,
// drunk / reckless / smoking drivers and crashes. Induced demand emerges:
// free-flowing roads invite more trips.
import * as THREE from 'three';
import type { LandmarkId, VehicleKind } from '../contracts';
import { clamp, closestOnSampled, lerp, locate, norm, sub, V2 } from '../core/math';
import { fx } from '../core/rng';
import type { RNode, RoadNetwork, RSeg } from '../roads/network';
import { carriageHalf, laneOffset, ROAD_TYPES } from '../roads/roadTypes';
import type { Bld, Buildings } from '../sim/buildings';
import { FIXED_PAINT, randomVehicleKind, VEHICLE_SPECS, VehicleRenderer } from './vehicles';
import { LANDMARK_EVENTS, type Parking, type WorldSpot } from './parking';
import { ARCHETYPES } from './people';
import { HALF } from '../config';

/** Cars the simulation runs at once, whatever the graphics preset can draw. */
const SIM_MAX_CARS = 1000;

interface Step {
  seg: number;
  dir: 1 | -1;
}

export interface Car {
  id: number;
  h: number;
  /** live parking (drawn only): the stall it pulls into, the one it backs out of, and whether parking kept its handle */
  toSpot?: WorldSpot | null;
  fromSpot?: WorldSpot | null;
  parked?: boolean;
  /** the building it's going to */
  destB?: Bld | null;
  /** going through the drive-thru at its destination; `thru` once in the lane, `thruWait` while stopped on the road for room in it */
  thruB?: Bld | null;
  thru?: { L: ThruLane; serve: number; out: number; x: number; z: number; yaw: number } | null;
  thruWait?: number;
  /** what place() last drew it from (where it was on its path), and how many frames running it was the same */
  drawn?: { s: number; pi: number; lane: number; dep: number; arr: number; j: Car['junction']; turn: number; still: number; why: keyof Traffic['sigWhy'] };
  /** the junction it last slowed for someone on foot at (counts each stop once) */
  pedNode?: number;
  kind: VehicleKind;
  path: Step[];
  pi: number;
  s: number; // travel-direction distance along current seg
  startS: number;
  endS: number; // travel-direction distance where the trip ends on the last step
  lane: number;
  v: number;
  v0mul: number;
  len: number;
  drunk: boolean;
  reckless: boolean;
  smoker: boolean;
  redsRun: number;
  wob: number;
  /** crossing a junction on a cubic from the lane it left to the lane it joins; t is the share of the curve's length covered */
  junction: null | JunctionCurve;
  /** the junction curve just left, and where the new road started: drawn until the rear clears it */
  prevJ?: JunctionCurve | null;
  prevEntryS?: number;
  /** drawn lateral offset (m right of the centreline): eases across on a lane change */
  lat: number;
  /** its rate (m/s), which leans the nose into the change */
  latV: number;
  /** drawn heading, eased so nothing snaps */
  ryaw: number;
  /** the turn at the end of the current step (-1 right, 0 straight, 1 left), the speed to take it at, and the step it was worked out for */
  turn: number;
  turnV: number;
  turnFor: number;
  /** seconds until this driver will change lanes again */
  laneCd: number;
  crashed: number;
  crashYaw: number;
  crashRoll: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  purpose: string;
  dest: string;
  driver: number;
  smokeT: number;
  bac: number;
  /** seconds left pulling out of the origin lot (0 = on the road) */
  dep: number;
  /** seconds spent pulling into the destination lot (-1 = not parking) */
  arr: number;
  /** lot points beside the road at the origin / destination building */
  lotO: V2 | null;
  lotD: V2 | null;
  /** true for vehicles that live in town (resident / company cars) */
  local: boolean;
  /** seconds spent waiting to merge from a driveway */
  wait?: number;
  /** pulling out: found a gap at the kerb and is committed to it (cars in the lane brake for it) */
  committed?: boolean;
  /** the lot is on the far side of the road: pulling out crosses the oncoming lanes */
  lotLeft?: boolean;
  /** the building it pulled out of */
  fromB?: Bld | null;
  /** set when the trip reached its destination */
  arrived?: boolean;
  /** seconds of brake lights left (set when slowing hard) */
  brakeT: number;
  /** last acceleration (m/s²) and the body's lean out of turns / nose dive under braking (radians) */
  acc: number;
  roll: number;
  dive: number;
  /** called once when the car leaves the simulation (arrived, wrecked, or its road was removed) */
  onDone?: (c: Car, arrived: boolean) => void;
}

/** A point on a car's path and the direction of travel there. */
interface PathPoint { x: number; z: number; y: number; tx: number; tz: number }

/** A car crossing a junction on a cubic from the lane it left to the lane it joins; t is the share of the curve's length covered by its front. */
interface JunctionCurve { t: number; len: number; /** its real length (len is at least 2 m for timing; a bend in the road with no box is ~0) */ arc: number; p0: V2; c1: V2; c2: V2; p2: V2; t1: V2; t2: V2; lut: number[]; y0: number; y1: number; node: number; fromSeg: number; lane2: number; /** the lane and direction it came from */ fromDir: 1 | -1; fromLane: number; /** entered this step (it already moved) */ fresh?: boolean; /** points along it, for conflict tests (made on first use) */ pts?: V2[] }

/** Endpoint of a dispatched trip: a building, or 'edge' (an outside connection). */
export type TripEnd = Bld | 'edge';

export interface DispatchOpts {
  /** never drunk / reckless / smoking (service vehicles, buses) */
  sober?: boolean;
  /** counts as a town car (true) or an out-of-towner (false); default true */
  local?: boolean;
  onDone?: (c: Car, arrived: boolean) => void;
}

/** Direction of a road between samples i and i+1; repeated samples borrow their neighbours' (a zero-length step has no direction). */
function sampleTangent(seg: RSeg, i: number): V2 {
  // (worked out once per sampled road: every car's pose asks for it twice a frame)
  let T = tangents.get(seg.samp);
  if (!T) tangents.set(seg.samp, (T = []));
  return (T[i] ??= tangentAt(seg.samp.pts, i));
}
const tangents = new WeakMap<RSeg['samp'], V2[]>();
function tangentAt(P: V2[], i: number): V2 {
  const n = P.length;
  for (let k = 0; k < n; k++) {
    for (const j of k ? [i - k, i + k] : [i]) {
      if (j < 0 || j + 1 >= n) continue;
      const dx = P[j + 1].x - P[j].x, dz = P[j + 1].z - P[j].z, l = Math.hypot(dx, dz);
      if (l > 1e-4) return { x: dx / l, z: dz / l };
    }
  }
  return { x: 1, z: 0 };
}
const lotKey = (p: V2) => `${Math.round(p.x)},${Math.round(p.z)}`;
const smooth01 = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const angLerp = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const DEP_T = 2.6;
const ARR_T = 2.2;
/** pull-out time left when the car's nose reaches the kerb: it waits there for a gap */
const KERB_T = DEP_T * 0.55;
/** a queue lets a waiting driver in after this long (seconds at the kerb) */
const COURTESY_T = 5;
/** and holds back for this long at a time, once every COURTESY_CYCLE seconds, until the driver is out */
const COURTESY_HOLD = 12;
const COURTESY_CYCLE = 30;
/** where cars stop short of a junction (m before the box): behind the crosswalk at the box's edge */
const STOP_LINE = 3;
/** cars that can wait in one lot to pull out before its building starts no more trips */
const LOT_QUEUE_MAX = 3;
/** drive-thru: seconds at the window per car (plus up to THRU_SERVE_VAR more), and the pace up the lane */
const THRU_SERVE = 14;
const THRU_SERVE_VAR = 12;
const THRU_SPEED = 4;
/**
 * A car drawn from the same place on its path this many frames running is
 * standing still, its heading, lean and steering settled: place() leaves it
 * as drawn (at 1,000 cars, two in three are queued).
 */
const STILL_FRAMES = 12;
/**
 * Landmarks draw visitors (the traffic pass, playtest 6: "built the stadium,
 * nothing happens"; no trip ever went to one). Each open landmark's pull, as a
 * share of the town's local trips by day (9 am to 9 pm), summed and capped;
 * half the sightseeing trips are people heading home from one. The game nights
 * and services are LANDMARK_EVENTS (parking.ts): their crowd leaves home over
 * the EVENT_ARRIVE hours before the start (a drive across town takes a couple
 * of hours on the clock) and everyone who came drives home at the rate of
 * EVENT_OUT hours for the whole crowd from the end (a lot lets out three cars
 * at a time, so it can take longer), on top of the town's other trips, at most
 * EVENT_MAX cars.
 */
export const VISIT_PULL: Partial<Record<LandmarkId, number>> = { slopCannon: 0.025, slop69Field: 0.015, pigCabanaResort: 0.035, neuralFlyDatacenter: 0.01, propaneParadise: 0.02, fillErUpMegaStation: 0.035, megachurch: 0.015 };
const VISIT_MAX = 0.12;
const EVENT_ARRIVE = 1.5;
const EVENT_OUT = 3;
/** anyone still there this long after the end went home unseen */
const EVENT_OUT_MAX = 8;
const EVENT_MAX = 60;
/** sim seconds in an hour on the clock (a day is 360 s at ▶) */
const CLOCK_HOUR = 15;
/** a grand opening at a drive-thru: this long (sim seconds) of the town lining up, and the share of trips that go */
const OPENING_T = 240;
const OPENING_SHARE = 0.35;
/**
 * Crash rates (owner, 2026-09-30: "agree with lower"). Drunk drivers by day and
 * after 9 pm, reckless ones, and the random-crash hazard per second (scaled by
 * speed, by drunk x30 and reckless x5). Was 4% / 14% drunk and 6e-5: a crash
 * every ~1.5 minutes at rush hour and every ~30 s at night in a 700-person town.
 */
const DRUNK_DAY = 0.01, DRUNK_NIGHT = 0.06, RECKLESS = 0.08, CRASH_HAZARD = 0.00002;

function cubicAt(p0: V2, p1: V2, p2: V2, p3: V2, u: number): V2 {
  const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z };
}
function cubicTan(p0: V2, p1: V2, p2: V2, p3: V2, u: number): V2 {
  const v = 1 - u;
  return {
    x: 3 * v * v * (p1.x - p0.x) + 6 * v * u * (p2.x - p1.x) + 3 * u * u * (p3.x - p2.x),
    z: 3 * v * v * (p1.z - p0.z) + 6 * v * u * (p2.z - p1.z) + 3 * u * u * (p3.z - p2.z),
  };
}

/** A drive-thru lane on a lot: places in queue order from the window back, the way out, and who is in it. */
interface ThruLane {
  b: Bld;
  slots: { x: number; z: number; yaw: number }[];
  out: { x: number; z: number; yaw: number }[];
  q: Car[];
}

interface Signal {
  phaseOf: Map<number, number>;
  phases: number;
  t: number;
}

const GREEN = 11;
const CLEAR = 2.5;
const PAINT = [0xf2f2f2, 0x1a1a1a, 0x9aa0a6, 0x5a5e63, 0xb3202a, 0x1d3a8a, 0x2d4a2d, 0xc9b48a, 0xe0e0e0, 0x7a1f1f, 0x0f5f7a, 0xd8d8d2, 0xe89b2a, 0x2a2a2a];

class Heap {
  private a: { k: number; f: number }[] = [];
  push(k: number, f: number) {
    const a = this.a;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { k: number; f: number } | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export class Traffic {
  cars: Car[] = [];
  readonly renderer: VehicleRenderer;
  private nextId = 1;
  private signals = new Map<number, Signal>();
  private buckets = new Map<number, Car[]>();
  private junctionCars = new Map<number, Car[]>();
  private enteredAt = new Map<number, number>();
  private junctionTargets = new Map<number, number>();
  /** per lane: cars pulling out (committed) or in at a driveway, and drivers a slow queue should let in */
  private mergeBlocks = new Map<number, { s: number; len: number; courtesy: boolean }[]>();
  /** per approach lane (seg/dir/lane key): the car that entered the box last from it (least of its curve covered) */
  private boxTail = new Map<number, Car>();
  /** per exit lane key: the cars in the box heading for it */
  private boxByExit = new Map<number, Car[]>();
  /** cars waiting in each building's lot to pull out: a jammed driveway stops new trips from there */
  private lotCount = new Map<Bld, number>();
  /** per driveway: the car leaving first (least pull-out time left; the older car on a tie) */
  private lotLead = new Map<string, Car>();

  /** Is there room to leave the junction onto this lane? ("don't block the box") */
  private exitClear(c: Car): boolean {
    const nx = c.path[c.pi + 1];
    const ns = nx && this.net.segs.get(nx.seg);
    if (!ns) return true;
    const lanesN = ROAD_TYPES[ns.type].lanesPerDir;
    const lane = c.turn < 0 ? lanesN - 1 : c.turn > 0 ? 0 : Math.min(c.lane, lanesN - 1);
    const k = nx.seg * 16 + (nx.dir > 0 ? 0 : 8) + lane;
    const entryS = this.entryOf(ns, nx.dir);
    const q = this.buckets.get(k);
    const inBox = this.junctionTargets.get(k) ?? 0;
    const room = q && q.length ? q[0].s - q[0].len - entryS : Infinity;
    return room > 3 + inBox * 7;
  }
  flowEma = 1;
  speedMul = 1;
  crashMul = 1;
  targetCars = 0;
  // codex:policies begin -- city/district weighted demand and smoking callbacks
  policyTripMul = 1;
  policySmokingAllowed?: (b: Bld) => boolean;
  // codex:policies end
  /** terrain height sampler (set by the game) for cars in lots */
  groundAt?: (x: number, z: number) => number;
  /** game wiring: live parking (drawn only; see parking.ts) */
  parking?: Parking;
  /** drive-thru lanes by building (null: none), built from the building model's spots */
  private thruLanes = new Map<Bld, { model: Bld['model']; lanes: ThruLane[] } | null>();
  /** when cars arrived at each landmark (sim clock), for the inspector's visitors today */
  private visits = new Map<Bld, number[]>();
  /** an event's crowd not yet sent (a fraction of a car), by landmark */
  private crowdDue = new Map<Bld, number>();
  /** the crowd that came to an event and hasn't left for home yet, by landmark */
  private crowdIn = new Map<Bld, number>();
  /** Cars that came to this building in the last game day (6 minutes of traffic at ▶). */
  visitorsToday(b: Bld): number {
    const v = this.visits.get(b);
    return v ? v.filter((t) => this.clock - t < 360).length : 0;
  }
  /** A local trip to see a landmark now (or home from one), or null: sightseeing, by day. */
  private visitTarget(hour: number, landmarks: Bld[]): { b: Bld; purpose: string; home: boolean } | null {
    if (!landmarks.length || hour < 9 || hour >= 21) return null;
    const pull = landmarks.map((b) => (b.landmark && VISIT_PULL[b.landmark]) || 0), total = pull.reduce((a, v) => a + v, 0);
    const cap = Math.min(total, VISIT_MAX);
    let r = Math.random() * Math.max(total, VISIT_MAX);
    if (r >= cap) return null;
    const home = r < cap / 2;
    r *= total / cap;
    for (let i = 0; i < landmarks.length; i++) if ((r -= pull[i]) < 0) return { b: landmarks[i], purpose: home ? 'heading home' : 'sightseeing', home };
    return null;
  }

  /**
   * A game night's or a service's crowd: people leave home for it before it
   * starts, and everyone who came drives home after it ends (as fast as they
   * came, however long the lot takes to let them out).
   */
  private eventCrowds(dt: number, hour: number) {
    const { landmarks, res } = this.lists();
    if (!res.length) return;
    for (const b of landmarks) {
      const e = b.landmark && LANDMARK_EVENTS[b.landmark];
      if (!e) continue;
      const until = (e.from - hour + 24) % 24, since = (hour - e.to + 24) % 24;
      const arriving = until > 0 && until <= EVENT_ARRIVE, leaving = since < EVENT_OUT_MAX && (this.crowdIn.get(b) ?? 0) > 0;
      // (from the first one leaving home to the last one home: anyone still there after it went home unseen)
      if ((hour - e.from + EVENT_ARRIVE + 24) % 24 >= e.to - e.from + EVENT_ARRIVE + EVENT_OUT_MAX) this.crowdIn.delete(b);
      if (!arriving && !leaving) { this.crowdDue.delete(b); continue; }
      const crowd = Math.min(EVENT_MAX, this.pop * e.crowd);
      let due = (this.crowdDue.get(b) ?? 0) + (crowd / ((arriving ? EVENT_ARRIVE : EVENT_OUT) * CLOCK_HOUR)) * dt;
      for (let k = 0; due >= 1 && k < 4 && this.cars.length < SIM_MAX_CARS; k++) {
        const home = res[Math.floor(Math.random() * res.length)];
        const [oB, dB] = arriving ? [home, b] : [b, home];
        const o = this.anchor(oB), d = this.anchor(dB);
        // (the lot's exit busy, or its queue full: this one goes next step)
        if (!o || !d || !this.launch(o, d, oB, dB, randomVehicleKind(Math.random), arriving ? e.purpose : 'heading home', dB.label, true, hour)) break;
        due -= 1;
        if (leaving) this.crowdIn.set(b, (this.crowdIn.get(b) ?? 1) - 1);
      }
      this.crowdDue.set(b, Math.min(due, arriving ? 8 : this.crowdIn.get(b) ?? 0));
    }
  }

  /** drive-thrus in their grand opening: sim seconds left */
  private openings = new Map<Bld, number>();
  /** when each drive-thru last spilled onto the road (sim clock), so the feed says so once */
  private spilledAt = new Map<Bld, number>();
  private clock = 0;
  /** game wiring: a drive-thru line has backed out onto the road and is blocking a lane */
  onDriveThruSpill?: (b: Bld, seg: RSeg | undefined) => void;

  /** The drive-thru lanes at a building (from its model's spots), or null. */
  thruAt(b: Bld): ThruLane[] | null {
    const hit = this.thruLanes.get(b);
    if (hit !== undefined && (!hit || hit.model === b.model)) return hit ? hit.lanes : null;
    const sp = b.model.spots?.filter((p) => p.kind === 'thru' || p.kind === 'out');
    if (!sp || !sp.some((p) => p.kind === 'thru') || b.state !== 'active') { this.thruLanes.set(b, null); return null; }
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    const w = (p: { x: number; z: number; yaw: number }) => ({ x: b.x + p.x * c + p.z * sn, z: b.z - p.x * sn + p.z * c, yaw: b.yaw + p.yaw });
    const lanes: ThruLane[] = [];
    for (const n of [...new Set(sp.map((p) => p.lane ?? 0))]) {
      const slots = sp.filter((p) => p.kind === 'thru' && (p.lane ?? 0) === n).sort((a, b2) => (a.q ?? 0) - (b2.q ?? 0)).map(w);
      if (slots.length) lanes.push({ b, slots, out: sp.filter((p) => p.kind === 'out' && (p.lane ?? 0) === n).map(w), q: [] });
    }
    // (a rebuilt lot: whoever was in the old lanes carries on in the new first one)
    const old = hit?.lanes.flatMap((L) => L.q) ?? [];
    for (const car of old) if (lanes[0] && lanes[0].q.length < lanes[0].slots.length && car.thru) { car.thru.L = lanes[0]; lanes[0].q.push(car); } else if (car.thru) { car.arrived = true; car.crashed = -1; }
    this.thruLanes.set(b, lanes.length ? { model: b.model, lanes } : null);
    return lanes.length ? lanes : null;
  }

  /** Is there room at the back of a drive-thru line here? */
  private thruRoom(b: Bld): boolean {
    return !!this.thruAt(b)?.some((L) => L.q.length < L.slots.length);
  }

  /** Move a car in a drive-thru lane toward a place at walking-the-line pace; true once it's there. */
  private thruMove(c: Car, p: { x: number; z: number; yaw: number }, dt: number): boolean {
    const T = c.thru!, dx = p.x - T.x, dz = p.z - T.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { c.v = 0; T.yaw = angLerp(T.yaw, p.yaw, Math.min(1, dt * 3)); return true; }
    const k = Math.min(1, (THRU_SPEED * dt) / d);
    T.x += dx * k; T.z += dz * k;
    if (d > 0.4) T.yaw = angLerp(T.yaw, Math.atan2(dx, dz), Math.min(1, dt * 5));
    c.v = THRU_SPEED;
    return k >= 1;
  }

  /** A drive-thru just opened: the town lines up for a while (the line spills onto the stroad). */
  grandOpening(b: Bld) {
    if (this.thruAt(b)) this.openings.set(b, OPENING_T);
  }

  /** Cars in each drive-thru line, and cars stopped on the road waiting for room in one (tests, inspector). */
  thruStats() {
    const lines: { b: Bld; inLane: number; places: number; onRoad: number }[] = [];
    for (const [b, v] of this.thruLanes) {
      if (!v) continue;
      lines.push({ b, inLane: v.lanes.reduce((n, L) => n + L.q.length, 0), places: v.lanes.reduce((n, L) => n + L.slots.length, 0), onRoad: this.cars.filter((c) => c.thruB === b && !c.thru && (c.thruWait ?? 0) > 0).length });
    }
    return lines;
  }
  /** A paint for a car of this kind (the parked cars use the traffic's mix). */
  static paint(kind: VehicleKind, rnd: () => number): number {
    return FIXED_PAINT[kind] ?? PAINT[Math.floor(rnd() * PAINT.length)];
  }
  /** game wiring: the people walking over this arm of this junction: where they are and which way they're going */
  crosswalkWalkers?: (node: number, seg: number) => { x: number; z: number; dx: number; dz: number }[] | undefined;
  /** crosswalk stops (a car slowing for someone on foot at a junction, once each), for tests */
  pedYields = 0;
  private yieldedTo(c: Car, node: number) {
    if (c.v > 1 && c.pedNode !== node) { c.pedNode = node; this.pedYields++; }
  }
  private pop = 0;
  private jobsNow = 0;
  totalTrips = 0;
  crashes = 0;
  /** game wiring */
  onCrash?: (cars: Car[], seg: RSeg | undefined, drunk: boolean) => void;
  onJam?: (seg: RSeg) => void;
  onEmit?: (kind: 'cigarette' | 'smoke' | 'spark' | 'fire', x: number, y: number, z: number, n: number) => void;
  // codex:freight begin - real goods scheduler owns freight spawning when set
  freightTrip?: () => boolean;
  // codex:freight end
  // codex:transit begin - true means this local trip chose transit
  transitModeChoice?: (from: Bld, to: Bld) => boolean;
  // codex:transit end
  private jamTimer = new Map<number, number>();

  constructor(scene: THREE.Scene, private net: RoadNetwork, private b: Buildings, private maxCars: number) {
    this.renderer = new VehicleRenderer(scene, maxCars);
    net.events.on('changed', () => this.rebuildSignals());
    net.events.on('segRemoved', (s) => this.dropCarsOn(s.id));
    net.events.on('segChanged', (s) => this.dropCarsOn(s.id));
  }

  /** extra metres cut off both roads at a bend with no junction box, per node (cleared when the network changes) */
  private bendCuts = new Map<number, number>();

  /**
   * Two roads meeting at an angle with no junction box: cars start the turn a
   * few metres early and finish it a few metres late, so they round the corner
   * on a curve instead of turning on the spot. 0 for junctions and straight joins.
   */
  private bendCut(nodeId: number): number {
    const hit = this.bendCuts.get(nodeId);
    if (hit !== undefined) return hit;
    let cut = 0;
    const n = this.net.nodes.get(nodeId);
    if (n && n.segs.length === 2) {
      const [s1, s2] = n.segs.map((id) => this.net.segs.get(id));
      if (s1 && s2) {
        // directions away from the node along each road
        const away = (sg: RSeg) => { const P = sg.samp.pts, atA = sg.a === nodeId; const q = atA ? P[Math.min(P.length - 1, 2)] : P[Math.max(0, P.length - 3)]; return norm({ x: q.x - n.x, z: q.z - n.z }); };
        const a = away(s1), b = away(s2);
        const ang = Math.PI - Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1)); // 0 = straight on
        if (ang > 0.12) cut = Math.min(8, 1.5 + ang * 5, s1.length * 0.3, s2.length * 0.3);
      }
    }
    this.bendCuts.set(nodeId, cut);
    return cut;
  }
  /** where a car leaves this road for the next (travel distance) */
  private exitOf(seg: RSeg, dir: 1 | -1): number {
    return seg.length - Math.max(dir > 0 ? seg.trimB : seg.trimA, this.bendCut(dir > 0 ? seg.b : seg.a));
  }
  /** where a car joins this road from a junction (travel distance) */
  private entryOf(seg: RSeg, dir: 1 | -1): number {
    return Math.max(dir > 0 ? seg.trimA : seg.trimB, this.bendCut(dir > 0 ? seg.a : seg.b));
  }

  // ------------------------------------------------------------------ signals
  private rebuildSignals() {
    this.bendCuts.clear();
    this.edges = null;
    const old = this.signals;
    this.signals = new Map();
    for (const n of this.net.nodes.values()) {
      if (n.segs.length < 3) continue;
      const segs = n.segs.map((id) => this.net.segs.get(id)!).filter(Boolean);
      if (!segs.some((s) => ROAD_TYPES[s.type].signals)) continue;
      const ang = segs.map((s) => {
        const atA = s.a === n.id;
        const p = atA ? s.samp.pts[Math.min(3, s.samp.pts.length - 1)] : s.samp.pts[Math.max(0, s.samp.pts.length - 4)];
        return { id: s.id, a: Math.atan2(p.z - n.z, p.x - n.x) };
      });
      // Roads straight across from each other (at least 135 degrees apart) share a
      // green, the most nearly opposite pair first; every other road gets its own.
      // (Alternating round the junction put a T's stem in the same green as half
      // its through road, so a left turn out of it crossed the through traffic.)
      const pairs: { i: number; j: number; d: number }[] = [];
      for (let i = 0; i < ang.length; i++) for (let j = i + 1; j < ang.length; j++) {
        let d = Math.abs(ang[i].a - ang[j].a) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d >= (Math.PI * 3) / 4) pairs.push({ i, j, d });
      }
      pairs.sort((x, y) => y.d - x.d);
      const phaseOf = new Map<number, number>();
      let phases = 0;
      for (const { i, j } of pairs) {
        if (phaseOf.has(ang[i].id) || phaseOf.has(ang[j].id)) continue;
        phaseOf.set(ang[i].id, phases);
        phaseOf.set(ang[j].id, phases++);
      }
      for (const e of ang) if (!phaseOf.has(e.id)) phaseOf.set(e.id, phases++);
      this.signals.set(n.id, { phaseOf, phases, t: old.get(n.id)?.t ?? Math.random() * 20 });
    }
  }

  isGreen(nodeId: number, segId: number): boolean {
    const s = this.signals.get(nodeId);
    if (!s) return true;
    const cyc = GREEN + CLEAR;
    const t = s.t % (cyc * s.phases);
    const ph = Math.floor(t / cyc);
    const inClear = t - ph * cyc > GREEN;
    return !inClear && s.phaseOf.get(segId) === ph;
  }

  signalState(nodeId: number) {
    return this.signals.get(nodeId);
  }

  /** In the yellow and all-red that follow this road's green: a left-turner waiting at the line finishes its turn now. */
  private clearing(nodeId: number, segId: number): boolean {
    const s = this.signals.get(nodeId);
    if (!s) return false;
    const cyc = GREEN + CLEAR, t = s.t % (cyc * s.phases), ph = Math.floor(t / cyc);
    return t - ph * cyc > GREEN && s.phaseOf.get(segId) === ph;
  }

  // ------------------------------------------------------------------ routing
  private segCost(s: RSeg, dirIdx: number): number {
    const t = ROAD_TYPES[s.type];
    const lanes = t.lanesPerDir;
    const cap = Math.max(1, (lanes * s.length) / 9);
    const vc = s.load[dirIdx] / cap;
    return (s.length / (t.speed * this.speedMul)) * (1 + 0.15 * Math.pow(vc * 1.6, 4)) + (s.blocked > 0 ? 300 : 0);
  }

  /** A* from a point on segO to a point on segD. Positions are arc lengths along each seg. */
  route(segO: RSeg, sO: number, segD: RSeg, sD: number): { steps: Step[]; startS: number; endS: number } | null {
    const oneO = !!ROAD_TYPES[segO.type].oneWay, oneD = !!ROAD_TYPES[segD.type].oneWay;
    if (segO.id === segD.id && !(oneO && sD < sO)) {
      const dir: 1 | -1 = sD >= sO ? 1 : -1;
      if (Math.abs(sD - sO) < 15) return null;
      return { steps: [{ seg: segO.id, dir }], startS: dir > 0 ? sO : segO.length - sO, endS: dir > 0 ? sD : segD.length - sD };
    }
    // (a one-way trip back up its own street goes round the block)
    const vmax = 31;
    const goal = { x: 0, z: 0 };
    const gp = segD.samp.pts[Math.floor(segD.samp.pts.length / 2)];
    goal.x = gp.x;
    goal.z = gp.z;
    const g = new Map<number, number>();
    const came = new Map<number, { prev: number; seg: number; dir: 1 | -1 }>();
    const open = new Heap();
    const H = (n: RNode) => Math.hypot(n.x - goal.x, n.z - goal.z) / vmax;
    const speedO = ROAD_TYPES[segO.type].speed;
    // leaving segO toward a (dir -1) or b (dir +1)
    const A = this.net.nodes.get(segO.a)!, B = this.net.nodes.get(segO.b)!;
    if (!oneO) {
      g.set(A.id, sO / speedO);
      came.set(A.id, { prev: -1, seg: segO.id, dir: -1 });
      open.push(A.id, sO / speedO + H(A));
    }
    const gb = (segO.length - sO) / speedO;
    if (!g.has(B.id) || gb < g.get(B.id)!) {
      g.set(B.id, gb);
      came.set(B.id, { prev: -1, seg: segO.id, dir: 1 });
      open.push(B.id, gb + H(B));
    }
    const speedD = ROAD_TYPES[segD.type].speed;
    const extraA = sD / speedD; // arrive at segD.a, travel +1
    const extraB = (segD.length - sD) / speedD; // arrive at segD.b, travel -1
    let bestGoal = Infinity;
    let bestEnd: { node: number; dir: 1 | -1 } | null = null;
    const closed = new Set<number>();
    let exp = 0;
    while (open.size && exp < 5000) {
      const cur = open.pop()!;
      if (closed.has(cur.k)) continue;
      if (cur.f >= bestGoal) break;
      closed.add(cur.k);
      exp++;
      const gc = g.get(cur.k)!;
      if (cur.k === segD.a && gc + extraA < bestGoal) { bestGoal = gc + extraA; bestEnd = { node: cur.k, dir: 1 }; }
      if (cur.k === segD.b && !oneD && gc + extraB < bestGoal) { bestGoal = gc + extraB; bestEnd = { node: cur.k, dir: -1 }; }
      const node = this.net.nodes.get(cur.k);
      if (!node) continue;
      const sigPenalty = this.signals.has(node.id) ? 5 : 0;
      for (const sid of node.segs) {
        const s = this.net.segs.get(sid);
        if (!s || s.id === segD.id) continue;
        const dir: 1 | -1 = s.a === node.id ? 1 : -1;
        if (dir < 0 && ROAD_TYPES[s.type].oneWay) continue; // wrong way down a one-way
        const to = dir > 0 ? s.b : s.a;
        const ng = gc + this.segCost(s, dir > 0 ? 0 : 1) + sigPenalty;
        if (ng < (g.get(to) ?? Infinity)) {
          g.set(to, ng);
          came.set(to, { prev: cur.k, seg: s.id, dir });
          const tn = this.net.nodes.get(to)!;
          open.push(to, ng + H(tn));
        }
      }
    }
    if (!bestEnd) return null;
    const steps: Step[] = [{ seg: segD.id, dir: bestEnd.dir }];
    let k = bestEnd.node;
    let guard = 0;
    while (guard++ < 5000) {
      const c = came.get(k);
      if (!c) return null;
      steps.push({ seg: c.seg, dir: c.dir });
      if (c.prev === -1) break;
      k = c.prev;
    }
    steps.reverse();
    const first = steps[0];
    const startS = first.dir > 0 ? sO : segO.length - sO;
    const endS = bestEnd.dir > 0 ? sD : segD.length - sD;
    return { steps, startS, endS };
  }

  // ------------------------------------------------------------------ spawning
  private anchor(bld: Bld): { seg: RSeg; s: number } | null {
    let seg = this.net.segs.get(bld.seg);
    if (!seg) {
      // (a landmark or service faces the road it was squared to: as far off as its lot is big)
      const p = this.net.pickSeg(bld.x, bld.z, Math.max(50, Math.max(bld.hw, bld.hd) + 12));
      if (!p) return null;
      bld.seg = p.seg.id;
      seg = p.seg;
    }
    const c = closestOnSampled({ x: bld.x, z: bld.z }, seg.samp);
    return { seg, s: clamp(c.s, 3, seg.length - 3) };
  }

  /** A point in the building's lot just off the road edge (where cars pull in/out). */
  private lotPoint(bld: Bld, seg: RSeg, sAlong: number): V2 {
    const { i, f } = locate(seg.samp, clamp(sAlong, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const cx = lerp(a.x, b.x, f), cz = lerp(a.z, b.z, f);
    const t = norm(sub(b, a));
    const n = { x: -t.z, z: t.x };
    const side = (bld.x - cx) * n.x + (bld.z - cz) * n.z >= 0 ? 1 : -1;
    const off = ROAD_TYPES[seg.type].width / 2 + 6;
    return { x: cx + n.x * side * off, z: cz + n.z * side * off };
  }

  /** the buildings trips start and end at, gathered once a step */
  private tripLists: { step: number; list: Bld[]; landmarks: Bld[]; res: Bld[]; jobs: Bld[]; shops: Bld[]; ind: Bld[] } | null = null;
  /** (the lists once a step, not once a try: up to 12 tries a step, each over every building) */
  private lists() {
    if (this.tripLists?.step !== this.stepN) {
      // (one pass over the buildings, each list in the town's order)
      const L: NonNullable<Traffic['tripLists']> = (this.tripLists = { step: this.stepN, list: [], landmarks: [], res: [], jobs: [], shops: [], ind: [] });
      for (const b of this.b.list.values()) {
        if (b.state !== 'active' || b.zone === 'service') continue;
        // open landmarks a road reaches (one no road reaches draws nobody)
        if (b.zone === 'landmark') { if (!b.offNet) L.landmarks.push(b); continue; }
        L.list.push(b);
        if (b.zone === 'resLow' || b.zone === 'resHigh') L.res.push(b);
        else {
          L.jobs.push(b);
          if (b.zone === 'comLow' || b.zone === 'comHigh') L.shops.push(b);
          else if (b.zone === 'industry') L.ind.push(b);
        }
      }
    }
    return this.tripLists;
  }
  private stepN = 0;
  /** every car by the road and way it's on (seg * 2 + (dir > 0 ? 0 : 1)), built once for the step's trip launches */
  private segDirIndex: Map<number, Car[]> | null = null;
  private onSegDir(): Map<number, Car[]> {
    if (this.segDirIndex) return this.segDirIndex;
    const m = new Map<number, Car[]>();
    for (const c of this.cars) {
      const st = c.path[c.pi], k = st.seg * 2 + (st.dir > 0 ? 0 : 1);
      const a = m.get(k);
      if (a) a.push(c); else m.set(k, [c]);
    }
    this.segDirIndex = m;
    return m;
  }
  /** road ends at the map edge (cached until the network changes) */
  private edges: { seg: RSeg; s: number }[] | null = null;
  private edgeAnchors(): { seg: RSeg; s: number }[] {
    if (this.edges) return this.edges;
    const out: { seg: RSeg; s: number }[] = (this.edges = []);
    for (const n of this.net.nodes.values()) {
      if (Math.abs(n.x) > HALF - 40 || Math.abs(n.z) > HALF - 40) {
        const seg = this.net.segs.get(n.segs[0]);
        if (seg) out.push({ seg, s: seg.a === n.id ? 2 : seg.length - 2 });
      }
    }
    return out;
  }

  spawnTrip(hour: number): boolean {
    // codex:freight begin - give the conserved-goods scheduler a spawn opportunity
    if (this.freightTrip?.()) return true;
    // codex:freight end
    const { list, landmarks, res, jobs, shops, ind } = this.lists();
    const edges = this.edgeAnchors();
    if (list.length < 2 && !edges.length) return false;
    const morning = hour > 6 && hour < 10, evening = hour > 15.5 && hour < 19.5;
    let o: { seg: RSeg; s: number } | null = null, d: { seg: RSeg; s: number } | null = null;
    let oB: Bld | null = null, dB: Bld | null = null;
    let local = true;
    let purpose = 'cruising', dest = 'nowhere in particular', kind: VehicleKind = randomVehicleKind(Math.random);
    let visit: { b: Bld; purpose: string; home: boolean } | null = null;
    const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    // Out-of-towners arrive and leave by the highway (outside connections).
    // Their share grows with jobs the locals can't fill, plus tourists,
    // freight and through traffic. Locals' cars live in town.
    const workers = this.pop * 0.55;
    const unfilled = this.jobsNow > 0 ? clamp((this.jobsNow - workers) / this.jobsNow, 0, 0.9) : 0;
    const pOutside = !edges.length ? 0 : list.length < 4 ? 1 : clamp(0.14 + unfilled * 0.6, 0.14, 0.85);
    const inbound = !(evening || hour >= 19.5 || hour < 4);
    if (Math.random() < pOutside) {
      local = false;
      const r = Math.random();
      const edgeO = pick(edges);
      if (r < 0.2 && edges.length > 1) {
        // through traffic: in one connection, out another
        let e2 = pick(edges);
        for (let k = 0; k < 4 && e2.seg === edgeO.seg; k++) e2 = pick(edges);
        o = edgeO; d = e2;
        purpose = 'passing through';
        dest = 'the next county';
        if (Math.random() < 0.3) kind = Math.random() < 0.5 ? 'semi' : 'boxTruck';
      // codex:freight begin - suppress legacy random cargo when real freight is installed
      } else if (!this.freightTrip && r < 0.42 && (shops.length || ind.length)) {
      // codex:freight end
        // freight: imports to shops/industry, exports from industry
        kind = Math.random() < 0.55 ? 'semi' : 'boxTruck';
        if (ind.length && (Math.random() < 0.45 || !shops.length)) {
          if (Math.random() < 0.5) { oB = pick(ind); o = this.anchor(oB); d = edgeO; purpose = 'exporting goods'; dest = 'the interstate'; }
          else { dB = pick(ind); o = edgeO; d = this.anchor(dB); purpose = 'delivering raw materials'; dest = dB.label; }
        } else {
          dB = pick(shops); o = edgeO; d = this.anchor(dB); purpose = 'importing goods'; dest = dB.label;
        }
      } else if (list.length) {
        // commuters, shoppers, tourists
        const tgt = jobs.length && Math.random() < 0.7 ? pick(jobs) : pick(list);
        if (inbound) { dB = tgt; o = edgeO; d = this.anchor(tgt); purpose = jobs.includes(tgt) && hour < 12 ? 'commuting in from out of town' : 'visiting from out of town'; dest = tgt.label; }
        else { oB = tgt; o = this.anchor(tgt); d = edgeO; purpose = 'heading home out of town'; dest = 'a cheaper county'; }
      } else {
        // empty county: only through traffic on the old road
        o = edgeO; d = pick(edges); purpose = 'passing through'; dest = 'somewhere with a Waffle Hut';
      }
    // codex:freight begin - local deliveries come from conserved factory stock
    } else if (!this.freightTrip && ind.length && shops.length && Math.random() < 0.14) {
    // codex:freight end
      oB = pick(ind); dB = pick(shops);
      o = this.anchor(oB);
      d = this.anchor(dB);
      kind = Math.random() < 0.5 ? 'boxTruck' : 'semi';
      purpose = 'delivering goods';
      dest = dB.label;
    } else if (res.length && (visit = this.visitTarget(hour, landmarks))) {
      // a landmark's visitors: a game, church, or a look at the Slop Cannon (and home after)
      const home = pick(res);
      [oB, dB] = visit.home ? [visit.b, home] : [home, visit.b];
      o = this.anchor(oB);
      d = this.anchor(dB);
      purpose = visit.purpose;
      dest = dB.label;
    } else if (res.length && this.openings.size && Math.random() < OPENING_SHARE) {
      // a drive-thru's grand opening: half the town goes
      const [open] = [...this.openings.keys()];
      oB = pick(res); dB = open;
      o = this.anchor(oB);
      d = this.anchor(dB);
      purpose = 'getting drive-thru';
      dest = dB.label;
    } else if (res.length && jobs.length) {
      const home = pick(res);
      const other = morning || evening ? pick(jobs) : shops.length && Math.random() < 0.7 ? pick(shops) : pick(jobs);
      if (evening) { oB = other; dB = home; purpose = 'going home'; dest = home.label; }
      else { oB = home; dB = other; purpose = morning ? 'going to work' : Math.random() < 0.5 ? 'getting drive-thru' : 'shopping'; dest = other.label; }
      o = this.anchor(oB);
      d = this.anchor(dB);
    } else if (list.length >= 2) {
      oB = pick(list); dB = pick(list);
      if (oB === dB) return false;
      o = this.anchor(oB);
      d = this.anchor(dB);
    }
    if (!o || !d) return false;
    // codex:transit begin - mode choice applies only to local person trips
    if (local && oB && dB && kind !== 'semi' && kind !== 'boxTruck' && this.transitModeChoice?.(oB, dB)) return true;
    // codex:transit end
    return !!this.launch(o, d, oB, dB, kind, purpose, dest, local, hour);
  }

  /**
   * Send a specific vehicle between two buildings (or an outside connection).
   * Used by service systems (garbage trucks, fire trucks, buses, freight).
   * Returns null when there is no route or the vehicle cap is reached.
   */
  dispatch(kind: VehicleKind, from: TripEnd, to: TripEnd, purpose: string, dest: string, hour: number, opts: DispatchOpts = {}): Car | null {
    const edges = from === 'edge' || to === 'edge' ? this.edgeAnchors() : [];
    const end = (e: TripEnd) => e === 'edge' ? (edges.length ? edges[Math.floor(Math.random() * edges.length)] : null) : this.anchor(e);
    const o = end(from), d = end(to);
    if (!o || !d) return null;
    const car = this.launch(o, d, from === 'edge' ? null : from, to === 'edge' ? null : to, kind, purpose, dest, opts.local ?? true, hour, opts.sober);
    if (car && opts.onDone) car.onDone = opts.onDone;
    return car;
  }

  /** Outside connections (road ends at the map edge). */
  outsideConnections(): number {
    return this.edgeAnchors().length;
  }

  private launch(o: { seg: RSeg; s: number }, d: { seg: RSeg; s: number }, oB: Bld | null, dB: Bld | null, kind: VehicleKind, purpose: string, dest: string, local: boolean, hour: number, sober = false): Car | null {
    // three cars already waiting to get out of this lot: the next trip from here waits its turn
    if (oB && (this.lotCount.get(oB) ?? 0) >= LOT_QUEUE_MAX) return null;
    const rt = this.route(o.seg, o.s, d.seg, d.s);
    if (!rt) return null;
    {
      const st0 = rt.steps[0];
      const seg0 = this.net.segs.get(st0.seg)!;
      // (the cars on that road and way, indexed once a step: not a scan of every car per try)
      const near = this.onSegDir().get(st0.seg * 2 + (st0.dir > 0 ? 0 : 1)) ?? [];
      const busyAt = (s: number) => near.some((c) => !c.junction && c.crashed !== -1 && c.path[c.pi].seg === st0.seg && c.path[c.pi].dir === st0.dir && Math.abs(c.s - s) < 9);
      let ok = false;
      for (const off of [0, 12, -12, 24, -24]) {
        const s = rt.startS + off;
        if (s < 2 || s > seg0.length - 2 || (rt.steps.length === 1 && s >= rt.endS)) continue;
        if (!busyAt(s)) { rt.startS = s; ok = true; break; }
      }
      if (!ok && !oB) return null;
    }
    const spec = VEHICLE_SPECS[kind];
    // a trip happens whether or not the graphics preset has a free vehicle
    // to draw it: -1 = simulated but not drawn (set/remove ignore it)
    const h = this.renderer.add(kind, FIXED_PAINT[kind] ?? PAINT[Math.floor(Math.random() * PAINT.length)]);
    const night = hour > 21 || hour < 4;
    const drunk = !sober && Math.random() < (night ? DRUNK_NIGHT : DRUNK_DAY);
    const firstSeg = this.net.segs.get(rt.steps[0].seg)!;
    const car: Car = {
      id: this.nextId++, h, kind, path: rt.steps, pi: 0, s: rt.startS, startS: rt.startS, endS: rt.endS,
      lane: Math.floor(Math.random() * ROAD_TYPES[firstSeg.type].lanesPerDir), v: 4, v0mul: (0.9 + Math.random() * 0.25) * (drunk ? 1.25 : 1),
      // codex:policies begin -- a smoke-free endpoint disables the visible in-car smoking effect
      len: spec.length, drunk, reckless: drunk || (!sober && Math.random() < RECKLESS), smoker: !sober && (!oB || this.policySmokingAllowed?.(oB) !== false) && (!dB || this.policySmokingAllowed?.(dB) !== false) && Math.random() < 0.2, redsRun: 0, wob: Math.random() * 10,
      // codex:policies end
      junction: null, crashed: 0, crashYaw: 0, crashRoll: 0, x: 0, y: 0, z: 0, yaw: 0, purpose, dest,
      lat: NaN, latV: 0, ryaw: NaN, turn: 0, turnV: Infinity, turnFor: -1, laneCd: 2 + Math.random() * 3, brakeT: 0, acc: 0, roll: 0, dive: 0,
      driver: Math.floor(Math.random() * ARCHETYPES.length), smokeT: Math.random() * 2, bac: drunk ? 0.09 + Math.random() * 0.2 : 0,
      dep: 0, arr: -1, lotO: null, lotD: null, local,
    };
    // pull out of the origin lot / pull into the destination lot
    if (oB) {
      const st0 = rt.steps[0];
      // the building's own frontage, not where the lane entry slid to (±12-24 m
      // to miss another car): trucks pulled out of the empty lot next door
      car.lotO = this.lotPoint(oB, firstSeg, firstSeg.id === o.seg.id ? o.s : st0.dir > 0 ? rt.startS : firstSeg.length - rt.startS);
      car.dep = DEP_T;
      car.v = 0;
      car.fromB = oB;
      this.lotCount.set(oB, (this.lotCount.get(oB) ?? 0) + 1);
      // pull out into the nearest lane: the kerb lane from a lot on the right,
      // the inside lane after crossing the oncoming lanes from one on the left
      car.lotLeft = this.lotSide(firstSeg, st0.dir, rt.startS, car.lotO) > 0;
      car.lane = car.lotLeft ? 0 : ROAD_TYPES[firstSeg.type].lanesPerDir - 1;
    }
    // a car parked at the building backs out of its stall (drawn only: the trip is the same)
    if (oB && this.parking) {
      const p = this.parking.take(oB, kind);
      if (p) { if (car.h >= 0) this.renderer.remove(car.h); car.h = p.h; car.fromSpot = p.spot; }
    }
    if (dB) {
      car.destB = dB;
      // a drive-thru run (or any visit to a drive-thru-only kiosk) goes through the lane
      if (spec.length <= 6.05 && this.thruAt(dB) && (purpose === 'getting drive-thru' || !(dB.model.spots ?? []).some((p) => p.kind === 'stall')) && !/deliver|import|export|work/.test(purpose)) car.thruB = dB;
      const stN = rt.steps[rt.steps.length - 1];
      const lastSeg = this.net.segs.get(stN.seg)!;
      car.lotD = this.lotPoint(dB, lastSeg, lastSeg.id === d.seg.id ? d.s : stN.dir > 0 ? rt.endS : lastSeg.length - rt.endS);
    }
    this.cars.push(car);
    this.segDirIndex?.get(car.path[0].seg * 2 + (car.path[0].dir > 0 ? 0 : 1))?.push(car) ?? this.segDirIndex?.set(car.path[0].seg * 2 + (car.path[0].dir > 0 ? 0 : 1), [car]);
    this.totalTrips++;
    return car;
  }

  private dropCarsOn(segId: number) {
    for (const c of this.cars) {
      if (c.path.some((st, i) => i >= c.pi && st.seg === segId)) c.crashed = -1; // mark for removal
    }
  }

  // ------------------------------------------------------------------ update
  update(dtReal: number, simSpeed: number, hour: number, population: number, jobs: number, camTarget: THREE.Vector3) {
    this.pop = population;
    this.jobsNow = jobs;
    const total = dtReal * Math.max(0.0001, simSpeed);
    const steps = Math.min(8, Math.ceil(total / 0.08));
    for (let k = 0; k < steps; k++) this.step(dtReal / steps, simSpeed, hour, population, jobs, camTarget, k === steps - 1);
  }

  /** why blinkers are on (debug tallies) */
  sigWhy = { box: 0, lot: 0, lane: 0, queue: 0, approach: 0, off: 0 };
  /** sim seconds in the last step (drives the drawn easing) */
  private lastDt = 0.016;

  private step(dtReal: number, simSpeed: number, hour: number, population: number, jobs: number, camTarget: THREE.Vector3, last: boolean) {
    const dt = dtReal * Math.max(0.0001, simSpeed);
    this.lastDt = Math.max(dtReal, dt);
    this.stepN++;
    if (simSpeed > 0) for (const s of this.signals.values()) s.t += dt;

    // demand for trips: population & jobs, time of day, induced demand
    const tod = hour < 5 ? 0.25 : hour < 7 ? 0.6 : hour < 10 ? 1.35 : hour < 15.5 ? 0.9 : hour < 19.5 ? 1.4 : hour < 22 ? 0.8 : 0.45;
    const induced = 0.6 + 0.6 * this.flowEma;
    // a small town sees a small town's traffic: through-traffic from the
    // highway and trips per resident both ramp up to their city values
    // (reached at ~600 and ~1,500 people), so big cities are unchanged
    const edgeBoost = Math.min(3, this.edgeAnchors().length) * Math.max(3, 12 * Math.min(1, population / 600));
    const perPerson = 0.07 + 0.05 * Math.min(1, population / 1500);
    // codex:policies begin -- Free Parking, Ban Bikes, and 4-Day Week move actual trip volume
    // one traffic budget on every preset, so congestion (and what it does to
    // trips, freight and demand) doesn't depend on graphics settings
    this.targetCars = Math.min(SIM_MAX_CARS, Math.round((population * perPerson + jobs * 0.05 + edgeBoost) * tod * induced * this.policyTripMul));
    // codex:policies end
    this.segDirIndex = null;
    if (simSpeed > 0) {
      let spawns = 0;
      while (this.cars.length < this.targetCars && spawns < 12) {
        spawns++;
        this.spawnTrip(hour);
      }
      this.eventCrowds(dt, hour);
    }
    // (the index holds only while nothing moves: a trip launched later this step, or
    // between steps, indexes the cars afresh)
    this.segDirIndex = null;

    // buckets per seg/dir/lane
    this.buckets.clear();
    this.enteredAt.clear();
    this.junctionCars.clear();
    for (const s of this.net.segs.values()) s.load[0] = s.load[1] = 0;
    this.junctionTargets.clear();
    this.boxTail.clear();
    this.boxByExit.clear();
    for (const c of this.cars) {
      if (c.crashed === -1) continue;
      if (c.dep > 0 || c.arr >= 0 || c.thru) continue; // in a lot (or its drive-thru lane): not on the road
      if (c.junction) {
        let arr = this.junctionCars.get(c.junction.node);
        if (!arr) this.junctionCars.set(c.junction.node, (arr = []));
        arr.push(c);
        const nx = c.path[c.pi + 1];
        const ns = nx && this.net.segs.get(nx.seg);
        if (ns) {
          const k = nx.seg * 16 + (nx.dir > 0 ? 0 : 8) + c.junction.lane2;
          this.junctionTargets.set(k, (this.junctionTargets.get(k) ?? 0) + 1);
          let ex = this.boxByExit.get(k);
          if (!ex) this.boxByExit.set(k, (ex = []));
          ex.push(c);
        }
        const J = c.junction, tk = J.fromSeg * 16 + (J.fromDir > 0 ? 0 : 8) + J.fromLane, tail = this.boxTail.get(tk);
        if (!tail || this.pastLine(c) < this.pastLine(tail)) this.boxTail.set(tk, c);
        continue;
      }
      // out of the box, but a long vehicle's rear is still in it: the cars behind it
      // follow its rear
      const P = c.prevJ;
      if (P && c.prevEntryS !== undefined && c.s - c.prevEntryS < c.len) {
        const tk = P.fromSeg * 16 + (P.fromDir > 0 ? 0 : 8) + P.fromLane, tail = this.boxTail.get(tk);
        if (!tail || this.pastLine(c) < this.pastLine(tail)) this.boxTail.set(tk, c);
      }
      const st = c.path[c.pi];
      const key = st.seg * 16 + (st.dir > 0 ? 0 : 8) + c.lane;
      let arr = this.buckets.get(key);
      if (!arr) this.buckets.set(key, (arr = []));
      arr.push(c);
      const seg = this.net.segs.get(st.seg);
      if (seg) seg.load[st.dir > 0 ? 0 : 1]++;
    }
    for (const arr of this.buckets.values()) arr.sort((a, b) => a.s - b.s);
    this.mergeBlocks.clear();
    this.lotLead.clear();
    this.lotCount.clear();
    for (const c of this.cars) if (c.dep > 0 && c.fromB && c.crashed === 0) this.lotCount.set(c.fromB, (this.lotCount.get(c.fromB) ?? 0) + 1);
    for (const c of this.cars) {
      if (c.crashed !== 0 || c.junction) continue;
      if (c.dep > 0 && c.lotO) {
        const k = lotKey(c.lotO), o = this.lotLead.get(k);
        if (!o || c.dep < o.dep - 1e-6 || (Math.abs(c.dep - o.dep) <= 1e-6 && c.id < o.id)) this.lotLead.set(k, c);
      }
      // (the courtesy comes and goes: a driver the queue lets in who still can't go,
      // waiting on the far lanes, doesn't hold the queue for good)
      const pulling = c.dep > 0 && (c.committed || ((c.wait ?? 0) > COURTESY_T && (c.wait ?? 0) % COURTESY_CYCLE < COURTESY_T + COURTESY_HOLD));
      const parking = c.arr >= 0 && c.arr < ARR_T * 0.5;
      if (!pulling && !parking) continue;
      this.addMergeBlock(c, pulling && !c.committed);
    }

    let flowSum = 0, flowN = 0;
    const camX = camTarget.x, camZ = camTarget.z;
    for (const arr of this.buckets.values()) {
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (c.crashed !== 0) continue;
        const st = c.path[c.pi];
        const seg = this.net.segs.get(st.seg);
        if (!seg) { c.crashed = -1; continue; }
        const T = ROAD_TYPES[seg.type];
        const last = c.pi === c.path.length - 1;
        const exitS = last ? c.endS : this.exitOf(seg, st.dir);
        let v0 = T.speed * this.speedMul * c.v0mul * (c.drunk ? 0.9 + Math.sin(c.wob * 0.7) * 0.3 : 1);
        // ease off for the turn ahead: brake early and smoothly, not in the box
        if (!last) {
          this.planTurn(c);
          if (Number.isFinite(c.turnV)) v0 = Math.min(v0, Math.sqrt(c.turnV * c.turnV + 2 * 2.1 * Math.max(0, exitS - c.s - 1)));
        }
        // obstacles: leader, red light, blocked seg
        let gap = Infinity, dv = 0;
        const lead = arr[i + 1];
        if (lead) {
          gap = lead.s - c.s - lead.len;
          dv = c.v - lead.v;
        }
        // a car still moving over between my lane and the next (it counts as in the
        // lane it's going to, but half its body is in the one it left), or me
        // moving over past one: follow it too
        if (T.lanesPerDir > 1 && Number.isFinite(c.lat)) {
          for (const k2 of [c.lane - 1, c.lane + 1]) {
            if (k2 < 0 || k2 >= T.lanesPerDir) continue;
            for (const o of this.buckets.get(st.seg * 16 + (st.dir > 0 ? 0 : 8) + k2) ?? []) {
              if (o.s <= c.s || o.crashed !== 0 || o.dep > 0 || o.arr >= 0) continue;
              const g = o.s - o.len - c.s;
              if (g >= gap) break;
              if (Math.abs(o.lat - c.lat) < 2) { gap = g; dv = c.v - o.v; break; }
            }
          }
        }
        // the last car into the box from this lane is still ahead, crossing (or just
        // out of it, a long one's rear still in the box)
        if (!lead && !last) {
          const bt = this.boxTail.get(st.seg * 16 + (st.dir > 0 ? 0 : 8) + c.lane);
          if (bt) {
            const g = exitS - c.s + this.pastLine(bt) - bt.len;
            if (g < gap) { gap = g; dv = c.v - bt.v; }
          }
        }
        // someone from another lane already in the box on the way to the lane I'm
        // turning into (two lanes turning into one): follow them in, not beside them
        if (!last && exitS - c.s < 25) {
          const nodeId = st.dir > 0 ? seg.b : seg.a, nx = c.path[c.pi + 1], ns = nx && this.net.segs.get(nx.seg);
          const box = ns && this.junctionCars.get(nodeId);
          if (box && box.length) {
            const lanesN = ROAD_TYPES[ns.type].lanesPerDir;
            const lane2 = c.turn < 0 ? lanesN - 1 : c.turn > 0 ? 0 : Math.min(c.lane, lanesN - 1);
            for (const o of box) {
              const J = o.junction;
              if (!J || o.crashed !== 0 || J.lane2 !== lane2 || o.path[o.pi + 1]?.seg !== nx.seg || (J.fromSeg === seg.id && J.fromLane === c.lane)) continue;
              const g = exitS - c.s + this.pastLine(o) - o.len;
              if (g < gap) { gap = g; dv = c.v - o.v; }
            }
          }
        }
        // going through a drive-thru with its lane full: wait at the driveway, on the road
        // (the line spills onto the stroad and blocks this lane until there's room)
        if (last && c.thruB && !this.thruRoom(c.thruB)) {
          const g8 = exitS - 1 - c.s;
          if (g8 < gap) { gap = g8; dv = c.v; }
          if (exitS - c.s < 15 && c.v < 0.5) {
            c.thruWait = (c.thruWait ?? 0) + dt;
            if (c.thruWait > 8 && this.clock - (this.spilledAt.get(c.thruB) ?? -1e9) > 300) { this.spilledAt.set(c.thruB, this.clock); this.onDriveThruSpill?.(c.thruB, seg); }
          }
        }
        // someone on the crosswalk over my lanes, or over the lanes I'm turning into: stop at the line
        if (!last && this.crosswalkWalkers && exitS - c.s < 20) {
          const nodeId = st.dir > 0 ? seg.b : seg.a, nx = c.path[c.pi + 1], ns = nx && this.net.segs.get(nx.seg);
          if (this.walkerOnLanes(nodeId, seg, st.dir, true) || (ns && this.walkerOnLanes(nodeId, ns, nx.dir, false))) {
            const g7 = exitS - STOP_LINE - c.s;
            if (g7 < gap) { gap = g7; dv = c.v; this.yieldedTo(c, nodeId); }
          }
        }
        // turning left across the oncoming lanes on a green: wait at the line for a gap
        if (!last && c.turn > 0 && exitS - c.s < 25) {
          const nodeId = st.dir > 0 ? seg.b : seg.a;
          if (this.signals.has(nodeId) && !this.clearing(nodeId, seg.id) && this.oncoming(nodeId, seg.id)) {
            const g6 = exitS - STOP_LINE - c.s;
            if (g6 < gap) { gap = g6; dv = c.v; }
          }
        }
        // a car pulling out (or in) at a driveway ahead; a slow queue also lets a waiting driver in
        const mb = this.mergeBlocks.get(st.seg * 16 + (st.dir > 0 ? 0 : 8) + c.lane);
        if (mb) for (const b of mb) {
          if (b.s <= c.s) continue;
          // (a courteous car stops well back: the driver pulling out needs room behind it
          // too; one already too close, or not crawling, just carries on)
          const g = b.s - b.len - c.s - (b.courtesy ? 7 : 0);
          if (b.courtesy && (c.v > 5 || b.s - c.s > 25 || g < 0)) continue;
          if (g < gap) { gap = g; dv = c.v; }
        }
        if (!last && exitS - c.s < 30 && !this.exitClear(c)) {
          const g4 = exitS - STOP_LINE - c.s;
          if (g4 < gap) { gap = g4; dv = c.v; }
        }
        if (!last) {
          const nodeId = st.dir > 0 ? seg.b : seg.a;
          // (a left-turner that waited at the line for oncoming traffic goes as the light changes)
          const sneak = c.turn > 0 && exitS - c.s < 4 && !lead && this.clearing(nodeId, seg.id);
          if (!sneak && !this.isGreen(nodeId, seg.id)) {
            const runIt = c.reckless && Math.random() < 0.004;
            if (runIt) c.redsRun++;
            if (!(c.reckless && c.redsRun > 0 && exitS - c.s < 12)) {
              const g2 = exitS - STOP_LINE - c.s;
              if (g2 < gap) { gap = g2; dv = c.v; }
            }
          }
        }
        if (seg.blocked > 0) {
          const mid = seg.length / 2 - c.len;
          if (c.s < mid) { const g3 = mid - c.s; if (g3 < gap) { gap = g3; dv = c.v; } }
        }
        // no lights here: wait at the line while someone from another road is crossing near your entry
        if (!last && exitS - c.s < 22) {
          const nodeId = st.dir > 0 ? seg.b : seg.a;
          const inBox = !this.signals.has(nodeId) && this.junctionCars.get(nodeId);
          if (inBox && inBox.length) {
            // (an all-way stop: wait while anyone from another road, or another lane of
            // mine turning across me, is on a path that crosses or joins mine and hasn't
            // cleared it; parallel paths go together. Not for a rear still in the box
            // once its car is out: two trucks on a short block each waited for the
            // other's rear, for good)
            const others = inBox.filter((o) => o.crashed === 0 && o.junction && (o.junction.fromSeg !== seg.id || o.junction.fromLane !== c.lane));
            const nx = c.path[c.pi + 1], ns = nx && this.net.segs.get(nx.seg);
            let mine: V2[] | null = null;
            if (others.length && ns) { const K = this.curveFor(c, seg, st, ns, nx); mine = Traffic.curvePts(K.p0, K.c1, K.c2, K.p2); }
            // (a straight run through the box sweeps no wider than its path)
            const ta = this.endTangent(seg, st.dir, true), tb = ns ? this.endTangent(ns, nx.dir, false) : ta;
            const myBend = Math.abs(Math.atan2(ta.x * tb.z - ta.z * tb.x, ta.x * tb.x + ta.z * tb.z));
            if (mine && others.some((o) => this.crossesBox(mine!, o, o.junction!.fromSeg === seg.id || myBend < 0.5 ? 0 : c.len))) {
              const g5 = exitS - STOP_LINE - c.s;
              if (g5 < gap) { gap = g5; dv = c.v; }
            }
          }
        }
        // lanes: get over for the turn, or pass someone slow
        const lanes = T.lanesPerDir;
        c.laneCd -= dt;
        if (lanes > 1 && c.laneCd <= 0 && c.v > 1) {
          const toExit = exitS - c.s;
          let want = c.lane;
          if (!last && c.turn !== 0 && toExit < 140) want = c.turn > 0 ? 0 : lanes - 1;
          else if (lead && gap < 35 && lead.v < v0 * 0.75 && toExit > 50) {
            const side = c.lane === 0 ? 1 : c.lane === lanes - 1 ? -1 : Math.random() < 0.6 ? 1 : -1;
            if (this.laneGap(st, c.lane + side, c) > gap + 12) want = c.lane + side;
          }
          want = clamp(want, 0, lanes - 1);
          if (want !== c.lane) {
            const to = c.lane + Math.sign(want - c.lane);
            if (this.laneFree(st, to, c)) { c.lane = to; c.laneCd = 2.5 + Math.random() * 3; }
            else c.laneCd = 0.4;
          }
        }
        {
          const tl = laneOffset(T, Math.min(c.lane, lanes - 1));
          if (!Number.isFinite(c.lat)) c.lat = tl;
          // drift across at a pace that suits the speed (a crawl doesn't swerve)
          const rate = clamp(c.v * 0.26, 0.35, 2.4);
          const step = clamp(tl - c.lat, -rate * dt, rate * dt);
          c.latV = dt > 0 ? step / dt : 0;
          c.lat += step;
        }
        // IDM
        const a = 1.7, bdec = 2.8, Th = c.drunk ? 0.8 : 1.3, s0 = c.drunk ? 1.5 : 2.5;
        const sStar = s0 + Math.max(0, c.v * Th + (c.v * dv) / (2 * Math.sqrt(a * bdec)));
        let acc = a * (1 - Math.pow(c.v / Math.max(1, v0), 4) - (gap < Infinity ? Math.pow(sStar / Math.max(0.1, gap), 2) : 0));
        acc = clamp(acc, -12, a);
        c.brakeT = acc < -1.2 ? 0.6 : Math.max(0, c.brakeT - dt);
        c.acc = acc;
        c.v = Math.max(0, c.v + acc * dt);
        const move = Math.min(c.v * dt, Math.max(0, gap + 0.5));
        c.s += move;
        flowSum += c.v / Math.max(1, v0);
        flowN++;
        // rear-end + random crashes
        if (lead && gap < 0.2 && gap > -1 && dv > 6 && c.drunk && lead.crashed === 0) { this.crashCause.rear++; this.crash([c, lead], seg, c.drunk); }
        else {
          const p = CRASH_HAZARD * this.crashMul * (c.drunk ? 30 : 1) * (c.reckless ? 5 : 1) * (T.centerTurn ? 1.5 : 1) * (0.3 + c.v / 25) * dt;
          if (Math.random() < p) { this.crashCause.random++; this.crash(lead && lead.s - c.s < 12 ? [c, lead] : [c], seg, c.drunk); }
        }
        // smoking out the window
        if (c.smoker && Math.abs(c.x - camX) < 300 && Math.abs(c.z - camZ) < 300) {
          c.smokeT -= dtReal;
          if (c.smokeT < 0) { c.smokeT = 1.2 + Math.random() * 2; this.onEmit?.('cigarette', c.x, c.y + 1.4, c.z, 1); }
        }
        if (c.s >= exitS) {
          if (last) {
            const lane = c.thruB ? this.thruAt(c.thruB)?.filter((L) => L.q.length < L.slots.length).sort((a, b) => a.q.length - b.q.length)[0] : undefined;
            if (lane) {
              // into the drive-thru lane, to the back of the line
              lane.q.push(c);
              c.thru = { L: lane, serve: THRU_SERVE + Math.random() * THRU_SERVE_VAR, out: -1, x: c.x, z: c.z, yaw: Number.isFinite(c.ryaw) ? c.ryaw : c.yaw };
              c.v = 0; c.thruWait = 0;
            } else if (c.lotD) {
              // pull into the lot, then park (in a free stall or the driveway, where there is one)
              c.arr = 0; c.v = 0;
              if (this.parking && c.destB && !c.toSpot) c.toSpot = this.parking.claim(c.destB, c.kind);
            }
            else { c.arrived = true; c.crashed = -1; } // off the map via the highway
            continue;
          }
          this.enterJunction(c, seg, st);
        }
      }
    }
    // junction traversal
    for (const [nodeId, arr] of this.junctionCars) {
      for (const c of arr) {
        if (c.crashed !== 0) continue;
        const J = c.junction!;
        if (J.fresh) { J.fresh = false; continue; }
        const next = c.path[c.pi + 1];
        const nseg = next && this.net.segs.get(next.seg);
        if (!nseg) { c.crashed = -1; continue; }
        // spillback: wait if the entry of the next segment is full
        const key = nseg.id * 16 + (next.dir > 0 ? 0 : 8) + J.lane2;
        const q = this.buckets.get(key);
        const entryS = this.entryOf(nseg, next.dir);
        const entered = this.enteredAt.get(key);
        const frontS = Math.min(q && q.length ? q[0].s - q[0].len : Infinity, entered ?? Infinity);
        // follow whoever is ahead on the way to the same exit lane: already on it
        // (its rear), or in the box with less of its curve left (same curve, or
        // merging from another road); stop 2 m short, never inside anyone
        const rem = (1 - clamp(J.t, 0, 1)) * J.len;
        let gap = rem + (frontS - entryS);
        for (const o of this.boxByExit.get(key) ?? []) {
          if (o === c || o.crashed !== 0 || !o.junction) continue;
          const remO = (1 - clamp(o.junction.t, 0, 1)) * o.junction.len;
          if (remO < rem - 1e-3 || (Math.abs(remO - rem) <= 1e-3 && o.id < c.id)) gap = Math.min(gap, rem - remO - o.len);
        }
        // someone crossing the road I'm turning into: hold in the box short of their crosswalk
        if (J.t < 0.85 && this.walkerOnLanes(J.node, nseg, next.dir, false)) { this.yieldedTo(c, J.node); gap = Math.min(gap, Math.max(0, rem - 4)); }
        const blocked = gap < 2;
        const vFree = Number.isFinite(c.turnV) ? c.turnV : Math.min(13, ROAD_TYPES[nseg.type].speed);
        const vt = blocked ? 0 : Math.min(vFree, Math.sqrt(2 * 3 * (gap - 2)));
        c.v = Math.max(0, c.v + clamp(vt - c.v, -8 * dt, 2.2 * dt));
        J.t += Math.min(c.v * dt, Math.max(0, gap - 0.5)) / Math.max(1, J.len);
        // red-light runners get T-boned
        if (c.redsRun > 0) {
          for (const o of arr) {
            if (o === c || o.crashed !== 0 || o.junction?.fromSeg === J.fromSeg) continue;
            if (Math.hypot(o.x - c.x, o.z - c.z) < 3.5) { this.crashCause.junction++; this.crash([c, o], this.net.segs.get(J.fromSeg), c.drunk); break; }
          }
        }
        if (J.t >= 1) {
          if (frontS - entryS < 0.5) { J.t = 1; c.v = 0; continue; }
          c.junction = null;
          c.prevJ = J;
          c.prevEntryS = entryS;
          c.pi++;
          c.s = entryS;
          this.enteredAt.set(key, entryS - c.len);
          c.lane = J.lane2;
          c.lat = laneOffset(ROAD_TYPES[nseg.type], c.lane);
          c.latV = 0;
          c.redsRun = 0;
        }
      }
      void nodeId;
    }
    this.flowEma = lerp(this.flowEma, flowN ? flowSum / flowN : 1, Math.min(1, dt * 0.05));

    // drive-thrus: the line moves up, the window serves the car at it, served cars drive out
    this.clock += dt;
    for (const [b, t] of this.openings) { if (t - dt <= 0) this.openings.delete(b); else this.openings.set(b, t - dt); }
    for (const v of this.thruLanes.values()) {
      if (!v) continue;
      for (const L of v.lanes) {
        L.q = L.q.filter((c) => c.crashed === 0 && c.thru);
        const head = L.q[0];
        if (head && Math.hypot(head.thru!.x - L.slots[0].x, head.thru!.z - L.slots[0].z) < 0.3) {
          head.thru!.serve -= dt;
          if (head.thru!.serve <= 0) { head.thru!.out = 0; L.q.shift(); }
        }
        L.q.forEach((c, i) => this.thruMove(c, L.slots[Math.min(i, L.slots.length - 1)], dt));
      }
    }
    for (const c of this.cars) {
      const T = c.thru;
      if (!T || T.out < 0 || c.crashed !== 0) continue;
      if (T.out >= T.L.out.length) { c.arrived = true; c.crashed = -1; continue; } // served: out of the lot and gone
      if (this.thruMove(c, T.L.out[T.out], dt)) T.out++;
    }

    // cars pulling out of / into lots
    for (const c of this.cars) {
      if (c.crashed !== 0) continue;
      if (c.arr >= 0) {
        c.arr += dt;
        if (c.arr >= ARR_T) {
          c.arrived = true; c.crashed = -1; // parked: off the road
          if (c.destB?.zone === 'landmark') {
            const v = this.visits.get(c.destB) ?? [];
            v.push(this.clock);
            if (v.length > 400) v.splice(0, v.length - 400);
            this.visits.set(c.destB, v);
            // the event's crowd: each one drives home after it
            if (c.destB.landmark && c.purpose === LANDMARK_EVENTS[c.destB.landmark]?.purpose) this.crowdIn.set(c.destB, (this.crowdIn.get(c.destB) ?? 0) + 1);
          }
          if (c.toSpot && this.parking) { c.parked = this.parking.park(c.toSpot, c.h, c.kind); c.toSpot = null; }
        }
      } else if (c.dep > 0) {
        // pull up to the kerb, wait there for a real gap (stopped cars count), then
        // commit: the lane brakes for a committed car, so it never merges into anyone
        // one car at a time out of a driveway: the next waits a car-length back in the lot
        const first = c.lotO ? this.lotLead.get(lotKey(c.lotO)) : undefined;
        if (first && first !== c && c.dep - dt < first.dep + 1.1) { c.dep = Math.max(c.dep - dt, Math.min(DEP_T, first.dep + 1.1)); continue; }
        if (!c.committed && c.dep - dt <= KERB_T) {
          const st = c.path[c.pi];
          const seg = this.net.segs.get(st.seg);
          if (!seg) { c.crashed = -1; continue; }
          c.lane = Math.min(c.lane, ROAD_TYPES[seg.type].lanesPerDir - 1);
          if (!this.mergeClear(c, seg, st)) { c.dep = KERB_T; c.wait = (c.wait ?? 0) + dt; continue; }
          c.committed = true;
          this.addMergeBlock(c, false);
        }
        c.dep = Math.max(0, c.dep - dt);
        if (c.dep === 0) c.v = 2;
      }
    }
    // crashed cars count down, then clear
    for (const c of this.cars) if (c.crashed > 0) c.crashed = Math.max(0.0001, c.crashed - dt);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.crashed === -1 || (c.crashed > 0 && c.crashed <= 0.0001)) {
        if (c.toSpot) this.parking?.release(c.toSpot);
        if (!c.parked) this.renderer.remove(c.h);
        else (this.renderer as { setReversing?: (h: number, on: boolean) => void }).setReversing?.(c.h, false);
        c.onDone?.(c, !!c.arrived);
        this.cars[i] = this.cars[this.cars.length - 1];
        this.cars.pop();
      }
    }

    // jams
    for (const seg of this.net.segs.values()) {
      const cap = Math.max(1, (ROAD_TYPES[seg.type].lanesPerDir * seg.length) / 9);
      seg.vc = lerp(seg.vc, Math.max(seg.load[0], seg.load[1]) / cap, Math.min(1, dt * 0.2));
      if (seg.blocked > 0) seg.blocked = Math.max(0, seg.blocked - dt);
      if (seg.vc > 0.9) {
        const t = (this.jamTimer.get(seg.id) ?? 0) + dt;
        this.jamTimer.set(seg.id, t);
        if (t > 40) { this.jamTimer.set(seg.id, -200); this.onJam?.(seg); }
      } else if ((this.jamTimer.get(seg.id) ?? 0) > 0) this.jamTimer.set(seg.id, 0);
    }
    if (last) this.place(dtReal);
  }

  private addMergeBlock(c: Car, courtesy: boolean) {
    const st = c.path[c.pi];
    const key = st.seg * 16 + (st.dir > 0 ? 0 : 8) + c.lane;
    let arr = this.mergeBlocks.get(key);
    if (!arr) this.mergeBlocks.set(key, (arr = []));
    arr.push({ s: c.s, len: c.len, courtesy });
    // out of a lot across the road: the car crosses the oncoming lanes first, so
    // they brake for it (and let it out) too
    const seg = c.lotLeft && c.dep > 0 && this.net.segs.get(st.seg);
    if (seg) {
      const sOpp = seg.length - (c.s - c.len) + 1.5;
      for (let k = 0; k < ROAD_TYPES[seg.type].lanesPerDir; k++) {
        const ko = st.seg * 16 + (st.dir > 0 ? 8 : 0) + k;
        let o = this.mergeBlocks.get(ko);
        if (!o) this.mergeBlocks.set(ko, (o = []));
        o.push({ s: sOpp, len: c.len + 3, courtesy });
      }
    }
  }

  /**
   * Is there room to pull out at the driveway? Nobody (moving or queued) where
   * the car will be, nobody closing in faster than they could stop, no other
   * driver already pulling out there; from a lot across the road, no oncoming
   * car near the driveway either.
   */
  private mergeClear(c: Car, seg: RSeg, st: Step): boolean {
    const key = st.seg * 16 + (st.dir > 0 ? 0 : 8) + c.lane;
    const head = c.s + 3, tail = c.s - c.len - 2;
    for (const o of this.buckets.get(key) ?? []) {
      if (o.s > tail && o.s - o.len < head) return false; // in the way
      if (o.s <= tail && tail - o.s < 4 + o.v * 1.6) return false; // coming up behind
    }
    for (const b of this.mergeBlocks.get(key) ?? []) if (!b.courtesy && b.s > tail && b.s - b.len < head) return false;
    // cars about to leave the junction into this lane near the driveway
    const entryS = this.entryOf(seg, st.dir);
    if (tail < entryS + 10 && (this.junctionTargets.get(key) ?? 0) > 0) return false;
    // a driveway right by the junction ahead: nobody crossing the box close by
    // (a car turning out of the other lane sweeps over the end of this one)
    const exitS = this.exitOf(seg, st.dir);
    if (exitS - head < 8) {
      const nodeId = st.dir > 0 ? seg.b : seg.a, at = this.lanePos(seg, st.dir, c.s - c.len / 2, c.lane).p;
      for (const o of this.junctionCars.get(nodeId) ?? []) if (o.crashed === 0 && Math.hypot(o.x - at.x, o.z - at.z) < (o.len + c.len) / 2 + 1.5) return false;
    }
    if (c.lotLeft) {
      const lanes = ROAD_TYPES[seg.type].lanesPerDir, sOpp = seg.length - c.s;
      for (let k = 0; k < lanes; k++) {
        for (const o of this.buckets.get(st.seg * 16 + (st.dir > 0 ? 8 : 0) + k) ?? []) {
          if (o.s + 2 > sOpp - c.len && o.s - o.len - 2 < sOpp) return false;
          if (o.s <= sOpp - c.len && sOpp - o.s < 8 + o.v * 2.5) return false;
        }
      }
    }
    return true;
  }

  private enterJunction(c: Car, seg: RSeg, st: Step) {
    const next = c.path[c.pi + 1];
    const nseg = this.net.segs.get(next.seg);
    if (!nseg) { c.crashed = -1; return; }
    const nodeId = st.dir > 0 ? seg.b : seg.a;
    this.planTurn(c);
    // the curve starts at the line, and the car carries on from however far it
    // overshot it this step (started where the car was, a straight join with no
    // box ran a fraction of a metre backwards, and the heading flipped)
    const exitS = this.exitOf(seg, st.dir), over = Math.max(0, c.s - exitS);
    const K = this.curveFor(c, seg, st, nseg, next);
    // arc length table so the car crosses at an even speed
    const lut = [0];
    let px = K.p0.x, pz = K.p0.z, L = 0;
    for (let i = 1; i <= 10; i++) {
      const q = cubicAt(K.p0, K.c1, K.c2, K.p2, i / 10);
      L += Math.hypot(q.x - px, q.z - pz);
      lut.push(L);
      px = q.x; pz = q.z;
    }
    for (let i = 1; i <= 10; i++) lut[i] /= Math.max(1e-6, L);
    // a join that makes no headway (lanes far from the centreline at a slight
    // bend: the next lane can start a little behind this one) is a sideways
    // blend of a few centimetres, not a curve that doubles back
    if (K.d < 1.5 && (K.p2.x - K.p0.x) * K.t1.x + (K.p2.z - K.p0.z) * K.t1.z < 0.5) L = 0;
    c.junction = { t: Math.min(1, over / Math.max(2, L)), len: Math.max(2, L), arc: L, p0: K.p0, c1: K.c1, c2: K.c2, p2: K.p2, t1: K.t1, t2: K.t2, lut, y0: K.y0, y1: K.y1, node: nodeId, fromSeg: seg.id, lane2: K.lane2, fromDir: st.dir, fromLane: c.lane, fresh: true };
    // (visible to everyone else this step: two cars can't both take an empty box at once)
    let inBox = this.junctionCars.get(nodeId);
    if (!inBox) this.junctionCars.set(nodeId, (inBox = []));
    inBox.push(c);
  }

  /** The curve a car at the end of this step takes across the junction: from its lane at the line to the lane it joins (right turns land in the kerb lane, left in the inside lane). */
  private curveFor(c: Car, seg: RSeg, st: Step, nseg: RSeg, next: Step) {
    const f0 = this.frameAt(seg, st.dir, this.exitOf(seg, st.dir));
    const lat = Number.isFinite(c.lat) ? c.lat : laneOffset(ROAD_TYPES[seg.type], c.lane);
    const p0 = { x: f0.x + f0.r.x * lat, z: f0.z + f0.r.z * lat };
    const lanesN = ROAD_TYPES[nseg.type].lanesPerDir;
    const lane2 = c.turn < 0 ? lanesN - 1 : c.turn > 0 ? 0 : Math.min(c.lane, lanesN - 1);
    const P2 = this.lanePos(nseg, next.dir, this.entryOf(nseg, next.dir), lane2);
    const t1 = f0.t, t2 = P2.t, p2 = P2.p;
    const d = Math.hypot(p2.x - p0.x, p2.z - p0.z), k = d * 0.42;
    const c1 = { x: p0.x + t1.x * k, z: p0.z + t1.z * k };
    const c2 = { x: p2.x - t2.x * k, z: p2.z - t2.z * k };
    return { p0, c1, c2, p2, t1, t2, d, lane2, y0: f0.y, y1: P2.y };
  }

  private static curvePts(p0: V2, c1: V2, c2: V2, p2: V2): V2[] {
    const out: V2[] = [];
    for (let i = 0; i <= 20; i++) out.push(cubicAt(p0, c1, c2, p2, i / 20));
    return out;
  }

  /**
   * Would a car on path `mine` hit `o`, already crossing the box? Only the part
   * of o's curve it hasn't cleared yet counts (its body reaches len behind its
   * front); paths closer than a car's width conflict. Parallel paths (straight
   * on from opposite roads, right turns) don't.
   */
  /** Does path `mine` come near car `o`'s path through the box, from its rear on? `myLen` 0: side by side from one road (no allowance for long bodies). */
  private crossesBox(mine: V2[], o: Car, myLen = 5): boolean {
    const J = o.junction ?? o.prevJ;
    if (!J) return false;
    const pts = (J.pts ??= Traffic.curvePts(J.p0, J.c1, J.c2, J.p2));
    const from = clamp((this.pastLine(o) - o.len) / Math.max(1, J.len), 0, 1);
    // (a long body cuts inside its path in the middle of a turn: a semi's by a metre
    // or two; at the ends of the curves, where the bodies are straight, it doesn't)
    const n = pts.length - 1, mid = (k: number) => k > n * 0.2 && k < n * 0.8;
    const oBend = Math.abs(Math.atan2(J.t1.x * J.t2.z - J.t1.z * J.t2.x, J.t1.x * J.t2.x + J.t1.z * J.t2.z));
    const extraO = o.junction && oBend > 0.5 ? 0.15 * Math.max(0, o.len - 5) : 0, extraMe = 0.15 * Math.max(0, myLen - 5);
    for (let j = Math.floor(from * n); j <= n; j++) {
      for (let i = 0; i < mine.length; i++) {
        const reach = 2.6 + (mid(j) ? extraO : 0) + (mid(i) ? extraMe : 0);
        if ((mine[i].x - pts[j].x) ** 2 + (mine[i].z - pts[j].z) ** 2 < reach * reach) return true;
      }
    }
    return false;
  }

  /** How far a car in a junction box, or just out of it, has come past the line it crossed into the box at. */
  private pastLine(o: Car): number {
    if (o.junction) return clamp(o.junction.t, 0, 1) * o.junction.len;
    if (o.prevJ) return o.prevJ.len + o.s - (o.prevEntryS ?? 0);
    return 0;
  }

  /** Travel-direction tangent at the far end (exit) or near end (entry) of a step. */
  private endTangent(seg: RSeg, dir: 1 | -1, exit: boolean): V2 {
    const P = seg.samp.pts, n = P.length;
    const atB = exit ? dir > 0 : dir < 0;
    const a = atB ? P[Math.max(0, n - 3)] : P[0], b = atB ? P[n - 1] : P[Math.min(n - 1, 2)];
    const t = norm(sub(b, a));
    return dir > 0 ? t : { x: -t.x, z: -t.z };
  }

  /**
   * The turn at the end of the car's current step and the speed to take it
   * at: full speed through a bend in the road, 13 m/s straight over a
   * crossroads, down to walking pace for a hairpin.
   */
  private planTurn(c: Car) {
    if (c.turnFor === c.pi) return;
    c.turnFor = c.pi;
    c.turn = 0;
    c.turnV = Infinity;
    const st = c.path[c.pi], nx = c.path[c.pi + 1];
    if (!nx) return;
    const seg = this.net.segs.get(st.seg), ns = this.net.segs.get(nx.seg);
    if (!seg || !ns) return;
    const t1 = this.endTangent(seg, st.dir, true), t2 = this.endTangent(ns, nx.dir, false);
    const ang = Math.abs(Math.atan2(t1.x * t2.z - t1.z * t2.x, t1.x * t2.x + t1.z * t2.z));
    // lanes sit to the right, (-t.z, t.x): heading that way is a right turn
    const right = t2.x * -t1.z + t2.z * t1.x > 0;
    const node = this.net.nodes.get(st.dir > 0 ? seg.b : seg.a);
    const through = (node?.segs.length ?? 0) <= 2;
    const vNext = ROAD_TYPES[ns.type].speed * this.speedMul;
    if (ang < 0.35) { c.turnV = through ? vNext : Math.min(vNext, 13); return; }
    c.turn = through ? 0 : right ? -1 : 1;
    c.turnV = lerp(through ? 12 : 8.5, right ? 4.2 : 5.2, clamp(ang / (Math.PI / 2), 0, 1));
  }

  /**
   * Oncoming traffic for a left turn at a signal: someone from a road on the
   * same green (not turning left themselves) crossing the box, or coming up
   * to the line fast enough to be in the way.
   */
  private oncoming(nodeId: number, fromSeg: number): boolean {
    const sig = this.signals.get(nodeId);
    const node = this.net.nodes.get(nodeId);
    if (!sig || !node) return false;
    const ph = sig.phaseOf.get(fromSeg);
    for (const o of this.junctionCars.get(nodeId) ?? []) {
      const J = o.junction;
      if (!J || o.crashed !== 0 || J.fromSeg === fromSeg || J.t > 0.75) continue;
      if (sig.phaseOf.get(J.fromSeg) === ph && o.turn <= 0) return true;
    }
    for (const sid of node.segs) {
      if (sid === fromSeg || sig.phaseOf.get(sid) !== ph) continue;
      const sg = this.net.segs.get(sid);
      if (!sg) continue;
      const dir: 1 | -1 = sg.b === nodeId ? 1 : -1; // travelling toward this node
      const exitS = this.exitOf(sg, dir);
      for (let k = 0; k < ROAD_TYPES[sg.type].lanesPerDir; k++) {
        for (const o of this.buckets.get(sid * 16 + (dir > 0 ? 0 : 8) + k) ?? []) {
          if (o.crashed !== 0 || o.v < 1.5 || o.turn > 0) continue;
          if (exitS - o.s < o.v * 2.5 + 6) return true;
        }
      }
    }
    return false;
  }

  /**
   * May someone on foot start across these arms of a junction, taking `secs` to
   * cross? At lights, only in the walk phase: while the arm is red, and early
   * enough to be over before its green (or right as the walk starts, for a road
   * too wide to cross in one red). Without lights, not while a car is coming up
   * to the junction on the arm, unless they've waited long enough to step out
   * anyway (`impatient`). Never while a car is in the box turning into or out
   * of the arm.
   */
  canCross(nodeId: number, segs: number[], secs = 0, impatient = false): boolean {
    const sig = this.signals.get(nodeId);
    for (const sid of segs) {
      if (sig) {
        if (this.isGreen(nodeId, sid) || this.clearing(nodeId, sid)) return false;
        const T = (GREEN + CLEAR) * sig.phases, t = sig.t % T, start = (sig.phaseOf.get(sid) ?? 0) * (GREEN + CLEAR);
        const redLeft = (((start - t) % T) + T) % T, window = T - GREEN - CLEAR;
        if (redLeft < Math.min(secs, window) - 1) return false;
      }
      const sg = this.net.segs.get(sid);
      if (!sg) continue;
      const dir: 1 | -1 = sg.b === nodeId ? 1 : -1; // travelling toward this node
      const exitS = this.exitOf(sg, dir), entryS = this.entryOf(sg, -dir as 1 | -1);
      // a car standing on the crosswalk (queued up to the box, or just out of it), whatever the light
      for (let k = 0; k < ROAD_TYPES[sg.type].lanesPerDir; k++) {
        for (const o of this.buckets.get(sid * 16 + (dir > 0 ? 0 : 8) + k) ?? []) if (o.s > exitS - 2 && o.s - o.len < exitS + 5) return false;
        for (const o of this.buckets.get(sid * 16 + (dir > 0 ? 8 : 0) + k) ?? []) if (o.s - o.len < entryS + 4 && o.s > entryS - 5) return false;
      }
      if (!sig && !impatient) for (let k = 0; k < ROAD_TYPES[sg.type].lanesPerDir; k++) {
        for (const o of this.buckets.get(sid * 16 + (dir > 0 ? 0 : 8) + k) ?? []) {
          if (o.crashed === 0 && o.v > 1.5 && exitS - o.s < 25 && exitS - o.s > -2) return false;
        }
      }
      for (const o of this.junctionCars.get(nodeId) ?? []) {
        const J = o.junction;
        if (!J || o.crashed !== 0) continue;
        // coming out of that arm until its rear is clear of the crosswalk, or going into it at all
        if ((J.fromSeg === sid && clamp(J.t, 0, 1) * J.len < o.len + 3) || o.path[o.pi + 1]?.seg === sid) return false;
      }
    }
    return true;
  }

  /**
   * Is someone on this arm's crosswalk on the lanes a car travelling `dir` along
   * it uses (`toward` the junction: the lanes coming in; else the ones going
   * out), or about to step onto them? Someone on the far half, or walking away
   * from these lanes, doesn't hold the car.
   */
  private walkerOnLanes(nodeId: number, sg: RSeg, dir: 1 | -1, toward: boolean): boolean {
    const ws = this.crosswalkWalkers?.(nodeId, sg.id);
    if (!ws || !ws.length) return false;
    const T = ROAD_TYPES[sg.type];
    const L = this.lanePos(sg, dir, toward ? this.exitOf(sg, dir) : this.entryOf(sg, dir), 0);
    const r = { x: -L.t.z, z: L.t.x }, off0 = laneOffset(T, 0);
    const cx = L.p.x - r.x * off0, cz = L.p.z - r.z * off0;
    // my lanes run from `lo` to `hi` metres right of the centreline (a one-way: all of it)
    const hi = carriageHalf(T), lo = T.oneWay ? -hi : off0 - T.laneW / 2;
    for (const w of ws) {
      const lat = (w.x - cx) * r.x + (w.z - cz) * r.z, head = w.dx * r.x + w.dz * r.z;
      if (lat > lo - 0.5 && lat < hi + 0.5) return true;
      if ((lat <= lo - 0.5 && lat > lo - 4.5 && head > 0.2) || (lat >= hi + 0.5 && lat < hi + 4.5 && head < -0.2)) return true;
    }
    return false;
  }

  /** Room to move into lane `to` of this step beside the car? */
  private laneFree(st: Step, to: number, c: Car): boolean {
    const key = st.seg * 16 + (st.dir > 0 ? 0 : 8) + to;
    // a car pulling out of a driveway into that lane counts as being in it
    for (const b of this.mergeBlocks.get(key) ?? []) if (!b.courtesy && b.s + 7 > c.s - c.len && b.s - b.len - 7 < c.s) return false;
    const q = this.buckets.get(key);
    if (!q) return true;
    for (const o of q) {
      if (o === c) continue;
      if (o.s >= c.s) { if (o.s - o.len - c.s < 7 + Math.max(0, c.v - o.v) * 1.2) return false; }
      else if (c.s - c.len - o.s < 5 + Math.max(0, o.v - c.v) * 1.5) return false;
    }
    return true;
  }

  /** How far the nearest car ahead in lane `to` is (Infinity = open road). */
  private laneGap(st: Step, to: number, c: Car): number {
    const q = this.buckets.get(st.seg * 16 + (st.dir > 0 ? 0 : 8) + to);
    let g = Infinity;
    if (q) for (const o of q) if (o !== c && o.s > c.s) g = Math.min(g, o.s - o.len - c.s);
    return g;
  }

  /** Centreline point, travel tangent, right vector and height at travel distance s. */
  private frameAt(seg: RSeg, dir: 1 | -1, s: number) {
    const arc = dir > 0 ? s : seg.length - s;
    const { i, f } = locate(seg.samp, clamp(arc, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tt = sampleTangent(seg, i);
    const t = { x: tt.x * dir, z: tt.z * dir };
    return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), t, r: { x: -t.z, z: t.x }, y: lerp(seg.hs[i], seg.hs[i + 1], f) };
  }

  /** World position of a lane at travel distance s. */
  lanePos(seg: RSeg, dir: 1 | -1, s: number, lane: number) {
    const arc = dir > 0 ? s : seg.length - s;
    const { i, f } = locate(seg.samp, clamp(arc, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tt = sampleTangent(seg, i);
    const t = { x: tt.x * dir, z: tt.z * dir };
    const r = { x: -t.z, z: t.x };
    const off = laneOffset(ROAD_TYPES[seg.type], lane);
    const y = lerp(seg.hs[i], seg.hs[i + 1], f);
    return { p: { x: lerp(a.x, b.x, f) + r.x * off, z: lerp(a.z, b.z, f) + r.z * off }, t, y };
  }

  /** A point on a junction curve at share f of its length. */
  private curvePoint(J: JunctionCurve, f: number): PathPoint {
    f = clamp(f, 0, 1);
    if (!(J.arc > 0.05)) return { x: lerp(J.p0.x, J.p2.x, f), z: lerp(J.p0.z, J.p2.z, f), y: lerp(J.y0, J.y1, f), tx: lerp(J.t1.x, J.t2.x, f), tz: lerp(J.t1.z, J.t2.z, f) };
    let i = 1;
    while (i < 10 && J.lut[i] < f) i++;
    const u = (i - 1 + (f - J.lut[i - 1]) / Math.max(1e-6, J.lut[i] - J.lut[i - 1])) / 10;
    const q = cubicAt(J.p0, J.c1, J.c2, J.p2, u), d = cubicTan(J.p0, J.c1, J.c2, J.p2, u), dl = Math.hypot(d.x, d.z);
    return { x: q.x, z: q.z, y: lerp(J.y0, J.y1, f), tx: dl > 1e-6 ? d.x / dl : J.t1.x, tz: dl > 1e-6 ? d.z / dl : J.t1.z };
  }

  /**
   * Where the car's path is `back` metres behind its front bumper: on its lane,
   * along the junction curve it is crossing (and straight back onto the
   * approach before it), or along the curve it just left.
   */
  private pathPoint(c: Car, back: number): PathPoint {
    const J = c.junction;
    // (along the curve's real length: a bend in the road with no box has none)
    if (J) {
      const along = clamp(J.t, 0, 1) * J.arc - back;
      if (along >= 0) return this.curvePoint(J, J.arc > 0.05 ? along / J.arc : 1);
      return { x: J.p0.x + J.t1.x * along, z: J.p0.z + J.t1.z * along, y: J.y0, tx: J.t1.x, tz: J.t1.z };
    }
    const st = c.path[c.pi];
    const seg = this.net.segs.get(st.seg)!;
    const s = c.s - back, P = c.prevJ;
    if (P && c.prevEntryS !== undefined && s < c.prevEntryS) {
      const along = P.arc - (c.prevEntryS - s);
      if (along >= 0) return this.curvePoint(P, P.arc > 0.05 ? along / P.arc : 1);
      return { x: P.p0.x + P.t1.x * along, z: P.p0.z + P.t1.z * along, y: P.y0, tx: P.t1.x, tz: P.t1.z };
    }
    if (!Number.isFinite(c.lat)) c.lat = laneOffset(ROAD_TYPES[seg.type], c.lane);
    const F = this.frameAt(seg, st.dir, s);
    return { x: F.x + F.r.x * c.lat, z: F.z + F.r.z * c.lat, y: F.y, tx: F.t.x, tz: F.t.z };
  }

  private place(dtReal: number) {
    const R = this.renderer;
    const ease = 1 - Math.exp(-this.lastDt * 14);
    for (const c of this.cars) {
      if (c.crashed === -1) continue;
      if (c.thru) {
        // in a drive-thru lane: where the line has it, on the lot
        const T = c.thru, gy = this.groundAt ? this.groundAt(T.x, T.z) + 0.1 : T.L.b.y;
        c.x = T.x; c.y = gy; c.z = T.z; c.ryaw = T.yaw; c.yaw = T.yaw;
        R.set(c.h, T.x, gy, T.z, T.yaw);
        R.setBraking(c.h, c.v < 0.5);
        R.setTurn(c.h, 0);
        continue;
      }
      c.wob += dtReal * (c.drunk ? 1.6 : 0);
      const D = c.drawn;
      if (D && D.s === c.s && D.pi === c.pi && D.lane === c.lane && D.dep === c.dep && D.arr === c.arr && D.j === c.junction && D.turn === c.turn && c.crashed === 0 && !c.drunk && c.latV === 0 && c.v === 0) {
        if (++D.still >= STILL_FRAMES) { this.sigWhy[D.why]++; continue; }
      } else if (D) { D.s = c.s; D.pi = c.pi; D.lane = c.lane; D.dep = c.dep; D.arr = c.arr; D.j = c.junction; D.turn = c.turn; D.still = 0; }
      else c.drawn = { s: c.s, pi: c.pi, lane: c.lane, dep: c.dep, arr: c.arr, j: c.junction, turn: c.turn, still: 0, why: 'off' };
      let x: number, y: number, z: number, yaw: number, pitch = 0;
      let signal = 0;
      // the sim's s is the front bumper: draw the body from where its front and
      // rear wheels are along the path (lane, junction curve, or the curve just
      // left), so a long truck behind a short car is drawn behind it, and the
      // heading turns smoothly as the car moves onto and off a curve
      const len = c.len, fA = this.pathPoint(c, len * 0.14), rA = this.pathPoint(c, len * 0.86);
      x = (fA.x + rA.x) / 2;
      z = (fA.z + rA.z) / 2;
      y = (fA.y + rA.y) / 2 + 0.12;
      // heading from the road's direction at both axles (not the line between them:
      // a lane on the inside of a very tight bend folds, and its points bunch up)
      let hx = fA.tx + rA.tx, hz = fA.tz + rA.tz;
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-3) { hx /= hl; hz /= hl; } else { hx = fA.tx; hz = fA.tz; }
      pitch = -Math.atan2(fA.y - rA.y, Math.max(0.5, len * 0.72));
      if (c.junction) {
        yaw = Math.atan2(hx, hz);
        signal = c.turn;
      } else {
        const st = c.path[c.pi];
        const seg = this.net.segs.get(st.seg);
        if (!seg) continue;
        // lean the nose into a lane change
        const v = Math.max(3, c.v);
        yaw = Math.atan2(hx * v - hz * c.latV, hz * v + hx * c.latV);
        if (c.drunk && c.crashed === 0) {
          const w = Math.sin(c.wob) * 1.1;
          x += -hz * w;
          z += hx * w;
          yaw += Math.cos(c.wob) * 0.12;
        }
        const lastStep = c.pi === c.path.length - 1;
        const exitS = lastStep ? c.endS : this.exitOf(seg, st.dir);
        if (!lastStep && exitS - c.s < 32) signal = c.turn;
        else if (Math.abs(c.latV) > 0.2) signal = c.latV > 0 ? -1 : 1;
        else if (lastStep && c.lotD && exitS - c.s < 22) signal = this.lotSide(seg, st.dir, c.s, c.lotD);
        if (c.prevJ && c.s - (c.prevEntryS ?? 0) > len) c.prevJ = null; // the rear has cleared the junction
      }
      // driveway: an arc between the lot and the lane, nose first both ways
      // (live parking: from a stall the car backs out first, then drives off; into
      // one it drives in nose first and ends square in it)
      const spot = c.dep > 0 ? c.fromSpot : c.arr >= 0 ? c.toSpot : null;
      const lot = spot ?? (c.dep > 0 ? c.lotO : c.arr >= 0 ? c.lotD : null);
      let reversing = false;
      if (lot && !c.junction) {
        const m = c.dep > 0 ? 1 - c.dep / DEP_T : 1 - c.arr / ARR_T; // 0 = in the lot, 1 = on the lane
        const laneY = y, lanePitch = pitch;
        const tx = Math.sin(yaw), tz = Math.cos(yaw);
        const out = c.dep > 0;
        // backing out of a stall: the first part of the pull-out, swinging the nose round
        const hx = spot ? Math.sin(spot.yaw) : 0, hz = spot ? Math.cos(spot.yaw) : 0;
        const back = spot && out ? { x: spot.x - hx * 4.5, z: spot.z - hz * 4.5 } : null;
        const BACK = 0.4;
        let e: number;
        if (back && m < BACK) {
          const u = smooth01(m / BACK);
          const toLane = Math.atan2(x - back.x, z - back.z);
          // reversing on an arc: straight back out of the stall, the tail swinging away from the way out
          const side = Math.sin(toLane - spot!.yaw) > 0 ? -1 : 1;
          x = lerp(spot!.x, back.x, u) + Math.cos(spot!.yaw) * side * 1.2 * u * u;
          z = lerp(spot!.z, back.z, u) - Math.sin(spot!.yaw) * side * 1.2 * u * u;
          yaw = angLerp(spot!.yaw, toLane, u * u);
          e = 0;
          reversing = true;
        } else {
          const mm = back ? (m - BACK) / (1 - BACK) : m;
          e = mm * mm * (3 - 2 * mm);
          const P0 = back ?? lot;
          const d = Math.max(2, Math.hypot(x - P0.x, z - P0.z));
          const toRoad = { x: (x - P0.x) / d, z: (z - P0.z) / d };
          const P3 = { x, z };
          // into a stall: arrive facing the way it faces
          const P1 = spot && !out ? { x: spot.x - hx * d * 0.45, z: spot.z - hz * d * 0.45 } : { x: P0.x + toRoad.x * d * 0.45, z: P0.z + toRoad.z * d * 0.45 };
          const P2 = { x: x - (out ? 1 : -1) * tx * d * 0.55, z: z - (out ? 1 : -1) * tz * d * 0.55 };
          const q = cubicAt(P0, P1, P2, P3, e), dq = cubicTan(P0, P1, P2, P3, e);
          x = q.x;
          z = q.z;
          if (Math.hypot(dq.x, dq.z) > 1e-4) yaw = out ? Math.atan2(dq.x, dq.z) : Math.atan2(-dq.x, -dq.z);
        }
        if (out && (c.committed || c.dep <= KERB_T + 0.05)) {
          // pulling out (at the kerb or going): blink toward the way the lane runs;
          // cars queued behind in the lot haven't reached the road yet
          const k = tx * -Math.cos(yaw) + tz * Math.sin(yaw);
          signal = k > 0.05 ? -1 : k < -0.05 ? 1 : 0;
        }
        // sit on the ground between road and lot, nose and tail on the slope
        // (held level, a long truck on a hillside had one end buried and the other in the air)
        if (this.groundAt) {
          const half = c.len / 2, fx = Math.sin(yaw), fz = Math.cos(yaw);
          const gF = this.groundAt(x + fx * half, z + fz * half), gB = this.groundAt(x - fx * half, z - fz * half);
          y = lerp((gF + gB) / 2 + 0.1, laneY, e);
          pitch = lerp(-Math.atan2(gF - gB, c.len), lanePitch, e);
        } else pitch = lerp(0, lanePitch, e);
      }
      // the drawn heading eases (the junction and lane seams used to snap it)
      const prevYaw = c.ryaw;
      if (!Number.isFinite(c.ryaw) || c.crashed > 0) c.ryaw = yaw;
      else c.ryaw = angLerp(c.ryaw, yaw, ease);
      // body motion: lean out of the turn, dip the nose when braking (springy, not rigid)
      if (Number.isFinite(prevYaw) && this.lastDt > 0) {
        let dy = c.ryaw - prevYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy)) / this.lastDt;
        c.roll = lerp(c.roll, clamp(dy * c.v * 0.011, -0.075, 0.075), ease * 0.6);
        c.dive = lerp(c.dive, clamp(-c.acc * 0.009, -0.03, 0.045), ease * 0.6);
      }
      c.x = x; c.y = y; c.z = z; c.yaw = c.ryaw;
      if (c.crashed > 0) R.set(c.h, x, y, z, yaw + c.crashYaw, pitch, c.crashRoll);
      else R.set(c.h, x, y, z, c.ryaw, pitch + c.dive, c.roll);
      R.setBraking(c.h, c.v < 3 || (c.crashed === 0 && c.v > 3 && c.brakeT > 0));
      R.setTurn(c.h, c.crashed > 0 ? 0 : signal);
      const why = signal ? (c.junction ? 'box' : lot ? 'lot' : Math.abs(c.latV) > 0.2 ? 'lane' : c.v < 1 ? 'queue' : 'approach') : 'off';
      this.sigWhy[why]++;
      c.drawn!.why = why;
      R.setDamaged(c.h, c.crashed > 0); // AA vehicle shader darkens crumpled cars until cleanup.
      if (c.fromSpot) (R as { setReversing?: (h: number, on: boolean) => void }).setReversing?.(c.h, reversing);
    }
    R.flush();
  }

  /** Which side of the lane a lot is on: -1 right, 1 left (the blinker for pulling in). */
  private lotSide(seg: RSeg, dir: 1 | -1, s: number, lot: V2): number {
    const F = this.frameAt(seg, dir, s);
    return (lot.x - F.x) * F.r.x + (lot.z - F.z) * F.r.z > 0 ? -1 : 1;
  }

  crash(cars: Car[], seg: RSeg | undefined, drunk: boolean) {
    for (const c of cars) {
      if (c.crashed !== 0) continue;
      c.crashed = 16 + Math.random() * 12;
      c.crashYaw = (Math.random() - 0.5) * 1.6;
      c.crashRoll = Math.random() < 0.15 ? Math.PI : Math.random() < 0.3 ? (Math.random() - 0.5) * 1.2 : 0;
      c.v = 0;
      this.onEmit?.('spark', c.x, c.y + 0.8, c.z, 12);
      this.onEmit?.('smoke', c.x, c.y + 1.2, c.z, 10);
      if (Math.random() < 0.2) this.onEmit?.('fire', c.x, c.y + 1, c.z, 12);
    }
    if (seg) seg.blocked = Math.max(seg.blocked, 8);
    this.crashes++;
    this.onCrash?.(cars, seg, drunk);
  }

  /** Debug: why are cars stopped? */
  stats() {
    const out = { total: this.cars.length, moving: 0, stopped: 0, junctionWait: 0, crashed: 0, atRed: 0, blockedSeg: 0, byCause: this.crashCause };
    for (const c of this.cars) {
      if (c.crashed > 0) { out.crashed++; continue; }
      if (c.junction) { if (c.v < 0.5) out.junctionWait++; continue; }
      if (c.v > 0.5) { out.moving++; continue; }
      out.stopped++;
      const st = c.path[c.pi];
      const seg = this.net.segs.get(st.seg);
      if (!seg) continue;
      if (seg.blocked > 0) out.blockedSeg++;
      const nodeId = st.dir > 0 ? seg.b : seg.a;
      if (c.pi < c.path.length - 1 && !this.isGreen(nodeId, seg.id)) out.atRed++;
    }
    return out;
  }
  crashCause = { rear: 0, random: 0, junction: 0 };

  pick(ray: THREE.Raycaster): Car | null {
    const h = this.renderer.pick(ray);
    if (h === null) return null;
    return this.cars.find((c) => c.h === h) ?? null;
  }

  setNight(n: number) {
    this.renderer.setNight(n);
  }

  get count() {
    return this.cars.length;
  }

  randomCar(): Car | null {
    const moving = this.cars.filter((c) => c.crashed === 0 && !c.junction);
    return moving.length ? moving[Math.floor(Math.random() * moving.length)] : null;
  }

  driverName(c: Car) {
    return ARCHETYPES[c.driver % ARCHETYPES.length]?.name ?? 'Some Guy';
  }
}

export { fx };
