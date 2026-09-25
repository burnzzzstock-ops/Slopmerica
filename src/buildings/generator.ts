// Procedural buildings for every zone and level, landmarks and billboards.
// Every geometry is NON-INDEXED with position / normal / uv / color / tile in
// lot-local space (road on +Z), and they all share one material whose shader
// samples the facade texture array: tiling siding, brick, windows, glass,
// storefronts, roofs, parking stalls and glowing brand signs.
import * as THREE from 'three';
import type { BuildingModel, LandmarkId, LotSpec, ZoneType } from '../contracts';
import { CELL } from '../config';
import { mulberry32 } from '../core/rng';
import { BRANDS, brandById, type Brand } from '../art/brands';
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from '../world/atmos';
import { facadeTexture, loadSignFonts, SIGN_BASE, T } from './atlas';
import { col, Kit, type Col } from './kit';

// ------------------------------------------------------------------ material
let material: THREE.MeshStandardMaterial | null = null;
const nightUniform = { value: 0 };

/** The single shared material for every building, landmark and billboard. */
export function buildingMaterial(): THREE.Material {
  if (material) return material;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tFacade = { value: facadeTexture() };
    sh.uniforms.uNightB = nightUniform;
    bindAtmos(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tile;\nvarying float vTile;\nvarying vec2 vUvT;\nvarying vec3 vBW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTile = tile;\nvUvT = uv;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 bw = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  bw = batchingMatrix * bw;
#endif
  vBW = (modelMatrix * bw).xyz;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tFacade;
uniform float uNightB, uSnow, uSnowLine, uWet;
varying float vTile;
varying vec2 vUvT;
varying vec3 vBW;
${CLOUD_GLSL}
float gGlass, gGlow, gSign;
vec3 gTex;
float bh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float tl = floor(vTile + 0.5);
  gSign = step(${SIGN_BASE}.0 - 0.5, tl);
  vec2 tuv = gSign > 0.5 ? clamp(vUvT, vec2(0.004), vec2(0.996)) : fract(vUvT);
  vec4 tx = textureGrad(tFacade, vec3(tuv, tl), dFdx(vUvT), dFdy(vUvT));
  gTex = tx.rgb;
  gGlass = gSign > 0.5 ? 0.0 : smoothstep(0.2, 0.5, tx.a);
  gGlow = gSign > 0.5 ? 0.0 : smoothstep(0.6, 0.9, tx.a);
  // glass and signs keep their own color; walls/roofs are tinted by vertex color
  diffuseColor.rgb = mix(diffuseColor.rgb * tx.rgb, tx.rgb, max(gGlass, gSign));
#ifdef FLAT_SHADED
  vec3 wN = vec3(0.0, 1.0, 0.0); // an empty BatchedMesh compiles without normals
#else
  vec3 wN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
#endif
  float sn = uSnow * smoothstep(0.55, 0.9, wN.y) * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vBW.y) * (1.0 - gSign);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), sn * 0.9);
  diffuseColor.rgb *= 1.0 - uWet * 0.2 * smoothstep(0.5, 0.9, wN.y) * (1.0 - sn);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, gGlass);
roughnessFactor = mix(roughnessFactor, 0.35, uWet * 0.6 * (1.0 - gGlass));`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, gGlass);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // lit windows: each ~3 m cell decides on its own; warm homes, cool offices
  vec3 cell = floor(vBW / 3.1);
  float h = bh(cell);
  float lit = step(h, 0.42);
  vec3 wc = mix(vec3(1.0, 0.72, 0.42), vec3(0.78, 0.88, 1.0), step(0.7, bh(cell + 17.0)));
  totalEmissiveRadiance += wc * gGlow * lit * uNightB * 0.85;
  // lightbox signs: faintly self-lit by day, blazing at night
  float boost = 1.0;
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  boost = max(1.0, vColor.r);
#endif
  totalEmissiveRadiance += gTex * gSign * (0.1 + uNightB * 0.75 * boost) * (boost > 1.5 ? 1.8 : 1.0);
}`,
      )
      .replace('#include <lights_fragment_end>', cloudShadowChunk('vBW'));
  };
  m.customProgramCacheKey = () => 'slop-buildings';
  material = m;
  return m;
}

/** 0 = day, 1 = night (window glow, sign glow). */
export function setBuildingNight(n: number) {
  nightUniform.value = n;
}

/** Generate fonts/atlases. Call once before generating buildings. */
export async function loadArt(): Promise<void> {
  await loadSignFonts();
  facadeTexture();
}

// ------------------------------------------------------------------ palettes
type Rnd = () => number;
const pick = <X>(r: Rnd, a: readonly X[]): X => a[Math.floor(r() * a.length) % a.length];
const SIDING = [0xe8e2d0, 0xc9d3d8, 0xd9c9a8, 0xa8b89a, 0xe0d6c3, 0xb7c4cf, 0xf2efe6, 0x9fa8a3, 0xd8b98f, 0xc7a6a0, 0x8fa3b8, 0xefe3c2];
const ROOFS = [0x4a4a4a, 0x6b5b4b, 0x3d4650, 0x7a6a5a, 0x5b3b30, 0x57534e, 0x2f3338];
const BRICK = [0xb5553c, 0x9e4a3a, 0xc07a5a, 0x8a5a4a, 0xd0b090, 0xa86a50];
const STUCCO = [0xe6d7bd, 0xd9c7a5, 0xf0e6d2, 0xc9b79c, 0xe8e1d6, 0xd4cbbe];
const CARS = [0xf2f2f2, 0x1b1b1d, 0xa8adb3, 0x5a5f66, 0x9b1b1b, 0x1d3a8a, 0x2f4a36, 0xc9b99a, 0x7a1f2b, 0xd8d8d0, 0x355c7d, 0xe0a030];
const PANEL = [0xd9d4ca, 0x6b6e73, 0x2f3134, 0xb8a58a, 0x8c8f93, 0xe9e6df];
const METAL = [0xc9ccd0, 0xb8bec4, 0xd6cfc0, 0x9aa6b0, 0xc8b89a];
const LAWN_OK = 0x7aa35a, LAWN_DRY = 0xa6a060;

const carKind = (r: Rnd): 'sedan' | 'suv' | 'pickup' | 'van' => (r() < 0.35 ? 'pickup' : r() < 0.6 ? 'suv' : r() < 0.85 ? 'sedan' : 'van');

function brandFor(spec: LotSpec, r: Rnd): Brand | undefined {
  const b = brandById(spec.brand);
  if (b) return b;
  const pool = BRANDS.filter((x) => x.zones.includes(spec.zone));
  return pool.length ? pick(r, pool) : undefined;
}

// ------------------------------------------------------------------ lot helpers
/** Parking lot with stalls along X and parked cars; returns number of cars. */
function parking(k: Kit, x0: number, z0: number, x1: number, z1: number, r: Rnd, fill: number) {
  if (x1 - x0 < 3 || z1 - z0 < 5) return 0;
  k.slab(x0, z0, x1, z1, 0.06, T.PARKING, col(0xffffff));
  let n = 0;
  const rows = Math.floor((z1 - z0) / 5.4);
  const cols = Math.floor((x1 - x0) / 2.7);
  for (let rr = 0; rr < rows; rr++)
    for (let c = 0; c < cols; c++) {
      if (r() > fill) continue;
      const x = x0 + (c + 0.5) * 2.7, z = z0 + (rr + 0.5) * 5.4;
      k.car(x, z, r() < 0.5 ? 0 : Math.PI, col(pick(r, CARS)), carKind(r));
      n++;
    }
  return n;
}

function lawn(k: Kit, W: number, D: number, r: Rnd, dry = false) {
  const c = col(dry ? LAWN_DRY : LAWN_OK).lerp(col(0x6f8f4a), r() * 0.4);
  k.slab(-W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, D / 2 - 0.3, 0.04, T.LAWN, c);
}

function paved(k: Kit, W: number, D: number) {
  k.slab(-W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, D / 2 - 0.2, 0.045, T.CONCRETE, col(0xffffff));
}

function fence(k: Kit, W: number, zFrom: number, zTo: number, color: Col) {
  const h = 1.8;
  k.box(-W / 2 + 0.4, (zFrom + zTo) / 2, 0.08, zTo - zFrom, 0, h, T.SOLID, color, T.SOLID);
  k.box(W / 2 - 0.4, (zFrom + zTo) / 2, 0.08, zTo - zFrom, 0, h, T.SOLID, color, T.SOLID);
  k.box(0, zFrom, W - 0.8, 0.08, 0, h, T.SOLID, color, T.SOLID);
}

function flagpole(k: Kit, x: number, z: number, r: Rnd) {
  k.cyl(x, z, 0.06, 0, 7, 6, T.SOLID, col(0xdddddd));
  const flag = r() < 0.7 ? col(0xb22234) : r() < 0.5 ? col(0x1d3a8a) : col(0xf2d23a);
  k.quad([x, 5.8, z], [x + 1.8, 5.8, z], [x + 1.8, 6.9, z], [x, 6.9, z], [[0, 0], [1, 0], [1, 1], [0, 1]], flag, T.SOLID);
  k.quad([x + 1.8, 5.8, z], [x, 5.8, z], [x, 6.9, z], [x + 1.8, 6.9, z], [[0, 0], [1, 0], [1, 1], [0, 1]], flag, T.SOLID);
}

