// Cities: Skylines-style zoning: 8m cells in blocks up to 4 deep along both sides
// of every zoneable road segment. Cells are invalid where they'd overlap roads,
// water, steep ground, communes or other blocks.
import * as THREE from 'three';
import { CELL, WATER } from '../config';
import type { ZoneType } from '../contracts';
import { clamp, closestOnSampled, locate, lerp, norm, SpatialHash, sub } from '../core/math';
import type { RoadNetwork, RSeg } from '../roads/network';
import { ROAD_TYPES } from '../roads/roadTypes';
import type { Terrain } from '../world/terrain';
import { mulberry32 } from '../core/rng';
import { litByLamps } from '../world/nightLights';

export const ZONE_COLORS: Record<ZoneType, number> = {
  resLow: 0x4bd66f,
  resHigh: 0x1f9d4a,
  comLow: 0x3aa0ff,
  comHigh: 0x1f5fd6,
  industry: 0xffc93a,
  office: 0xb26bff,
};

export const ZONE_LABEL: Record<ZoneType, string> = {
  resLow: 'Suburban Slop (Low Res)',
  resHigh: 'Luxury Slop (High Res)',
  comLow: 'Strip Mall (Low Com)',
  comHigh: 'Big Box (High Com)',
  industry: 'Industrial Slop',
  office: 'Content Farms (Office)',
};

const DEPTH = 4;

export interface ZCell {
  id: number;
  seg: number;
  side: 1 | -1;
  col: number;
  row: number;
  x: number;
  z: number;
  y: number;
  yaw: number; // local +Z (front) faces the road
  valid: boolean;
  zone: ZoneType | null;
  bld: number; // building id occupying it, 0 = none
}

/**
 * A lot cell. Two looks: with the zoning tool out (`soft`) an even wash that thins toward the edge, with no line round it,
 * so waiting lots read as land in a zone and not as a grid of tiles (the planting beds below say where a lot ends);
 * with the tool in, a solid rim and a light fill, so each cell reads as a lot with edges. Zoned cells take their zone's
 * colour through the instance tint.
 */
