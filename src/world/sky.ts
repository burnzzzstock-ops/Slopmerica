// Sky dome, sun + moon, stars + Milky Way, height fog and the day/night cycle.
// The sun follows the season (low and short in winter), the moon runs through
// its phases, and the stars and Milky Way fade as light pollution rises. The sky
// is also baked into a PMREM environment map (refreshed as the light changes)
// so every standard material gets sky-colored ambient light and reflections.
// WeatherSystem writes the weather inputs (overcast, fogMul, smoke, mist...)
// and dayOfYear each frame; the sky never reads the weather system directly.
import * as THREE from 'three';
import type { MapDef } from './maps';
import type { Quality } from '../config';
import { atmo, latitudeOf } from './seasons';
import { ATMOS } from './atmos';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ height fog
/**
 * Scene fog with a ground-hugging mist layer. It is a FogExp2 (so `fog.color`
 * and `fog.density` behave as usual), but it also reports `isFog`, which makes
 * three upload `near`/`far` too. We pack the mist parameters into those two
 * floats; the patched fog chunks below decode them when `far < 0`. Materials
 * compiled against a plain FogExp2 keep the stock exp2 behaviour.
 */
export class AtmoFog extends THREE.FogExp2 {
  readonly isFog = true;
  near = 0.0004;
  far = -1;
  /** Ground mist amount (0 none .. ~8 pea soup). */
  mist = 0;
  /** Mist scale height in meters. */
  mistHeight = 30;
  pack() {
    this.near = this.density;
    const m = Math.round(Math.min(9.99, Math.max(0, this.mist)) * 100);
    const h = Math.round(Math.min(999, Math.max(1, this.mistHeight)));
    this.far = -(m * 1000 + h);
  }
}

let fogPatched = false;
function patchFogChunks() {
  if (fogPatched) return;
  fogPatched = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  uniform float fogNear;
  uniform float fogFar;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #endif
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor;
    if ( fogFar < 0.0 ) {
      // AtmoFog: exp2 distance haze + an exponential ground-mist layer
      float fogCode = - fogFar;
      float fogMist = floor( fogCode / 1000.0 ) / 100.0;
      float fogH = max( mod( fogCode, 1000.0 ), 1.0 );
      vec3 fogRay = vFogWorld - cameraPosition;
      float fogDist = length( fogRay );
      float fogA = exp( - clamp( cameraPosition.y, -20.0, 4000.0 ) / fogH );
      float fogB = exp( - clamp( vFogWorld.y, -20.0, 4000.0 ) / fogH );
      float fogAvg = abs( fogRay.y ) > 0.05 ? ( fogA - fogB ) * fogH / fogRay.y : fogA;
      float fogHaze = fogNear * fogDist;
      fogFactor = 1.0 - exp( - fogHaze * fogHaze - fogMist * 0.0012 * fogDist * max( fogAvg, 0.0 ) );
    } else {
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    }
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}
patchFogChunks();

