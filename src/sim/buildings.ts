// Building manager: grows buildings on zoned lots, runs construction and
// level-ups, and renders everything through one BatchedMesh (one draw call,
// each unique model uploaded once).
import * as THREE from 'three';
import { CELL } from '../config';
import { MAX_LEVEL, type BuildingModel, type LandmarkId, type ZoneType } from '../contracts';
import { SpatialHash, V2 } from '../core/math';
import { Rng } from '../core/rng';
import { buildingMaterial, generateBuilding, generateLandmark, landmarkFootprint } from '../buildings/generator';
import { BRANDS, type Brand } from '../art/brands';
import type { Terrain } from '../world/terrain';
import { Paint } from '../world/terrain';
import type { Trees } from '../world/trees';
import type { ZCell, Zoning } from '../zones/zoning';
import type { RoadNetwork } from '../roads/network';

export interface Bld {
  id: number;
  zone: ZoneType | 'landmark';
  landmark?: LandmarkId;
  level: number;
  w: number;
  d: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  hw: number; // half extents (m)
  hd: number;
  cells: ZCell[];
  seg: number;
  label: string;
  brand?: string;
  model: BuildingModel;
  state: 'building' | 'active';
  progress: number;
  buildDays: number;
  cap: number;
  occ: number;
  lv: number; // land value 0..100 (sim writes)
  levelProgress: number;
  born: number;
  inst: number; // BatchedMesh instance id
  emitT: number;
}

const VARIANTS = 6;

/** Residents (res zones) or jobs (others) per building. */
export function capacityFor(zone: ZoneType, level: number, cells: number): number {
  const L = level - 1;
  switch (zone) {
    case 'resLow': return Math.round([3, 4, 5, 6, 8][L] + Math.max(0, cells - 2) * 0.5);
    case 'resHigh': return Math.round([6, 12, 20, 32, 50][L] * cells);
    case 'comLow': return Math.round([2, 3, 4, 5, 6][L] * cells);
    case 'comHigh': return Math.round([5, 8, 12, 16, 22][L] * cells);
    case 'industry': return Math.round([3, 4, 6, 8, 10][L] * cells);
    case 'office': return Math.round([5, 9, 14, 20, 28][L] * cells);
  }
}

const LOT_SIZE: Record<ZoneType, { w: [number, number]; d: [number, number] }> = {
  resLow: { w: [1, 2], d: [2, 3] },
  resHigh: { w: [2, 3], d: [2, 3] },
  comLow: { w: [2, 4], d: [2, 3] },
  comHigh: { w: [3, 4], d: [3, 4] },
  industry: { w: [2, 4], d: [2, 4] },
  office: { w: [2, 3], d: [2, 3] },
};

export class Buildings {
  list = new Map<number, Bld>();
  private nextId = 1;
  private hash = new SpatialHash<Bld>(32);
  readonly mesh: THREE.BatchedMesh;
  private geoIds = new Map<string, { id: number; model: BuildingModel }>();
  private rng = new Rng(4242);
  private maxVerts = 400_000;
  private maxInst = 4000;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  onDemolish?: (b: Bld, reason: string) => void;
  onComplete?: (b: Bld) => void;
  onLevel?: (b: Bld) => void;
  day = 0;

  constructor(scene: THREE.Scene, private terrain: Terrain, private trees: Trees, private zones: Zoning, private net: RoadNetwork) {
    this.mesh = new THREE.BatchedMesh(this.maxInst, this.maxVerts, this.maxVerts, buildingMaterial());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    zones.onCellsLost = (cells) => {
      const ids = new Set(cells.map((c) => c.bld).filter(Boolean));
      for (const id of ids) {
        const b = this.list.get(id);
        if (b) this.demolish(b, 'road');
      }
    };
  }

  // ------------------------------------------------------------------ models
  private brandFor(zone: ZoneType, rnd: Rng): Brand | undefined {
    const pool = BRANDS.filter((b) => b.zones.includes(zone));
    if (!pool.length) return undefined;
    // merch brands get a thumb on the scale
    return rnd.weighted(pool, (b) => (b.merch ? 2.2 : 1));
  }

