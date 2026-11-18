import * as THREE from 'three';
import { withVisualRandom } from '../render/visualRandom';

// The same finish library serves atlas buildings and texture-array services.
// Two signed slopes, roughness and metallic response fit in one RGBA fetch.
export const Finish = { plain: 0, glass: 1, panel: 2, brick: 3, siding: 4, roof: 5, concrete: 6, shingles: 7 } as const;
const SIZE = 64;
const rough = [0.84, 0.12, 0.35, 0.88, 0.64, 0.94, 0.83, 0.89];
const metal = [0.04, 0.08, 0.45, 0.015, 0.025, 0.01, 0.015, 0.03];
let detail: THREE.DataArrayTexture | undefined;

/** A two-metre repeat. Mean slope is zero, including across each tile edge. */
export function finishTexture() {
  if (detail) return detail;
  const depth = rough.length;
  const data = new Uint8Array(SIZE * SIZE * 4 * depth);
  for (let layer = 0; layer < depth; layer++) {
    const heights = new Float32Array(SIZE * SIZE);
    const heightAt = (x: number, y: number) => heights[(y & 63) * SIZE + (x & 63)];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const noise = ((Math.imul(x + 37, y + 193) ^ Math.imul(x + y + 3, 179)) & 255) / 255 - 0.5;
      let h = 0;
      if (layer === Finish.glass) h = 0.012 * Math.sin(x * Math.PI / 32) * Math.sin(y * Math.PI / 32);
      if (layer === Finish.brick) h = (y % 4 === 0 || (x + 5 * (Math.floor(y/4) % 2)) % 16 === 0 ? -0.012 : 0.004) + noise * 0.004;
      if (layer === Finish.siding) h = (y % 8) * 0.002 - (y % 8 === 0 ? 0.007 : 0);
      if (layer === Finish.panel) h = x % 32 < 2 || y < 2 ? -0.016 : 0.001;
      if (layer === Finish.roof) h = (x < 2 ? 0.008 : 0) + noise * 0.002;
      if (layer === Finish.shingles) h = (y % 8) * 0.0015 + noise * 0.004;
      if (layer === Finish.concrete) h = noise * 0.005;
      heights[y*SIZE + x] = h;
    }
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = ((layer*SIZE + y)*SIZE + x)*4;
      data[i] = Math.round(128 + 127 * (heightAt(x+1,y) - heightAt(x-1,y)) * SIZE / 4);
      data[i+1] = Math.round(128 + 127 * (heightAt(x,y+1) - heightAt(x,y-1)) * SIZE / 4);
      data[i+2] = Math.round(255 * rough[layer]);
      data[i+3] = Math.round(255 * metal[layer]);
    }
  }
  detail = withVisualRandom(() => new THREE.DataArrayTexture(data, SIZE, SIZE, depth));
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.generateMipmaps = true;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.magFilter = THREE.LinearFilter;
  detail.needsUpdate = true;
  return detail;
}

export function tileFinish(name: string, glass: number): number {
  if (glass || /^(glassPlain|carWin|solar)$/.test(name)) return Finish.glass;
  if (/^(metal|rust|corrugated|grille|rollup|garage[12]|docks|dcWall|factoryWin)/.test(name)) return Finish.panel;
  if (/brick|cinder|stone/i.test(name)) return Finish.brick;
  if (/siding|trailer|fiveOver|wood|deck/i.test(name)) return Finish.siding;
  if (name === 'shingles') return Finish.shingles;
  if (/^(flatRoof|gravelRoof)$/.test(name)) return Finish.roof;
  if (/^(concrete|stucco|tiltup|podium|midrise|towerResi)/.test(name)) return Finish.concrete;
  return Finish.plain;
}

/** Give painted material joints and glazing frames their full tonal range. */
export function finishAlbedo(context: CanvasRenderingContext2D, width: number, height: number, kind: number) {
  const image = context.getImageData(0, 0, width, height);
  const mean = [0, 0, 0];
  for (let offset = 0; offset < image.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) mean[channel] += image.data[offset + channel] / (width * height);
  }
  const gain = kind === Finish.glass ? 2.9 : 2.15;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      image.data[offset + channel] = mean[channel] + gain * (image.data[offset + channel] - mean[channel]);
    }
  }
  context.putImageData(image, 0, 0);
}

export const FINISH_PARS = `
precision highp sampler2DArray;
uniform sampler2DArray tFinish;
varying float vFinishWear;
varying float vAmbientVisibility;
vec2 finishUV(vec3 p, vec3 n) {
  if (abs(n.y) > 0.72) return p.xz * 0.5;
  vec2 along = normalize(vec2(n.z, -n.x));
  return vec2(dot(p.xz, along), p.y) * 0.5;
}
vec3 finishNormal(vec3 n, vec2 uv, vec2 slopes, vec3 viewPos) {
  vec3 px = dFdx(viewPos), py = dFdy(viewPos);
  vec3 s = cross(py, n), t = cross(n, px);
  float det = dot(px, s);
  if (abs(det) < 1e-9) return n;
  vec2 grad = 2.0 * vec2(dot(slopes, dFdx(uv)), dot(slopes, dFdy(uv)));
  return normalize(abs(det) * n - sign(det) * (grad.x*s + grad.y*t));
}`;

export const FINISH_VERTEX = `
vAmbientVisibility = ambientVisibility;
vFinishWear = 0.0;
#ifdef USE_BATCHING_COLOR
vFinishWear = clamp(1.0 - vColor.a, 0.0, 1.0);
vColor.a = 1.0;
#endif
`;

/** Roughness and metallic factors are set before the physical-light chunk. */
export function shadeFinish(world: string, height: string, layer: string) {
  return `
  float finishLayer = ${layer};
  vec3 finishWN = transformDirectionByInverseViewMatrix(normal, viewMatrix);
  vec2 fUV = finishUV(${world}, finishWN);
  vec4 finishSample = texture(tFinish, vec3(fUV, finishLayer));
  vec2 finishSlope = (finishSample.rg * 255.0 - 128.0) / 127.0;
  normal = finishNormal(normal, fUV, finishSlope, -vViewPosition);
  roughnessFactor = finishSample.b;
  metalnessFactor = finishSample.a;
  // Mortar and panel seams retain a little local occlusion even where the
  // broad facade receives only diffuse skylight. Fade subpixel relief away.
  float relief = step(1.5, finishLayer) * (1.0 - step(5.5, finishLayer)) + step(6.5, finishLayer);
  float detailFootprint = max(length(dFdx(fUV)), length(dFdy(fUV)));
  float reliefShade = smoothstep(0.025, 0.3, length(finishSlope));
  float finishAO = 1.0 - relief * reliefShade * 0.28 * (1.0 - smoothstep(0.04, 0.18, detailFootprint));
  // Dirt gathers at the dry foot of porous vertical surfaces. Streaks
  // follow gravity, with a stable world-space phase on adjoining panels.
  float porous = step(2.5, finishLayer) * (1.0 - smoothstep(0.3, 0.7, abs(finishWN.y)));
  float foot = 1.0 - smoothstep(0.1, 4.0, ${height});
  float stripe = 0.5 + 0.5*cos(fUV.x * 22.0 + 0.5*sin(fUV.x * 6.0));
  float weathering = 0.30 + 0.70 * vFinishWear;
  float sill = exp(-mod(max(0.0, ${height}), 3.2) * 4.0);
  diffuseColor.rgb *= 1.0 - porous * weathering * (foot * (0.07 + 0.14 * stripe) + sill * stripe * 0.10);
  `;
}
