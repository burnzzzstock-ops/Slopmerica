// Building manager: grows buildings on zoned lots, runs construction and
// level-ups, and renders everything through one BatchedMesh (one draw call,
// each unique model uploaded once).
import * as THREE from 'three';
import { CELL, WATER } from '../config';
import { MAX_LEVEL, type BuildingModel, type LandmarkId, type ZoneType } from '../contracts';
import { closestOnSampled, SpatialHash, V2 } from '../core/math';
import { fx, Rng } from '../core/rng';
import { buildingMaterial, generateBuilding, generateLandmark, landmarkFootprint, setArtMap, variantsFor } from '../buildings/generator';
import { kitMaterial } from '../buildings/kitGenerator';
import { applyAtmosphere } from '../world/seasons';
import type { MapId } from '../world/maps';
import { BRANDS, type Brand } from '../art/brands';
import type { Terrain } from '../world/terrain';
import { Paint } from '../world/terrain';
import type { Trees } from '../world/trees';
import type { ZCell, Zoning } from '../zones/zoning';
import type { RoadNetwork } from '../roads/network';
import { ROAD_TYPES } from '../roads/roadTypes';
import { buildingLod, buildingSilhouette, timeBuildingLod, withBuildingLodRandom } from '../render/buildingLod';
import { BuildingClip, addBuildingClipAttribute, constructionHeight } from '../render/buildingClip';
import { constructionFrame } from '../render/constructionFrame';

/** a building as saved (see Buildings.serialize) */
export type BldRow = [string, string, number, number, number, number, number, number, number, string, number, number, number, number, number?, number?, number?, number?, number?, number?, number[]?, number?, string?];

export interface Bld {
  id: number;
  zone: ZoneType | 'landmark' | 'service';
  landmark?: LandmarkId;
  /** service building kind (zone === 'service'), a key of CUSTOM_BUILDINGS */
  kind?: string;
  /** a service building drawn in the main (facade atlas) batch, not the kit batch */
  onMain?: boolean;
  /** days spent abandoned (unset = occupied normally) */
  abandoned?: number;
  /** a landmark, service or depot with no road link to the county's road network (it does nothing): no road at it, or its roads don't reach the highway */
  offNet?: 'noRoad' | 'noLink';
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
  /** which of its zone's models it wears (zoned buildings; rolled when it is built and again at each level) */
  variant?: number;
  /**
   * The brand its model was asked for ('' for none). Not always the brand it has: the generator swaps in one that fits the lot and
   * says so in the model. Asking again for the brand it ended up with gives another building, so a save keeps what was asked.
   */
  ask?: string;
  born: number;
  inst: number; // BatchedMesh instance id
  buildInst: number; // temporary scaffold/crane instance (always in the Kit batch)
  buildH: number; // source height of the reusable construction model
  emitT: number;
}

/**
 * One BatchedMesh plus its growable geometry/instance budgets. Buildings live in
 * two batches because the two geometry formats can't share one: the atlas
 * buildings from generator.ts (non-indexed) and Kit geometry (indexed, with a
 * facade `tile` attribute): city service buildings and construction scaffolds.
 */
