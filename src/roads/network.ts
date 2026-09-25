// Road graph: nodes + cubic-bezier segments. Handles snapping, splitting at
// crossings, vertical profiles (bridges over water), terrain grading, trims at
// intersections, upgrades (ONE MORE LANE) and removal.
import { WATER } from '../config';
import { Emitter } from '../core/events';
import {
  bezPoint, clamp, closestOnSampled, Cubic, dist, lerp, lineCubic, norm, Sampled, sampleCubic, segIntersect,
  smoothstep, SpatialHash, splitCubic, sub, tangentAt, V2,
} from '../core/math';
import type { Terrain } from '../world/terrain';
import type { Trees } from '../world/trees';
import { ROAD_TYPES, RoadType, RoadTypeId } from './roadTypes';
import { roadName } from './names';

export interface RNode {
  id: number;
  x: number;
  z: number;
  y: number;
  segs: number[];
}

export interface RSeg {
  id: number;
  a: number;
  b: number;
  type: RoadTypeId;
  curve: Cubic;
  samp: Sampled;
  hs: number[]; // road surface height per sample
  ground: number[]; // terrain height under each sample at build time
  length: number;
  name: string;
  street: number; // segments drawn in one stroke share a street id
  trimA: number;
  trimB: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  builtDay: number;
  /** vehicles currently on the segment, per direction [a->b, b->a] */
  load: [number, number];
  /** smoothed congestion 0..1+ (volume / capacity) */
  vc: number;
  blocked: number; // seconds a lane is blocked (crash, protest)
}

export type Snap =
  | { kind: 'node'; id: number; x: number; z: number }
  | { kind: 'seg'; id: number; t: number; x: number; z: number }
  | { kind: 'free'; x: number; z: number };

export interface Plan {
  ok: boolean;
  reason?: string;
  length: number;
  cost: number;
  grant: number;
  bridgeLen: number;
  crossings: V2[];
}

type Events = {
  segAdded: RSeg;
  segRemoved: RSeg;
  segChanged: RSeg;
  nodeChanged: RNode;
  changed: void;
};

type SegRow = [number, number, number, RoadTypeId, [number, number][], string, number, number];

const MAX_PIECE = 110; // long strokes are split into pieces this long
const BRIDGE_DECK = WATER + 5.5;

export class RoadNetwork {
  nodes = new Map<number, RNode>();
  segs = new Map<number, RSeg>();
  events = new Emitter<Events>();
  day = 0;
  private nextNode = 1;
  private nextSeg = 1;
  private nextStreet = 1;
  private hash = new SpatialHash<number>(64);
  /** Areas where roads may not go (hippie communes). */
  blockers: { x: number; z: number; r: number; name: string }[] = [];
  /** land the player may build on (null = everywhere); see sim/land.ts */
  allowed: ((x: number, z: number) => boolean) | null = null;

  constructor(public terrain: Terrain, public trees: Trees) {}

  type(id: RoadTypeId): RoadType {
    return ROAD_TYPES[id];
  }

  // ------------------------------------------------------------------ queries
  segsNear(minX: number, minZ: number, maxX: number, maxZ: number): RSeg[] {
    const out: RSeg[] = [];
    for (const id of this.hash.query(minX, minZ, maxX, maxZ)) {
      const s = this.segs.get(id);
      if (s && s.maxX >= minX && s.minX <= maxX && s.maxZ >= minZ && s.minZ <= maxZ) out.push(s);
    }
    return out;
  }

  /** Closest segment to a point within maxDist of its edge. */
  pickSeg(x: number, z: number, extra = 2): { seg: RSeg; s: number; t: number; d: number } | null {
    let best: { seg: RSeg; s: number; t: number; d: number } | null = null;
    for (const seg of this.segsNear(x - 40, z - 40, x + 40, z + 40)) {
      const c = closestOnSampled({ x, z }, seg.samp);
      const hw = this.type(seg.type).width / 2;
      if (c.d < hw + extra && (!best || c.d - hw < best.d)) best = { seg, s: c.s, t: c.t, d: c.d - hw };
    }
    return best;
  }

