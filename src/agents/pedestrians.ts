// Pedestrians near the camera: sidewalk walkers, smokers and drinkers loitering
// outside businesses, commune drum circles, and protesters blocking roads.
import * as THREE from 'three';
import type { PersonAction } from '../contracts';
import { clamp, closestOnSampled, lerp, locate, norm, sub, type V2 } from '../core/math';
import type { RoadNetwork, RSeg } from '../roads/network';
import { carriageHalf, ROAD_TYPES } from '../roads/roadTypes';
import { WALK_TOP } from '../roads/roadSection'; // (display height only: the raised sidewalk)
import { isZoned, type Bld, type Buildings } from '../sim/buildings';
import type { Terrain } from '../world/terrain';
import { ARCHETYPES, PeopleRenderer } from './people';
import type { Communes } from './communes';

export interface Ped {
  h: number;
  arch: number;
  kind: 'walk' | 'loiter' | 'commune' | 'protest' | 'wait';
  action: PersonAction;
  seg: number;
  dir: 1 | -1;
  s: number;
  side: 1 | -1;
  speed: number;
  life: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: number;
  communeId?: number;
  transitStopId?: number;
  targetS?: number;
  label: string;
  /** walking between a door/spot and the ped's place (nobody pops in or out) */
  go?: { fx: number; fz: number; tx: number; tz: number; t: number; T: number; remove: boolean };
  /** where to walk back to when done (door, camp, curb); walkers find a door */
  home?: V2;
  leaving?: boolean;
  gone?: boolean;
  retries?: number;
  /** the building this person came out of (each lets only a few of its occupants out at once) */
  fromBld?: number;
  /** drawn heading, eased round corners */
  ryaw?: number;
  /** extra step to the walker's right (m): walking side by side, keeping right */
  lat?: number;
  /** which way to face once they've walked to their spot */
  face?: number;
  /** crossing a junction arm on foot (cars on those arms stop for them) */
  crossing?: { node: number; segs: number[] };
  /** the road it waited at the kerb to cross to */
  nextSeg?: number;
  /** seconds spent waiting at the kerb for traffic before crossing */
  kerbWait?: number;
  /** the rest of a walk over a junction: to the crosswalk, over it (`cross`), and on to the next sidewalk */
  legs?: { x: number; z: number; cross?: { node: number; segs: number[] } }[];
}

/** at a junction with no lights, a walker gives up waiting for a gap after this long and steps out anyway (cars stop for them) */
const KERB_PATIENCE = 20;
/** people reaching the kerb this soon after others stepped out cross with them */
const CROSS_JOIN = 3;
/** after a crossing clears, the cars waiting for it get this long before the next person steps out */
const CROSS_TURN = 4;

/** Leg cycles per metre: a stride (two steps) is about 1.4 m walking, 2.2 m running. */
const STRIDE = { walk: 1.42, run: 2.2 };

const angEase = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

const hippies = () => ARCHETYPES.map((a, i) => (a.hippie ? i : -1)).filter((i) => i >= 0);
const normies = () => ARCHETYPES.map((a, i) => (!a.hippie ? i : -1)).filter((i) => i >= 0);
const merchHeads = () => ARCHETYPES.map((a, i) => (a.merch ? i : -1)).filter((i) => i >= 0);

/** Which side of a road a point is on, relative to the road's own direction (the sidewalk `side`). */
function sideOf(seg: RSeg, x: number, z: number): 1 | -1 {
  const c = closestOnSampled({ x, z }, seg.samp);
  const { i } = locate(seg.samp, clamp(c.s, 0, seg.length));
  const t = norm(sub(seg.samp.pts[i + 1], seg.samp.pts[i]));
  return (x - c.pt.x) * -t.z + (z - c.pt.z) * t.x >= 0 ? 1 : -1;
}


