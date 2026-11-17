import * as THREE from 'three';
import type { PostLook } from './post';

const scenes = new WeakMap<THREE.Scene, AerialUniforms>();
const patched = new WeakMap<THREE.Material, { world: AerialUniforms; bindings: AerialUniforms }>();
const clean = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat);
clean.needsUpdate = true;
let installed = false;

export interface AerialUniforms {
  aerialSunDirection: THREE.IUniform<THREE.Vector3>;
  aerialSunTint: THREE.IUniform<THREE.Color>;
  aerialPollution: THREE.IUniform<THREE.Texture>;
}

/** One shared atmosphere binding per world, including plain/custom fog materials. */
export function installAerialPerspective(scene: THREE.Scene): AerialUniforms {
  const uniforms: AerialUniforms = {
    aerialSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    aerialSunTint: { value: new THREE.Color(0, 0, 0) },
    aerialPollution: { value: clean },
  };
  scenes.set(scene, uniforms);
  if (installed) return uniforms;
  installed = true;
  const previous = THREE.Material.prototype.onBeforeRender;
  THREE.Material.prototype.onBeforeRender = function (...args) {
    previous.apply(this, args);
    const world = scenes.get(args[1]);
    if (!world) return;
    const existing = patched.get(this);
    if (existing) {
      // Shared material singletons can survive starting a new world. Rebind the
      // uniform references without recompiling or retaining the old world's field.
      if (existing.world !== world) {
        existing.world = world;
        existing.bindings.aerialSunDirection.value = world.aerialSunDirection.value;
        existing.bindings.aerialSunTint.value = world.aerialSunTint.value;
        existing.bindings.aerialPollution.value = world.aerialPollution.value;
      }
      return;
    }
    const bindings: AerialUniforms = {
      aerialSunDirection: { value: world.aerialSunDirection.value },
      aerialSunTint: { value: world.aerialSunTint.value },
      aerialPollution: { value: world.aerialPollution.value },
    };
    patched.set(this, { world, bindings });
    const compile = this.onBeforeCompile, key = this.customProgramCacheKey;
    const defaultKey = key === THREE.Material.prototype.customProgramCacheKey;
    this.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer);
      Object.assign(shader.uniforms, bindings);
    };
    this.customProgramCacheKey = function () { return (defaultKey ? compile.toString() : key.call(this)) + '/aerial-v1'; };
    this.needsUpdate = true;
  };
  return uniforms;
}

/** Apply once after weather writes the look, for both direct and post grades. */
export function applySmogLook(look: PostLook, smog: number, night: number) {
  const strength = THREE.MathUtils.clamp(smog, 0, 1) * (1 - night * .65);
  look.tint.r *= 1 + strength * .035;
  look.tint.g *= 1 - strength * .015;
  look.tint.b *= 1 - strength * .19;
  look.tintLit.r *= 1 + strength * .025;
  look.tintLit.b *= 1 - strength * .12;
  look.sat *= 1 - strength * .14;
  look.satLit *= 1 - strength * .08;
}
