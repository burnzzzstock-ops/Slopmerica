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
  junction: null | { t: number; len: number; p0: V2; p1: V2; p2: V2; y0: number; y1: number; node: number; fromSeg: number };
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
    const lane = Math.min(c.lane, ROAD_TYPES[ns.type].lanesPerDir - 1);
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
    if (segO.id === segD.id) {
      const dir: 1 | -1 = sD >= sO ? 1 : -1;
      if (Math.abs(sD - sO) < 15) return null;
      return { steps: [{ seg: segO.id, dir }], startS: dir > 0 ? sO : segO.length - sO, endS: dir > 0 ? sD : segD.length - sD };
    }
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
    g.set(A.id, sO / speedO);
    came.set(A.id, { prev: -1, seg: segO.id, dir: -1 });
    open.push(A.id, sO / speedO + H(A));
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
      if (cur.k === segD.b && gc + extraB < bestGoal) { bestGoal = gc + extraB; bestEnd = { node: cur.k, dir: -1 }; }
      const node = this.net.nodes.get(cur.k);
      if (!node) continue;
      const sigPenalty = this.signals.has(node.id) ? 5 : 0;
      for (const sid of node.segs) {
        const s = this.net.segs.get(sid);
        if (!s || s.id === segD.id) continue;
        const dir: 1 | -1 = s.a === node.id ? 1 : -1;
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
      } else if (r < 0.42 && (shops.length || ind.length)) {
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
    } else if (ind.length && shops.length && Math.random() < 0.14) {
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
    const h = this.renderer.add(kind, FIXED_PAINT[kind] ?? PAINT[Math.floor(Math.random() * PAINT.length)]);
    if (h < 0) return null;
    const night = hour > 21 || hour < 4;
    const drunk = !sober && Math.random() < (night ? 0.14 : 0.04);
    const firstSeg = this.net.segs.get(rt.steps[0].seg)!;
    const car: Car = {
      id: this.nextId++, h, kind, path: rt.steps, pi: 0, s: rt.startS, startS: rt.startS, endS: rt.endS,
      lane: Math.floor(Math.random() * ROAD_TYPES[firstSeg.type].lanesPerDir), v: 4, v0mul: (0.9 + Math.random() * 0.25) * (drunk ? 1.25 : 1),
      len: spec.length, drunk, reckless: drunk || (!sober && Math.random() < 0.08), smoker: !sober && Math.random() < 0.2, redsRun: 0, wob: Math.random() * 10,
      junction: null, crashed: 0, crashYaw: 0, crashRoll: 0, x: 0, y: 0, z: 0, yaw: 0, purpose, dest,
      driver: Math.floor(Math.random() * ARCHETYPES.length), smokeT: Math.random() * 2, bac: drunk ? 0.09 + Math.random() * 0.2 : 0,
      dep: 0, arr: -1, lotO: null, lotD: null, local,
    };
    // pull out of the origin lot / pull into the destination lot
    if (oB) {
      const st0 = rt.steps[0];
      car.lotO = this.lotPoint(oB, firstSeg, st0.dir > 0 ? rt.startS : firstSeg.length - rt.startS);
      car.dep = DEP_T;
      car.v = 0;
    }
    if (dB) {
      const stN = rt.steps[rt.steps.length - 1];
      const lastSeg = this.net.segs.get(stN.seg)!;
      car.lotD = this.lotPoint(dB, lastSeg, stN.dir > 0 ? rt.endS : lastSeg.length - rt.endS);
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

  private step(dtReal: number, simSpeed: number, hour: number, population: number, jobs: number, camTarget: THREE.Vector3, last: boolean) {
    const dt = dtReal * Math.max(0.0001, simSpeed);
    if (simSpeed > 0) for (const s of this.signals.values()) s.t += dt;

    // demand for trips: population & jobs, time of day, induced demand
    const tod = hour < 5 ? 0.25 : hour < 7 ? 0.6 : hour < 10 ? 1.35 : hour < 15.5 ? 0.9 : hour < 19.5 ? 1.4 : hour < 22 ? 0.8 : 0.45;
    const induced = 0.6 + 0.6 * this.flowEma;
    const edgeBoost = Math.min(3, this.edgeAnchors().length) * 12;
    this.targetCars = Math.min(this.maxCars, Math.round((population * 0.12 + jobs * 0.05 + edgeBoost) * tod * induced));
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
          const k = nx.seg * 16 + (nx.dir > 0 ? 0 : 8) + Math.min(c.lane, ROAD_TYPES[ns.type].lanesPerDir - 1);
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
        const v0 = T.speed * this.speedMul * c.v0mul * (c.drunk ? 0.9 + Math.sin(c.wob * 0.7) * 0.3 : 1);
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
        // IDM
        const a = 1.7, bdec = 2.8, Th = c.drunk ? 0.8 : 1.3, s0 = c.drunk ? 1.5 : 2.5;
        const sStar = s0 + Math.max(0, c.v * Th + (c.v * dv) / (2 * Math.sqrt(a * bdec)));
        let acc = a * (1 - Math.pow(c.v / Math.max(1, v0), 4) - (gap < Infinity ? Math.pow(sStar / Math.max(0.1, gap), 2) : 0));
        acc = clamp(acc, -12, a);
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
        const key = nseg.id * 16 + (next.dir > 0 ? 0 : 8) + Math.min(c.lane, ROAD_TYPES[nseg.type].lanesPerDir - 1);
        const q = this.buckets.get(key);
        const entryS = next.dir > 0 ? nseg.trimA : nseg.trimB;
        const entered = this.enteredAt.get(key);
        const frontS = Math.min(q && q.length ? q[0].s - q[0].len : Infinity, entered ?? Infinity);
        const blocked = frontS - entryS < 3 && J.t > 0.7;
        const vt = blocked ? 0 : Math.min(9, ROAD_TYPES[nseg.type].speed);
        c.v += clamp(vt - c.v, -8 * dt, 2 * dt);
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
          c.lane = Math.min(c.lane, ROAD_TYPES[nseg.type].lanesPerDir - 1);
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
    const p0 = this.lanePos(seg, st.dir, c.s, c.lane);
    const lane2 = Math.min(c.lane, ROAD_TYPES[nseg.type].lanesPerDir - 1);
    const entryS = next.dir > 0 ? nseg.trimA : nseg.trimB;
    const p2 = this.lanePos(nseg, next.dir, entryS, lane2);
    const t1 = p0.t, t2 = p2.t;
    const d = Math.hypot(p2.p.x - p0.p.x, p2.p.z - p0.p.z);
    const p1 = { x: (p0.p.x + t1.x * d * 0.5 + p2.p.x - t2.x * d * 0.5) / 2, z: (p0.p.z + t1.z * d * 0.5 + p2.p.z - t2.z * d * 0.5) / 2 };
    c.junction = { t: 0, len: Math.max(2, d * 1.1), p0: p0.p, p1, p2: p2.p, y0: p0.y, y1: p2.y, node: nodeId, fromSeg: seg.id };
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
    for (const c of this.cars) {
      if (c.crashed === -1) continue;
      c.wob += dtReal * (c.drunk ? 1.6 : 0);
      let x: number, y: number, z: number, yaw: number, pitch = 0;
      if (c.junction) {
        const J = c.junction;
        const t = clamp(J.t, 0, 1), u = 1 - t;
        x = u * u * J.p0.x + 2 * u * t * J.p1.x + t * t * J.p2.x;
        z = u * u * J.p0.z + 2 * u * t * J.p1.z + t * t * J.p2.z;
        const dx = 2 * u * (J.p1.x - J.p0.x) + 2 * t * (J.p2.x - J.p1.x);
        const dz = 2 * u * (J.p1.z - J.p0.z) + 2 * t * (J.p2.z - J.p1.z);
        yaw = Math.atan2(dx, dz);
        y = lerp(J.y0, J.y1, t) + 0.12;
      } else {
        const st = c.path[c.pi];
        const seg = this.net.segs.get(st.seg);
        if (!seg) continue;
        const lp = this.lanePos(seg, st.dir, c.s, c.lane);
        x = lp.p.x;
        z = lp.p.z;
        y = lp.y + 0.12;
        yaw = Math.atan2(lp.t.x, lp.t.z);
        if (c.drunk && c.crashed === 0) {
          const w = Math.sin(c.wob) * 1.1;
          x += -lp.t.z * w;
          z += lp.t.x * w;
          yaw += Math.cos(c.wob) * 0.12;
        }
        const ahead = this.lanePos(seg, st.dir, Math.min(seg.length, c.s + 2), c.lane);
        pitch = -Math.atan2(ahead.y - lp.y, 2);
      }
      // driveway animation: slide between the lot point and the lane
      const lot = c.dep > 0 ? c.lotO : c.arr >= 0 ? c.lotD : null;
      if (lot && !c.junction) {
        const m = c.dep > 0 ? 1 - c.dep / DEP_T : 1 - c.arr / ARR_T; // 1 = on the lane
        const e = m * m * (3 - 2 * m);
        const laneYaw = yaw;
        const toLane = Math.atan2(x - lot.x, z - lot.z);
        x = lerp(lot.x, x, e);
        z = lerp(lot.z, z, e);
        y = lerp(this.groundAt ? this.groundAt(lot.x, lot.z) + 0.1 : y, y, e);
        // nose toward the road while pulling out, toward the lot while pulling in
        const along = c.dep > 0 ? toLane : toLane + Math.PI;
        yaw = angLerp(along, laneYaw, smooth01((m - 0.45) / 0.55));
        pitch = 0;
      }
      c.x = x; c.y = y; c.z = z; c.yaw = yaw;
      if (c.crashed > 0) R.set(c.h, x, y, z, yaw + c.crashYaw, pitch, c.crashRoll);
      else R.set(c.h, x, y, z, yaw, pitch, 0);
      R.setBraking(c.h, c.v < 3);
      R.setDamaged(c.h, c.crashed > 0); // AA vehicle shader darkens crumpled cars until cleanup.
    }
    R.flush();
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
