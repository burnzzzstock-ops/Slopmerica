// Four seasons and weather. Each map has its own climate (Appalachian snow,
// NorCal marine fog + fire season + green winters, Florida afternoon storms and
// hurricanes, and one freak snowflake). A weather "spell" lasts a few days and
// blends in smoothly; it drives clouds and their shadows, sky/fog/ground mist,
// GPU rain, snow and ash, lightning, fireflies, snow cover, wet ground, river
// ice, storm surge, the post-processing grade and gameplay multipliers.
// Nothing here allocates per frame.
import * as THREE from 'three';
import type { GameTime, Season, WeatherEffects, WeatherKind } from '../contracts';
import type { MapId } from './maps';
import type { Environment } from './sky';
import type { Terrain } from './terrain';
import type { Trees } from './trees';
import type { Quality } from '../config';
import type { PostLook } from '../render/post';
import { HALF, WATER, WORLD } from '../config';
import { ATMOS } from './atmos';
import { CloudLayer } from './clouds';
import { applySeasonUniforms, atmo, ATMOS_EXTRA, newSeasonLook, sampleSeason, seasonOf, temperatureC, YEAR } from './seasons';

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
}

interface Look {
  cover: number; // cloud coverage 0..1
  overcast: number; // sky veil + dimmer sun
  fog: number; // distance haze multiplier
  mist: number; // ground mist amount (0..~8)
  mistH: number; // ground mist scale height (m)
  rain: number;
  snow: number;
  ash: number;
  wind: number;
  dark: number; // cloud darkness
  whiteout: number;
  smoke: number;
  haze: number;
  storm: number; // hurricane green-black sky
  surge: number; // storm surge (m)
  lightning: number;
  tint: [number, number, number];
  sat: number;
  contrast: number;
  exposure: number;
}

const L = (o: Partial<Look>): Look => ({
  cover: 0.3, overcast: 0, fog: 1, mist: 0, mistH: 30, rain: 0, snow: 0, ash: 0, wind: 1, dark: 0, whiteout: 0, smoke: 0, haze: 0, storm: 0, surge: 0, lightning: 0,
  tint: [1, 1, 1], sat: 1.0, contrast: 1.05, exposure: 1, ...o,
});

const LOOKS: Record<WeatherKind, Look> = {
  clear: L({}),
  cloudy: L({ cover: 0.66, overcast: 0.45, fog: 1.4, wind: 1.4, dark: 0.15, sat: 0.98 }),
  rain: L({ cover: 0.86, overcast: 0.8, fog: 2.6, mist: 0.5, mistH: 40, rain: 0.7, wind: 1.8, dark: 0.4, tint: [0.95, 0.98, 1.03], sat: 0.84, contrast: 1.02, exposure: 0.95 }),
  storm: L({ cover: 0.96, overcast: 0.92, fog: 2.4, mist: 0.7, mistH: 60, rain: 1, wind: 2.8, dark: 0.65, lightning: 1, tint: [0.9, 0.95, 1.05], sat: 0.76, exposure: 0.88 }),
  snow: L({ cover: 0.84, overcast: 0.78, fog: 2.4, mist: 0.9, mistH: 50, snow: 0.7, wind: 1.3, dark: 0.2, whiteout: 0.45, tint: [0.98, 1, 1.05], sat: 0.9 }),
  blizzard: L({ cover: 0.97, overcast: 0.95, fog: 4.5, mist: 3, mistH: 90, snow: 1, wind: 3.4, dark: 0.35, whiteout: 1, tint: [0.97, 1, 1.06], sat: 0.8, contrast: 0.96 }),
  fog: L({ cover: 0.5, overcast: 0.55, fog: 3, mist: 5.5, mistH: 42, wind: 0.5, dark: 0.1, whiteout: 0.2, sat: 0.84, contrast: 0.94 }),
  heatwave: L({ cover: 0.08, fog: 1.5, wind: 0.6, haze: 1, tint: [1.08, 1.0, 0.86], sat: 1.14, contrast: 1.09, exposure: 1.05 }),
  hurricane: L({ cover: 1, overcast: 1, fog: 3.2, mist: 1.2, mistH: 120, rain: 1.35, wind: 5, dark: 0.75, storm: 1, surge: 1.5, lightning: 0.6, tint: [0.85, 0.92, 1.0], sat: 0.68, exposure: 0.85 }),
  wildfireSmoke: L({ cover: 0.25, overcast: 0.3, fog: 4.5, mist: 1.1, mistH: 950, wind: 1.2, dark: 0.2, smoke: 1, ash: 1, tint: [1.12, 0.9, 0.72], sat: 0.9, contrast: 1.02 }),
};
const LOOK_KEYS = Object.keys(LOOKS.clear) as (keyof Look)[];