/** Garage door panel on the front (+Z) face at z. */
function garageDoor(k: Kit, x: number, z: number, w: number, h = 2.4) {
  const n = Math.max(1, Math.round(w / 3));
  k.quad([x - w / 2, 0.05, z + 0.03], [x + w / 2, 0.05, z + 0.03], [x + w / 2, h, z + 0.03], [x - w / 2, h, z + 0.03], [[0, 0], [n, 0], [n, 1], [0, 1]], col(0xffffff), T.GARAGE);
}

function frontDoor(k: Kit, x: number, z: number, color: Col) {
  k.quad([x - 0.5, 0.05, z + 0.03], [x + 0.5, 0.05, z + 0.03], [x + 0.5, 2.2, z + 0.03], [x - 0.5, 2.2, z + 0.03], [[0, 0], [1, 0], [1, 1], [0, 1]], color, T.SOLID);
}

function acUnits(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, r: Rnd, n: number) {
  for (let i = 0; i < n; i++) {
    const x = x0 + 1.5 + r() * Math.max(0.1, x1 - x0 - 3), z = z0 + 1.5 + r() * Math.max(0.1, z1 - z0 - 3);
    k.box(x, z, 1.6 + r(), 1.4 + r(), y, y + 1.1, T.METAL, col(0xb9bcc0), T.SOLID, col(0x9a9da2));
  }
}

/** Flat roof with a parapet around the edge. */
function parapet(k: Kit, cx: number, cz: number, w: number, d: number, y: number, c: Col, h = 0.9) {
  const t = 0.3;
  k.box(cx, cz + d / 2 - t / 2, w, t, y, y + h, T.SOLID, c, T.SOLID, undefined, { ao: false });
  k.box(cx, cz - d / 2 + t / 2, w, t, y, y + h, T.SOLID, c, T.SOLID, undefined, { ao: false });
  k.box(cx + w / 2 - t / 2, cz, t, d - 2 * t, y, y + h, T.SOLID, c, T.SOLID, undefined, { ao: false });
  k.box(cx - w / 2 + t / 2, cz, t, d - 2 * t, y, y + h, T.SOLID, c, T.SOLID, undefined, { ao: false });
}

