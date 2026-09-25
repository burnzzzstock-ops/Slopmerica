// Camera-local ground cover rendered with three procedural instanced meshes.
// Each map uses an alpha-card plant layer and two solid detail families.
// Placement is deterministic, but only the patch around the camera target is
// kept on the GPU.
import * as THREE from 'three';
import { WATER, type Quality } from '../config';
import type { Season } from '../contracts';
import { hash2 } from '../core/rng';
import type { Commune, Communes } from '../agents/communes';
import type { Bld, Buildings } from '../sim/buildings';
import { ROAD_TYPES } from '../roads/roadTypes';
import type { RoadNetwork, RSeg } from '../roads/network';
import type { ZCell, Zoning } from '../zones/zoning';
import type { MapData, MapId } from './maps';
import { Paint, type Terrain } from './terrain';

export interface GroundDetailSources {
  roads: RoadNetwork;
  zones: Zoning;
  buildings: Buildings;
  communes: Communes;
}

export interface GroundDetailWeather {
  season: Season;
  snowCover: number;
  wind: THREE.Vector2;
}

interface DetailProfile {
  names: readonly [string, string, string];
  colors: Record<Season, readonly [number, number, number]>;
  snowLine: number;
}

const PROFILES: Record<MapId, DetailProfile> = {
  appalachia: {
    names: ['meadow grass and wildflowers', 'ridge boulder', 'fallen log and stump'],
    colors: {
      spring: [0x80a74b, 0x77736b, 0x765235], summer: [0x718d3e, 0x746f67, 0x6b492f],
      fall: [0xa27d35, 0x81786c, 0x65452f], winter: [0x7b704d, 0x898681, 0x594431],
    },
    snowLine: -100,
  },
  norcal: {
    names: ['golden oat grass and poppies', 'coastal boulder', 'beach shells and sand ripples'],
    colors: {
      spring: [0x76954b, 0x8c8174, 0xe4d5b4], summer: [0xc09a4f, 0x887a6d, 0xd9c69e],
      fall: [0xb58a42, 0x83766b, 0xd1bc94], winter: [0x8ca05a, 0x8d8479, 0xdacbaa],
    },
    snowLine: 380,
  },
  florida: {
    names: ['sawgrass and marsh bloom', 'cattail and palmetto', 'beach shells and sand ripples'],
    colors: {
      spring: [0x8fa34e, 0x69894b, 0xeadfc9], summer: [0x879746, 0x617f43, 0xe2d5bc],
      fall: [0x9b8e43, 0x758044, 0xdacbaa], winter: [0x899052, 0x6f7d49, 0xdfd3bb],
    },
    snowLine: 100_000,
  },
};

const tmpColor = new THREE.Color();

interface GeoData { pos: number[]; colors: number[]; uv: number[] }
type P3 = readonly [number, number, number];

interface MaskCache {
  roads: Map<number, RSeg[]>;
  zones: Map<number, ZCell[]>;
  buildings: Map<number, Bld[]>;
  communes: Map<number, Commune[]>;
}

const MASK_CELL = 48;
const maskKey = (x: number, z: number) => x * 16384 + z;

function bucket<T>(map: Map<number, T[]>, item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
  const x0 = Math.floor(minX / MASK_CELL), x1 = Math.floor(maxX / MASK_CELL);
  const z0 = Math.floor(minZ / MASK_CELL), z1 = Math.floor(maxZ / MASK_CELL);
  for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
    const key = maskKey(gx, gz);
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(item);
  }
}

function roadDistanceSq(x: number, z: number, seg: RSeg): number {
  let best = Infinity;
  const pts = seg.samp.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const ox = a.x + dx * t - x, oz = a.z + dz * t - z;
    const d2 = ox * ox + oz * oz;
    if (d2 < best) best = d2;
  }
  return best;
}

function tri(d: GeoData, a: P3, b: P3, c: P3, color: readonly [number, number, number] = [1, 1, 1], uv: readonly number[] = [0, 0, 1, 0, 0.5, 1]) {
  d.pos.push(...a, ...b, ...c);
  for (let i = 0; i < 3; i++) d.colors.push(...color);
  d.uv.push(...uv);
}