const FX: Record<WeatherKind, WeatherEffects> = {
  clear: { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 1 },
  cloudy: { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 0.9 },
  rain: { speedMul: 0.88, crashMul: 1.5, buildMul: 0.85, demandMul: 0.98, outdoorPeopleMul: 0.5 },
  storm: { speedMul: 0.8, crashMul: 2, buildMul: 0.6, demandMul: 0.95, outdoorPeopleMul: 0.25 },
  snow: { speedMul: 0.75, crashMul: 2.2, buildMul: 0.6, demandMul: 0.95, outdoorPeopleMul: 0.5 },
  blizzard: { speedMul: 0.55, crashMul: 3.5, buildMul: 0.2, demandMul: 0.9, outdoorPeopleMul: 0.1 },
  fog: { speedMul: 0.82, crashMul: 1.9, buildMul: 1, demandMul: 1, outdoorPeopleMul: 0.8 },
  heatwave: { speedMul: 0.95, crashMul: 1.2, buildMul: 0.8, demandMul: 0.98, outdoorPeopleMul: 0.35 },
  hurricane: { speedMul: 0.5, crashMul: 3.5, buildMul: 0.1, demandMul: 0.85, outdoorPeopleMul: 0.05 },
  wildfireSmoke: { speedMul: 0.9, crashMul: 1.3, buildMul: 0.8, demandMul: 0.96, outdoorPeopleMul: 0.3 },
};

type Table = Partial<Record<WeatherKind, number>>;
const CLIMATE: Record<MapId, Record<Season, Table>> = {
  appalachia: {
    spring: { clear: 0.34, cloudy: 0.26, rain: 0.24, storm: 0.08, fog: 0.08 },
    summer: { clear: 0.42, cloudy: 0.16, storm: 0.2, rain: 0.1, heatwave: 0.08, fog: 0.04 },
    fall: { clear: 0.42, cloudy: 0.24, rain: 0.18, fog: 0.16 },
    winter: { cloudy: 0.28, snow: 0.34, blizzard: 0.07, clear: 0.2, fog: 0.11 },
  },
  norcal: {
    spring: { clear: 0.5, cloudy: 0.18, rain: 0.14, fog: 0.18 },
    summer: { clear: 0.42, fog: 0.3, heatwave: 0.16, wildfireSmoke: 0.12 },
    fall: { clear: 0.42, wildfireSmoke: 0.2, heatwave: 0.14, fog: 0.12, cloudy: 0.12 },
    winter: { rain: 0.36, storm: 0.1, cloudy: 0.26, clear: 0.2, fog: 0.06, snow: 0.02 }, // snow: peaks only, rarely
  },
  florida: {
    spring: { clear: 0.55, cloudy: 0.2, storm: 0.15, rain: 0.1 },
    summer: { storm: 0.34, clear: 0.3, rain: 0.15, heatwave: 0.16, hurricane: 0.05 },
    fall: { clear: 0.4, storm: 0.15, rain: 0.15, hurricane: 0.08, cloudy: 0.22 },
    winter: { clear: 0.6, cloudy: 0.25, fog: 0.1, rain: 0.05, snow: 0.006 }, // "snow" = the one-flake joke
  },
};

/** Grass color multipliers through the year (day 0 = Mar 20). */
const GRASS: Record<MapId, [number, number, number, number][]> = {
  // green by the Mar 20 start, ochre in fall, dormant tan through the winter
  appalachia: [[0, 0.95, 1.0, 0.8], [40, 1, 1.08, 0.9], [120, 1, 1, 1], [200, 1.06, 0.95, 0.78], [255, 1.08, 0.86, 0.64], [300, 1.2, 0.9, 0.68], [340, 1.1, 0.93, 0.72], [365, 0.95, 1.0, 0.8]],
  norcal: [[0, 0.72, 1.02, 0.74], [60, 0.84, 1.0, 0.82], [100, 1, 1, 1], [240, 1, 0.98, 0.95], [275, 0.88, 1.0, 0.82], [320, 0.72, 1.02, 0.72], [365, 0.72, 1.02, 0.74]],
  florida: [[0, 1, 1.02, 0.98], [150, 1, 1.04, 1], [280, 0.97, 0.96, 0.9], [340, 0.96, 0.95, 0.9], [365, 1, 1.02, 0.98]],
};

function pick(t: Table, r: number): WeatherKind {
  let s = 0;
  for (const k in t) s += t[k as WeatherKind] ?? 0;
  let x = r * s;
  for (const k in t) {
    x -= t[k as WeatherKind] ?? 0;
    if (x <= 0) return k as WeatherKind;
  }
  return 'clear';
}

const C_SODIUM = new THREE.Color(0xff9a4a);

/** Florida's "snow" is a single flake: everything else about the day stays cloudy. */
const isFlakeJoke = (map: MapId, kind: WeatherKind) => map === 'florida' && (kind === 'snow' || kind === 'blizzard');

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
  wp.y = max(g, ${WATER.toFixed(1)}) + 0.8 + aSeed.z * 4.0 + sin(uTime * 0.7 + aSeed.x * 50.0) * 0.4;
  float blink = pow(max(0.0, sin(uTime * (0.9 + aSeed.y) + aSeed.x * 80.0)), 6.0);
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

// ------------------------------------------------------------------ weather system
export class WeatherSystem {
  season: Season = 'spring';
  kind: WeatherKind = 'clear';
  intensity = 0;
  /** Called when season or weather kind changes (for the feed / UI). */
  onChange?: (kind: WeatherKind, season: Season) => void;
  /** Lightning: delay (s) until the thunder arrives and how far the strike was. */
  onThunder?: (delay: number, dist: number) => void;
  /** Every strike: ground position, distance from the camera, and whether a bolt was drawn (vs a cloud flash). */
  onLightning?: (x: number, z: number, dist: number, bolt: boolean) => void;
  /** Written each frame: the post-processing look (point it at PostFX.look). */
  look?: PostLook;

