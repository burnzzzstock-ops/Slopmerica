// The single shared material for every building, landmark and billboard:
// albedo atlas x vertex tint, plus an emissive atlas (lit windows, signs,
// screens, lamps) faded in by setBuildingNight().
import * as THREE from 'three';
import { atlasTextures } from '../art';

let material: THREE.MeshStandardMaterial | null = null;
let night = 0;

function glow(n: number) {
  // windows come on through dusk, full at night
  const t = THREE.MathUtils.smoothstep(n, 0.12, 0.85);
  return t * 1.65;
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
  }
  return material;
}

export function setBuildingNight(n: number) {
  night = THREE.MathUtils.clamp(n, 0, 1);
  if (material) material.emissiveIntensity = glow(night);
}

export function buildingNight() {
  return night;
}
