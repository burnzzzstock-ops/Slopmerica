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

export class Zoning {
  cells = new Map<number, ZCell>();
  bySeg = new Map<number, ZCell[][][]>(); // seg -> [sideIdx][col][row]
  private hash = new SpatialHash<ZCell>(24);
  private nextId = 1;
  private memory = new Map<number, ZoneType>(); // remembered zoning across rebuilds
  private dirtySegs = new Set<number>();
  private revalidate = new Set<number>();
  private overlayMesh: THREE.InstancedMesh;
  private overlayOn = false;
  private overlayDirty = true;
  private capacity = 60000;
  blockers: { x: number; z: number; r: number }[] = [];
  /** Called when cells lose validity or zone (buildings may need to go). */
  onCellsLost?: (cells: ZCell[]) => void;
  version = 0;

  constructor(private net: RoadNetwork, private terrain: Terrain, scene: THREE.Scene) {
    const g = new THREE.PlaneGeometry(CELL - 0.7, CELL - 0.7);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.overlayMesh = new THREE.InstancedMesh(g, mat, this.capacity);
    this.overlayMesh.count = 0;
    this.overlayMesh.renderOrder = 3;
    this.overlayMesh.frustumCulled = false;
    scene.add(this.overlayMesh);

    net.events.on('segAdded', (s) => this.dirtySegs.add(s.id));
    net.events.on('segChanged', (s) => { this.remember(s.id); this.dropSeg(s.id); this.dirtySegs.add(s.id); });
    net.events.on('segRemoved', (s) => { this.remember(s.id); this.dropSeg(s.id); });
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

  private dropSeg(segId: number) {
    const blocks = this.bySeg.get(segId);
    if (!blocks) return;
    const lost: ZCell[] = [];
    for (const side of blocks)
      for (const col of side)
        for (const c of col) {
          this.cells.delete(c.id);
          this.hash.remove(c, c.x, c.z, c.x, c.z);
          if (c.bld) lost.push(c);
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
    if (!t.zoneable) return;
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
    for (const side of blocks) for (const col of side) for (const c of col) { this.cells.set(c.id, c); this.hash.insert(c, c.x, c.z, c.x, c.z); }
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

  paint(x: number, z: number, r: number, zone: ZoneType | null) {
    let n = 0;
    for (const c of this.hash.query(x - r, z - r, x + r, z + r)) {
      if (!c.valid || c.bld) continue;
      if (Math.hypot(c.x - x, c.z - z) > r) continue;
      if (c.zone !== zone) { c.zone = zone; n++; }
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
    if (this.overlayDirty) this.rebuildOverlay();
  }

  private rebuildOverlay() {
    this.overlayDirty = false;
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
      if (c.zone) col.setHex(ZONE_COLORS[c.zone]).multiplyScalar(this.overlayOn ? 1 : 0.8);
      else col.setRGB(0.85, 0.85, 0.9);
      this.overlayMesh.setColorAt(n, col);
      n++;
    }
    this.overlayMesh.count = n;
    (this.overlayMesh.material as THREE.MeshBasicMaterial).opacity = this.overlayOn ? 0.55 : 0.3;
    this.overlayMesh.instanceMatrix.needsUpdate = true;
    if (this.overlayMesh.instanceColor) this.overlayMesh.instanceColor.needsUpdate = true;
  }

  markOverlayDirty() {
    this.overlayDirty = true;
  }
}

export { clamp };
