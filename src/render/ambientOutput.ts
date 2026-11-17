import * as THREE from 'three';

const scenes = new WeakSet<THREE.Scene>();
const patched = new WeakSet<THREE.Material>();
let installed = false;

/** Preserve the diffuse ambient contribution beside the scene colour in the
 * same geometry pass. Direct light and emission never enter this attachment. */
export function installAmbientOutput(scene: THREE.Scene) {
  scenes.add(scene);
  if (installed) return;
  installed = true;
  const beforeRender = THREE.Material.prototype.onBeforeRender;
  THREE.Material.prototype.onBeforeRender = function (...args) {
    beforeRender.apply(this, args);
    if (!scenes.has(args[1]) || patched.has(this)) return;
    patched.add(this);
    const raw = (this as THREE.RawShaderMaterial).isRawShaderMaterial;
    if (raw) (this as THREE.RawShaderMaterial).glslVersion = THREE.GLSL3;
    const compile = this.onBeforeCompile;
    const key = this.customProgramCacheKey;
    const defaultKey = key === THREE.Material.prototype.customProgramCacheKey;
    this.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer);
      if (raw) {
        shader.vertexShader = shader.vertexShader.replace(/\battribute\b/g, 'in').replace(/\bvarying\b/g, 'out');
        shader.fragmentShader = 'layout(location = 0) out highp vec4 ambientSceneColor;\n#define gl_FragColor ambientSceneColor\n' +
          shader.fragmentShader.replace(/\bvarying\b/g, 'in').replace(/\btexture2D\b/g, 'texture');
      }
      let fragment = 'layout(location = 1) out highp vec4 ambientContribution;\n' + shader.fragmentShader;
      fragment = fragment.replace(/void\s+main\s*\(\s*\)\s*\{/, '$&\nambientContribution = vec4(0.0);');
      if (fragment.includes('#include <lights_fragment_end>')) {
        fragment = fragment.replace('#include <opaque_fragment>',
          'ambientContribution.rgb = min(max(reflectedLight.indirectDiffuse, vec3(0.0)), max(outgoingLight, vec3(0.0)));\n#include <opaque_fragment>');
        fragment = fragment.replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\nambientContribution.rgb *= 1.0 - fogFactor;\n#endif');
      }
      // All game surface shaders finish with main. Match transparent blending
      // so an unlit overlay attenuates the ambient surface behind it correctly.
      const end = fragment.lastIndexOf('}');
      fragment = fragment.slice(0, end) + '\nambientContribution.a = gl_FragColor.a;\n#ifdef PREMULTIPLIED_ALPHA\nambientContribution.rgb *= gl_FragColor.a;\n#endif\n' + fragment.slice(end);
      shader.fragmentShader = fragment;
    };
    this.customProgramCacheKey = function () {
      return (defaultKey ? compile.toString() : key.call(this)) + '/ambient-output';
    };
    this.needsUpdate = true;
  };
}
