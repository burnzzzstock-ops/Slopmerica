// Heightmap terrain for 6 km maps: sampling, grading for roads and lots,
// ground paint, a chunked LOD mesh (4 levels, skirts hide the seams) with a
// textured detail shader, a horizon ring beyond the county line, and a height
// texture for the water shader.
import * as THREE from 'three';
import { HALF, HM_N, HM_STEP, Quality, WATER, WORLD } from '../config';
import { clamp, lerp, smoothstep, V2 } from '../core/math';
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from './atmos';
import { hash2 } from '../core/rng';
import type { MapData } from './maps';
import { createGroundTextures } from './groundTextures';

export const enum Paint {
  None = 0,
  Dirt = 1,
  Lawn = 2,
  Paved = 3,
  Scorched = 4,
}

const CQ = 128; // quads per chunk side at LOD 0 (512 m)
const CN = (HM_N - 1) / CQ; // chunks per side (12)
const LOD_STEPS = [1, 2, 4, 8];

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  lod: number;
  geos: (THREE.BufferGeometry | null)[];
  minY: number;
  maxY: number;
}

const tmpA = new THREE.Color();

/** Cheap smooth value noise from the hash, for far-away scenery. */
function vnoise(x: number, z: number, scale: number, seed: number) {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  let tx = fx - ix, tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx);
  tz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

export class Terrain {
  readonly heights: Float32Array;
  readonly cover: Float32Array;
  readonly paint: Uint8Array;
  readonly group = new THREE.Group();
  readonly heightTex: THREE.DataTexture;
  readonly material: THREE.MeshStandardMaterial;
  readonly detail: THREE.DataArrayTexture;
  /** Increments when grading or ground paint changes near-surface scenery. */
  surfaceVersion = 0;
  private chunks: Chunk[] = [];
  private dirty = new Set<number>();
  private texRows: [number, number] | null = null;
  private pal: Record<string, THREE.Color> = {};
  private lodDist: [number, number, number];
  private builtThisFrame = 0;

  constructor(public map: MapData, renderer: THREE.WebGLRenderer, q: Quality) {
    this.heights = map.heights;
    this.cover = map.cover;
    this.paint = new Uint8Array(HM_N * HM_N);
    this.lodDist = q.lod;
    for (const [k, v] of Object.entries(map.def.palette)) this.pal[k] = new THREE.Color(v);

    const half = new Uint16Array(HM_N * HM_N);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(this.heights[i]);
    this.heightTex = new THREE.DataTexture(half, HM_N, HM_N, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;

    this.detail = createGroundTextures(renderer);
    this.material = this.makeMaterial();

    for (let cz = 0; cz < CN; cz++)
      for (let cx = 0; cx < CN; cx++) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        mesh.receiveShadow = true;
        const ch: Chunk = { cx, cz, mesh, lod: -1, geos: [null, null, null, null], minY: 0, maxY: 0 };
        this.chunks.push(ch);
        this.setLod(ch, 3);
        this.group.add(mesh);
      }
    this.group.add(this.buildHorizon());
  }

