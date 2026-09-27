// Traffic: trips between buildings (and out of town), A* routing with BPR
// congestion costs, IDM car-following per lane, signals at stroad junctions,
// drunk / reckless / smoking drivers and crashes. Induced demand emerges:
// free-flowing roads invite more trips.
import * as THREE from 'three';
import type { VehicleKind } from '../contracts';
import { clamp, closestOnSampled, lerp, locate, norm, sub, V2 } from '../core/math';
import { fx } from '../core/rng';
import type { RNode, RoadNetwork, RSeg } from '../roads/network';
import { laneOffset, ROAD_TYPES } from '../roads/roadTypes';
import type { Bld, Buildings } from '../sim/buildings';
import { FIXED_PAINT, randomVehicleKind, VEHICLE_SPECS, VehicleRenderer } from './vehicles';
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
  junction: null | { t: number; len: number; p0: V2; c1: V2; c2: V2; p2: V2; t1: V2; t2: V2; lut: number[]; y0: number; y1: number; node: number; fromSeg: number; lane2: number };
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

/** Endpoint of a dispatched trip: a building, or 'edge' (an outside connection). */
export type TripEnd = Bld | 'edge';

export interface DispatchOpts {
  /** never drunk / reckless / smoking (service vehicles, buses) */
  sober?: boolean;
  /** counts as a town car (true) or an out-of-towner (false); default true */
  local?: boolean;
  onDone?: (c: Car, arrived: boolean) => void;
}

