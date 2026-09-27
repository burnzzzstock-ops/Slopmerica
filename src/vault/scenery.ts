// The Asset Vault's road furniture, placed by the road network itself (no
// lots): express-lane gantries spanning the big stroads and the Slopway,
// pedestrian overpasses where a stroad cuts through shops, fake-pine cell
// towers beside the highway, a substation next to every power plant, a token
// kiosk next to every bus depot, fiber huts on local corners, and a Bus Stop
// to Nowhere at the end of every dead end. Drawn with the building
// material as instanced meshes, re-placed when the roads or buildings change.
import * as THREE from 'three';
import type { Game } from '../game';
import type { RSeg } from '../roads/network';
import { ROAD_TYPES, carriageHalf } from '../roads/roadTypes';
import { locate } from '../core/math';
import { HALF, WATER } from '../config';
import { generateVaultScaled } from '../buildings/generator';
import { vaultAsset, vaultFamilyAssets, vaultReady } from './vault';

interface Item { family: string; index: number; s: number; x: number; y: number; z: number; yaw: number }

const BIG = new Set(['stroad4', 'stroad6', 'stroad8', 'highway']);
const STROAD = new Set(['stroad4', 'stroad6', 'stroad8']);
const LOCAL = new Set(['twoLane', 'gravel', 'oneWay1']);
const POWER = new Set(['coalPlant', 'gasPeaker', 'solarFarm', 'nuclearPlant']);
const DEPOT = new Set(['busDepot']);

const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

export class VaultScenery {
  readonly group = new THREE.Group();
  /** placements by family, for tests and the audit */
  counts: Record<string, number> = {};
  private meshes = new Map<string, THREE.InstancedMesh>();
  private dirty = true;
  private t = 0;
  private lastBlds = -1;
  private refreshT = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private v = new THREE.Vector3();

  constructor(private g: Game) {
    this.group.name = 'vault-scenery';
    g.scene.add(this.group);
    g.net.events.on('changed', () => (this.dirty = true));
  }

  update(dt: number) {
    if (!vaultReady()) return;
    this.t -= dt;
    this.refreshT -= dt;
    const nb = this.g.buildings.list.size;
    if (nb !== this.lastBlds || this.refreshT <= 0) { this.lastBlds = nb; this.refreshT = 15; this.dirty = true; }
    if (this.dirty && this.t <= 0) {
      this.dirty = false;
      this.t = 2; // debounce: a road being drawn changes every frame
      this.place();
    }
  }

  // ------------------------------------------------------------------ where things go
  /** clear ground: dry, off the roads, off zoned or built land */
  private free(x: number, z: number, r: number) {
    const g = this.g;
    if (Math.abs(x) > HALF - 120 || Math.abs(z) > HALF - 120) return false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (g.terrain.h(x + dx, z + dz) < WATER + 0.4) return false;
    if (g.buildings.near(x, z, r + 4).some((b) => Math.abs(b.x - x) < b.hw + b.hd + r && Math.abs(b.z - z) < b.hw + b.hd + r)) return false;
    for (const s of g.net.segsNear(x - r - 20, z - r - 20, x + r + 20, z + r + 20)) {
      const hw = ROAD_TYPES[s.type].width / 2 + r;
      for (const p of s.samp.pts) if (Math.hypot(p.x - x, p.z - z) < hw) return false;
    }
    if (g.zones.cellsNear(x, z, r + 4).some((c) => c.zone || c.bld)) return false;
    return true;
  }

