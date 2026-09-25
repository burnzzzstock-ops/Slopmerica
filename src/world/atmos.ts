// Shared atmosphere uniforms. Terrain, trees, clouds and water all read the
// same objects, so the weather system can drive every material by writing to
// them once per frame: cloud shadows, snow cover, wet ground, seasonal grass,
// wind strength.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

const TEX = 256;

function makeCloudTexture(): THREE.DataTexture {
  // two tileable fbm fields in R and G (different seeds / frequencies)
  const rnd = mulberry32(4242);
  const field = (periods: number[], weights: number[]) => {
    const out = new Float32Array(TEX * TEX);
    let wsum = 0;
    for (let k = 0; k < periods.length; k++) {
      const p = periods[k];
      const lat = new Float32Array(p * p);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      const cell = TEX / p;
      for (let y = 0; y < TEX; y++)
        for (let x = 0; x < TEX; x++) {
          const fx = x / cell, fy = y / cell;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          let tx = fx - x0, ty = fy - y0;
          tx = tx * tx * (3 - 2 * tx);
          ty = ty * ty * (3 - 2 * ty);
          const a = lat[(y0 % p) * p + (x0 % p)], b = lat[(y0 % p) * p + ((x0 + 1) % p)];
          const c = lat[((y0 + 1) % p) * p + (x0 % p)], d = lat[((y0 + 1) % p) * p + ((x0 + 1) % p)];
          out[y * TEX + x] += ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) * weights[k];
        }
      wsum += weights[k];
    }
    for (let i = 0; i < out.length; i++) out[i] /= wsum;
    return out;
  };
  const r = field([4, 8, 16, 32, 64], [0.42, 0.26, 0.16, 0.1, 0.06]);
  const g = field([6, 12, 24, 48], [0.45, 0.28, 0.17, 0.1]);
  const data = new Uint8Array(TEX * TEX * 4);
  for (let i = 0; i < TEX * TEX; i++) {
    // stretch contrast so coverage thresholds behave
    data[i * 4] = Math.max(0, Math.min(255, ((r[i] - 0.5) * 1.9 + 0.5) * 255));
    data[i * 4 + 1] = Math.max(0, Math.min(255, ((g[i] - 0.5) * 1.9 + 0.5) * 255));
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const ATMOS = {
  uCloudTex: { value: makeCloudTexture() },
  uCloudOffset: { value: new THREE.Vector2() },
  uCloudCover: { value: 0.35 },
  uCloudH: { value: 2600 },
  uCloudShadow: { value: 0.45 },
  uSunDirW: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
  uSnow: { value: 0 },
  uSnowLine: { value: -100 },
  uWet: { value: 0 },
  uGrassTint: { value: new THREE.Color(1, 1, 1) },
  uWind: { value: 1 },
};

/** Cloud density at a world xz on the cloud deck, 0..1. */
export const CLOUD_GLSL = /* glsl */ `
uniform sampler2D uCloudTex;
uniform vec2 uCloudOffset;
uniform float uCloudCover, uCloudH, uCloudShadow;
uniform vec3 uSunDirW;
float cloudDensity(vec2 p) {
  float n = texture(uCloudTex, p * 0.00011 + uCloudOffset).r * 0.62
          + texture(uCloudTex, p * 0.00037 + uCloudOffset * 1.6 + 0.31).g * 0.28
          + texture(uCloudTex, p * 0.0012 + uCloudOffset * 2.4 + 0.57).r * 0.10;
  float lo = 1.0 - uCloudCover;
  return smoothstep(lo - 0.02, lo + 0.26, n);
}
float cloudShade(vec3 wp) {
  vec3 s = normalize(uSunDirW);
  float k = (uCloudH - wp.y) / max(s.y, 0.15);
  return 1.0 - uCloudShadow * cloudDensity(wp.xz + s.xz * k);
}
`;

/** Wire the shared uniforms into a material's compiled shader. */
export function bindAtmos(sh: { uniforms: Record<string, THREE.IUniform> }) {
  Object.assign(sh.uniforms, ATMOS);
}

/** Dim only direct sunlight under cloud shadows (needs a vec3 world position varying). */
export function cloudShadowChunk(wposVar: string) {
  return `#include <lights_fragment_end>
{
  float cShade = cloudShade(${wposVar});
  reflectedLight.directDiffuse *= cShade;
  reflectedLight.directSpecular *= cShade;
}`;
}