  /** 0..1 wet ground (roads get glossy) */
  wet = 0;
  /** 0..1 snow on the ground */
  snowCover = 0;
  /** Surface breeze in m/s (x, z) for smoke and particles. */
  readonly wind = new THREE.Vector2(0.8, 0.4);
  /** Rough air temperature, C. */
  temperature = 15;
  /** The seasonal look at the current (smoothed) calendar day. */
  readonly seasonal = newSeasonLook();

  private clouds: CloudLayer;
  private cur: Look = L({});
  private target: Look = L({});
  private gameDays = 0;
  private spellEnd = 0.6;
  private spellStart = 0;
  private strength = 0.8;
  private realT = 0;
  private windAngle = 0.46;
  private windDir = new THREE.Vector2(0.9, 0.45).normalize();
  private cloudOff = new THREE.Vector2(Math.random() * 10, Math.random() * 10);
  private visDay = NaN;
  private started = false;
  private pendingNotify = false;
  private ice = 0;
  private surge = 0;
  private puddles = 0;
  private flakeAmt = 0;
  private fireflies = 0;
  private focusY = 0;
  private snowLo = 0;
  private snowPeak = 100;
  private fx: WeatherEffects = { speedMul: 1, crashMul: 1, buildMul: 1, demandMul: 1, outdoorPeopleMul: 1 };

  // lightning
  private flash = 0;
  private strikeT = 99;
  private nextStrike = 4;
  private strikeHasBolt = false;
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
  private cloudKey = new THREE.Color();
  private v2 = new THREE.Vector2();
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();

  constructor(private ctx: AtmosphereContext) {
    const low = ctx.quality.name === 'low';
    this.clouds = new CloudLayer(ctx.scene);
    this.analyzeTerrain();
    ATMOS_EXTRA.uFlowerMap.value = ctx.mapId === 'appalachia' ? 0 : ctx.mapId === 'norcal' ? 1 : 2;

    // lightning fill light (kept in the scene at 0 so strikes never trigger a recompile).
    // Low quality skips it: one less light in every shader on phones.
    this.flashLight = new THREE.DirectionalLight(0xc8d6ff, 0);
    if (!low) {
      ctx.scene.add(this.flashLight);
      ctx.scene.add(this.flashLight.target);
    }

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
    const rainMat = mk({ STREAK: '' }, 0xb9c6d6, 0.32);
    const snowMat = mk({}, 0xf4f8ff, 0.85);
    const ashMat = mk({}, 0x6a625c, 0.8);
    this.rainU = rainMat.uniforms;
    this.snowU = snowMat.uniforms;
    this.ashU = ashMat.uniforms;
    (this.ashU.uEmber.value as THREE.Color).setRGB(3.2, 1.1, 0.25);
    const snowGeo = quadGeometry(low ? 3000 : 11000, 23);
    this.rain = this.addFx(new THREE.Mesh(quadGeometry(low ? 4000 : 14000, 11), rainMat), 6);
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
    this.flies = this.addFx(new THREE.Mesh(quadGeometry(low ? 200 : 700, 37), flyMat), 7);

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
    this.bolt = this.addFx(new THREE.Mesh(boltGeo, boltMat(2.2, 1.5, 0xe8eeff)), 9);
    this.boltGlow = this.addFx(new THREE.Mesh(boltGeo, boltMat(18, 3, 0x7f8cff)), 9);
    this.boltU = (this.bolt.material as THREE.ShaderMaterial).uniforms;
    this.boltGlowU = (this.boltGlow.material as THREE.ShaderMaterial).uniforms;

    // start the county on a nice day
    this.kind = 'clear';
    this.spellEnd = 1.2 + Math.random();
  }

  private addFx<T extends THREE.Mesh>(m: T, order: number) {
    m.frustumCulled = false;
    m.renderOrder = order;
    m.visible = false;
    this.ctx.scene.add(m);
    return m;
  }

  /** Terrain height stats: where snow sticks first. */
  private analyzeTerrain() {
    const H = this.ctx.terrain.heights;
    const land: number[] = [];
    for (let i = 0; i < H.length; i += 29) if (H[i] > 0.5) land.push(H[i]);
    land.sort((a, b) => a - b);
    const pct = (p: number) => land[Math.min(land.length - 1, Math.floor(land.length * p))] ?? 0;
    this.snowPeak = pct(0.999) + 10;
    this.snowLo = this.ctx.mapId === 'norcal' ? pct(0.8) : pct(0.02) - 6;
  }

  // ---------------------------------------------------------------- spells
  private pickKind(): WeatherKind {
    let kind = pick(CLIMATE[this.ctx.mapId][this.season], Math.random());
    // temperature decides rain vs snow in the hollers
    if (this.ctx.mapId === 'appalachia') {
      if (kind === 'rain' && this.temperature < 0.5) kind = 'snow';
      else if ((kind === 'snow' || kind === 'blizzard') && this.temperature > 5) kind = 'rain';
    }
    return kind;
  }

