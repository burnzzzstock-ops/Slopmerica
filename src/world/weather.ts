// Weather + seasons driver. A per-map, per-season state machine picks weather
// spells; every visual (clouds, fog, rain, snow cover, wind, lightning, color
// grade) eases toward the current spell so nothing pops. Precipitation is GPU
// instanced around the camera with zero per-frame allocation.
import * as THREE from 'three';
import type { GameTime, Season, WeatherEffects, WeatherKind } from '../contracts';
import type { MapId } from './maps';
import type { Environment } from './sky';
import type { Terrain } from './terrain';
import type { Trees } from './trees';
import type { Quality } from '../config';
import { newGrade, type GradeParams, type PostFX } from '../render/post';
import type { Particles } from '../render/particles';
import type { AudioEngine } from '../audio/audio';
import { HALF, WATER, WORLD } from '../config';
import { atmo, applySeasonUniforms, newSeasonLook, sampleSeason, seasonOf, temperatureC, YEAR } from './seasons';

export { seasonOf } from './seasons';

export interface AtmosphereContext {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  env: Environment;
  terrain: Terrain;
  trees: Trees;
  water: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  quality: Quality;
  mapId: MapId;
  /** Optional: weather drives its color grade, heat shimmer and lightning flash. */
  post?: PostFX;
  /** Optional: weather pushes wind into smoke/steam drift. */
  particles?: Particles;
  /** Optional: weather plays thunder (delayed by distance). */
  audio?: AudioEngine;
}

// ------------------------------------------------------------------ weather kinds
interface KindDef {
  days: [number, number]; // spell length, game days
  cloud: number; overcast: number; precip: number; rain: number; snow: number; ash: number;
  wind: number; haze: number; mist: number; mistH: number; smoke: number; storm: number; heat: number;
  lightning: number; surge: number;
  fx: WeatherEffects; // gameplay multipliers at full intensity
}

const FX = (speedMul: number, crashMul: number, buildMul: number, demandMul: number, outdoorPeopleMul: number): WeatherEffects => ({ speedMul, crashMul, buildMul, demandMul, outdoorPeopleMul });
const KD = (p: Partial<KindDef> & { days: [number, number]; fx: WeatherEffects }): KindDef => ({
  cloud: 0.2, overcast: 0, precip: 0, rain: 0, snow: 0, ash: 0, wind: 0.15, haze: 1, mist: 0, mistH: 30, smoke: 0, storm: 0, heat: 0, lightning: 0, surge: 0, ...p,
});

const KINDS: Record<WeatherKind, KindDef> = {
  clear: KD({ days: [3, 9], cloud: 0.3, haze: 0.85, fx: FX(1, 1, 1.05, 1.02, 1.1) }),
  cloudy: KD({ days: [2, 6], cloud: 0.72, overcast: 0.5, wind: 0.3, haze: 1.1, fx: FX(1, 1, 1, 1, 0.95) }),
  rain: KD({ days: [1, 4], cloud: 0.96, overcast: 0.85, precip: 0.55, rain: 0.65, wind: 0.35, haze: 1.7, mist: 0.6, mistH: 40, fx: FX(0.85, 1.45, 0.8, 0.99, 0.45) }),
  storm: KD({ days: [1, 2], cloud: 1, overcast: 0.95, precip: 1, rain: 1, wind: 0.62, haze: 2, mist: 0.8, mistH: 60, lightning: 1, fx: FX(0.7, 1.9, 0.5, 0.97, 0.2) }),
  snow: KD({ days: [1, 4], cloud: 0.96, overcast: 0.82, precip: 0.45, snow: 0.7, wind: 0.25, haze: 1.9, mist: 0.9, mistH: 50, fx: FX(0.65, 2.2, 0.6, 0.98, 0.55) }),
  blizzard: KD({ days: [1, 3], cloud: 1, overcast: 0.95, precip: 0.85, snow: 1, wind: 0.92, haze: 3.4, mist: 3.2, mistH: 90, fx: FX(0.4, 3.5, 0.2, 0.9, 0.08) }),
  fog: KD({ days: [1, 2], cloud: 0.55, overcast: 0.6, wind: 0.04, haze: 1.8, mist: 5.5, mistH: 42, fx: FX(0.8, 1.8, 0.95, 1, 0.8) }),
  heatwave: KD({ days: [4, 9], cloud: 0.04, wind: 0.07, haze: 1.6, heat: 1, fx: FX(0.95, 1.15, 0.75, 0.97, 0.3) }),
  hurricane: KD({ days: [2, 4], cloud: 1, overcast: 1, precip: 1, rain: 1, wind: 1, haze: 2.6, mist: 1.2, mistH: 120, storm: 1, lightning: 0.55, surge: 1.5, fx: FX(0.3, 4, 0.05, 0.8, 0.02) }),
  wildfireSmoke: KD({ days: [4, 10], cloud: 0.1, wind: 0.2, haze: 3.4, mist: 1.1, mistH: 950, smoke: 1, ash: 1, fx: FX(0.9, 1.2, 0.85, 0.93, 0.25) }),
};

type Odds = Partial<Record<WeatherKind, number>>;
const ODDS: Record<MapId, Record<Season, Odds>> = {
  appalachia: {
    spring: { clear: 30, cloudy: 24, rain: 26, storm: 10, fog: 8, snow: 2 },
    summer: { clear: 34, cloudy: 14, rain: 14, storm: 22, fog: 6, heatwave: 10 },
    fall: { clear: 36, cloudy: 24, rain: 18, storm: 4, fog: 15, snow: 3 },
    winter: { clear: 18, cloudy: 26, rain: 8, snow: 30, blizzard: 8, fog: 10 },
  },
  norcal: {
    spring: { clear: 46, cloudy: 18, rain: 18, fog: 16, storm: 2 },
    summer: { clear: 45, fog: 25, heatwave: 15, wildfireSmoke: 10, cloudy: 5 },
    fall: { clear: 40, heatwave: 12, wildfireSmoke: 20, fog: 12, cloudy: 10, rain: 6 },
    winter: { clear: 26, cloudy: 25, rain: 30, storm: 12, fog: 6, snow: 2 },
  },
  florida: {
    spring: { clear: 46, cloudy: 20, rain: 10, storm: 14, fog: 5, heatwave: 5 },
    summer: { clear: 20, cloudy: 14, rain: 16, storm: 30, heatwave: 15, hurricane: 5 },
    fall: { clear: 30, cloudy: 15, rain: 15, storm: 15, hurricane: 12, heatwave: 8, fog: 5 },
    winter: { clear: 50, cloudy: 25, rain: 10, fog: 12, snow: 0.6 }, // snow = the one-flake joke
  },
};

