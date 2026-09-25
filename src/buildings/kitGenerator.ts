// Kit geometry support: the texture-array facade material used by communes,
// city service buildings and construction scaffolds, plus the scaffold model.
// (Zoned buildings, landmarks and billboards come from generator.ts, which has
// its own atlas material; the two geometry formats can't share a batch.)
import * as THREE from 'three';
import { CELL } from '../config';
import { mulberry32 } from '../core/rng';
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from '../world/atmos';
import { facadeTexture, loadSignFonts, SIGN_BASE, T } from './atlas';
import { col, Kit } from './kit';

// ------------------------------------------------------------------ material
let material: THREE.MeshStandardMaterial | null = null;
const nightUniform = { value: 0 };

/** Material for Kit geometry (texture-array facades): communes, city service buildings, construction scaffolds. */
export function kitMaterial(): THREE.Material {
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
  m.customProgramCacheKey = () => 'slop-kit';
  material = m;
  return m;
}

/** 0 = day, 1 = night (window glow, sign glow). */
export function setKitNight(n: number) {
  nightUniform.value = n;
}

/** Load sign fonts and paint the Kit facade texture array. */
export async function loadKitArt(): Promise<void> {
  await loadSignFonts();
  facadeTexture();
}

/**
 * Reusable construction dressing for a footprint/height bucket. Kit geometry,
 * so it renders in the Kit batch (see sim/buildings.ts) with kitMaterial().
 */
export function generateConstruction(widthCells: number, depthCells: number, height: number, seed: number): THREE.BufferGeometry {
  const k = new Kit();
  const r = mulberry32(seed * 3571 + widthCells * 101 + depthCells * 211);
  const W = widthCells * CELL, D = depthCells * CELL;
  const sw = Math.max(4, Math.min(W - 2.2, 22));
  const sd = Math.max(4, Math.min(D - 2.2, 18));
  const cz = -Math.max(0, D - sd) * 0.22;
  const H = Math.max(4, height);
  const steel = col(0x70787d);
  const safety = col(0xe09a24);
  const plank = col(0xb58a58);
  const x0 = -sw / 2, x1 = sw / 2, z0 = cz - sd / 2, z1 = cz + sd / 2;

  // Corner standards and a bounded number of lifts keep the vertex cost flat
  // even for skyscrapers. High-rise work gets wider spacing, not more rails.
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const)
    k.box(x, z, 0.16, 0.16, 0, H, T.SOLID, steel, T.SOLID, steel, { ao: false });
  const lifts = Math.max(2, Math.min(6, Math.ceil(H / 5)));
  let prevY = 0;
  for (let i = 0; i < lifts; i++) {
    const y = ((i + 1) / lifts) * Math.min(H, 32);
    k.box(0, z1, sw, 0.13, y, y + 0.13, T.SOLID, steel, T.SOLID, steel, { ao: false });
    k.box(0, z0, sw, 0.13, y, y + 0.13, T.SOLID, steel, T.SOLID, steel, { ao: false });
    k.box(x0, cz, 0.13, sd, y, y + 0.13, T.SOLID, steel, T.SOLID, steel, { ao: false });
    k.box(x1, cz, 0.13, sd, y, y + 0.13, T.SOLID, steel, T.SOLID, steel, { ao: false });
    k.slab(x0, z1 - 0.42, x1, z1 + 0.42, y + 0.15, T.WOOD, plank);
    if (i % 2 === 0) k.slab(x0, z0 - 0.42, x1, z0 + 0.42, y + 0.15, T.WOOD, plank);
    // Alternating facade braces give the scaffold its unmistakable X rhythm.
    if (i > 0) {
      const flip = i % 2 ? 1 : -1;
      k.tube([flip > 0 ? x0 : x1, prevY + 0.15, z1 + 0.1], [flip > 0 ? x1 : x0, y, z1 + 0.1], 0.055, 3, safety);
      k.tube([flip > 0 ? x1 : x0, prevY + 0.15, z0 - 0.1], [flip > 0 ? x0 : x1, y, z0 - 0.1], 0.055, 3, safety);
    }
    prevY = y;
  }

  // Pallets and temporary barriers help short builds read as active sites.
  for (let i = 0; i < 3; i++) {
    const px = x0 + 1.2 + i * 1.8;
    k.box(px, z1 + 0.9, 1.45, 0.8, 0, 0.18 + i * 0.09, T.WOOD, plank, T.WOOD, plank, { ao: false });
  }
  for (let i = 0; i < Math.max(2, Math.floor(sw / 4)); i++) {
    const px = x0 + (i + 0.5) * (sw / Math.max(2, Math.floor(sw / 4)));
    k.box(px, z1 + 1.55, 0.12, 0.12, 0, 1.1, T.SOLID, safety, null, undefined, { ao: false });
  }

  if (H >= 14) {
    const mx = (r() < 0.5 ? -1 : 1) * (sw / 2 + 1.3);
    const mz = z0 + 1.2;
    const mastH = H + Math.min(12, H * 0.25);
    k.box(mx, mz, 0.58, 0.58, 0, mastH, T.SOLID, safety, T.SOLID, safety, { ao: false });
    const boom = Math.min(34, sw + 12);
    k.box(mx + boom * 0.22, mz, boom, 0.28, mastH - 0.1, mastH + 0.18, T.SOLID, safety, T.SOLID, safety, { ao: false });
    k.box(mx - boom * 0.24, mz, 2.8, 1.1, mastH - 1, mastH, T.SOLID, col(0x44494d), T.SOLID, steel, { ao: false });
    const hookX = mx + boom * 0.38;
    k.tube([hookX, mastH, mz], [hookX, H * 0.55, mz], 0.035, 3, col(0x292b2d));
    k.box(hookX, mz, 0.38, 0.38, H * 0.55 - 0.25, H * 0.55, T.SOLID, col(0x292b2d), T.SOLID, undefined, { ao: false });
  }
  return k.build();
}
