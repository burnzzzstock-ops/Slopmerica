// Civic Foundry in the game: the PBR street furniture, street trees, bus
// shelters and utility cabinets from the asset library (packed by
// scripts/civic-pack.mjs into civic/pack.json + pack.bin, or pack.b64.txt
// in the single-file build), drawn as
// instanced meshes per asset x LOD x material with distance LODs. The pack
// streams in after the town is up; if it can't load (offline file, old
// build) the game looks exactly as before.
import * as THREE from 'three';
import type { Game } from '../game';
import type { RSeg } from '../roads/network';
import { carriageHalf, ROAD_TYPES } from '../roads/roadTypes';
import { segDriveways, segLamps } from '../roads/roadMesh';
import { edgeLift, WALK_TOP } from '../roads/roadSection';
import { applyAtmosphere } from '../world/seasons';
import { litByLamps, TREE_LAMP } from '../world/nightLights';
import { fetchPack } from '../core/pack';
import { clamp, lerp, locate, norm, sub } from '../core/math';


interface PackPrim { mat: string; count: number; pos: number; nrm: number; uv: number }
interface PackAsset { label: string; category: string; bounds: { min: number[]; max: number[] }; dims: number[]; lods: { level: number; prims: PackPrim[] }[] }
interface PackMat { id: string; albedo: string; normal: string; orm: string; roughness: number; metalness: number; normalScale: number }
interface Pack {
  version: number; source: string; bytes: number; materials: PackMat[]; assets: Record<string, PackAsset>;
  /** the geometry as base64 text instead of pack.bin (the published page's host doesn't serve .bin) */
  bin64?: string;
}


/** One placed copy of an asset. */
export interface CivicItem { asset: string; x: number; y: number; z: number; yaw: number; s?: number }

/** LOD1 inside this range (m), LOD2 out to the cull range. */
const NEAR = 150, FAR = 720;
const LOW_FAR = 245;

// Mean sRGB albedo of the pack's material swatches. At phone scale the slats,
// branches and metal rails still have separate colours in one LOD2 draw.
const ALBEDO: Record<string, number> = {
  bark: 0x3d1e11, 'brick-cream': 0xb19771, 'brick-red': 0x7b3120, concrete: 0x797c76,
  foliage: 0x1a511a, 'glass-blue': 0x4a5860, limestone: 0xac9d7e, 'metal-copper': 0x78472b,
  'metal-dark': 0x42494c, 'metal-galvanized': 0x909693, 'roof-metal': 0x303d42, soil: 0x25190d,
  'wood-oak': 0x633b1a, 'wood-painted': 0x4c6d74,
};

