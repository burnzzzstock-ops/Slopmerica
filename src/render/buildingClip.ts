import * as THREE from 'three';
import { withBuildingLodRandom as withVisualRandom } from './buildingLod';

const OPEN = 1e9;
type Binding = { uniform: THREE.IUniform<THREE.DataTexture>; owner: number; shared: boolean };
const bindings = new WeakMap<THREE.Material, Binding>();
let nextOwner = 1;

/** One float per batch handle. Construction never borrows instance colour or
 * its alpha channel, which carries material wear. */
export class BuildingClip {
  private readonly owner = nextOwner++;
  private data: Float32Array;
  private texture: THREE.DataTexture;
  private materials: { material: THREE.Material; binding: Binding }[] = [];

  constructor(capacity: number) {
    const side = Math.ceil(Math.sqrt(capacity));
    this.data = new Float32Array(side * side).fill(OPEN);
    this.texture = this.makeTexture(side);
  }

  private makeTexture(side: number) {
    const texture = withVisualRandom(() => new THREE.DataTexture(this.data, side, side, THREE.RedFormat, THREE.FloatType));
    texture.needsUpdate = true;
    return texture;
  }

  private grow(required: number) {
    if (required <= this.data.length) return;
    const side = Math.ceil(Math.sqrt(Math.max(required, this.data.length * 1.6)));
    const previous = this.data;
    this.data = new Float32Array(side * side).fill(OPEN);
    this.data.set(previous);
    this.texture.dispose();
    this.texture = this.makeTexture(side);
    this.activate();
  }

  set(handle: number, height: number | null) {
    this.grow(handle + 1);
    const value = Math.fround(height === null ? OPEN : Math.max(0, height));
    if (this.data[handle] === value) return;
    this.data[handle] = value;
    this.texture.needsUpdate = true;
  }

  get(handle: number) {
    return this.data[handle] ?? OPEN;
  }

  active(handle: number) {
    return this.get(handle) < OPEN;
  }

  /** Shared atlas materials also draw ordinary meshes. Only USE_BATCHING reads
   * this table; its uniform is rebound by the owning batch before a draw. */
  bind(material: THREE.Material) {
    let binding = bindings.get(material);
    if (!binding) {
      binding = { uniform: { value: this.texture }, owner: this.owner, shared: false };
      bindings.set(material, binding);
      const previous = material.onBeforeCompile;
      const previousKey = material.customProgramCacheKey();
      const clipBinding = binding;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.tBuildingClip = clipBinding.uniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform highp sampler2D tBuildingClip;\nattribute float buildClipY;\nvarying vec2 vBuildingClip;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
vBuildingClip = vec2(buildClipY, 1e9);
#ifdef USE_BATCHING
  int clipHandle = int(getIndirectIndex(gl_DrawID));
  int clipSide = textureSize(tBuildingClip, 0).x;
  vBuildingClip.y = texelFetch(tBuildingClip, ivec2(clipHandle % clipSide, clipHandle / clipSide), 0).r;
#endif`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vBuildingClip;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vBuildingClip.x > vBuildingClip.y) discard;');
      };
      // Three does not refresh custom samplers between identical-material
      // draws. A shared material needs one cached program per table owner.
      // The normal one-batch atlas/Kit paths keep one program each.
      material.customProgramCacheKey = () => `${previousKey}|building-height-clip-v1|${clipBinding.shared ? clipBinding.owner : 0}`;
      material.needsUpdate = true;
    } else if (binding.owner !== this.owner) {
      binding.shared = true;
      material.needsUpdate = true;
    }
    this.materials.push({ material, binding });
  }

  activate() {
    for (const { material, binding } of this.materials) {
      if (binding.uniform.value === this.texture) continue;
      binding.uniform.value = this.texture;
      binding.owner = this.owner;
      material.needsUpdate = true;
    }
  }
}

/** Reveal one real-height storey at a time, with a brief rise through each
 * floor. The first stage is the foundation, and completion removes the cut. */
export function constructionHeight(height: number, progress: number) {
  const floors = Math.max(1, Math.ceil(height / 3.4 - 1e-6));
  const stage = THREE.MathUtils.clamp(progress, 0, 1) * floors;
  const floor = Math.floor(stage);
  const phase = stage - floor;
  const rise = THREE.MathUtils.smoothstep(phase, 0.55, 1);
  return Math.max(0.2, Math.min(height, (floor + rise) * height / floors));
}

/** The attribute stays in the existing atlas/Kit batch format. Ordinary
 * buildings clip at local Y; scaffold steel can explicitly opt out. */
export function addBuildingClipAttribute(geometry: THREE.BufferGeometry) {
  if (geometry.hasAttribute('buildClipY')) return;
  const position = geometry.getAttribute('position');
  const values = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) values[i] = position.getY(i);
  geometry.setAttribute('buildClipY', new THREE.BufferAttribute(values, 1));
}