  snap(x: number, z: number, radius = 10): Snap {
    let bestNode: RNode | null = null;
    let bd = Infinity;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      const hw = Math.max(0, ...n.segs.map((s) => this.type(this.segs.get(s)!.type).width / 2));
      if (d < Math.max(radius, hw + 3) && d < bd) { bd = d; bestNode = n; }
    }
    if (bestNode) return { kind: 'node', id: bestNode.id, x: bestNode.x, z: bestNode.z };
    const p = this.pickSeg(x, z, 3);
    if (p) {
      const pt = bezPoint(p.seg.curve, p.t);
      // snap to an end node if we're close to one
      const len = p.seg.length;
      if (p.s < 12) { const n = this.nodes.get(p.seg.a)!; return { kind: 'node', id: n.id, x: n.x, z: n.z }; }
      if (len - p.s < 12) { const n = this.nodes.get(p.seg.b)!; return { kind: 'node', id: n.id, x: n.x, z: n.z }; }
      return { kind: 'seg', id: p.seg.id, t: p.t, x: pt.x, z: pt.z };
    }
    return { kind: 'free', x, z };
  }

  /** Direction a snapped road would continue in (for freeform/curve tools). */
  continueDir(s: Snap): V2 | null {
    if (s.kind !== 'node') return null;
    const n = this.nodes.get(s.id)!;
    if (n.segs.length !== 1) return null;
    const seg = this.segs.get(n.segs[0])!;
    const pts = seg.samp.pts;
    if (seg.a === n.id) return norm(sub(pts[0], pts[Math.min(3, pts.length - 1)]));
    return norm(sub(pts[pts.length - 1], pts[Math.max(0, pts.length - 4)]));
  }

  // ------------------------------------------------------------------ planning
  plan(start: Snap, curve: Cubic, typeId: RoadTypeId, money = Infinity): Plan {
    const t = this.type(typeId);
    const samp = sampleCubic(curve, 4);
    const crossings: V2[] = [];
    const res: Plan = { ok: true, length: samp.length, cost: 0, grant: 0, bridgeLen: 0, crossings };
    if (samp.length < 8) return { ...res, ok: false, reason: 'Too short' };
    let prevAng: number | null = null;
    let water = 0;
    for (let i = 0; i < samp.pts.length; i++) {
      const p = samp.pts[i];
      if (!this.terrain.inBounds(p.x, p.z, 6)) return { ...res, ok: false, reason: 'Outside the county line' };
      if (this.allowed && !this.allowed(p.x, p.z)) return { ...res, ok: false, reason: "You don't own this land yet. Buy it in 🏞️ Land." };
      if (this.terrain.h(p.x, p.z) < WATER + 0.4) water += i > 0 ? samp.cum[i] - samp.cum[i - 1] : 0;
      for (const b of this.blockers) {
        if (Math.hypot(p.x - b.x, p.z - b.z) < b.r + t.width / 2) return { ...res, ok: false, reason: `${b.name} won't let you. Pay them off or sue.` };
      }
      if (i > 0) {
        const d = sub(p, samp.pts[i - 1]);
        const ang = Math.atan2(d.z, d.x);
        if (prevAng !== null) {
          let da = Math.abs(ang - prevAng);
          if (da > Math.PI) da = Math.PI * 2 - da;
          if (da > 0.5) return { ...res, ok: false, reason: 'Curve too tight' };
        }
        prevAng = ang;
      }
    }
    // overlap with existing roads running alongside (not just crossing)
    for (const seg of this.segsNear(Math.min(curve.p0.x, curve.p3.x) - 80, Math.min(curve.p0.z, curve.p3.z) - 80, Math.max(curve.p0.x, curve.p3.x) + 80, Math.max(curve.p0.z, curve.p3.z) + 80)) {
      const hw = (this.type(seg.type).width + t.width) / 2 - 1;
      let close = 0;
      for (let i = 2; i < samp.pts.length - 2; i++) {
        const c = closestOnSampled(samp.pts[i], seg.samp);
        if (c.d >= hw * 0.7) continue;
        // only count stretches that run alongside; a clean crossing is fine
        const a = sub(samp.pts[i + 1], samp.pts[i - 1]);
        const b = tangentAt(seg.samp, c.s);
        const al = Math.hypot(a.x, a.z) || 1, bl = Math.hypot(b.x, b.z) || 1;
        if (Math.abs((a.x * b.x + a.z * b.z) / (al * bl)) > 0.75) close++;
      }
      if (close > 4) return { ...res, ok: false, reason: 'Overlaps an existing road' };
      for (const x of this.crossingsWith(samp, seg)) crossings.push(x.p);
    }
    // grade between the two ends: the road can cut and fill between them, but
    // not climb a cliff (heights are what the junctions would actually get)
    {
      const ya = start.kind === 'node' ? this.nodes.get(start.id)!.y : this.nodeHeight(samp.pts[0].x, samp.pts[0].z);
      const pe = samp.pts[samp.pts.length - 1];
      const snapEnd = this.snap(pe.x, pe.z, 6);
      const yb = snapEnd.kind === 'node' ? this.nodes.get(snapEnd.id)!.y : this.nodeHeight(pe.x, pe.z);
      if (Math.abs(yb - ya) > 0.15 * samp.length + 2) return { ...res, ok: false, reason: `Too steep (${Math.round((Math.abs(yb - ya) / samp.length) * 100)}% grade). Go around or zig-zag.` };
    }
    res.bridgeLen = water;
    res.cost = Math.round(samp.length * t.costPerM + water * t.costPerM * 2.5);
    res.grant = Math.round(res.cost * t.fedGrant);
    if (res.cost - res.grant > money) return { ...res, ok: false, reason: 'Not enough money (try a loan, or a lawsuit)' };
    return res;
  }

  private crossingsWith(samp: Sampled, seg: RSeg): { p: V2; tNew: number }[] {
    const out: { p: V2; tNew: number }[] = [];
    const a = samp.pts, b = seg.samp.pts;
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < b.length - 1; j++) {
        const r = segIntersect(a[i], a[i + 1], b[j], b[j + 1]);
        if (r) {
          const tNew = lerp(samp.ts[i], samp.ts[i + 1], r.u);
          out.push({ p: { x: a[i].x + (a[i + 1].x - a[i].x) * r.u, z: a[i].z + (a[i + 1].z - a[i].z) * r.u }, tNew });
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ building
  /** Ground height for a new junction: averaged over the junction's footprint
   *  so a node on a crest or in a gully doesn't pin the road to a spike. */
  nodeHeight(x: number, z: number): number {
    const g = this.terrain.h(x, z);
    if (g < WATER + 0.6) return BRIDGE_DECK;
    let s = g * 2, c = 2;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      for (const r of [8, 18]) {
        const h = this.terrain.h(x + Math.cos(a) * r, z + Math.sin(a) * r);
        if (h < WATER + 0.6) continue;
        s += h;
        c++;
      }
    }
    return s / c;
  }

  private addNode(x: number, z: number): RNode {
    const n: RNode = { id: this.nextNode++, x, z, y: this.nodeHeight(x, z), segs: [] };
    this.nodes.set(n.id, n);
    return n;
  }

  private resolve(s: Snap): RNode {
    if (s.kind === 'node') return this.nodes.get(s.id)!;
    if (s.kind === 'seg') {
      const seg = this.segs.get(s.id);
      if (seg) return this.splitSeg(seg, s.t);
      return this.addNode(s.x, s.z);
    }
    // a free point may still land right on a node/segment created mid-build
    const again = this.snap(s.x, s.z, 4);
    if (again.kind !== 'free') return this.resolve(again);
    return this.addNode(s.x, s.z);
  }

  /** Build a road. Returns the created segments (possibly several). */
  build(start: Snap, end: Snap, curve: Cubic, typeId: RoadTypeId, streetName?: string): RSeg[] {
    const street = this.nextStreet++;
    const samp = sampleCubic(curve, 4);
    const name = streetName ?? roadName(typeId, this.terrain, samp.pts[Math.floor(samp.pts.length / 2)], this.map);
    // gather crossing points with existing roads
    const cross: { p: V2; tNew: number }[] = [];
    for (const seg of this.segsNear(Math.min(curve.p0.x, curve.p3.x, curve.p1.x, curve.p2.x) - 20, Math.min(curve.p0.z, curve.p3.z, curve.p1.z, curve.p2.z) - 20, Math.max(curve.p0.x, curve.p3.x, curve.p1.x, curve.p2.x) + 20, Math.max(curve.p0.z, curve.p3.z, curve.p1.z, curve.p2.z) + 20)) {
      cross.push(...this.crossingsWith(samp, seg));
    }
    const startNode = this.resolve(start);
    const endNode = this.resolve(end);
    // stops along the new road: [param t, node]
    const stops: { t: number; node: RNode }[] = [{ t: 0, node: startNode }];
    cross.sort((a, b) => a.tNew - b.tNew);
    for (const c of cross) {
      const pt = bezPoint(curve, c.tNew);
      if (dist(pt, startNode) < 10 || dist(pt, endNode) < 10) continue;
      if (stops.length && dist(pt, stops[stops.length - 1].node) < 8) continue;
      const sn = this.snap(pt.x, pt.z, 8);
      if (sn.kind === 'free') continue;
      const node = this.resolve(sn);
      stops.push({ t: c.tNew, node });
    }
    stops.push({ t: 1, node: endNode });

    // split the new curve at the stops and add long-piece intermediate nodes
    const created: RSeg[] = [];
    let rest: Cubic = curve;
    let restT0 = 0;
    for (let k = 1; k < stops.length; k++) {
      const a = stops[k - 1], b = stops[k];
      if (a.node === b.node) continue;
      let piece: Cubic;
      if (k === stops.length - 1) piece = rest;
      else {
        const local = (b.t - restT0) / (1 - restT0);
        const [p1, p2] = splitCubic(rest, clamp(local, 0.001, 0.999));
        piece = p1;
        rest = p2;
        restT0 = b.t;
      }
      piece = { ...piece, p0: { x: a.node.x, z: a.node.z }, p3: { x: b.node.x, z: b.node.z } };
      // chop long pieces
      const len = sampleCubic(piece, 8).length;
      const parts = Math.max(1, Math.ceil(len / MAX_PIECE));
      let from = a.node;
      let cur = piece;
      for (let q = 0; q < parts; q++) {
        let sub_: Cubic;
        let to: RNode;
        if (q === parts - 1) { sub_ = cur; to = b.node; }
        else {
          const [x1, x2] = splitCubic(cur, 1 / (parts - q));
          sub_ = x1;
          cur = x2;
          to = this.addNode(x1.p3.x, x1.p3.z);
        }
        const s = this.addSeg(from, to, { ...sub_, p0: { x: from.x, z: from.z }, p3: { x: to.x, z: to.z } }, typeId, name, street);
        if (s) created.push(s);
        from = to;
      }
    }
    for (const s of created) this.finalizeSeg(s);
    const touched = new Set<number>();
    for (const s of created) { touched.add(s.a); touched.add(s.b); }
    for (const id of touched) this.updateTrims(id);
    this.events.emit('changed', undefined);
    return created;
  }

  map: { id: string } = { id: 'appalachia' };

  // ------------------------------------------------------------------ save / load
  serialize() {
    return {
      nodes: [...this.nodes.values()].map((n): [number, number, number, number] => [n.id, +n.x.toFixed(2), +n.z.toFixed(2), +n.y.toFixed(2)]),
      segs: [...this.segs.values()].map((s): SegRow => [s.id, s.a, s.b, s.type, [s.curve.p0, s.curve.p1, s.curve.p2, s.curve.p3].map((p) => [+p.x.toFixed(2), +p.z.toFixed(2)] as [number, number]), s.name, s.street, Math.round(s.builtDay)]),
      next: [this.nextNode, this.nextSeg, this.nextStreet] as [number, number, number],
    };
  }

  restore(data: ReturnType<RoadNetwork['serialize']>) {
    for (const [id, x, z, y] of data.nodes) this.nodes.set(id, { id, x, z, y, segs: [] });
    const made: RSeg[] = [];
    for (const [id, a, b, type, pts, name, street, built] of data.segs) {
      const A = this.nodes.get(a), B = this.nodes.get(b);
      if (!A || !B) continue;
      this.nextSeg = id;
      const curve = { p0: { x: pts[0][0], z: pts[0][1] }, p1: { x: pts[1][0], z: pts[1][1] }, p2: { x: pts[2][0], z: pts[2][1] }, p3: { x: pts[3][0], z: pts[3][1] } };
      const s = this.addSeg(A, B, curve, type, name, street);
      if (s) { s.builtDay = built; made.push(s); }
    }
    [this.nextNode, this.nextSeg, this.nextStreet] = data.next;
    for (const s of made) this.finalizeSeg(s);
    for (const id of this.nodes.keys()) this.updateTrims(id);
    this.events.emit('changed', undefined);
  }

  private addSeg(a: RNode, b: RNode, curve: Cubic, type: RoadTypeId, name: string, street: number): RSeg | null {
    if (a.id === b.id) return null;
    // avoid duplicate segment between same nodes
    for (const sid of a.segs) {
      const s = this.segs.get(sid)!;
      if ((s.a === a.id && s.b === b.id) || (s.a === b.id && s.b === a.id)) return null;
    }
    const samp = sampleCubic(curve, 2);
    const seg: RSeg = {
      id: this.nextSeg++, a: a.id, b: b.id, type, curve, samp, hs: [], ground: [], length: samp.length, name, street,
      trimA: 0, trimB: 0, minX: 0, minZ: 0, maxX: 0, maxZ: 0, builtDay: this.day, load: [0, 0], vc: 0, blocked: 0,
    };
    this.computeBounds(seg);
    this.computeProfile(seg);
    this.segs.set(seg.id, seg);
    this.hash.insert(seg.id, seg.minX, seg.minZ, seg.maxX, seg.maxZ);
    a.segs.push(seg.id);
    b.segs.push(seg.id);
    return seg;
  }

  private computeBounds(seg: RSeg) {
    const hw = this.type(seg.type).width / 2 + 4;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of seg.samp.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    seg.minX = minX - hw; seg.minZ = minZ - hw; seg.maxX = maxX + hw; seg.maxZ = maxZ + hw;
  }

  /** Vertical profile: follow smoothed terrain, bridge over water, cap grade. */
  private computeProfile(seg: RSeg) {
    const pts = seg.samp.pts;
    const n = pts.length;
    const A = this.nodes.get(seg.a)!, B = this.nodes.get(seg.b)!;
    const ground = pts.map((p) => this.terrain.h(p.x, p.z));
    let y = ground.map((g) => (g < WATER + 0.6 ? BRIDGE_DECK : g));
    for (let pass = 0; pass < 4; pass++) {
      const next = y.slice();
      for (let i = 1; i < n - 1; i++) {
        let s = 0, c = 0;
        for (let k = -4; k <= 4; k++) { const j = clamp(i + k, 0, n - 1); s += y[j]; c++; }
        next[i] = s / c;
      }
      y = next;
    }
    const L = seg.samp.length;
    for (let i = 0; i < n; i++) {
      const d = seg.samp.cum[i];
      const wa = 1 - smoothstep(0, Math.min(24, L / 2), d);
      const wb = 1 - smoothstep(0, Math.min(24, L / 2), L - d);
      y[i] = lerp(lerp(y[i], A.y, wa), B.y, wb * (1 - wa));
      if (ground[i] < WATER + 0.6) y[i] = Math.max(y[i], WATER + 3.2);
    }
    // grade clamp with both ends pinned: alternate forward/backward passes until
    // consistent (a single pair of passes can leave a cliff next to an endpoint)
    const g = Math.max(0.11, (Math.abs(B.y - A.y) / Math.max(1, L)) * 1.05);
    for (let it = 0; it < 6; it++) {
      y[0] = A.y;
      y[n - 1] = B.y;
      let moved = 0;
      for (let i = 1; i < n - 1; i++) {
        const ds = seg.samp.cum[i] - seg.samp.cum[i - 1];
        const v = clamp(y[i], y[i - 1] - g * ds, y[i - 1] + g * ds);
        moved += Math.abs(v - y[i]);
        y[i] = v;
      }
      for (let i = n - 2; i >= 1; i--) {
        const ds = seg.samp.cum[i + 1] - seg.samp.cum[i];
        const v = clamp(y[i], y[i + 1] - g * ds, y[i + 1] + g * ds);
        moved += Math.abs(v - y[i]);
        y[i] = v;
      }
      if (moved < 0.01) break;
    }
    y[0] = A.y;
    y[n - 1] = B.y;
    seg.hs = y;
    seg.ground = ground;
  }

  private finalizeSeg(seg: RSeg) {
    const t = this.type(seg.type);
    this.terrain.gradeRoad(seg.samp.pts, seg.hs, t.width / 2);
    const hw = t.width / 2 + 2.5;
    const pts = seg.samp.pts;
    this.trees.cut(seg.minX, seg.minZ, seg.maxX, seg.maxZ, (x, z) => {
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i], b = pts[i + 1];
        const abx = b.x - a.x, abz = b.z - a.z;
        const l2 = abx * abx + abz * abz || 1;
        const tt = clamp(((x - a.x) * abx + (z - a.z) * abz) / l2, 0, 1);
        if (Math.hypot(a.x + abx * tt - x, a.z + abz * tt - z) < hw) return true;
      }
      return false;
    });
    this.events.emit('segAdded', seg);
  }

  /** Split a segment at curve param t; returns the new middle node. */
  splitSeg(seg: RSeg, t: number): RNode {
    const pt = bezPoint(seg.curve, t);
    const A = this.nodes.get(seg.a)!, B = this.nodes.get(seg.b)!;
    if (dist(pt, A) < 6) return A;
    if (dist(pt, B) < 6) return B;
    const [c1, c2] = splitCubic(seg.curve, t);
    // height at split = road surface height there
    const idx = Math.round(t * (seg.hs.length - 1));
    const node: RNode = { id: this.nextNode++, x: pt.x, z: pt.z, y: seg.hs[clamp(idx, 0, seg.hs.length - 1)], segs: [] };
    this.nodes.set(node.id, node);
    this.detachSeg(seg);
    const s1 = this.addSeg(A, node, { ...c1, p3: { x: node.x, z: node.z } }, seg.type, seg.name, seg.street)!;
    const s2 = this.addSeg(node, B, { ...c2, p0: { x: node.x, z: node.z } }, seg.type, seg.name, seg.street)!;
    s1.builtDay = s2.builtDay = seg.builtDay;
    this.events.emit('segAdded', s1);
    this.events.emit('segAdded', s2);
    this.updateTrims(A.id);
    this.updateTrims(B.id);
    this.updateTrims(node.id);
    return node;
  }

  private detachSeg(seg: RSeg) {
    this.segs.delete(seg.id);
    this.hash.remove(seg.id, seg.minX, seg.minZ, seg.maxX, seg.maxZ);
    for (const nid of [seg.a, seg.b]) {
      const n = this.nodes.get(nid);
      if (n) n.segs = n.segs.filter((s) => s !== seg.id);
    }
    this.events.emit('segRemoved', seg);
  }

  removeSeg(id: number) {
    const seg = this.segs.get(id);
    if (!seg) return;
    this.detachSeg(seg);
    for (const nid of [seg.a, seg.b]) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      if (n.segs.length === 0) {
        this.nodes.delete(nid);
        this.events.emit('nodeChanged', n);
      } else this.updateTrims(nid);
    }
    this.events.emit('changed', undefined);
  }

  /** ONE MORE LANE: bump a segment to the next road type. */
  upgrade(id: number, to?: RoadTypeId): RSeg | null {
    const seg = this.segs.get(id);
    if (!seg) return null;
    const next = to ?? this.type(seg.type).next;
    if (!next) return null;
    this.hash.remove(seg.id, seg.minX, seg.minZ, seg.maxX, seg.maxZ);
    seg.type = next;
    seg.builtDay = this.day;
    this.computeBounds(seg);
    this.hash.insert(seg.id, seg.minX, seg.minZ, seg.maxX, seg.maxZ);
    this.finalizeSegChanged(seg);
    this.updateTrims(seg.a);
    this.updateTrims(seg.b);
    this.events.emit('changed', undefined);
    return seg;
  }

  private finalizeSegChanged(seg: RSeg) {
    const t = this.type(seg.type);
    this.terrain.gradeRoad(seg.samp.pts, seg.hs, t.width / 2);
    const hw = t.width / 2 + 2.5;
    const pts = seg.samp.pts;
    this.trees.cut(seg.minX, seg.minZ, seg.maxX, seg.maxZ, (x, z) => closestOnSampled({ x, z }, seg.samp).d < hw);
    void pts;
    this.events.emit('segChanged', seg);
  }

  /** Intersection trims: pull segment ends back so junction polygons fit. */
  updateTrims(nodeId: number) {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    const ends = n.segs.map((sid) => {
      const s = this.segs.get(sid)!;
      const atA = s.a === n.id;
      const pts = s.samp.pts;
      const dir = atA ? norm(sub(pts[Math.min(2, pts.length - 1)], pts[0])) : norm(sub(pts[Math.max(0, pts.length - 3)], pts[pts.length - 1]));
      return { s, atA, dir, hw: this.type(s.type).width / 2 };
    });
    const smooth = ends.length === 2 && ends[0].s.type === ends[1].s.type && ends[0].dir.x * ends[1].dir.x + ends[0].dir.z * ends[1].dir.z < -0.94;
    for (const e of ends) {
      let trim = 0;
      if (ends.length >= 3 || (ends.length === 2 && !smooth)) {
        for (const o of ends) {
          if (o === e) continue;
          const sin = Math.abs(e.dir.x * o.dir.z - e.dir.z * o.dir.x);
          const cos = e.dir.x * o.dir.x + e.dir.z * o.dir.z;
          if (cos < -0.9) continue; // straight across
          trim = Math.max(trim, o.hw / Math.max(0.35, sin) + 1.5);
        }
        trim = Math.min(trim, e.s.length * 0.45);
      }
      const old = e.atA ? e.s.trimA : e.s.trimB;
      if (Math.abs(old - trim) > 0.01) {
        if (e.atA) e.s.trimA = trim;
        else e.s.trimB = trim;
        this.events.emit('segChanged', e.s);
      }
    }
    this.events.emit('nodeChanged', n);
  }

  /** Other end of a segment. */
  other(seg: RSeg, nodeId: number) {
    return seg.a === nodeId ? seg.b : seg.a;
  }

  totalLength(): number {
    let L = 0;
    for (const s of this.segs.values()) L += s.length;
    return L;
  }

  /** Weekly upkeep. Age makes it worse: the Growth Ponzi's bill coming due. */
  upkeep(): number {
    let c = 0;
    for (const s of this.segs.values()) {
      const ageYears = (this.day - s.builtDay) / 365;
      const ageMul = ageYears < 1 ? 0.35 : ageYears < 4 ? 0.35 + (ageYears - 1) * 0.22 : 1 + Math.min(1.5, (ageYears - 4) * 0.12);
      c += s.length * this.type(s.type).upkeepPerM * ageMul;
    }
    return c;
  }
}

export function straightTo(a: V2, b: V2): Cubic {
  return lineCubic(a, b);
}