// Visual state that eases toward the current spell.
const VIS_KEYS = ['cloud', 'overcast', 'precip', 'rain', 'snow', 'ash', 'wind', 'haze', 'mist', 'mistH', 'smoke', 'storm', 'heat', 'lightning', 'surge', 'flake', 'fireflies'] as const;
type VisKey = (typeof VIS_KEYS)[number];
type Vis = Record<VisKey, number>;
const newVis = (): Vis => ({ cloud: 0.2, overcast: 0, precip: 0, rain: 0, snow: 0, ash: 0, wind: 0.15, haze: 1, mist: 0, mistH: 30, smoke: 0, storm: 0, heat: 0, lightning: 0, surge: 0, flake: 0, fireflies: 0 });

// ------------------------------------------------------------------ precipitation shaders
const PRECIP_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 aSeed;
uniform vec3 uCenter, uVel;
uniform float uSize, uTime, uAmount, uLen, uWidth, uSwirl, uLevel, uPixel;
uniform sampler2D uHeight;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  vSeed = aSeed.w;
  if (aSeed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vUv = vec2(0.0); return; }
  float spd = 0.8 + 0.4 * fract(aSeed.w * 7.31);
  vec3 p = aSeed.xyz * uSize + uVel * uTime * spd;
  p.x += sin(uTime * 1.3 + aSeed.x * 40.0) * uSwirl;
  p.z += cos(uTime * 1.1 + aSeed.z * 37.0) * uSwirl;
  vec3 rel = mod(p - uCenter + uSize * 0.5, uSize) - uSize * 0.5;
  vec3 wp = uCenter + rel;
  float g = texture2D(uHeight, clamp((wp.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)}, 0.0, 1.0)).r;
  g = max(g, ${WATER.toFixed(1)} + uLevel);
  float edge = max(abs(rel.x), max(abs(rel.y), abs(rel.z))) / uSize;
  vA = (1.0 - smoothstep(0.32, 0.5, edge)) * smoothstep(g, g + uLen * 0.5 + 0.2, wp.y);
  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam);
  toCam /= max(dist, 1e-3);
  // never thinner than ~1px: widen far drops and fade them instead
  float px = dist * uPixel;
  vA *= smoothstep(uSize * 0.05, uSize * 0.16, dist); // nothing smeared across the lens
#ifdef STREAK
  float w = max(uWidth, px * 0.9);
  vA *= clamp(uWidth / max(px, 1e-4), 0.4, 1.0);
  vec3 dir = normalize(uVel);
  vec3 pos = wp - dir * uLen * corner.y;
  vec3 side = normalize(cross(dir, toCam));
  pos += side * corner.x * w;
#else
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  float s = max(uWidth * (0.6 + 0.8 * fract(aSeed.w * 13.7)), px * 1.3);
  vec3 pos = wp + (right * corner.x + up * (corner.y * 2.0 - 1.0)) * s;
  pos += normalize(uVel) * (corner.y * 2.0 - 1.0) * s * uLen; // wind streaks (blizzard)
#endif
  vUv = corner;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;
const PRECIP_FRAG = /* glsl */ `
uniform vec3 uColor, uEmber;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
#ifdef STREAK
  float a = (1.0 - abs(vUv.x)) * (1.0 - vUv.y * 0.75);
#else
  float a = smoothstep(1.0, 0.2, length(vec2(vUv.x, vUv.y * 2.0 - 1.0)));
#endif
  a *= vA * uOpacity;
  if (a < 0.004) discard;
  vec3 c = uColor;
  if (vSeed < 0.07) c = mix(c, uEmber, step(0.001, dot(uEmber, vec3(1.0))));
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLY_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform float uTime, uAmount, uRadius, uSize;
uniform sampler2D uHeight;
varying vec2 vUv;
varying float vA;
void main() {
  if (aSeed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vUv = vec2(0.0); return; }
  vec2 o = (aSeed.xy - 0.5) * 2.0 * uRadius;
  o += vec2(sin(uTime * 0.3 + aSeed.z * 20.0), cos(uTime * 0.23 + aSeed.w * 30.0)) * 3.0;
  vec3 wp = vec3(uCenter.x + o.x, 0.0, uCenter.z + o.y);
  wp.xz = uCenter.xz + mod(wp.xz - uCenter.xz + uRadius, uRadius * 2.0) - uRadius;
  float g = texture2D(uHeight, clamp((wp.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)}, 0.0, 1.0)).r;
  wp.y = max(g, ${WATER.toFixed(1)}) + 0.6 + aSeed.z * 2.6 + sin(uTime * 0.7 + aSeed.x * 50.0) * 0.4;
  float blink = pow(max(0.0, sin(uTime * (0.9 + aSeed.y) + aSeed.x * 80.0)), 12.0);
  vA = blink * (1.0 - smoothstep(0.6, 1.0, length(o) / uRadius)) * step(${WATER.toFixed(1)} + 0.2, g);
  vec3 toCam = normalize(cameraPosition - wp);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  vec3 pos = wp + (right * corner.x + up * (corner.y * 2.0 - 1.0)) * uSize;
  vUv = corner;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;
const FLY_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vec2(vUv.x, vUv.y * 2.0 - 1.0));
  float a = exp(-d * d * 9.0) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(1.1, 1.6, 0.35) * a * 5.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BOLT_VERT = /* glsl */ `
