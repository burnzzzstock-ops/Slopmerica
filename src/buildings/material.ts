// The single shared material for every building, landmark and billboard:
// albedo atlas x vertex tint, plus an emissive atlas (lit windows, signs,
// screens, lamps) faded in by setBuildingNight().
import * as THREE from 'three';
import { atlasTextures } from '../art';
import { GLOW } from '../config';
import { bindLamps, LAMP_PARS, lampAdd } from '../world/nightLights';
import { atmo } from '../world/seasons';

let material: THREE.MeshStandardMaterial | null = null;
let night = 0;

/**
 * Glass towers (art tiles flagged `glass`, see GLASS_U in art/atlas.ts) mirror the sky. Dark tinted glass under a diffuse
 * light and a low ambient is a black slab (Low has no environment map to reflect, and High's rough lobe shows almost
 * nothing), so the shader adds a fresnel-weighted sky term to every glass texel: no extra texture read, no extra draw call.
 * x: reflectance looking straight on (coated architectural glass, 0.14), y: how much of the reflected ray's height is used
 * (a camera above the wall would mirror the ground; the ray is folded up into the sky), z: height bias toward the horizon
 * band, w: extra sky height gained up the tower (per 90 m); the zenith's share is capped at 85% so the crowns don't go cobalt. Live-tunable from the console for the look pass.
 */
export const GLASS = {
  uGlass: { value: new THREE.Vector4(0.14, 0.8, 0.12, 0.15) },
  /**
   * Wall fill for presets that have no environment map (Low, Medium): a share of the hemisphere light added to vertical faces
   * only. The sky dome lights a wall from half its height and the ground bounce is weak, so on Low every wall in shade was a
   * dark slab next to a bright roof (High has the environment map for that). 0 switches it off.
   */
  uFillK: { value: 0.35 },
};

function glow(n: number) {
  // windows come on through dusk, full at night
  const t = THREE.MathUtils.smoothstep(n, 0.12, 0.85);
  // bright enough that a street of lit homes reads from neighbourhood zoom;
  // scripts/nightglow.mjs keeps it short of blowing out to white
  return t * 1.8;
}

export function buildingMaterial(): THREE.MeshStandardMaterial {
  if (!material) {
    const { map, emissive } = atlasTextures();
    material = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: 0xffffff,
      emissiveIntensity: glow(night),
      vertexColors: true,
      roughness: 0.84,
      metalness: 0.04,
    });
    material.name = 'slopmerica-buildings';
    // two sheets: the main atlas (u 0..1) and the satire sheet (u 2..3).
    // Both are sampled (no branch, so mip derivatives stay valid) and u picks.
    const { satMap, satEmissive } = atlasTextures();
    material.onBeforeCompile = (sh) => {
      sh.uniforms.satMap = { value: satMap };
      sh.uniforms.satEmi = { value: satEmissive };
      bindLamps(sh);
      Object.assign(sh.uniforms, GLASS, { uGlassTop: atmo.uGlassTop, uGlassHor: atmo.uGlassHor, uGlassSun: atmo.uGlassSun, uFill: atmo.uFill });
      // the pools of light at night (world/nightLights.ts): lot paving and the foot of the walls
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;\nvarying float vLampH;')
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 lw = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  lw = batchingMatrix * lw;
#endif
  vLampW = (modelMatrix * lw).xyz;
  vLampH = transformed.y;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <lights_physical_fragment>', `${lampAdd('vLampW', 'clamp(1.0 - vLampH / 3.5, 0.0, 1.0)')}\n#include <lights_physical_fragment>`)
        .replace('#include <common>', `#include <common>\nvarying vec3 vLampW;\nvarying float vLampH;\n${LAMP_PARS}`)
        .replace('#include <common>', '#include <common>\nuniform sampler2D satMap;\nuniform sampler2D satEmi;')
        .replace('#include <common>', '#include <common>\nuniform vec4 uGlass;\nuniform float uFillK;\nuniform vec3 uGlassTop, uGlassHor, uGlassSun, uFill;')
        .replace(
          '#include <map_fragment>',
          `float glassK = 0.0;
#ifdef USE_MAP
  // u picks the sheet and the glass strength: 0..1 main, 2..3 satire, 4..8 main + glass step (art/atlas.ts GLASS_U)
  float uBand = floor(vMapUv.x);
  vec2 tUv = vec2(vMapUv.x - uBand, vMapUv.y);
  float satK = step(1.5, uBand) * step(uBand, 2.5);
  glassK = step(3.5, uBand) * (uBand - 3.0) * 0.25;
  vec4 sampledDiffuseColor = mix(texture2D(map, tUv), texture2D(satMap, tUv), satK);
  diffuseColor *= sampledDiffuseColor;
#endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#ifdef USE_EMISSIVEMAP
  float eBand = floor(vEmissiveMapUv.x);
  vec2 eUv = vec2(vEmissiveMapUv.x - eBand, vEmissiveMapUv.y);
  vec4 emissiveColor = mix(texture2D(emissiveMap, eUv), texture2D(satEmi, eUv), step(1.5, eBand) * step(eBand, 2.5));
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,
        )
        // glass: a sky reflection, weighted by fresnel and by how dark the texel is (light mullions and slab edges don't mirror)
        .replace(
          '#include <opaque_fragment>',
          `vec3 gN = transformDirectionByInverseViewMatrix(normal, viewMatrix);
#ifndef USE_ENVMAP
  outgoingLight += diffuseColor.rgb * uFill * (uFillK * RECIPROCAL_PI * (1.0 - gN.y * gN.y));
#endif
if (glassK > 0.0) {
  vec3 gV = normalize(cameraPosition - vLampW);
  float gNV = clamp(dot(gN, gV), 0.0, 1.0);
  float gF = uGlass.x + (1.0 - uGlass.x) * pow(1.0 - gNV, 4.0);
  vec3 gR = reflect(-gV, gN);
  float gY = abs(gR.y) * uGlass.y + uGlass.z + uGlass.w * clamp(vLampH / 90.0, 0.0, 1.0);
  vec3 gSky = mix(uGlassHor, uGlassTop, 0.85 * smoothstep(0.05, 0.95, gY));
  // the faces toward the light mirror a brighter sky
  float gSun = 0.75 + 0.45 * max(dot(gN, vec3(uGlassSun.x, 0.0, uGlassSun.z)) / max(length(uGlassSun.xz), 0.2), 0.0);
  float gDark = 1.0 - smoothstep(0.06, 0.32, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
  outgoingLight += gSky * (gF * glassK * gDark * gSun);
}
#include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => 'slop-buildings-2sheet-lamps-glass-fill';
  }
  return material;
}

export function setBuildingNight(n: number) {
  night = THREE.MathUtils.clamp(n, 0, 1);
  if (material) material.emissiveIntensity = glow(night) * GLOW.value;
}

export function buildingNight() {
  return night;
}