  private startSpell(kind: WeatherKind, days: number, forced: boolean) {
    const changed = kind !== this.kind;
    this.kind = kind;
    this.spellStart = this.gameDays;
    this.spellEnd = this.gameDays + days;
    this.strength = forced ? 1 : kind === 'clear' ? 1 : 0.55 + Math.random() * 0.45;
    this.nextStrike = 1 + Math.random() * 2.5;
    if (!(changed || forced)) return;
    // before the first update we don't know the season yet; announce once we do
    if (this.started) this.onChange?.(kind, this.season);
    else this.pendingNotify = true;
  }

  /** Debug / UI override: force a weather kind for N game days. */
  force(kind: WeatherKind, days = 3) {
    this.startSpell(kind, days, true);
    // skip the slow ease-in so the button feels instant
    this.spellStart = this.gameDays - 0.18;
  }

  /** Jump every visual straight to the current state (after a calendar scrub or a scripted change). */
  settle() {
    this.spellStart = Math.min(this.spellStart, this.gameDays - 0.18);
    this.intensity = this.strength;
    this.computeTarget(this.ctx.env.hour);
    const c = this.cur, t = this.target;
    for (const key of LOOK_KEYS) {
      if (key === 'tint') for (let i = 0; i < 3; i++) c.tint[i] = t.tint[i];
      else c[key] = t[key];
    }
    this.wet = c.rain > 0.05 ? 1 : 0;
    this.puddles = c.rain > 0.2 ? 0.8 : 0;
    const floor = this.snowFloor();
    this.snowCover = this.ctx.mapId === 'florida' ? 0 : Math.max(floor, c.snow > 0.3 ? 0.7 : 0);
    this.surge = c.surge;
    this.ice = this.iceTarget();
  }