/** Distance from point to segment a-b. */
function ptSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L > 1e-9 ? clamp(((px - ax) * dx + (pz - az) * dz) / L, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
/** Closest distance between segments p1-p2 and p3-p4 (0 when they cross). */
function segDist(x1: number, z1: number, x2: number, z2: number, x3: number, z3: number, x4: number, z4: number): number {
  if (segmentsCross(x1, z1, x2, z2, x3, z3, x4, z4)) return 0;
  return Math.min(ptSeg(x1, z1, x3, z3, x4, z4), ptSeg(x2, z2, x3, z3, x4, z4), ptSeg(x3, z3, x1, z1, x2, z2), ptSeg(x4, z4, x1, z1, x2, z2));
}

/** Do segments p1-p2 and p3-p4 cross (strictly)? */
function segmentsCross(x1: number, z1: number, x2: number, z2: number, x3: number, z3: number, x4: number, z4: number): boolean {
  const d = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / d;
  const v = ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / d;
  return u > 0 && u < 1 && v > 0 && v < 1;
}

/** seconds between people leaving the same building (plus 0-4 s by building) */
const DOOR_GAP = 6;

export class Pedestrians {
  peds: Ped[] = [];
  readonly renderer: PeopleRenderer;
  private hip: number[];
  private norm: number[];
  private merch: number[];
  private spawnT = 0;
  // codex:transit begin - visible riders waiting at registered curb stops
  transitStops?: () => { id: number; seg: number; s: number; side: 1 | -1; label: string; riders: number }[];
  // codex:transit end
  outdoorMul = 1;
  // codex:policies begin -- separate from the weather multiplier reset by Game.frame
  policyOutdoorMul = 1;
  policySmokingAllowedAt?: (x: number, z: number) => boolean;
  // codex:policies end
  /** scales the crowd with the city: nobody walks in a town of 50 */
  population = 0;
  /**
   * game wiring: may someone start over these junction arms now, taking `secs`
   * to cross? (a walk phase at lights; no car close; `impatient`: they've waited
   * long enough at a junction without lights to step out anyway)
   */
  canCross?: (node: number, segs: number[], secs: number, impatient: boolean) => boolean;
  /** people on each crosswalk right now, by `node:seg`: where they are and which way they're walking */
  private onCrosswalk = new Map<string, { x: number; z: number; dx: number; dz: number }[]>();
  /** when each crosswalk's current crossing started, and when the last one cleared (walking clock) */
  private cwSince = new Map<string, number>();
  private cwClear = new Map<string, number>();
  /** walking time (seconds at the pace people walk, which follows the game speed up to 3x) */
  private walkClock = 0;
  /** Is someone walking over this arm of this junction? */
  crosswalkBusy(node: number, seg: number): boolean {
    return (this.onCrosswalk.get(`${node}:${seg}`)?.length ?? 0) > 0;
  }
  /** The people on this arm's crosswalk (cars wait while one is on or heading into their lanes). */
  crosswalkWalkers(node: number, seg: number) {
    return this.onCrosswalk.get(`${node}:${seg}`);
  }
  /**
   * How far past its trim people cross this arm at this node (metres; 0 at most junctions). At a sharp corner the sidewalk
   * on the acute side stops short of the other road (kerbs), so the crossing is further out: the traffic stops its cars
   * behind it (on the reference block, 10 of 94 arms, by up to 5.5 m).
   */
  walkSetback(node: number, seg: number): number {
    const s = this.net.segs.get(seg);
    if (!s || (s.a !== node && s.b !== node)) return 0;
    const atA = s.a === node, trim = Math.max(0, (atA ? s.trimA : s.trimB) ?? 0);
    let back = 0;
    for (const side of [1, -1] as const) {
      const [a, b] = this.kerbs(s, side);
      back = Math.max(back, (atA ? a : s.length - b) - trim);
    }
    return back;
  }
  /** where each road's sidewalks end, by `seg:side` (with the junction layout it was worked out for) */
  private kerbCache = new Map<string, { key: string; ab: [number, number] }>();
  /**
   * Where a road's sidewalk on this side ends at each end: the kerb at the
   * junction box's edge, where the crosswalk is (cars stop 3 m back from it,
   * wherever it is: traffic.ts stopBack;
   * turning cars are still in their lanes there). At a sharp corner the box
   * edge is still on the other road, or where a turning truck swings, so the
   * sidewalk stops short of that road. A road with no box at that end runs on
   * to the node.
   */
  private kerbs(seg: RSeg, side: 1 | -1): [number, number] {
    const nA = this.net.nodes.get(seg.a), nB = this.net.nodes.get(seg.b);
    const key = `${seg.length}|${nA?.segs.join(',')}|${nB?.segs.join(',')}`;
    const hit = this.kerbCache.get(`${seg.id}:${side}`);
    if (hit && hit.key === key) return hit.ab;
    const T = ROAD_TYPES[seg.type], off = (T.sidewalk > 0 ? T.width / 2 - T.sidewalk / 2 : T.width / 2 + 1.3) * side;
    const clearOf = (node: typeof nA, at: number) => {
      const { i, f } = locate(seg.samp, clamp(at, 0, seg.length));
      const a = seg.samp.pts[i], b = seg.samp.pts[i + 1], tan = norm(sub(b, a));
      const pt = { x: lerp(a.x, b.x, f) - tan.z * off, z: lerp(a.z, b.z, f) + tan.x * off };
      for (const id of node?.segs ?? []) {
        const o = id !== seg.id && this.net.segs.get(id);
        // (clear of its lanes by 2.5 m: a long truck turning in cuts the corner)
        if (o && closestOnSampled(pt, o.samp).d < carriageHalf(ROAD_TYPES[o.type]) + 2.5) return false;
      }
      return true;
    };
    const tA = seg.trimA ?? 0, tB = seg.trimB ?? 0, half = seg.length / 2;
    let a = tA > 0 ? tA : 0, b = seg.length - (tB > 0 ? tB : 0);
    while (a < Math.min(half - 1, tA + 20) && !clearOf(nA, a)) a += 0.5;
    while (b > Math.max(half + 1, seg.length - tB - 20) && !clearOf(nB, b)) b -= 0.5;
    const ab: [number, number] = a < b - 1 ? [a, b] : [half - 0.5, half + 0.5];
    this.kerbCache.set(`${seg.id}:${side}`, { key, ab });
    return ab;
  }

  /** People cross together, and between groups the waiting cars get a turn. */
  private crossingTurn(nodeId: number, arms: number[]): boolean {
    for (const sid of arms) {
      const k = `${nodeId}:${sid}`, since = this.cwSince.get(k);
      if (since !== undefined ? this.walkClock - since > CROSS_JOIN : this.walkClock - (this.cwClear.get(k) ?? -1e9) < CROSS_TURN) return false;
    }
    return true;
  }

  /**
   * The junction arms a walk from (fx, fz) to (tx, tz) past this node crosses:
   * the ones whose centreline, from the node out past the box, the walk cuts.
   */
  private armsCrossed(nodeId: number, fx: number, fz: number, tx: number, tz: number): number[] {
    const node = this.net.nodes.get(nodeId);
    if (!node) return [];
    const out: number[] = [];
    for (const id of node.segs) {
      const sg = this.net.segs.get(id);
      if (!sg || ROAD_TYPES[sg.type].width < 4) continue;
      const atA = sg.a === nodeId, P = sg.samp.pts;
      const q = atA ? P[Math.min(P.length - 1, 3)] : P[Math.max(0, P.length - 4)];
      const dx = q.x - node.x, dz = q.z - node.z, dl = Math.hypot(dx, dz) || 1;
      const reach = Math.min(sg.length * 0.5, (atA ? sg.trimA : sg.trimB) + 4);
      const ex = node.x + (dx / dl) * reach, ez = node.z + (dz / dl) * reach;
      // over the roadway: the walk cuts the arm's centreline, or passes within its
      // carriageway of it (a crossing that starts or ends on the road's own kerb)
      if (segmentsCross(fx, fz, tx, tz, node.x, node.z, ex, ez) || segDist(fx, fz, tx, tz, node.x, node.z, ex, ez) < carriageHalf(ROAD_TYPES[sg.type]) - 0.3) out.push(id);
    }
    return out;
  }

  constructor(scene: THREE.Scene, private net: RoadNetwork, private b: Buildings, private terrain: Terrain, private communes: Communes, private max: number) {
    this.renderer = new PeopleRenderer(scene, max);
    this.hip = hippies();
    this.norm = normies();
    this.merch = merchHeads();
    if (!this.hip.length) this.hip = [0];
    if (!this.norm.length) this.norm = [0];
  }

  private archFor(kind: Ped['kind'], brand?: string) {
    if (kind === 'commune' || (kind === 'protest' && Math.random() < 0.8)) return this.hip[Math.floor(Math.random() * this.hip.length)];
    if (brand === 'slop' && this.merch.length && Math.random() < 0.7) return this.merch[Math.floor(Math.random() * this.merch.length)];
    return this.norm[Math.floor(Math.random() * this.norm.length)];
  }

  private add(p: Omit<Ped, 'h'>) {
    const h = this.renderer.add(p.arch, Math.floor(Math.random() * 1e6));
    if (h < 0) return;
    this.peds.push({ ...p, h });
  }

  /** seconds of pedestrian time (for per-building departure spacing) */
  private clock = 0;
  /** when each building last let someone out */
  private lastOut = new Map<number, number>();

  update(dtReal: number, simSpeed: number, cam: THREE.Vector3, camDist: number, time: number) {
    this.clock += dtReal;
    this.walkClock += dtReal * Math.max(0.3, Math.min(simSpeed, 3));
    this.onCrosswalk.clear();
    for (const p of this.peds) {
      if (!p.crossing || !p.go) continue;
      const g = p.go, gl = Math.hypot(g.tx - g.fx, g.tz - g.fz) || 1;
      for (const sid of p.crossing.segs) {
        const k = `${p.crossing.node}:${sid}`;
        let list = this.onCrosswalk.get(k);
        if (!list) this.onCrosswalk.set(k, (list = []));
        list.push({ x: p.x, z: p.z, dx: (g.tx - g.fx) / gl, dz: (g.tz - g.fz) / gl });
      }
    }
    for (const k of this.onCrosswalk.keys()) if (!this.cwSince.has(k)) this.cwSince.set(k, this.walkClock);
    for (const k of [...this.cwSince.keys()]) if (!this.onCrosswalk.has(k)) { this.cwSince.delete(k); this.cwClear.set(k, this.walkClock); }
    const near = camDist < 900;
    const R = Math.min(520, camDist * 0.9 + 120);
    // despawn far or expired
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      p.life -= dtReal * Math.max(0.5, simSpeed);
      const far = Math.abs(p.x - cam.x) > R * 1.3 || Math.abs(p.z - cam.z) > R * 1.3;
      const communeGone = p.kind === 'commune' && this.communes.list.find((c) => c.id === p.communeId)?.state === 'gone';
      const segGone = p.kind !== 'commune' && p.kind !== 'loiter' && !this.net.segs.get(p.seg);
      if (p.gone || far || !near || communeGone || segGone || (p.life <= 0 && !this.leave(p))) {
        this.renderer.remove(p.h);
        this.peds[i] = this.peds[this.peds.length - 1];
        this.peds.pop();
      }
    }
    if (near) {
      this.spawnT -= dtReal;
      if (this.spawnT <= 0) {
        this.spawnT = 0.15;
        // People out and about in proportion to the town: about 7% of residents
        // near the camera, so a town of 200 shows a dozen or two, not a crowd.
        // Commune members have their own budget (they live outside the town).
        // codex:policies begin -- Ban Bikes visibly reduces ambient walking
        const townBudget = Math.floor(Math.min(this.max, 3 + this.population * 0.07) * clamp(this.outdoorMul * this.policyOutdoorMul, 0.1, 1.2));
        // codex:policies end
        const communeBudget = Math.min(this.max, this.communes.list.filter((c) => c.state !== 'gone').length * 6);
        let town = 0, commune = 0;
        for (const p of this.peds) if (p.kind === 'commune') commune++; else town++;
        // a couple at a time: people trickle out rather than flood out
        for (let k = 0; k < 2 && (town < townBudget || commune < communeBudget); k++) {
          const n = this.peds.length;
          this.trySpawn(cam, R, town < townBudget, commune < communeBudget);
          if (this.peds.length > n) { if (this.peds[this.peds.length - 1].kind === 'commune') commune++; else town++; }
        }
      }
    }
    const dt = dtReal * Math.max(0.0001, simSpeed);
    for (const p of this.peds) {
      if (p.go) {
        // walking out of a door / back inside
        const g = p.go;
        const k = Math.max(0.3, Math.min(simSpeed, 3));
        g.t += dtReal * k;
        const gd = Math.hypot(g.tx - g.fx, g.tz - g.fz);
        p.phase += (dtReal * k * (gd / Math.max(0.4, g.T))) / STRIDE.walk;
        const u = Math.min(1, g.t / g.T);
        p.x = lerp(g.fx, g.tx, u);
        p.z = lerp(g.fz, g.tz, u);
        p.y = this.terrain.h(p.x, p.z) + 0.06;
        if (gd > 0.2) p.yaw = Math.atan2(g.tx - g.fx, g.tz - g.fz);
        p.ryaw = p.ryaw === undefined ? p.yaw : angEase(p.ryaw, p.yaw, 1 - Math.exp(-dtReal * 9));
        if (u >= 1) {
          delete p.go;
          delete p.crossing;
          if (g.remove) { p.gone = true; continue; }
          // on over the junction: the next leg of the walk
          const leg = p.legs?.shift();
          if (leg) {
            if (!p.legs!.length) delete p.legs;
            const d = Math.hypot(leg.x - p.x, leg.z - p.z);
            this.goTo(p, p.x, p.z, leg.x, leg.z, false);
            p.go!.T = Math.max(0.4, d / Math.max(0.8, p.speed));
            if (leg.cross) p.crossing = leg.cross;
            this.renderer.set(p.h, p.x, p.y, p.z, p.ryaw ?? p.yaw, 'walk', p.phase);
            continue;
          }
          // arrived: turn to face the street, the grill, each other
          if (p.face !== undefined && p.kind !== 'walk') p.yaw = p.face;
          if (p.kind === 'walk') this.placeOnSidewalk(p);
        }
        this.renderer.set(p.h, p.x, p.y, p.z, p.ryaw ?? p.yaw, p.go ? 'walk' : p.action, p.phase);
        continue;
      }
      // feet planted: the legs cycle as fast as the body moves (they used to shuffle at 3x)
      const k = Math.max(0.3, Math.min(simSpeed, 3));
      p.phase += dtReal * k * (p.kind === 'walk' ? p.speed / (p.action === 'run' ? STRIDE.run : STRIDE.walk) : 1);
      if (p.kind === 'walk') {
        const seg = this.net.segs.get(p.seg);
        if (!seg) continue;
        p.s += p.speed * dt * p.dir;
        if (p.targetS !== undefined && ((p.dir > 0 && p.s >= p.targetS) || (p.dir < 0 && p.s <= p.targetS))) {
          p.s = p.targetS;
          p.kind = 'wait';
          p.action = Math.random() < 0.55 ? 'phone' : 'idle';
          p.speed = 0;
          p.life = 22 + Math.random() * 30;
          delete p.targetS;
          this.placeOnSidewalk(p);
          this.renderer.set(p.h, p.x, p.y, p.z, p.yaw, p.action, p.phase);
          continue;
        }
        // (the sidewalk ends at the kerb where the junction box starts: walking on to
        // the node took people into the middle of the box, among the turning cars)
        const [kA, kB] = this.kerbs(seg, p.side);
        if (p.s < kA || p.s > kB) {
          // hop to a connected segment at the node
          const nodeId = p.s > kB ? seg.b : seg.a;
          const node = this.net.nodes.get(nodeId);
          // on foot, people cross one arm of a junction at a time, at the kerb: a road
          // reached only by walking diagonally over the box (over two or more arms)
          // isn't an option from this corner
          // Over an arm, the walk goes to that arm's kerb on this side, straight over
          // its crosswalk at the box's edge, and on to the next sidewalk (a straight
          // line from kerb to kerb cut through the box, among the turning cars).
          // Not over an arm whose kerbs sit well back from the box (a sharp corner:
          // the cars there don't stop short of them).
          const hand0 = p.side * p.dir;
          const route = (nid: number) => {
            const ns = this.net.segs.get(nid);
            if (!ns) return null;
            const dir = (ns.a === nodeId ? 1 : -1) as 1 | -1;
            const [nA, nB] = this.kerbs(ns, (hand0 * dir) as 1 | -1);
            const t = { ...p, seg: nid, dir, side: (hand0 * dir) as 1 | -1, s: dir > 0 ? nA + 0.5 : nB - 0.5 };
            this.placeOnSidewalk(t as Ped);
            const arms = this.armsCrossed(nodeId, p.x, p.z, t.x, t.z);
            if (!arms.length) return { arms, legs: [] as NonNullable<Ped['legs']>, tx: t.x, tz: t.z };
            if (arms.length > 1) return null;
            const xs = this.net.segs.get(arms[0])!, atA = xs.a === nodeId, trim = Math.max(0, (atA ? xs.trimA : xs.trimB) ?? 0);
            const q: V2[] = [];
            for (const sd of [1, -1] as const) {
              const [a, b] = this.kerbs(xs, sd);
              if ((atA ? a : xs.length - b) > trim + 1.5) return null;
              const k = { ...p, seg: xs.id, side: sd, dir: 1 as const, lat: 0, s: atA ? a : b };
              this.placeOnSidewalk(k as Ped);
              q.push({ x: k.x, z: k.z });
            }
            const [n1, n2] = Math.hypot(q[0].x - p.x, q[0].z - p.z) <= Math.hypot(q[1].x - p.x, q[1].z - p.z) ? q : [q[1], q[0]];
            if (this.armsCrossed(nodeId, p.x, p.z, n1.x, n1.z).length || this.armsCrossed(nodeId, n2.x, n2.z, t.x, t.z).length) return null;
            return { arms, legs: [{ x: n2.x, z: n2.z, cross: { node: nodeId, segs: arms } }, { x: t.x, z: t.z }], tx: n1.x, tz: n1.z };
          };
          const opts = (node ? node.segs.filter((id) => id !== seg.id) : []).filter((id) => route(id));
          if (!opts.length) {
            // dead end: turn round on the same sidewalk (stepping over to keep right)
            const fx = p.x, fz = p.z;
            p.dir = -p.dir as 1 | -1;
            p.s = clamp(p.s, kA, kB);
            this.placeOnSidewalk(p);
            const gd = Math.hypot(p.x - fx, p.z - fz);
            if (gd > 0.3) {
              this.goTo(p, fx, fz, p.x, p.z, false);
              const go = (p as Ped).go as Ped['go'];
              if (go) go.T = Math.max(0.4, gd / Math.max(0.8, p.speed));
              continue;
            }
          } else {
            const nid = p.nextSeg !== undefined && opts.includes(p.nextSeg) ? p.nextSeg : opts[Math.floor(Math.random() * opts.length)];
            const ns = this.net.segs.get(nid)!;
            // the side is relative to the road's direction: keep the walker on
            // their own hand (they used to pop across the street at corners)
            const hand = p.side * p.dir;
            const fx = p.x, fz = p.z;
            const was = { seg: p.seg, dir: p.dir, side: p.side, s: p.s };
            p.seg = nid;
            p.dir = ns.a === nodeId ? 1 : -1;
            p.side = (hand * p.dir) as 1 | -1;
            const [nA, nB] = this.kerbs(ns, p.side);
            p.s = p.dir > 0 ? nA + 0.5 : nB - 0.5;
            // (worked out from where they stand, before they're moved onto the next road)
            const rt = route(nid);
            this.placeOnSidewalk(p);
            // over a crosswalk: wait at the kerb for the walk phase at lights, or for no
            // car close (at a junction without lights, go anyway after a while: cars
            // stop for people on it); cross in groups, and let waiting cars go between
            const arms = rt?.arms ?? [];
            const tx = rt ? rt.tx : p.x, tz = rt ? rt.tz : p.z;
            const secs = (Math.hypot(tx - fx, tz - fz) + (rt?.legs.length ? Math.hypot(rt.legs[0].x - tx, rt.legs[0].z - tz) : 0)) / Math.max(0.8, p.speed);
            if (arms.length && this.canCross && (!this.crossingTurn(nodeId, arms) || !this.canCross(nodeId, arms, secs, (p.kerbWait ?? 0) >= KERB_PATIENCE))) {
              p.kerbWait = (p.kerbWait ?? 0) + dtReal * Math.max(0.3, Math.min(simSpeed, 3));
              p.seg = was.seg; p.dir = was.dir as 1 | -1; p.side = was.side as 1 | -1; p.s = clamp(was.s, kA, kB);
              p.nextSeg = nid;
              p.x = fx; p.z = fz;
              p.action = 'idle';
              this.renderer.set(p.h, p.x, p.y, p.z, p.ryaw ?? p.yaw, 'idle', p.phase);
              continue;
            }
            delete p.nextSeg;
            p.kerbWait = 0;
            p.action = 'walk';
            // round the corner (or over the crosswalk) on foot
            const gd = Math.hypot(tx - fx, tz - fz);
            if (rt?.legs.length) p.legs = rt.legs.map((l) => ({ ...l }));
            if (gd > 0.3 || p.legs) {
              this.goTo(p, fx, fz, tx, tz, false);
              const go = (p as Ped).go as Ped['go'];
              if (go) go.T = Math.max(0.4, gd / Math.max(0.8, p.speed));
              if (arms.length) p.crossing = { node: nodeId, segs: arms };
              continue;
            }
          }
        }
        this.placeOnSidewalk(p);
      } else if (p.kind === 'protest') {
        const seg = this.net.segs.get(p.seg);
        if (!seg || seg.blocked <= 0) { p.life = 0; continue; }
      }
      p.ryaw = p.ryaw === undefined ? p.yaw : angEase(p.ryaw, p.yaw, 1 - Math.exp(-dtReal * 8));
      this.renderer.set(p.h, p.x, p.y, p.z, p.ryaw, p.action, p.phase);
    }
    this.renderer.flush();
  }

  /** Front door of a building (lot-local +Z faces the road). */
  private door(b: Bld): V2 {
    const lz = b.hd - 1.2;
    return { x: b.x + lz * Math.sin(b.yaw), z: b.z + lz * Math.cos(b.yaw) };
  }

  /** Start a short walk from (fx,fz) to (tx,tz). */
  private goTo(p: Ped | Omit<Ped, 'h'>, fx: number, fz: number, tx: number, tz: number, remove: boolean) {
    const d = Math.hypot(tx - fx, tz - fz);
    p.go = { fx, fz, tx, tz, t: 0, T: Math.max(0.4, d / 1.3), remove };
    p.x = fx;
    p.z = fz;
    p.y = this.terrain.h(fx, fz) + 0.06;
  }

  /** Time's up: walk somewhere believable and disappear there. false = remove now. */
  private leave(p: Ped): boolean {
    if (p.leaving) return true;
    if (p.kind === 'walk' && (p.go || p.legs)) return true; // over the junction first (not straight from mid-road to a door)
    if (p.kind === 'walk') {
      // step into the nearest building along this street, on this side of it
      // (a door across the road meant a straight walk over the lanes, through the traffic)
      const seg = this.net.segs.get(p.seg);
      // (and close: a straight walk to a door 50 m away cut across the road)
      let best: Bld | null = null, bd = 14;
      for (const b of this.b.near(p.x, p.z, 20)) {
        if (b.seg !== p.seg || b.state !== 'active' || !isZoned(b)) continue;
        if (seg && sideOf(seg, b.x, b.z) !== p.side) continue;
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < bd) { bd = d; best = b; }
      }
      if (!best) {
        p.retries = (p.retries ?? 0) + 1;
        if (p.retries > 10) return false;
        p.life = 6; // keep strolling until a door comes up
        return true;
      }
      const dr = this.door(best);
      p.leaving = true;
      this.goTo(p, p.x, p.z, dr.x, dr.z, true);
      return true;
    }
    if (p.home) {
      p.leaving = true;
      this.goTo(p, p.x, p.z, p.home.x, p.home.z, true);
      return true;
    }
    return false;
  }

  /** Add a ped that walks in from `from` to its spot first. */
  private addFrom(p: Omit<Ped, 'h'>, from: V2) {
    const tx = p.x, tz = p.z;
    p.home = from;
    p.face = p.yaw;
    this.goTo(p, from.x, from.z, tx, tz, false);
    this.add(p);
  }

  private placeOnSidewalk(p: Ped) {
    const seg = this.net.segs.get(p.seg)!;
    const t = ROAD_TYPES[seg.type];
    const { i, f } = locate(seg.samp, clamp(p.s, 0, seg.length));
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tan = norm(sub(b, a));
    const r = { x: -tan.z, z: tan.x };
    const off = t.sidewalk > 0 ? t.width / 2 - t.sidewalk / 2 : t.width / 2 + 1.3; // no sidewalk: walk in the grass
    // walkers keep to their right, so two coming the other way pass instead of walking through each other
    const keep = p.kind === 'walk' ? Math.min(0.45, t.sidewalk * 0.22) * p.dir + (p.lat ?? 0) * p.dir : 0;
    p.x = lerp(a.x, b.x, f) + r.x * (off * p.side + keep);
    p.z = lerp(a.z, b.z, f) + r.z * (off * p.side + keep);
    p.y = t.sidewalk > 0 ? lerp(seg.hs[i], seg.hs[i + 1], f) + WALK_TOP + 0.02 : this.terrain.h(p.x, p.z);
    p.yaw = Math.atan2(tan.x * p.dir, tan.z * p.dir);
  }

  /** how many people are outside from each building right now */
  private outFrom() {
    const m = new Map<number, number>();
    for (const p of this.peds) if (p.fromBld !== undefined) m.set(p.fromBld, (m.get(p.fromBld) ?? 0) + 1);
    return m;
  }

  /** a building picked in proportion to its occupants, among those with room for one more outside */
  private pickBuilding(list: Bld[]): Bld | null {
    const out = this.outFrom();
    // one person out of a door every several seconds: people leaving together
    // walked off single file (the playtest's lines outside a factory)
    const ok = list.filter((b) => (out.get(b.id) ?? 0) < Math.max(1, Math.ceil(b.occ * 0.12)) && this.clock - (this.lastOut.get(b.id) ?? -1e9) >= DOOR_GAP + (b.id % 5));
    let total = 0;
    for (const b of ok) total += Math.max(1, b.occ);
    let r = Math.random() * total;
    let pick: Bld | null = ok[ok.length - 1] ?? null;
    for (const b of ok) { r -= Math.max(1, b.occ); if (r <= 0) { pick = b; break; } }
    if (pick) this.lastOut.set(pick.id, this.clock);
    return pick;
  }

  private trySpawn(cam: THREE.Vector3, R: number, town = true, communeOk = true) {
    const r = communeOk && !town ? 0.18 : Math.random();
    if (!town && r >= 0.2) return;
    // codex:transit begin - turn simulated boardings into small visible waiting crowds
    if (r < 0.16 && this.transitStops && town) {
      const atStop = new Map<number, number>();
      for (const p of this.peds) if (p.transitStopId !== undefined) atStop.set(p.transitStopId, (atStop.get(p.transitStopId) ?? 0) + 1);
      const stops = this.transitStops().filter((s) => {
        const seg = this.net.segs.get(s.seg);
        if (!seg) return false;
        const p = seg.samp.pts[Math.min(seg.samp.pts.length - 1, Math.round((s.s / seg.length) * (seg.samp.pts.length - 1)))];
        return Math.abs(p.x - cam.x) < R && Math.abs(p.z - cam.z) < R && (atStop.get(s.id) ?? 0) < Math.min(8, Math.ceil(s.riders / 8));
      });
      const stop = stops[Math.floor(Math.random() * stops.length)];
      const seg = stop && this.net.segs.get(stop.seg);
      if (stop && seg) {
        const approach = 18 + Math.random() * 34;
        const dir: 1 | -1 = stop.s > seg.length / 2 ? -1 : 1;
        const startS = clamp(stop.s - approach * dir, 0, seg.length);
        const p: Omit<Ped, 'h'> = { arch: this.archFor('wait'), kind: 'walk', action: 'walk', seg: stop.seg, dir, s: startS, side: stop.side, speed: 1.05 + Math.random() * 0.35, life: 65, x: 0, y: 0, z: 0, yaw: 0, phase: Math.random() * 10, label: stop.label, transitStopId: stop.id, targetS: stop.s };
        this.placeOnSidewalk(p as Ped);
        // riders come out of a building on that street when there is one
        const from = this.b.near(p.x, p.z, 70).find((b) => b.seg === stop.seg && b.state === 'active' && isZoned(b));
        if (from) { const dr = this.door(from); this.goTo(p, dr.x, dr.z, p.x, p.z, false); }
        this.add(p);
        return;
      }
    }
    // codex:transit end
    // commune folks
    if (r < 0.2 && communeOk) {
      const c = this.communes.list.find((c) => c.state !== 'gone' && Math.abs(c.x - cam.x) < R && Math.abs(c.z - cam.z) < R && this.peds.filter((p) => p.communeId === c.id).length < Math.min(24, c.members));
      if (c) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * c.r * 0.7;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        const acts: PersonAction[] = ['drum', 'dance', 'yoga', 'smoke', 'idle', 'dance', 'drum', 'sit'];
        // codex:policies begin -- smoke-free districts suppress visible smoking actions
        let action = acts[Math.floor(Math.random() * acts.length)];
        if (action === 'smoke' && this.policySmokingAllowedAt?.(x, z) === false) action = 'idle';
        // codex:policies end
        const hx = c.x + (Math.random() - 0.5) * 6, hz = c.z + (Math.random() - 0.5) * 6;
        this.addFrom({ arch: this.archFor('commune'), kind: 'commune', action, seg: 0, dir: 1, s: 0, side: 1, speed: 0, life: 60 + Math.random() * 90, x, y: this.terrain.h(x, z), z, yaw: Math.atan2(c.x + 8 - x, c.z - 4 - z), phase: Math.random() * 10, communeId: c.id, label: c.name }, { x: hx, z: hz });
        return;
      }
    }
    // everything below is the town's own people: only when its budget has room
    if (!town) return;
    // protesters on blocked segments
    if (r < 0.32) {
      for (const seg of this.net.segsNear(cam.x - R, cam.z - R, cam.x + R, cam.z + R)) {
        if (seg.blocked <= 0 || !seg.name.startsWith('')) continue;
        const protestors = this.peds.filter((p) => p.kind === 'protest' && p.seg === seg.id).length;
        if (protestors > 14) continue;
        const { i, f } = locate(seg.samp, seg.length / 2 + (Math.random() - 0.5) * 16);
        const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
        const tan = norm(sub(b, a));
        const w = (Math.random() - 0.5) * ROAD_TYPES[seg.type].width * 0.8;
        const x = lerp(a.x, b.x, f) - tan.z * w, z = lerp(a.z, b.z, f) + tan.x * w;
        const side = Math.random() < 0.5 ? 1 : -1, hw = ROAD_TYPES[seg.type].width / 2 + 1.5;
        const curb = { x: lerp(a.x, b.x, f) - tan.z * hw * side, z: lerp(a.z, b.z, f) + tan.x * hw * side };
        this.addFrom({ arch: this.archFor('protest'), kind: 'protest', action: 'protest', seg: seg.id, dir: 1, s: 0, side: 1, speed: 0, life: 200, x, y: lerp(seg.hs[i], seg.hs[i + 1], f) + 0.1, z, yaw: Math.atan2(tan.x, tan.z) + (Math.random() < 0.5 ? 0 : Math.PI), phase: Math.random() * 10, label: 'Protester' }, curb);
        return;
      }
    }
    // loiterers outside businesses
    if (r < 0.55) {
      const list = this.b.near(cam.x, cam.z, R).filter((b) => b.state === 'active' && b.occ > 0 && (b.zone === 'comLow' || b.zone === 'comHigh' || b.zone === 'office' || b.zone === 'resHigh'));
      const bld = list.length ? this.pickBuilding(list) : null;
      if (bld) {
        const c = Math.cos(bld.yaw), s = Math.sin(bld.yaw);
        const lx = (Math.random() - 0.5) * bld.hw * 1.6, lz = bld.hd - 2 - Math.random() * 3;
        const x = bld.x + lx * c + lz * s, z = bld.z - lx * s + lz * c;
        const arch = this.archFor('loiter', bld.brand);
        // codex:policies begin -- smoke-free districts remove smoke/vape loiter actions
        let vices = ARCHETYPES[arch]?.vices?.length ? [...ARCHETYPES[arch].vices] : (['smoke', 'phone', 'drink', 'vape'] as PersonAction[]);
        if (this.policySmokingAllowedAt?.(x, z) === false) vices = vices.filter((a) => a !== 'smoke' && a !== 'vape');
        if (!vices.length) vices = ['phone'];
        // codex:policies end
        this.addFrom({ arch, kind: 'loiter', action: vices[Math.floor(Math.random() * vices.length)], seg: 0, dir: 1, s: 0, side: 1, speed: 0, life: 25 + Math.random() * 40, x, y: bld.y + 0.05, z, yaw: bld.yaw + (Math.random() - 0.5) * 1.5, phase: Math.random() * 10, label: bld.label, fromBld: bld.id }, this.door(bld));
        return;
      }
    }
    // residents out in their yards: a beer on the lawn, on the phone, a smoke, the backyard hang
    if (r < 0.72) {
      const yards = this.b.near(cam.x, cam.z, R).filter((b) => b.state === 'active' && b.zone === 'resLow' && b.occ > 0 && b.abandoned === undefined);
      const bld = yards.length ? this.pickBuilding(yards) : null;
      if (bld) {
        const c = Math.cos(bld.yaw), s = Math.sin(bld.yaw);
        const back = Math.random() < 0.5;
        const lx = (Math.random() - 0.5) * bld.hw * 1.3, lz = back ? -bld.hd + 2 + Math.random() * 2.5 : bld.hd - 1.6 - Math.random() * 2;
        const at = (ox: number, oz: number) => ({ x: bld.x + ox * c + oz * s, z: bld.z - ox * s + oz * c });
        const acts: PersonAction[] = back ? ['drink', 'drink', 'phone', 'smoke', 'idle', 'dance', 'drink'] : ['phone', 'idle', 'drink', 'smoke', 'idle'];
        const pick = () => {
          const a = acts[Math.floor(Math.random() * acts.length)];
          return (a === 'smoke' || a === 'vape') && this.policySmokingAllowedAt?.(bld.x, bld.z) === false ? 'idle' : a;
        };
        // out back, often two of them facing each other
        const pals = back && Math.random() < 0.45 ? 2 : 1;
        // they come round the side of the house (the front door for the front yard)
        const from = back ? at(Math.sign(lx || 1) * bld.hw * 0.9, lz) : this.door(bld);
        for (let k = 0; k < pals; k++) {
          const p = at(lx + k * 1.3, lz);
          const yaw = pals > 1 ? bld.yaw + (k ? -Math.PI / 2 : Math.PI / 2) : bld.yaw + (back ? Math.PI : 0) + (Math.random() - 0.5) * 1.2;
          this.addFrom({ arch: this.archFor('loiter'), kind: 'loiter', action: pick(), seg: 0, dir: 1, s: 0, side: 1, speed: 0, life: 30 + Math.random() * 45, x: p.x, y: this.terrain.h(p.x, p.z) + 0.05, z: p.z, yaw, phase: Math.random() * 10, label: bld.label, fromBld: bld.id }, from);
        }
        return;
      }
    }
    // sidewalk walkers walk out of a front door onto the sidewalk
    const homes = this.b.near(cam.x, cam.z, R).filter((b) => b.state === 'active' && isZoned(b) && b.abandoned === undefined && b.occ > 0);
    const bld = homes.length ? this.pickBuilding(homes) : null;
    if (!bld) return;
    const seg: RSeg | undefined = this.net.segs.get(bld.seg);
    if (!seg || seg.type === 'highway') return;
    const c = closestOnSampled({ x: bld.x, z: bld.z }, seg.samp);
    // anywhere along the frontage, not all from the same spot
    const sAt = clamp(c.s + (Math.random() - 0.5) * Math.min(10, bld.hw * 1.6), 1, seg.length - 1);
    const { i, f } = locate(seg.samp, sAt);
    const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
    const tan = norm(sub(b, a));
    const side: 1 | -1 = (bld.x - lerp(a.x, b.x, f)) * -tan.z + (bld.z - lerp(a.z, b.z, f)) * tan.x >= 0 ? 1 : -1;
    const p: Omit<Ped, 'h'> = { arch: this.archFor('walk', bld.brand), kind: 'walk', action: Math.random() < 0.1 ? 'run' : 'walk', seg: seg.id, dir: Math.random() < 0.5 ? 1 : -1, s: sAt, side, speed: 1.1 + Math.random() * 0.6, life: 40 + Math.random() * 60, x: 0, y: 0, z: 0, yaw: 0, phase: Math.random() * 10, label: seg.name, fromBld: bld.id, lat: 0 };
    if (p.action === 'run') p.speed = 3;
    this.placeOnSidewalk(p as Ped);
    // a quarter walk with someone, side by side, in step-ish
    if (p.action === 'walk' && (ROAD_TYPES[seg.type].sidewalk > 1.5) && Math.random() < 0.25 && this.peds.length < this.max - 1) {
      const q: Omit<Ped, 'h'> = { ...p, arch: this.archFor('walk', bld.brand), lat: -0.72, phase: p.phase + 0.45 + Math.random() * 0.1, x: 0, y: 0, z: 0 };
      this.placeOnSidewalk(q as Ped);
      const dr = this.door(bld);
      this.goTo(q as Ped, dr.x, dr.z, q.x, q.z, false);
      if (q.go) q.go.T += 0.5;
      this.add(q);
    }
    const dr = this.door(bld);
    this.goTo(p, dr.x, dr.z, p.x, p.z, false);
    this.add(p);
  }

  pick(ray: THREE.Raycaster): Ped | null {
    const h = this.renderer.pick(ray);
    if (h === null) return null;
    return this.peds.find((p) => p.h === h) ?? null;
  }

  setNight(n: number) {
    this.renderer.setNight(n);
  }
}
