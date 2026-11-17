import * as THREE from 'three';
import type { PostLook } from './post';

const states = new WeakMap<THREE.WebGLRenderer, ReturnType<typeof uniforms>>();
const patched = new WeakSet<THREE.Material>();
let installed = false;

function uniforms() {
  return {
    uLowTint: { value: new THREE.Color(1, 1, 1) },
    uLowTintLit: { value: new THREE.Color(1, 1, 1) },
    uLowLift: { value: new THREE.Color(0, 0, 0) },
    uLowGrade: { value: new THREE.Vector4(1.08, 1.08, 1.06, 0.26) },
    uLowResolution: { value: new THREE.Vector2(1, 1) },
  };
}

const curve = `
uniform vec3 uLowTint, uLowTintLit, uLowLift;
uniform vec4 uLowGrade;
uniform vec2 uLowResolution;
vec3 lowEncode(vec3 c) {
  return mix(c * 12.92, pow(max(c, vec3(0.0031308)), vec3(0.4166667)) * 1.055 - 0.055, step(vec3(0.0031308), c));
}
vec3 lowDecode(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 CustomToneMapping(vec3 color) {
  const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  float lit = smoothstep(0.03, 0.3, dot(color * toneMappingExposure / 0.95, luma));
  vec3 c = ACESFilmicToneMapping(color * mix(uLowTint, uLowTintLit, lit));
  c = lowEncode(clamp(c, 0.0, 1.0));
  c = mix(vec3(dot(c, luma)), c, mix(uLowGrade.x, uLowGrade.y, lit));
  c = (c - 0.5) * uLowGrade.z + 0.5;
  c = max(c, 0.0) + uLowLift * (1.0 - c);
  vec2 q = gl_FragCoord.xy / uLowResolution - 0.5;
  c *= 1.0 - uLowGrade.w * smoothstep(0.2, 0.85, dot(q, q) * 2.2);
  return lowDecode(clamp(c, 0.0, 1.0));
}`;

/** Register before world materials are constructed. Offscreen passes keep
 * the renderer's normal linear-HDR path. Only canvas tone mapping grades. */
export function installGradeLite(renderer: THREE.WebGLRenderer) {
  if (!installed) {
    const token = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
    if (!THREE.ShaderChunk.tonemapping_pars_fragment.includes(token)) throw Error('Unsupported tone-map chunk');
    THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(token, curve);
    const beforeRender = THREE.Material.prototype.onBeforeRender;
    THREE.Material.prototype.onBeforeRender = function (...args) {
      beforeRender.apply(this, args);
      if (!states.has(args[0]) || patched.has(this)) return;
      const beforeCompile = this.onBeforeCompile;
      const key = this.customProgramCacheKey;
      const defaultKey = key === THREE.Material.prototype.customProgramCacheKey;
      this.onBeforeCompile = function (shader, activeRenderer) {
        beforeCompile.call(this, shader, activeRenderer);
        const state = states.get(activeRenderer);
        if (state) Object.assign(shader.uniforms, state);
      };
      this.customProgramCacheKey = function () {
        return (defaultKey ? beforeCompile.toString() : key.call(this)) + '/grade-lite';
      };
      this.needsUpdate = true;
      patched.add(this);
    };
    installed = true;
  }
  if (!states.has(renderer)) states.set(renderer, uniforms());
}

export function updateGradeLite(renderer: THREE.WebGLRenderer, look: PostLook, enabled: boolean) {
  const state = states.get(renderer);
  if (!state) return false;
  renderer.toneMapping = enabled ? THREE.CustomToneMapping : THREE.ACESFilmicToneMapping;
  state.uLowTint.value.copy(look.tint);
  state.uLowTintLit.value.copy(look.tintLit);
  state.uLowLift.value.copy(look.lift);
  state.uLowGrade.value.set(look.sat, look.satLit, look.contrast, 0.26);
  renderer.getDrawingBufferSize(state.uLowResolution.value);
  return true;
}