const smooth01 = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const angLerp = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const DEP_T = 2.6;
const ARR_T = 2.2;

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

  /** Is there room to leave the junction onto this lane? ("don't block the box") */
  private exitClear(c: Car): boolean {
    const nx = c.path[c.pi + 1];
    const ns = nx && this.net.segs.get(nx.seg);
    if (!ns) return true;
    const lanesN = ROAD_TYPES[ns.type].lanesPerDir;
    const lane = c.turn < 0 ? lanesN - 1 : c.turn > 0 ? 0 : Math.min(c.lane, lanesN - 1);
    const k = nx.seg * 16 + (nx.dir > 0 ? 0 : 8) + lane;
    const entryS = nx.dir > 0 ? ns.trimA : ns.trimB;
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

  // ------------------------------------------------------------------ signals
  private rebuildSignals() {
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
      ang.sort((x, y) => x.a - y.a);
      const phaseOf = new Map<number, number>();
      ang.forEach((e, i) => phaseOf.set(e.id, i % 2));
      this.signals.set(n.id, { phaseOf, phases: 2, t: old.get(n.id)?.t ?? Math.random() * 20 });
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
      const p = this.net.pickSeg(bld.x, bld.z, 50);
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

  private edgeAnchors(): { seg: RSeg; s: number }[] {
    const out: { seg: RSeg; s: number }[] = [];
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
    const list = [...this.b.list.values()].filter((b) => b.state === 'active' && b.zone !== 'landmark' && b.zone !== 'service');
    const edges = this.edgeAnchors();
    if (list.length < 2 && !edges.length) return false;
    const res = list.filter((b) => b.zone === 'resLow' || b.zone === 'resHigh');
    const jobs = list.filter((b) => b.zone !== 'resLow' && b.zone !== 'resHigh');
    const shops = list.filter((b) => b.zone === 'comLow' || b.zone === 'comHigh');
    const ind = list.filter((b) => b.zone === 'industry');
    const morning = hour > 6 && hour < 10, evening = hour > 15.5 && hour < 19.5;
    let o: { seg: RSeg; s: number } | null = null, d: { seg: RSeg; s: number } | null = null;
    let oB: Bld | null = null, dB: Bld | null = null;
    let local = true;
    let purpose = 'cruising', dest = 'nowhere in particular', kind: VehicleKind = randomVehicleKind(Math.random);
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
        o = edgeO; d = pick(edges); purpose = 'passing through'; dest = 'somewhere with a Waffle Bunker';
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
    const rt = this.route(o.seg, o.s, d.seg, d.s);
    if (!rt) return null;
    {
      const st0 = rt.steps[0];
      const seg0 = this.net.segs.get(st0.seg)!;
      const busyAt = (s: number) => this.cars.some((c) => !c.junction && c.crashed !== -1 && c.path[c.pi].seg === st0.seg && c.path[c.pi].dir === st0.dir && Math.abs(c.s - s) < 9);
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
    const drunk = !sober && Math.random() < (night ? 0.14 : 0.04);
    const firstSeg = this.net.segs.get(rt.steps[0].seg)!;
    const car: Car = {
      id: this.nextId++, h, kind, path: rt.steps, pi: 0, s: rt.startS, startS: rt.startS, endS: rt.endS,
      lane: Math.floor(Math.random() * ROAD_TYPES[firstSeg.type].lanesPerDir), v: 4, v0mul: (0.9 + Math.random() * 0.25) * (drunk ? 1.25 : 1),
      // codex:policies begin -- a smoke-free endpoint disables the visible in-car smoking effect
      len: spec.length, drunk, reckless: drunk || (!sober && Math.random() < 0.08), smoker: !sober && (!oB || this.policySmokingAllowed?.(oB) !== false) && (!dB || this.policySmokingAllowed?.(dB) !== false) && Math.random() < 0.2, redsRun: 0, wob: Math.random() * 10,
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
    }
    if (dB) {
      const stN = rt.steps[rt.steps.length - 1];
      const lastSeg = this.net.segs.get(stN.seg)!;
      car.lotD = this.lotPoint(dB, lastSeg, lastSeg.id === d.seg.id ? d.s : stN.dir > 0 ? rt.endS : lastSeg.length - rt.endS);
    }
    this.cars.push(car);
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
    if (simSpeed > 0) {
      let spawns = 0;
      while (this.cars.length < this.targetCars && spawns < 12) {
        spawns++;
        this.spawnTrip(hour);
      }
    }

    // buckets per seg/dir/lane
    this.buckets.clear();
    this.enteredAt.clear();
    this.junctionCars.clear();
    for (const s of this.net.segs.values()) s.load[0] = s.load[1] = 0;
    this.junctionTargets.clear();
    for (const c of this.cars) {
      if (c.crashed === -1) continue;
      if (c.dep > 0 || c.arr >= 0) continue; // in a lot: not on the road
      if (c.junction) {
        let arr = this.junctionCars.get(c.junction.node);
        if (!arr) this.junctionCars.set(c.junction.node, (arr = []));
        arr.push(c);
        const nx = c.path[c.pi + 1];
        const ns = nx && this.net.segs.get(nx.seg);
        if (ns) {
          const k = nx.seg * 16 + (nx.dir > 0 ? 0 : 8) + c.junction.lane2;
          this.junctionTargets.set(k, (this.junctionTargets.get(k) ?? 0) + 1);
        }
        continue;
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
        const exitS = last ? c.endS : seg.length - (st.dir > 0 ? seg.trimB : seg.trimA);
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
          if (gap < -1.5 && lead.crashed === 0) { gap = Infinity; dv = 0; } // overlapped: let them untangle
        }
        if (!last && exitS - c.s < 30 && !this.exitClear(c)) {
          const g4 = exitS - 1.5 - c.s;
          if (g4 < gap) { gap = g4; dv = c.v; }
        }
        if (!last) {
          const nodeId = st.dir > 0 ? seg.b : seg.a;
          if (!this.isGreen(nodeId, seg.id)) {
            const runIt = c.reckless && Math.random() < 0.004;
            if (runIt) c.redsRun++;
            if (!(c.reckless && c.redsRun > 0 && exitS - c.s < 12)) {
              const g2 = exitS - 1.5 - c.s;
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
            const e = this.frameAt(seg, st.dir, exitS);
            const ex = e.x + e.r.x * c.lat, ez = e.z + e.r.z * c.lat;
            if (inBox.some((o) => o.crashed === 0 && o.junction && o.junction.fromSeg !== seg.id && o.junction.t < 0.85 && Math.hypot(o.x - ex, o.z - ez) < 7.5)) {
              const g5 = exitS - 1.5 - c.s;
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
          const p = 0.00006 * this.crashMul * (c.drunk ? 30 : 1) * (c.reckless ? 5 : 1) * (T.centerTurn ? 1.5 : 1) * (0.3 + c.v / 25) * dt;
          if (Math.random() < p) { this.crashCause.random++; this.crash(lead && lead.s - c.s < 12 ? [c, lead] : [c], seg, c.drunk); }
        }
        // smoking out the window
        if (c.smoker && Math.abs(c.x - camX) < 300 && Math.abs(c.z - camZ) < 300) {
          c.smokeT -= dtReal;
          if (c.smokeT < 0) { c.smokeT = 1.2 + Math.random() * 2; this.onEmit?.('cigarette', c.x, c.y + 1.4, c.z, 1); }
        }
        if (c.s >= exitS) {
          if (last) {
            if (c.lotD) { c.arr = 0; c.v = 0; } // pull into the lot, then park
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
        const next = c.path[c.pi + 1];
        const nseg = next && this.net.segs.get(next.seg);
        if (!nseg) { c.crashed = -1; continue; }
        // spillback: wait if the entry of the next segment is full
        const key = nseg.id * 16 + (next.dir > 0 ? 0 : 8) + J.lane2;
        const q = this.buckets.get(key);
        const entryS = next.dir > 0 ? nseg.trimA : nseg.trimB;
        const entered = this.enteredAt.get(key);
        const frontS = Math.min(q && q.length ? q[0].s - q[0].len : Infinity, entered ?? Infinity);
        const blocked = frontS - entryS < 3 && J.t > 0.7;
        const vt = blocked ? 0 : Number.isFinite(c.turnV) ? c.turnV : Math.min(13, ROAD_TYPES[nseg.type].speed);
        c.v += clamp(vt - c.v, -6 * dt, 2.2 * dt);
        J.t += (c.v * dt) / Math.max(1, J.len);
        // red-light runners get T-boned
        if (c.redsRun > 0) {
          for (const o of arr) {
            if (o === c || o.crashed !== 0 || o.junction?.fromSeg === J.fromSeg) continue;
            if (Math.hypot(o.x - c.x, o.z - c.z) < 3.5) { this.crashCause.junction++; this.crash([c, o], this.net.segs.get(J.fromSeg), c.drunk); break; }
          }
        }
        if (J.t >= 1) {
          if (blocked) { J.t = 1; c.v = 0; continue; }
          c.junction = null;
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

    // cars pulling out of / into lots
    for (const c of this.cars) {
      if (c.crashed !== 0) continue;
      if (c.arr >= 0) {
        c.arr += dt;
        if (c.arr >= ARR_T) { c.arrived = true; c.crashed = -1; } // parked: off the road
      } else if (c.dep > 0) {
        const nd = c.dep - dt;
        if (nd <= 0) {
          // merge only when the lane is clear around the driveway
          const st = c.path[c.pi];
          const seg = this.net.segs.get(st.seg);
          if (!seg) { c.crashed = -1; continue; }
          const key = st.seg * 16 + (st.dir > 0 ? 0 : 8) + Math.min(c.lane, ROAD_TYPES[seg.type].lanesPerDir - 1);
          const q = this.buckets.get(key);
          // yield to a car about to pass the driveway; give up yielding after a
          // few seconds (someone always lets you in, or you just go for it)
          c.wait = (c.wait ?? 0) + dt;
          if (c.wait < 4 && q && q.some((o) => o.s > c.s - 8 && o.s - o.len < c.s + 3 && o.v > 2)) { c.dep = 0.001; continue; }
          c.dep = 0;
          c.v = 2;
        } else c.dep = nd;
      }
    }
    // crashed cars count down, then clear
    for (const c of this.cars) if (c.crashed > 0) c.crashed = Math.max(0.0001, c.crashed - dt);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.crashed === -1 || (c.crashed > 0 && c.crashed <= 0.0001)) {
        this.renderer.remove(c.h);
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

  private enterJunction(c: Car, seg: RSeg, st: Step) {
    const next = c.path[c.pi + 1];
    const nseg = this.net.segs.get(next.seg);
    if (!nseg) { c.crashed = -1; return; }
    const nodeId = st.dir > 0 ? seg.b : seg.a;
    this.planTurn(c);
    const f0 = this.frameAt(seg, st.dir, c.s);
    const lat = Number.isFinite(c.lat) ? c.lat : laneOffset(ROAD_TYPES[seg.type], c.lane);
    const p0 = { x: f0.x + f0.r.x * lat, z: f0.z + f0.r.z * lat };
    // turning right lands in the kerb lane, left in the inside lane
    const lanesN = ROAD_TYPES[nseg.type].lanesPerDir;
    const lane2 = c.turn < 0 ? lanesN - 1 : c.turn > 0 ? 0 : Math.min(c.lane, lanesN - 1);
    const entryS = next.dir > 0 ? nseg.trimA : nseg.trimB;
    const p2 = this.lanePos(nseg, next.dir, entryS, lane2);
    const t1 = f0.t, t2 = p2.t;
    const d = Math.hypot(p2.p.x - p0.x, p2.p.z - p0.z);
    const k = d * 0.42;
    const c1 = { x: p0.x + t1.x * k, z: p0.z + t1.z * k };
    const c2 = { x: p2.p.x - t2.x * k, z: p2.p.z - t2.z * k };
    // arc length table so the car crosses at an even speed
    const lut = [0];
    let px = p0.x, pz = p0.z, L = 0;
    for (let i = 1; i <= 10; i++) {
      const q = cubicAt(p0, c1, c2, p2.p, i / 10);
      L += Math.hypot(q.x - px, q.z - pz);
      lut.push(L);
      px = q.x; pz = q.z;
    }
    for (let i = 1; i <= 10; i++) lut[i] /= Math.max(1e-6, L);
    c.junction = { t: 0, len: Math.max(2, L), p0, c1, c2, p2: p2.p, t1, t2, lut, y0: f0.y, y1: p2.y, node: nodeId, fromSeg: seg.id, lane2 };
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

  /** Room to move into lane `to` of this step beside the car? */
  private laneFree(st: Step, to: number, c: Car): boolean {
    const q = this.buckets.get(st.seg * 16 + (st.dir > 0 ? 0 : 8) + to);
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
    const tt = norm(sub(b, a));
    const t = { x: tt.x * dir, z: tt.z * dir };
    return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), t, r: { x: -t.z, z: t.x }, y: lerp(seg.hs[i], seg.hs[i + 1], f) };
  }

  /** World position of a lane at travel distance s. */
  lanePos(seg: RSeg, dir: 1 | -1, s: number, lane: number) {
    const arc = dir > 0 ? s : seg.length - s;
    const { i, f } = locate(seg.samp, clamp(arc, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tt = norm(sub(b, a));
    const t = { x: tt.x * dir, z: tt.z * dir };
    const r = { x: -t.z, z: t.x };
    const off = laneOffset(ROAD_TYPES[seg.type], lane);
    const y = lerp(seg.hs[i], seg.hs[i + 1], f);
    return { p: { x: lerp(a.x, b.x, f) + r.x * off, z: lerp(a.z, b.z, f) + r.z * off }, t, y };
  }

  private place(dtReal: number) {
    const R = this.renderer;
    const ease = 1 - Math.exp(-this.lastDt * 14);
    for (const c of this.cars) {
      if (c.crashed === -1) continue;
      c.wob += dtReal * (c.drunk ? 1.6 : 0);
      let x: number, y: number, z: number, yaw: number, pitch = 0;
      let signal = 0;
      if (c.junction) {
        const J = c.junction;
        // share of length covered -> curve parameter
        const f = clamp(J.t, 0, 1);
        let i = 1;
        while (i < 10 && J.lut[i] < f) i++;
        const u = (i - 1 + (f - J.lut[i - 1]) / Math.max(1e-6, J.lut[i] - J.lut[i - 1])) / 10;
        const q = cubicAt(J.p0, J.c1, J.c2, J.p2, u);
        const dq = cubicTan(J.p0, J.c1, J.c2, J.p2, u);
        x = q.x;
        z = q.z;
        // a bend in the road with no junction box is a zero-length curve: head along the lanes
        yaw = J.len > 2.05 && Math.hypot(dq.x, dq.z) > 1e-3 ? Math.atan2(dq.x, dq.z) : Math.atan2(lerp(J.t1.x, J.t2.x, f), lerp(J.t1.z, J.t2.z, f));
        y = lerp(J.y0, J.y1, f) + 0.12;
        pitch = -Math.atan2(J.y1 - J.y0, J.len);
        signal = c.turn;
      } else {
        const st = c.path[c.pi];
        const seg = this.net.segs.get(st.seg);
        if (!seg) continue;
        if (!Number.isFinite(c.lat)) c.lat = laneOffset(ROAD_TYPES[seg.type], c.lane);
        const F = this.frameAt(seg, st.dir, c.s);
        x = F.x + F.r.x * c.lat;
        z = F.z + F.r.z * c.lat;
        y = F.y + 0.12;
        // heading from where the front and back wheels are: smooth round bends (no snap at each sample)
        const half = c.len * 0.36;
        const fF = this.frameAt(seg, st.dir, c.s + half), fR = this.frameAt(seg, st.dir, c.s - half);
        let hx = fF.x + fF.r.x * c.lat - (fR.x + fR.r.x * c.lat), hz = fF.z + fF.r.z * c.lat - (fR.z + fR.r.z * c.lat);
        const hl = Math.hypot(hx, hz) || 1;
        // lean the nose into a lane change
        const v = Math.max(3, c.v);
        hx = (hx / hl) * v + F.r.x * c.latV;
        hz = (hz / hl) * v + F.r.z * c.latV;
        yaw = Math.atan2(hx, hz);
        if (c.drunk && c.crashed === 0) {
          const w = Math.sin(c.wob) * 1.1;
          x += -F.t.z * w;
          z += F.t.x * w;
          yaw += Math.cos(c.wob) * 0.12;
        }
        pitch = -Math.atan2(fF.y - fR.y, Math.max(0.5, half * 2));
        const lastStep = c.pi === c.path.length - 1;
        const exitS = lastStep ? c.endS : seg.length - (st.dir > 0 ? seg.trimB : seg.trimA);
        if (!lastStep && exitS - c.s < 32) signal = c.turn;
        else if (Math.abs(c.latV) > 0.2) signal = c.latV > 0 ? -1 : 1;
        else if (lastStep && c.lotD && exitS - c.s < 22) signal = this.lotSide(seg, st.dir, c.s, c.lotD);
      }
      // driveway: an arc between the lot and the lane, nose first both ways
      const lot = c.dep > 0 ? c.lotO : c.arr >= 0 ? c.lotD : null;
      if (lot && !c.junction) {
        const m = c.dep > 0 ? 1 - c.dep / DEP_T : 1 - c.arr / ARR_T; // 0 = in the lot, 1 = on the lane
        const e = m * m * (3 - 2 * m);
        const laneY = y, lanePitch = pitch;
        const tx = Math.sin(yaw), tz = Math.cos(yaw);
        const d = Math.max(2, Math.hypot(x - lot.x, z - lot.z));
        const out = c.dep > 0;
        const toRoad = { x: (x - lot.x) / d, z: (z - lot.z) / d };
        const P0 = lot, P3 = { x, z };
        const P1 = { x: lot.x + toRoad.x * d * 0.45, z: lot.z + toRoad.z * d * 0.45 };
        const P2 = { x: x - (out ? 1 : -1) * tx * d * 0.55, z: z - (out ? 1 : -1) * tz * d * 0.55 };
        const q = cubicAt(P0, P1, P2, P3, e), dq = cubicTan(P0, P1, P2, P3, e);
        x = q.x;
        z = q.z;
        if (Math.hypot(dq.x, dq.z) > 1e-4) yaw = out ? Math.atan2(dq.x, dq.z) : Math.atan2(-dq.x, -dq.z);
        if (out) {
          // pulling out: blink toward the way the lane runs
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
      if (signal) this.sigWhy[c.junction ? 'box' : lot ? 'lot' : Math.abs(c.latV) > 0.2 ? 'lane' : c.v < 1 ? 'queue' : 'approach']++;
      else this.sigWhy.off++;
      R.setDamaged(c.h, c.crashed > 0); // AA vehicle shader darkens crumpled cars until cleanup.
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