// ------------------------------------------------------------------ residential low
function resLow(s: LotSpec, r: Rnd, W: number, D: number): BuildingModel {
  const k = new Kit();
  const L = s.level;
  lawn(k, W, D, r, L === 1 && r() < 0.6);
  const siding = col(pick(r, SIDING));
  const roof = col(pick(r, ROOFS));
  const trim = col(0xf4f1ea);
  let height = 4;
  let label = '';

  if (L === 1) {
    // single- or double-wide trailer on blocks, perpendicular to the road
    const dbl = W >= 15 && r() < 0.6;
    const tw = dbl ? 8.2 : 4.4, tl = Math.min(D - 6, 16);
    const tx = W >= 12 ? -W / 2 + tw / 2 + 1.5 : 0, tz = -D / 2 + 2 + tl / 2;
    const body = col(pick(r, [0xf1ede2, 0xe6e2cf, 0xd8e3e0, 0xefe0c8, 0xd6d8cc]));
    k.box(tx, tz, tw, tl, 0, 0.7, T.METAL, col(0x7c7a72), null);
    k.box(tx, tz, tw, tl, 0.7, 3.3, [T.TRAILER, T.TRAILER, T.SOLID, T.TRAILER], body, T.METAL, col(0xbfc2c4), { fit: true });
    if (dbl) k.gable(tx, tz, tw, tl, 3.3, 0.7, false, col(0x8a8a86), body, T.SOLID, 0.2);
    // deck + steps toward the drive
    const wood = col(0x8a6a4a);
    const dx = tx + tw / 2 + 1.1;
    k.box(dx, tz + tl / 2 - 3, 2.2, 3, 0, 0.7, T.SOLID, wood, T.SOLID);
    k.box(dx + 1.4, tz + tl / 2 - 3, 0.6, 1.2, 0, 0.35, T.SOLID, wood, T.SOLID);
    if (r() < 0.55) k.emit('cigarette', dx, 1.6, tz + tl / 2 - 3);
    // dirt drive with a truck
    const drx = W >= 12 ? W / 2 - 3 : W / 2 - 2;
    k.slab(drx - 2, D / 2 - 11, drx + 2, D / 2 - 0.3, 0.05, T.DIRT, col(0xffffff));
    k.car(drx, D / 2 - 5, r() < 0.5 ? 0 : Math.PI, col(pick(r, CARS)), r() < 0.7 ? 'pickup' : 'sedan');
    // yard stuff
    k.cyl(tx, tz, 0.35, 3.3, 3.5, 8, T.SOLID, col(0xdddddd));
    if (r() < 0.45) {
      k.cyl(tx - tw / 2 - 1.2, -D / 2 + 3, 0.32, 0, 0.95, 8, T.METAL, col(0x8a5a3a), col(0x2a2a2a));
      k.emit('fire', tx - tw / 2 - 1.2, 1.1, -D / 2 + 3);
    }
    if (r() < 0.3 && W >= 12) k.cyl(drx - 0.5, -D / 2 + 4, 2.3, 0, 1.2, 14, T.SOLID, col(0x4a7fb5), col(0x7ec8e3));
    else if (r() < 0.25) k.cyl(drx - 0.5, -D / 2 + 4, 1.8, 0.8, 0.9, 14, T.SOLID, col(0x222222));
    if (r() < 0.4) flagpole(k, W / 2 - 1, D / 2 - 1.2, r);
    height = 4;
    label = pick(r, dbl ? ['Double-Wide Dream', 'Double-Wide w/ Hot Tub (Cold)', 'The Double-Wide Estate'] : ['Single-Wide on Blocks', 'Mobile Home (Not Mobile)', 'Trailer + Burn Barrel', 'Single-Wide, Big Dreams']);
  } else if (L === 2) {
    // ranch house; narrow lots get a skinny gable-front
    const narrow = W < 13;
    const hw = narrow ? W - 2.2 : Math.min(W - 5, 12), hd = narrow ? Math.min(D - 9, 12) : Math.min(D * 0.45, 9);
    const hx = narrow ? 0 : -2, hz = D / 2 - 5.5 - hd / 2;
    k.box(hx, hz, hw, hd, 0, 3, [T.HOUSE_WIN, T.SIDING, T.HOUSE_WIN, T.SIDING], siding, null, undefined, { fit: true });
    k.gable(hx, hz, hw, hd, 3, narrow ? 2.6 : 2.1, !narrow, roof, siding);
    frontDoor(k, hx, hz + hd / 2, col(pick(r, [0x8a2a2a, 0x2a3a5a, 0x3a3a3a, 0xf2f2f2])));
    k.box(hx + hw / 4, hz - hd / 4, 0.8, 0.8, 3, 5.4, T.BRICK, col(pick(r, BRICK)), T.SOLID, col(0x333333));
    k.emit('smoke', hx + hw / 4, 5.6, hz - hd / 4);
    if (!narrow) {
      // carport + drive
      const cx = hx + hw / 2 + 2.5;
      k.box(cx, hz + 1, 4, 6, 2.6, 2.8, T.SOLID, col(0x9a9da2), T.METAL, col(0xa8abae), { ao: false });
      for (const [px, pz] of [[-1.8, -2.8], [1.8, -2.8], [-1.8, 2.8], [1.8, 2.8]]) k.box(cx + px, hz + 1 + pz, 0.15, 0.15, 0, 2.6, T.SOLID, col(0x9a9da2), null);
      k.slab(cx - 2, hz - 2, cx + 2, D / 2 - 0.3, 0.05, T.CONCRETE, col(0xffffff));
      k.car(cx, hz + 1, Math.PI, col(pick(r, CARS)), carKind(r));
    } else {
      k.slab(W / 2 - 3.2, hz + hd / 2, W / 2 - 0.4, D / 2 - 0.3, 0.05, T.CONCRETE, col(0xffffff));
      k.car(W / 2 - 1.8, D / 2 - 3, Math.PI, col(pick(r, CARS)), carKind(r));
    }
    k.slab(hx - 0.6, hz + hd / 2, hx + 0.6, D / 2 - 0.3, 0.05, T.CONCRETE, col(0xffffff));
    if (r() < 0.5) flagpole(k, -W / 2 + 1.2, D / 2 - 1.5, r);
    height = 5.5;
    label = pick(r, ['3-Bed Ranch w/ Truck Nuts', 'Ranch (Flag Visible From Space)', 'Starter Home, Final Home', 'Split-Level Starter']);
  } else if (L === 3) {
    const narrow = W < 13;
    const hw = narrow ? W - 2.4 : Math.min(W - 8, 11), hd = Math.min(D * 0.45, 9);
    const hx = narrow ? 0 : -3, hz = D / 2 - 6 - hd / 2;
    const brickFront = r() < 0.4;
    k.box(hx, hz, hw, hd, 0, 6, [T.HOUSE_WIN, T.HOUSE_WIN, T.HOUSE_WIN, T.HOUSE_WIN], siding, null, undefined, { fit: true, floors: 2 });
    if (brickFront) k.wall(hx - hw / 2, hz + hd / 2 + 0.02, hx + hw / 2, hz + hd / 2 + 0.02, 0, 3, T.BRICK, col(pick(r, BRICK)));
    k.gable(hx, hz, hw, hd, 6, 2.6, !narrow, roof, siding);
    // porch
    k.slab(hx - hw / 2 + 0.5, hz + hd / 2, hx + hw / 2 - 0.5, hz + hd / 2 + 2, 0.35, T.CONCRETE, col(0xd8d4cc));
    for (let i = 0; i < 4; i++) k.box(hx - hw / 2 + 0.8 + (i * (hw - 1.6)) / 3, hz + hd / 2 + 1.8, 0.22, 0.22, 0.35, 2.9, T.SOLID, trim, null);
    k.box(hx, hz + hd / 2 + 1, hw - 0.6, 2.2, 2.9, 3.05, T.SOLID, trim, T.SHINGLE, roof, { ao: false });
    frontDoor(k, hx, hz + hd / 2, col(pick(r, [0x8a2a2a, 0x2a3a5a, 0x1f1f1f])));
    if (!narrow) {
      const gx = hx + hw / 2 + 3.3;
      k.box(gx, hz + 0.5, 6.4, 7, 0, 2.9, [T.SIDING, T.SIDING, T.SIDING, T.SIDING], siding, null);
      k.gable(gx, hz + 0.5, 6.4, 7, 2.9, 1.8, false, roof, siding);
      garageDoor(k, gx, hz + 4, 5.6);
      k.slab(gx - 3, hz + 4, gx + 3, D / 2 - 0.3, 0.05, T.CONCRETE, col(0xffffff));
      k.car(gx - 1.4, D / 2 - 4, Math.PI, col(pick(r, CARS)), carKind(r));
      if (r() < 0.6) k.car(gx + 1.4, D / 2 - 4.5, Math.PI, col(pick(r, CARS)), carKind(r));
    } else {
      k.slab(W / 2 - 3.2, hz + hd / 2 + 2, W / 2 - 0.4, D / 2 - 0.3, 0.05, T.CONCRETE, col(0xffffff));
      k.car(W / 2 - 1.8, D / 2 - 3, Math.PI, col(pick(r, CARS)), carKind(r));
    }
    if (r() < 0.6) fence(k, W, -D / 2 + 0.5, hz - hd / 2, col(0xb89a74));
    if (r() < 0.35) k.cyl(-W / 2 + 3, -D / 2 + 3, 1.8, 0.8, 0.9, 14, T.SOLID, col(0x222222));
    height = 8.6;
    label = pick(r, ['Colonial (Vinyl)', 'Two-Story w/ Bonus Room', 'Craftsman-ish', 'HOA-Approved Beige Dream']);
  } else {
    // L4 McMansion / L5 compound
    const big = L === 5;
    const hw = Math.min(W - (big ? 9 : 8.5), big ? 18 : 14), hd = Math.min(D * 0.5, big ? 13 : 10);
    const hx = -2.5, hz = D / 2 - 7 - hd / 2;
    const floors = big ? 3 : 2;
    const H = floors * 3;
    const stucco = r() < 0.4;
    const wallC = stucco ? col(pick(r, STUCCO)) : siding;
    const wallT = stucco ? T.APT_WIN : T.HOUSE_WIN;
    k.box(hx, hz, hw, hd, 0, H, wallT, wallC, null, undefined, { fit: true, floors });
    // brick on the front only (the classic)
    k.wall(hx - hw / 2, hz + hd / 2 + 0.03, hx + hw / 2, hz + hd / 2 + 0.03, 0, H * 0.55, T.BRICK, col(pick(r, BRICK)));
    k.hip(hx, hz, hw, hd, H, big ? 4 : 3.2, roof);
    // two-story entry tower with its own gable
    k.box(hx - hw / 5, hz + hd / 2 + 1, 3.6, 2.2, 0, H + 1.5, T.STUCCO, col(pick(r, STUCCO)), null);
    k.gable(hx - hw / 5, hz + hd / 2 + 1, 3.6, 2.2, H + 1.5, 2.2, false, roof, col(0xf0ece2), T.STUCCO, 0.3);
    frontDoor(k, hx - hw / 5, hz + hd / 2 + 2.1, col(0x3a2a1a));
    // 3/4-car garage wing
    const gw = big ? 12.5 : 9.6;
    const gx = hx + hw / 2 + gw / 2 - 0.5;
    if (gx + gw / 2 < W / 2 - 0.3) {
      k.box(gx, hz + 1, gw, 7, 0, 3.2, T.SIDING, wallC, null);
      k.hip(gx, hz + 1, gw, 7, 3.2, 2, roof);
      for (let i = 0; i < (big ? 4 : 3); i++) garageDoor(k, gx - gw / 2 + 1.7 + i * 3.05, hz + 4.5, 2.7);
      k.slab(gx - gw / 2, hz + 4.5, gx + gw / 2, D / 2 - 0.3, 0.05, T.CONCRETE, col(0xffffff));
      for (let i = 0; i < (big ? 4 : 3); i++) if (r() < 0.75) k.car(gx - gw / 2 + 1.7 + i * 3.05, D / 2 - 4 - r() * 2, Math.PI, col(pick(r, CARS)), r() < 0.6 ? 'suv' : 'pickup');
    }
    // backyard pool
    const pz = -D / 2 + 5;
    if (hz - hd / 2 - pz > 6) {
      k.slab(hx - 5, pz - 3.5, hx + 5, pz + 3.5, 0.06, T.CONCRETE, col(0xe8e4dc));
      k.slab(hx - 3.6, pz - 2.2, hx + 3.6, pz + 2.2, 0.08, T.WATER, col(0xffffff));
    }
    if (big) {
      // turret
      k.cyl(hx + hw / 2 - 1.8, hz + hd / 2 - 1.8, 2.3, 0, H + 1.2, 12, T.STUCCO, col(pick(r, STUCCO)), null);
      k.cyl(hx + hw / 2 - 1.8, hz + hd / 2 - 1.8, 2.6, H + 1.2, H + 5, 12, T.SHINGLE, roof, null, 0.05);
      // fountain
      k.cyl(hx, D / 2 - 3, 1.8, 0, 0.6, 12, T.CONCRETE, col(0xe0dcd2), col(0x6aa9d8));
      k.cyl(hx, D / 2 - 3, 0.3, 0.6, 2.2, 8, T.CONCRETE, col(0xe0dcd2));
      k.emit('steam', hx, 2.4, D / 2 - 3);
    }
    if (r() < 0.6) flagpole(k, -W / 2 + 1.2, D / 2 - 1.5, r);
    height = H + (big ? 5 : 3.5);
    label = big
      ? pick(r, ["Megachurch Pastor's Compound", 'Crypto Bro Compound', 'Supplement Influencer Estate', 'Gated Community of One'])
      : pick(r, ['McMansion (Brick Front Only)', 'The Estates at Possum Creek', 'Luxury Starter Castle', '5-Bed, 7-Bath, 0 Books']);
  }
  return { geometry: k.build(), height, label, emitters: k.emitters };
}