  private modelFor(zone: ZoneType, level: number, w: number, d: number, variant: number, brand?: string) {
    const key = `${zone}|${level}|${w}|${d}|${variant}|${brand ?? ''}`;
    let e = this.geoIds.get(key);
    if (!e) {
      const model = generateBuilding({ zone, level, widthCells: w, depthCells: d, seed: variant * 7919 + level * 131 + w * 17 + d, brand });
      e = { id: this.addGeometry(model.geometry), model };
      this.geoIds.set(key, e);
    }
    return e;
  }

  private addGeometry(g: THREE.BufferGeometry): number {
    const n = g.getAttribute('position').count;
    const used = this.usedVerts;
    if (used + n > this.maxVerts) {
      this.maxVerts = Math.ceil((this.maxVerts + n) * 1.6);
      this.mesh.setGeometrySize(this.maxVerts, this.maxVerts);
    }
    this.usedVerts += n;
    return this.mesh.addGeometry(g);
  }
  private usedVerts = 0;

  private placeInstance(b: Bld, geoId: number) {
    if (this.list.size + 8 > this.maxInst) {
      this.maxInst = Math.ceil(this.maxInst * 1.6);
      this.mesh.setInstanceCount(this.maxInst);
    }
    b.inst = this.mesh.addInstance(geoId);
    this.writeMatrix(b, b.state === 'building' ? 0.04 : 1);
  }

