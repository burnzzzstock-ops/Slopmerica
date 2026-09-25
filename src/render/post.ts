// Post-processing. High quality: MSAA HDR render -> threshold bloom (only the
// sun, lightning and night emissives clear the bar) -> one final pass that tone
// maps (same ACES as the renderer), grades per season/weather, and adds a
// vignette, optional tilt-shift, heat shimmer and the lightning flash.
// Low quality renders straight to the screen with no post at all.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { Quality } from '../config';

/** The grade the weather wants. WeatherSystem writes it; PostFX reads it every frame. */
export interface GradeParams {
  exposure: number;
  contrast: number;
  saturation: number;
  warmth: number; // -1 cool .. +1 warm
  tint: number; // -1 green .. +1 magenta
  lift: THREE.Color; // added to the shadows
  vignette: number;
  shimmer: number; // heat haze distortion 0..1
  flash: number; // lightning 0..1
  bloom: number; // bloom strength multiplier
  night: number;
}

export function newGrade(): GradeParams {
  return { exposure: 1, contrast: 1.04, saturation: 1.06, warmth: 0, tint: 0, lift: new THREE.Color(0, 0, 0), vignette: 0.28, shimmer: 0, flash: 0, bloom: 1, night: 0 };
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uToneExposure: { value: 1 },
    uExposure: { value: 1 },
    uContrast: { value: 1 },
    uSat: { value: 1 },
    uWarm: { value: 0 },
    uTint: { value: 0 },
    uLift: { value: new THREE.Color() },
    uVig: { value: 0.3 },
    uShimmer: { value: 0 },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uTilt: { value: 0 },
    uTiltFocus: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uToneExposure, uExposure, uContrast, uSat, uWarm, uTint, uVig, uShimmer, uFlash, uTime, uTilt, uTiltFocus;
    uniform vec3 uLift;
    varying vec2 vUv;
    // Same ACES fit three.js uses, so post and no-post look alike.
    vec3 postRRTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 postAces(vec3 color) {
      const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= uToneExposure / 0.6;
      color = ACESInputMat * color;
      color = postRRTFit(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 postSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      if (uShimmer > 0.001) {
        float s = uShimmer * (0.35 + 0.65 * smoothstep(0.75, 0.3, uv.y));
        uv += vec2(sin(uv.y * 160.0 + uTime * 7.0) + sin(uv.y * 57.0 - uTime * 4.0), cos(uv.x * 110.0 + uTime * 6.0)) * 0.0007 * s;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uTilt > 0.001) {
        float r = smoothstep(0.07, 0.4, abs(uv.y - uTiltFocus)) * uTilt * 10.0;
        if (r > 0.35) {
          vec3 acc = c; float wsum = 1.0;
          for (int i = 1; i < 14; i++) {
            float fi = float(i);
            float a = fi * 2.39996;
            vec2 o = vec2(cos(a), sin(a)) * sqrt(fi / 13.0) * r / uRes;
            acc += texture2D(tDiffuse, uv + o).rgb; wsum += 1.0;
          }
          c = acc / wsum;
        }
      }
      c += c * uFlash * 1.4 + vec3(0.02, 0.025, 0.045) * uFlash;
      c *= uExposure;
      c *= vec3(1.0 + uWarm * 0.25, 1.0 + uWarm * 0.04 - uTint * 0.12, 1.0 - uWarm * 0.3);
      c = postAces(max(c, vec3(0.0)));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, uSat), vec3(0.0));
      c = postSRGB(clamp(c, 0.0, 1.0));
      c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
      c += uLift * (1.0 - c);
      vec2 q = vUv - 0.5;
      q.x *= uRes.x / uRes.y * 0.75;
      c *= 1.0 - smoothstep(0.2, 0.95, length(q)) * uVig;
      c += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class PostFX {
  /** Grade inputs (WeatherSystem writes these when it's given this PostFX). */
  readonly grade: GradeParams = newGrade();
  /** Optional looks. */
  vignette = true;
  tiltShift = false;
  /** Screen height (0 bottom .. 1 top) of the in-focus band for tilt-shift. */
  tiltFocus = 0.45;
  readonly enabled: boolean;
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  private final?: ShaderPass;
  private size = new THREE.Vector2();
  private lastW = 0;
  private lastH = 0;
  private lastPR = 0;
  private time = 0;
  private lastNow = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, q: Quality) {
    this.enabled = q.post;
    if (!q.post) return;
    const samples = Math.min(4, renderer.capabilities.maxSamples || 0);
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 1.6);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.final.renderToScreen = true;
    // this pass does its own tone mapping + sRGB; keep three from adding another
    (this.final.material as THREE.ShaderMaterial).toneMapped = false;
    this.composer.addPass(this.final);
    this.syncSize();
  }

  private syncSize() {
    if (!this.composer) return;
    this.renderer.getSize(this.size);
    const pr = this.renderer.getPixelRatio();
    if (this.size.x === this.lastW && this.size.y === this.lastH && pr === this.lastPR) return;
    this.lastW = this.size.x;
    this.lastH = this.size.y;
    this.lastPR = pr;
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.size.x, this.size.y);
    (this.final!.uniforms.uRes.value as THREE.Vector2).set(this.size.x * pr, this.size.y * pr);
  }

  setSize(w: number, h: number) {
    if (!this.composer) return;
    this.renderer.getSize(this.size);
    this.lastW = w;
    this.lastH = h;
    this.lastPR = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(this.lastPR);
    this.composer.setSize(w, h);
    (this.final!.uniforms.uRes.value as THREE.Vector2).set(w * this.lastPR, h * this.lastPR);
  }

  /** night: 0 day .. 1 night (bloom strength etc.) */
  render(night: number) {
    if (!this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.syncSize();
    const now = performance.now() / 1000;
    const dt = this.lastNow ? Math.min(0.1, now - this.lastNow) : 0;
    this.lastNow = now;
    this.time += dt;
    const g = this.grade;
    const n = Math.max(night, g.night);
    const b = this.bloom!;
    b.threshold = THREE.MathUtils.lerp(1.6, 0.55, n);
    b.strength = THREE.MathUtils.lerp(0.22, 0.85, n) * g.bloom + g.flash * 0.4;
    b.radius = THREE.MathUtils.lerp(0.35, 0.6, n);
    const u = this.final!.uniforms;
    u.uToneExposure.value = this.renderer.toneMappingExposure;
    u.uExposure.value = g.exposure;
    u.uContrast.value = g.contrast;
    u.uSat.value = g.saturation;
    u.uWarm.value = g.warmth;
    u.uTint.value = g.tint;
    (u.uLift.value as THREE.Color).copy(g.lift);
    u.uVig.value = this.vignette ? g.vignette : 0;
    u.uShimmer.value = g.shimmer;
    u.uFlash.value = g.flash;
    u.uTime.value = this.time;
    u.uTilt.value = this.tiltShift ? 1 : 0;
    u.uTiltFocus.value = this.tiltFocus;
    this.composer.render(dt);
  }

  dispose() {
    this.composer?.dispose();
    this.bloom?.dispose();
  }
}