// ------------------------------------------------------------------ residential high
function resHigh(s: LotSpec, r: Rnd, W: number, D: number): BuildingModel {
  const k = new Kit();
  const L = s.level;
  paved(k, W, D);
  const bw = W - 3, front = D / 2 - 1.5;
  let height = 8, label = '';
  const bd = L <= 2 ? Math.min(12, D - 11) : D - 5;
  const bz = L <= 2 ? -D / 2 + 1.5 + bd / 2 : 0;
  if (L === 1) {
    // motel-style walk-up with an exterior walkway and a lot out front
    const c = col(pick(r, STUCCO));
    k.box(0, bz, bw, bd, 0, 6, [T.APT_WIN, T.STUCCO, T.STUCCO, T.STUCCO], c, T.ROOF_FLAT, col(0x9a9a98), { fit: true, floors: 2 });
    k.box(0, bz + bd / 2 + 0.9, bw, 1.8, 2.9, 3.1, T.CONCRETE, col(0xc8c4bc), T.CONCRETE, col(0xc8c4bc), { ao: false });
    k.box(0, bz + bd / 2 + 1.75, bw, 0.08, 3.1, 4.1, T.SOLID, col(0x3a3a3a), T.SOLID);
    k.box(bw / 2 - 1, bz + bd / 2 + 2.6, 1.2, 3.2, 0, 3, T.SOLID, col(0x6a6a6a), T.CONCRETE);
    parapet(k, 0, bz, bw, bd, 6, c, 0.6);
    parking(k, -W / 2 + 0.8, bz + bd / 2 + 3, W / 2 - 0.8, front, r, 0.6);
    k.emit('cigarette', -bw / 2 + 2, 4.5, bz + bd / 2 + 1.2);
    height = 7;
    label = pick(r, ['Budget Inn Apartments', 'Weekly Rates Available', 'The Motel (Permanent)']);
  } else if (L === 2) {
    const c = r() < 0.5 ? col(pick(r, SIDING)) : col(pick(r, BRICK));
    const wt = T.APT_WIN;
    k.box(0, bz, bw, bd, 0, 9, wt, c, null, undefined, { fit: true, floors: 3 });
    k.gable(0, bz, bw, bd, 9, 3, true, col(pick(r, ROOFS)), c, T.SIDING);
    for (let f = 1; f < 3; f++)
      for (let i = 0; i < Math.floor(bw / 6.8); i++) k.box(-bw / 2 + 3.4 + i * 6.8, bz + bd / 2 + 0.7, 2.6, 1.4, f * 3, f * 3 + 0.15, T.CONCRETE, col(0xbdb8ae), T.CONCRETE);
    parking(k, -W / 2 + 0.8, bz + bd / 2 + 2.5, W / 2 - 0.8, front, r, 0.65);
    k.sign(W / 2 - 3, 1.1, D / 2 - 1, 3.6, 0.9, 'nowLeasing', 0, true);
    height = 12;
    label = pick(r, ['Creekside Garden Apartments', 'The Oaks (No Oaks)', 'Pheasant Run Apts', 'Willow Bend Apartments']);
  } else if (L === 3) {
    // the 5-over-1 "podium" special
    const floors = 5;
    const H = 4.5 + 4 * 3;
    k.box(0, bz, bw, bd, 0, 4.5, [T.STORE, T.STUCCO, T.STUCCO, T.STUCCO], col(0x3a3d42), null, undefined, { fit: true });
    const n = Math.max(2, Math.round(bw / 7));
    for (let i = 0; i < n; i++) {
      const x0 = -bw / 2 + (i * bw) / n, x1 = -bw / 2 + ((i + 1) * bw) / n;
      const c = col(pick(r, PANEL));
      k.wall(x0, bz + bd / 2, x1, bz + bd / 2, 4.5, H, T.PANEL, c, { floors: 4, ao: false });
    }
    k.wall(bw / 2, bz + bd / 2, bw / 2, bz - bd / 2, 4.5, H, T.PANEL, col(pick(r, PANEL)), { floors: 4, fit: true, ao: false });
    k.wall(bw / 2, bz - bd / 2, -bw / 2, bz - bd / 2, 4.5, H, T.PANEL, col(pick(r, PANEL)), { floors: 4, fit: true, ao: false });
    k.wall(-bw / 2, bz - bd / 2, -bw / 2, bz + bd / 2, 4.5, H, T.PANEL, col(pick(r, PANEL)), { floors: 4, fit: true, ao: false });
    k.slab(-bw / 2, bz - bd / 2, bw / 2, bz + bd / 2, H, T.ROOF_FLAT, col(0xa8a8a6));
    parapet(k, 0, bz, bw, bd, H, col(0x2f3134), 0.8);
    acUnits(k, -bw / 2, bz - bd / 2, bw / 2, bz + bd / 2, H, r, 5);
    k.sign(0, H - 1.5, bz + bd / 2 + 0.1, 7, 1.75, pick(r, ['nowLeasing', 'luxury']), 0, false);
    const b = brandFor({ ...s, zone: 'comLow' }, r);
    if (b) k.sign(-bw / 4, 3.8, bz + bd / 2 + 0.25, 5, 1.25, b.id, 0, false);
    height = H + 1;
    label = pick(r, ['The Mercer (5-over-1)', 'The Vue @ Creekside', 'Luxe on Main*', 'The Standard (Wood Frame)']);
  } else {
    // towers
    const floors = L === 4 ? 10 : 24;
    const podH = L === 4 ? 4.5 : 9;
    const glass = L === 5 || r() < 0.4;
    const tw = bw - (L === 5 ? 4 : 2), td = bd - (L === 5 ? 6 : 3);
    k.box(0, bz, bw, bd, 0, podH, [T.STORE, T.OFFICE_WIN, T.OFFICE_WIN, T.OFFICE_WIN], col(0x6b6e73), T.ROOF_FLAT, col(0x9a9a98), { fit: true });
    const top = podH + floors * 3;
    k.box(0, bz - 0.5, tw, td, podH, top, glass ? T.GLASS : T.APT_WIN, glass ? col(0xffffff) : col(pick(r, STUCCO)), T.ROOF_FLAT, col(0x9a9a98), { fit: true, floors: glass ? floors * 0.75 : floors });
    for (let f = 1; f < floors; f += 1) if (!glass) k.box(0, bz - 0.5 + td / 2 + 0.6, tw * 0.7, 1.2, podH + f * 3, podH + f * 3 + 0.15, T.CONCRETE, col(0xbdb8ae), T.CONCRETE, undefined, { ao: false });
    // roof: mechanical penthouse + water tank / crown
    k.box(0, bz - 0.5, tw * 0.4, td * 0.4, top, top + 3.5, T.METAL, col(0x9aa0a6), T.ROOF_FLAT);
    if (L === 5) {
      k.box(0, bz - 0.5, tw + 0.4, td + 0.4, top, top + 4, T.GLASS, col(0xffffff), null, undefined, { ao: false });
      k.sign(0, top + 2, bz - 0.5 + td / 2 + 0.3, Math.min(tw - 2, 14), 3.2, 'luxury', 0, false);
    } else k.cyl(tw / 4, bz - 0.5, 1.6, top + 3.5, top + 7, 10, T.SOLID, col(0x6a4a3a), col(0x5a3a2a));
    k.emit('steam', 0, top + 4, bz - 0.5);
    height = top + 5;
    label = L === 4 ? pick(r, ['The Pinnacle', 'Riverview Tower (No River View)', 'Sky Lofts']) : pick(r, ['Slop Tower', 'The Billionaire Needle', 'One Slopmerica Plaza']);
  }
  return { geometry: k.build(), height, label, emitters: k.emitters };
}