attribute vec3 aNext;
attribute float aSide;
attribute float aW;
uniform float uWidth;
varying float vU;
void main() {
  vec3 t = normalize(aNext - position + vec3(0.0, 1e-4, 0.0));
  vec3 v = normalize(cameraPosition - position);
  vec3 cx = cross(t, v);
  vec3 s = dot(cx, cx) > 1e-8 ? normalize(cx) : vec3(1.0, 0.0, 0.0);
  float dist = length(cameraPosition - position);
  vec3 p = position + s * aSide * max(uWidth, dist * uWidth * 0.0022) * aW; // stays visible from far away
  vU = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BOLT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity, uSharp;
varying float vU;
void main() {
  float a = pow(max(1.0 - abs(vU), 0.0), uSharp) * uIntensity; // max(): pow of a tiny negative is NaN
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLAKE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uOpacity;
void main() {
  vec2 p = vec2(vUv.x, vUv.y * 2.0 - 1.0);
  float r = length(p);
  // six arms (three lines through the middle) with little side branches
  float star = 0.0;
  for (int i = 0; i < 3; i++) {
    float ang = float(i) * 1.0472;
    vec2 n = vec2(-sin(ang), cos(ang));
    vec2 t = vec2(cos(ang), sin(ang));
    float along = abs(dot(p, t));
    star = max(star, smoothstep(0.07, 0.0, abs(dot(p, n))) * step(along, 0.9));
    float bpos = abs(along - 0.5);
    star = max(star, smoothstep(0.06, 0.0, abs(abs(dot(p, n)) - bpos * 0.9)) * step(bpos, 0.2) * step(0.3, along));
  }
  star = max(star, smoothstep(0.2, 0.05, r));
  float a = clamp(star + exp(-r * r * 6.0) * 0.25, 0.0, 1.0) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.4, 1.5, 1.6), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const FLAKE_VERT = /* glsl */ `
attribute vec2 corner;
uniform vec3 uPos;
uniform float uSize, uSpin;
varying vec2 vUv;
void main() {
  vec3 toCam = normalize(cameraPosition - uPos);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  float c = cos(uSpin), s = sin(uSpin);
  vec2 q = vec2(corner.x, corner.y * 2.0 - 1.0);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vUv = vec2(corner.x, corner.y);
  vec3 pos = uPos + (right * q.x + up * q.y) * uSize;
  vUv = vec2(q.x, q.y * 0.5 + 0.5);
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;

function quadGeometry(instances: number, seed: number) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]), 2));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const s = new Float32Array(instances * 4);
  let r = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    s[i] = r / 4294967296;
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
  g.instanceCount = instances;
  return g;
}

const BOLT_MAIN = 34;
const BOLT_BRANCH = 13;
const BOLT_PTS = BOLT_MAIN + 2 * BOLT_BRANCH;

// ------------------------------------------------------------------ system
export class WeatherSystem {
  season: Season = 'spring';
  kind: WeatherKind = 'clear';
  intensity = 1;
  /** Called when season or weather kind changes (for the feed / UI). */
  onChange?: (kind: WeatherKind, season: Season) => void;
  /** Called on every lightning strike (world position of the ground strike). */
  onLightning?: (x: number, z: number, dist: number) => void;

  /** Current ground conditions (read-only for callers). */
  groundSnow = 0;
  wetness = 0;
  temperature = 15;
  /** Gameplay grade + look, shared with PostFX when linked. */
  readonly grade: GradeParams;
  /** Visual state (smoothed). */
  readonly vis: Vis = newVis();
  /** The seasonal look at the current (smoothed) calendar day. */
  readonly look = newSeasonLook();

  private target: Vis = newVis();
  private spellLeft = 5; // game days
  private forced = false;
  private lastDay = NaN;
  private visDay = NaN;
  private started = false;
  private focusY = 0;
  private realTime = 0;
  private windAngle = 0.7;
  private windGust = 0;
  private puddles = 0;
  private treeSnow = 0;
  private ice = 0;
  private surge = 0;
  private paintTimer = 0;
  private rng = Math.random;
  private fx: WeatherEffects = FX(1, 1, 1, 1, 1);
  private snowLo = 0;
  private snowHi = 100;
  private snowPeak = 100;

  // lightning
  private strikeT = 99;
  private nextStrike = 4;
  private strikeHasBolt = false;
  private thunderAt = -1;
  private thunderVol = 0;
  private flashLight: THREE.DirectionalLight;

  // meshes
  private rain: THREE.Mesh;
  private snow: THREE.Mesh;
  private ash: THREE.Mesh;
  private flies: THREE.Mesh;
  private flake: THREE.Mesh;
  private bolt: THREE.Mesh;
  private boltGlow: THREE.Mesh;
  private rainU: Record<string, THREE.IUniform>;
  private snowU: Record<string, THREE.IUniform>;
  private ashU: Record<string, THREE.IUniform>;
  private flyU: Record<string, THREE.IUniform>;
  private flakeU: Record<string, THREE.IUniform>;
  private boltU: Record<string, THREE.IUniform>;
  private boltGlowU: Record<string, THREE.IUniform>;
  private boltPos: Float32Array;
  private boltNext: Float32Array;
  private boltW: Float32Array;
  private flakeT = 0;

  // scratch (no per-frame allocation)
  private v2 = new THREE.Vector2();
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(private ctx: AtmosphereContext) {
    const low = ctx.quality.name === 'low';
    this.grade = ctx.post?.grade ?? newGrade();
    this.analyzeTerrain();

    // Hand the shared atmosphere uniforms to the terrain shader (and its skirt).
    const tm = ctx.terrain.material;
    const tu = tm.userData.atmo as Record<string, THREE.IUniform> | undefined;
    if (tu) {
      for (const k of Object.keys(tu)) if (k in atmo) tu[k] = (atmo as unknown as Record<string, THREE.IUniform>)[k];
      tm.needsUpdate = true;
      ctx.terrain.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m !== tm && (o as THREE.Mesh).isMesh && m.isMeshStandardMaterial) {
          m.onBeforeCompile = tm.onBeforeCompile;
          m.needsUpdate = true;
        }
      });
    }

    // lightning fill light (kept in the scene at 0 so strikes never trigger a recompile)
    this.flashLight = new THREE.DirectionalLight(0xc8d6ff, 0);
    ctx.scene.add(this.flashLight);
    ctx.scene.add(this.flashLight.target);

    const heightTex = ctx.terrain.heightTex;
    const mk = (defines: Record<string, string>, color: number, opacity: number) =>
      new THREE.ShaderMaterial({
        defines,
        uniforms: {
          uCenter: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -1, 0) }, uSize: { value: 200 }, uTime: { value: 0 },
          uAmount: { value: 0 }, uLen: { value: 4 }, uWidth: { value: 0.1 }, uSwirl: { value: 0 }, uLevel: { value: 0 }, uHeight: { value: heightTex }, uPixel: { value: 0.001 },
          uColor: { value: new THREE.Color(color) }, uEmber: { value: new THREE.Color(0, 0, 0) }, uOpacity: { value: opacity },
        },
        vertexShader: PRECIP_VERT,
        fragmentShader: PRECIP_FRAG,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    const rainGeo = quadGeometry(low ? 4000 : 14000, 11);
    const snowGeo = quadGeometry(low ? 3000 : 11000, 23);
    const rainMat = mk({ STREAK: '' }, 0xb9c6d6, 0.32);
    const snowMat = mk({}, 0xf4f8ff, 0.85);
    const ashMat = mk({}, 0x6a625c, 0.8);
    this.rainU = rainMat.uniforms;
    this.snowU = snowMat.uniforms;
    this.ashU = ashMat.uniforms;
    (this.ashU.uEmber.value as THREE.Color).setRGB(3.2, 1.1, 0.25);
    this.rain = this.addFx(new THREE.Mesh(rainGeo, rainMat), 6);
    this.snow = this.addFx(new THREE.Mesh(snowGeo, snowMat), 6);
    this.ash = this.addFx(new THREE.Mesh(snowGeo, ashMat), 6);

    const flyMat = new THREE.ShaderMaterial({
      uniforms: { uCenter: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmount: { value: 0 }, uRadius: { value: 110 }, uSize: { value: 0.35 }, uHeight: { value: heightTex } },
      vertexShader: FLY_VERT,
      fragmentShader: FLY_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flyU = flyMat.uniforms;
    this.flies = this.addFx(new THREE.Mesh(quadGeometry(low ? 140 : 420, 37), flyMat), 7);

    const flakeGeo = new THREE.BufferGeometry();
    flakeGeo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]), 2));
    flakeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    flakeGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const flakeMat = new THREE.ShaderMaterial({
      uniforms: { uPos: { value: new THREE.Vector3() }, uSize: { value: 0.4 }, uSpin: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: FLAKE_VERT,
      fragmentShader: FLAKE_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.flakeU = flakeMat.uniforms;
    this.flake = this.addFx(new THREE.Mesh(flakeGeo, flakeMat), 8);

    // lightning bolt ribbon (main channel + two branches), rebuilt in place per strike
    this.boltPos = new Float32Array(BOLT_PTS * 2 * 3);
    this.boltNext = new Float32Array(BOLT_PTS * 2 * 3);
    this.boltW = new Float32Array(BOLT_PTS * 2);
    const side = new Float32Array(BOLT_PTS * 2);
    for (let i = 0; i < BOLT_PTS; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
    const idx: number[] = [];
    const strip = (start: number, n: number) => {
      for (let i = 0; i < n - 1; i++) {
        const a = (start + i) * 2, b = a + 2;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    };
    strip(0, BOLT_MAIN);
    strip(BOLT_MAIN, BOLT_BRANCH);
    strip(BOLT_MAIN + BOLT_BRANCH, BOLT_BRANCH);
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3));
    boltGeo.setAttribute('aNext', new THREE.BufferAttribute(this.boltNext, 3));
    boltGeo.setAttribute('aW', new THREE.BufferAttribute(this.boltW, 1));
    boltGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    boltGeo.setIndex(idx);
    const boltMat = (width: number, sharp: number, color: number) =>
      new THREE.ShaderMaterial({
        uniforms: { uWidth: { value: width }, uSharp: { value: sharp }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(color) } },
        vertexShader: BOLT_VERT,
        fragmentShader: BOLT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    this.bolt = this.addFx(new THREE.Mesh(boltGeo, boltMat(1.6, 1.5, 0xe8eeff)), 9);
    this.boltGlow = this.addFx(new THREE.Mesh(boltGeo, boltMat(14, 3, 0x7f8cff)), 9);
    this.boltU = (this.bolt.material as THREE.ShaderMaterial).uniforms;
    this.boltGlowU = (this.boltGlow.material as THREE.ShaderMaterial).uniforms;

    this.pickNext(true);
  }

  private addFx<T extends THREE.Mesh>(m: T, order: number) {
    m.frustumCulled = false;
    m.renderOrder = order;
    m.visible = false;
    this.ctx.scene.add(m);
    return m;
  }

  /** Terrain height stats → where snow sticks first. */
  private analyzeTerrain() {
    const H = this.ctx.terrain.heights;
    const land: number[] = [];
    for (let i = 0; i < H.length; i += 7) if (H[i] > 0.5) land.push(H[i]);
    land.sort((a, b) => a - b);
    const pct = (p: number) => land[Math.min(land.length - 1, Math.floor(land.length * p))] ?? 0;
    const id = this.ctx.mapId;
    this.snowPeak = pct(0.999) + 10;
    this.snowLo = id === 'norcal' ? pct(0.8) : pct(0.02) - 6;
    this.snowHi = id === 'norcal' ? pct(0.985) : pct(0.9);
  }

  // ---------------------------------------------------------------- state machine
  private pickNext(first = false) {
    const odds = ODDS[this.ctx.mapId][this.season];
    let total = 0;
    for (const k in odds) total += odds[k as WeatherKind] ?? 0;
    let r = this.rng() * total;
    let kind: WeatherKind = 'clear';
    for (const k in odds) {
      r -= odds[k as WeatherKind] ?? 0;
      if (r <= 0) { kind = k as WeatherKind; break; }
    }
    // temperature decides rain vs snow (Florida's "snow" stays a joke either way)
    if (this.ctx.mapId === 'appalachia') {
      if (kind === 'rain' && this.temperature < 0.5) kind = 'snow';
      else if ((kind === 'snow' || kind === 'blizzard') && this.temperature > 5) kind = 'rain';
    }
    if (first && (kind === 'hurricane' || kind === 'blizzard' || kind === 'wildfireSmoke')) kind = 'cloudy';
    const d = KINDS[kind].days;
    this.setKind(kind, d[0] + this.rng() * (d[1] - d[0]), false);
    if (first) this.intensity = 1;
  }

  private setKind(kind: WeatherKind, days: number, forced: boolean) {
    const changed = kind !== this.kind;
    this.kind = kind;
    this.spellLeft = days;
    this.forced = forced;
    if (changed) this.intensity = 0;
    this.nextStrike = 1.5 + this.rng() * 3;
    if (changed || forced) this.onChange?.(kind, this.season);
  }

  /** Debug / UI override: force a weather kind for N game days. */
  force(kind: WeatherKind, days = 3) {
    this.setKind(kind, days, true);
    this.intensity = Math.min(this.intensity, 0.05);
  }

  /** Jump visuals straight to the current state (after a calendar scrub or map load). */
  settle() {
    this.intensity = 1;
    this.computeTarget(this.ctx.env.hour, this.ctx.trees.naturePct);
    for (const k of VIS_KEYS) this.vis[k] = this.target[k];
    this.groundSnow = this.snowCapable() ? Math.max(this.snowClimate(), this.vis.snow > 0.3 ? 0.6 : 0) : 0;
    this.treeSnow = this.groundSnow * (this.vis.snow > 0.2 ? 0.9 : 0.45);
    this.wetness = this.vis.rain > 0.2 ? 0.9 : 0;
    this.puddles = this.vis.rain > 0.2 ? 0.8 : 0;
    this.ice = this.iceTarget();
    this.surge = this.vis.surge;
  }

  private snowCapable() {
    return this.ctx.mapId !== 'florida';
  }

  /** Snowpack the season keeps on its own. NorCal peaks only get snow from real snow spells. */
  private snowClimate() {
    return this.ctx.mapId === 'appalachia' ? this.look.snowClimate : 0;
  }

  private iceTarget() {
    if (this.ctx.mapId !== 'appalachia') return 0;
    // daily mean (9am sits on the mean of the diurnal curve), colder when it snows
    const t = temperatureC('appalachia', this.visDay, 9) - this.vis.snow * 3;
    return THREE.MathUtils.clamp((1.5 - t) / 6, 0, 1);
  }

  // ---------------------------------------------------------------- frame
  update(dt: number, time: GameTime, camera: THREE.Camera) {
    const ctx = this.ctx;
    const env = ctx.env;
    this.realTime += dt;
    const rt = this.realTime;

    // ---- calendar (smoothed so an integer day counter never steps the colors)
    const doy = ((time.dayOfYear % YEAR) + YEAR) % YEAR;
    let scrubbed = false;
    if (Number.isNaN(this.visDay)) {
      this.visDay = doy;
      scrubbed = true;
    } else {
      let diff = doy - this.visDay;
      if (diff > YEAR / 2) diff -= YEAR;
      if (diff < -YEAR / 2) diff += YEAR;
      if (Math.abs(diff) > 3) {
        this.visDay = doy;
        scrubbed = true;
      } else this.visDay = (((this.visDay + diff * Math.min(1, dt * 1.5)) % YEAR) + YEAR) % YEAR;
    }
    sampleSeason(ctx.mapId, this.visDay, this.look);
    applySeasonUniforms(this.look);
    const s = seasonOf(doy);
    if (s !== this.season) {
      this.season = s;
      if (this.started) this.onChange?.(this.kind, s);
    }
    this.started = true;
    this.temperature = temperatureC(ctx.mapId, this.visDay, env.hour) - this.vis.precip * 2 + this.vis.heat * 7 - this.vis.snow * 3;

    // ---- spells advance with game days
    if (Number.isNaN(this.lastDay) || time.day < this.lastDay || time.day - this.lastDay > 30) this.lastDay = time.day;
    const dDays = time.day - this.lastDay;
    this.lastDay = time.day;
    this.spellLeft -= dDays;
    if (this.spellLeft <= 0) this.pickNext();
    const ramp = THREE.MathUtils.clamp(this.spellLeft / 0.6, 0, 1);
    const want = ramp;
    const rate = this.forced ? 0.9 : 0.35;
    this.intensity += THREE.MathUtils.clamp(want - this.intensity, -dt * rate, dt * rate);

    // ---- visuals ease toward the target
    this.computeTarget(env.hour, ctx.trees.naturePct);
    if (scrubbed) this.settle();
    else {
      const k = Math.min(1, dt * 0.7);
      for (const key of VIS_KEYS) this.vis[key] += (this.target[key] - this.vis[key]) * k;
    }
    const v = this.vis;

    // ---- wind: slow wandering direction, gusts
    this.windAngle += (Math.sin(rt * 0.05) * 0.02 + (v.storm > 0.3 ? 0.08 : 0)) * dt;
    this.windGust += (((Math.sin(rt * 0.37) + Math.sin(rt * 1.13) * 0.5) * 0.5 + 0.5) * v.wind * 0.35 - this.windGust) * Math.min(1, dt * 2);
    const windS = Math.min(1.2, v.wind + this.windGust);
    atmo.uWindDir.value.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    atmo.uWindStrength.value = windS;
    atmo.uTime.value = rt;
    const cloudSpeed = 8 + v.wind * 45;
    atmo.uCloudOffset.value.x -= atmo.uWindDir.value.x * cloudSpeed * dt;
    atmo.uCloudOffset.value.y -= atmo.uWindDir.value.y * cloudSpeed * dt;
    atmo.uCloudCover.value = v.cloud;
    atmo.uCloudShadow.value = (0.45 * (1 - v.overcast) + 0.1) * (1 - env.night) * THREE.MathUtils.smoothstep(v.cloud, 0.03, 0.2) * (1 - THREE.MathUtils.smoothstep(v.cloud, 0.85, 1));

    // ---- ground: snowpack, wetness, puddles, ice
    const snowing = this.snowCapable() ? v.snow : 0;
    const warm = Math.max(0, this.temperature);
    if (snowing > 0.05) this.groundSnow += snowing * dt / 22;
    const floor = this.snowClimate() * (this.temperature < 3 ? 1 : 0.4);
    if (floor > this.groundSnow) this.groundSnow += (floor - this.groundSnow) * Math.min(1, dt * 0.01);
    const melt = Math.min(this.groundSnow, (warm * 0.0025 + v.rain * 0.02 + v.heat * 0.05) * dt * (snowing > 0.05 ? 0.2 : 1));
    this.groundSnow = THREE.MathUtils.clamp(this.groundSnow - melt, 0, 1);
    const tsTarget = snowing > 0.05 ? this.groundSnow * 0.95 : this.groundSnow * 0.35;
    this.treeSnow += (tsTarget - this.treeSnow) * Math.min(1, dt * (snowing > 0.05 ? 0.05 : 0.025));
    const raining = v.rain;
    if (raining > 0.05) this.wetness += raining * dt / 7;
    else this.wetness -= dt * (0.02 + v.heat * 0.06 + (1 - env.night) * 0.01);
    this.wetness = THREE.MathUtils.clamp(this.wetness + melt * 6, 0, 1);
    if (raining > 0.2 && this.wetness > 0.6) this.puddles += raining * dt / 16;
    else this.puddles -= dt / 50;
    this.puddles = THREE.MathUtils.clamp(this.puddles, 0, 1);
    this.ice += (this.iceTarget() - this.ice) * Math.min(1, dt * 0.05);
    this.surge += (v.surge - this.surge) * Math.min(1, dt * 0.08);

    atmo.uSnow.value = this.groundSnow;
    // light cover dusts the peaks; heavy cover reaches the valley floors
    atmo.uSnowLine.value = this.groundSnow < 0.005 ? 1e4 : THREE.MathUtils.lerp(this.snowPeak, this.snowLo, 1 - Math.pow(1 - this.groundSnow, 2.2)) - (this.groundSnow > 0.9 ? 30 : 0);
    if (this.ctx.mapId === 'norcal') atmo.uSnowLine.value = Math.max(atmo.uSnowLine.value, this.snowLo);
    atmo.uTreeSnow.value = this.treeSnow * THREE.MathUtils.smoothstep(this.groundSnow, 0.05, 0.4);
    atmo.uWet.value = this.wetness;
    atmo.uPuddle.value = this.puddles;
    atmo.uRain.value = raining;
    atmo.uIce.value = this.ice;

    // ---- lightning
    this.updateLightning(dt, camera);

    // ---- sky inputs
    const wx = env.wx;
    wx.cloudCover = v.cloud;
    wx.overcast = v.overcast;
    wx.precip = v.precip;
    wx.haze = v.haze;
    wx.mist = v.mist;
    wx.mistHeight = v.mistH;
    wx.smoke = v.smoke;
    wx.storm = v.storm;
    wx.heat = v.heat * (1 - env.night);
    wx.snowCover = this.groundSnow;
    wx.cloudSpeed = cloudSpeed;
    env.dayOfYear = this.visDay;
    env.day = time.day;

    // ---- water
    const wu = ctx.water.mat.uniforms;
    wu.uLight.value = env.lightLevel;
    (wu.uZenith.value as THREE.Color).copy(env.zenith);
    (wu.uMoonDir.value as THREE.Vector3).copy(env.moonDirection);
    wu.uMoonLight.value = env.moonLight * (1 - v.overcast);
    (wu.uSunColor.value as THREE.Color).copy(env.sunColor).multiplyScalar(Math.min(1.5, env.sunIntensity * 0.45));
    wu.uLevel.value = this.surge;
    wu.uWindS.value = windS;
    ctx.water.mesh.position.y = WATER + this.surge;

    // ---- terrain paint follows new roads/lots
    this.paintTimer -= dt;
    if (this.paintTimer <= 0) {
      this.paintTimer = 1.5;
      (ctx.terrain.material.userData.atmoRefresh as (() => void) | undefined)?.();
    }

    // ---- particles in the air
    this.updatePrecip(dt, camera);

    // ---- grade, particles wind, audio
    this.updateGrade();
    if (ctx.particles) {
      ctx.particles.wind.set(atmo.uWindDir.value.x * windS * 6, 0, atmo.uWindDir.value.y * windS * 6);
      ctx.particles.light = env.lightLevel;
    }
    if (this.thunderAt >= 0 && rt >= this.thunderAt) {
      this.thunderAt = -1;
      ctx.audio?.play('thunder', this.thunderVol);
    }
  }

  /** Target visuals: season/time baseline blended with the current spell. */
  private computeTarget(hour: number, nature: number) {
    const t = this.target;
    const id = this.ctx.mapId;
    const L = this.look;
    let kind = this.kind;
    const flakeJoke = id === 'florida' && (kind === 'snow' || kind === 'blizzard');
    if (flakeJoke) kind = 'cloudy';
    const def = KINDS[kind];
    const clear = KINDS.clear;
    const i = this.intensity;
    for (const key of VIS_KEYS) {
      if (key === 'flake' || key === 'fireflies') continue;
      const a = (clear as unknown as Record<string, number>)[key];
      const b = (def as unknown as Record<string, number>)[key];
      t[key] = a + (b - a) * i;
    }
    // seasonal cloudiness
    t.cloud = Math.min(1, t.cloud + L.wWinter * 0.15 * (1 - i * 0.5));
    // NorCal snow only falls on the peaks: down low it's rain
    if (id === 'norcal' && t.snow > 0) {
      const camHigh = THREE.MathUtils.smoothstep(this.focusY, this.snowLo - 20, this.snowLo + 40);
      t.rain = Math.max(t.rain, t.snow * (1 - camHigh));
      t.snow *= camHigh;
    }
    // morning mist: hollers, marsh, and the NorCal marine layer
    const morning = THREE.MathUtils.smoothstep(hour, 3, 5.5) * (1 - THREE.MathUtils.smoothstep(hour, 8.5, 11));
    const evening = THREE.MathUtils.smoothstep(hour, 19, 22) + (1 - THREE.MathUtils.smoothstep(hour, 3, 5.5));
    let mist = 0, mistH = 20;
    if (id === 'appalachia') {
      mist = (morning * 1.6 + evening * 0.5) * (0.7 + L.wFall * 0.6 + L.wSpring * 0.2 - L.wWinter * 0.2);
      mistH = 16;
    } else if (id === 'florida') {
      mist = morning * 1.2 + evening * 0.3;
      mistH = 10;
    } else {
      mist = (morning * 1.4 + evening * 0.8) * (L.wSummer + L.wSpring * 0.4);
      mistH = 60;
    }
    const clearish = 1 - Math.min(1, t.precip + t.smoke + t.heat);
    if (mist * clearish > t.mist) {
      const m = mist * clearish;
      t.mistH = THREE.MathUtils.lerp(t.mistH, mistH, THREE.MathUtils.clamp(m / Math.max(0.01, m + t.mist), 0, 1));
      t.mist = m;
    }
    t.flake = flakeJoke ? i : 0;
    // fireflies: warm, still, natural summer nights
    const ffSeason = id === 'appalachia' ? THREE.MathUtils.smoothstep(this.visDay, 50, 75) * (1 - THREE.MathUtils.smoothstep(this.visDay, 130, 160)) : id === 'florida' ? L.wSummer * 0.6 + L.wSpring * 0.3 : L.wSummer * 0.12;
    const night = this.ctx.env.night;
    t.fireflies = ffSeason * THREE.MathUtils.smoothstep(night, 0.4, 0.8) * (1 - Math.min(1, t.precip * 2 + t.wind * 0.8)) * THREE.MathUtils.clamp(nature * 1.2, 0, 1);
  }

  private updateLightning(dt: number, camera: THREE.Camera) {
    const v = this.vis;
    const env = this.ctx.env;
    this.strikeT += dt;
    if (v.lightning > 0.15) {
      this.nextStrike -= dt * v.lightning;
      if (this.nextStrike <= 0) {
        this.strike(camera);
        this.nextStrike = 1.2 + this.rng() * 5.5;
      }
    }
    // flash envelope: a main stroke plus return strokes
    const t = this.strikeT;
    let f = 0;
    if (t < 1.2) {
      f = Math.exp(-t / 0.06);
      if (t > 0.09) f = Math.max(f, 0.65 * Math.exp(-(t - 0.09) / 0.05));
      if (t > 0.22) f = Math.max(f, 0.85 * Math.exp(-(t - 0.22) / 0.08));
      if (t > 0.45) f = Math.max(f, 0.3 * Math.exp(-(t - 0.45) / 0.1));
    }
    const flash = f * (this.strikeHasBolt ? 1 : 0.55);
    env.wx.flash = flash;
    atmo.uFlash.value = flash;
    this.flashLight.intensity = flash * 5;
    const boltOn = this.strikeHasBolt && t < 0.55;
    this.bolt.visible = this.boltGlow.visible = boltOn;
    if (boltOn) {
      const flick = 0.35 + f;
      this.boltU.uIntensity.value = 9 * flick;
      this.boltGlowU.uIntensity.value = 1.4 * flick;
    }
  }

  private strike(camera: THREE.Camera) {
    const ctx = this.ctx;
    const r = this.rng;
    this.strikeT = 0;
    this.strikeHasBolt = r() < 0.7;
    // strike somewhere the player can see: ahead of the camera
    const cam = camera.position;
    camera.getWorldDirection(this.v3);
    this.v3.y = 0;
    if (this.v3.lengthSq() < 1e-4) this.v3.set(0, 0, -1);
    this.v3.normalize();
    const dist = 250 + r() * 900;
    const ang = (r() - 0.5) * 1.2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const gx = THREE.MathUtils.clamp(cam.x + (this.v3.x * ca - this.v3.z * sa) * dist, -HALF * 1.4, HALF * 1.4);
    const gz = THREE.MathUtils.clamp(cam.z + (this.v3.x * sa + this.v3.z * ca) * dist, -HALF * 1.4, HALF * 1.4);
    const gy = Math.max(WATER, ctx.terrain.inBounds(gx, gz) ? ctx.terrain.h(gx, gz) : WATER);
    const top = gy + 520 + r() * 200;
    this.flashLight.position.set(gx, top, gz);
    this.flashLight.target.position.set(gx, gy, gz);
    if (this.strikeHasBolt) this.buildBolt(gx, gy, gz, top);
    const d = Math.hypot(gx - cam.x, gz - cam.z);
    this.thunderAt = this.realTime + Math.min(3.2, 0.25 + d / 340 * 0.55);
    this.thunderVol = THREE.MathUtils.clamp(1.25 - d / 1600, 0.25, 1) * (this.strikeHasBolt ? 1 : 0.6);
    this.onLightning?.(gx, gz, d);
  }

  private buildBolt(gx: number, gy: number, gz: number, top: number) {
    const r = this.rng;
    const P = this.boltPos, N = this.boltNext, W = this.boltW;
    const sx = gx + (r() - 0.5) * 160, sz = gz + (r() - 0.5) * 160;
    let x = sx, y = top, z = sz;
    const put = (i: number, px: number, py: number, pz: number, w: number) => {
      for (let k = 0; k < 2; k++) {
        P[(i * 2 + k) * 3] = px; P[(i * 2 + k) * 3 + 1] = py; P[(i * 2 + k) * 3 + 2] = pz;
        W[i * 2 + k] = w;
      }
    };
    // main channel: jagged walk that converges on the ground point
    for (let i = 0; i < BOLT_MAIN; i++) {
      const t = i / (BOLT_MAIN - 1);
      const tx = sx + (gx - sx) * t, tz = sz + (gz - sz) * t;
      if (i > 0 && i < BOLT_MAIN - 1) {
        x += (tx - x) * 0.45 + (r() - 0.5) * 34;
        z += (tz - z) * 0.45 + (r() - 0.5) * 34;
      } else { x = tx; z = tz; }
      y = top + (gy - top) * t;
      put(i, x, y, z, 1 - t * 0.35);
    }
    // two forks peeling off the upper half
    for (let b = 0; b < 2; b++) {
      const from = 4 + Math.floor(r() * (BOLT_MAIN / 2));
      let bx = P[from * 6], by = P[from * 6 + 1], bz = P[from * 6 + 2];
      const dx = (r() - 0.5) * 2, dz = (r() - 0.5) * 2;
      const base = BOLT_MAIN + b * BOLT_BRANCH;
      for (let i = 0; i < BOLT_BRANCH; i++) {
        put(base + i, bx, by, bz, 0.55 * (1 - i / BOLT_BRANCH));
        bx += dx * 14 + (r() - 0.5) * 18;
        bz += dz * 14 + (r() - 0.5) * 18;
        by -= 9 + r() * 12;
      }
    }
    // "next" point for each ribbon vertex (direction of travel)
    const setNext = (start: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = start + i;
        const b = i < n - 1 ? a + 1 : a;
        const ox = i < n - 1 ? 0 : P[a * 6] - P[(a - 1) * 6];
        const oy = i < n - 1 ? 0 : P[a * 6 + 1] - P[(a - 1) * 6 + 1];
        const oz = i < n - 1 ? 0 : P[a * 6 + 2] - P[(a - 1) * 6 + 2];
        for (let k = 0; k < 2; k++) {
          N[(a * 2 + k) * 3] = P[b * 6] + ox;
          N[(a * 2 + k) * 3 + 1] = P[b * 6 + 1] + oy;
          N[(a * 2 + k) * 3 + 2] = P[b * 6 + 2] + oz;
        }
      }
    };
    setNext(0, BOLT_MAIN);
    setNext(BOLT_MAIN, BOLT_BRANCH);
    setNext(BOLT_MAIN + BOLT_BRANCH, BOLT_BRANCH);
    const g = this.bolt.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aNext') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aW') as THREE.BufferAttribute).needsUpdate = true;
  }

  private updatePrecip(dt: number, camera: THREE.Camera) {
    const v = this.vis;
    const env = this.ctx.env;
    const cam = camera.position;
    camera.getWorldDirection(this.v3);
    // box size follows zoom so the effect reads the same at any distance
    const ground = Math.max(WATER, this.ctx.terrain.inBounds(cam.x, cam.z) ? this.ctx.terrain.h(cam.x, cam.z) : WATER);
    const alt = Math.max(20, cam.y - ground);
    const rayDist = this.v3.y < -0.05 ? alt / -this.v3.y : alt * 6;
    const S = THREE.MathUtils.clamp(Math.max(alt * 0.9, rayDist * 0.45), 40, 520);
    this.v3b.copy(cam).addScaledVector(this.v3, S * 0.5);
    // world size of one pixel per meter of distance (keeps far drops >= 1px wide)
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50;
    this.ctx.renderer.getDrawingBufferSize(this.v2);
    const pixel = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, this.v2.y);
    this.rainU.uPixel.value = this.snowU.uPixel.value = this.ashU.uPixel.value = pixel;
    this.focusY = this.v3b.y;
    const time = this.realTime % 1000;
    const light = THREE.MathUtils.clamp(env.lightLevel * 0.9 + env.wx.flash * 1.5, 0.08, 2);
    const wd = atmo.uWindDir.value;
    const ws = atmo.uWindStrength.value;

    // rain streaks (hurricane rain goes sideways)
    const rainAmt = v.rain;
    this.rain.visible = rainAmt > 0.01;
    if (this.rain.visible) {
      const u = this.rainU;
      (u.uCenter.value as THREE.Vector3).copy(this.v3b);
      u.uSize.value = S;
      u.uTime.value = time;
      u.uAmount.value = Math.min(1, rainAmt * 0.5);
      const fall = S * 1.25;
      const side = S * (0.12 + ws * ws * 1.1);
      (u.uVel.value as THREE.Vector3).set(wd.x * side, -fall, wd.y * side);
      u.uLen.value = S * 0.035;
      u.uWidth.value = S * 0.0011;
      u.uSwirl.value = 0;
      u.uLevel.value = this.surge;
      (u.uColor.value as THREE.Color).setRGB(0.7, 0.75, 0.82).multiplyScalar(Math.max(0.35, light));
      u.uOpacity.value = 0.16 + rainAmt * 0.16;
    }
    // snow
    const snowAmt = this.snowCapable() ? v.snow : 0;
    this.snow.visible = snowAmt > 0.01;
    if (this.snow.visible) {
      const u = this.snowU;
      (u.uCenter.value as THREE.Vector3).copy(this.v3b);
      u.uSize.value = S;
      u.uTime.value = time;
      u.uAmount.value = Math.min(1, snowAmt);
      const side = S * (0.04 + ws * ws * 0.9);
      (u.uVel.value as THREE.Vector3).set(wd.x * side, -S * 0.11, wd.y * side);
      u.uLen.value = ws * ws * 3.5; // stretch factor along the wind
      u.uWidth.value = S * 0.0013;
      u.uSwirl.value = S * 0.012;
      u.uOpacity.value = 0.75;
      u.uLevel.value = this.surge;
      (u.uColor.value as THREE.Color).setRGB(0.95, 0.97, 1).multiplyScalar(light * 1.1);
    }
    // wildfire ash (with a few glowing embers)
    this.ash.visible = v.ash > 0.01;
    if (this.ash.visible) {
      const u = this.ashU;
      (u.uCenter.value as THREE.Vector3).copy(this.v3b);
      u.uSize.value = S;
      u.uTime.value = time;
      u.uAmount.value = v.ash * 0.45;
      (u.uVel.value as THREE.Vector3).set(wd.x * S * 0.06, -S * 0.05, wd.y * S * 0.06);
      u.uLen.value = 0;
      u.uWidth.value = S * 0.0012;
      u.uSwirl.value = S * 0.02;
      (u.uColor.value as THREE.Color).setRGB(0.42, 0.38, 0.35).multiplyScalar(Math.max(0.3, light));
    }
    // fireflies around the focus when zoomed in
    const target = this.v3b;
    const nearK = 1 - THREE.MathUtils.smoothstep(alt, 250, 600);
    const ff = v.fireflies * nearK;
    this.flies.visible = ff > 0.01;
    if (this.flies.visible) {
      const u = this.flyU;
      // focus on where the camera looks at the ground
      const tt = alt / Math.max(0.2, -this.v3.y);
      (u.uCenter.value as THREE.Vector3).set(cam.x + this.v3.x * Math.min(tt, 900), 0, cam.z + this.v3.z * Math.min(tt, 900));
      u.uTime.value = time;
      u.uAmount.value = ff;
      u.uRadius.value = THREE.MathUtils.clamp(alt * 0.45, 40, 160);
      u.uSize.value = THREE.MathUtils.clamp(alt * 0.0035, 0.25, 1.2);
    }
    // Florida snow: exactly one flake, drifting down in front of the lens
    this.flake.visible = v.flake > 0.02;
    if (this.flake.visible) {
      this.flakeT = (this.flakeT + dt) % 11;
      const ft = this.flakeT / 11;
      const u = this.flakeU;
      camera.getWorldDirection(this.v3);
      const right = this.v3b.set(-this.v3.z, 0, this.v3.x).normalize();
      const p = u.uPos.value as THREE.Vector3;
      p.copy(cam).addScaledVector(this.v3, 14).addScaledVector(right, Math.sin(ft * 9) * 1.2 + 0.8);
      p.y += 5 - ft * 10;
      u.uSize.value = 0.32;
      u.uSpin.value = ft * 6;
      u.uOpacity.value = v.flake * Math.min(1, ft * 8) * Math.min(1, (1 - ft) * 8);
    }
  }

  private updateGrade() {
    const g = this.grade;
    const v = this.vis;
    const L = this.look;
    const env = this.ctx.env;
    const night = env.night;
    // season base
    let sat = L.wSpring * 1.08 + L.wSummer * 1.1 + L.wFall * 1.16 + L.wWinter * 0.9;
    let warm = L.wSpring * 0.0 + L.wSummer * 0.06 + L.wFall * 0.16 + L.wWinter * -0.12;
    let con = L.wSpring * 1.04 + L.wSummer * 1.07 + L.wFall * 1.06 + L.wWinter * 1.02;
    let tint = L.wSpring * -0.03 + L.wFall * 0.02;
    let exp = 1;
    // golden hour warmth
    const golden = THREE.MathUtils.smoothstep(env.sunElevation, -2, 4) * (1 - THREE.MathUtils.smoothstep(env.sunElevation, 8, 22));
    warm += golden * 0.12 * (1 - v.overcast);
    // weather
    const wet = Math.max(v.rain, v.precip);
    sat *= 1 - wet * 0.2 - v.overcast * 0.08 - Math.min(1, v.mist * 0.1) * 0.15;
    warm -= wet * 0.08 + v.snow * 0.14;
    con *= 1 - Math.min(1, v.mist * 0.1) * 0.12;
    warm += v.heat * 0.6 + v.smoke * 0.5;
    sat *= 1 + v.heat * 0.05 - v.smoke * 0.1 - v.storm * 0.28;
    con *= 1 + v.heat * 0.06 + v.storm * 0.12;
    tint += -v.storm * 0.28 + v.smoke * 0.04;
    exp *= 1 - v.storm * 0.12 + v.snow * 0.04;
    // night: cooler, a touch less saturated
    sat *= 1 - night * 0.15;
    warm -= night * 0.05;
    g.saturation = sat;
    g.warmth = warm;
    g.contrast = con;
    g.tint = tint;
    g.exposure = exp;
    g.lift.setRGB(0.03 * v.heat + 0.02 * v.smoke, 0.012 * v.heat + 0.008 * v.smoke + 0.006 * v.storm, 0.004 * v.storm + night * 0.006);
    g.vignette = 0.26 + v.storm * 0.2 + night * 0.1;
    g.shimmer = v.heat * (1 - night);
    g.flash = env.wx.flash;
    g.bloom = 1 + night * 0.6;
    g.night = night;
  }

  /** Gameplay multipliers for the sim (1 = neutral). Returns a reused object. */
  effects(): WeatherEffects {
    const def = KINDS[this.kind];
    const i = this.ctx.mapId === 'florida' && (this.kind === 'snow' || this.kind === 'blizzard') ? 0 : this.intensity;
    const out = this.fx;
    out.speedMul = 1 + (def.fx.speedMul - 1) * i;
    out.crashMul = 1 + (def.fx.crashMul - 1) * i;
    out.buildMul = 1 + (def.fx.buildMul - 1) * i;
    out.demandMul = 1 + (def.fx.demandMul - 1) * i;
    out.outdoorPeopleMul = 1 + (def.fx.outdoorPeopleMul - 1) * i;
    // lingering snow and ice on the roads, and puddles
    out.speedMul *= 1 - this.groundSnow * 0.25;
    out.crashMul *= 1 + this.groundSnow * 0.8 + (this.temperature < 0 ? this.wetness * 0.6 : 0) + this.puddles * 0.15;
    // the heat keeps people in the AC; crisp fall days bring them out
    if (this.season === 'fall' && this.kind === 'clear') out.outdoorPeopleMul *= 1.1;
    return out;
  }

  /** Debug readout for dev pages. */
  debug() {
    const v = this.vis;
    return `${this.kind} ${(this.intensity * 100) | 0}% · ${this.season} · ${this.temperature.toFixed(0)}°C · snow ${(this.groundSnow * 100) | 0}% · wet ${(this.wetness * 100) | 0}% · wind ${(atmo.uWindStrength.value * 100) | 0} · mist ${v.mist.toFixed(1)}`;
  }
}