  private writeMatrix(b: Bld, grow: number) {
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), b.yaw);
    this.s.set(1, Math.max(0.02, grow), 1);
    this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.s);
    this.mesh.setMatrixAt(b.inst, this.m4);
  }

  // ------------------------------------------------------------------ growth
  /** Try to grow one building of `zone` somewhere. Returns it or null. */
  tryGrow(zone: ZoneType, cands: ZCell[], prefer?: (c: ZCell) => number): Bld | null {
    if (!cands.length) return null;
    const rnd = this.rng;
    let seed: ZCell | null = null;
    for (let k = 0; k < 6; k++) {
      const c = cands[rnd.int(0, cands.length - 1)];
      if (!prefer || !seed || prefer(c) > prefer(seed)) seed = c;
    }
    if (!seed || seed.bld) return null;
    const sz = LOT_SIZE[zone];
    const lot = this.zones.lotFrom(seed, rnd.int(sz.w[0], sz.w[1]), rnd.int(sz.d[0], sz.d[1]));
    if (!lot) return null;
    const w = lot.length, d = lot[0].length;
    if (zone !== 'resLow' && w * d < 2) return null;
    return this.create(zone, 1, lot);
  }

  private create(zone: ZoneType, level: number, lot: ZCell[][]): Bld | null {
    const w = lot.length, d = lot[0].length;
    const cells = lot.flat();
    let x = 0, z = 0;
    for (const c of cells) { x += c.x; z += c.z; }
    x /= cells.length;
    z /= cells.length;
    const mid = lot[Math.floor((w - 1) / 2)][0];
    const yaw = mid.yaw;
    let y = 0;
    for (const c of cells) y += this.terrain.h(c.x, c.z);
    y /= cells.length;
    const variant = this.rng.int(0, VARIANTS - 1);
    const brand = zone === 'resLow' || zone === 'resHigh' ? undefined : this.brandFor(zone, this.rng)?.id;
    const e = this.modelFor(zone, level, w, d, variant, brand);
    const b: Bld = {
      id: this.nextId++, zone, level, w, d, x, z, y, yaw, hw: (w * CELL) / 2, hd: (d * CELL) / 2, cells, seg: mid.seg,
      label: e.model.label, brand: e.model.brand ?? brand, model: e.model, state: 'building', progress: 0,
      buildDays: this.rng.range(3, 7) * (1 + level * 0.25), cap: capacityFor(zone, level, w * d), occ: 0, lv: 20, levelProgress: 0,
      born: this.day, inst: -1, emitT: Math.random() * 5,
    };
    for (const c of cells) c.bld = b.id;
    this.list.set(b.id, b);
    this.hash.insert(b, x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd);
    const corners = this.corners(b);
    this.terrain.flattenLot(corners, y, zone === 'resLow' ? Paint.Lawn : zone === 'resHigh' ? Paint.Lawn : Paint.Paved);
    this.trees.cut(x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd, (tx, tz) => this.contains(b, tx, tz, 1.5));
    this.placeInstance(b, e.id);
    this.zones.markOverlayDirty();
    return b;
  }

  /** Place a landmark at a point facing the given yaw. */
  placeLandmark(id: LandmarkId, x: number, z: number, yaw: number): Bld {
    const fp = landmarkFootprint(id);
    const model = generateLandmark(id, 1);
    const key = `landmark|${id}`;
    let e = this.geoIds.get(key);
    if (!e) this.geoIds.set(key, (e = { id: this.addGeometry(model.geometry), model }));
    const y = this.terrain.h(x, z);
    const b: Bld = {
      id: this.nextId++, zone: 'landmark', landmark: id, level: 1, w: fp.widthCells, d: fp.depthCells, x, z, y, yaw,
      hw: (fp.widthCells * CELL) / 2, hd: (fp.depthCells * CELL) / 2, cells: [], seg: 0, label: model.label, model,
      state: 'building', progress: 0, buildDays: 6, cap: 0, occ: 0, lv: 50, levelProgress: 0, born: this.day, inst: -1, emitT: 0,
    };
    this.list.set(b.id, b);
    this.hash.insert(b, x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd);
    this.terrain.flattenLot(this.corners(b), y, Paint.Paved);
    this.trees.cut(x - 80, z - 80, x + 80, z + 80, (tx, tz) => this.contains(b, tx, tz, 2));
    for (const c of this.zones.cellsNear(x, z, b.hw + b.hd + 6)) if (this.contains(b, c.x, c.z, 3)) c.bld = b.id;
    this.placeInstance(b, e.id);
    return b;
  }

  // ------------------------------------------------------------------ save / load
  serialize() {
    return [...this.list.values()].map((b) => [
      b.zone, b.landmark ?? '', b.level, b.w, b.d, +b.x.toFixed(2), +b.z.toFixed(2), +b.y.toFixed(2), +b.yaw.toFixed(4), b.brand ?? '', b.occ, b.state === 'active' ? 1 : +b.progress.toFixed(2), b.seg, +b.levelProgress.toFixed(2),
    ] as const);
  }

  restore(rows: ReturnType<Buildings['serialize']>) {
    for (const r of rows) {
      const [zone, landmark, level, w, d, x, z, y, yaw, brand, occ, prog, seg, lp] = r;
      if (zone === 'landmark') {
        const b = this.placeLandmark(landmark as LandmarkId, x, z, yaw);
        b.state = 'active';
        b.progress = 1;
        this.writeMatrix(b, 1);
        continue;
      }
      const zt = zone as ZoneType;
      const e = this.modelFor(zt, level, w, d, this.rng.int(0, VARIANTS - 1), brand || undefined);
      const b: Bld = {
        id: this.nextId++, zone: zt, level, w, d, x, z, y, yaw, hw: (w * CELL) / 2, hd: (d * CELL) / 2, cells: [], seg,
        label: e.model.label, brand: e.model.brand ?? (brand || undefined), model: e.model, state: prog >= 1 ? 'active' : 'building', progress: Math.min(1, prog),
        buildDays: 5, cap: capacityFor(zt, level, w * d), occ, lv: 30, levelProgress: lp, born: this.day, inst: -1, emitT: Math.random() * 5,
      };
      this.list.set(b.id, b);
      this.hash.insert(b, x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd);
      for (const c of this.zones.cellsNear(x, z, b.hw + b.hd + 4)) if (this.contains(b, c.x, c.z, -1)) { c.bld = b.id; b.cells.push(c); }
      this.terrain.flattenLot(this.corners(b), y, zt.startsWith('res') ? Paint.Lawn : Paint.Paved);
      this.trees.cut(x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd, (tx, tz) => this.contains(b, tx, tz, 1.5));
      this.placeInstance(b, e.id);
    }
    this.zones.markOverlayDirty();
  }

  corners(b: { x: number; z: number; hw: number; hd: number; yaw: number }): V2[] {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    // local x -> world (c, -s); local z -> world (s, c)
    const out: V2[] = [];
    for (const [lx, lz] of [[-b.hw, -b.hd], [b.hw, -b.hd], [b.hw, b.hd], [-b.hw, b.hd]]) {
      out.push({ x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c });
    }
    return out;
  }

  contains(b: Bld, x: number, z: number, pad = 0): boolean {
    const dx = x - b.x, dz = z - b.z;
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.abs(lx) <= b.hw + pad && Math.abs(lz) <= b.hd + pad;
  }

  at(x: number, z: number): Bld | null {
    for (const b of this.hash.query(x - 1, z - 1, x + 1, z + 1)) if (this.contains(b, x, z)) return b;
    return null;
  }

  near(x: number, z: number, r: number): Bld[] {
    const out: Bld[] = [];
    for (const b of this.hash.query(x - r, z - r, x + r, z + r)) if (Math.hypot(b.x - x, b.z - z) <= r) out.push(b);
    return out;
  }

  /** Ray pick against building boxes (for tall buildings). */
  pickRay(ray: THREE.Ray): Bld | null {
    let best: Bld | null = null;
    let bd = Infinity;
    const box = new THREE.Box3();
    const inv = new THREE.Matrix4();
    const r = new THREE.Ray();
    const hit = new THREE.Vector3();
    for (const b of this.list.values()) {
      const h = b.model.height * (b.state === 'building' ? Math.max(0.05, b.progress) : 1);
      inv.compose(new THREE.Vector3(b.x, b.y, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw), new THREE.Vector3(1, 1, 1)).invert();
      r.copy(ray).applyMatrix4(inv);
      box.min.set(-b.hw, 0, -b.hd);
      box.max.set(b.hw, h, b.hd);
      if (r.intersectBox(box, hit)) {
        const d = hit.distanceTo(r.origin);
        if (d < bd) { bd = d; best = b; }
      }
    }
    return best;
  }

  demolish(b: Bld, reason = 'bulldozed') {
    if (!this.list.has(b.id)) return;
    this.list.delete(b.id);
    this.hash.remove(b, b.x - b.hw - b.hd, b.z - b.hw - b.hd, b.x + b.hw + b.hd, b.z + b.hw + b.hd);
    for (const c of b.cells) if (c.bld === b.id) c.bld = 0;
    for (const c of this.zones.cellsNear(b.x, b.z, b.hw + b.hd + 6)) if (c.bld === b.id) c.bld = 0;
    if (b.inst >= 0) this.mesh.deleteInstance(b.inst);
    this.terrain.paintCircle(b.x, b.z, Math.min(b.hw, b.hd), Paint.Dirt);
    this.zones.markOverlayDirty();
    this.onDemolish?.(b, reason);
  }

  /** Swap a building to a new level (same lot). */
  levelUp(b: Bld) {
    if (b.zone === 'landmark') return;
    const max = MAX_LEVEL[b.zone];
    if (b.level >= max) return;
    b.level++;
    const e = this.modelFor(b.zone, b.level, b.w, b.d, this.rng.int(0, VARIANTS - 1), b.brand);
    b.model = e.model;
    b.label = e.model.label;
    b.cap = capacityFor(b.zone, b.level, b.w * b.d);
    b.levelProgress = 0;
    this.mesh.setGeometryIdAt(b.inst, e.id);
    b.state = 'building';
    b.progress = 0.35;
    b.buildDays = 4 + b.level;
    this.writeMatrix(b, b.progress);
    this.onLevel?.(b);
  }

  /** Advance construction by game days. */
  tickConstruction(days: number, buildMul: number) {
    for (const b of this.list.values()) {
      if (b.state !== 'building') continue;
      b.progress = Math.min(1, b.progress + (days / b.buildDays) * buildMul);
      this.writeMatrix(b, easeGrow(b.progress));
      if (b.progress >= 1) {
        b.state = 'active';
        this.onComplete?.(b);
      }
    }
  }

  counts() {
    let active = 0, building = 0, maxed = 0;
    for (const b of this.list.values()) {
      if (b.zone === 'landmark') continue;
      if (b.state === 'active') active++;
      else building++;
      if (b.level >= MAX_LEVEL[b.zone]) maxed++;
    }
    return { active, building, maxed, total: active + building };
  }
}

function easeGrow(t: number) {
  return 1 - Math.pow(1 - t, 2);
}