function cellTexture(soft: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = soft ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.42)';
  x.fillRect(0, 0, 64, 64);
  if (soft) {
    x.globalCompositeOperation = 'destination-out';
    for (const [x0, y0, x1, y1, w, h] of [[0, 0, 0, 22, 64, 22], [0, 64, 0, 42, 64, 22], [0, 0, 22, 0, 22, 64], [64, 0, 42, 0, 22, 64]] as const) {
      const gr = x.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.fillRect(x0 === 64 ? 42 : x0, y0 === 64 ? 42 : y0, w, h);
    }
  } else {
    x.strokeStyle = 'rgba(255,255,255,1)';
    x.lineWidth = 6;
    x.strokeRect(3, 3, 58, 58);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A planting bed / verge strip: one 8 m cell long (256 px) by 2.2 m deep (70 px), tileable along its length so the strips
 * of neighbouring cells run on into one another. Mulch a shade darker than the dry ground, low shrubs in muted greens
 * that come in runs with gaps between them (a hedge-row is never a string of dots), dry grass at both edges, and both long
 * edges fade out smoothly: it should read as a planted edge and never as a line.
 */
function bedTexture(): THREE.Texture {
  const W = 256, H = 70;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const rnd = mulberry32(0xbed5);
  const wrap = (fn: (dx: number) => void) => { fn(-W); fn(0); fn(W); };
  x.fillStyle = 'rgb(112,96,64)';
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 1800; i++) { // mulch and soil flecks
    x.fillStyle = `rgba(${rnd() < 0.5 ? '150,128,92' : '78,64,44'},${0.16 + rnd() * 0.28})`;
    x.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 1.5);
  }
  // shrub runs: where the (wrapping) density wave is high there are clumps, where it is low bare mulch
  const ph = rnd() * 6.28, ph2 = rnd() * 6.28;
  for (let i = 0; i < 30; i++) {
    const cx = (i + rnd()) * (W / 30);
    const dens = 0.5 + 0.5 * (0.6 * Math.sin((cx / W) * Math.PI * 2 + ph) + 0.4 * Math.sin((cx / W) * Math.PI * 6 + ph2));
    if (rnd() > 0.25 + dens * 0.75) continue;
    const cy = H / 2 + (rnd() - 0.5) * 22, r = 5.5 + rnd() * 6;
    for (const [dy, k, rgb] of [[2.5, 1.0, '58,78,44'], [0, 0.82, '82,110,58'], [-2.5, 0.5, '114,142,76']] as const) {
      x.fillStyle = `rgb(${rgb})`;
      wrap((dx) => { x.beginPath(); x.ellipse(cx + dx, cy + dy, r * k * 1.2, r * k, 0, 0, Math.PI * 2); x.fill(); });
    }
  }
  for (let i = 0; i < 26; i++) { // dry grass blades at both edges
    const px = rnd() * W, edge = rnd() < 0.5 ? 0 : H, len = 5 + rnd() * 9;
    x.strokeStyle = `rgba(${140 + rnd() * 40},${128 + rnd() * 30},${70 + rnd() * 24},0.85)`;
    x.lineWidth = 1.2;
    for (let b = 0; b < 6; b++) {
      const bx = px + (b - 3) * 1.8, dir = edge === 0 ? 1 : -1;
      wrap((dx) => { x.beginPath(); x.moveTo(bx + dx, edge); x.lineTo(bx + dx + (rnd() - 0.5) * 5, edge + dir * len * (0.6 + rnd() * 0.6)); x.stroke(); });
    }
  }
  x.globalCompositeOperation = 'destination-in'; // both long edges fade out (smoothstep over the outer 30%)
  const gr = x.createLinearGradient(0, 0, 0, H);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let i = 0; i <= 10; i++) gr.addColorStop(i * 0.03, `rgba(0,0,0,${sm(i / 10)})`);
  for (let i = 0; i <= 10; i++) gr.addColorStop(0.7 + i * 0.03, `rgba(0,0,0,${sm(1 - i / 10)})`);
  x.fillStyle = gr;
  x.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** how each zone tints its beds: lush at homes, dusty at the factories */
const BED_TINT: Record<ZoneType, [number, number, number]> = {
  resLow: [0.96, 1.0, 0.9],
  resHigh: [0.86, 1.0, 0.88],
  comLow: [1.0, 0.97, 0.9],
  comHigh: [0.94, 0.98, 1.0],
  industry: [1.0, 0.9, 0.76],
  office: [0.86, 0.98, 0.92],
};
/** most strips drawn at once (a strip is a dozen triangles; only the edges of unbuilt zoned land get one) */
const BED_MAX = 8000;

export class Zoning {
  cells = new Map<number, ZCell>();
  bySeg = new Map<number, ZCell[][][]>(); // seg -> [sideIdx][col][row]
  private hash = new SpatialHash<ZCell>(24);
  private nextId = 1;
  private memory = new Map<number, ZoneType>(); // remembered zoning across rebuilds
  private dirtySegs = new Set<number>();
  private revalidate = new Set<number>();
  private overlayMesh: THREE.InstancedMesh;
  private tileSoft = cellTexture(true);
  private tileCrisp = cellTexture(false);
  /** planting beds and verges along the edges of unbuilt zoned land (one merged mesh) */
  private bedMesh: THREE.Mesh;
  private bedDirty = true;
  private bedVer = -1;
  private bedWait = 0;
  private overlayOn = false;
  private overlayDirty = true;
  private capacity = 60000;
  blockers: { x: number; z: number; r: number }[] = [];
  /** Called when cells lose validity or zone (buildings may need to go). */
  onCellsLost?: (cells: ZCell[]) => void;
  /** Id of the building at x,z that a new cell of this road should belong to (0 if none). */
  occupantAt?: (x: number, z: number, segId: number) => number;
  /** A road was rebuilt (widened): its buildings keep their lots unless the new road runs into them. */
  onRelink?: (buildingIds: number[]) => void;
  private relink = new Set<number>();
  version = 0;