  // ---------------------------------------------------------------- frame
  /** dt: real seconds; spd: sim speed multiplier (0 = paused). */
  update(dt: number, time: GameTime, camera: THREE.Camera, spd = 1, camDist = 800) {
    const ctx = this.ctx, env = ctx.env, map = ctx.mapId;
    this.realT += dt;
    const dDays = (dt * spd) / 360;
    this.gameDays += dDays;

    // calendar, smoothed so an integer day counter never steps the colors
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
    sampleSeason(map, this.visDay, this.seasonal);
    applySeasonUniforms(this.seasonal);
    atmo.uTime.value = this.realT;
    const c = this.cur;
    this.temperature = temperatureC(map, this.visDay, env.hour) - c.rain * 2 + c.haze * 7 - c.snow * 3;
    const s = seasonOf(doy);
    if (s !== this.season) {
      this.season = s;
      if (this.started) this.onChange?.(this.kind, s);
    }
    if (!this.started && this.pendingNotify) this.onChange?.(this.kind, s);
    this.started = true;
    this.pendingNotify = false;

    // next spell, and its ease in/out
    if (this.gameDays >= this.spellEnd) this.startSpell(this.pickKind(), 0.5 + Math.random() * 2.5, false);
    const into = (this.gameDays - this.spellStart) / 0.18, left = (this.spellEnd - this.gameDays) / 0.18;
    this.intensity = Math.max(0, Math.min(1, into, left)) * this.strength;

    // blend every look parameter toward the target (game time, with a real-time floor)
    this.computeTarget(env.hour);
    if (scrubbed) this.settle();
    else {
      const k = 1 - Math.exp(-(dDays / 0.06 + dt / 3));
      const t = this.target;
      for (const key of LOOK_KEYS) {
        if (key === 'tint') for (let i = 0; i < 3; i++) c.tint[i] += (t.tint[i] - c.tint[i]) * k;
        else c[key] += (t[key] - c[key]) * k;
      }
    }

    // ground: wetness, snowpack, river ice, surge
    const wantWet = c.rain > 0.05 ? 1 : c.mist > 3 ? 0.35 : 0;
    this.wet += (wantWet - this.wet) * (1 - Math.exp(-(dDays / (wantWet > this.wet ? 0.08 : 0.5) + (wantWet > this.wet ? dt / 20 : 0))));
    if (c.haze > 0.3) this.wet = Math.max(0, this.wet - dDays * 3);
    if (c.rain > 0.2 && this.wet > 0.6) this.puddles = Math.min(1, this.puddles + (dDays / 0.1 + dt / 16) * c.rain);
    else this.puddles = Math.max(0, this.puddles - (dDays / 0.4 + dt / 50));
    atmo.uPuddle.value = this.puddles;
    atmo.uRain.value = Math.min(1, c.rain);
    const mountainSnow = map === 'norcal' && this.season === 'winter' ? c.rain * 0.8 : 0;
    const snowing = map === 'florida' ? 0 : Math.max(c.snow, mountainSnow);
    if (snowing > 0.05) this.snowCover = Math.min(1, this.snowCover + (dDays * 1.8 + dt / 25) * snowing);
    else {
      const melt = this.season === 'winter' ? 0.2 : this.season === 'fall' ? 1 : 3;
      this.snowCover = Math.max(0, this.snowCover - dDays * melt * (1 + c.rain * 2));
    }
    // the hollers keep a winter snowpack of their own between storms
    const floor = this.snowFloor();
    if (this.snowCover < floor) this.snowCover += (floor - this.snowCover) * (1 - Math.exp(-(dDays / 0.5 + dt / 60)));
    if (map === 'florida') this.snowCover = 0;
    this.ice += (this.iceTarget() - this.ice) * Math.min(1, dt * 0.05 + dDays * 2);
    this.surge += (c.surge - this.surge) * Math.min(1, dt * 0.08 + dDays * 3);

    // shared uniforms
    ATMOS.uCloudCover.value = c.cover;
    ATMOS.uCloudShadow.value = (0.35 + c.overcast * 0.2) * (1 - env.night) * (1 - c.overcast * 0.6);
    ATMOS.uSnow.value = this.snowCover;
    // light cover dusts the peaks; heavy cover reaches the valley floors
    let line = this.snowCover < 0.005 ? 1e5 : THREE.MathUtils.lerp(this.snowPeak, this.snowLo, 1 - Math.pow(1 - this.snowCover, 2.2)) - (this.snowCover > 0.9 ? 30 : 0);
    if (map === 'norcal') line = Math.max(line, this.snowLo);
    ATMOS.uSnowLine.value = map === 'florida' ? 1e5 : line;
    ATMOS.uWet.value = this.wet;
    ATMOS.uWind.value = c.wind;
    // clouds drift with the wind
    this.windAngle += (Math.sin(this.realT * 0.05) * 0.02 + (c.storm > 0.3 ? 0.08 : 0)) * dt;
    this.windDir.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    const windSpeed = 0.0000009 * (0.6 + c.wind);
    this.cloudOff.x += this.windDir.x * windSpeed * dt * (1 + spd * 3);
    this.cloudOff.y += this.windDir.y * windSpeed * dt * (1 + spd * 3);
    ATMOS.uCloudOffset.value.copy(this.cloudOff);
    // seasonal grass
    const keys = GRASS[map];
    const d = this.visDay;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (d >= a[0] && d <= b[0]) {
        const t = (d - a[0]) / Math.max(1, b[0] - a[0]);
        ATMOS.uGrassTint.value.setRGB(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
        break;
      }
    }

    // sky / fog / lighting inputs
    env.overcast = c.overcast;
    env.fogMul = c.fog;
    env.smoke = c.smoke;
    env.haze = c.haze;
    env.whiteout = c.whiteout;
    env.mist = c.mist;
    env.mistHeight = c.mistH;
    env.precip = Math.min(1, Math.max(c.rain, c.snow) * 0.8);
    env.storm = c.storm;
    env.snowCover = this.snowCover;
    env.dayOfYear = this.visDay;
    env.day = time.day;

    // lightning
    this.updateLightning(dt, camera, c.lightning);
    env.flash = this.flash;
    // clouds at night: moonlit by a bright moon, dark on a moonless night, sodium-orange over a big city
    const moonK = Math.min(1, env.moonLight / 0.9);
    this.cloudKey.copy(env.sunColor).multiplyScalar(1 - env.night * (1 - moonK) * 0.85);
    this.cloudKey.lerp(C_SODIUM, env.night * env.lightPollution * 0.6);
    this.clouds.update(this.cloudKey, env.fog.color, env.night, Math.min(1, c.dark + env.night * (1 - moonK) * (1 - env.lightPollution) * 0.8), this.flash);

    // surface breeze for smoke and particles (m/s)
    this.wind.copy(this.windDir).multiplyScalar(0.9 * c.wind);

    // precipitation, ash, fireflies and the Florida flake
    this.updatePrecip(dt, camera, camDist);

    // water: rain ripples, wind chop, bank ice, storm surge
    const wu = ctx.water.mat.uniforms;
    if (wu.uRain) wu.uRain.value = c.rain;
    if (wu.uWindAmp) wu.uWindAmp.value = 0.7 + c.wind * 0.3;
    if (wu.uIce) wu.uIce.value = this.ice;
    if (wu.uLevel) wu.uLevel.value = this.surge;
    if (wu.uLight) wu.uLight.value = env.lightLevel;
    if (wu.uMoonDir) (wu.uMoonDir.value as THREE.Vector3).copy(env.moonDirection);
    if (wu.uMoonLight) wu.uMoonLight.value = env.moonLight * (1 - c.overcast);
    if (wu.uFlash) wu.uFlash.value = this.flash;
    ctx.water.mesh.position.y = WATER + this.surge;

    // post: weather look + a subtle seasonal grade, heat shimmer and the lightning flash
    const lk = this.look;
    if (lk) {
      const S = this.seasonal;
      const night = env.night;
      const golden = THREE.MathUtils.smoothstep(env.sunElevation, -2, 4) * (1 - THREE.MathUtils.smoothstep(env.sunElevation, 8, 22)) * (1 - c.overcast);
      const warm = S.wSummer * 0.04 + S.wFall * 0.1 - S.wWinter * 0.08 + golden * 0.08 - night * 0.04;
      const sat = S.wSpring * 1.05 + S.wSummer * 1.06 + S.wFall * 1.1 + S.wWinter * 0.92;
      lk.tint.setRGB(c.tint[0] * (1 + warm * 0.25), c.tint[1] * (1 + warm * 0.04), c.tint[2] * (1 - warm * 0.3));
      lk.sat = c.sat * sat * (1 - night * 0.12);
      lk.contrast = c.contrast;
      lk.exposure = c.exposure;
      lk.lift.setRGB(0.03, 0.03, 0.035).multiplyScalar(Math.min(1, (c.fog - 1) / 8 + c.mist * 0.05));
      lk.lift.r += 0.02 * c.haze + 0.02 * c.smoke;
      lk.lift.g += 0.008 * c.haze + 0.008 * c.smoke + 0.006 * c.storm;
      lk.shimmer = c.haze * (1 - night);
      lk.flash = this.flash;
    }
  }

