import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Quality } from '../config';
import type { Environment } from '../world/sky';

/** Dawn/dusk shafts: quarter-resolution depth sampling, then additive HDR light.
 * Uses no scene color feedback and skips noon, night, hidden sun and Low/Medium.
 */
export class GodRays {
  private target?: THREE.WebGLRenderTarget;
  private quad = new FullScreenQuad();
  private projected = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private viewport = new THREE.Vector4();
  private scissor = new THREE.Vector4();
  private enabled = true;
  passes = 0;
  private rays = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { uDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uStrength: { value: 0 }, uSunColor: { value: new THREE.Color() } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: /* glsl */ `
      uniform sampler2D uDepth;
      uniform vec2 uSun;
      uniform float uStrength;
      uniform vec3 uSunColor;
      varying vec2 vUv;
      void main() {
        vec2 stepUV = (uSun - vUv) / 12.0;
        vec2 uv = vUv;
        float light = 0.0, weight = 1.0;
        for (int i = 0; i < 12; i++) {
          uv += stepUV;
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          float sky = step(.99998, textureLod(uDepth, clamp(uv, 0.0, 1.0), 0.0).r);
          light += sky * weight * inside;
          weight *= .9;
        }
        float radial = 1.0 - smoothstep(.05, 1.2, length(vUv - uSun));
        gl_FragColor = vec4(uSunColor * light * radial * uStrength / 12.0, 1.0);
      }`,
  });
  private add = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    uniforms: { uRays: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D uRays; varying vec2 vUv; void main(){gl_FragColor=vec4(texture2D(uRays,vUv).rgb,1.);}',
  });
  constructor(private renderer: THREE.WebGLRenderer, private env: Environment, quality: Quality['name']) { this.setQuality(quality); }
  setQuality(quality: Quality['name']) {
    this.enabled = quality === 'high' || quality === 'ultra';
    if (!this.enabled) { this.target?.dispose(); this.target = undefined; this.add.uniforms.uRays.value = null; }
  }
  readonly render = (color: THREE.WebGLRenderTarget, depth: THREE.DepthTexture, camera: THREE.PerspectiveCamera) => {
    const e = this.env.sunElevation;
    const strength = THREE.MathUtils.smoothstep(e, -2, 2) * (1 - THREE.MathUtils.smoothstep(e, 6, 18)) * (1 - this.env.overcast) * .13;
    if (!this.enabled || strength <= .001 || camera.getWorldDirection(this.forward).dot(this.env.sunDirection) <= .05) return;
    this.projected.copy(this.env.sunDirection).multiplyScalar(10000).add(camera.position).project(camera);
    const x = this.projected.x * .5 + .5, y = this.projected.y * .5 + .5;
    if (x < -.25 || x > 1.25 || y < -.25 || y > 1.25) return;
    const w = Math.max(1, Math.min(960, Math.ceil(color.width / 4))), h = Math.max(1, Math.min(540, Math.ceil(color.height / 4)));
    if (!this.target) this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    else if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const r = this.renderer, previous = r.getRenderTarget(), autoClear = r.autoClear, scissorTest = r.getScissorTest();
    r.getViewport(this.viewport); r.getScissor(this.scissor);
    try {
      this.rays.uniforms.uDepth.value = depth;
      this.rays.uniforms.uSun.value.set(x, y);
      this.rays.uniforms.uStrength.value = strength;
      this.rays.uniforms.uSunColor.value.copy(this.env.sunColor);
      this.quad.material = this.rays;
      r.autoClear = true; r.setRenderTarget(this.target); this.quad.render(r);
      this.add.uniforms.uRays.value = this.target.texture;
      this.quad.material = this.add;
      r.autoClear = false; r.setRenderTarget(color); this.quad.render(r);
      this.passes++;
    } finally {
      r.autoClear = autoClear; r.setRenderTarget(previous); r.setViewport(this.viewport); r.setScissor(this.scissor); r.setScissorTest(scissorTest);
    }
  };
  get size() { return this.target ? { width: this.target.width, height: this.target.height } : null; }
  dispose() { this.target?.dispose(); this.target = undefined; this.rays.dispose(); this.add.dispose(); this.quad.dispose(); }
}