// ------------------------------------------------------------------ commercial low
function comLow(s: LotSpec, r: Rnd, W: number, D: number): BuildingModel {
  const k = new Kit();
  const L = s.level;
  const b = brandFor(s, r);
  const bid = b?.id ?? 'dollarColonel';
  const kind = b?.kind ?? 'retail';
  const primary = col(b?.colors[0] ?? '#cccccc');
  paved(k, W, D);
  let height = 6;
  let label = b?.name ?? 'Store';

  if (kind === 'gas') {
    const big = L >= 4;
    const sw = Math.min(W - 4, big ? 24 : 12), sd = big ? 12 : 8;
    const sz = -D / 2 + 1 + sd / 2;
    k.box(0, sz, sw, sd, 0, big ? 6 : 4.6, [T.STORE, T.STUCCO, T.STUCCO, T.STUCCO], col(0xe8e2d6), T.ROOF_FLAT, col(0x9a9a98), { fit: true });
    k.box(0, sz + sd / 2 - 0.4, sw, 0.8, big ? 4.8 : 3.6, big ? 6.4 : 4.9, T.SOLID, primary, T.SOLID, undefined, { ao: false });
    k.sign(0, big ? 5.6 : 4.25, sz + sd / 2 + 0.05, Math.min(sw - 2, big ? 12 : 7), big ? 1.6 : 1.1, bid, 0, false);
    // canopy + pumps
    const cw = Math.min(W - 3, 8 + L * 4), cd = 9, cz = sz + sd / 2 + 3.5 + cd / 2;
    if (cz + cd / 2 < D / 2 - 0.5) {
      k.box(0, cz, cw, cd, 4.9, 5.7, T.SOLID, primary, T.SOLID, col(0xf2f2f2), { bottom: true, ao: false });
      k.sign(0, 5.3, cz + cd / 2 + 0.05, Math.min(cw - 1, 7), 0.75, bid, 0, false);
      const pumps = Math.max(1, Math.floor(cw / 5));
      for (let i = 0; i < pumps; i++) {
        const px = -cw / 2 + (i + 0.5) * (cw / pumps);
        k.box(px, cz, 0.9, 2.4, 0, 0.25, T.CONCRETE, col(0xd8d4cc), T.CONCRETE);
        k.box(px, cz, 0.7, 1.1, 0.25, 1.9, T.SOLID, col(0xf2f2f2), T.SOLID, primary);
        k.box(px, cz, 0.3, 0.3, 0.25, 4.9, T.SOLID, col(0xdcdcdc), null);
        if (r() < 0.6) k.car(px + 2.2, cz, r() < 0.5 ? 0 : Math.PI, col(pick(r, CARS)), carKind(r));
      }
    }
    k.pylon(W / 2 - 2, D / 2 - 1.5, big ? 14 : 8, big ? 5 : 3.6, big ? 1.8 : 1.3, bid, -0.3);
    k.hcyl(-sw / 2 + 2, 0.9, sz + sd / 2 + 1, 0.55, 2.2, 8, col(0xf2f2f2));
    height = big ? 16 : 10;
    label = big ? `${b?.name ?? 'Gas'} Travel Plaza` : `${b?.name ?? 'Gas'} #${10 + Math.floor(r() * 890)}`;
  } else if (kind === 'food' || kind === 'coffee') {
    const small = kind === 'coffee';
    const rw = Math.min(W - 6, small ? 9 : 13), rd = small ? 7 : 10;
    const rx = -W / 2 + 2 + rw / 2, rz = -D / 2 + 3 + rd / 2;
    k.box(rx, rz, rw, rd, 0, 4.2, [T.STORE, T.STORE, T.STUCCO, T.STORE], col(pick(r, STUCCO)), T.ROOF_FLAT, col(0x9a9a98), { fit: true });
    // brand-color mansard band
    k.box(rx, rz, rw + 0.6, rd + 0.6, 4.2, 5.4, T.SOLID, primary, T.ROOF_FLAT, col(0x8a8a88), { ao: false });
    k.sign(rx, 4.8, rz + rd / 2 + 0.35, Math.min(rw - 1, 7), 1.05, bid, 0, false);
    k.box(rx + rw / 4, rz, 1.2, 1.2, 5.4, 6.3, T.METAL, col(0xb9bcc0), T.SOLID);
    k.emit(kind === 'food' ? 'smoke' : 'steam', rx + rw / 4, 6.6, rz);
    // drive-thru lane + menu board
    k.slab(rx + rw / 2 + 0.5, -D / 2 + 1, rx + rw / 2 + 4, D / 2 - 3, 0.07, T.CONCRETE, col(0xbfbab0));
    k.box(rx + rw / 2 + 4.6, rz - rd / 2, 0.3, 1.8, 0, 2, T.SOLID, col(0x2a2a2a), T.SOLID);
    for (let i = 0; i < 3; i++) if (r() < 0.8) k.car(rx + rw / 2 + 2.2, rz - rd / 2 + 1 + i * 5.5, 0, col(pick(r, CARS)), carKind(r));
    const px0 = rx + rw / 2 + 5.5;
    if (W / 2 - px0 > 3) parking(k, px0, -D / 2 + 1, W / 2 - 0.6, D / 2 - 1, r, 0.6);
    else parking(k, -W / 2 + 0.6, rz + rd / 2 + 1.5, rx + rw / 2, D / 2 - 1, r, 0.6);
    k.pylon(W / 2 - 2, D / 2 - 1.5, 9 + L, 3.8, 1.3, bid, 0.25);
    if (b?.id === 'waffleBunker') k.sign(rx - rw / 4, 2.9, rz + rd / 2 + 0.1, 3, 0.75, 'open247', 0, false);
    height = 11 + L;
    label = kind === 'coffee' ? `${b?.name} Drive-Thru` : b?.id === 'waffleBunker' ? 'Waffle Bunker (Open 24/7)' : `${b?.name}`;
  } else if (kind === 'storage') {
    const rows = Math.max(2, Math.floor((W - 4) / 8));
    for (let i = 0; i < rows; i++) {
      const x = -W / 2 + 4 + i * 8;
      const len = D - 6;
      k.box(x, -1, 4.2, len, 0, 3, T.METAL, col(0xe6e2da), T.METAL, col(0xa8abae));
      const n = Math.floor(len / 3.4);
      for (let j = 0; j < n; j++) {
        const z = -1 - len / 2 + 1.7 + j * 3.4;
        k.quad([x + 2.12, 0.05, z + 1.4], [x + 2.12, 0.05, z - 1.4], [x + 2.12, 2.5, z - 1.4], [x + 2.12, 2.5, z + 1.4], [[0, 0], [1, 0], [1, 1], [0, 1]], col(0xf26522), T.GARAGE);
      }
    }
    k.pylon(-W / 2 + 2, D / 2 - 1.5, 7, 4.4, 1.2, bid, 0.2);
    height = 9;
    label = b?.name ?? 'Self Storage';
  } else if (kind === 'propane') {
    const sw = Math.min(W - 6, 10), sd = 7, sz = -D / 2 + 2 + sd / 2;
    k.box(-W / 2 + 1.5 + sw / 2, sz, sw, sd, 0, 4, [T.STORE, T.METAL, T.METAL, T.METAL], col(0xe8e8e8), T.METAL, col(0xa8abae), { fit: true });
    k.sign(-W / 2 + 1.5 + sw / 2, 3.4, sz + sd / 2 + 0.05, Math.min(sw - 1, 7), 1, bid, 0, false);
    const tanks = 2 + L;
    for (let i = 0; i < tanks; i++) k.hcyl(W / 2 - 5, 1.3, -D / 2 + 3 + i * 3, 1.1, 6, 10, col(0xf4f4f2));
    k.box(W / 2 - 5, -D / 2 + 1.5 + tanks * 1.5, 8, tanks * 3 + 1, 0, 2, T.SOLID, col(0x9aa0a6), null);
    k.pylon(W / 2 - 2, D / 2 - 1.5, 7, 3.8, 1.2, bid, -0.2);
    height = 9;
    label = `${b?.name ?? 'Propane'} (and Propane Accessories)`;
  } else if (kind === 'auto') {
    const sw = Math.min(W - 4, 16), sd = 10;
    k.box(0, -D / 2 + 2 + sd / 2, sw, sd, 0, 5.5, [T.GLASS, T.GLASS, T.METAL, T.GLASS], col(0xffffff), T.ROOF_FLAT, col(0x9a9a98), { fit: true, floors: 1.4 });
    k.sign(0, 4.9, -D / 2 + 2 + sd + 0.05, Math.min(sw - 2, 9), 1.2, bid, 0, false);
    parking(k, -W / 2 + 0.6, -D / 2 + sd + 3, W / 2 - 0.6, D / 2 - 0.6, r, 0.95);
    k.pylon(W / 2 - 2, D / 2 - 1.2, 10, 4.2, 1.4, bid, 0);
    height = 11;
    label = b?.name ?? 'Car Lot';
  } else if (L >= 3 && (kind === 'grocery' || kind === 'retail' || kind === 'fitness')) {
    // big box + a sea of parking
    const bw = W - 4, bd = Math.min(D * 0.55, 22);
    const bz = -D / 2 + 1.5 + bd / 2;
    const h = 7 + L;
    k.box(0, bz, bw, bd, 0, h, [T.STUCCO, T.METAL, T.METAL, T.METAL], col(pick(r, STUCCO)), T.ROOF_FLAT, col(0xa0a09e));
    k.box(0, bz + bd / 2 - 1, Math.min(14, bw * 0.5), 2.2, 0, h + 1.5, T.STORE, col(0xd8d2c6), T.SOLID, undefined, { fit: true });
    k.box(0, bz + bd / 2 + 1.2, Math.min(14, bw * 0.5), 2.6, 3.6, 4, T.SOLID, primary, T.SOLID, undefined, { bottom: true });
    k.sign(0, h - 1.2, bz + bd / 2 + 0.2, Math.min(bw * 0.6, 16), 2.4, bid, 0, false);
    parapet(k, 0, bz, bw, bd, h, col(pick(r, STUCCO)), 1);
    acUnits(k, -bw / 2, bz - bd / 2, bw / 2, bz + bd / 2, h, r, 4);
    parking(k, -W / 2 + 0.6, bz + bd / 2 + 3, W / 2 - 0.6, D / 2 - 0.6, r, 0.55 + L * 0.06);
    for (let i = 0; i < 2; i++) k.box(-bw / 4 + i * bw / 2, bz + bd / 2 + 8, 0.9, 3.2, 0, 1.1, T.METAL, col(0xc0c4c8), null);
    height = h + 2;
    label = L === 5 ? `${b?.name ?? 'Store'} Supercenter` : `${b?.name ?? 'Store'}`;
  } else {
    // strip mall: a row of shops with sign bands, parking in front
    const bw = W - 3, bd = Math.min(12, D - 10), bz = -D / 2 + 1.5 + bd / 2;
    const h = 5 + (L >= 2 ? 0.8 : 0);
    k.box(0, bz, bw, bd, 0, h, [T.STORE, T.STUCCO, T.STUCCO, T.STUCCO], col(pick(r, STUCCO)), T.ROOF_FLAT, col(0x9a9a98), { fit: true });
    k.box(0, bz + bd / 2 + 1.6, bw, 3.2, 3.9, 4.25, T.SOLID, col(0x6a5a4a), T.SHINGLE, col(0x6a5a4a), { bottom: true, ao: false });
    for (const [px, pz] of [[-bw / 2 + 0.3, bz + bd / 2 + 3], [bw / 2 - 0.3, bz + bd / 2 + 3]]) k.box(px, pz, 0.3, 0.3, 0, 3.9, T.SOLID, col(0xe0dcd2), null);
    const bays = Math.max(1, Math.round(bw / 8));
    const others = BRANDS.filter((x) => x.zones.includes('comLow') && x.kind !== 'gas' && x.id !== bid);
    for (let i = 0; i < bays; i++) {
      const x = -bw / 2 + (i + 0.5) * (bw / bays);
      const id = i === Math.floor(bays / 2) ? bid : pick(r, others).id;
      k.sign(x, h - 0.45, bz + bd / 2 + 0.05, Math.min(bw / bays - 1, 6), 1, id, 0, false);
      if (r() < 0.3) k.emit('cigarette', x + 1.5, 1.6, bz + bd / 2 + 1.5);
    }
    parapet(k, 0, bz, bw, bd, h, col(pick(r, STUCCO)), 0.7);
    parking(k, -W / 2 + 0.6, bz + bd / 2 + 3.5, W / 2 - 0.6, D / 2 - 0.6, r, 0.45 + L * 0.08);
    if (kind === 'bar' || kind === 'smoke') k.emit('cigarette', -bw / 4, 1.6, bz + bd / 2 + 1);
    k.pylon(-W / 2 + 1.8, D / 2 - 1.5, 8, 3.6, 1.2, bid, 0.2);
    height = 9;
    label = kind === 'bar' ? `${b?.name}` : bays > 2 ? `${b?.name ?? 'Shops'} Plaza` : `${b?.name ?? 'Shop'}`;
  }
  return { geometry: k.build(), height, label, brand: b?.id, emitters: k.emitters };
}

