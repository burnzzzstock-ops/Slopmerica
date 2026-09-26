// Post-processing. High quality renders the scene into a multisampled HDR
// target, adds screen-space ambient occlusion (half-res, depth-aware blur),
// bloom for lights and glints, then a filmic grade + ACES tone map + vignette.
// Low quality (phones) renders straight to the canvas.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Quality } from '../config';

const AO_SAMPLES = 12;
const FSQ_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const aoMat = () =>
  new THREE.ShaderMaterial({
    defines: { SAMPLES: AO_SAMPLES },
    uniforms: {
      tDepth: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uInvProj: { value: new THREE.Matrix4() },
      uFull: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 4 },
      uIntensity: { value: 1 },
      uFade: { value: new THREE.Vector2(1500, 4000) },
    },
    vertexShader: FSQ_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDepth;
      uniform mat4 uProj, uInvProj;
      uniform vec2 uFull, uFade;
      uniform float uRadius, uIntensity;
      varying vec2 vUv;
      vec3 viewPos(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return v.xyz / v.w;
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float d0 = texture2D(tDepth, vUv).r;
        if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
        vec3 P = viewPos(vUv);
        vec2 px = 1.0 / uFull;
        vec3 Pr = viewPos(vUv + vec2(px.x, 0.0)), Pl = viewPos(vUv - vec2(px.x, 0.0));
        vec3 Pu = viewPos(vUv + vec2(0.0, px.y)), Pd = viewPos(vUv - vec2(0.0, px.y));
        vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
        vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
        // flat depth makes the cross product zero, and normalize(0) is NaN on
        // some GPUs (Direct3D): skip those pixels instead
        vec3 cr = cross(dx, dy);
        float cl = dot(cr, cr);
        if (!(cl > 1e-24)) { gl_FragColor = vec4(1.0); return; }
        vec3 N = cr * inversesqrt(cl);
        if (N.z < 0.0) N = -N;
        float r = uRadius;
        float rPx = r * uProj[1][1] * 0.5 * uFull.y / -P.z;
        if (rPx < 1.5) { gl_FragColor = vec4(1.0); return; }
        rPx = min(rPx, 90.0);
        float a0 = hash(gl_FragCoord.xy) * 6.2831853;
        float sum = 0.0;
        float r2 = r * r;
        for (int i = 0; i < SAMPLES; i++) {
          float t = (float(i) + 0.5) / float(SAMPLES);
          float ang = a0 + t * 7.0 * 6.2831853;
          vec2 off = vec2(cos(ang), sin(ang)) * t * rPx * px;
          vec3 S = viewPos(vUv + off);
          vec3 v = S - P;
          float vv = dot(v, v);
          float vn = dot(v, N);
          float f = max(r2 - vv, 0.0);
          sum += f * f * f * max((vn - 0.0002 * -P.z) / (0.01 + vv), 0.0);
        }
        float ao = max(0.0, 1.0 - sum * uIntensity * 5.0 / (float(SAMPLES) * r2 * r2 * r2));
        ao = mix(1.0, ao, 1.0 - smoothstep(uFade.x, uFade.y, -P.z));
        gl_FragColor = vec4(ao, ao, ao, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

const blurMat = () =>
  new THREE.ShaderMaterial({
    uniforms: { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uNear: { value: 1 }, uFar: { value: 1000 } },
    vertexShader: FSQ_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tAO, tDepth;
      uniform vec2 uDir;
      uniform float uNear, uFar;
      varying vec2 vUv;
      float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
      void main() {
        float z0 = lin(texture2D(tDepth, vUv).r);
        float acc = 0.0, wsum = 0.0;
        for (int i = -4; i <= 4; i++) {
          vec2 uv = vUv + uDir * float(i);
          float z = lin(texture2D(tDepth, uv).r);
          float w = exp(-float(i * i) / 12.0) * exp(-abs(z - z0) / (0.03 * z0 + 0.1));
          acc += texture2D(tAO, uv).r * w;
          wsum += w;
        }
        float a = acc / wsum;
        gl_FragColor = vec4(a, a, a, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

const compositeMat = () =>
  new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tAO: { value: null }, uAO: { value: 1 } },
    vertexShader: FSQ_VERT,
    // Also the frame's firewall: one NaN or Inf pixel from any material would
    // be smeared across the whole screen by bloom's blur and turn it black.
    // Bad pixels take their neighbours' colour; brightness is capped well
    // inside half-float range.
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor, tAO;
      uniform float uAO;
      varying vec2 vUv;
      // NaN and ±Inf have every exponent bit set; tested on the bits so no
      // shader compiler can optimise the check away
      bool finite(float x) { return (floatBitsToUint(x) & 0x7f800000u) != 0x7f800000u; }
      bool finite3(vec3 c) { return finite(c.r) && finite(c.g) && finite(c.b); }
      void main() {
        vec3 c = texture2D(tColor, vUv).rgb;
        if (!finite3(c)) {
          vec2 px = 1.0 / vec2(textureSize(tColor, 0));
          vec3 acc = vec3(0.0); float n = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = i == 0 ? vec2(px.x, 0.0) : i == 1 ? vec2(-px.x, 0.0) : i == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
            vec3 s = texture2D(tColor, vUv + o).rgb;
            if (finite3(s)) { acc += s; n += 1.0; }
          }
          c = n > 0.0 ? acc / n : vec3(0.0);
        }
        float ao = texture2D(tAO, vUv).r;
        if (!finite(ao)) ao = 1.0;
        ao = mix(1.0, ao, uAO);
        gl_FragColor = vec4(clamp(c * ao, 0.0, 4096.0), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

const gradeMat = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      uExposure: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSat: { value: 1.08 },
      uContrast: { value: 1.06 },
      uVignette: { value: 0.28 },
      uLift: { value: new THREE.Color(0, 0, 0) },
      uTime: { value: 0 },
      uShimmer: { value: 0 },
      uFlash: { value: 0 },
      uTilt: { value: 0 },
      uFocus: { value: 0.45 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: FSQ_VERT,
    fragmentShader: /* glsl */ `
      // three prepends the tone mapping + color space helpers to ShaderMaterials
      uniform sampler2D tColor;
      uniform vec3 uTint, uLift;
      uniform float uSat, uContrast, uVignette, uTime, uExposure, uShimmer, uFlash, uTilt, uFocus;
      uniform vec2 uRes;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        // heat shimmer: a rippling refraction, strongest low on screen near the ground
        if (uShimmer > 0.001) {
          float s = uShimmer * (0.35 + 0.65 * smoothstep(0.75, 0.3, uv.y));
          uv += vec2(sin(uv.y * 160.0 + uTime * 0.11) + sin(uv.y * 57.0 - uTime * 0.07), cos(uv.x * 110.0 + uTime * 0.09)) * 0.0007 * s;
        }
        vec3 src = texture2D(tColor, uv).rgb;
        // optional tilt-shift: a golden-angle blur outside the in-focus band
        if (uTilt > 0.001) {
          float r = smoothstep(0.07, 0.4, abs(uv.y - uFocus)) * uTilt * 10.0;
          if (r > 0.35) {
            vec3 acc = src; float wsum = 1.0;
            for (int i = 1; i < 14; i++) {
              float fi = float(i);
              float a = fi * 2.39996;
              acc += texture2D(tColor, uv + vec2(cos(a), sin(a)) * sqrt(fi / 13.0) * r / uRes).rgb;
              wsum += 1.0;
            }
            src = acc / wsum;
          }
        }
        // lightning: the whole frame jumps toward a cold white
        src += src * uFlash * 1.2 + vec3(0.02, 0.025, 0.045) * uFlash;
        vec3 c = src * uTint * uExposure;
        c = ACESFilmicToneMapping(c);
        // grade in display space so contrast doesn't crush the shadows
        c = sRGBTransferOETF(vec4(clamp(c, 0.0, 1.0), 1.0)).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uContrast + 0.5;
        c = max(c, 0.0) + uLift * (1.0 - c);
        vec2 q = vUv - 0.5;
        c *= 1.0 - uVignette * smoothstep(0.2, 0.85, dot(q, q) * 2.2);
        vec4 o = vec4(clamp(c, 0.0, 1.0), 1.0);
        // a whisper of grain so gradients (sky, fog) don't band
        o.rgb += (fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = o;
      }`,
    depthTest: false,
    depthWrite: false,
  });

/** The grade WeatherSystem writes each frame (weather + season + heat shimmer + lightning). */
export interface PostLook {
  tint: THREE.Color;
  sat: number;
  contrast: number;
  lift: THREE.Color;
  exposure: number;
  /** heat-haze distortion 0..1 */
  shimmer: number;
  /** lightning flash 0..1 */
  flash: number;
}

export class PostFX {
  readonly enabled: boolean;
  /** why the effects were switched off at runtime (see Game.checkBlackFrame), or null */
  offReason: string | null = null;
  /** effects are on and haven't been switched off */
  get active() { return this.enabled && !this.offReason; }
  /** fall back to drawing the scene straight to the screen */
  turnOff(reason: string) { this.offReason = reason; }
  /** Optional looks (dev lab / photo mode). */
  vignette = true;
  tiltShift = false;
  /** Screen height (0 bottom .. 1 top) of the in-focus band for tilt-shift. */
  tiltFocus = 0.45;
  private ao: boolean;
  private aoScale: number;
  private sceneRT?: THREE.WebGLRenderTarget;
  private aoRT?: THREE.WebGLRenderTarget;
  private aoRT2?: THREE.WebGLRenderTarget;
  private hdrRT?: THREE.WebGLRenderTarget;
  private bloom?: UnrealBloomPass;
  private quad = new FullScreenQuad();
  private aoM = aoMat();
  private blurM = blurMat();
  private compM = compositeMat();
  private gradeM = gradeMat();
  /** Weather/season look, set by the weather system each frame. */
  readonly look: PostLook = { tint: new THREE.Color(1, 1, 1), sat: 1.0, contrast: 1.06, lift: new THREE.Color(0, 0, 0), exposure: 1, shimmer: 0, flash: 0 };
  /** World-space AO radius; the game scales it with zoom. */
  aoRadius = 4;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, q: Quality) {
    this.enabled = q.post && renderer.capabilities.isWebGL2;
    this.ao = q.ao;
    this.aoScale = q.aoFull ? 1 : 0.5;
    if (!this.enabled) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    this.sceneRT.depthTexture!.minFilter = this.sceneRT.depthTexture!.magFilter = THREE.NearestFilter;
    this.hdrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    const aw = Math.max(1, Math.floor(w * this.aoScale)), ah = Math.max(1, Math.floor(h * this.aoScale));
    this.aoRT = new THREE.WebGLRenderTarget(aw, ah, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.aoRT2 = this.aoRT.clone();
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.3, 0.92);
  }

  setSize(cssW: number, cssH: number) {
    if (!this.enabled) return;
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(cssW * pr)), h = Math.max(1, Math.floor(cssH * pr));
    this.sceneRT!.setSize(w, h);
    this.hdrRT!.setSize(w, h);
    this.aoRT!.setSize(Math.max(1, Math.floor(w * this.aoScale)), Math.max(1, Math.floor(h * this.aoScale)));
    this.aoRT2!.setSize(Math.max(1, Math.floor(w * this.aoScale)), Math.max(1, Math.floor(h * this.aoScale)));
    this.bloom!.setSize(w, h);
  }

  /** night: 0 day .. 1 night (bloom strength etc.) */
  render(night: number) {
    const r = this.renderer;
    if (!this.active) {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      return;
    }
    const cam = this.camera;
    r.setRenderTarget(this.sceneRT!);
    r.render(this.scene, cam);

    let aoTex: THREE.Texture | null = null;
    if (this.ao) {
      const u = this.aoM.uniforms;
      u.tDepth.value = this.sceneRT!.depthTexture;
      u.uProj.value.copy(cam.projectionMatrix);
      u.uInvProj.value.copy(cam.projectionMatrixInverse);
      u.uFull.value.set(this.sceneRT!.width, this.sceneRT!.height);
      u.uRadius.value = this.aoRadius;
      u.uIntensity.value = 1.35;
      u.uFade.value.set(this.aoRadius * 120, this.aoRadius * 320);
      this.quad.material = this.aoM;
      r.setRenderTarget(this.aoRT!);
      this.quad.render(r);
      const b = this.blurM.uniforms;
      b.tDepth.value = this.sceneRT!.depthTexture;
      b.uNear.value = cam.near;
      b.uFar.value = cam.far;
      this.quad.material = this.blurM;
      b.tAO.value = this.aoRT!.texture;
      b.uDir.value.set(1 / this.aoRT!.width, 0);
      r.setRenderTarget(this.aoRT2!);
      this.quad.render(r);
      b.tAO.value = this.aoRT2!.texture;
      b.uDir.value.set(0, 1 / this.aoRT!.height);
      r.setRenderTarget(this.aoRT!);
      this.quad.render(r);
      aoTex = this.aoRT!.texture;
    }

    const c = this.compM.uniforms;
    c.tColor.value = this.sceneRT!.texture;
    c.tAO.value = aoTex ?? this.sceneRT!.texture;
    c.uAO.value = aoTex ? 1 : 0;
    this.quad.material = this.compM;
    r.setRenderTarget(this.hdrRT!);
    this.quad.render(r);

    const bl = this.bloom!;
    // HDR input: only real light sources and sun glints should bloom
    bl.strength = 0.1 + night * 0.35 + this.look.flash * 0.35;
    bl.threshold = 0.9 + (1 - night) * 4;
    bl.render(r, this.hdrRT!, this.hdrRT!, 0, false);

    const g = this.gradeM.uniforms;
    g.tColor.value = this.hdrRT!.texture;
    g.uExposure.value = this.look.exposure;
    g.uTint.value.copy(this.look.tint);
    g.uSat.value = this.look.sat;
    g.uContrast.value = this.look.contrast;
    g.uLift.value.copy(this.look.lift);
    g.uVignette.value = this.vignette ? 0.26 : 0;
    g.uTime.value = (g.uTime.value + 1.37) % 1000;
    g.uShimmer.value = this.look.shimmer;
    g.uFlash.value = this.look.flash;
    g.uTilt.value = this.tiltShift ? 1 : 0;
    g.uFocus.value = this.tiltFocus;
    g.uRes.value.set(this.hdrRT!.width, this.hdrRT!.height);
    this.quad.material = this.gradeM;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