class Batch {
  readonly mesh: THREE.BatchedMesh;
  readonly clip: BuildingClip;
  private maxVerts: number;
  private maxIndices: number;
  private maxInst: number;
  usedVerts = 0;
  private usedIndices = 0;
  private count = 0;
  private lods = new Map<number, { far: number; silhouette: number; center: THREE.Vector3 }>();
  private instances = new Map<number, { original: number; written: number; far: boolean }>();
  private lodMatrix = new THREE.Matrix4();
  private lodPoint = new THREE.Vector3();
  private shadowPass = false;
  private owners = new Map<number, number>();
  private removed = new Map<number, { geometry: number; matrix: THREE.Matrix4; color: THREE.Vector4; clip: number }>();
  private ghosts: { handle: number; matrix: THREE.Matrix4; age: number }[] = [];
  lodEnabled = true;
  lodVerts = 0;
  lodBuildMs = 0;
  farInstances = 0;
  constructor(scene: THREE.Scene, material: THREE.Material, verts: number, inst: number) {
    this.maxVerts = this.maxIndices = verts;
    this.maxInst = inst;
    this.mesh = new THREE.BatchedMesh(inst, verts, verts, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    this.clip = new BuildingClip(inst);
    this.clip.bind(material);
    this.mesh.customDepthMaterial = withBuildingLodRandom(() => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    this.mesh.customDistanceMaterial = withBuildingLodRandom(() => new THREE.MeshDistanceMaterial());
    this.clip.bind(this.mesh.customDepthMaterial);
    this.clip.bind(this.mesh.customDistanceMaterial);
    const render = this.mesh.onBeforeRender;
    this.mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      this.clip.activate();
      if (!this.shadowPass) this.updateLod(camera, false);
      render.call(this.mesh, renderer, scene, camera, geometry, material, group);
    };
    const shadow = this.mesh.onBeforeShadow;
    this.mesh.onBeforeShadow = (renderer, object, camera, shadowCamera, geometry, material, group) => {
      this.clip.activate();
      this.updateLod(camera, true);
      this.shadowPass = true;
      try { shadow.call(this.mesh, renderer, object, camera, shadowCamera, geometry, material, group); }
      finally { this.shadowPass = false; }
    };
    scene.add(this.mesh);
  }
  addGeometry(g: THREE.BufferGeometry, allowLod = true): number {
    addBuildingClipAttribute(g);
    // Imported vault geometry predates the baked ambient-visibility channel.
    if (!g.hasAttribute('ambientVisibility')) {
      g.setAttribute('ambientVisibility', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(1), 1));
    }
    const n = g.getAttribute('position').count;
    const ni = g.getIndex()?.count ?? n;
    if (this.usedVerts + n > this.maxVerts || this.usedIndices + ni > this.maxIndices) {
      if (this.usedVerts + n > this.maxVerts) this.maxVerts = Math.ceil((this.maxVerts + n) * 1.6);
      if (this.usedIndices + ni > this.maxIndices) this.maxIndices = Math.ceil((this.maxIndices + ni) * 1.6);
      withBuildingLodRandom(() => this.mesh.setGeometrySize(this.maxVerts, this.maxIndices));
    }
    this.usedVerts += n;
    this.usedIndices += ni;
    const id = this.mesh.addGeometry(g);
    if (allowLod) {
      this.lodBuildMs += timeBuildingLod(() => {
        const far = buildingLod(g);
        if (far) {
          g.computeBoundingBox();
          const farId = this.addGeometry(far, false);
          const coarse = buildingSilhouette(far), silhouette = coarse ? this.addGeometry(coarse, false) : farId;
          this.lods.set(id, { far: farId, silhouette, center: g.boundingBox!.getCenter(new THREE.Vector3()) });
          this.lodVerts += far.getAttribute('position').count;
          if (coarse) { this.lodVerts += coarse.getAttribute('position').count; coarse.dispose(); }
          far.dispose();
        }
      });
    }
    return id;
  }
  addInstance(geoId: number): number {
    if (this.count + 8 > this.maxInst) {
      this.maxInst = Math.ceil(this.maxInst * 1.6);
      this.mesh.setInstanceCount(this.maxInst);
    }
    this.count++;
    const id = this.mesh.addInstance(geoId);
    this.clip.set(id, null);
    this.instances.set(id, { original: geoId, written: geoId, far: false });
    return id;
  }
  deleteInstance(i: number) {
    const owner = this.owners.get(i);
    const state = this.instances.get(i);
    if (owner !== undefined && state) {
      const current = this.mesh.getGeometryIdAt(i);
      const geometry = current === state.written ? state.original : current;
      const matrix = new THREE.Matrix4();
      const color = new THREE.Vector4();
      this.mesh.getMatrixAt(i, matrix);
      this.mesh.getColorAt(i, color);
      this.removed.set(owner, { geometry, matrix, color, clip: this.clip.get(i) });
      if (this.removed.size > 16) this.removed.delete(this.removed.keys().next().value!);
    }
    this.owners.delete(i);
    this.mesh.deleteInstance(i);
    this.clip.set(i, null);
    this.instances.delete(i);
    this.count--;
  }
  own(handle: number, buildingId: number) {
    this.owners.set(handle, buildingId);
  }
  beginDemolition(buildingId: number) {
    const removed = this.removed.get(buildingId);
    if (!removed) return false;
    this.removed.delete(buildingId);
    if (this.ghosts.length >= 16) {
      this.deleteInstance(this.ghosts.shift()!.handle);
    }
    const handle = this.addInstance(removed.geometry);
    this.mesh.setMatrixAt(handle, removed.matrix);
    this.mesh.setColorAt(handle, removed.color);
    this.clip.set(handle, removed.clip);
    this.ghosts.push({ handle, matrix: removed.matrix, age: 0 });
    return true;
  }
  updateGhosts(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const ghost = this.ghosts[i];
      ghost.age += Math.max(0, dt);
      if (ghost.age >= 0.65) {
        this.deleteInstance(ghost.handle);
        this.ghosts.splice(i, 1);
        continue;
      }
      const t = ghost.age / 0.65;
      const collapse = t * t;
      this.lodMatrix.copy(ghost.matrix);
      this.lodMatrix.scale(this.lodPoint.set(1 - collapse * 0.08, 1 - collapse, 1 - collapse * 0.08));
      this.mesh.setMatrixAt(ghost.handle, this.lodMatrix);
    }
  }
  private updateLod(camera: THREE.Camera, shadow: boolean) {
    const perspective = camera as THREE.PerspectiveCamera;
    const fovScale = perspective.isPerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad(perspective.fov) * 0.5) / Math.tan(THREE.MathUtils.degToRad(50) * 0.5) : 1;
    let farCount = 0;
    for (const [id, state] of this.instances) {
      const current = this.mesh.getGeometryIdAt(id);
      // Level-ups and restyles assign a new source geometry to the same handle.
      if (current !== state.written) { state.original = current; state.far = false; }
      const lod = this.lods.get(state.original);
      let useFar = false, coarse = false;
      if (this.lodEnabled && lod) {
        this.mesh.getMatrixAt(id, this.lodMatrix);
        this.lodPoint.copy(lod.center).applyMatrix4(this.lodMatrix);
        const distance = camera.position.distanceTo(this.lodPoint) * fovScale;
        // Construction and its separate scaffolds stay exact. A shadow's
        // sub-pixel furniture can disappear earlier than the visible facade.
        const growing = this.clip.active(id) || Math.abs(this.lodMatrix.elements[5] - 1) > 0.001;
        useFar = !growing && distance > (shadow ? 300 : state.far ? 700 : 850);
        // Atlas repeats must stay exact in the visible scene. Coalesced wall
        // quads are silhouettes for the shadow pass only, never facade LODs.
        coarse = useFar && shadow;
        if (!shadow) state.far = useFar;
      }
      const desired = useFar ? coarse ? lod!.silhouette : lod!.far : state.original;
      if (current !== desired) this.mesh.setGeometryIdAt(id, desired);
      state.written = desired;
      if (useFar) farCount++;
    }
    if (!shadow) this.farInstances = farCount;
  }
}