// ------------------------------------------------------------------ commercial high
function comHigh(s: LotSpec, r: Rnd, W: number, D: number): BuildingModel {
  const k = new Kit();
  const L = s.level;
  const b = brandFor(s, r);
  const bid = b?.id ?? 'mallWart';
  const primary = col(b?.colors[0] ?? '#888888');
  paved(k, W, D);
  const floors = [3, 5, 8, 14, 22][L - 1];
  const pw = W - 3, pd = D - 6, pz = -1.5;
  const podH = 5;
  const resort = b?.kind === 'resort';
  k.box(0, pz, pw, pd, 0, podH, [T.STORE, T.STORE, T.STUCCO, T.STORE], resort ? col(0xf6d6e2) : col(pick(r, STUCCO)), T.ROOF_FLAT, col(0x9a9a98), { fit: true });
  k.box(0, pz + pd / 2 + 1.5, pw, 3, 4, 4.3, T.SOLID, primary, T.SOLID, undefined, { bottom: true, ao: false });
  k.sign(0, podH - 0.6, pz + pd / 2 + 0.05, Math.min(pw * 0.6, 12), 1.5, bid, 0, false);
  const tw = L >= 3 ? pw - 6 : pw - 2, td = L >= 3 ? pd - 6 : pd - 2;
  const top = podH + floors * 3.6;
  const glassy = L >= 3 || r() < 0.4;
  const tc = resort ? col(0xffe4ee) : glassy ? col(0xffffff) : col(pick(r, STUCCO));
  k.box(0, pz - 1, tw, td, podH, top, glassy ? T.GLASS : T.OFFICE_WIN, tc, T.ROOF_FLAT, col(0x9a9a98), { fit: true, floors: glassy ? floors * 0.9 : floors * 0.9 });
  if (resort) {
    // rooftop pool on the podium
    k.slab(-pw / 2 + 1, pz + td / 2, pw / 2 - 1, pz + pd / 2 - 1, podH + 0.05, T.CONCRETE, col(0xf0e8e0));
    k.slab(-pw / 4, pz + td / 2 + 0.6, pw / 4, pz + pd / 2 - 1.8, podH + 0.08, T.WATER, col(0xffffff));
  }
  k.box(0, pz - 1, tw * 0.45, td * 0.45, top, top + 4, T.METAL, col(0x9aa0a6), T.ROOF_FLAT);
  if (L >= 3) {
    // rooftop billboard frame facing the road
    k.box(0, pz - 1 + td / 2 - 1, Math.min(tw - 2, 14), 0.4, top, top + 1.5, T.SOLID, col(0x444444), T.SOLID);
    k.sign(0, top + 3.2, pz - 1 + td / 2 - 0.7, Math.min(tw - 2, 14), 3.4, bid, 0, false, col(0x333333));
  }
  k.emit('steam', 0, top + 4.3, pz - 1);
  const height = top + (L >= 3 ? 5.5 : 4.5);
  const label = resort ? `${b?.name} Resort & Tower` : L >= 4 ? `${b?.name ?? 'The'} Galleria Tower` : `${b?.name ?? 'Main St'} Center`;
  return { geometry: k.build(), height, label, brand: b?.id, emitters: k.emitters };
}

// ------------------------------------------------------------------ industry
function industry(s: LotSpec, r: Rnd, W: number, D: number): BuildingModel {
  const k = new Kit();
  const L = s.level;
  const b = brandFor(s, r);
  const bid = b?.id ?? 'frackCo';
  k.slab(-W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, D / 2 - 0.2, 0.045, L <= 2 ? T.DIRT : T.CONCRETE, col(L <= 2 ? 0xd8c8b0 : 0xffffff));
  const metal = col(pick(r, METAL));
  let height = 10;
  let label = b?.name ?? 'Industrial';
  if (L <= 2) {
    const hw = W - 5, hd = Math.min(D * 0.55, 20), hz = -D / 2 + 2 + hd / 2;
    const h = L === 1 ? 6 : 9;
    k.box(0, hz, hw, hd, 0, h, [T.DOCK, T.METAL, T.METAL, T.METAL], metal, T.METAL, col(0xa8acb0), { fit: true, floors: h / 4.5 });
    k.gable(0, hz, hw, hd, h, 1.2, true, col(0x8f969c), metal, T.METAL, 0.3);
    k.sign(-hw / 4, h - 1.2, hz + hd / 2 + 0.06, Math.min(hw * 0.4, 8), 1.4, bid, 0, false);
    const n = Math.max(1, Math.round(hw / 4));
    for (let i = 0; i < n; i++) if (r() < (L === 1 ? 0.3 : 0.6)) {
      // semi trailer backed into a dock
      const x = -hw / 2 + (i + 0.5) * (hw / n);
      k.box(x, hz + hd / 2 + 7.5, 2.5, 13, 1.1, 4, T.SOLID, col(pick(r, [0xf2f2f2, 0xe8e8e8, 0xc9d3d8])), T.SOLID);
      k.box(x, hz + hd / 2 + 7.5, 2.2, 12, 0.3, 1.1, T.SOLID, col(0x222222), null);
    }
    k.car(W / 2 - 2, D / 2 - 3, 0, col(pick(r, CARS)), 'pickup');
    height = h + 2;
    label = L === 1 ? `${b?.name ?? 'Machine'} Shop` : `${b?.name ?? 'Regional'} Warehouse`;
  } else if (L <= 4 && b?.id !== 'slopmazon') {
    // factory: sawtooth hall + stacks (+ tanks at L4)
    const hw = W - 6, hd = Math.min(D * 0.5, 22), hz = -D / 2 + 2 + hd / 2;
    k.box(0, hz, hw, hd, 0, 8, [T.OFFICE_WIN, T.BRICK, T.BRICK, T.BRICK], col(pick(r, BRICK)), null, undefined, { fit: true, floors: 2 });
    const teeth = Math.max(2, Math.round(hd / 5));
    for (let i = 0; i < teeth; i++) {
      const z0 = hz - hd / 2 + (i * hd) / teeth, z1 = z0 + hd / teeth;
      k.quad([hw / 2, 8, z1], [-hw / 2, 8, z1], [-hw / 2, 10.5, z0 + 0.01], [hw / 2, 10.5, z0 + 0.01], [[0, 0], [hw / 3, 0], [hw / 3, 1], [0, 1]], col(0x8a8f94), T.METAL);
      k.quad([-hw / 2, 8, z0], [hw / 2, 8, z0], [hw / 2, 10.5, z0], [-hw / 2, 10.5, z0], [[0, 0], [hw / 4, 0], [hw / 4, 0.6], [0, 0.6]], col(0xffffff), T.OFFICE_WIN);
    }
    k.sign(0, 6.5, hz + hd / 2 + 0.06, Math.min(hw * 0.5, 12), 1.8, bid, 0, false);
    const stacks = L === 3 ? 1 : 2;
    for (let i = 0; i < stacks; i++) {
      const sx = hw / 2 - 2 - i * 4, sz = hz - hd / 2 + 2;
      const sh = 20 + L * 5;
      k.cyl(sx, sz, 1.3, 0, sh, 10, T.BRICK, col(0x8a4a3a), col(0x2a2a2a), 1.0);
      k.cyl(sx, sz, 1.05, sh - 1.5, sh - 0.5, 10, T.SOLID, col(0xd8d8d8), null, 1.05);
      k.emit('smoke', sx, sh + 1, sz);
    }
    if (L === 4) {
      for (let i = 0; i < 3; i++) {
        const tx = -W / 2 + 5 + i * 8.5, tz = D / 2 - 7;
        if (tx > W / 2 - 4) break;
        k.cyl(tx, tz, 3.6, 0, 9, 14, T.METAL, col(0xe8ecef), col(0xd0d4d8));
      }
      if (b?.id === 'frackCo') {
        k.cyl(W / 2 - 3, D / 2 - 3, 0.35, 0, 24, 6, T.SOLID, col(0x8a8f94));
        k.emit('fire', W / 2 - 3, 24.5, D / 2 - 3);
      }
    }
    k.car(-W / 2 + 3, D / 2 - 3, 0, col(pick(r, CARS)), 'pickup');
    height = 20 + L * 5;
    label = L === 3 ? `${b?.name ?? 'Industrial'} Plant` : `${b?.name ?? 'Industrial'} Works`;
  } else {
    // mega distribution center / fulfillment slop
    const hw = W - 3, hd = D - 14, hz = -D / 2 + 1.5 + hd / 2;
    const h = 13;
    k.box(0, hz, hw, hd, 0, h, [T.DOCK, T.METAL, T.METAL, T.METAL], col(0xd6d8da), T.ROOF_FLAT, col(0xb0b2b4), { fit: true, floors: h / 4.5 });
    k.box(-hw / 2 + 5, hz + hd / 2 + 0.5, 10, 1, 0, h + 1.5, T.GLASS, col(0xffffff), T.SOLID, undefined, { fit: true });
    k.sign(hw / 6, h - 2.5, hz + hd / 2 + 0.06, Math.min(hw * 0.5, 18), 3.2, bid, 0, false);
    acUnits(k, -hw / 2, hz - hd / 2, hw / 2, hz + hd / 2, h, r, 8);
    const n = Math.floor(hw / 4);
    for (let i = 0; i < n; i++) if (r() < 0.7) {
      const x = -hw / 2 + (i + 0.5) * (hw / n);
      k.box(x, hz + hd / 2 + 7, 2.5, 13, 1.1, 4, T.SOLID, col(pick(r, [0xf2f2f2, 0x232f3e, 0xe8e8e8])), T.SOLID);
    }
    height = h + 3;
    label = b?.id === 'slopmazon' ? 'Slopmazon Fulfillment Center (Unionize Me)' : `${b?.name ?? 'Mega'} Distribution Center`;
  }
  return { geometry: k.build(), height, label, brand: b?.id, emitters: k.emitters };
}