  /** Target look: the clear baseline blended toward the current spell, plus morning mist. */
  private computeTarget(hour: number) {
    const map = this.ctx.mapId;
    const t = this.target, base = LOOKS.clear;
    const flakeJoke = isFlakeJoke(map, this.kind);
    const spell = LOOKS[flakeJoke ? 'cloudy' : this.kind];
    const i = this.intensity;
    for (const key of LOOK_KEYS) {
      if (key === 'tint') for (let j = 0; j < 3; j++) t.tint[j] = base.tint[j] + (spell.tint[j] - base.tint[j]) * i;
      else t[key] = base[key] + (spell[key] - base[key]) * i;
    }
    this.flakeAmt = flakeJoke ? i : 0;
    // NorCal snow only falls on the peaks: down low it's rain
    if (map === 'norcal' && t.snow > 0) {
      const high = THREE.MathUtils.smoothstep(this.focusY, this.snowLo - 20, this.snowLo + 40);
      t.rain = Math.max(t.rain, t.snow * (1 - high));
      t.snow *= high;
    }
    // morning mist: hollers, marsh, and the NorCal marine layer
    const S = this.seasonal;
    const morning = THREE.MathUtils.smoothstep(hour, 3, 5.5) * (1 - THREE.MathUtils.smoothstep(hour, 8.5, 11));
    const evening = THREE.MathUtils.smoothstep(hour, 19, 22) + (1 - THREE.MathUtils.smoothstep(hour, 3, 5.5));
    let mist = 0, mistH = 20;
    if (map === 'appalachia') {
      mist = (morning * 1.6 + evening * 0.5) * (0.7 + S.wFall * 0.6 + S.wSpring * 0.2 - S.wWinter * 0.2);
      mistH = 16;
    } else if (map === 'florida') {
      mist = morning * 1.2 + evening * 0.3;
      mistH = 10;
    } else {
      mist = (morning * 1.4 + evening * 0.8) * (S.wSummer + S.wSpring * 0.4);
      mistH = 60;
    }
    mist *= 1 - Math.min(1, t.rain + t.smoke + t.haze);
    if (mist > t.mist) {
      t.mistH = THREE.MathUtils.lerp(t.mistH, mistH, THREE.MathUtils.clamp(mist / Math.max(0.01, mist + t.mist), 0, 1));
      t.mist = mist;
    }
    // fireflies: warm, still, natural summer nights
    const ff = map === 'appalachia' ? THREE.MathUtils.smoothstep(this.visDay, 50, 75) * (1 - THREE.MathUtils.smoothstep(this.visDay, 130, 160)) : map === 'florida' ? S.wSummer * 0.6 + S.wSpring * 0.3 : S.wSummer * 0.12;
    this.fireflies = ff * THREE.MathUtils.smoothstep(this.ctx.env.night, 0.4, 0.8) * (1 - Math.min(1, t.rain * 2 + Math.max(0, t.wind - 1) * 0.5)) * THREE.MathUtils.clamp(this.ctx.trees.naturePct * 1.2, 0, 1);
  }

  private snowFloor() {
    if (this.ctx.mapId !== 'appalachia') return 0;
    return this.seasonal.snowClimate * (this.temperature < 3 ? 1 : 0.4);
  }

  private iceTarget() {
    if (this.ctx.mapId !== 'appalachia') return 0;
    // daily mean (9am sits on the mean of the diurnal curve), colder when it snows
    const t = temperatureC('appalachia', this.visDay, 9) - this.cur.snow * 3;
    return THREE.MathUtils.clamp((1.5 - t) / 6, 0, 1);
  }