/** A zoned (growable) building, not a landmark or city service. */
export const isZoned = (b: Bld): b is Bld & { zone: ZoneType } => b.zone !== 'landmark' && b.zone !== 'service';

/**
 * Why a building came down, as the world events name it (src/contracts.ts `demolished`), from the reason passed to
 * Buildings.demolish. A road through a lot, an undo and the bulldozer are all the player clearing it; a storm surge is
 * the disaster's. A reason not in the table is the player's too: every other caller is a tool or a test.
 */
const DEMOLISH_CAUSE: Record<string, 'bulldoze' | 'fire' | 'abandoned' | 'disaster' | 'collapse'> = {
  bulldozed: 'bulldoze', road: 'bulldoze', undone: 'bulldoze',
  fire: 'fire', wildfire: 'fire',
  abandoned: 'abandoned',
  'storm surge': 'disaster',
};
export const demolishCause = (reason: string) => DEMOLISH_CAUSE[reason] ?? 'bulldoze';

/** Player-placed non-zoned buildings (power plants, schools, ...). Systems register their kinds here. */
export interface CustomBuildingDef {
  label: string;
  /** footprint in 8 m cells */
  w: number;
  d: number;
  buildDays: number;
  model(): BuildingModel;
  paint?: Paint;
  /** true: the model is built with the facade atlas and renders in the main batch (Asset Vault attractions) */
  main?: () => boolean;
}
export const CUSTOM_BUILDINGS = new Map<string, CustomBuildingDef>();

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
  /** atlas buildings (zoned, landmarks) */
  private main: Batch;
  /** Kit geometry: service buildings + construction scaffolds */
  private kit: Batch;
  readonly mesh: THREE.BatchedMesh;
  readonly kitMesh: THREE.BatchedMesh;
  private geoIds = new Map<string, { id: number; model: BuildingModel }>();
  /** the dice for what grows where and how (seeded from the county's seed, saved) */
  readonly rng = new Rng(4242);
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  onDemolish?: (b: Bld, reason: string) => void;
  onComplete?: (b: Bld) => void;
  onLevel?: (b: Bld) => void;
  /** construction moved past a tenth (0.1 .. 0.9), and 1 once when it opens; for whatever shows or sounds the site */
  onProgress?: (b: Bld, progress: number) => void;
  /** trees came down under a building's lot (count > 0 only); (x, z) the lot's centre, r its reach in metres */
  onTreesCut?: (x: number, z: number, r: number, count: number) => void;
  day = 0;

  constructor(scene: THREE.Scene, private terrain: Terrain, private trees: Trees, private zones: Zoning, private net: RoadNetwork) {
    setArtMap(terrain.map.def.id as MapId);
    this.main = new Batch(scene, applyAtmosphere(buildingMaterial()), 400_000, 4000);
    this.kit = new Batch(scene, kitMaterial(), 150_000, 600);
    this.mesh = this.main.mesh;
    this.kitMesh = this.kit.mesh;
    zones.onCellsLost = (cells) => {
      const ids = new Set(cells.map((c) => c.bld).filter(Boolean));
      for (const id of ids) {
        const b = this.list.get(id);
        // services and landmarks sit on their own pads: zone cells vanishing
        // under them (a nearby road removed) is no reason to bulldoze them
        if (b && isZoned(b)) this.demolish(b, 'road');
      }
    };
    // a new cell under a service/landmark pad, or under a building of this
    // same road (rebuilt after widening), starts occupied. Other streets'
    // buildings keep their own cells, so bulldozing this road can't take them.
    zones.occupantAt = (x, z, segId) => {
      const b = this.at(x, z);
      return b && (!isZoned(b) || b.seg === segId) ? b.id : 0;
    };
    zones.onRelink = (ids) => {
      for (const id of ids) {
        const b = this.list.get(id);
        if (b) this.settleAfterWiden(b);
      }
    };
  }

  /**
   * Buildings a road's pavement would run through (sample points every ~4 m,
   * the pavement less its sidewalk edge, so a lot that only touches the
   * sidewalk is left alone). Buildings still being built count too.
   */
  underPavement(pts: { x: number; z: number }[], halfWidth: number): Bld[] {
    const out = new Set<Bld>();
    const pad = Math.max(0.5, halfWidth - 1);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      for (const b of this.hash.query(p.x - pad - 30, p.z - pad - 30, p.x + pad + 30, p.z + pad + 30)) if (!out.has(b) && this.contains(b, p.x, p.z, pad)) out.add(b);
      // between samples too (samples can straddle a narrow building)
      const q = pts[i + 1];
      if (q) { const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2; for (const b of this.hash.query(mx - pad - 30, mz - pad - 30, mx + pad + 30, mz + pad + 30)) if (!out.has(b) && this.contains(b, mx, mz, pad)) out.add(b); }
    }
    return [...out];
  }

  /** Is any road's pavement on this footprint? Returns that road. */
  private roadOn(b: Bld) {
    const r = b.hw + b.hd + 40;
    for (const s of this.net.segsNear(b.x - r, b.z - r, b.x + r, b.z + r)) {
      const pad = ROAD_TYPES[s.type].width / 2 + 0.3;
      for (const p of s.samp.pts) if (this.contains(b, p.x, p.z, pad)) return s;
    }
    return null;
  }

  /**
   * ONE MORE LANE widened the road in front of this building. Its zone grid
   * was rebuilt further back by the same amount, so slide the building back
   * off the new pavement; only bulldoze it when there's no room behind.
   */
  private settleAfterWiden(b: Bld) {
    if (isZoned(b) && !this.net.segs.has(b.seg)) {
      // its road was split by a new junction: adopt the piece whose new lots lie under it
      const votes = new Map<number, number>();
      for (const c of this.zones.cellsNear(b.x, b.z, b.hw + b.hd + 8)) if (!c.bld && this.contains(b, c.x, c.z, 0.5)) votes.set(c.seg, (votes.get(c.seg) ?? 0) + 1);
      let best = 0, most = 0;
      for (const [seg, n] of votes) if (n > most) { best = seg; most = n; }
      const near = best ? null : this.net.pickSeg(b.x, b.z, b.hw + b.hd + 30);
      if (best || near) b.seg = best || near!.seg.id;
    }
    const hit = this.roadOn(b);
    if (!hit) { this.claimCells(b); return; } // clear of the new road: keeps its lot
    const c = closestOnSampled({ x: b.x, z: b.z }, hit.samp);
    const dl = Math.hypot(b.x - c.pt.x, b.z - c.pt.z) || 1;
    const ux = (b.x - c.pt.x) / dl, uz = (b.z - c.pt.z) / dl;
    const ox = b.x, oz = b.z, pad = b.hw + b.hd;
    let moved = false;
    for (let push = 0.5; push <= 9; push += 0.5) {
      b.x = ox + ux * push;
      b.z = oz + uz * push;
      if (!this.roadOn(b)) { moved = true; break; }
    }
    const blocked = !moved || this.near(b.x, b.z, pad + 40).some((o) => o !== b && (
      this.corners(b).some((p) => this.contains(o, p.x, p.z)) || this.corners(o).some((p) => this.contains(b, p.x, p.z)) || this.contains(o, b.x, b.z)));
    if (blocked || !this.terrain.inBounds(b.x, b.z, 4)) {
      b.x = ox;
      b.z = oz;
      this.demolish(b, 'road');
      return;
    }
    this.hash.remove(b, ox - pad, oz - pad, ox + pad, oz + pad);
    this.hash.insert(b, b.x - pad, b.z - pad, b.x + pad, b.z + pad);
    b.y = this.terrain.h(b.x, b.z);
    this.terrain.flattenLot(this.corners(b), b.y, b.zone === 'resLow' || b.zone === 'resHigh' ? Paint.Lawn : Paint.Paved);
    this.felled(b, 2, this.trees.cut(b.x - pad - 4, b.z - pad - 4, b.x + pad + 4, b.z + pad + 4, (tx, tz) => this.contains(b, tx, tz, 2)));
    this.claimCells(b);
    if (b.inst >= 0) this.writeMatrix(b, b.state === 'active' ? 1 : easeGrow(b.progress));
  }

  /** Point the lot cells under a building at it (and release ones it left). */
  private claimCells(b: Bld) {
    const cells = this.zones.cellsNear(b.x, b.z, b.hw + b.hd + 8);
    const mine = (cell: { seg: number }) => !isZoned(b) || cell.seg === b.seg;
    for (const cell of cells) {
      if (cell.bld === b.id && !this.contains(b, cell.x, cell.z, 0.5)) cell.bld = 0;
      else if (!cell.bld && mine(cell) && this.contains(b, cell.x, cell.z, 0.5)) cell.bld = b.id;
    }
    b.cells = cells.filter((cell) => cell.bld === b.id);
    this.zones.markOverlayDirty();
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
      const t0 = performance.now();
      const model = generateBuilding({ zone, level, widthCells: w, depthCells: d, seed: variant * 7919 + level * 131 + w * 17 + d, brand });
      (window as unknown as { __genMs?: number }).__genMs = ((window as unknown as { __genMs?: number }).__genMs ?? 0) + performance.now() - t0;
      e = { id: this.main.addGeometry(model.geometry), model };
      this.geoIds.set(key, e);
    }
    return e;
  }

  private constructionFor(w: number, d: number, height: number) {
    const h = Math.ceil(height / 3.4) * 3.4;
    const key = `construction|${w}|${d}|${h}`;
    let e = this.geoIds.get(key);
    if (!e) {
      const geometry = withBuildingLodRandom(() => constructionFrame(w, d, h, w * 97 + d * 193 + h));
      const model: BuildingModel = { geometry, height: h, label: 'Construction', emitters: [] };
      e = { id: this.kit.addGeometry(geometry, false), model };
      this.geoIds.set(key, e);
    }
    return { id: e.id, height: h };
  }

  /** Vertices uploaded to the atlas-building batch (perf budget checks). */
  get usedVerts() {
    return this.main.usedVerts;
  }
  /** Render-only diagnostics and A/B switch; neither touches simulation data. */
  setLodEnabled(enabled: boolean) { this.main.lodEnabled = this.kit.lodEnabled = enabled; }
  lodStats() {
    return { far: this.main.farInstances + this.kit.farInstances, addedVertices: this.main.lodVerts + this.kit.lodVerts,
      uploadedVertices: this.main.usedVerts + this.kit.usedVerts, buildMs: this.main.lodBuildMs + this.kit.lodBuildMs };
  }

  /** Render-only remnants: the simulation has already removed the building. */
  beginDemolition(buildingId: number) {
    const main = this.main.beginDemolition(buildingId);
    const kit = this.kit.beginDemolition(buildingId);
    return main || kit;
  }

  updateVisuals(dt: number) {
    this.main.updateGhosts(dt);
    this.kit.updateGhosts(dt);
  }

  /** The batch a building's own instance lives in. */
  private batchOf(b: Bld): Batch {
    return b.zone === 'service' && !b.onMain ? this.kit : this.main;
  }

  /** Per-instance tint (info views); null restores the normal look. */
  setTint(b: Bld, c: THREE.Color | null) {
    if (b.inst >= 0) this.batchOf(b).mesh.setColorAt(b.inst, c ?? this.baseTint(b, this.tint));
  }
  private tint = new THREE.Color();

  private placeInstance(b: Bld, geoId: number) {
    const batch = this.batchOf(b);
    b.inst = batch.addInstance(geoId);
    batch.own(b.inst, b.id);
    b.buildInst = -1;
    b.buildH = 1;
    if (b.state === 'building') {
      const build = this.constructionFor(b.w, b.d, b.model.height);
      b.buildInst = this.kit.addInstance(build.id);
      b.buildH = build.height;
    }
    this.writeMatrix(b, b.state === 'building' ? easeGrow(b.progress) : 1);
  }

  private dropScaffold(b: Bld) {
    if (b.buildInst >= 0) {
      this.kit.deleteInstance(b.buildInst);
      b.buildInst = -1;
    }
  }

  private writeMatrix(b: Bld, grow: number) {
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), b.yaw);
    this.s.set(1, 1, 1);
    this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.s);
    const batch = this.batchOf(b);
    batch.mesh.setMatrixAt(b.inst, this.m4);
    const height = grow >= 1 ? null : constructionHeight(b.model.height, grow);
    batch.clip.set(b.inst, height);
    if (b.buildInst >= 0) {
      const scale = b.model.height / Math.max(1, b.buildH);
      this.s.set(1, scale, 1);
      this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.s);
      this.kit.mesh.setMatrixAt(b.buildInst, this.m4);
      this.kit.clip.set(b.buildInst, height === null ? null : height / scale);
    }
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
    const variant = this.rng.int(0, variantsFor(zone) - 1);
    const brand = zone === 'resLow' || zone === 'resHigh' ? undefined : this.brandFor(zone, this.rng)?.id;
    const e = this.modelFor(zone, level, w, d, variant, brand);
    const b: Bld = {
      id: this.nextId++, zone, level, w, d, x, z, y, yaw, hw: (w * CELL) / 2, hd: (d * CELL) / 2, cells, seg: mid.seg, variant, ask: brand ?? '',
      label: e.model.label, brand: (e.model.brand ?? brand) || undefined, model: e.model, state: 'building', progress: 0,
      buildDays: this.rng.range(3, 7) * (1 + level * 0.25), cap: capacityFor(zone, level, w * d), occ: 0, lv: 20, levelProgress: 0,
      born: this.day, inst: -1, buildInst: -1, buildH: 1, emitT: fx.float() * 5,
    };
    for (const c of cells) c.bld = b.id;
    this.list.set(b.id, b);
    this.hash.insert(b, x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd);
    const corners = this.corners(b);
    this.terrain.flattenLot(corners, y, zone === 'resLow' ? Paint.Lawn : zone === 'resHigh' ? Paint.Lawn : Paint.Paved);
    this.felled(b, 1.5, this.trees.cut(x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd, (tx, tz) => this.contains(b, tx, tz, 1.5)));
    this.placeInstance(b, e.id);
    this.zones.markOverlayDirty();
    return b;
  }

  /**
   * The level a special building's pad is cut to: the road's grade where its
   * front meets a road (the entrance is at street level and the pad is cut
   * into the slope behind), else the footprint's average ground. Never below
   * the waterline (shore plants fill their bank in).
   */
  padHeight(x: number, z: number, hw: number, hd: number, yaw: number): number {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const fx = x + s * hd, fz = z + c * hd;
    const pick = this.net.pickSeg(fx, fz, 6);
    if (pick && !pick.seg.over) {
      const hs = pick.seg.hs;
      const k = Math.round((pick.s / pick.seg.length) * (hs.length - 1));
      if (hs.length) return Math.max(WATER + 0.6, hs[Math.max(0, Math.min(hs.length - 1, k))] - 0.35);
    }
    let sum = 0, n = 0;
    for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
      const lx = u * hw * 0.9, lz = v * hd * 0.9;
      sum += this.terrain.h(x + lx * c + lz * s, z - lx * s + lz * c);
      n++;
    }
    return Math.max(WATER + 0.6, sum / n);
  }

  /** Place a landmark at a point facing the given yaw. */
  placeLandmark(id: LandmarkId, x: number, z: number, yaw: number, yIn?: number): Bld {
    const fp = landmarkFootprint(id);
    const model = generateLandmark(id, 1);
    const key = `landmark|${id}`;
    let e = this.geoIds.get(key);
    if (!e) this.geoIds.set(key, (e = { id: this.main.addGeometry(model.geometry), model }));
    const y = yIn ?? this.padHeight(x, z, (fp.widthCells * CELL) / 2, (fp.depthCells * CELL) / 2, yaw);
    const b: Bld = {
      id: this.nextId++, zone: 'landmark', landmark: id, level: 1, w: fp.widthCells, d: fp.depthCells, x, z, y, yaw,
      hw: (fp.widthCells * CELL) / 2, hd: (fp.depthCells * CELL) / 2, cells: [], seg: 0, label: model.label, model,
      state: 'building', progress: 0, buildDays: 6, cap: 0, occ: 0, lv: 50, levelProgress: 0, born: this.day, inst: -1, buildInst: -1, buildH: 1, emitT: 0,
    };
    this.list.set(b.id, b);
    this.hash.insert(b, x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd);
    this.terrain.flattenLot(this.corners(b), y, Paint.Paved);
    this.felled(b, 2, this.trees.cut(x - 80, z - 80, x + 80, z + 80, (tx, tz) => this.contains(b, tx, tz, 2)));
    for (const c of this.zones.cellsNear(x, z, b.hw + b.hd + 6)) if (this.contains(b, c.x, c.z, 3)) c.bld = b.id;
    this.placeInstance(b, e.id);
    return b;
  }

  /** Place a registered custom building (see CUSTOM_BUILDINGS) facing yaw. */
  placeCustom(kind: string, x: number, z: number, yaw: number, yIn?: number): Bld | null {
    const def = CUSTOM_BUILDINGS.get(kind);
    if (!def) return null;
    const onMain = !!def.main?.();
    const key = `custom|${kind}|${onMain ? 'main' : 'kit'}`;
    let e = this.geoIds.get(key);
    if (!e) { const model = def.model(); this.geoIds.set(key, (e = { id: (onMain ? this.main : this.kit).addGeometry(model.geometry), model })); }
    const y = yIn ?? this.padHeight(x, z, (def.w * CELL) / 2, (def.d * CELL) / 2, yaw);
    const pick = this.net.pickSeg(x, z, (Math.max(def.w, def.d) * CELL) / 2 + 40);
    const b: Bld = {
      id: this.nextId++, zone: 'service', kind, onMain, level: 1, w: def.w, d: def.d, x, z, y, yaw,
      hw: (def.w * CELL) / 2, hd: (def.d * CELL) / 2, cells: [], seg: pick?.seg.id ?? 0, label: def.label, model: e.model,
      state: 'building', progress: 0, buildDays: def.buildDays, cap: 0, occ: 0, lv: 30, levelProgress: 0, born: this.day, inst: -1, buildInst: -1, buildH: 1, emitT: 0,
    };
    this.list.set(b.id, b);
    this.hash.insert(b, x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd);
    this.terrain.flattenLot(this.corners(b), y, def.paint ?? Paint.Paved);
    this.felled(b, 2, this.trees.cut(x - b.hw - b.hd - 4, z - b.hw - b.hd - 4, x + b.hw + b.hd + 4, z + b.hw + b.hd + 4, (tx, tz) => this.contains(b, tx, tz, 2)));
    for (const c of this.zones.cellsNear(x, z, b.hw + b.hd + 6)) if (this.contains(b, c.x, c.z, 3)) c.bld = b.id;
    this.placeInstance(b, e.id);
    this.zones.markOverlayDirty();
    return b;
  }

  /** Rebuild a service building after its look changed (the Asset Vault looks toggle). */
  restyleCustom(b: Bld) {
    const def = b.zone === 'service' && b.kind ? CUSTOM_BUILDINGS.get(b.kind) : undefined;
    if (!def) return;
    const onMain = !!def.main?.();
    const key = `custom|${b.kind}|${onMain ? 'main' : 'kit'}`;
    let e = this.geoIds.get(key);
    if (!e) { const model = def.model(); this.geoIds.set(key, (e = { id: (onMain ? this.main : this.kit).addGeometry(model.geometry), model })); }
    if (b.inst >= 0) this.batchOf(b).deleteInstance(b.inst);
    this.dropScaffold(b);
    b.onMain = onMain;
    b.model = e.model;
    this.placeInstance(b, e.id);
    this.writeMatrix(b, b.state === 'active' ? 1 : easeGrow(b.progress));
    this.setTint(b, null);
  }

  /** Normal (untinted) instance color: abandoned buildings look dead. */
  baseTint(b: Bld, out: THREE.Color): THREE.Color {
    return b.abandoned !== undefined ? out.setRGB(0.42, 0.4, 0.38) : out.setRGB(1, 1, 1);
  }

  setAbandoned(b: Bld, on: boolean) {
    if (on === (b.abandoned !== undefined)) return;
    if (on) { b.abandoned = 0; b.occ = 0; } else delete b.abandoned;
    this.setTint(b, null);
  }

  // ------------------------------------------------------------------ save / load
  /**
   * One row a building. The first 14 entries are what saves have always held (now at full precision); the rest makes a reload
   * exact: its id, model variant, construction time, land value, the day it was built, whether it is open, the lots it stands on
   * and how long it has stood abandoned (-1: lived in). A row without them (an older save) is rebuilt the old way.
   */
  serialize() {
    return [...this.list.values()].map((b) => this.rowOf(b));
  }
  rowOf(b: Bld): BldRow {
    return [
      b.zone, b.landmark ?? b.kind ?? '', b.level, b.w, b.d, b.x, b.z, b.y, b.yaw, b.brand ?? '', b.occ, b.progress, b.seg, b.levelProgress,
      b.id, b.variant ?? -1, b.buildDays, b.lv, b.born, b.state === 'active' ? 1 : 0, b.cells.map((c) => c.id), b.abandoned ?? -1, b.ask ?? b.brand ?? '',
    ];
  }

  /**
   * A demolished building that something still points at (a car on its way there, a truck leaving it): rebuilt from its row as an
   * object that stands nowhere. It is not in the list, has no lot, no mesh and no effect on the ground; it only answers what the
   * car asks of it (where it was, its model's parking spots).
   */
  ghostFrom(r: BldRow): Bld | null {
    const [zone, what, level, w, d, x, z, y, yaw, brand, occ, prog, seg, lp, id, variant, buildDays, lv, born, open, , abandoned, ask] = r;
    if (id === undefined) return null;
    let model: BuildingModel, kind: string | undefined, landmark: LandmarkId | undefined, onMain: boolean | undefined;
    if (zone === 'service') {
      const def = CUSTOM_BUILDINGS.get(what);
      if (!def) return null;
      onMain = !!def.main?.();
      const key = `custom|${what}|${onMain ? 'main' : 'kit'}`;
      let e = this.geoIds.get(key);
      if (!e) { const m = def.model(); this.geoIds.set(key, (e = { id: (onMain ? this.main : this.kit).addGeometry(m.geometry), model: m })); }
      model = e.model; kind = what;
    } else if (zone === 'landmark') {
      const key = `landmark|${what}`;
      let e = this.geoIds.get(key);
      if (!e) { const m = generateLandmark(what as LandmarkId, 1); this.geoIds.set(key, (e = { id: this.main.addGeometry(m.geometry), model: m })); }
      model = e.model; landmark = what as LandmarkId;
    } else model = this.modelFor(zone as ZoneType, level, w, d, variant ?? 0, ask || undefined).model;
    const b: Bld = {
      id, zone: zone as Bld['zone'], level, w, d, x, z, y, yaw, hw: (w * CELL) / 2, hd: (d * CELL) / 2, cells: [], seg, variant: variant !== undefined && variant >= 0 ? variant : undefined, ask,
      label: model.label, brand: brand || undefined, model, state: open ? 'active' : 'building', progress: prog, buildDays: buildDays ?? 5,
      cap: isZoned({ zone } as Bld) ? capacityFor(zone as ZoneType, level, w * d) : 0, occ, lv: lv ?? 30, levelProgress: lp, born: born ?? 0, inst: -1, buildInst: -1, buildH: 1, emitT: 0,
    };
    if (kind !== undefined) { b.kind = kind; b.onMain = onMain; }
    if (landmark !== undefined) b.landmark = landmark;
    if (abandoned !== undefined && abandoned >= 0) b.abandoned = abandoned;
    return b;
  }
  /** what the rows do not hold: the next id to give out and where the dice stand */
  serializeState() { return { nextId: this.nextId, rng: this.rng.state }; }
  restoreState(d: { nextId: number; rng: number } | undefined) { if (d) { this.nextId = d.nextId; this.rng.state = d.rng; } }

  /** true while a save is coming back: the trees its lots clear were cleared long ago, so nothing is said */
  private restoring = false;

  /** trees came down under b's lot (cut within `pad` m of it): say so, unless none did or a save is being restored */
  private felled(b: Bld, pad: number, count: number) {
    if (count && !this.restoring) this.onTreesCut?.(b.x, b.z, Math.hypot(b.hw, b.hd) + pad, count);
  }

  restore(rows: readonly BldRow[]) {
    this.restoring = true;
    try { this.restoreRows(rows); } finally { this.restoring = false; }
  }

  private restoreRows(rows: readonly BldRow[]) {
    for (const r of rows) {
      const [zone, landmark, level, w, d, x, z, y, yaw, brand, occ, prog, seg, lp, id, variant, buildDays, lv, born, open, cellIds, abandoned, ask] = r;
      const exact = id !== undefined;
      if (exact) this.nextId = id;   // (the id it had: other systems' saves name buildings by it)
      const settle = (b: Bld) => {
        if (!exact) return;
        b.progress = prog; b.state = open ? 'active' : 'building'; b.buildDays = buildDays!; b.lv = lv!; b.born = born!; b.seg = seg; b.occ = occ; b.levelProgress = lp;
        if (abandoned !== undefined && abandoned >= 0) b.abandoned = abandoned;
        if (b.state === 'active') this.dropScaffold(b);
        this.writeMatrix(b, b.state === 'active' ? 1 : easeGrow(b.progress));
      };
      if (zone === 'service') {
        const b = this.placeCustom(landmark, x, z, yaw, y);
        if (!b) continue;
        if (exact) { settle(b); continue; }
        b.progress = Math.min(1, prog);
        if (b.progress >= 1) {
          b.state = 'active';
          this.dropScaffold(b);
        }
        this.writeMatrix(b, b.state === 'active' ? 1 : easeGrow(b.progress));
        continue;
      }
      if (zone === 'landmark') {
        const b = this.placeLandmark(landmark as LandmarkId, x, z, yaw, y);
        if (exact) { settle(b); continue; }
        b.state = 'active';
        b.progress = 1;
        this.dropScaffold(b);
        this.writeMatrix(b, 1);
        continue;
      }
      const zt = zone as ZoneType;
      // (an older save does not say which model it wore: roll one, as loading always did)
      const v = exact && variant! >= 0 ? variant! : this.rng.int(0, variantsFor(zt) - 1);
      const asked = exact && ask !== undefined ? ask : brand;
      const e = this.modelFor(zt, level, w, d, v, asked || undefined);
      const b: Bld = {
        id: this.nextId++, zone: zt, level, w, d, x, z, y, yaw, hw: (w * CELL) / 2, hd: (d * CELL) / 2, cells: [], seg, variant: v, ask: asked,
        label: e.model.label, brand: exact ? brand || undefined : e.model.brand ?? (brand || undefined), model: e.model, state: prog >= 1 ? 'active' : 'building', progress: Math.min(1, prog),
        buildDays: 5, cap: capacityFor(zt, level, w * d), occ, lv: 30, levelProgress: lp, born: this.day, inst: -1, buildInst: -1, buildH: 1, emitT: fx.float() * 5,
      };
      this.list.set(b.id, b);
      this.hash.insert(b, x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd);
      if (exact && cellIds) { for (const cid of cellIds) { const c = this.zones.cells.get(cid); if (c) { c.bld = b.id; b.cells.push(c); } } }
      else for (const c of this.zones.cellsNear(x, z, b.hw + b.hd + 4)) if (this.contains(b, c.x, c.z, -1)) { c.bld = b.id; b.cells.push(c); }
      this.terrain.flattenLot(this.corners(b), y, zt.startsWith('res') ? Paint.Lawn : Paint.Paved);
      this.trees.cut(x - b.hw - b.hd, z - b.hw - b.hd, x + b.hw + b.hd, z + b.hw + b.hd, (tx, tz) => this.contains(b, tx, tz, 1.5));
      this.placeInstance(b, e.id);
      if (exact) { b.progress = prog; b.state = open ? 'active' : 'building'; b.buildDays = buildDays!; b.lv = lv!; b.born = born!; if (abandoned! >= 0) b.abandoned = abandoned; this.writeMatrix(b, b.state === 'active' ? 1 : easeGrow(b.progress)); if (b.state === 'active') this.dropScaffold(b); }
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
      let minX = -b.hw, maxX = b.hw, minZ = -b.hd, maxZ = b.hd;
      let h = b.model.height;
      if (b.state === 'building') {
        // Construction dressing is horizontally unscaled, while its vertical
        // growth follows the eased building progress with an 18% minimum.
        // Mirror generateConstruction's envelope so its crane, platforms and
        // temporary barriers remain pickable outside the finished footprint.
        const W = b.w * CELL, D = b.d * CELL;
        const sw = Math.max(4, Math.min(W - 2.2, 22));
        const sd = Math.max(4, Math.min(D - 2.2, 18));
        const cz = -Math.max(0, D - sd) * 0.22;
        minZ = Math.min(minZ, cz - sd / 2 - 0.42);
        maxZ = Math.max(maxZ, cz + sd / 2 + 1.61);

        let constructionTop = b.model.height;
        if (b.buildH >= 14) {
          const boom = Math.min(34, sw + 12);
          const craneReach = sw / 2 + 1.3 + boom * 0.72;
          minX = Math.min(minX, -craneReach);
          maxX = Math.max(maxX, craneReach);
          constructionTop *= 1 + Math.min(12, b.buildH * 0.25) / b.buildH;
        }
        h = constructionTop;
      }
      inv.compose(new THREE.Vector3(b.x, b.y, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw), new THREE.Vector3(1, 1, 1)).invert();
      r.copy(ray).applyMatrix4(inv);
      box.min.set(minX, 0, minZ);
      box.max.set(maxX, h, maxZ);
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
    if (b.inst >= 0) this.batchOf(b).deleteInstance(b.inst);
    this.dropScaffold(b);
    this.terrain.paintCircle(b.x, b.z, Math.min(b.hw, b.hd), Paint.Dirt);
    this.zones.markOverlayDirty();
    this.onDemolish?.(b, reason);
  }

  /** Swap a building to a new level (same lot). */
  levelUp(b: Bld) {
    if (!isZoned(b)) return;
    const max = MAX_LEVEL[b.zone];
    if (b.level >= max) return;
    b.level++;
    b.variant = this.rng.int(0, variantsFor(b.zone) - 1);
    b.ask = b.brand ?? '';
    const e = this.modelFor(b.zone, b.level, b.w, b.d, b.variant, b.brand);
    b.model = e.model;
    b.label = e.model.label;
    b.cap = capacityFor(b.zone, b.level, b.w * b.d);
    b.levelProgress = 0;
    this.main.mesh.setGeometryIdAt(b.inst, e.id);
    b.state = 'building';
    b.progress = 0.35;
    b.buildDays = 4 + b.level;
    this.dropScaffold(b);
    const build = this.constructionFor(b.w, b.d, b.model.height);
    b.buildInst = this.kit.addInstance(build.id);
    b.buildH = build.height;
    this.writeMatrix(b, easeGrow(b.progress));
    this.onLevel?.(b);
  }

  /** Advance construction by game days. */
  tickConstruction(days: number, buildMul: number) {
    for (const b of this.list.values()) {
      if (b.state !== 'building') continue;
      const was = b.progress;
      b.progress = Math.min(1, b.progress + (days / b.buildDays) * buildMul);
      this.writeMatrix(b, easeGrow(b.progress));
      // a site is told about once per tenth it passes, not every step (a step moves it a few thousandths);
      // the tenth it reaches by opening is said by the 1 below instead
      if (this.onProgress) {
        const top = Math.min(9, Math.floor(b.progress * 10));
        for (let k = Math.floor(was * 10) + 1; k <= top; k++) this.onProgress(b, k / 10);
      }
      if (b.progress >= 1) {
        b.state = 'active';
        this.dropScaffold(b);
        this.onProgress?.(b, 1);
        this.onComplete?.(b);
      }
    }
  }

  counts() {
    let active = 0, building = 0, maxed = 0;
    for (const b of this.list.values()) {
      if (!isZoned(b)) continue;
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