// ------------------------------------------------------------------ office
function office(s: LotSpec, r: Rnd, W: number, D: number): BuildingModel {
  const k = new Kit();
  const L = s.level;
  const b = brandFor(s, r);
  const bid = b?.id ?? 'synergyPlex';
  paved(k, W, D);
  const floors = [2, 3, 6, 12, 30][L - 1];
  const fh = 4;
  const bw = Math.min(W - 4, L >= 4 ? W - 6 : 18), bd = L <= 2 ? Math.min(12, D - 10) : D - 7;
  const bz = L <= 2 ? -D / 2 + 1.5 + bd / 2 : -1;
  const glass = L >= 2;
  const wallC = glass ? col(0xffffff) : col(pick(r, BRICK));
  let top = floors * fh;
  if (L < 5) {
    k.box(0, bz, bw, bd, 0, top, glass ? T.GLASS : T.OFFICE_WIN, wallC, T.ROOF_FLAT, col(0x9a9a98), { fit: true, floors: glass ? floors : floors });
  } else {
    // setback skyscraper: three tiers + spire
    const tiers = [[bw, bd, 12], [bw * 0.78, bd * 0.78, 22], [bw * 0.56, bd * 0.56, 30]] as const;
    let y0 = 0;
    for (const [tw, td, f] of tiers) {
      const y1 = f * fh;
      k.box(0, bz, tw, td, y0, y1, T.GLASS, wallC, T.ROOF_FLAT, col(0x8a8a88), { fit: true, floors: (y1 - y0) / fh });
      y0 = y1;
    }
    k.cyl(0, bz, 0.5, top, top + 22, 8, T.SOLID, col(0xc8ccd0), null, 0.08);
    k.emit('sparkle', 0, top + 22, bz);
  }
  if (L <= 2) {
    // lobby canopy + monument sign + surface lot
    k.box(0, bz + bd / 2 + 1.2, 6, 2.4, 3.2, 3.5, T.SOLID, col(0x3a3d42), T.SOLID, undefined, { bottom: true, ao: false });
    k.box(W / 2 - 4, D / 2 - 1.8, 4.2, 0.8, 0, 1.4, T.STUCCO, col(0xd8d2c6), T.SOLID);
    k.sign(W / 2 - 4, 0.85, D / 2 - 1.35, 3.8, 0.95, bid, 0, false);
    parking(k, -W / 2 + 0.6, bz + bd / 2 + 3, W / 2 - 0.6, D / 2 - 3, r, 0.6);
  } else {
    k.sign(0, top - 2.2, bz + (L < 5 ? bd : bd * 0.56) / 2 + 0.06, Math.min(bw * 0.5, 12), 2.2, bid, 0, false);
    k.box(0, bz + bd / 2 + 1.5, 8, 3, 0, 4.5, T.GLASS, col(0xffffff), T.SOLID, undefined, { fit: true });
  }
  acUnits(k, -bw / 4, bz - bd / 4, bw / 4, bz + bd / 4, top, r, L >= 3 ? 3 : 2);
  k.emit('steam', 0, top + 1.5, bz);
  const height = top + (L === 5 ? 22 : 2);
  const label = L === 5 ? `${b?.name ?? 'Corporate'} Tower` : L >= 3 ? `${b?.name ?? 'Corporate'} HQ` : `${b?.name ?? 'Office'} Office Park`;
  return { geometry: k.build(), height, label, brand: b?.id, emitters: k.emitters };
}

// ------------------------------------------------------------------ entry points
export function generateBuilding(spec: LotSpec): BuildingModel {
  const W = spec.widthCells * CELL, D = spec.depthCells * CELL;
  const r = mulberry32(spec.seed * 2654435761 + spec.level * 97 + (spec.brand ? spec.brand.length * 131 : 0));
  const byZone: Record<ZoneType, (s: LotSpec, r: Rnd, W: number, D: number) => BuildingModel> = { resLow, resHigh, comLow, comHigh, industry, office };
  return byZone[spec.zone](spec, r, W, D);
}

const LANDMARK_FP: Record<LandmarkId, [number, number]> = {
  slopCannon: [4, 4], slop69Field: [7, 7], pigCabanaResort: [6, 5], neuralFlyDatacenter: [6, 5],
  propaneParadise: [4, 4], fillErUpMegaStation: [6, 5], megachurch: [6, 6], waterTower: [2, 2],
};

export function landmarkFootprint(id: LandmarkId): { widthCells: number; depthCells: number } {
  const [w, d] = LANDMARK_FP[id] ?? [4, 4];
  return { widthCells: w, depthCells: d };
}