// ------------------------------------------------------------------ palettes
type Keys = { e: number; c: THREE.Color }[];
const keys = (pairs: [number, number][]): Keys => pairs.map(([e, hex]) => ({ e, c: new THREE.Color(hex) }));
function sampleKeys(k: Keys, e: number, out: THREE.Color) {
  if (e <= k[0].e) return out.copy(k[0].c);
  for (let i = 1; i < k.length; i++) {
    if (e <= k[i].e) {
      const t = (e - k[i - 1].e) / (k[i].e - k[i - 1].e);
      return out.copy(k[i - 1].c).lerp(k[i].c, t * t * (3 - 2 * t));
    }
  }
  return out.copy(k[k.length - 1].c);
}
function addScaled(target: THREE.Color, c: THREE.Color, s: number) {
  target.r += c.r * s;
  target.g += c.g * s;
  target.b += c.b * s;
  return target;
}
function sampleScalar(k: [number, number][], e: number) {
  if (e <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (e <= k[i][0]) {
      const t = (e - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * t;
    }
  }
  return k[k.length - 1][1];
}

// Colors by sun elevation (degrees). Day horizon is replaced by the map's haze color.
const ZENITH = keys([[-18, 0x010207], [-11, 0x040816], [-6, 0x0e1838], [-2, 0x223470], [2, 0x2f4b8c], [7, 0x3f64a6], [16, 0x4674bb], [35, 0x437ccc], [70, 0x3f7fd4]]);
const HORIZON = keys([[-18, 0x05070d], [-11, 0x0c0f1a], [-6, 0x2c2a44], [-2, 0x7a5466], [1, 0xc77a5a], [4, 0xe0976a], [9, 0xe6bb94], [18, 0xd4d3cd]]);
const SUNCOL = keys([[-3, 0xff3a10], [1, 0xff6a2c], [5, 0xff9650], [11, 0xffbf84], [22, 0xffdfbd], [45, 0xfff1e0], [70, 0xfff6ec]]);
const GLOW = keys([[-12, 0x000000], [-7, 0x2a1420], [-3, 0x9c3c28], [1, 0xff6428], [5, 0xe0783a], [12, 0x5a3a28], [22, 0x000000]]);
const BELT = keys([[-10, 0x000000], [-4, 0x4a3450], [0, 0x80506a], [5, 0x503a40], [12, 0x000000]]);
const SUN_I: [number, number][] = [[-4, 0], [-1, 0.05], [2, 0.55], [6, 1.5], [14, 2.4], [30, 3.0], [60, 3.25]];
const HEMI_I: [number, number][] = [[-16, 0.62], [-8, 0.64], [-3, 0.66], [2, 0.8], [10, 0.95], [30, 1.1]];
const SKY_GAIN: [number, number][] = [[-16, 1.0], [-4, 1.15], [4, 1.3], [20, 1.35]];
const C_HAZE_BLUE = new THREE.Color(0x7fa6d6);

const C_STORM_Z = new THREE.Color(0x0a1a14);
const C_STORM_H = new THREE.Color(0x3e5a47);
const C_SMOKE_Z = new THREE.Color(0x6a3e1c);
const C_SMOKE_H = new THREE.Color(0xc27a36);
const C_SMOKE_SUN = new THREE.Color(0xff2a08);
const C_HEAT_H = new THREE.Color(0xf2d2a2);
const C_HEAT_Z = new THREE.Color(0x9fb8d0);
const C_MIST = new THREE.Color(0xd4dadf);
const C_LP = new THREE.Color(0xff8a3c);
const C_MOON = new THREE.Color(0x9fb4ff);
const C_NIGHT_SKY = new THREE.Color(0x6f86c8);
const C_SNOW_GROUND = new THREE.Color(0xdfe6f0);
const C_FLASH = new THREE.Color(0xc8d4ff);
const C_OVERCAST = new THREE.Color(0xe8edf2);

const C_WHITEOUT = new THREE.Color(0xe2e6ec);

// ------------------------------------------------------------------ shaders
const SKY_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mvPosition = viewMatrix * vec4(cameraPosition + position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w * 0.99999;
  #include <fog_vertex>
}`;

const SKY_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uSunColor, uGlow, uBelt, uCloudLit, uCloudShade, uFlashCol;
uniform float uSunSize, uSunVis, uMoonPhase, uMoonBright, uStars, uCloudCover, uCloudDark, uFlash, uHorizonFog;
uniform vec2 uCloudOffset;
varying vec3 vDir;

float sh2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float sn2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(sh2(i),sh2(i+vec2(1,0)),f.x), mix(sh2(i+vec2(0,1)),sh2(i+vec2(1,1)),f.x), f.y); }
float sfbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*sn2(p); p=p*2.07+vec2(1.7,9.2); a*=0.5; } return s; }
float sh3(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float sn3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(sh3(i),sh3(i+vec3(1,0,0)),f.x), mix(sh3(i+vec3(0,1,0)),sh3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(sh3(i+vec3(0,0,1)),sh3(i+vec3(1,0,1)),f.x), mix(sh3(i+vec3(0,1,1)),sh3(i+vec3(1,1,1)),f.x),f.y), f.z); }

void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;
  float yc = max(y, 0.0);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, pow(yc, 0.38)));

  // warm glow on the sun's side, pink Belt of Venus opposite
  vec2 dxz = normalize(dir.xz + vec2(1e-5));
  vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
  float side = dot(dxz, sxz) * 0.5 + 0.5;
  col += uGlow * pow(side, 5.0) * exp(-yc * 5.0);
  col += uBelt * pow(1.0 - side, 2.0) * exp(-abs(y - 0.07) * 11.0);
  float sd = dot(dir, uSunDir);
  float sdc = max(sd, 0.0);
  col += uSunColor * (pow(sdc, 10.0) * 0.05 + pow(sdc, 90.0) * 0.22) * uSunVis;

  // Milky Way (the stars themselves are Points)
  if (uStars > 0.002) {
    // galactic plane arches ~75 deg up; the bright core sits low, like a summer night
    vec3 gN = normalize(vec3(-0.549, 0.249, 0.798));
    vec3 gCore = normalize(vec3(0.834, 0.222, 0.505));
    float gd = dot(dir, gN); // sine of galactic latitude
    float bulge = pow(max(dot(dir, gCore), 0.0), 6.0);
    float band = exp(-gd * gd * (34.0 - bulge * 18.0)); // thickens toward the core, never a round blob
    float cl = sn3(dir * 9.0) * 0.55 + sn3(dir * 23.0) * 0.3 + sn3(dir * 57.0) * 0.15; // clumpy star clouds
    float rift = smoothstep(0.5, 0.75, sn3(dir * 13.0 + 4.0) * 0.7 + sn3(dir * 31.0) * 0.3) * exp(-gd * gd * 260.0); // dark dust lane
    vec3 mwc = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.86, 0.68), bulge);
    col += mwc * band * (0.25 + 0.75 * cl * cl) * (1.0 + bulge * 1.5) * (1.0 - rift * 0.85) * uStars * 0.065 * smoothstep(0.0, 0.25, y);
  }

  // moon with a proper phase terminator
  float md = dot(dir, uMoonDir);
  if (uMoonBright > 0.0 && md > 0.99) {
    vec3 up = abs(uMoonDir.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 mu = normalize(cross(up, uMoonDir));
    vec3 mv = cross(uMoonDir, mu);
    float mr = 0.021;
    vec2 q = vec2(dot(dir, mu), dot(dir, mv)) / mr;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      vec3 nrm = vec3(q, sqrt(1.0 - r2));
      float a = uMoonPhase * 6.2831853;
      vec3 L = vec3(-sin(a), 0.0, -cos(a));
      float lit = smoothstep(-0.04, 0.1, dot(nrm, L));
      float maria = 0.72 + 0.28 * (sn2(q * 2.1 + 4.0) * 0.6 + sn2(q * 5.3 + 1.0) * 0.4);
      vec3 mc = vec3(1.0, 0.96, 0.88) * maria * (lit * uMoonBright + 0.015 * uMoonBright);
      col = mix(col, mc, smoothstep(1.0, 0.9, r2));
    }
  }
  // halo follows the lit fraction, so a new moon doesn't glow
  float mIllum = 0.5 - 0.5 * cos(uMoonPhase * 6.2831853);
  col += vec3(0.55, 0.65, 0.9) * (pow(max(md, 0.0), 900.0) * 0.35 + pow(max(md, 0.0), 40.0) * 0.03) * uMoonBright * (0.04 + 0.96 * mIllum);

  // sun disc
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.8), sd);
  col += uSunColor * disc * 24.0 * uSunVis;

  // clouds: a noise field projected onto a plane overhead
  float cloud = 0.0;
  if (uCloudCover > 0.01 && y > -0.02) {
    float yy = yc + 0.07;
    vec2 cp = dir.xz / yy * 1.35 + uCloudOffset;
    float n = sfbm(cp);
    float cov = uCloudCover;
    float c = smoothstep(1.0 - cov * 0.95 - 0.12, 1.0 - cov * 0.95 + 0.26, n);
    float nl = sfbm(cp + sxz * 0.16);
    float lit = clamp(0.55 + (n - nl) * 3.2, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSunColor * pow(sdc, 5.0) * (1.0 - smoothstep(0.3, 0.9, c)) * 0.35 * uSunVis;
    cc = mix(cc, uCloudShade * 0.55, uCloudDark * smoothstep(0.4, 1.0, c));
    cloud = c * smoothstep(-0.02, 0.1, y);
    col = mix(col, cc, cloud);
  }
  col += uFlashCol * uFlash * (0.35 + 0.65 * cloud);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    // melt into the scene fog at the horizon, in exactly the space scene fog uses
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - smoothstep(-0.02, uHorizonFog, y));
  #endif
}`;

const STAR_VERT = /* glsl */ `
attribute float aMag;
attribute float aSeed;
attribute vec3 aCol;
uniform float uTime, uVis, uLimit, uScale;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = viewMatrix * vec4(cameraPosition + position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99998;
  float b = aMag;
  float tw = 0.7 + 0.3 * sin(uTime * (1.5 + aSeed * 4.0) + aSeed * 60.0);
  vA = smoothstep(uLimit, uLimit + 0.12, b) * uVis * tw * (0.25 + b * 1.2) * smoothstep(0.0, 0.18, normalize(position).y);
  vCol = aCol;
  gl_PointSize = (1.1 + b * b * 2.6) * uScale;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, r);
  if (vA * a < 0.003) discard;
  gl_FragColor = vec4(vCol * vA * a * 1.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Image-based lighting: a controlled gradient sky (zenith / horizon / ground
// bounce + a soft sun glow). The visible dome's HDR sun is far too hot to light with.
const ENV_FRAG = /* glsl */ `uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = d.y > 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.55)) : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -d.y));
  c += uSunCol * (pow(max(dot(d, uSunDir), 0.0), 24.0) * 0.8 + pow(max(dot(d, uSunDir), 0.0), 4.0) * 0.15);
  gl_FragColor = vec4(c, 1.0);
}`;

// ------------------------------------------------------------------ Environment
export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi: THREE.HemisphereLight;
  readonly stars: THREE.Points;
  readonly fog: AtmoFog;
  /** 0..24 hour of day */
  hour = 15.5;
  /** 0 day .. 1 full night */
  night = 0;
  lightPollution = 0;
  // ---- weather inputs (written by WeatherSystem)
  overcast = 0;
  /** distance haze multiplier (1 = the map's normal haze) */
  fogMul = 1;
  /** wildfire smoke 0..1 */
  smoke = 0;
  /** heat haze 0..1 */
  haze = 0;
  /** lightning flash 0..1 */
  flash = 0;
  /** extra fog whiteness for snow/blizzard 0..1 */
  whiteout = 0;
  /** ground mist amount (0 none .. ~8 pea soup) and its scale height in meters */
  mist = 0;
  mistHeight = 30;
  /** rain/snow darkening of the sky 0..1 */
  precip = 0;
  /** hurricane green-black 0..1 */
  storm = 0;
  /** snow on the ground 0..1 (brighter bounce light) */
  snowCover = 0;
  /** Day of year (0 = Mar 20): moves the sun path, day length and moon. */
  dayOfYear = 0;
  /** Days since game start (moon phase). */
  day = 0;
  /** Force a moon phase (0 new, 0.5 full); null follows the calendar. */
  moonPhaseOverride: number | null = null;

  // ---- outputs other systems read (water, weather, particles, clouds)
  readonly sunColor = new THREE.Color();
  sunIntensity = 0;
  sunElevation = 0;
  readonly moonDirection = new THREE.Vector3(0, 1, 0);
  moonPhase = 0.5;
  moonLight = 0;
  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  /** Rough overall scene light level 0..~1.6 (for unlit shaders). */
  lightLevel = 1;

  private sunDir = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  private fogDay: THREE.Color;
  private hemiGround: THREE.Color;
  private dayZenith = new THREE.Color();
  private lat: number;
  private tmp = new THREE.Color();
  private skyU: Record<string, THREE.IUniform>;
  private starU: Record<string, THREE.IUniform>;
  private time = 0;
  private lastNow = 0;
  /** image-based lighting adds ambient, so the hemisphere light backs off */
  private hemiScale: number;
  private nightBoost: number;
  private pmrem?: THREE.PMREMGenerator;
  private envRT?: THREE.WebGLRenderTarget;
  private envScene?: THREE.Scene;
  private envMat?: THREE.ShaderMaterial;
  private envKey = '';
  private envT = 0;

  constructor(private scene: THREE.Scene, private def: MapDef, q: Quality, private renderer?: THREE.WebGLRenderer) {
    this.lat = latitudeOf(def.id);
    // the map's haze, pushed toward blue so distance reads as air, not fog
    this.fogDay = new THREE.Color(def.sky.fog).lerp(C_HAZE_BLUE, 0.42);
    this.hemiGround = new THREE.Color(def.sky.hemiGround);
    // clearer air = deeper blue overhead
    this.dayZenith.setHex(0x3f7fd4).lerp(new THREE.Color(0x2a6ad8), THREE.MathUtils.clamp((6 - def.sky.turbidity) / 4, 0, 1));
    this.hemiScale = renderer ? 0.5 : 1;
    this.nightBoost = renderer ? 2 : 1;

    this.skyU = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uBelt: { value: new THREE.Color() },
        uCloudLit: { value: new THREE.Color() },
        uCloudShade: { value: new THREE.Color() },
        uFlashCol: { value: C_FLASH.clone() },
        uSunSize: { value: 0.012 },
        uSunVis: { value: 1 },
        uMoonPhase: { value: 0.5 },
        uMoonBright: { value: 0 },
        uStars: { value: 0 },
        uCloudCover: { value: 0 }, // the cloud deck (clouds.ts) draws the clouds
        uCloudDark: { value: 0 },
        uFlash: { value: 0 },
        uHorizonFog: { value: 0.06 },
        uCloudOffset: { value: new THREE.Vector2() },
      },
    ]);
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: true });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.fog = new AtmoFog(def.sky.fog, def.sky.fogDensity);
    this.fog.pack();
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(def.sky.hemiSky, def.sky.hemiGround, 1.1 * this.hemiScale);
    scene.add(this.hemi);

    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const cam = this.sun.shadow.camera;
    cam.near = 10;
    cam.far = 5000;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // stars: magnitude-weighted, color-tinted, fade out as light pollution rises
    const n = q.name === 'low' ? 1600 : 4200;
    const pos = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const seed = new Float32Array(n);
    const colr = new Float32Array(n * 3);
    let s = 1234567;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const warm = new THREE.Color(0xffd2a8), cool = new THREE.Color(0xb8ccff), white = new THREE.Color(1, 1, 1), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const th = rnd() * Math.PI * 2;
      const y = rnd() * 1.05 - 0.05;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 8000;
      pos[i * 3 + 1] = y * 8000;
      pos[i * 3 + 2] = Math.sin(th) * r * 8000;
      mag[i] = Math.pow(rnd(), 3.2);
      seed[i] = rnd();
      c.copy(cool).lerp(warm, rnd()).lerp(white, 0.45);
      colr[i * 3] = c.r; colr[i * 3 + 1] = c.g; colr[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(colr, 3));
    this.starU = { uTime: { value: 0 }, uVis: { value: 0 }, uLimit: { value: 0 }, uScale: { value: Math.min(2, window.devicePixelRatio || 1) } };
    const starMat = new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.stars = new THREE.Points(g, starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    if (renderer) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.envScene = new THREE.Scene();
      this.envMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
        },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: ENV_FRAG,
      });
      this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.envMat));
      scene.environmentIntensity = 1;
    }
  }

  /** Sun or moon position for an hour of day, with a seasonal path. Returns elevation (deg). */
  private celestial(hour: number, decl: number, out: THREE.Vector3): number {
    const lat = this.lat;
    const noon = 13;
    const halfDay = 6.4 + (lat > 30 ? 1.45 : 0.95) * (decl / 23.44);
    const peak = Math.min(90 - lat + decl, 72);
    const trough = -Math.max(12, 90 - lat - decl);
    const riseAz = Math.acos(THREE.MathUtils.clamp(Math.sin(decl * DEG) / Math.cos(lat * DEG), -1, 1)) / DEG;
    const dayLen = 2 * halfDay;
    const t = (((hour - (noon - halfDay)) % 24) + 24) % 24;
    let elev: number, az: number;
    if (t <= dayLen) {
      const u = t / dayLen;
      elev = peak * Math.sin(Math.PI * u);
      az = riseAz + (360 - 2 * riseAz) * u;
    } else {
      const u = (t - dayLen) / (24 - dayLen);
      elev = trough * Math.sin(Math.PI * u);
      az = 360 - riseAz + 2 * riseAz * u;
    }
    const e = elev * DEG, a = az * DEG;
    // azimuth from north, clockwise; north = -z, east = +x
    out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    return elev;
  }

  /** Advance clock (hours) and update lighting; focus = camera target for the shadow box. */
  update(dtHours: number, focus: THREE.Vector3, viewDist: number, camPos?: THREE.Vector3) {
    void camPos; // the dome and stars follow the camera in their shaders
    this.hour = (((this.hour + dtHours) % 24) + 24) % 24;
    const now = performance.now() / 1000;
    const dt = this.lastNow ? Math.min(0.1, now - this.lastNow) : 0;
    this.lastNow = now;
    this.time += dt;
    const doy = this.dayOfYear;
    const decl = 23.44 * Math.sin((2 * Math.PI * doy) / 365.25);

    // ---- sun & moon
    const elev = this.celestial(this.hour, decl, this.sunDir);
    this.sunElevation = elev;
    const phase = this.moonPhaseOverride ?? ((((this.day + 7.4) / 29.53) % 1) + 1) % 1;
    this.moonPhase = phase;
    const moonElev = this.celestial(this.hour - phase * 24.84, decl * Math.cos(phase * Math.PI * 2), this.moonDirection);
    const illum = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);

    const daylight = THREE.MathUtils.smoothstep(elev, -7, 8);
    this.night = 1 - daylight;
    const oc = this.overcast;
    const clear = 1 - oc;

    // ---- sky palette by sun elevation
    const gain = sampleScalar(SKY_GAIN, elev);
    sampleKeys(ZENITH, elev, this.zenith);
    if (elev > 16) this.zenith.lerp(this.dayZenith, THREE.MathUtils.smoothstep(elev, 16, 40));
    sampleKeys(HORIZON, elev, this.horizon);
    if (elev > 12) this.horizon.lerp(this.fogDay, THREE.MathUtils.smoothstep(elev, 12, 30));
    this.zenith.multiplyScalar(gain);
    this.horizon.multiplyScalar(gain);
    const glow = this.skyU.uGlow.value as THREE.Color;
    const belt = this.skyU.uBelt.value as THREE.Color;
    sampleKeys(GLOW, elev, glow).multiplyScalar(clear * (1 - this.smoke * 0.5) * 0.9);
    sampleKeys(BELT, elev, belt).multiplyScalar(clear * 0.8);

    // moonlit night sky + light pollution glow
    const moonUp = THREE.MathUtils.smoothstep(moonElev, -3, 12);
    addScaled(this.zenith, this.tmp.setRGB(0.012, 0.02, 0.045), illum * moonUp * this.night * clear);
    addScaled(this.horizon, this.tmp.setRGB(0.02, 0.028, 0.05), illum * moonUp * this.night * clear);
    const lp = this.lightPollution;
    addScaled(this.horizon, C_LP, lp * this.night * 0.2);
    addScaled(this.zenith, C_LP, lp * this.night * 0.035);

    // ---- weather tints
    const lumH = this.horizon.r * 0.3 + this.horizon.g * 0.59 + this.horizon.b * 0.11;
    const dim = 1 - this.precip * 0.45 - this.storm * 0.35;
    this.zenith.lerp(this.tmp.copy(C_OVERCAST).multiplyScalar(lumH * 0.95 * dim), oc);
    this.horizon.lerp(this.tmp.copy(C_OVERCAST).multiplyScalar(lumH * 1.02 * dim), oc);
    if (this.storm > 0) {
      const day = 0.15 + daylight * 0.85;
      this.zenith.lerp(this.tmp.copy(C_STORM_Z).multiplyScalar(day), this.storm);
      this.horizon.lerp(this.tmp.copy(C_STORM_H).multiplyScalar(day * 0.7), this.storm);
    }
    if (this.smoke > 0) {
      const day = 0.12 + daylight * 0.88;
      this.zenith.lerp(this.tmp.copy(C_SMOKE_Z).multiplyScalar(day * 0.9), this.smoke);
      this.horizon.lerp(this.tmp.copy(C_SMOKE_H).multiplyScalar(day * 0.8), this.smoke);
    }
    if (this.haze > 0) {
      // bleached, baking sky: cream haze at the horizon, washed-out blue overhead
      this.horizon.lerp(this.tmp.copy(C_HEAT_H).multiplyScalar(Math.max(lumH, 0.2) * 1.2), this.haze * 0.7);
      this.zenith.lerp(this.tmp.copy(C_HEAT_Z).multiplyScalar(Math.max(lumH, 0.2) * 1.1), this.haze * 0.45);
    }
    if (this.whiteout > 0) this.horizon.lerp(this.tmp.copy(C_WHITEOUT).multiplyScalar(Math.max(lumH, 0.06) * 1.05), this.whiteout * 0.75);
    if (this.mist > 0) this.horizon.lerp(this.tmp.copy(C_MIST).multiplyScalar(Math.max(lumH, 0.05)), Math.min(1, this.mist * 0.2));

    // ---- sun light
    sampleKeys(SUNCOL, elev, this.sunColor);
    if (this.smoke > 0) this.sunColor.lerp(C_SMOKE_SUN, this.smoke * 0.75);
    if (this.haze > 0) this.sunColor.lerp(this.tmp.setRGB(1, 0.8, 0.55), this.haze * 0.35);
    // consumers (cloud deck, water) read sunColor as "the key light": moonlight after dark
    this.sunColor.lerp(C_MOON, THREE.MathUtils.smoothstep(-elev, 1, 8));
    let sunI = sampleScalar(SUN_I, elev);
    sunI *= 1 - oc * 0.82;
    sunI *= 1 - this.smoke * 0.5;
    sunI *= 1 - this.storm * 0.6;
    sunI *= 1 + this.haze * 0.12;
    this.sunIntensity = sunI;

    // moonlight takes over once the sun is well down (both are ~0 at the switch, so no pop);
    // with the moon down, a faint high "starlight" key keeps the valley readable
    const moonI = (0.2 + 0.72 * illum) * moonUp * THREE.MathUtils.smoothstep(-elev, 3, 9) * (1 - oc * 0.75);
    this.moonLight = moonI;
    const useSun = elev > -3.5;
    const moonKey = moonUp > 0.25;
    const nightKey = Math.max(moonI, 0.36 * THREE.MathUtils.smoothstep(-elev, 3, 9) * (1 - oc * 0.6));
    if (useSun) this.lightDir.copy(this.sunDir);
    else if (moonKey) this.lightDir.copy(this.moonDirection);
    else this.lightDir.set(-0.35, 0.85, 0.4).normalize();
    if (this.lightDir.y < 0.08) {
      // keep shadows sane when the light grazes the horizon
      this.lightDir.y = 0.08;
      this.lightDir.normalize();
    }
    ATMOS.uSunDirW.value.copy(this.lightDir);
    const shadowSize = THREE.MathUtils.clamp(viewDist * 0.75, 90, 1400);
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 2500);
    this.sun.target.position.copy(focus);
    const cam = this.sun.shadow.camera;
    if (cam.right !== shadowSize) {
      cam.left = cam.bottom = -shadowSize;
      cam.right = cam.top = shadowSize;
      cam.updateProjectionMatrix();
    }
    if (useSun) {
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = sunI + this.flash * 4;
    } else {
      this.sun.color.copy(C_MOON);
      this.sun.intensity = (moonKey ? nightKey : Math.min(nightKey, 0.36)) * this.nightBoost + this.flash * 4;
    }

    // ---- ambient
    let hemiI = sampleScalar(HEMI_I, elev);
    hemiI *= 1 + oc * 0.3 - this.storm * 0.35 - this.smoke * 0.15 - this.precip * 0.15;
    this.hemi.color.copy(this.zenith).lerp(this.horizon, 0.35);
    // normalize hemi sky color brightness so the intensity curve stays in charge
    const hl = Math.max(0.05, this.hemi.color.r * 0.3 + this.hemi.color.g * 0.59 + this.hemi.color.b * 0.11);
    this.hemi.color.multiplyScalar(0.75 / hl).lerp(this.tmp.copy(C_NIGHT_SKY).multiplyScalar(1.9), this.night * 0.75);
    this.hemi.groundColor.copy(this.hemiGround).lerp(C_SNOW_GROUND, this.snowCover * 0.6).multiplyScalar(0.4 + daylight * 0.6);
    if (this.flash > 0) {
      this.hemi.color.lerp(C_FLASH, Math.min(1, this.flash));
      hemiI += this.flash * 3.5;
    }
    // the baked sky light is near-black after dark, so the hemisphere light takes over again at night
    this.hemi.intensity = hemiI * THREE.MathUtils.lerp(this.hemiScale, 1, this.night);
    // what the unlit shaders (water body, rain, particles) should be lit by
    this.lightLevel = THREE.MathUtils.clamp(0.1 + sunI * 0.28 + moonI * 0.3 + (hemiI - 0.62) * 0.6 + this.flash * 0.8, 0.06, 1.6);

    // ---- fog: matches the horizon so the far world melts into the sky
    this.fog.color.copy(this.horizon);
    this.fog.density = this.def.sky.fogDensity * this.fogMul * (1 + this.haze * 0.6);
    this.fog.mist = this.mist;
    this.fog.mistHeight = this.mistHeight;
    this.fog.pack();

    // ---- sky dome uniforms
    const u = this.skyU;
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(this.moonDirection);
    (u.uZenith.value as THREE.Color).copy(this.zenith);
    (u.uHorizon.value as THREE.Color).copy(this.horizon);
    u.uSunVis.value = THREE.MathUtils.smoothstep(elev, -2, 1) * (1 - oc * 0.97) * (1 - this.storm * 0.9);
    (u.uSunColor.value as THREE.Color).copy(this.sunColor).multiplyScalar(1 + this.smoke * 0.5);
    u.uSunSize.value = this.smoke > 0.3 ? 0.016 : 0.012;
    u.uMoonPhase.value = phase;
    u.uMoonBright.value = (0.6 + 2.2 * this.night) * moonUp * (1 - oc * 0.9) * (1 - this.smoke * 0.6);
    const cover = ATMOS.uCloudCover.value;
    const starVis = THREE.MathUtils.smoothstep(this.night, 0.55, 1) * (1 - cover) ** 2 * (1 - this.smoke) * (1 - Math.min(1, this.mist * 0.15));
    u.uStars.value = starVis * (1 - lp) ** 2;
    u.uFlash.value = this.flash;
    u.uHorizonFog.value = 0.05 + Math.min(0.25, this.mist * 0.03 + oc * 0.04 + this.smoke * 0.1 + this.whiteout * 0.12);

    this.starU.uTime.value = this.time;
    this.starU.uVis.value = starVis;
    this.starU.uLimit.value = lp * 0.8;

    // what wet ground reflects
    atmo.uSkyRefl.value.copy(this.horizon).lerp(this.zenith, 0.3);
    this.scene.background = null;
    this.refreshEnv(daylight);
  }

  /** Re-bake the image-based lighting when the sky has changed enough. */
  private refreshEnv(day: number) {
    if (!this.pmrem || !this.envScene || !this.renderer) return;
    const now = performance.now();
    const key = `${Math.round(this.hour * 5)}|${Math.round(this.dayOfYear / 8)}|${Math.round(this.overcast * 12)}|${Math.round(this.smoke * 8)}|${Math.round(this.whiteout * 6)}|${Math.round(this.storm * 6)}|${Math.round(this.snowCover * 5)}`;
    if (key === this.envKey || now - this.envT < 1200) return;
    this.envKey = key;
    this.envT = now;
    const u = this.envMat!.uniforms;
    (u.uZenith.value as THREE.Color).copy(this.zenith).multiplyScalar(0.62);
    (u.uHorizon.value as THREE.Color).copy(this.horizon).multiplyScalar(0.7);
    (u.uGround.value as THREE.Color).copy(this.hemiGround).lerp(C_SNOW_GROUND, this.snowCover * 0.6).multiplyScalar(0.35 * (0.05 + day * 0.95));
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.uSunCol.value as THREE.Color).copy(this.sunColor).multiplyScalar(day * (1 - this.overcast * 0.85) * 1.2);
    const prevTarget = this.renderer.getRenderTarget();
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200, { size: 64 });
    this.renderer.setRenderTarget(prevTarget);
    this.scene.environment = rt.texture;
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environmentIntensity = 1;
  }

  get sunDirection() {
    return this.sunDir;
  }
}