  private makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const detail = this.detail;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tDetail = { value: detail };
      bindAtmos(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 mats;\nvarying vec4 vMats;\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMats = mats;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tDetail;
varying vec4 vMats;
varying vec3 vWPos;
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }
// Anti-tiling: blend two copies of a layer, the second rotated and offset,
// with a low-frequency noise mask, so no grid of repeats shows up.
vec4 tileFree(vec2 uv, float layer) {
  float m = smoothstep(0.35, 0.65, tn(uv * 0.13 + layer * 3.1));
  const mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  vec4 a = texture(tDetail, vec3(uv, layer));
  vec4 b = texture(tDetail, vec3(R * uv + vec2(0.37, 0.71), layer));
  return mix(a, b, m);
}
// Rock on steep ground: project from the side (triplanar on x/z) instead of
// from above, so cliffs get real strata instead of vertical smears.
vec4 rockAt(vec3 p, vec3 n, float scale) {
  vec3 bw = pow(abs(n), vec3(4.0));
  bw /= max(1e-4, bw.x + bw.y + bw.z);
  vec4 d = vec4(0.0);
  if (bw.y > 0.02) d += bw.y * tileFree(p.xz * scale * 0.6, 2.0);
  if (bw.x > 0.02) d += bw.x * texture(tDetail, vec3(p.zy * scale * 0.6 * vec2(1.0, 1.6), 2.0));
  if (bw.z > 0.02) d += bw.z * texture(tDetail, vec3(p.xy * scale * 0.6 * vec2(1.0, 1.6), 2.0));
  return d;
}
vec3 gWN;
vec4 detailAt(vec2 uv, vec4 w, float scale) {
  vec4 d = vec4(0.0);
  if (w.x > 0.01) d += w.x * tileFree(uv, 0.0);
  if (w.y > 0.01) d += w.y * tileFree(uv, 1.0);
  if (w.z > 0.01) d += w.z * rockAt(vWPos, gWN, scale);
  if (w.w > 0.01) d += w.w * tileFree(uv, 3.0);
  return d;
}
float gDetailH;
${CLOUD_GLSL}
uniform float uSnow, uSnowLine, uWet;
uniform vec3 uGrassTint;
float gSnow;
// atmosphere extras (seasons.ts registers these into ATMOS)
uniform float uFlowers, uPuddle, uRainAmt, uAtmoTime, uFlowerMap;
uniform vec3 uSkyRefl;
float gPuddle;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  // MSAA evaluates edge pixels at the pixel center, extrapolating varyings;
  // keep the weights sane so silhouettes cannot blow up to HDR sparkles
  vec4 mm = max(vMats, vec4(0.0));
  vec4 w = mm / max(0.5, dot(mm, vec4(1.0)));
  float dist = length(vWPos - cameraPosition);
  float fadeNear = 1.0 - smoothstep(140.0, 700.0, dist);
  float fadeMid = 1.0 - smoothstep(600.0, 2600.0, dist);
  gWN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  // steep faces are rock regardless of the painted weights
  float cliff = smoothstep(0.78, 0.55, gWN.y);
  w = mix(w, vec4(0.0, 0.08, 0.92, 0.0), cliff);
  vec4 a = detailAt(vWPos.xz * 0.23, w, 0.23);
  vec4 b = detailAt(vWPos.xz * 0.041 + 0.37, w, 0.041);
  // cliff rock: darker, with moss/lichen streaks where it's less steep and damp
  float moss = smoothstep(0.35, 0.75, tn(vWPos.xz * 0.09 + vWPos.y * 0.05)) * smoothstep(0.3, 0.68, gWN.y);
  float band = tn(vec2(vWPos.y * 0.35, vWPos.x * 0.01 + vWPos.z * 0.01)); // sedimentary banding
  // (linear albedo: real rock is darker than it looks)
  vec3 rockCol = mix(vec3(0.075, 0.07, 0.062), vec3(0.15, 0.135, 0.115), band);
  rockCol = mix(rockCol, vec3(0.045, 0.075, 0.025), moss * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, cliff * 0.9);
  vec3 det = mix(b.rgb, a.rgb, 0.6) * 2.0;
  det = mix(det, pow(max(det, vec3(0.0)), vec3(1.6)) * 1.25, cliff);
  diffuseColor.rgb *= mix(mix(vec3(1.0), b.rgb * 2.0, 0.55 * fadeMid), det, fadeNear * 0.9);
  gDetailH = mix(b.a, a.a, 0.65) * fadeNear;
  float macro = tn(vWPos.xz * 0.004) * 0.6 + tn(vWPos.xz * 0.017) * 0.4;
  diffuseColor.rgb *= 0.88 + macro * 0.22;
  // seasons: grass browns in winter, NorCal hills green up in the rainy season
  diffuseColor.rgb *= mix(vec3(1.0), uGrassTint, w.x);
  // wildflowers: a Golden Coast superbloom, phlox and daisies in the hollers,
  // tickseed in the Florida grass. Dots up close, a haze of color from afar.
  if (uFlowers > 0.003) {
    float dens = uFlowers * smoothstep(0.55, 0.9, w.x) * smoothstep(0.3, 1.2, vWPos.y)
               * smoothstep(0.32, 0.72, tn(vWPos.xz * 0.012 + 7.0) * 0.72 + tn(vWPos.xz * 0.061 + 2.0) * 0.28);
    // each drift is mostly one flower, so from afar a field reads poppy-orange or
    // lupine-purple instead of averaging out to brown
    float fdrift = mix(0.1, 0.9, smoothstep(0.36, 0.64, tn(vWPos.xz * 0.021 + 3.0) * 0.8 + tn(vWPos.xz * 0.083 + 1.0) * 0.2));
    vec3 fA, fB, fC;
    if (uFlowerMap < 0.5) { fA = vec3(0.49, 0.31, 0.52); fB = vec3(0.75, 0.63, 0.22); fC = vec3(0.78, 0.77, 0.7); } // phlox, buttercups, daisies
    else if (uFlowerMap < 1.5) { fA = vec3(0.8, 0.34, 0.17); fB = vec3(0.43, 0.34, 0.64); fC = vec3(0.77, 0.65, 0.23); } // poppies, lupine, goldfields
    else { fA = vec3(0.77, 0.64, 0.21); fB = vec3(0.48, 0.33, 0.59); fC = fA; } // tickseed, blazing star
    vec2 fp = vWPos.xz / 1.1;
    vec2 fcell = floor(fp);
    float fh = th(fcell), fk = th(fcell + 17.3);
    vec2 fo = fract(fp) - 0.5 - (vec2(th(fcell + 3.1), th(fcell + 5.7)) - 0.5) * 0.5;
    vec3 fcol = fk > 0.9 ? fC : th(fcell + 9.1) < fdrift ? fB : fA;
    vec3 ffarCol = mix(mix(fA, fB, fdrift), fC, 0.1);
    fcol *= fcol;
    ffarCol *= ffarCol;
    float fdot = step(1.0 - dens * 0.35, fh) * smoothstep(0.25, 0.12, length(fo));
    float ffar = smoothstep(0.25, 0.9, fwidth(vWPos.x));
    float fmott = clamp(0.3 + 0.95 * tn(vWPos.xz * 0.11 + 5.0), 0.0, 1.0); // clumps, so far fields aren't flat paint
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(fcol, ffarCol, ffar), mix(fdot, dens * 0.24 * fmott, ffar));
  }
  // snow settles on flat-ish ground above the snow line, patchy at the edges
  vec3 wN = gWN;
  float patchy = tn(vWPos.xz * 0.05) * 0.5 + macro * 0.5;
  gSnow = uSnow * smoothstep(0.5, 0.82, wN.y) * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vWPos.y)
        * smoothstep(0.15, 0.6, vWPos.y) * smoothstep(0.0, 0.35, uSnow * 1.2 - (1.0 - patchy) * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.97), gSnow);
  gDetailH *= 1.0 - gSnow * 0.8;
  diffuseColor.rgb *= 1.0 - uWet * 0.3 * (1.0 - gSnow);
  // puddles gather in the flats (and on dirt and paving) once the ground is soaked
  gPuddle = uPuddle * (1.0 - gSnow) * smoothstep(0.96, 0.995, wN.y)
          * smoothstep(0.62, 0.74, tn(vWPos.xz * 0.11) * 0.7 + tn(vWPos.xz * 0.47) * 0.3 + w.y * 0.1 + w.z * 0.08);
  diffuseColor.rgb *= 1.0 - gPuddle * 0.45;
  gDetailH *= 1.0 - gPuddle;
}`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.45, uWet * 0.7 * (1.0 - gSnow));\nroughnessFactor = mix(roughnessFactor, 0.06, gPuddle);')
        .replace(
          '#include <opaque_fragment>',
          `{
  // puddles mirror the sky, with raindrop rings while it pours
  vec3 tv = normalize(cameraPosition - vWPos);
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(tv.y, 0.0, 1.0), 5.0);
  float ring = 0.0;
  if (uRainAmt > 0.01 && gPuddle > 0.01) {
    vec2 rp = vWPos.xz * 1.4; vec2 rc = floor(rp);
    float rt = fract(uAtmoTime * 1.3 + th(rc));
    float rd = length(fract(rp) - 0.5 - (vec2(th(rc + 1.7), th(rc + 2.9)) - 0.5) * 0.4);
    ring = smoothstep(0.05, 0.0, abs(rd - rt * 0.45)) * (1.0 - rt) * min(uRainAmt, 1.0);
  }
  outgoingLight = mix(outgoingLight, uSkyRefl * (0.55 + ring), gPuddle * (0.2 + 0.4 * fres));
}
#include <opaque_fragment>`,
        )
        .replace('#include <lights_fragment_end>', cloudShadowChunk('vWPos'))
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  vec3 pos = -vViewPosition;
  vec3 dpdx = dFdx(pos), dpdy = dFdy(pos);
  float hdx = dFdx(gDetailH), hdy = dFdy(gDetailH);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (hdx * r1 + hdy * r2);
  normal = normalize(abs(det) * normal - grad * 0.9);
}`,
        );
    };
    return mat;
  }

  // ---------------------------------------------------------------- sampling
  h(x: number, z: number): number {
    const fx = clamp((x + HALF) / HM_STEP, 0, HM_N - 1.001);
    const fz = clamp((z + HALF) / HM_STEP, 0, HM_N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const H = this.heights;
    const a = H[j * HM_N + i], b = H[j * HM_N + i + 1], c = H[(j + 1) * HM_N + i], d = H[(j + 1) * HM_N + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  slope(x: number, z: number): number {
    const e = HM_STEP;
    const dx = (this.h(x + e, z) - this.h(x - e, z)) / (2 * e);
    const dz = (this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  coverAt(x: number, z: number): number {
    const i = clamp(Math.round((x + HALF) / HM_STEP), 0, HM_N - 1);
    const j = clamp(Math.round((z + HALF) / HM_STEP), 0, HM_N - 1);
    return this.cover[j * HM_N + i];
  }

  paintAt(x: number, z: number): Paint {
    const i = clamp(Math.round((x + HALF) / HM_STEP), 0, HM_N - 1);
    const j = clamp(Math.round((z + HALF) / HM_STEP), 0, HM_N - 1);
    return this.paint[j * HM_N + i] as Paint;
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return x > -HALF + margin && x < HALF - margin && z > -HALF + margin && z < HALF - margin;
  }

  // ---------------------------------------------------------------- editing
  private markDirty(i: number, j: number) {
    const cx = clamp(Math.floor(i / CQ), 0, CN - 1);
    const cz = clamp(Math.floor(j / CQ), 0, CN - 1);
    this.dirty.add(cz * CN + cx);
    if (i % CQ === 0 && i > 0) this.dirty.add(cz * CN + cx - 1);
    if (j % CQ === 0 && j > 0) this.dirty.add((cz - 1) * CN + cx);
    if (i % CQ === 0 && j % CQ === 0 && i > 0 && j > 0) this.dirty.add((cz - 1) * CN + cx - 1);
  }

  private markTex(j: number) {
    if (!this.texRows) this.texRows = [j, j];
    else {
      this.texRows[0] = Math.min(this.texRows[0], j);
      this.texRows[1] = Math.max(this.texRows[1], j);
    }
  }

  forEachIn(minX: number, minZ: number, maxX: number, maxZ: number, fn: (i: number, j: number, x: number, z: number, id: number) => void) {
    const i0 = clamp(Math.floor((minX + HALF) / HM_STEP), 0, HM_N - 1);
    const i1 = clamp(Math.ceil((maxX + HALF) / HM_STEP), 0, HM_N - 1);
    const j0 = clamp(Math.floor((minZ + HALF) / HM_STEP), 0, HM_N - 1);
    const j1 = clamp(Math.ceil((maxZ + HALF) / HM_STEP), 0, HM_N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j, i * HM_STEP - HALF, j * HM_STEP - HALF, j * HM_N + i);
  }

  /** Cut high ground and fill low ground under a road; deep gaps stay open for bridges. */
  gradeRoad(pts: V2[], hs: number[], halfWidth: number) {
    this.surfaceVersion++;
    const margin = 10;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const R = halfWidth + margin;
    this.forEachIn(minX - R, minZ - R, maxX + R, maxZ + R, (i, j, x, z, id) => {
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
      if (cur > target) next = lerp(cur, target, w);
      else if (target - cur < 4.5 && cur > WATER - 0.5) next = lerp(cur, target, w * 0.95);
      if (next !== cur) {
        this.heights[id] = next;
        this.markDirty(i, j);
        if (cur < 1.5 || next < 1.5) this.markTex(j);
      }
      if (d < halfWidth + 3 && this.paint[id] === Paint.None) {
        this.paint[id] = Paint.Dirt;
        this.markDirty(i, j);
      }
    });
  }

  flattenLot(corners: V2[], height: number, paint: Paint) {
    this.surfaceVersion++;
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
        if (cur < 1.5 || next < 1.5) this.markTex(j);
      }
      if (d < 0.5 && paint !== Paint.None && this.paint[id] !== Paint.Paved) this.paint[id] = paint;
      this.markDirty(i, j);
    });
  }

  paintCircle(x: number, z: number, r: number, p: Paint) {
    this.surfaceVersion++;
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
      for (const k of this.dirty) {
        const ch = this.chunks[k];
        for (let l = 0; l < 4; l++) { ch.geos[l]?.dispose(); ch.geos[l] = null; }
        const lod = ch.lod;
        ch.lod = -1;
        this.setLod(ch, lod);
      }
      this.dirty.clear();
    }
    if (this.texRows) {
      const data = this.heightTex.image.data as Uint16Array;
      const [a, b] = this.texRows;
      for (let i = a * HM_N; i < (b + 1) * HM_N; i++) data[i] = THREE.DataUtils.toHalfFloat(this.heights[i]);
      this.heightTex.needsUpdate = true;
      this.texRows = null;
    }
  }

  /** Pick each chunk's detail level from the camera distance. */
  updateLOD(cam: THREE.Vector3) {
    this.builtThisFrame = 0;
    const [d0, d1, d2] = this.lodDist;
    const size = CQ * HM_STEP;
    // switch cached levels immediately; build missing ones nearest-first so the
    // ground under the camera sharpens first after a jump
    const pending: { ch: Chunk; want: number; d: number }[] = [];
    for (const ch of this.chunks) {
      const minX = ch.cx * size - HALF, minZ = ch.cz * size - HALF;
      const dx = Math.max(minX - cam.x, 0, cam.x - (minX + size));
      const dz = Math.max(minZ - cam.z, 0, cam.z - (minZ + size));
      const dy = Math.max(ch.minY - cam.y, 0, cam.y - ch.maxY);
      const d = Math.hypot(dx, dy * 0.7, dz);
      const want = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : 3;
      if (want === ch.lod) continue;
      if (ch.geos[want]) this.setLod(ch, want);
      else pending.push({ ch, want, d });
    }
    if (!pending.length) return;
    pending.sort((a, b) => a.d - b.d);
    const budget = pending.length > 12 ? 6 : 3;
    for (let k = 0; k < Math.min(budget, pending.length); k++) this.setLod(pending[k].ch, pending[k].want);
  }

  private setLod(ch: Chunk, lod: number) {
    if (ch.lod === lod && ch.geos[lod]) return;
    if (!ch.geos[lod]) {
      ch.geos[lod] = this.buildChunk(ch, lod);
      this.builtThisFrame++;
    }
    ch.mesh.geometry = ch.geos[lod]!;
    ch.lod = lod;
  }

  // ---------------------------------------------------------------- meshes
  private shade(i: number, j: number, col: THREE.Color, mats: number[]) {
    const id = j * HM_N + i;
    const h = this.heights[id];
    const P = this.pal;
    const x = i * HM_STEP - HALF;
    const c = this.cover[id];
    const r = hash2(i, j, 5);
    const mapId = this.map.def.id;
    const H = this.heights;
    const hl = H[j * HM_N + Math.max(0, i - 1)], hr = H[j * HM_N + Math.min(HM_N - 1, i + 1)];
    const hu = H[Math.max(0, j - 1) * HM_N + i], hd = H[Math.min(HM_N - 1, j + 1) * HM_N + i];
    const slope = Math.hypot(hr - hl, hd - hu) / (2 * HM_STEP);
    let grass = 1, dirt = 0, rock = 0, sand = 0;
    if (h < WATER - 0.05) {
      col.copy(P.seabed).lerp(P.deepSeabed, smoothstep(0.3, 12, -h));
      grass = 0;
      if (mapId === 'appalachia') dirt = 1;
      else sand = 1;
    } else {
      if (mapId === 'norcal') col.copy(P.grass2).lerp(P.grass, smoothstep(0.35, 0.8, c));
      else col.copy(P.grass).lerp(P.grass2, smoothstep(0.3, 0.9, c) * 0.4);
      let forest = 0;
      if (mapId === 'appalachia' && c > 0.36 && h > 1.3) forest = 0.6;
      if (mapId === 'norcal' && x > 1500 && h > 120) forest = 0.75;
      if (mapId === 'florida' && c > 0.62) forest = 0.4;
      if (forest) {
        col.lerp(P.forest, forest);
        dirt += forest * 0.8;
        grass -= forest * 0.5;
      }
      if (mapId === 'florida' && h < 0.95 && h > 0) col.lerp(P.marsh, smoothstep(0.95, 0.4, h));
      const shoreBand = mapId === 'appalachia' ? 1.5 : mapId === 'florida' ? 0.3 : 4.2;
      if (h < shoreBand) {
        const t = smoothstep(shoreBand, shoreBand * 0.3, h);
        col.lerp(mapId === 'appalachia' ? P.mud : P.sand, t);
        if (mapId === 'appalachia') dirt += t * 1.5;
        else sand += t * 2;
      }
      if (this.map.sand) {
        const beachy = this.map.sand(x, j * HM_STEP - HALF) * smoothstep(9, 3, h);
        if (beachy > 0.01) {
          col.lerp(P.sand, beachy);
          sand += beachy * 2;
          grass -= beachy;
        }
      }
      const rk = smoothstep(0.55, 1.1, slope) * 0.9;
      col.lerp(P.rock, rk);
      rock += rk * 2.5;
      const p = this.paint[id];
      if (p === Paint.Dirt) { col.lerp(tmpA.setHex(0x86705a), 0.7); dirt += 2; }
      else if (p === Paint.Lawn) { col.lerp(tmpA.setHex(0x5e8f3a), 0.85); grass += 1; }
      else if (p === Paint.Paved) { col.lerp(tmpA.setHex(0x5a5a5c), 0.9); rock += 2; }
      else if (p === Paint.Scorched) { col.lerp(tmpA.setHex(0x2a2622), 0.8); dirt += 2; }
    }
    col.multiplyScalar(0.94 + r * 0.1);
    mats[0] = Math.max(0, grass);
    mats[1] = dirt;
    mats[2] = rock;
    mats[3] = sand;
  }

  private buildChunk(ch: Chunk, lod: number): THREE.BufferGeometry {
    const s = LOD_STEPS[lod];
    const n = CQ / s + 1;
    const count = n * n + 4 * n;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const colr = new Float32Array(count * 3);
    const mats = new Float32Array(count * 4);
    const H = this.heights;
    const col = new THREE.Color();
    const m = [0, 0, 0, 0];
    let minY = Infinity, maxY = -Infinity;
    for (let jj = 0; jj < n; jj++)
      for (let ii = 0; ii < n; ii++) {
        const i = ch.cx * CQ + ii * s, j = ch.cz * CQ + jj * s;
        const k = jj * n + ii;
        let h = H[j * HM_N + i];
        if (s > 1 && h > WATER - 0.3) {
          // coarse levels skip samples; keep narrow rivers and creeks from vanishing
          // by pulling a vertex down to the waterline if its block holds water
          const r = s >> 1;
          let lo = h;
          for (let bj = Math.max(0, j - r); bj <= Math.min(HM_N - 1, j + r); bj++)
            for (let bi = Math.max(0, i - r); bi <= Math.min(HM_N - 1, i + r); bi++) lo = Math.min(lo, H[bj * HM_N + bi]);
          if (lo < WATER - 0.2) h = Math.min(h, Math.max(lo, WATER - 1.2));
        }
        minY = Math.min(minY, h);
        maxY = Math.max(maxY, h);
        pos[k * 3] = i * HM_STEP - HALF;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = j * HM_STEP - HALF;
        const il = Math.max(0, i - s), ir = Math.min(HM_N - 1, i + s), ju = Math.max(0, j - s), jd = Math.min(HM_N - 1, j + s);
        const nx = (H[j * HM_N + il] - H[j * HM_N + ir]) / ((ir - il) * HM_STEP);
        const nz = (H[ju * HM_N + i] - H[jd * HM_N + i]) / ((jd - ju) * HM_STEP);
        const l = Math.hypot(nx, 1, nz);
        nor[k * 3] = nx / l;
        nor[k * 3 + 1] = 1 / l;
        nor[k * 3 + 2] = nz / l;
        this.shade(i, j, col, m);
        colr[k * 3] = col.r;
        colr[k * 3 + 1] = col.g;
        colr[k * 3 + 2] = col.b;
        mats.set(m, k * 4);
      }
    const edges: number[][] = [[], [], [], []];
    for (let t = 0; t < n; t++) {
      edges[0].push(t);
      edges[1].push((n - 1) * n + t);
      edges[2].push(t * n);
      edges[3].push(t * n + n - 1);
    }
    let o = n * n;
    const skirtIdx: number[][] = [];
    const drop = 4 + s * 3;
    for (const e of edges) {
      const row: number[] = [];
      for (const k of e) {
        pos[o * 3] = pos[k * 3];
        pos[o * 3 + 1] = pos[k * 3 + 1] - drop;
        pos[o * 3 + 2] = pos[k * 3 + 2];
        nor.copyWithin(o * 3, k * 3, k * 3 + 3);
        colr.copyWithin(o * 3, k * 3, k * 3 + 3);
        mats.copyWithin(o * 4, k * 4, k * 4 + 4);
        row.push(o++);
      }
      skirtIdx.push(row);
    }
    const index: number[] = [];
    for (let jj = 0; jj < n - 1; jj++)
      for (let ii = 0; ii < n - 1; ii++) {
        const a = jj * n + ii, b = a + 1, c = a + n, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    edges.forEach((e, ei) => {
      const sk = skirtIdx[ei];
      for (let t = 0; t < n - 1; t++) {
        const a = e[t], b = e[t + 1], c = sk[t], d = sk[t + 1];
        index.push(a, b, c, b, d, c, a, c, b, b, c, d);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    geo.setAttribute('mats', new THREE.BufferAttribute(mats, 4));
    geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    ch.minY = minY;
    ch.maxY = maxY;
    const x0 = ch.cx * CQ * HM_STEP - HALF, z0 = ch.cz * CQ * HM_STEP - HALF;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, minY - drop, z0), new THREE.Vector3(x0 + CQ * HM_STEP, maxY, z0 + CQ * HM_STEP));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    return geo;
  }

  /** Low-res landscape out to the horizon, blended into the map edges. The grid
   *  is fine along the rim (so it meets the terrain) and coarsens outward. */
  private buildHorizon(): THREE.Mesh {
    const R = HALF * 3.4;
    const side: number[] = [];
    for (let x = 0; x <= HALF; x += 32) side.push(x);
    let x = HALF, st = 32;
    while (x < R) { st = Math.min(st * 1.13, 420); x += st; side.push(Math.min(x, R)); }
    const xs = [...side.slice(1).reverse().map((v) => -v), ...side];
    const n = xs.length;
    const pos = new Float32Array(n * n * 3);
    const colr = new Float32Array(n * n * 3);
    const mats = new Float32Array(n * n * 4);
    const P = this.pal;
    const col = new THREE.Color(), edgeCol = new THREE.Color(), farLand = new THREE.Color(0, 0, 0);
    const m4 = [0, 0, 0, 0];
    // average land color of the map, so the far ring reads as more of the same
    let cnt = 0;
    for (let k = 0; k < 900; k++) {
      const i = Math.floor(hash2(k, 1, 77) * HM_N), j = Math.floor(hash2(k, 2, 77) * HM_N);
      if (this.heights[j * HM_N + i] < 1.5) continue;
      this.shade(i, j, col, m4);
      farLand.add(col);
      cnt++;
    }
    farLand.multiplyScalar(1 / Math.max(1, cnt));
    const gridOf = (v: number) => Math.round((clamp(v, -HALF, HALF) + HALF) / HM_STEP);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = xs[i], z = xs[j];
        const k = j * n + i;
        const out = Math.max(Math.abs(x), Math.abs(z)) - HALF;
        let h: number;
        if (out <= 0) h = this.h(x, z);
        else {
          const edge = this.h(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF));
          h = lerp(edge, this.map.far(x, z), smoothstep(0, 700, out));
          // keep clear of the water plane: no land within a hair of y = 0
          if (h < WATER) h = Math.min(h, WATER - 2.5 * smoothstep(0, 300, out));
          else h = Math.max(h, WATER + 1.5 * smoothstep(0, 300, out));
        }
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        this.shade(Math.min(HM_N - 1, gridOf(x)), Math.min(HM_N - 1, gridOf(z)), edgeCol, m4);
        if (h < WATER) col.copy(P.seabed).lerp(P.deepSeabed, smoothstep(0, 20, -h));
        else {
          const nz = vnoise(x, z, 700, 3);
          col.copy(farLand).multiplyScalar(0.9 + nz * 0.16);
          // patchy forest cover so the far country doesn't read as a lawn
          const f = vnoise(x, z, 520, 11) * 0.65 + vnoise(x, z, 170, 12) * 0.35;
          const id = this.map.def.id;
          const lean = id === 'appalachia' ? 0.38 : id === 'florida' ? 0.5 : x > 1500 ? 0.3 : 0.62;
          col.lerp(P.forest, smoothstep(lean, lean + 0.2, f) * 0.75);
          col.lerp(P.rock, smoothstep(250, 600, h) * 0.5);
        }
        col.lerp(edgeCol, 1 - smoothstep(0, 900, out));
        colr[k * 3] = col.r;
        colr[k * 3 + 1] = col.g;
        colr[k * 3 + 2] = col.b;
        mats[k * 4] = 1;
        mats[k * 4 + 1] = 0.4;
      }
    const index: number[] = [];
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        if (xs[i] >= -HALF && xs[i + 1] <= HALF && xs[j] >= -HALF && xs[j + 1] <= HALF) continue;
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    geo.setAttribute('mats', new THREE.BufferAttribute(mats, 4));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** March a ray against the heightfield. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 30000): THREE.Vector3 | null {
    let t = 0;
    let prevAbove = true;
    const p = new THREE.Vector3();
    let lastT = 0;
    while (t < maxDist) {
      p.copy(origin).addScaledVector(dir, t);
      const inside = this.inBounds(p.x, p.z, -2);
      const ground = inside ? Math.max(this.h(p.x, p.z), WATER) : WATER;
      const above = p.y > ground;
      if (!above && prevAbove && t > 0) {
        let lo = lastT, hi = t;
        for (let k = 0; k < 22; k++) {
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
      t += Math.max(2, Math.min(60, (p.y - ground) * 0.5));
    }
    return null;
  }
}

/** Signed distance from point to convex polygon (negative inside). */
export function sdPoly(p: V2, poly: V2[]): number {
  let best = Infinity;
  let pos = true, neg = true;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const abx = b.x - a.x, abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    const t = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1);
    best = Math.min(best, Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z));
    const c = abx * (p.z - a.z) - abz * (p.x - a.x);
    if (c < 0) pos = false;
    if (c > 0) neg = false;
  }
  return pos || neg ? -best : best;
}

export const WORLD_SIZE = WORLD;