  // ---------------------------------------------------------------- lightning
  private updateLightning(dt: number, camera: THREE.Camera, lightning: number) {
    this.strikeT += dt;
    if (lightning > 0.35) {
      this.nextStrike -= dt * (0.4 + lightning);
      if (this.nextStrike <= 0) {
        this.strike(camera);
        this.nextStrike = 2.5 + Math.random() * 7;
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
    this.flash = f * (this.strikeHasBolt ? 1 : 0.55);
    this.flashLight.intensity = this.flash * 5;
    const boltOn = this.strikeHasBolt && t < 0.55;
    this.bolt.visible = this.boltGlow.visible = boltOn;
    if (boltOn) {
      const flick = 0.35 + f;
      this.boltU.uIntensity.value = 9 * flick;
      this.boltGlowU.uIntensity.value = 1.4 * flick;
    }
  }

  private strike(camera: THREE.Camera) {
    const T = this.ctx.terrain;
    this.strikeT = 0;
    this.strikeHasBolt = Math.random() < 0.7;
    // strike somewhere the player can see: ahead of the camera
    const cam = camera.position;
    camera.getWorldDirection(this.v3);
    this.v3.y = 0;
    if (this.v3.lengthSq() < 1e-4) this.v3.set(0, 0, -1);
    this.v3.normalize();
    const dist = 300 + Math.random() * 1500;
    const ang = (Math.random() - 0.5) * 1.2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const gx = THREE.MathUtils.clamp(cam.x + (this.v3.x * ca - this.v3.z * sa) * dist, -HALF * 1.4, HALF * 1.4);
    const gz = THREE.MathUtils.clamp(cam.z + (this.v3.x * sa + this.v3.z * ca) * dist, -HALF * 1.4, HALF * 1.4);
    const gy = Math.max(WATER, T.inBounds(gx, gz, 0) ? T.h(gx, gz) : WATER);
    const top = Math.max(gy + 500, ATMOS.uCloudH.value * 0.55);
    this.flashLight.position.set(gx, top, gz);
    this.flashLight.target.position.set(gx, gy, gz);
    if (this.strikeHasBolt) this.buildBolt(gx, gy, gz, top);
    const d = Math.hypot(gx - cam.x, gz - cam.z);
    this.onThunder?.(d / 340, d * (this.strikeHasBolt ? 1 : 1.6));
    this.onLightning?.(gx, gz, d, this.strikeHasBolt);
  }

  private buildBolt(gx: number, gy: number, gz: number, top: number) {
    const r = Math.random;
    const P = this.boltPos, N = this.boltNext, W = this.boltW;
    const sx = gx + (r() - 0.5) * 220, sz = gz + (r() - 0.5) * 220;
    let x = sx, z = sz;
    const put = (i: number, px: number, py: number, pz: number, w: number) => {
      for (let k = 0; k < 2; k++) {
        P[(i * 2 + k) * 3] = px; P[(i * 2 + k) * 3 + 1] = py; P[(i * 2 + k) * 3 + 2] = pz;
        W[i * 2 + k] = w;
      }
    };
    // main channel: a jagged walk that converges on the ground point
    for (let i = 0; i < BOLT_MAIN; i++) {
      const t = i / (BOLT_MAIN - 1);
      const tx = sx + (gx - sx) * t, tz = sz + (gz - sz) * t;
      if (i > 0 && i < BOLT_MAIN - 1) {
        x += (tx - x) * 0.45 + (r() - 0.5) * 48;
        z += (tz - z) * 0.45 + (r() - 0.5) * 48;
      } else { x = tx; z = tz; }
      put(i, x, top + (gy - top) * t, z, 1 - t * 0.35);
    }
    // two forks peeling off the upper half
    for (let b = 0; b < 2; b++) {
      const from = 4 + Math.floor(r() * (BOLT_MAIN / 2));
      let bx = P[from * 6], by = P[from * 6 + 1], bz = P[from * 6 + 2];
      const dx = (r() - 0.5) * 2, dz = (r() - 0.5) * 2;
      const base = BOLT_MAIN + b * BOLT_BRANCH;
      for (let i = 0; i < BOLT_BRANCH; i++) {
        put(base + i, bx, by, bz, 0.55 * (1 - i / BOLT_BRANCH));
        bx += dx * 20 + (r() - 0.5) * 26;
        bz += dz * 20 + (r() - 0.5) * 26;
        by -= 12 + r() * 18;
      }
    }
    // "next" point for each ribbon vertex (direction of travel)
    const setNext = (start: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = start + i;
        const b = i < n - 1 ? a + 1 : a;
        const last = i === n - 1;
        const ox = last ? P[a * 6] - P[(a - 1) * 6] : 0;
        const oy = last ? P[a * 6 + 1] - P[(a - 1) * 6 + 1] : 0;
        const oz = last ? P[a * 6 + 2] - P[(a - 1) * 6 + 2] : 0;
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

  // ---------------------------------------------------------------- particles in the air
  private updatePrecip(dt: number, camera: THREE.Camera, camDist: number) {
    const c = this.cur;
    const env = this.ctx.env;
    const T = this.ctx.terrain;
    const cam = camera.position;
    camera.getWorldDirection(this.v3);
    // the box follows zoom so the effect reads the same at any distance
    const ground = Math.max(WATER, T.inBounds(cam.x, cam.z, 0) ? T.h(cam.x, cam.z) : WATER);
    const alt = Math.max(20, cam.y - ground);
    const rayDist = this.v3.y < -0.05 ? alt / -this.v3.y : Math.max(alt * 6, camDist);
    const S = THREE.MathUtils.clamp(Math.max(alt * 0.9, rayDist * 0.45), 40, 520);
    this.v3b.copy(cam).addScaledVector(this.v3, S * 0.5);
    this.focusY = this.v3b.y;
    // world size of one pixel per meter of distance (keeps far drops >= 1px wide)
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50;
    this.ctx.renderer.getDrawingBufferSize(this.v2);
    const pixel = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, this.v2.y);
    this.rainU.uPixel.value = this.snowU.uPixel.value = this.ashU.uPixel.value = pixel;
    const time = this.realT % 1000;
    const light = THREE.MathUtils.clamp(env.lightLevel * 0.9 + this.flash * 1.5, 0.08, 2);
    const wd = this.windDir;
    const ws = THREE.MathUtils.clamp((c.wind - 0.6) / 4, 0.05, 1.2);

    // rain streaks (hurricane rain goes sideways)
    const rainAmt = Math.min(1, c.rain);
    this.rain.visible = rainAmt > 0.01;
    if (this.rain.visible) {
      const u = this.rainU;
      (u.uCenter.value as THREE.Vector3).copy(this.v3b);
      u.uSize.value = S;
      u.uTime.value = time;
      u.uAmount.value = Math.min(1, c.rain * 0.5);
      const side = S * (0.12 + ws * ws * 1.1);
      (u.uVel.value as THREE.Vector3).set(wd.x * side, -S * 1.25, wd.y * side);
      u.uLen.value = S * 0.035;
      u.uWidth.value = S * 0.0011;
      u.uLevel.value = this.surge;
      (u.uColor.value as THREE.Color).setRGB(0.7, 0.75, 0.82).multiplyScalar(Math.max(0.35, light));
      u.uOpacity.value = 0.16 + rainAmt * 0.16;
    }
    // snow
    const snowAmt = this.ctx.mapId === 'florida' ? 0 : Math.min(1, c.snow);
    this.snow.visible = snowAmt > 0.01;
    if (this.snow.visible) {
      const u = this.snowU;
      (u.uCenter.value as THREE.Vector3).copy(this.v3b);
      u.uSize.value = S;
      u.uTime.value = time;
      u.uAmount.value = snowAmt;
      const side = S * (0.04 + ws * ws * 0.9);
      (u.uVel.value as THREE.Vector3).set(wd.x * side, -S * 0.11, wd.y * side);
      u.uLen.value = ws * ws * 3.5; // stretch factor along the wind
      u.uWidth.value = S * 0.0013;
      u.uSwirl.value = S * 0.012;
      u.uLevel.value = this.surge;
      u.uOpacity.value = 0.75;
      (u.uColor.value as THREE.Color).setRGB(0.95, 0.97, 1).multiplyScalar(light * 1.1);
    }
    // wildfire ash (with a few glowing embers)
    this.ash.visible = c.ash > 0.01;
    if (this.ash.visible) {
      const u = this.ashU;
      (u.uCenter.value as THREE.Vector3).copy(this.v3b);
      u.uSize.value = S;
      u.uTime.value = time;
      u.uAmount.value = c.ash * 0.45;
      (u.uVel.value as THREE.Vector3).set(wd.x * S * 0.06, -S * 0.05, wd.y * S * 0.06);
      u.uLen.value = 0;
      u.uWidth.value = S * 0.0012;
      u.uSwirl.value = S * 0.02;
      (u.uColor.value as THREE.Color).setRGB(0.42, 0.38, 0.35).multiplyScalar(Math.max(0.3, light));
    }
    // fireflies around where the camera looks, when zoomed in
    const ff = this.fireflies * (1 - THREE.MathUtils.smoothstep(alt, 250, 600));
    this.flies.visible = ff > 0.01;
    if (this.flies.visible) {
      const u = this.flyU;
      const tt = Math.min(alt / Math.max(0.2, -this.v3.y), 900);
      (u.uCenter.value as THREE.Vector3).set(cam.x + this.v3.x * tt, 0, cam.z + this.v3.z * tt);
      u.uTime.value = time;
      u.uAmount.value = ff;
      u.uRadius.value = THREE.MathUtils.clamp(alt * 0.45, 40, 160);
      u.uSize.value = THREE.MathUtils.clamp(alt * 0.005, 0.35, 1.7);
    }
    // Florida snow: exactly one flake, drifting down in front of the lens
    this.flake.visible = this.flakeAmt > 0.02;
    if (this.flake.visible) {
      this.flakeT = (this.flakeT + dt) % 11;
      const ft = this.flakeT / 11;
      const u = this.flakeU;
      const right = this.v3b.set(-this.v3.z, 0, this.v3.x).normalize();
      const p = u.uPos.value as THREE.Vector3;
      p.copy(cam).addScaledVector(this.v3, 14).addScaledVector(right, Math.sin(ft * 9) * 1.2 + 0.8);
      p.y += 5 - ft * 10;
      u.uSize.value = 0.32;
      u.uSpin.value = ft * 6;
      u.uOpacity.value = this.flakeAmt * Math.min(1, ft * 8) * Math.min(1, (1 - ft) * 8);
    }
  }

  /** Gameplay multipliers for the sim (1 = neutral). Returns a reused object. */
  effects(): WeatherEffects {
    const f = FX[this.kind];
    const t = isFlakeJoke(this.ctx.mapId, this.kind) ? 0 : this.intensity;
    const out = this.fx;
    out.speedMul = 1 + (f.speedMul - 1) * t;
    out.crashMul = 1 + (f.crashMul - 1) * t;
    out.buildMul = 1 + (f.buildMul - 1) * t;
    out.demandMul = 1 + (f.demandMul - 1) * t;
    out.outdoorPeopleMul = 1 + (f.outdoorPeopleMul - 1) * t;
    // lingering snow and ice on the roads
    out.speedMul *= 1 - this.snowCover * 0.2;
    out.crashMul *= 1 + this.snowCover * 0.6 + (this.temperature < 0 ? this.wet * 0.6 : 0);
    return out;
  }

  /** One-line state for dev pages. */
  debug() {
    const c = this.cur;
    return `${this.kind} ${(this.intensity * 100) | 0}% · ${this.season} · ${this.temperature.toFixed(0)}°C · snow ${(this.snowCover * 100) | 0}% · wet ${(this.wet * 100) | 0}% · ice ${(this.ice * 100) | 0}% · wind ${c.wind.toFixed(1)} · mist ${c.mist.toFixed(1)} · surge ${this.surge.toFixed(2)}m`;
  }
}
