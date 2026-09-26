// Post-processing. High quality renders the scene into a multisampled HDR
// target, adds screen-space ambient occlusion (half-res, depth-aware blur),
// bloom for lights and glints, then a filmic grade + ACES tone map + vignette.
// Low quality (phones) renders straight to the canvas.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GLOW, type Quality } from '../config';

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
      void main() {
        // AO runs at half resolution: every half-res pixel centre lands exactly
        // on the edge between two full-res depth texels, and rounding picked
        // one row or the other in slow bands (moire stripes that moved with the
        // window size and zoom). Read depth at full-res texel centres.
        vec2 px = 1.0 / uFull;
        vec2 uv0 = (floor(vUv * uFull) + 0.5) * px;
        float d0 = texture2D(tDepth, uv0).r;
        if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
        vec3 P = viewPos(uv0);
        vec3 Pr = viewPos(uv0 + vec2(px.x, 0.0)), Pl = viewPos(uv0 - vec2(px.x, 0.0));
        vec3 Pu = viewPos(uv0 + vec2(0.0, px.y)), Pd = viewPos(uv0 - vec2(0.0, px.y));
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
        // interleaved gradient noise: a per-pixel rotation made to be blurred
        // away (a general-purpose hash left row-periodic stripes after the blur)
        float a0 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
        float sum = 0.0;
        float r2 = r * r;
        for (int i = 0; i < SAMPLES; i++) {
          float t = (float(i) + 0.5) / float(SAMPLES);
          float ang = a0 + t * 7.0 * 6.2831853;
          vec2 off = vec2(cos(ang), sin(ang)) * t * rPx * px;
          vec3 S = viewPos((floor((uv0 + off) * uFull) + 0.5) * px);
          vec3 v = S - P;
          float vv = dot(v, v);
          float vl = sqrt(vv) + 1e-4;
          // angle bias: shallow creases (the facets of rolling terrain) aren't
          // occluders; walls, trees and kerbs meeting the ground are. Without it
          // open ground came out blotchy at every quality (the playtest's
          // "spotting").
          float cosA = (dot(v, N) - 0.0002 * -P.z) / vl;
          float f = max(r2 - vv, 0.0);
          sum += f * f * f * max(cosA - 0.3, 0.0) / (0.7 * max(vl, 0.6));
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
      // depth at full-res texel centres (see the AO pass)
      float depthAt(vec2 uv) { vec2 f = vec2(textureSize(tDepth, 0)); return texture2D(tDepth, (floor(uv * f) + 0.5) / f).r; }
      void main() {
        float z0 = lin(depthAt(vUv));
        float acc = 0.0, wsum = 0.0;
        for (int i = -4; i <= 4; i++) {
          vec2 uv = vUv + uDir * float(i);
          float z = lin(depthAt(uv));
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

/** Temporal AA resolve: this frame (drawn with a sub-pixel jitter) blended
 * with the last result, reprojected through the depth buffer and clamped to
 * this frame's 3x3 neighbourhood so moving things don't smear. */
const taaMat = () =>
  new THREE.ShaderMaterial({
    uniforms: { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uHasHist: { value: 0 }, uBlend: { value: 0.12 } },
    vertexShader: FSQ_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tCur, tHist, tDepth;
      uniform mat4 uInvViewProj, uPrevViewProj;
      uniform vec2 uTexel;
      uniform float uHasHist, uBlend;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tCur, vUv).rgb;
        vec3 mn = c, mx = c;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec3 n = texture2D(tCur, vUv + vec2(float(i), float(j)) * uTexel).rgb;
          mn = min(mn, n); mx = max(mx, n);
        }
        float d = texture2D(tDepth, vUv).r;
        vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        wp /= wp.w;
        vec4 pp = uPrevViewProj * wp;
        vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
        vec3 o = c;
        if (uHasHist > 0.5 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) {
          vec3 h = clamp(texture2D(tHist, puv).rgb, mn, mx);
          o = mix(h, c, uBlend);
        }
        gl_FragColor = vec4(o, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

const copyMat = () =>
  new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null } },
    vertexShader: FSQ_VERT,
    fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }',
    depthTest: false,
    depthWrite: false,
  });

/** Anti-aliasing: multisampling of the scene target, or temporal. */
export type AAMode = 'none' | 'msaa4' | 'msaa8' | 'taa';
const HALTON: [number, number][] = [[0.5, 0.333], [0.25, 0.667], [0.75, 0.111], [0.125, 0.444], [0.625, 0.778], [0.375, 0.222], [0.875, 0.556], [0.0625, 0.889]];