  constructor(private net: RoadNetwork, private terrain: Terrain, scene: THREE.Scene) {
    const g = new THREE.PlaneGeometry(CELL - 0.7, CELL - 0.7);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: this.tileSoft, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.overlayMesh = new THREE.InstancedMesh(g, mat, this.capacity);
    this.overlayMesh.count = 0;
    this.overlayMesh.renderOrder = 3;
    this.overlayMesh.frustumCulled = false;
    scene.add(this.overlayMesh);

    const bedMat = new THREE.MeshStandardMaterial({ map: bedTexture(), vertexColors: true, transparent: true, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    // (a strip is laid on the height map, and the far terrain levels are coarser than that: fade the beds out with distance)
    bedMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= 1.0 - smoothstep(180.0, 380.0, length(vViewPosition));\n#include <alphatest_fragment>');
    };
    bedMat.customProgramCacheKey = () => 'zoning-beds';
    litByLamps(bedMat);
    this.bedMesh = new THREE.Mesh(new THREE.BufferGeometry(), bedMat);
    this.bedMesh.renderOrder = 2;
    this.bedMesh.frustumCulled = false;
    this.bedMesh.receiveShadow = true;
    scene.add(this.bedMesh);

    net.events.on('segAdded', (s) => this.dirtySegs.add(s.id));
    // a widened road rebuilds its cells; the buildings on them are re-linked
    // after the rebuild instead of being bulldozed with the old cells
    net.events.on('segChanged', (s) => { this.remember(s.id); this.dropSeg(s.id, true); this.dirtySegs.add(s.id); });
    // a reshaped junction changes which lots fit along the road; lots rebuild
    // and the buildings on them are re-linked, not bulldozed
    net.events.on('segTrimmed', (s) => { this.remember(s.id); this.dropSeg(s.id, true); this.dirtySegs.add(s.id); });
    // a road split in two by a new junction keeps its lots and buildings
    // (re-linked to the two new pieces); a bulldozed road takes them with it
    net.events.on('segRemoved', (s) => { this.remember(s.id); this.dropSeg(s.id, net.splitting === s.id); });
  }

  private memKey(x: number, z: number) {
    return (Math.round(x / 4) + 2048) * 8192 + (Math.round(z / 4) + 2048);
  }

  private remember(segId: number) {
    const blocks = this.bySeg.get(segId);
    if (!blocks) return;
    for (const side of blocks) for (const col of side) for (const c of col) if (c.zone) this.memory.set(this.memKey(c.x, c.z), c.zone);
  }

  private recall(x: number, z: number): ZoneType | null {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const k = (Math.round(x / 4) + dx + 2048) * 8192 + (Math.round(z / 4) + dz + 2048);
        const v = this.memory.get(k);
        if (v) return v;
      }
    return null;
  }

  private dropSeg(segId: number, relink = false) {
    const blocks = this.bySeg.get(segId);
    if (!blocks) return;
    const lost: ZCell[] = [];
    for (const side of blocks)
      for (const col of side)
        for (const c of col) {
          this.cells.delete(c.id);
          this.hash.remove(c, c.x, c.z, c.x, c.z);
          if (c.bld) { if (relink) this.relink.add(c.bld); else lost.push(c); }
          this.markNeighborsForRevalidation(c);
        }
    this.bySeg.delete(segId);
    this.overlayDirty = true;
    this.version++;
    if (lost.length) this.onCellsLost?.(lost);
  }

  private markNeighborsForRevalidation(c: ZCell) {
    for (const o of this.hash.query(c.x - 10, c.z - 10, c.x + 10, c.z + 10)) this.revalidate.add(o.seg);
  }

