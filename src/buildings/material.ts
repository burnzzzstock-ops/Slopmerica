// The single shared material for every building, landmark and billboard:
// albedo atlas x vertex tint, plus an emissive atlas (lit windows, signs,
// screens, lamps) faded in by setBuildingNight().
import * as THREE from 'three';
import { atlasTextures } from '../art';
import { GLOW } from '../config';
import { bindLamps, LAMP_PARS, lampAdd } from '../world/nightLights';

let material: THREE.MeshStandardMaterial | null = null;
let night = 0;

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
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
  float satK = step(1.5, vMapUv.x);
  vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(satMap, vMapUv - vec2(2.0, 0.0)), satK);
  diffuseColor *= sampledDiffuseColor;
#endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = mix(texture2D(emissiveMap, vEmissiveMapUv), texture2D(satEmi, vEmissiveMapUv - vec2(2.0, 0.0)), step(1.5, vEmissiveMapUv.x));
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,
        );
    };
    material.customProgramCacheKey = () => 'slop-buildings-2sheet-lamps';
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