const gradeMat = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      uExposure: { value: 1 },
      uToneExposure: { value: 0.95 },
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
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      // The grade owns its tone curve and display encoding (three's ACES
      // Filmic, the same numbers), so it gives the same picture whether it
      // draws to the screen or into a buffer (three only injects its tone
      // mapping for the screen).
      uniform float uToneExposure;
      vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 acesFilm(vec3 color) {
        const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        color *= uToneExposure / 0.6;
        return clamp(outM * rrtOdt(inM * color), 0.0, 1.0);
      }
      vec3 srgbEncode(vec3 c) { return mix(c * 12.92, pow(max(c, vec3(0.0031308)), vec3(0.41666)) * 1.055 - 0.055, step(vec3(0.0031308), c)); }
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
        c = acesFilm(c);
        // grade in display space so contrast doesn't crush the shadows
        c = srgbEncode(clamp(c, 0.0, 1.0));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uContrast + 0.5;
        c = max(c, 0.0) + uLift * (1.0 - c);
        vec2 q = vUv - 0.5;
        c *= 1.0 - uVignette * smoothstep(0.2, 0.85, dot(q, q) * 2.2);
        vec4 o = vec4(clamp(c, 0.0, 1.0), 1.0);
        // a whisper of grain so gradients (sky, fog) don't band
        o.rgb += (hash(gl_FragCoord.xy + fract(uTime * 0.618) * 97.0) - 0.5) / 255.0;
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
  private taaM = taaMat();
  private copyM = copyMat();
  private ldrRT?: THREE.WebGLRenderTarget;
  private hist: THREE.WebGLRenderTarget[] = [];
  private hasHist = false;
  private jitterN = 0;
  private prevViewProj = new THREE.Matrix4();
  private tmpM = new THREE.Matrix4();
  /** bloom can be switched off (anti-aliasing comparisons) */
  bloomOn = true;
  aaMode: AAMode = 'msaa4';
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

  /** switch anti-aliasing (MSAA samples on the scene target, or temporal) */
  setAA(mode: AAMode) {
    if (!this.enabled) return;
    this.aaMode = mode;
    const n = mode === 'msaa4' ? 4 : mode === 'msaa8' ? Math.min(8, this.renderer.capabilities.maxSamples) : 0;
    if (this.sceneRT!.samples !== n) { this.sceneRT!.samples = n; this.sceneRT!.dispose(); }
    this.hasHist = false;
    if (mode === 'taa' && !this.ldrRT) {
      const w = this.sceneRT!.width, h = this.sceneRT!.height;
      const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
      this.ldrRT = mk();
      this.hist = [mk(), mk()];
    }
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
    this.ldrRT?.setSize(w, h);
    for (const t of this.hist) t.setSize(w, h);
    this.hasHist = false;
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
    const taa = this.aaMode === 'taa' && !!this.ldrRT;
    if (taa) {
      // a different sub-pixel offset each frame; the resolve averages them
      const [jx, jy] = HALTON[this.jitterN++ % HALTON.length];
      const W = this.sceneRT!.width, H = this.sceneRT!.height;
      cam.setViewOffset(W, H, jx - 0.5, jy - 0.5, W, H);
    }
    r.setRenderTarget(this.sceneRT!);
    r.render(this.scene, cam);
    if (taa) cam.clearViewOffset();

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
    // bloom with a threshold, a strength that doesn't grow with the night
    // exposure lift (GLOW), and a tighter radius after dark: lamps glow, they
    // don't become white discs
    bl.strength = (0.1 + night * 0.28) * GLOW.value + this.look.flash * 0.35;
    bl.threshold = 1.1 + (1 - night) * 4;
    bl.radius = 0.3 - night * 0.12;
    if (this.bloomOn) bl.render(r, this.hdrRT!, this.hdrRT!, 0, false);

    const g = this.gradeM.uniforms;
    g.tColor.value = this.hdrRT!.texture;
    g.uExposure.value = this.look.exposure;
    g.uToneExposure.value = r.toneMappingExposure;
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
    r.setRenderTarget(taa ? this.ldrRT! : null);
    this.quad.render(r);
    if (!taa) return;
    // temporal resolve into the next history buffer, then show it
    const t = this.taaM.uniforms;
    const out = this.hist[this.jitterN & 1], prev = this.hist[(this.jitterN + 1) & 1];
    const viewProj = this.tmpM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    t.tCur.value = this.ldrRT!.texture;
    t.tHist.value = prev.texture;
    t.tDepth.value = this.sceneRT!.depthTexture;
    t.uInvViewProj.value.copy(viewProj).invert();
    t.uPrevViewProj.value.copy(this.prevViewProj);
    t.uTexel.value.set(1 / this.ldrRT!.width, 1 / this.ldrRT!.height);
    t.uHasHist.value = this.hasHist ? 1 : 0;
    this.quad.material = this.taaM;
    r.setRenderTarget(out);
    this.quad.render(r);
    this.prevViewProj.copy(viewProj);
    this.hasHist = true;
    this.copyM.uniforms.tSrc.value = out.texture;
    this.quad.material = this.copyM;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