export function generateLandmark(id: LandmarkId, seed: number): BuildingModel {
  const [wc, dc] = LANDMARK_FP[id] ?? [4, 4];
  const W = wc * CELL, D = dc * CELL;
  const r = mulberry32(seed * 7919 + id.length * 31);
  const k = new Kit();
  let height = 20;
  let label: string = id;
  let brand: string | undefined;
  switch (id) {
    case 'slopCannon': {
      paved(k, W, D);
      k.box(0, -2, 16, 12, 0, 3, T.CONCRETE, col(0x8a8a88), T.CONCRETE);
      // barrel pointed at the sky over the road
      const n = 14, len = 26, rad = 2.6;
      k.at(0, -2, 0, () => {
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
          const tilt = 0.75;
          const P = (a: number, t: number, rr: number): [number, number, number] => {
            const lx = Math.cos(a) * rr, ly = Math.sin(a) * rr;
            const zz = t * len;
            return [lx, 4 + ly * Math.cos(tilt) + zz * Math.sin(tilt), ly * Math.sin(tilt) * -1 + zz * Math.cos(tilt) - 6];
          };
          const c = col(0x2a2a2a);
          k.quad(P(a1, 0, rad * 1.25), P(a0, 0, rad * 1.25), P(a0, 1, rad), P(a1, 1, rad), [[0, 0], [1, 0], [1, 1], [0, 1]], c, T.METAL);
        }
      });
      k.cyl(-5, -4, 3.2, 0, 1.2, 12, T.METAL, col(0x5a3a1a), col(0x3a2a1a));
      k.cyl(5, -4, 3.2, 0, 1.2, 12, T.METAL, col(0x5a3a1a), col(0x3a2a1a));
      k.pylon(0, D / 2 - 2, 7, 8, 1.4, 'getInCannon');
      k.sign(0, 2, 4.05, 10, 1.6, 'slop', 0, false);
      k.emit('sparkle', 0, 25, 12);
      height = 26;
      label = 'The Slop Cannon';
      brand = 'slop';
      break;
    }
    case 'slop69Field': {
      k.slab(-W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, D / 2 - 0.2, 0.04, T.LAWN, col(0x6fae4a));
      // infield dirt diamond
      k.at(0, 4, Math.PI / 4, () => k.slab(-9, -9, 9, 9, 0.06, T.DIRT, col(0xffffff)));
      k.at(0, 4, Math.PI / 4, () => k.slab(-6.5, -6.5, 6.5, 6.5, 0.07, T.LAWN, col(0x7fbe5a)));
      // stands on two sides
      for (const side of [-1, 1]) {
        for (let t = 0; t < 5; t++) k.box(side * (W / 2 - 4 - t * 1.4), 0, 1.6, D - 12, t * 1.2, t * 1.2 + 1.2, T.CONCRETE, col(0xb8b4ac), T.SOLID, col(side > 0 ? 0x1d3a8a : 0xb22234));
      }
      for (const [x, z] of [[-W / 2 + 2, -D / 2 + 2], [W / 2 - 2, -D / 2 + 2], [-W / 2 + 2, D / 2 - 2], [W / 2 - 2, D / 2 - 2]]) {
        k.cyl(x, z, 0.5, 0, 26, 8, T.SOLID, col(0x9aa0a6));
        k.box(x, z, 4, 0.6, 24, 27, T.SOLID, col(0x2a2a2a), T.SOLID);
      }
      k.box(0, -D / 2 + 3, 16, 1, 6, 12, T.SOLID, col(0x1a1a1a), T.SOLID);
      k.sign(0, 9, -D / 2 + 3.55, 14, 3.5, 'slop69', 0, false);
      height = 27;
      label = 'Slop 69 Field';
      brand = 'slop69';
      break;
    }
    case 'pigCabanaResort': {
      paved(k, W, D);
      k.slab(-W / 2 + 2, -4, W / 2 - 2, D / 2 - 3, 0.06, T.CONCRETE, col(0xf3e6d8));
      k.slab(-W / 4, 0, W / 4, D / 2 - 7, 0.08, T.WATER, col(0xffffff));
      k.box(0, -D / 2 + 7, W - 6, 10, 0, 18, T.APT_WIN, col(0xffd6e6), T.ROOF_FLAT, col(0xd8a8b8), { fit: true, floors: 6 });
      k.sign(0, 16, -D / 2 + 12.1, 14, 3.4, 'pigCabana', 0, false);
      for (let i = 0; i < 6; i++) {
        const x = -W / 2 + 4 + i * ((W - 8) / 5);
        k.box(x, D / 2 - 4, 2.6, 2.6, 0, 2.6, T.SOLID, col(0xffffff), null);
        k.gable(x, D / 2 - 4, 2.6, 2.6, 2.6, 1.4, true, col(0xff9ec4), col(0xffffff), T.SOLID, 0.3);
      }
      // the pig (a very round statue)
      k.cyl(W / 2 - 7, -1, 2.4, 0, 3.2, 12, T.SOLID, col(0xffa3c4), col(0xffa3c4), 1.8);
      k.box(W / 2 - 7, 1.2, 1.4, 1.2, 1.4, 2.6, T.SOLID, col(0xff8fb5), T.SOLID);
      height = 20;
      label = 'Pig Cabana Resort & Spa';
      brand = 'pigCabana';
      break;
    }
    case 'neuralFlyDatacenter': {
      paved(k, W, D);
      k.box(0, -3, W - 4, D - 12, 0, 14, T.METAL, col(0x2a2e36), T.ROOF_FLAT, col(0x6a6e74));
      for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) {
        const x = -W / 2 + 5 + i * ((W - 10) / 7), z = -3 - (D - 12) / 2 + 4 + j * ((D - 20) / 2);
        k.cyl(x, z, 1.4, 14, 16, 10, T.METAL, col(0xa8b0b8), col(0x3a3e44));
        k.emit('steam', x, 16.5, z);
      }
      k.sign(0, 10, -3 + (D - 12) / 2 + 0.06, Math.min(W - 10, 20), 4, 'neuralFly', 0, false);
      k.sign(0, 3, -3 + (D - 12) / 2 + 0.06, Math.min(W - 10, 20), 1.6, 'datacenter', 0, false);
      parking(k, -W / 2 + 1, D / 2 - 8, W / 2 - 1, D / 2 - 1, r, 0.4);
      height = 17;
      label = 'Neural Fly Hyperscale Datacenter';
      brand = 'neuralFly';
      break;
    }
    case 'propaneParadise': {
      paved(k, W, D);
      k.box(-W / 4, -D / 2 + 7, 12, 9, 0, 5, [T.STORE, T.METAL, T.METAL, T.METAL], col(0xf6e3b8), T.ROOF_FLAT, col(0xa8a8a6), { fit: true });
      k.sign(-W / 4, 4.3, -D / 2 + 11.56, 10, 1.4, 'propaneParadise', 0, false);
      for (let i = 0; i < 5; i++) k.hcyl(W / 4, 1.6, -D / 2 + 3 + i * 3.4, 1.4, 8, 10, col(0xf4f4f2));
      k.cyl(W / 2 - 4, D / 2 - 4, 2.6, 0, 12, 12, T.SOLID, col(0xf4f4f2), col(0xf4f4f2), 0.3);
      k.pylon(-W / 2 + 3, D / 2 - 2, 10, 5, 1.6, 'myOwnPropane', 0.3);
      height = 14;
      label = 'Propane Paradise (Taste the Meat, Not the Heat)';
      brand = 'propaneParadise';
      break;
    }
    case 'fillErUpMegaStation': {
      paved(k, W, D);
      k.box(0, -D / 2 + 8, W - 8, 13, 0, 8, [T.STORE, T.STUCCO, T.STUCCO, T.STUCCO], col(0xf2ead8), T.ROOF_FLAT, col(0xa8a8a6), { fit: true });
      k.sign(0, 6.6, -D / 2 + 14.56, 18, 2.8, 'fillErUp', 0, false);
      const cw = W - 4, cz = D / 2 - 11;
      k.box(0, cz, cw, 14, 6, 7.2, T.SOLID, col(0xb3202a), T.SOLID, col(0xf2f2f2), { bottom: true });
      k.sign(0, 6.6, cz + 7.05, 12, 1.1, 'fillErUp', 0, false);
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 2; j++) {
          const px = -cw / 2 + 3 + i * ((cw - 6) / 7), pz = cz - 3.5 + j * 7;
          k.box(px, pz, 0.8, 1.2, 0, 1.9, T.SOLID, col(0xf2f2f2), T.SOLID, col(0xb3202a));
          if (r() < 0.7) k.car(px + 2, pz, r() < 0.5 ? 0 : Math.PI, col(pick(r, CARS)), carKind(r));
        }
      k.pylon(W / 2 - 3, D / 2 - 2, 22, 7, 2.4, 'fillErUp', -0.3);
      height = 24;
      label = 'Fill Er Up Mega Station (120 Pumps, 3 Bathrooms)';
      brand = 'fillErUp';
      break;
    }
    case 'megachurch': {
      paved(k, W, D);
      k.cyl(0, -4, 17, 0, 12, 24, T.STUCCO, col(0xece6da), col(0xb8b4ac), 14);
      k.box(0, 12, 14, 8, 0, 9, T.GLASS, col(0xffffff), T.ROOF_FLAT, col(0x9a9a98), { fit: true });
      k.box(0, -4, 0.8, 0.8, 12, 34, T.SOLID, col(0xf2f2f2), T.SOLID);
      k.box(0, -4, 7, 0.8, 27, 28.2, T.SOLID, col(0xf2f2f2), T.SOLID);
      k.box(0, 16.1, 12, 0.4, 5, 9, T.SOLID, col(0x111111), T.SOLID);
      k.sign(0, 7, 16.35, 11, 3.4, 'jesusSaves', 0, false);
      parking(k, -W / 2 + 1, D / 2 - 7, W / 2 - 1, D / 2 - 1, r, 0.75);
      height = 34;
      label = 'Slopstar Megachurch & Waterslide';
      break;
    }
    case 'waterTower': {
      const legs = 4;
      for (let i = 0; i < legs; i++) {
        const a = (i / legs) * Math.PI * 2 + Math.PI / 4;
        k.cyl(Math.cos(a) * 3.2, Math.sin(a) * 3.2, 0.3, 0, 24, 6, T.SOLID, col(0x9aa0a6));
      }
      k.cyl(0, 0, 0.8, 0, 24, 8, T.SOLID, col(0x9aa0a6));
      k.cyl(0, 0, 6, 24, 31, 16, T.SOLID, col(0xdfe6ec), null);
      k.cyl(0, 0, 6, 31, 34, 16, T.SOLID, col(0xdfe6ec), null, 0.4);
      k.sign(0, 27.5, 6.05, 8, 2, 'slopmerica', 0, false);
      k.sign(0, 27.5, -6.05, 8, 2, 'slopmerica', Math.PI, false);
      height = 34;
      label = 'Slopmerica Water Tower';
      break;
    }
  }
  void r;
  return { geometry: k.build(), height, label, brand, emitters: k.emitters };
}

/** Roadside billboard on a pole, facing +Z. merch=true shows a real Slop ad. */
export function generateBillboard(seed: number, merch = false): BuildingModel {
  const r = mulberry32(seed * 131 + 7);
  const k = new Kit();
  const b = merch ? pick(r, BRANDS.filter((x) => x.merch)) : pick(r, BRANDS);
  k.cyl(0, 0, 0.35, 0, 10, 8, T.SOLID, col(0x6a6e74));
  k.box(0, 0, 10.6, 0.5, 9.6, 14.4, T.SOLID, col(0x2a2c30), T.SOLID);
  k.sign(0, 12, 0.3, 10, 4.2, b.id, 0, false);
  k.sign(0, 12, -0.3, 10, 4.2, b.id, Math.PI, false);
  return { geometry: k.build(), height: 14.5, label: `${b.name} billboard`, brand: b.id, emitters: [] };
}