function quad(d: GeoData, a: P3, b: P3, c: P3, e: P3, color: readonly [number, number, number] = [1, 1, 1]) {
  tri(d, a, b, c, color, [0, 0, 1, 0, 1, 1]);
  tri(d, a, c, e, color, [0, 0, 1, 1, 0, 1]);
}

function addCards(d: GeoData, florida: boolean) {
  const h = florida ? 1.45 : 1.05, w = florida ? 0.72 : 0.82;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI, c = Math.cos(a), s = Math.sin(a);
    quad(d, [-c * w / 2, 0, -s * w / 2], [c * w / 2, 0, s * w / 2], [c * w / 2, h, s * w / 2], [-c * w / 2, h, -s * w / 2], [0.86, 0.94, 0.82]);
  }
}

function addBoulder(d: GeoData, ox: number, oz: number, r: number) {
  const n = 7, top: P3 = [ox - r * 0.1, r * 1.05, oz + r * 0.08], bottom: P3 = [ox, 0, oz];
  const ring: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([ox + Math.cos(a) * r * (0.82 + (i % 3) * 0.09), r * (0.22 + (i % 2) * 0.12), oz + Math.sin(a) * r * (0.75 + (i % 2) * 0.13)]);
  }
  for (let i = 0; i < n; i++) {
    const k = 0.76 + (i % 3) * 0.09;
    tri(d, top, ring[i], ring[(i + 1) % n], [k, k * 0.98, k * 0.94]);
    tri(d, bottom, ring[(i + 1) % n], ring[i], [k * 0.68, k * 0.68, k * 0.66]);
  }
}

function addCylinder(d: GeoData, a: P3, b: P3, r: number, color: readonly [number, number, number]) {
  const n = 7, dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz) || 1;
  const px = -dz / len, pz = dx / len;
  const ar: P3[] = [], br: P3[] = [];
  for (let i = 0; i < n; i++) {
    const q = (i / n) * Math.PI * 2, side = Math.cos(q) * r, y = Math.sin(q) * r;
    ar.push([a[0] + px * side, a[1] + y, a[2] + pz * side]);
    br.push([b[0] + px * side, b[1] + y, b[2] + pz * side]);
  }
  for (let i = 0; i < n; i++) quad(d, ar[i], ar[(i + 1) % n], br[(i + 1) % n], br[i], color);
  for (let i = 1; i < n - 1; i++) { tri(d, ar[0], ar[i + 1], ar[i], [0.68, 0.5, 0.34]); tri(d, br[0], br[i], br[i + 1], [0.68, 0.5, 0.34]); }
}

function addWood(d: GeoData) {
  addCylinder(d, [-1.1, 0.25, 0], [1.05, 0.31, 0.08], 0.24, [0.92, 0.78, 0.6]);
  // A short upright stump beside the log.
  const n = 7, lo: P3[] = [], hi: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    lo.push([0.55 + Math.cos(a) * 0.31, 0, -0.5 + Math.sin(a) * 0.31]);
    hi.push([0.55 + Math.cos(a) * 0.25, 0.58 + (i % 2) * 0.05, -0.5 + Math.sin(a) * 0.25]);
  }
  for (let i = 0; i < n; i++) quad(d, lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i], [0.82, 0.68, 0.5]);
  for (let i = 1; i < n - 1; i++) tri(d, hi[0], hi[i], hi[i + 1], [0.72, 0.52, 0.31]);
}

function addMarshPlant(d: GeoData) {
  // Cattail stems and dark seed heads.
  for (let i = 0; i < 4; i++) {
    const x = -0.28 + i * 0.18, z = (i % 2) * 0.18 - 0.09, h = 0.95 + i * 0.11;
    quad(d, [x - 0.025, 0, z], [x + 0.025, 0, z], [x + 0.025, h, z], [x - 0.025, h, z], [0.72, 0.9, 0.55]);
    quad(d, [x, 0, z - 0.025], [x, 0, z + 0.025], [x, h, z + 0.025], [x, h, z - 0.025], [0.72, 0.9, 0.55]);
    quad(d, [x - 0.065, h - 0.02, z], [x + 0.065, h - 0.02, z], [x + 0.065, h + 0.27, z], [x - 0.065, h + 0.27, z], [0.48, 0.25, 0.11]);
    quad(d, [x, h - 0.02, z - 0.065], [x, h - 0.02, z + 0.065], [x, h + 0.27, z + 0.065], [x, h + 0.27, z - 0.065], [0.48, 0.25, 0.11]);
  }
  // A low fan of palmetto leaves shares the instance and draw call.
  for (let i = 0; i < 7; i++) {
    const a = -1.15 + i * 0.38, x = 0.38 + Math.cos(a) * 0.7, z = 0.22 + Math.sin(a) * 0.7;
    tri(d, [0.38, 0.12, 0.22], [x - 0.12, 0.38, z], [x, 0.62 + (i % 2) * 0.12, z + 0.05], [0.72, 1, 0.62]);
  }
}