  private buildSeg(seg: RSeg) {
    const t = ROAD_TYPES[seg.type];
    // nothing fronts onto an overpass
    if (!t.zoneable || seg.over) return;
    const hw = t.width / 2;
    const s0 = seg.trimA, s1 = seg.length - seg.trimB;
    const cols = Math.floor((s1 - s0) / CELL);
    if (cols < 1) return;
    const start = s0 + (s1 - s0 - cols * CELL) / 2;
    const blocks: ZCell[][][] = [[], []];
    for (let si = 0; si < 2; si++) {
      const side = (si === 0 ? 1 : -1) as 1 | -1;
      for (let col = 0; col < cols; col++) {
        const d = start + (col + 0.5) * CELL;
        const { i, f } = locate(seg.samp, d);
        const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
        const p = { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) };
        const tan = norm(sub(b, a));
        const r = { x: -tan.z * side, z: tan.x * side };
        const column: ZCell[] = [];
        for (let row = 0; row < DEPTH; row++) {
          const off = hw + CELL / 2 + 0.4 + row * CELL;
          const x = p.x + r.x * off, z = p.z + r.z * off;
          const c: ZCell = {
            id: this.nextId++, seg: seg.id, side, col, row, x, z, y: this.terrain.h(x, z),
            yaw: Math.atan2(-r.x, -r.z), valid: false, zone: null, bld: 0,
          };
          column.push(c);
        }
        blocks[si].push(column);
      }
    }
    this.bySeg.set(seg.id, blocks);
    for (const side of blocks) for (const col of side) for (const c of col) {
      c.bld = this.occupantAt?.(c.x, c.z, seg.id) ?? 0;
      this.cells.set(c.id, c);
      this.hash.insert(c, c.x, c.z, c.x, c.z);
    }
    this.validateSeg(seg.id);
    for (const side of blocks) for (const col of side) for (const c of col) {
      if (c.valid) {
        const z = this.recall(c.x, c.z);
        if (z) c.zone = z;
      }
    }
  }

  private validateSeg(segId: number) {
    const blocks = this.bySeg.get(segId);
    const seg = this.net.segs.get(segId);
    if (!blocks || !seg) return;
    const lost: ZCell[] = [];
    for (const side of blocks)
      for (const col of side) {
        let ok = true;
        for (const c of col) {
          const was = c.valid;
          c.valid = ok && this.cellOk(c, seg);
          if (!c.valid) ok = false;
          if (was && !c.valid && (c.bld || c.zone)) lost.push(c);
          if (!c.valid) c.zone = c.zone && was ? null : c.zone;
        }
      }
    this.overlayDirty = true;
    this.version++;
    if (lost.length) this.onCellsLost?.(lost);
  }

  private cellOk(c: ZCell, own: RSeg): boolean {
    if (!this.terrain.inBounds(c.x, c.z, 6)) return false;
    // water + slope from corners
    const hc = this.terrain.h(c.x, c.z);
    if (hc < WATER + 0.35) return false;
    let lo = hc, hi = hc;
    for (const [dx, dz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) {
      const h = this.terrain.h(c.x + dx, c.z + dz);
      if (h < WATER + 0.2) return false;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (hi - lo > 5.5) return false;
    c.y = hc;
    for (const b of this.blockers) if (Math.hypot(c.x - b.x, c.z - b.z) < b.r + 5) return false;
    // roads
    for (const s of this.net.segsNear(c.x - 30, c.z - 30, c.x + 30, c.z + 30)) {
      const hw = ROAD_TYPES[s.type].width / 2;
      const cl = closestOnSampled({ x: c.x, z: c.z }, s.samp);
      const lim = s.id === own.id ? hw + 3.2 : hw + 5.0;
      if (cl.d < lim) return false;
    }
    // other blocks' cells: the older cell wins
    for (const o of this.hash.query(c.x - 8, c.z - 8, c.x + 8, c.z + 8)) {
      if (o === c || !o.valid || o.seg === c.seg) continue;
      if (Math.hypot(o.x - c.x, o.z - c.z) < 7.2 && o.id < c.id) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ API
  setOverlay(on: boolean) {
    this.overlayOn = on;
    this.overlayDirty = true;
  }

  /** land the player may zone (null = everywhere); see sim/land.ts */
  allowed: ((x: number, z: number) => boolean) | null = null;

  /** cells a zoning stroke skipped because they already had another zone */
  skipped = 0;
  /** true while builders want this zone (the overlay dims zoned lots that are waiting for demand) */
  growable: ((z: ZoneType) => boolean) | null = null;
  /** what the current brush stroke did, by cell (a stroke repaints the same cells many times) */
  private stroke: { changed: Set<number>; notOwned: Set<number>; otherZone: Set<number>; built: Set<number> } | null = null;

  beginStroke() {
    this.stroke = { changed: new Set(), notOwned: new Set(), otherZone: new Set(), built: new Set() };
  }

  /** counts for the stroke that just ended: lots changed, and lots refused by reason */
  endStroke() {
    const s = this.stroke;
    this.stroke = null;
    return { changed: s?.changed.size ?? 0, notOwned: s?.notOwned.size ?? 0, otherZone: s?.otherZone.size ?? 0, built: s?.built.size ?? 0 };
  }

  get overlayActive() { return this.overlayOn; }

  paint(x: number, z: number, r: number, zone: ZoneType | null) {
    let n = 0;
    const st = this.stroke;
    for (const c of this.hash.query(x - r, z - r, x + r, z + r)) {
      if (!c.valid || Math.hypot(c.x - x, c.z - z) > r) continue;
      // standing buildings keep their lots (only count it when the stroke wanted something else)
      if (c.bld) { if (c.zone !== zone) st?.built.add(c.id); continue; }
      if (zone && this.allowed && !this.allowed(c.x, c.z)) { st?.notOwned.add(c.id); continue; }
      // zoned land keeps its zone: dezone it first to change it
      if (zone && c.zone && c.zone !== zone) { this.skipped++; st?.otherZone.add(c.id); continue; }
      if (c.zone !== zone) { c.zone = zone; n++; st?.changed.add(c.id); }
    }
    if (n) { this.overlayDirty = true; this.version++; }
    return n;
  }

  cellsNear(x: number, z: number, r: number): ZCell[] {
    const out: ZCell[] = [];
    for (const c of this.hash.query(x - r, z - r, x + r, z + r)) if (Math.hypot(c.x - x, c.z - z) <= r) out.push(c);
    return out;
  }

  block(segId: number, side: 1 | -1): ZCell[][] | undefined {
    return this.bySeg.get(segId)?.[side === 1 ? 0 : 1];
  }

  /** Try to carve a lot of up to w x d cells starting at a row-0 cell. */
  lotFrom(c: ZCell, wantW: number, wantD: number): ZCell[][] | null {
    const blk = this.block(c.seg, c.side);
    if (!blk || c.row !== 0) return null;
    const ok = (cell: ZCell | undefined, zone: ZoneType) => !!cell && cell.valid && cell.zone === zone && !cell.bld;
    const zone = c.zone!;
    // widen to the right, then left if needed
    let c0 = c.col, c1 = c.col;
    while (c1 - c0 + 1 < wantW && ok(blk[c1 + 1]?.[0], zone)) c1++;
    while (c1 - c0 + 1 < wantW && ok(blk[c0 - 1]?.[0], zone)) c0--;
    let d = 1;
    while (d < wantD) {
      let all = true;
      for (let k = c0; k <= c1; k++) if (!ok(blk[k]?.[d], zone)) { all = false; break; }
      if (!all) break;
      d++;
    }
    const lot: ZCell[][] = [];
    for (let k = c0; k <= c1; k++) {
      const column: ZCell[] = [];
      for (let r = 0; r < d; r++) column.push(blk[k][r]);
      lot.push(column);
    }
    return lot;
  }

  /** Empty, valid, zoned front-row cells for growth. */
  candidates(zone: ZoneType, out: ZCell[] = []): ZCell[] {
    out.length = 0;
    for (const c of this.cells.values()) if (c.row === 0 && c.valid && c.zone === zone && !c.bld) out.push(c);
    return out;
  }

  counts() {
    const zoned: Record<string, number> = {};
    let valid = 0, built = 0;
    for (const c of this.cells.values()) {
      if (!c.valid) continue;
      valid++;
      if (c.bld) built++;
      if (c.zone) zoned[c.zone] = (zoned[c.zone] ?? 0) + 1;
    }
    return { valid, built, zoned };
  }

  serialize() {
    const out: [number, number, string][] = [];
    for (const c of this.cells.values()) if (c.valid && c.zone) out.push([+c.x.toFixed(1), +c.z.toFixed(1), c.zone]);
    return out;
  }

  restore(rows: [number, number, string][]) {
    this.update();
    for (const [x, z, zone] of rows) {
      for (const c of this.hash.query(x - 2, z - 2, x + 2, z + 2)) {
        if (c.valid && Math.hypot(c.x - x, c.z - z) < 2) c.zone = zone as ZoneType;
      }
    }
    this.overlayDirty = true;
    this.version++;
  }

  refreshBlockers() {
    for (const segId of this.bySeg.keys()) this.revalidate.add(segId);
  }

  update() {
    if (this.dirtySegs.size) {
      for (const id of this.dirtySegs) {
        const seg = this.net.segs.get(id);
        if (seg && !this.bySeg.has(id)) this.buildSeg(seg);
      }
      // neighbors may now overlap
      for (const id of this.dirtySegs) {
        const seg = this.net.segs.get(id);
        if (!seg) continue;
        for (const o of this.net.segsNear(seg.minX - 40, seg.minZ - 40, seg.maxX + 40, seg.maxZ + 40)) if (o.id !== id) this.revalidate.add(o.id);
      }
      this.dirtySegs.clear();
      this.memory.clear();
    }
    if (this.revalidate.size) {
      for (const id of this.revalidate) this.validateSeg(id);
      this.revalidate.clear();
    }
    if (this.relink.size) {
      const ids = [...this.relink];
      this.relink.clear();
      this.onRelink?.(ids);
    }
    if (this.overlayDirty) this.rebuildOverlay();
    // the beds follow the ground: a building levelling its lot next door moves the height they sit on (checked every half second or so)
    if (this.bedDirty || (this.bedVer !== this.terrain.surfaceVersion && ++this.bedWait > 30)) this.rebuildBeds();
  }

  /** true if a valid cell of the same zone lies across the edge of `c` toward (x, z) */
  private zoneAcross(c: ZCell, x: number, z: number): boolean {
    for (const o of this.hash.query(x - 2, z - 2, x + 2, z + 2)) {
      if (o !== c && o.valid && !o.bld && o.zone === c.zone && Math.hypot(o.x - x, o.z - z) < 3.6) return true;
    }
    return false;
  }

  /**
   * Planting beds and verges along the edges of unbuilt zoned land, where the next lot is not the same zone (or is a
   * building, or is the road): what says where a lot ends now that the idle tile has no rim. One merged, terrain-following mesh.
   */
  private rebuildBeds() {
    this.bedDirty = false;
    this.bedVer = this.terrain.surfaceVersion;
    this.bedWait = 0;
    const P: number[] = [], UV: number[] = [], C: number[] = [], I: number[] = [];
    const SEG = 3, D = 2.2, HALF = CELL / 2;
    const hash = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
    let strips = 0;
    // local outward normals: front (toward the road), back, and the two sides
    const EDGES: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const has = [false, false, false, false];
    outer: for (const c of this.cells.values()) {
      if (!c.valid || c.bld || !c.zone) continue;
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), tint = BED_TINT[c.zone];
      for (let e = 0; e < 4; e++) {
        const [nx, nz] = EDGES[e];
        has[e] = !this.zoneAcross(c, c.x + (nx * cs + nz * sn) * CELL, c.z + (-nx * sn + nz * cs) * CELL);
      }
      for (let e = 0; e < 4; e++) {
        if (!has[e]) continue;
        if (strips >= BED_MAX) break outer;
        strips++;
        const [nx, nz] = EDGES[e];
        // along the edge the strip runs the whole cell, so the strips of neighbouring cells join; a side strip stops short where a
        // front or back strip crosses its end (they overlap by half a depth)
        let z0 = -HALF, z1 = HALF;
        if (nx !== 0) { if (has[1]) z0 += D * 0.5; if (has[0]) z1 -= D * 0.5; }
        const depth = D * (0.9 + 0.2 * hash(c.id, e));
        const flip = hash(e + 3, c.id) < 0.5;
        const base = P.length / 3;
        for (let k = 0; k <= SEG; k++) {
          // (local coordinates: the tangent runs along x for the front and back edges, along z for the sides)
          const t = nx === 0 ? -HALF + (CELL * k) / SEG : z0 + ((z1 - z0) * k) / SEG;
          const u = nx === 0 ? (t + HALF) / CELL : (t + HALF) / CELL;
          for (const a of [HALF - depth + (hash(c.id * 7 + e, k) - 0.5) * 0.3, HALF]) { // (the inner edge wanders a little)
            const lx = nx !== 0 ? nx * a : t, lz = nx !== 0 ? t : nz * a;
            const wx = c.x + lx * cs + lz * sn, wz = c.z - lx * sn + lz * cs;
            P.push(wx, this.terrain.h(wx, wz) + 0.07, wz);
            UV.push(flip ? 1 - u : u, a === HALF ? 1 : 0);
            const k2 = 0.92 + 0.16 * hash(c.id + k, e * 3);
            C.push(tint[0] * k2, tint[1] * k2, tint[2] * k2);
          }
        }
        // (wound to face up whichever way this edge runs)
        const ax = P[(base + 1) * 3] - P[base * 3], az = P[(base + 1) * 3 + 2] - P[base * 3 + 2];
        const bx = P[(base + 2) * 3] - P[base * 3], bz = P[(base + 2) * 3 + 2] - P[base * 3 + 2];
        const up = az * bx - ax * bz > 0;
        for (let k = 0; k < SEG; k++) {
          const a0 = base + k * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
          if (up) I.push(a0, b0, a1, b0, b1, a1); else I.push(a0, a1, b0, b0, a1, b1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    if (P.length) {
      const nor = new Float32Array(P.length);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I);
    }
    this.bedMesh.geometry.dispose();
    this.bedMesh.geometry = g;
  }

  private rebuildOverlay() {
    this.overlayDirty = false;
    this.bedDirty = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let n = 0;
    for (const c of this.cells.values()) {
      if (!c.valid || c.bld) continue;
      if (!this.overlayOn && !c.zone) continue;
      if (n >= this.capacity) break;
      q.setFromAxisAngle(up, c.yaw);
      m.compose(new THREE.Vector3(c.x, c.y + 0.35, c.z), q, new THREE.Vector3(1, 1, 1));
      this.overlayMesh.setMatrixAt(n, m);
      // with the zoning tool out: bright = builders want these lots, dim = waiting for demand
      if (c.zone) col.setHex(ZONE_COLORS[c.zone]).multiplyScalar(this.overlayOn ? (this.growable && !this.growable(c.zone) ? 0.38 : 1) : 0.8);
      else col.setRGB(0.85, 0.85, 0.9);
      this.overlayMesh.setColorAt(n, col);
      n++;
    }
    this.overlayMesh.count = n;
    // outside the zoning tool, empty zoned lots are only a hint: at 0.3 the town
    // read as a spreadsheet of coloured squares from every camera
    const om = this.overlayMesh.material as THREE.MeshBasicMaterial;
    om.opacity = this.overlayOn ? 0.85 : 0.2;
    om.map = this.overlayOn ? this.tileCrisp : this.tileSoft;
    this.overlayMesh.instanceMatrix.needsUpdate = true;
    if (this.overlayMesh.instanceColor) this.overlayMesh.instanceColor.needsUpdate = true;
  }

  /** Painted zone cells are unlit paint: dim them after dark unless the overlay is up. */
  setNight(n: number) {
    (this.overlayMesh.material as THREE.MeshBasicMaterial).color.setScalar(this.overlayOn ? 1 : 1 - n * 0.8);
  }

  markOverlayDirty() {
    this.overlayDirty = true;
  }
}

export { clamp };
