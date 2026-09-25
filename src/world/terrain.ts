// Heightmap terrain: sampling, chunked meshes with vertex colors, grading for
// roads, ground paint (dirt/lawn/asphalt) and a height texture for the water shader.
import * as THREE from 'three';
import { HALF, HM_N, HM_STEP, WATER, WORLD } from '../config';
import { clamp, lerp, smoothstep, V2 } from '../core/math';
import { hash2 } from '../core/rng';
import type { MapData } from './maps';

export const enum Paint {
  None = 0,
  Dirt = 1,
  Lawn = 2,
  Paved = 3,
  Scorched = 4,
}

const CHUNKS = 4;
const CQ = (HM_N - 1) / CHUNKS; // quads per chunk side (128)

const col = new THREE.Color();
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export class Terrain {
  readonly heights: Float32Array;
  readonly original: Float32Array;
  readonly cover: Float32Array;
  readonly paint: Uint8Array;
  readonly group = new THREE.Group();
  readonly heightTex: THREE.DataTexture;
  private chunks: THREE.Mesh[] = [];
  private dirty = new Set<number>();
  private texDirty = false;
  private pal: Record<string, THREE.Color> = {};
  readonly material: THREE.MeshStandardMaterial;

  constructor(public map: MapData) {
    this.heights = map.heights;
    this.original = map.heights.slice();
    this.cover = map.cover;
    this.paint = new Uint8Array(HM_N * HM_N);
    for (const [k, v] of Object.entries(map.def.palette)) this.pal[k] = new THREE.Color(v);

    const half = new Uint16Array(HM_N * HM_N);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(this.heights[i]);
    this.heightTex = new THREE.DataTexture(half, HM_N, HM_N, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
    // ---- material.onBeforeCompile block (owned by the Atmosphere workstream) ----
    // Seasons, wildflowers, slope-aware snow, wet ground + puddles and cloud
    // shadows. WeatherSystem swaps the shared atmosphere uniforms into
    // userData.atmo; the paint/cover textures keep seasonal tints off roads/lots.
    const atmoU: Record<string, THREE.IUniform> = {
      uTime: { value: 0 }, uSnow: { value: 0 }, uSnowLine: { value: 1e4 }, uWet: { value: 0 }, uPuddle: { value: 0 }, uRain: { value: 0 },
      uCloudCover: { value: 0 }, uCloudShadow: { value: 0 }, uCloudOffset: { value: new THREE.Vector2() }, uSkyRefl: { value: new THREE.Color(0.6, 0.7, 0.8) },
      uDormant: { value: 0 }, uFresh: { value: 0 }, uFall: { value: 0 }, uLitter: { value: 0 }, uGolden: { value: 1 }, uMarsh: { value: 0 }, uFlowers: { value: 0 },
    };
    this.material.userData.atmo = atmoU;
    const atmoTex = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, HM_N, HM_N, THREE.RedFormat, THREE.UnsignedByteType);
      t.unpackAlignment = 1;
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    const paintTex = atmoTex(this.paint); // shares the live paint buffer
    const coverTex = atmoTex(Uint8Array.from(this.cover, (v) => Math.round(clamp(v, 0, 1) * 255)));
    /** Re-upload ground paint so seasonal tints follow new roads and lots. */
    this.material.userData.atmoRefresh = () => { paintTex.needsUpdate = true; };
    const mapKind = { value: map.def.id === 'appalachia' ? 0 : map.def.id === 'norcal' ? 1 : 2 };
    this.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.material.userData.atmo, { uPaint: { value: paintTex }, uCover: { value: coverTex }, uMapKind: mapKind });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uPaint, uCover;
uniform float uMapKind, uTime, uSnow, uSnowLine, uWet, uPuddle, uRain, uCloudCover, uCloudShadow;
uniform float uDormant, uFresh, uFall, uLitter, uGolden, uMarsh, uFlowers;
uniform vec2 uCloudOffset;
uniform vec3 uSkyRefl;
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }
float atmoCloud(vec2 xz){
  if (uCloudShadow <= 0.001) return 1.0;
  vec2 p = xz + uCloudOffset;
  float n = tn(p*0.0021)*0.55 + tn(p*0.0057+3.7)*0.3 + tn(p*0.016-1.3)*0.15;
  return 1.0 - uCloudShadow * smoothstep(1.02 - uCloudCover, 1.18 - uCloudCover, n);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float dn = tn(vWPos.xz*0.35)*0.55 + tn(vWPos.xz*1.7)*0.3 + tn(vWPos.xz*6.0)*0.15;
diffuseColor.rgb *= 0.86 + dn*0.26;
// what kind of ground is this?
vec2 tuv = (vWPos.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)} * ${((HM_N - 1) / HM_N).toFixed(6)} + ${(0.5 / HM_N).toFixed(6)};
float pnt = texture2D(uPaint, tuv).r * 255.0;
float natural = 1.0 - clamp(pnt, 0.0, 1.0);
float lawn = clamp(1.0 - abs(pnt - 2.0), 0.0, 1.0);
float paved = clamp(pnt - 2.0, 0.0, 1.0);
float cov = texture2D(uCover, tuv).r;
vec3 gc = diffuseColor.rgb;
vec3 gs = sqrt(max(gc, vec3(0.0)));
float gmx = max(gs.r, max(gs.g, gs.b));
float gsat = (gmx - min(gs.r, min(gs.g, gs.b))) / max(gmx, 1e-3);
float glum = dot(gc, vec3(0.2126, 0.7152, 0.0722));
float veg = smoothstep(0.4, 0.52, gsat) * smoothstep(0.1, 0.4, vWPos.y) * (natural + lawn * 0.5);
float forest = 0.0;
if (uMapKind < 0.5) {
  // Holler County: pale spring green, ochre fall, tan dormant winter, leaf litter under the hardwoods
  gc = mix(gc, gc * vec3(1.12, 1.18, 0.72), uFresh * veg);
  gc = mix(gc, gc * vec3(1.22, 1.0, 0.62), uFall * veg * 0.45);
  gc = mix(gc, vec3(glum) * vec3(1.55, 1.2, 0.72), uDormant * veg);
  forest = smoothstep(0.34, 0.46, cov) * natural * smoothstep(1.2, 2.0, vWPos.y);
  gc = mix(gc, vec3(0.21, 0.1, 0.04) * (0.75 + 0.5 * tn(vWPos.xz * 0.9)), uLitter * forest * 0.75);
} else if (uMapKind < 1.5) {
  // Golden Coast: the hills green up with the winter rains and go gold by summer
  float goldArea = 1.0 - smoothstep(0.35, 0.8, cov);
  gc = mix(gc, vec3(0.62, 1.2, 0.26) * glum * 0.85, (1.0 - uGolden) * goldArea * veg);
  gc = mix(gc, gc * vec3(1.12, 1.0, 0.75), uGolden * (1.0 - goldArea) * veg * 0.35);
} else {
  // Gator Gulch: inland flats are sawgrass marsh (not beach), a little browner in winter
  float marshFlat = natural * step(vWPos.z, 240.0) * smoothstep(0.02, 0.18, vWPos.y) * (1.0 - smoothstep(0.7, 0.95, vWPos.y));
  float sandy = (1.0 - smoothstep(0.25, 0.45, gsat)) * smoothstep(0.25, 0.45, glum);
  float sn = tn(vWPos.xz * 0.06) * 0.6 + tn(vWPos.xz * 0.31) * 0.4;
  vec3 saw = mix(vec3(0.13, 0.17, 0.05), vec3(0.24, 0.24, 0.08), sn);
  saw = mix(saw, vec3(0.05, 0.06, 0.03), smoothstep(0.62, 0.8, sn) * 0.7); // wet mud pockets
  saw = mix(saw, vec3(0.3, 0.21, 0.09), uMarsh * 0.8);
  gc = mix(gc, saw, marshFlat * sandy);
  gc = mix(gc, vec3(glum) * vec3(1.5, 1.2, 0.7), uMarsh * smoothstep(1.1, 0.5, vWPos.y) * veg);
}
if (uFlowers > 0.003) {
  float dens = uFlowers * veg * natural * (1.0 - forest) * smoothstep(0.3, 0.7, tn(vWPos.xz * 0.012 + 7.0));
  vec2 fp = vWPos.xz / 1.1;
  vec2 fcell = floor(fp);
  float fh = th(fcell), fk = th(fcell + 17.3);
  vec2 fo = fract(fp) - 0.5 - (vec2(th(fcell + 3.1), th(fcell + 5.7)) - 0.5) * 0.5;
  vec3 fcol = uMapKind < 0.5 ? (fk < 0.4 ? vec3(0.62, 0.3, 0.7) : fk < 0.75 ? vec3(0.92, 0.9, 0.84) : vec3(0.95, 0.75, 0.08))
            : uMapKind < 1.5 ? (fk < 0.55 ? vec3(1.0, 0.4, 0.02) : fk < 0.85 ? vec3(0.36, 0.22, 0.78) : vec3(0.95, 0.8, 0.1))
            : (fk < 0.6 ? vec3(0.95, 0.78, 0.1) : vec3(0.55, 0.3, 0.75));
  fcol *= fcol;
  float fdot = step(1.0 - dens * 0.75, fh) * smoothstep(0.3, 0.16, length(fo));
  float ffar = smoothstep(0.25, 0.9, fwidth(vWPos.x));
  gc = mix(gc, fcol, mix(fdot, dens * 0.4, ffar));
}
// snow: sticks above the snow line on gentle slopes, patchy at the edge
vec3 gn = normalize(vWNrm);
float snz = tn(vWPos.xz * 0.045) * 0.6 + tn(vWPos.xz * 0.23) * 0.4;
float sline = uSnowLine + (snz - 0.5) * 26.0;
float snowM = smoothstep(sline - 5.0, sline + 8.0, vWPos.y) * smoothstep(0.6, 0.86, gn.y + snz * 0.12) * smoothstep(0.0, 0.2, uSnow);
snowM = clamp(snowM * (0.75 + 0.5 * snz) * 1.25, 0.0, 1.0) * smoothstep(0.15, 0.6, vWPos.y) * (1.0 - paved * 0.4);
gc = mix(gc, vec3(0.8, 0.85, 0.92), snowM);
// rain: darker soil, then puddles in the flats
float wetM = uWet * (1.0 - snowM) * smoothstep(0.0, 0.3, vWPos.y);
float puddle = uPuddle * (1.0 - snowM) * smoothstep(0.96, 0.995, gn.y) * smoothstep(0.66, 0.76, tn(vWPos.xz * 0.11) * 0.7 + tn(vWPos.xz * 0.47) * 0.3 + paved * 0.12 + (1.0 - natural) * 0.06);
gc *= 1.0 - wetM * (0.3 + 0.25 * gsat);
gc *= 1.0 - puddle * 0.45;
diffuseColor.rgb = gc;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.55, wetM * 0.8);
roughnessFactor = mix(roughnessFactor, 0.08, puddle);
roughnessFactor = mix(roughnessFactor, 0.65, snowM);`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
float cloudL = atmoCloud(vWPos.xz);
reflectedLight.directDiffuse *= cloudL;
reflectedLight.directSpecular *= cloudL;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
  vec3 tv = normalize(cameraPosition - vWPos);
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(tv.y, 0.0, 1.0), 5.0);
  float ring = 0.0;
  if (uRain > 0.01) {
    vec2 rp = vWPos.xz * 1.4; vec2 rc = floor(rp);
    float rt = fract(uTime * 1.3 + th(rc));
    float rd = length(fract(rp) - 0.5 - (vec2(th(rc + 1.7), th(rc + 2.9)) - 0.5) * 0.4);
    ring = smoothstep(0.05, 0.0, abs(rd - rt * 0.45)) * (1.0 - rt) * uRain;
  }
  outgoingLight = mix(outgoingLight, uSkyRefl * (0.55 + ring), puddle * (0.3 + 0.5 * fres));
  outgoingLight += uSkyRefl * wetM * fres * 0.12;
}
#include <opaque_fragment>`,
        );
    };
    // ---- end of the Atmosphere-owned block ----

    for (let cz = 0; cz < CHUNKS; cz++)
      for (let cx = 0; cx < CHUNKS; cx++) {
        const m = this.buildChunk(cx, cz);
        this.chunks.push(m);
        this.group.add(m);
      }
    this.group.add(this.buildSkirt());
  }

  // ---------------------------------------------------------------- sampling
  private idx(i: number, j: number) {
    return j * HM_N + i;
  }

  /** Bilinear height at world x,z. */
  h(x: number, z: number): number {
    const fx = clamp((x + HALF) / HM_STEP, 0, HM_N - 1.001);
    const fz = clamp((z + HALF) / HM_STEP, 0, HM_N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const H = this.heights;
    const a = H[j * HM_N + i], b = H[j * HM_N + i + 1], c = H[(j + 1) * HM_N + i], d = H[(j + 1) * HM_N + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /** Slope magnitude (rise/run) at x,z. */
  slope(x: number, z: number): number {
    const e = HM_STEP;
    const dx = (this.h(x + e, z) - this.h(x - e, z)) / (2 * e);
    const dz = (this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  coverAt(x: number, z: number): number {
    const i = clamp(Math.round((x + HALF) / HM_STEP), 0, HM_N - 1);
    const j = clamp(Math.round((z + HALF) / HM_STEP), 0, HM_N - 1);
    return this.cover[this.idx(i, j)];
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return x > -HALF + margin && x < HALF - margin && z > -HALF + margin && z < HALF - margin;
  }

  // ---------------------------------------------------------------- editing
  private markDirty(i: number, j: number) {
    const cx = clamp(Math.floor(i / CQ), 0, CHUNKS - 1);
    const cz = clamp(Math.floor(j / CQ), 0, CHUNKS - 1);
    this.dirty.add(cz * CHUNKS + cx);
    // vertices on chunk borders belong to two chunks
    if (i % CQ === 0 && i > 0) this.dirty.add(cz * CHUNKS + cx - 1);
    if (j % CQ === 0 && j > 0) this.dirty.add((cz - 1) * CHUNKS + cx);
    if (i % CQ === 0 && j % CQ === 0 && i > 0 && j > 0) this.dirty.add((cz - 1) * CHUNKS + cx - 1);
  }

  /** Visit heightmap vertices within an axis-aligned box. */
  forEachIn(minX: number, minZ: number, maxX: number, maxZ: number, fn: (i: number, j: number, x: number, z: number, id: number) => void) {
    const i0 = clamp(Math.floor((minX + HALF) / HM_STEP), 0, HM_N - 1);
    const i1 = clamp(Math.ceil((maxX + HALF) / HM_STEP), 0, HM_N - 1);
    const j0 = clamp(Math.floor((minZ + HALF) / HM_STEP), 0, HM_N - 1);
    const j1 = clamp(Math.ceil((maxZ + HALF) / HM_STEP), 0, HM_N - 1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) fn(i, j, i * HM_STEP - HALF, j * HM_STEP - HALF, j * HM_N + i);
  }

  /**
   * Grade the land under a road: cut high ground, fill low ground (embankments),
   * but leave deep gaps alone so the road becomes a bridge on pillars.
   */
  gradeRoad(pts: V2[], hs: number[], halfWidth: number) {
    const margin = 10;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const R = halfWidth + margin;
    this.forEachIn(minX - R, minZ - R, maxX + R, maxZ + R, (i, j, x, z, id) => {
      // nearest point on polyline
      let bd = Infinity, bh = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const abx = b.x - a.x, abz = b.z - a.z;
        const l2 = abx * abx + abz * abz || 1;
        let t = ((x - a.x) * abx + (z - a.z) * abz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + abx * t - x, pz = a.z + abz * t - z;
        const d = px * px + pz * pz;
        if (d < bd) { bd = d; bh = lerp(hs[k], hs[k + 1], t); }
      }
      const d = Math.sqrt(bd);
      if (d > R) return;
      const target = bh - 0.35;
      const cur = this.heights[id];
      const w = 1 - smoothstep(halfWidth + 1, R, d);
      let next = cur;
      if (cur > target) next = lerp(cur, target, w); // cut
      else if (target - cur < 4.5 && cur > WATER - 0.5) next = lerp(cur, target, w * 0.95); // fill / embankment
      if (next !== cur) {
        this.heights[id] = next;
        this.markDirty(i, j);
        if (cur < 1.5 || next < 1.5) this.texDirty = true;
      }
      if (d < halfWidth + 3 && this.paint[id] === Paint.None) {
        this.paint[id] = Paint.Dirt;
        this.markDirty(i, j);
      }
    });
  }

  /** Flatten a rectangle-ish lot to a height with feathered edges; paint it. */
  flattenLot(corners: V2[], height: number, paint: Paint) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of corners) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const feather = 6;
    this.forEachIn(minX - feather, minZ - feather, maxX + feather, maxZ + feather, (i, j, x, z, id) => {
      const d = sdPoly({ x, z }, corners);
      if (d > feather) return;
      const w = 1 - smoothstep(-1, feather, d);
      const cur = this.heights[id];
      const next = lerp(cur, height, w * 0.9);
      if (Math.abs(next - cur) > 0.01) {
        this.heights[id] = next;
        if (cur < 1.5 || next < 1.5) this.texDirty = true;
      }
      if (d < 0.5 && paint !== Paint.None && this.paint[id] !== Paint.Paved) this.paint[id] = paint;
      this.markDirty(i, j);
    });
  }

  paintCircle(x: number, z: number, r: number, p: Paint) {
    this.forEachIn(x - r, z - r, x + r, z + r, (i, j, px, pz, id) => {
      if ((px - x) ** 2 + (pz - z) ** 2 < r * r) {
        this.paint[id] = p;
        this.markDirty(i, j);
      }
    });
  }

  /** Push pending edits to the GPU. Call once per frame. */
  flush() {
    if (this.dirty.size) {
      for (const k of this.dirty) this.refreshChunk(k % CHUNKS, Math.floor(k / CHUNKS));
      this.dirty.clear();
    }
    if (this.texDirty) {
      const data = this.heightTex.image.data as Uint16Array;
      for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(this.heights[i]);
      this.heightTex.needsUpdate = true;
      this.texDirty = false;
    }
  }

  // ---------------------------------------------------------------- meshes
  private colorAt(i: number, j: number, out: THREE.Color) {
    const id = this.idx(i, j);
    const h = this.heights[id];
    const P = this.pal;
    const x = i * HM_STEP - HALF, z = j * HM_STEP - HALF;
    const c = this.cover[id];
    const r = hash2(i, j, 5);
    const mapId = this.map.def.id;
    // slope from neighbors
    const hl = this.heights[this.idx(Math.max(0, i - 1), j)], hr = this.heights[this.idx(Math.min(HM_N - 1, i + 1), j)];
    const hu = this.heights[this.idx(i, Math.max(0, j - 1))], hd = this.heights[this.idx(i, Math.min(HM_N - 1, j + 1))];
    const slope = Math.hypot(hr - hl, hd - hu) / (2 * HM_STEP);

    if (h < WATER - 0.05) {
      out.copy(P.seabed).lerp(P.deepSeabed, smoothstep(0.3, 10, -h));
    } else {
      // base vegetation color
      if (mapId === 'norcal') out.copy(P.grass2).lerp(P.grass, smoothstep(0.35, 0.8, c));
      else out.copy(P.grass).lerp(P.grass2, smoothstep(0.3, 0.9, c) * 0.45);
      // forest floor under dense cover
      if (mapId === 'appalachia' && c > 0.36 && h > 1.2) out.lerp(P.forest, 0.55);
      if (mapId === 'norcal' && x + -z * 0.9 > 420 && h > 40) out.lerp(P.forest, 0.7);
      if (mapId === 'florida' && c > 0.62) out.lerp(P.forest, 0.35);
      // marsh (Florida lowlands)
      if (mapId === 'florida' && h < 0.95 && h > 0) out.lerp(P.marsh, smoothstep(0.95, 0.4, h));
      // shoreline
      const shoreBand = mapId === 'appalachia' ? 1.4 : mapId === 'florida' ? 0.7 : 4.2;
      if (h < shoreBand) {
        const sandy = mapId === 'appalachia' ? P.mud : P.sand;
        out.lerp(sandy, smoothstep(shoreBand, shoreBand * 0.35, h));
      }
      if (mapId === 'florida' && z > 250 && h < 2.2) out.lerp(P.sand, 0.6 * smoothstep(2.2, 0.8, h));
      // rock on steep slopes
      out.lerp(P.rock, smoothstep(0.45, 0.9, slope));
      // ground paint from development
      const p = this.paint[id];
      if (p === Paint.Dirt) out.lerp(tmpA.setHex(0x8a7355), 0.7);
      else if (p === Paint.Lawn) out.lerp(tmpA.setHex(0x5f9a3c), 0.85);
      else if (p === Paint.Paved) out.lerp(tmpA.setHex(0x55565a), 0.9);
      else if (p === Paint.Scorched) out.lerp(tmpA.setHex(0x2a2622), 0.8);
    }
    const v = 0.93 + r * 0.12;
    out.multiplyScalar(v);
  }

  private buildChunk(cx: number, cz: number): THREE.Mesh {
    const n = CQ + 1;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    const colr = new Float32Array(n * n * 3);
    const index: number[] = [];
    for (let j = 0; j < CQ; j++)
      for (let i = 0; i < CQ; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.userData.chunk = [cx, cz];
    this.chunks[cz * CHUNKS + cx] = mesh;
    this.fillChunk(mesh, cx, cz);
    return mesh;
  }

  private fillChunk(mesh: THREE.Mesh, cx: number, cz: number) {
    const n = CQ + 1;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
    const colr = geo.getAttribute('color') as THREE.BufferAttribute;
    const H = this.heights;
    for (let jj = 0; jj < n; jj++)
      for (let ii = 0; ii < n; ii++) {
        const i = cx * CQ + ii, j = cz * CQ + jj;
        const k = jj * n + ii;
        const h = H[j * HM_N + i];
        pos.setXYZ(k, i * HM_STEP - HALF, h, j * HM_STEP - HALF);
        const hl = H[j * HM_N + Math.max(0, i - 1)], hr = H[j * HM_N + Math.min(HM_N - 1, i + 1)];
        const hu = H[Math.max(0, j - 1) * HM_N + i], hd = H[Math.min(HM_N - 1, j + 1) * HM_N + i];
        const nx = hl - hr, nz = hu - hd, ny = 2 * HM_STEP;
        const l = Math.hypot(nx, ny, nz);
        nor.setXYZ(k, nx / l, ny / l, nz / l);
        this.colorAt(i, j, col);
        colr.setXYZ(k, col.r, col.g, col.b);
      }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    colr.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }

  private refreshChunk(cx: number, cz: number) {
    const m = this.chunks[cz * CHUNKS + cx];
    if (m) this.fillChunk(m, cx, cz);
  }

  /** Low-res ring around the map so the world doesn't end at a cliff. */
  private buildSkirt(): THREE.Mesh {
    const ring = 16;
    const out = 5000;
    const edge: { x: number; z: number; h: number; c: THREE.Color }[] = [];
    const push = (i: number, j: number) => {
      const c = new THREE.Color();
      this.colorAt(i, j, c);
      edge.push({ x: i * HM_STEP - HALF, z: j * HM_STEP - HALF, h: this.heights[j * HM_N + i], c });
    };
    const step = 8;
    for (let i = 0; i < HM_N - 1; i += step) push(i, 0);
    for (let j = 0; j < HM_N - 1; j += step) push(HM_N - 1, j);
    for (let i = HM_N - 1; i > 0; i -= step) push(i, HM_N - 1);
    for (let j = HM_N - 1; j > 0; j -= step) push(0, j);
    const pos: number[] = [], colr: number[] = [], index: number[] = [];
    const rings = [0, 60, 200, 600, 1500, out];
    const n2 = new (class {
      v(x: number, z: number) { return Math.sin(x * 0.004) * Math.cos(z * 0.0033) + Math.sin((x + z) * 0.0021); }
    })();
    for (let r = 0; r < rings.length; r++) {
      for (const e of edge) {
        const dx = e.x / HALF, dz = e.z / HALF;
        const m = Math.max(Math.abs(dx), Math.abs(dz)) || 1;
        const ox = (dx / m) * rings[r], oz = (dz / m) * rings[r];
        const x = e.x + ox, z = e.z + oz;
        let h = e.h;
        if (r > 0) {
          const t = rings[r] / out;
          h = e.h < 0 ? e.h - rings[r] * 0.02 : lerp(e.h, e.h * 0.8 + n2.v(x, z) * 30 + 12, Math.min(1, t * 3));
        }
        pos.push(x, h - (r > 0 ? 0.05 : 0.02), z);
        colr.push(e.c.r * 0.97, e.c.g * 0.97, e.c.b * 0.97);
      }
    }
    const m = edge.length;
    for (let r = 0; r < rings.length - 1; r++)
      for (let k = 0; k < m; k++) {
        const a = r * m + k, b = r * m + ((k + 1) % m), c = (r + 1) * m + k, d = (r + 1) * m + ((k + 1) % m);
        index.push(a, b, c, b, d, c);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // Force consistent up-facing normals (winding varies around the ring)
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < nor.count; i++) if (nor.getY(i) < 0) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
    const mat = this.material.clone();
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    return mesh;
  }

  /** Raycast helper: intersect ray with heightfield by marching. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 12000): THREE.Vector3 | null {
    let t = 0;
    let step = 8;
    let prevAbove = true;
    const p = new THREE.Vector3();
    let lastT = 0;
    while (t < maxDist) {
      p.copy(origin).addScaledVector(dir, t);
      const inside = this.inBounds(p.x, p.z, -2);
      const ground = inside ? Math.max(this.h(p.x, p.z), WATER) : WATER;
      const above = p.y > ground;
      if (!above && prevAbove && t > 0) {
        // refine
        let lo = lastT, hi = t;
        for (let k = 0; k < 20; k++) {
          const m = (lo + hi) / 2;
          p.copy(origin).addScaledVector(dir, m);
          const g = this.inBounds(p.x, p.z, -2) ? Math.max(this.h(p.x, p.z), WATER) : WATER;
          if (p.y > g) lo = m;
          else hi = m;
        }
        p.copy(origin).addScaledVector(dir, (lo + hi) / 2);
        return p;
      }
      prevAbove = above;
      lastT = t;
      step = Math.max(2, Math.min(40, (p.y - ground) * 0.5));
      t += step;
    }
    return null;
  }
}

/** Signed distance from point to convex polygon (negative inside). */
export function sdPoly(p: V2, poly: V2[]): number {
  let inside = true;
  let best = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const abx = b.x - a.x, abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
    t = clamp(t, 0, 1);
    const d = Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
    best = Math.min(best, d);
    const c = abx * (p.z - a.z) - abz * (p.x - a.x);
    if (c < 0) inside = false;
  }
  // winding-agnostic inside test
  if (!inside) {
    let pos = true;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const c = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
      if (c > 0) pos = false;
    }
    inside = pos;
  }
  return inside ? -best : best;
}

export const WORLD_SIZE = WORLD;