  /** a point d along a segment: position, road height, tangent, right-hand normal */
  private at(seg: RSeg, d: number) {
    const { i, f } = locate(seg.samp, Math.max(0, Math.min(seg.length, d)));
    const a = seg.samp.pts[i], b = seg.samp.pts[Math.min(i + 1, seg.samp.pts.length - 1)];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: seg.hs[i] + (seg.hs[Math.min(i + 1, seg.hs.length - 1)] - seg.hs[i]) * f, t: { x: tx / tl, z: tz / tl }, r: { x: -tz / tl, z: tx / tl } };
  }

  /** the family's plan whose span (x) is closest to `span`, and the scale that makes it exact */
  private spanning(family: string, span: number) {
    let best = -1, err = Infinity;
    for (const i of vaultFamilyAssets(family)) {
      const a = vaultAsset(i), w = a.maxX - a.minX;
      if (Math.abs(w - span) < err) { err = Math.abs(w - span); best = i; }
    }
    if (best < 0) return null;
    const a = vaultAsset(best);
    return { index: best, s: Math.max(0.6, Math.min(1.5, span / (a.maxX - a.minX))) };
  }

  private place() {
    const g = this.g, items: Item[] = [];
    const add = (family: string, index: number, s: number, x: number, y: number, z: number, yaw: number) => items.push({ family, index, s, x, y, z, yaw });
    // roads are stored in ~100 m pieces: place at their middles, kept apart by distance
    const placed: Record<string, { x: number; z: number }[]> = {};
    const near = (fam: string, x: number, z: number, min: number) => (placed[fam] ?? []).some((p) => Math.hypot(p.x - x, p.z - z) < min);
    const mark = (fam: string, x: number, z: number) => (placed[fam] ??= []).push({ x, z });
    for (const seg of [...g.net.segs.values()].sort((a, b) => a.id - b.id)) {
      if (seg.over || seg.length < 50) continue;
      const mid = seg.length / 2;
      if (mid < seg.trimA + 12 || seg.length - mid < seg.trimB + 12) continue;
      const t = ROAD_TYPES[seg.type], p = this.at(seg, mid);
      const across = Math.atan2(-p.r.z, p.r.x);
      // gantries: dynamic pricing over the big roads, every half kilometre
      if (BIG.has(seg.type) && !near('gantry', p.x, p.z, 480)) {
        const fit = this.spanning('express-lane-gantry', 2 * carriageHalf(t) + (seg.type === 'highway' ? 3 : 2));
        if (fit) { add('express-lane-gantry', fit.index, fit.s, p.x, p.y, p.z, across); mark('gantry', p.x, p.z); continue; }
      }
      // overpasses: where a stroad cuts through shops
      if (STROAD.has(seg.type) && !near('overpass', p.x, p.z, 380) && !near('gantry', p.x, p.z, 90)) {
        const shops = g.buildings.near(p.x, p.z, 45).filter((b) => b.zone === 'comLow' || b.zone === 'comHigh' || b.zone === 'office').length;
        const fit = shops >= 2 ? this.spanning('pedestrian-overpass', t.width + 1) : null;
        if (fit) { add('pedestrian-overpass', fit.index, fit.s, p.x, p.y, p.z, across); mark('overpass', p.x, p.z); continue; }
      }
      // cell towers dressed as pines, back from the highway and the stroads
      if (BIG.has(seg.type) && !near('tower', p.x, p.z, 650)) {
        const ids = vaultFamilyAssets('frankenpine-cell-tower');
        const side = hash(seg.id, 1) < 0.5 ? -1 : 1, off = t.width / 2 + 14;
        const x = p.x + p.r.x * side * off, z = p.z + p.r.z * side * off;
        if (ids.length && this.free(x, z, 6)) { add('frankenpine-cell-tower', ids[Math.floor(hash(seg.id, 7) * ids.length)], 1, x, g.terrain.h(x, z), z, hash(seg.id, 3) * 6.28); mark('tower', p.x, p.z); }
      }
    }
    // a Bus Stop to Nowhere at the end of every dead end
    const stops = vaultFamilyAssets('bus-stop-nowhere');
    let n = 0;
    for (const node of g.net.nodes.values()) {
      if (node.segs.length !== 1 || !stops.length || n >= 24) continue;
      const seg = g.net.segs.get(node.segs[0]);
      if (!seg || !LOCAL.has(seg.type) || Math.abs(node.x) > HALF - 200 || Math.abs(node.z) > HALF - 200) continue;
      const atA = seg.a === node.id, p = this.at(seg, atA ? 6 : seg.length - 6);
      const side = hash(node.id, 3) < 0.5 ? -1 : 1, off = ROAD_TYPES[seg.type].width / 2 + 2.2;
      const x = p.x + p.r.x * side * off, z = p.z + p.r.z * side * off;
      if (!this.free(x, z, 1)) continue;
      // facing the road
      add('bus-stop-nowhere', stops[Math.floor(hash(node.id, 5) * stops.length)], 1, x, g.terrain.h(x, z), z, Math.atan2(-p.r.x * side, -p.r.z * side));
      n++;
    }
    // a "Broadband Promise" fiber hut on a free corner of local junctions
    const huts = vaultFamilyAssets('fiber-hut');
    for (const node of g.net.nodes.values()) {
      if (node.segs.length < 3 || !huts.length || (placed.hut?.length ?? 0) >= 30 || near('hut', node.x, node.z, 350)) continue;
      const seg = g.net.segs.get(node.segs[0]);
      if (!seg || !LOCAL.has(seg.type)) continue;
      const p = this.at(seg, seg.a === node.id ? 16 : seg.length - 16);
      const side = hash(node.id, 9) < 0.5 ? -1 : 1, off = ROAD_TYPES[seg.type].width / 2 + 4;
      const x = p.x + p.r.x * side * off, z = p.z + p.r.z * side * off;
      if (!this.free(x, z, 3)) continue;
      add('fiber-hut', huts[Math.floor(hash(node.id, 2) * Math.min(10, huts.length))], 1, x, g.terrain.h(x, z), z, Math.atan2(-p.r.x * side, -p.r.z * side));
      mark('hut', node.x, node.z);
    }
    // a substation beside every power plant, a token kiosk beside every bus depot
    const beside = (kinds: Set<string>, family: string) => {
      const ids = vaultFamilyAssets(family);
      if (!ids.length) return;
      const bySize = ids.slice().sort((i, j) => { const A = vaultAsset(i), B = vaultAsset(j); return (A.maxX - A.minX) * (A.maxZ - A.minZ) - (B.maxX - B.minX) * (B.maxZ - B.minZ); });
      for (const b of g.buildings.list.values()) {
        if (b.zone !== 'service' || !b.kind || !kinds.has(b.kind)) continue;
        const pick = bySize[Math.floor(hash(b.id, 1) * Math.min(8, bySize.length))];
        const a = vaultAsset(pick), r = Math.max(a.maxX - a.minX, a.maxZ - a.minZ) / 2;
        const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
        for (const [lx, lz] of [[b.hw + r + 4, 0], [-b.hw - r - 4, 0], [0, -b.hd - r - 4]]) {
          const x = b.x + lx * cy + lz * sy, z = b.z - lx * sy + lz * cy;
          if (!this.free(x, z, r)) continue;
          add(family, pick, 1, x, g.terrain.h(x, z), z, b.yaw);
          break;
        }
      }
    };
    beside(POWER, 'grid-substation');
    beside(DEPOT, 'transit-token-kiosk');
    this.upload(items);
  }

  // ------------------------------------------------------------------ drawing
  /** the last placements, for tests */
  items: Item[] = [];

  private upload(items: Item[]) {
    this.items = items;
    const by = new Map<string, Item[]>();
    const counts: Record<string, number> = {};
    for (const it of items) {
      const key = `${it.index}|${it.s.toFixed(2)}`;
      let l = by.get(key);
      if (!l) by.set(key, (l = []));
      l.push(it);
      counts[it.family] = (counts[it.family] ?? 0) + 1;
    }
    this.counts = counts;
    const mat = this.g.buildings.mesh.material as THREE.Material;
    for (const [key, m] of this.meshes) if (!by.has(key)) { m.count = 0; m.visible = false; }
    for (const [key, list] of by) {
      let m = this.meshes.get(key);
      if (!m || m.instanceMatrix.count < list.length) {
        const [index, s] = key.split('|').map(Number);
        const model = generateVaultScaled(index, s);
        if (!model) continue;
        if (m) { this.group.remove(m); m.geometry.dispose(); m.dispose(); }
        m = new THREE.InstancedMesh(model.geometry, mat, Math.max(4, list.length * 2));
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.group.add(m);
        this.meshes.set(key, m);
      }
      list.forEach((it, k) => {
        this.q.setFromAxisAngle(this.up, it.yaw);
        this.m4.compose(this.v.set(it.x, it.y, it.z), this.q, this.one);
        m!.setMatrixAt(k, this.m4);
      });
      m.count = list.length;
      m.visible = true;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