function addShellRipples(d: GeoData) {
  // A faceted shell with radial ribs.
  const n = 8, top: P3 = [-0.35, 0.25, 0], ring: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([-0.35 + Math.cos(a) * 0.38, 0.035, Math.sin(a) * 0.28]);
  }
  for (let i = 0; i < n; i++) tri(d, top, ring[i], ring[(i + 1) % n], i % 2 ? [1.08, 0.91, 0.78] : [0.9, 0.75, 0.65]);
  // Three shallow sand-ripple arcs.
  for (let band = 0; band < 3; band++) {
    const rad = 0.48 + band * 0.22, width = 0.035;
    for (let i = 0; i < 5; i++) {
      const a0 = -1.05 + i * 0.42, a1 = a0 + 0.32;
      quad(d, [0.28 + Math.cos(a0) * rad, 0.025, Math.sin(a0) * rad], [0.28 + Math.cos(a0) * (rad + width), 0.027, Math.sin(a0) * (rad + width)], [0.28 + Math.cos(a1) * (rad + width), 0.027, Math.sin(a1) * (rad + width)], [0.28 + Math.cos(a1) * rad, 0.025, Math.sin(a1) * rad], [0.72, 0.66, 0.56]);
    }
  }
}

function makeGroundGeometry(map: MapId, kind: number): THREE.BufferGeometry {
  const d: GeoData = { pos: [], colors: [], uv: [] };
  if (kind === 0) addCards(d, map === 'florida');
  else if (kind === 1) {
    if (map === 'florida') addMarshPlant(d);
    else { addBoulder(d, -0.24, 0, 0.72); addBoulder(d, 0.65, 0.22, 0.38); }
  } else if (map === 'appalachia') addWood(d);
  else addShellRipples(d);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(d.colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function makeBladeTexture(map: MapId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#fff';
  for (let i = 0; i < 11; i++) {
    const x = 5 + i * 5.3, lean = ((i * 17) % 9) - 4;
    ctx.globalAlpha = 0.66 + (i % 3) * 0.15;
    ctx.lineWidth = map === 'florida' ? 3.1 : 2.2 + (i % 2) * 0.7;
    ctx.beginPath();
    ctx.moveTo(32, 64);
    ctx.quadraticCurveTo(x - lean * 0.5, 39 + (i % 4) * 3, x + lean, 7 + (i % 5) * 4);
    ctx.stroke();
  }
  // Seed heads / tiny blooms keep the card from reading as a flat green fence.
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 7; i++) {
    const x = 8 + i * 8, y = 12 + (i % 3) * 7;
    ctx.beginPath(); ctx.arc(x, y, map === 'norcal' ? 2.3 : 1.4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/** Three draw calls and a fixed instance budget, independent of county size. */
export class GroundDetail {
  readonly group = new THREE.Group();
  readonly speciesNames: readonly [string, string, string];
  readonly maxInstances: number;
  visibleInstances = 0;
  /** CPU time spent on the latest placement refill, for the debug cast. */
  lastRefillMs = 0;

  private meshes: THREE.InstancedMesh[] = [];
  private materials: THREE.MeshStandardMaterial[] = [];
  private uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uFocus: { value: new THREE.Vector2() },
    uFadeNear: { value: 250 },
    uFadeFar: { value: 350 },
    uSnow: { value: 0 },
    uSnowLine: { value: 0 },
  };
  private radius: number;
  private spacing: number;
  private hideDistance: number;
  private profile: DetailProfile;
  private bladeTexture: THREE.CanvasTexture;
  private lastPatchX = Number.NaN;
  private lastPatchZ = Number.NaN;
  private lastSeason: Season | null = null;
  private lastStamp = -1;
  private roadRevision = 0;
  private dirty = true;
  private nextRebuild = 0;
  private unsub: (() => void)[] = [];

  constructor(private terrain: Terrain, map: MapData, q: Quality, private sources: GroundDetailSources) {
    this.profile = PROFILES[map.def.id];
    this.speciesNames = this.profile.names;
    this.maxInstances = q.name === 'ultra' ? 3600 : q.name === 'high' ? 2600 : q.name === 'medium' ? 1600 : 900;
    this.radius = q.groundRadius;
    this.spacing = q.name === 'ultra' ? 8 : q.name === 'high' ? 8.5 : q.name === 'medium' ? 9.5 : 10.5;
    this.hideDistance = q.name === 'ultra' ? 1450 : q.name === 'high' ? 1150 : q.name === 'medium' ? 920 : 760;
    this.bladeTexture = makeBladeTexture(map.def.id);
    this.uniforms.uFadeNear.value = this.radius * 0.7;
    this.uniforms.uFadeFar.value = this.radius;
    this.uniforms.uSnowLine.value = this.profile.snowLine;

    for (let kind = 0; kind < 3; kind++) {
      const flex = kind === 0 || (map.def.id === 'florida' && kind === 1);
      const mat = this.makeMaterial(kind, flex);
      const mesh = new THREE.InstancedMesh(makeGroundGeometry(map.def.id, kind), mat, this.maxInstances);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      this.materials.push(mat);
      this.group.add(mesh);
    }
    this.unsub.push(sources.roads.events.on('changed', () => { this.roadRevision++; this.dirty = true; }));
  }

  private makeMaterial(kind: number, flex: boolean): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, roughness: 0.96, metalness: 0,
      map: kind === 0 ? this.bladeTexture : null,
      transparent: false, opacity: 1, depthWrite: true, alphaTest: kind === 0 ? 0.34 : 0.025,
      alphaToCoverage: true,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.uniforms.uGDFlex = { value: flex ? 1 : 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime, uGDFlex;\nuniform vec2 uWind;\nvarying float vGDTip;\nvarying vec3 vGDWorld;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vGDTip = smoothstep(0.08, 1.05, position.y);
#ifdef USE_INSTANCING
  vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float mag = length(uWind);
  vec2 dir = mag > 0.001 ? uWind / mag : vec2(0.8, 0.3);
  float sway = sin(uTime * (1.4 + mag * 0.35) + dot(ip, vec2(0.047, 0.063)) + position.y * 1.7);
  transformed.xz += dir * uGDFlex * vGDTip * (0.025 + mag * 0.055) * (0.55 + sway * 0.45);
#endif`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 gdWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  gdWorld = instanceMatrix * gdWorld;
#endif
vGDWorld = (modelMatrix * gdWorld).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uFocus;\nuniform float uFadeNear, uFadeFar, uSnow, uSnowLine;\nvarying float vGDTip;\nvarying vec3 vGDWorld;')
        .replace('#include <color_fragment>', `#include <color_fragment>
float gdFade = 1.0 - smoothstep(uFadeNear, uFadeFar, distance(vGDWorld.xz, uFocus));
diffuseColor.a *= gdFade;
if (diffuseColor.a < 0.025) discard;
float gdSnow = uSnow * smoothstep(0.35, 0.95, vGDTip) * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vGDWorld.y);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), gdSnow * 0.88);`);
    };
    mat.customProgramCacheKey = () => `ground-detail-v2-${kind}`;
    return mat;
  }

  /** Force the placement patch to be re-evaluated on the next update. */
  markDirty() {
    this.dirty = true;
  }

  update(time: number, focus: THREE.Vector3, cameraDistance: number, weather: GroundDetailWeather) {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value.copy(weather.wind);
    this.uniforms.uFocus.value.set(focus.x, focus.z);
    this.uniforms.uSnow.value = weather.snowCover;
    this.group.visible = cameraDistance < this.hideDistance;
    if (!this.group.visible) return;

    const patchX = Math.floor(focus.x / (this.spacing * 2));
    const patchZ = Math.floor(focus.z / (this.spacing * 2));
    const communeStamp = this.sources.communes.list.reduce((n, c) => n + (c.state === 'gone' ? 0 : c.id * 17), 0);
    const stamp = this.terrain.surfaceVersion * 31 + this.sources.zones.version * 17 + this.sources.buildings.list.size * 7 + communeStamp + this.roadRevision;
    if (patchX !== this.lastPatchX || patchZ !== this.lastPatchZ || weather.season !== this.lastSeason || stamp !== this.lastStamp) this.dirty = true;
    if (!this.dirty || time < this.nextRebuild) return;
    this.lastPatchX = patchX;
    this.lastPatchZ = patchZ;
    this.lastSeason = weather.season;
    this.lastStamp = stamp;
    this.nextRebuild = time + 0.18;
    this.dirty = false;
    const refillStart = performance.now();
    this.rebuild(focus.x, focus.z, weather.season);
    this.lastRefillMs = performance.now() - refillStart;
  }

  private rebuild(cx: number, cz: number, season: Season) {
    const counts = [0, 0, 0];
    const r2 = this.radius * this.radius;
    const masks = this.buildMaskCache(cx, cz);
    const gx0 = Math.floor((cx - this.radius) / this.spacing);
    const gx1 = Math.ceil((cx + this.radius) / this.spacing);
    const gz0 = Math.floor((cz - this.radius) / this.spacing);
    const gz1 = Math.ceil((cz + this.radius) / this.spacing);
    let total = 0;

    outer: for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const x = (gx + 0.12 + hash2(gx, gz, 31) * 0.76) * this.spacing;
      const z = (gz + 0.12 + hash2(gx, gz, 47) * 0.76) * this.spacing;
      if ((x - cx) ** 2 + (z - cz) ** 2 > r2 || !this.terrain.inBounds(x, z, 3)) continue;
      const y = this.terrain.h(x, z);
      if (y < WATER + 0.12 || this.terrain.slope(x, z) > 0.62 || this.terrain.paintAt(x, z) !== Paint.None) continue;
      const cover = this.terrain.coverAt(x, z);
      const density = this.densityAt(this.terrain.map.def.id, season, y, cover);
      if (hash2(gx, gz, 71) > density || this.masked(x, z, masks)) continue;
      const kind = this.kindAt(this.terrain.map.def.id, season, x, z, y, cover, hash2(gx, gz, 89));
      const slot = counts[kind]++;
      if (slot >= this.maxInstances) { counts[kind]--; continue; }

      const mesh = this.meshes[kind];
      const e = mesh.instanceMatrix.array as Float32Array;
      const o = slot * 16;
      const rnd = hash2(gx, gz, 103);
      const yaw = hash2(gx, gz, 107) * Math.PI * 2;
      const base = 0.72 + rnd * 0.62;
      const solid = kind > 0;
      const sx = base * (solid ? 0.82 : 1);
      const sy = base * (solid ? 0.82 : 1);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      e[o] = c * sx; e[o + 1] = 0; e[o + 2] = -s * sx; e[o + 3] = 0;
      e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = s * sx; e[o + 9] = 0; e[o + 10] = c * sx; e[o + 11] = 0;
      e[o + 12] = x; e[o + 13] = y - 0.04; e[o + 14] = z; e[o + 15] = 1;

      tmpColor.setHex(this.profile.colors[season][kind]);
      tmpColor.offsetHSL((hash2(gx, gz, 113) - 0.5) * 0.035, (rnd - 0.5) * 0.08, (rnd - 0.5) * 0.14);
      const ca = mesh.instanceColor!.array as Float32Array;
      ca[slot * 3] = tmpColor.r; ca[slot * 3 + 1] = tmpColor.g; ca[slot * 3 + 2] = tmpColor.b;
      total++;
      if (total >= this.maxInstances) break outer;
    }
    this.visibleInstances = total;
    for (let i = 0; i < this.meshes.length; i++) this.commit(this.meshes[i], counts[i]);
  }

  private densityAt(map: MapId, season: Season, h: number, cover: number): number {
    if (map === 'appalachia') {
      const seasonal = season === 'winter' ? 0.48 : season === 'fall' ? 0.68 : 0.82;
      return seasonal * (0.48 + cover * 0.42) * (h > 170 ? 0.65 : 1);
    }
    if (map === 'norcal') {
      const green = season === 'spring' || season === 'winter';
      return (green ? 0.82 : 0.64) * (0.55 + (1 - cover) * 0.25) * (h > 520 ? 0.72 : 1);
    }
    const marsh = h < 3.2 ? 1 : 0.68;
    return marsh * (season === 'winter' ? 0.64 : 0.82) * (0.6 + cover * 0.28);
  }

  private kindAt(map: MapId, _season: Season, x: number, z: number, h: number, cover: number, r: number): number {
    if (map === 'appalachia') {
      if (r > 0.955 && (h > 55 || cover < 0.45)) return 1;
      return cover > 0.58 && r > 0.905 ? 2 : 0;
    }
    if (map === 'norcal') {
      const beach = this.terrain.map.sand?.(x, z) ?? 0;
      if (beach > 0.2 && h < 8 && r > 0.6) return 2;
      return r > 0.95 && (h > 30 || cover < 0.35) ? 1 : 0;
    }
    const beach = this.terrain.map.sand?.(x, z) ?? 0;
    if (beach > 0.2 && h < 2.5 && r > 0.62) return 2;
    return h < 4.5 && cover > 0.52 && r > 0.76 ? 1 : 0;
  }

  /** Gather dynamic blockers once per patch; the candidate loop does no queries or allocations. */
  private buildMaskCache(cx: number, cz: number): MaskCache {
    const masks: MaskCache = { roads: new Map(), zones: new Map(), buildings: new Map(), communes: new Map() };
    const pad = this.radius + 170;
    for (const seg of this.sources.roads.segsNear(cx - pad, cz - pad, cx + pad, cz + pad)) {
      const r = ROAD_TYPES[seg.type].width / 2 + 4.5;
      bucket(masks.roads, seg, seg.minX - r, seg.minZ - r, seg.maxX + r, seg.maxZ + r);
    }
    for (const c of this.sources.zones.cellsNear(cx, cz, this.radius + 14)) {
      if (c.valid && (c.zone !== null || c.bld !== 0)) bucket(masks.zones, c, c.x - 7, c.z - 7, c.x + 7, c.z + 7);
    }
    for (const b of this.sources.buildings.near(cx, cz, pad)) {
      const r = Math.hypot(b.hw, b.hd) + 3;
      bucket(masks.buildings, b, b.x - r, b.z - r, b.x + r, b.z + r);
    }
    for (const c of this.sources.communes.list) {
      if (c.state === 'gone' || Math.abs(c.x - cx) > pad + c.r || Math.abs(c.z - cz) > pad + c.r) continue;
      const r = c.r + 5;
      bucket(masks.communes, c, c.x - r, c.z - r, c.x + r, c.z + r);
    }
    return masks;
  }

  private masked(x: number, z: number, masks: MaskCache): boolean {
    const key = maskKey(Math.floor(x / MASK_CELL), Math.floor(z / MASK_CELL));
    // Road shoulders remain clear even before terrain paint reaches the edge.
    const roads = masks.roads.get(key);
    if (roads) for (const seg of roads) {
      const r = ROAD_TYPES[seg.type].width / 2 + 4.5;
      if (roadDistanceSq(x, z, seg) < r * r) return true;
    }
    // Painted zoning is reserved for construction; occupied cells are covered too.
    const zones = masks.zones.get(key);
    if (zones) for (const c of zones) if ((x - c.x) ** 2 + (z - c.z) ** 2 < 49) return true;
    const buildings = masks.buildings.get(key);
    if (buildings) for (const b of buildings) if (this.sources.buildings.contains(b, x, z, 3)) return true;
    const communes = masks.communes.get(key);
    if (communes) for (const c of communes) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 5) ** 2) return true;
    }
    return false;
  }

  private commit(mesh: THREE.InstancedMesh, count: number) {
    mesh.count = count;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, Math.max(1, count) * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, Math.max(1, count) * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const off of this.unsub) off();
    for (const mesh of this.meshes) mesh.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
    this.bladeTexture.dispose();
    this.group.remove(...this.meshes);
  }
}