function lowGeometry(prims: PackPrim[], bin: ArrayBuffer) {
  const size = prims.reduce((n, p) => n + p.count, 0);
  const positions = new Float32Array(size * 3), normals = new Int8Array(size * 3), colors = new Uint8Array(size * 3);
  let vertex = 0;
  for (const p of prims) {
    const packed = new Int8Array(bin, p.nrm, p.count * 4);
    const color = new THREE.Color(ALBEDO[p.mat] ?? 0x888888);
    positions.set(new Float32Array(bin, p.pos, p.count * 3), vertex * 3);
    for (let i = 0; i < p.count; i++, vertex++) {
      const j = vertex * 3;
      normals[j] = packed[i * 4]; normals[j + 1] = packed[i * 4 + 1]; normals[j + 2] = packed[i * 4 + 2];
      colors[j] = Math.round(color.r * 255); colors[j + 1] = Math.round(color.g * 255); colors[j + 2] = Math.round(color.b * 255);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  geo.computeBoundingSphere();
  return geo;
}

class AssetBatch {
  /** [lod][prim] */
  meshes: THREE.InstancedMesh[][] = [];
  items: CivicItem[] = [];
  cap = 0;
  constructor(readonly id: string, readonly geos: { geo: THREE.BufferGeometry; mat: THREE.Material }[][], readonly group: THREE.Group, readonly firstLod = 1) {}
  ensure(n: number) {
    if (n <= this.cap) return;
    const cap = Math.max(8, Math.ceil(n * 1.5));
    for (const lod of this.meshes) for (const m of lod) { m.removeFromParent(); m.dispose(); }
    this.meshes = this.geos.map((prims, li) => prims.map(({ geo, mat }) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.name = `civic-${this.id}-lod${li + this.firstLod}`;
      m.count = 0;
      m.visible = false;
      m.castShadow = li + this.firstLod === 1;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    }));
    this.cap = cap;
  }
}

export class CivicLayer {
  readonly group = new THREE.Group();
  status: 'off' | 'loading' | 'ready' | 'failed' = 'off';
  private source?: { pack: Pack; bin: ArrayBuffer; base: URL };
  private low = false;
  private qualityBatches = new Map<boolean, Map<string, AssetBatch>>();
  private batches = new Map<string, AssetBatch>();
  private dirty = true;
  private t = 0;
  private lastCam = new THREE.Vector3(Infinity, 0, 0);
  private lowFrustum = new THREE.Frustum();
  private lastRotation = new THREE.Quaternion();
  private lastFov = 0;
  private lastAspect = 0;
  private lowBounds = new THREE.Sphere();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private v = new THREE.Vector3();
  /** placements by kind, for tests and the audit */
  counts: Record<string, number> = {};

  constructor(private g: Game) {
    this.group.name = 'civic-foundry';
    g.scene.add(this.group);
    g.net.events.on('changed', () => (this.dirty = true));
  }

  /** Stream the geometry once. Low uses vertex colours and requests no material textures. */
  load(base = new URL('civic/', document.baseURI)) {
    if (this.status !== 'off') return;
    this.status = 'loading';
    (async () => {
      const { json, bin } = await fetchPack<Pack>(base);
      this.source = { pack: json, bin, base };
      this.selectQuality();
      this.status = 'ready';
      this.dirty = true;
      // the transit stops swap their box shelters for these
      const tr = (this.g as unknown as { transit?: { visualDirty: boolean } }).transit;
      if (tr) tr.visualDirty = true;
    })().catch((e) => {
      this.status = 'failed';
      console.info('[civic] asset pack not available:', e?.message ?? e);
    });
  }

  private selectQuality() {
    if (!this.source) return;
    for (const b of this.batches.values()) for (const lod of b.meshes) for (const mesh of lod) mesh.visible = false;
    this.low = (this.g.pendingQuality ?? this.g.q.name) === 'low';
    const cached = this.qualityBatches.get(this.low);
    if (cached) this.batches = cached;
    else {
      this.batches = new Map();
      const { pack, bin, base } = this.source;
      if (this.low) {
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
        applyAtmosphere(mat);
        litByLamps(mat, { name: 'uTreeLamp', u: TREE_LAMP });
        for (const [id, a] of Object.entries(pack.assets)) {
          const lod = a.lods.find(l => l.level === 2);
          if (lod) this.batches.set(id, new AssetBatch(id, [[{ geo: lowGeometry(lod.prims, bin), mat }]], this.group, 2));
        }
      } else this.build(pack, bin, base);
      this.qualityBatches.set(this.low, this.batches);
    }
    this.dirty = true;
    this.t = 0;
  }

  private build(pack: Pack, bin: ArrayBuffer, base: URL) {
    const loader = new THREE.TextureLoader();
    const tex = (path: string, srgb: boolean) => {
      const t = loader.load(new URL(path, base).href);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const mats = new Map<string, THREE.Material>();
    for (const m of pack.materials) {
      const orm = tex(m.orm, false);
      const mat = new THREE.MeshStandardMaterial({
        map: tex(m.albedo, true), normalMap: tex(m.normal, false), normalScale: new THREE.Vector2(m.normalScale, m.normalScale),
        roughnessMap: orm, metalnessMap: orm, aoMap: orm, aoMapIntensity: 0.5, roughness: 1, metalness: 1,
      });
      mat.name = `civic-${m.id}`;
      applyAtmosphere(mat);
      // the street trees take the street lamps' pools of light like the roads and facades do (a crown and trunk under a lamp read at
      // night instead of black); furniture is left as it was
      if (m.id === 'foliage' || m.id === 'bark') litByLamps(mat, { name: 'uTreeLamp', u: TREE_LAMP });
      mats.set(m.id, mat);
    }
    for (const [id, a] of Object.entries(pack.assets)) {
      const geos = a.lods.map((lod) => lod.prims.map((p) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, p.pos, p.count * 3), 3));
        geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Int8Array(bin, p.nrm, p.count * 4), 4), 3, 0, true));
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, p.uv, p.count * 2), 2));
        geo.computeBoundingSphere();
        return { geo, mat: mats.get(p.mat) ?? new THREE.MeshStandardMaterial({ color: 0x888888 }) };
      }));
      this.batches.set(id, new AssetBatch(id, geos, this.group));
    }
  }

  private lastBlds = -1;
  private refreshT = 0;

  update(dt: number) {
    if (this.status !== 'ready') return;
    if (this.low !== ((this.g.pendingQuality ?? this.g.q.name) === 'low')) this.selectQuality();
    this.t -= dt;
    // the town changes under the furniture: re-place when buildings come and go (and now and then)
    this.refreshT -= dt;
    const nb = this.g.buildings.list.size;
    if (nb !== this.lastBlds || this.refreshT <= 0) { this.lastBlds = nb; this.refreshT = 12; this.dirty = true; }
    if (this.dirty && this.t <= 0) {
      this.dirty = false;
      this.t = 1.5; // debounce: roads being drawn change every frame
      this.place();
      this.lastCam.set(Infinity, 0, 0);
    }
    const cam = this.g.camera.position;
    const camera = this.g.camera;
    const rotated = this.low && (1 - Math.abs(this.lastRotation.dot(camera.quaternion)) > 0.00004 ||
      this.lastFov !== camera.fov || this.lastAspect !== camera.aspect);
    if (rotated || cam.distanceToSquared(this.lastCam) > 16) {
      this.lastCam.copy(cam);
      if (this.low) {
        this.lastRotation.copy(camera.quaternion);
        this.lastFov = camera.fov;
        this.lastAspect = camera.aspect;
        this.lowFrustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      }
      this.relod(cam);
    }
  }

  /** Buildings changed (grew, levelled, demolished): refresh the placements soon. */
  touch() { this.dirty = true; }

  // ------------------------------------------------------------------ placement
  private place() {
    const items: CivicItem[] = [];
    const counts: Record<string, number> = {};
    const add = (it: CivicItem) => { items.push(it); counts[it.asset] = (counts[it.asset] ?? 0) + 1; };
    const g = this.g;
    for (const seg of g.net.segs.values()) this.street(seg, add);
    // bus shelters at every stop, set back from the curb, facing the road
    const stops = (g as unknown as { transit?: { stops: Map<number, { x: number; y: number; z: number; yaw: number; side: 1 | -1; seg: number }> } }).transit?.stops;
    if (stops) for (const st of stops.values()) {
      const rx = -Math.cos(st.yaw) * st.side, rz = Math.sin(st.yaw) * st.side; // away from the road
      const sg = g.net.segs.get(st.seg);
      // (the stop stands 1.2 m past the road's edge, the shelter 0.7 m further: on the graded ground, not floating over it)
      const lift = sg ? edgeLift(ROAD_TYPES[sg.type], ROAD_TYPES[sg.type].width / 2 + 1.9) : 0.12;
      add({ asset: 'street-bus-shelter', x: st.x + rx * 0.7, y: st.y + lift, z: st.z + rz * 0.7, yaw: Math.atan2(-rx, -rz) });
    }
    this.counts = counts;
    const by = new Map<string, CivicItem[]>();
    for (const it of items) { let a = by.get(it.asset); if (!a) by.set(it.asset, (a = [])); a.push(it); }
    for (const [id, b] of this.batches) {
      b.items = by.get(id) ?? [];
      b.ensure(b.items.length);
    }
  }

  /** Sidewalk furniture and street trees along one block, by what fronts it. */
  private street(seg: RSeg, add: (it: CivicItem) => void) {
    const t = ROAD_TYPES[seg.type];
    if (t.sidewalk < 1.1 || seg.over) return;
    const g = this.g;
    const ch = carriageHalf(t);
    const hw = t.width / 2;
    const drives = segDriveways(g.net, seg);
    const lamps = segLamps(g.net, seg);
    const s0 = Math.max(seg.trimA, 6) + 4, s1 = seg.length - Math.max(seg.trimB, 6) - 4;
    if (s1 - s0 < 8) return;
    const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
    for (const side of [-1, 1] as const) {
      let k = 0;
      for (let d = s0 + 5 + hash(seg.id, side) * 6; d < s1; d += 12, k++) {
        // Thin sites before querying nearby buildings. A tree and its grate
        // share the same site, and transit shelters are placed separately.
        if (this.low && hash(seg.id * 31 + k, side * 17) < 0.5) continue;
        if (drives.some((dr) => dr.side === side && Math.abs(dr.d - d) < 3.4)) continue;
        if (lamps.some((l) => l.side === side && Math.abs(l.d - d) < 2.6)) continue;
        const { i, f } = locate(seg.samp, clamp(d, 0, seg.length));
        const a = seg.samp.pts[i], b = seg.samp.pts[i + 1];
        const tan = norm(sub(b, a));
        const r = { x: -tan.z, z: tan.x };
        const cx = lerp(a.x, b.x, f), cz = lerp(a.z, b.z, f);
        const y = lerp(seg.hs[i], seg.hs[i + 1], f) + WALK_TOP + 0.01; // on the raised walk
        // what's across the sidewalk?
        const probe = { x: cx + r.x * side * (hw + 6), z: cz + r.z * side * (hw + 6) };
        const bl = g.buildings.near(probe.x, probe.z, 10)[0];
        const zone = bl?.zone;
        const faceRoad = Math.atan2(-r.x * side, -r.z * side);
        const at = (off: number) => ({ x: cx + r.x * side * off, z: cz + r.z * side * off });
        const h = hash(seg.id * 13 + k, side);
        const outer = hw - 0.55, mid = ch + (hw - ch) * 0.55;
        if (zone === 'comLow' || zone === 'comHigh' || zone === 'office' || zone === 'resHigh' || zone === 'landmark') {
          // downtown: a street tree in a grate every other stop, benches, bikes, papers, planters between
          const kind = k % 2 === 0 ? 'tree' : h < 0.3 ? 'street-bench-slat' : h < 0.5 ? 'street-bike-rack' : h < 0.65 ? 'street-newspaper-boxes' : h < 0.8 ? 'planter-raised-urban' : h < 0.9 ? 'street-bollard-row' : 'street-utility-cabinet';
          if (kind === 'tree') {
            const p = at(mid);
            add({ asset: 'street-tree-grate', x: p.x, y, z: p.z, yaw: faceRoad, s: d });
            add({ asset: h < 0.5 ? 'tree-maple-street' : h < 0.8 ? 'tree-flowering-ornamental' : 'tree-american-elm', x: p.x, y, z: p.z, yaw: h * 6.28, s: d });
          } else {
            const p = at(kind === 'street-bench-slat' || kind === 'street-bollard-row' ? mid : outer - 0.3);
            add({ asset: kind, x: p.x, y, z: p.z, yaw: kind === 'street-bench-slat' ? faceRoad + Math.PI : faceRoad, s: d });
          }
        } else if (zone === 'resLow') {
          // homes: a street tree every third stop on the verge
          if (k % 3 === 1) { const p = at(mid); add({ asset: h < 0.4 ? 'tree-maple-street' : h < 0.7 ? 'tree-american-elm' : 'tree-live-oak', x: p.x, y, z: p.z, yaw: h * 6.28, s: d }); }
          else if (k % 9 === 5) { const p = at(outer); add({ asset: 'street-utility-cabinet', x: p.x, y, z: p.z, yaw: faceRoad }); }
        } else if (zone === 'industry') {
          if (k % 4 === 2) { const p = at(outer); add({ asset: h < 0.5 ? 'service-pad-transformer' : 'service-telecom-cabinet', x: p.x, y, z: p.z, yaw: faceRoad }); }
        }
      }
    }
  }

  // ------------------------------------------------------------------ LOD + instance upload
  private relod(cam: THREE.Vector3) {
    for (const b of this.batches.values()) {
      if (!b.meshes.length) continue;
      const n = [0, 0];
      for (const it of b.items) {
        const d = this.low ? Math.hypot(it.x - cam.x, it.y - cam.y, it.z - cam.z) : Math.hypot(it.x - cam.x, it.z - cam.z);
        if (d > (this.low ? LOW_FAR : FAR)) continue;
        if (this.low) {
          const sphere = b.geos[0][0].geo.boundingSphere!;
          // Enclose the yaw-rotated asset about its placement, including its crown.
          this.lowBounds.center.set(it.x, it.y + sphere.center.y, it.z);
          this.lowBounds.radius = sphere.radius + Math.hypot(sphere.center.x, sphere.center.z) + 6;
          if (!this.lowFrustum.intersectsSphere(this.lowBounds)) continue;
        }
        const li = d < NEAR || b.meshes.length < 2 ? 0 : 1;
        this.q.setFromAxisAngle(this.up, it.yaw);
        this.m4.compose(this.v.set(it.x, it.y, it.z), this.q, this.one);
        for (const m of b.meshes[li]) m.setMatrixAt(n[li], this.m4);
        n[li]++;
      }
      b.meshes.forEach((lod, li) => lod.forEach((m) => {
        m.count = n[li];
        m.visible = n[li] > 0;
        if (n[li]) m.instanceMatrix.needsUpdate = true;
      }));
    }
  }
}
