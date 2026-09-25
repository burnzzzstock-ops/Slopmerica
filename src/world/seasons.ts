// Seasons: smooth per-map seasonal curves (nothing pops), a toy climate, and the
// shared atmosphere uniforms that the terrain, tree and water shaders read.
// Day 0 is March 20. Every look value is sampled from cyclic keyframes with
// smoothstep easing, so scrubbing the calendar never snaps a color.
import * as THREE from 'three';
import type { Season } from '../contracts';
import type { MapId } from './maps';

export const YEAR = 365;

export function seasonOf(dayOfYear: number): Season {
  const d = ((dayOfYear % YEAR) + YEAR) % YEAR;
  return d < 92 ? 'spring' : d < 184 ? 'summer' : d < 275 ? 'fall' : 'winter';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "Mar 20" style label for a day of year (UI / feed only; allocates). */
export function dateLabel(dayOfYear: number): string {
  let d = Math.floor(((dayOfYear % YEAR) + YEAR) % YEAR) + 78; // Mar 20 is day 78 of a calendar year (0-based)
  d %= YEAR;
  let m = 0;
  while (d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
  return `${MONTHS[m]} ${d + 1}`;
}

// ------------------------------------------------------------------ curves
/** Flattened [day, value, day, value, ...] keyframes, days ascending in [0, 365). */
type Curve = Float32Array;
const K = (...pairs: number[]): Curve => new Float32Array(pairs);
const FLAT0 = K(0, 0);

/** Cyclic smoothstep interpolation through keyframes. Allocation-free. */
export function sampleCurve(k: Curve, day: number): number {
  const n = k.length >> 1;
  if (n === 1) return k[1];
  const d = ((day % YEAR) + YEAR) % YEAR;
  let i = n - 1;
  for (let j = 0; j < n; j++) {
    if (k[j * 2] <= d) i = j;
    else break;
  }
  const j = (i + 1) % n;
  const d0 = k[i * 2];
  let d1 = k[j * 2];
  if (j === 0) d1 += YEAR;
  let dd = d;
  if (dd < d0) dd += YEAR;
  let t = (dd - d0) / Math.max(1e-3, d1 - d0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  t = t * t * (3 - 2 * t);
  return k[i * 2 + 1] + (k[j * 2 + 1] - k[i * 2 + 1]) * t;
}

// Handy anchors (days since Mar 20): Apr 1 = 12, May 1 = 42, Jun 1 = 73, Jul 1 = 103,
// Aug 1 = 134, Sep 1 = 165, Oct 1 = 195, Nov 1 = 226, Dec 1 = 256, Jan 1 = 287, Feb 1 = 318, Mar 1 = 346.
interface MapCurves {
  bare: Curve; // deciduous leaf-off 0..1
  fall: Curve; // autumn color 0..1
  fresh: Curve; // pale new-leaf green 0..1
  blossom: Curve; // redbud / dogwood bloom 0..1
  dull: Curve; // winter dulling of evergreens 0..1
  dry: Curve; // drought browning of oaks / shrubs 0..1
  dormant: Curve; // grass gone tan 0..1
  litter: Curve; // leaf litter on the forest floor 0..1
  golden: Curve; // NorCal hills: 1 gold, 0 green
  marsh: Curve; // Florida sawgrass browning 0..1
  flowers: Curve; // wildflowers in the grass 0..1
  snow: Curve; // climatological ground snow 0..1
}

const CURVES: Record<MapId, MapCurves> = {
  appalachia: {
    bare: K(0, 1, 12, 0.9, 22, 0.55, 32, 0.18, 42, 0, 206, 0, 222, 0.28, 238, 0.78, 252, 1),
    fall: K(0, 0, 172, 0, 192, 0.3, 206, 0.8, 216, 1, 236, 1, 256, 0.7, 276, 0.2, 300, 0),
    fresh: K(0, 0, 18, 0.3, 30, 1, 56, 0.75, 84, 0.15, 104, 0),
    blossom: K(0, 0, 6, 0.15, 16, 1, 34, 0.95, 44, 0.2, 52, 0),
    dull: K(0, 0.45, 40, 0, 238, 0, 270, 0.6, 330, 0.6),
    dry: K(0, 0, 120, 0, 150, 0.15, 180, 0.1, 200, 0),
    dormant: K(0, 0.6, 18, 0.35, 38, 0.05, 50, 0, 200, 0, 228, 0.3, 256, 0.75, 330, 0.8),
    litter: K(0, 0.55, 30, 0.35, 56, 0, 204, 0, 222, 0.5, 240, 1, 280, 0.85, 340, 0.7),
    golden: FLAT0,
    marsh: FLAT0,
    flowers: K(0, 0, 22, 0.15, 42, 0.7, 70, 0.45, 100, 0.2, 130, 0.35, 170, 0.05, 186, 0),
    snow: K(0, 0.12, 12, 0, 244, 0, 262, 0.15, 285, 0.5, 305, 0.72, 325, 0.6, 345, 0.3),
  },
  norcal: {
    bare: K(0, 0.5, 26, 0, 236, 0, 262, 0.4, 296, 0.9, 340, 0.8),
    fall: K(0, 0, 196, 0, 226, 0.45, 262, 0.35, 290, 0),
    fresh: K(0, 0.3, 20, 0.7, 50, 0.4, 80, 0),
    blossom: FLAT0,
    dull: K(0, 0, 250, 0, 290, 0.2, 340, 0.15),
    dry: K(0, 0, 60, 0, 110, 0.45, 180, 0.7, 250, 0.4, 290, 0),
    dormant: FLAT0,
    litter: K(0, 0, 220, 0, 260, 0.35, 320, 0.2),
    golden: K(0, 0.04, 38, 0.12, 62, 0.5, 84, 0.88, 100, 1, 232, 0.95, 252, 0.62, 268, 0.28, 290, 0.06, 330, 0),
    marsh: FLAT0,
    flowers: K(0, 0.65, 20, 1, 44, 0.75, 66, 0.2, 90, 0, 330, 0, 350, 0.25),
    snow: K(0, 0.04, 20, 0, 280, 0, 300, 0.2, 322, 0.28, 345, 0.1),
  },
  florida: {
    bare: K(0, 0.12, 30, 0, 240, 0, 280, 0.12, 330, 0.15),
    fall: K(0, 0.06, 30, 0, 220, 0, 256, 0.14, 290, 0.2, 330, 0.12),
    fresh: K(0, 0.35, 30, 0.2, 60, 0),
    blossom: FLAT0,
    dull: FLAT0,
    dry: K(0, 0.15, 60, 0.05, 100, 0, 240, 0, 300, 0.1),
    dormant: K(0, 0.1, 40, 0, 260, 0, 300, 0.12, 340, 0.15),
    litter: FLAT0,
    golden: FLAT0,
    marsh: K(0, 0.2, 30, 0.05, 50, 0, 250, 0, 280, 0.25, 305, 0.45, 335, 0.4),
    flowers: K(0, 0.35, 60, 0.4, 130, 0.2, 220, 0.15, 300, 0.2),
    snow: FLAT0,
  },
};

/** Everything the seasonal look needs, sampled for one day. */
export interface SeasonLook {
  bare: number;
  fall: number;
  fresh: number;
  blossom: number;
  dull: number;
  dry: number;
  dormant: number;
  litter: number;
  golden: number;
  marsh: number;
  flowers: number;
  snowClimate: number;
  /** blend weights that sum to 1: spring, summer, fall, winter */
  wSpring: number;
  wSummer: number;
  wFall: number;
  wWinter: number;
}

export function newSeasonLook(): SeasonLook {
  return { bare: 0, fall: 0, fresh: 0, blossom: 0, dull: 0, dry: 0, dormant: 0, litter: 0, golden: 0, marsh: 0, flowers: 0, snowClimate: 0, wSpring: 1, wSummer: 0, wFall: 0, wWinter: 0 };
}

const smooth01 = (t: number) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/** Season blend weights: smoothed tents centered on each season's middle, summing to 1. */
function seasonWeight(d: number, center: number) {
  let dd = Math.abs(d - center);
  if (dd > YEAR / 2) dd = YEAR - dd;
  return smooth01(1 - dd / (YEAR / 4));
}

export function sampleSeason(map: MapId, dayOfYear: number, out: SeasonLook): SeasonLook {
  const c = CURVES[map];
  const d = dayOfYear;
  out.bare = sampleCurve(c.bare, d);
  out.fall = sampleCurve(c.fall, d);
  out.fresh = sampleCurve(c.fresh, d);
  out.blossom = sampleCurve(c.blossom, d);
  out.dull = sampleCurve(c.dull, d);
  out.dry = sampleCurve(c.dry, d);
  out.dormant = sampleCurve(c.dormant, d);
  out.litter = sampleCurve(c.litter, d);
  out.golden = sampleCurve(c.golden, d);
  out.marsh = sampleCurve(c.marsh, d);
  out.flowers = sampleCurve(c.flowers, d);
  out.snowClimate = sampleCurve(c.snow, d);
  const dm = ((d % YEAR) + YEAR) % YEAR;
  const ws = seasonWeight(dm, 46), wu = seasonWeight(dm, 137), wf = seasonWeight(dm, 229), ww = seasonWeight(dm, 320);
  const sum = ws + wu + wf + ww || 1;
  out.wSpring = ws / sum;
  out.wSummer = wu / sum;
  out.wFall = wf / sum;
  out.wWinter = ww / sum;
  return out;
}

// ------------------------------------------------------------------ climate
const CLIMATE: Record<MapId, { mean: number; amp: number; diurnal: number; lat: number }> = {
  appalachia: { mean: 11, amp: 13, diurnal: 9, lat: 39 },
  norcal: { mean: 14, amp: 5.5, diurnal: 9, lat: 38 },
  florida: { mean: 23, amp: 6, diurnal: 7, lat: 27 },
};

export function latitudeOf(map: MapId) {
  return CLIMATE[map].lat;
}

/** Rough air temperature in C. Warmest ~Jul 20, coldest ~Jan 20, daily peak at 3pm. */
export function temperatureC(map: MapId, dayOfYear: number, hour: number): number {
  const c = CLIMATE[map];
  return c.mean + c.amp * Math.sin((2 * Math.PI * (dayOfYear - 30)) / YEAR) + c.diurnal * 0.5 * Math.sin((2 * Math.PI * (hour - 9)) / 24);
}

// ------------------------------------------------------------------ shared uniforms
/**
 * One set of uniform objects for the whole world. Trees and water plug these
 * exact objects into their shaders, and WeatherSystem hands them to the terrain
 * material, so updating a value here updates every shader at once.
 */
export const atmo = {
  uTime: { value: 0 },
  // wind
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  uWindStrength: { value: 0.15 },
  // ground weather
  uSnow: { value: 0 }, // ground snow cover 0..1
  uSnowLine: { value: 1e4 }, // snow sticks above this height (m)
  uTreeSnow: { value: 0 }, // snow resting on canopies
  uWet: { value: 0 }, // 0 dry .. 1 soaked
  uPuddle: { value: 0 }, // standing water
  uRain: { value: 0 }, // current rainfall, for ripples
  uIce: { value: 0 }, // frozen river edges 0..1
  // clouds
  uCloudCover: { value: 0.25 },
  uCloudShadow: { value: 0.35 }, // how dark cloud shadows are
  uCloudOffset: { value: new THREE.Vector2() },
  // light
  uSkyRefl: { value: new THREE.Color(0.55, 0.65, 0.78) }, // what wet ground and puddles reflect
  uFlash: { value: 0 }, // lightning
  // seasonal vegetation
  uBare: { value: 0 },
  uFall: { value: 0 },
  uFresh: { value: 0 },
  uBlossom: { value: 0 },
  uDull: { value: 0 },
  uDry: { value: 0 },
  uDormant: { value: 0 },
  uLitter: { value: 0 },
  uGolden: { value: 1 },
  uMarsh: { value: 0 },
  uFlowers: { value: 0 },
};
export type AtmoUniforms = typeof atmo;

/** Write a sampled season into the shared uniforms. */
export function applySeasonUniforms(s: SeasonLook) {
  atmo.uBare.value = s.bare;
  atmo.uFall.value = s.fall;
  atmo.uFresh.value = s.fresh;
  atmo.uBlossom.value = s.blossom;
  atmo.uDull.value = s.dull;
  atmo.uDry.value = s.dry;
  atmo.uDormant.value = s.dormant;
  atmo.uLitter.value = s.litter;
  atmo.uGolden.value = s.golden;
  atmo.uMarsh.value = s.marsh;
  atmo.uFlowers.value = s.flowers;
}

// ------------------------------------------------------------------ helpers for other materials
/** GLSL: value noise + cloud-shadow lookup, expects atmo uniforms uCloud*. */
export const GLSL_CLOUD_SHADOW = /* glsl */ `
float atmoH(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float atmoN(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(atmoH(i),atmoH(i+vec2(1,0)),f.x), mix(atmoH(i+vec2(0,1)),atmoH(i+vec2(1,1)),f.x), f.y); }
float atmoCloudLight(vec2 xz){
  if (uCloudShadow <= 0.001) return 1.0;
  vec2 p = xz + uCloudOffset;
  float n = atmoN(p*0.0021)*0.55 + atmoN(p*0.0057+3.7)*0.3 + atmoN(p*0.016-1.3)*0.15;
  float c = smoothstep(1.02 - uCloudCover, 1.18 - uCloudCover, n);
  return 1.0 - uCloudShadow * c;
}`;

/**
 * Opt-in weather for any MeshStandardMaterial (buildings, roads, props): snow
 * settles on up-facing surfaces, rain darkens and adds sheen, clouds cast
 * shadows. Call once per material before first render. Safe to call twice.
 */
export function applyAtmosphere(mat: THREE.MeshStandardMaterial, opts: { snow?: number; wet?: number } = {}) {
  if (mat.userData.atmoApplied) return mat;
  mat.userData.atmoApplied = true;
  const snowK = (opts.snow ?? 1).toFixed(3);
  const wetK = (opts.wet ?? 1).toFixed(3);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, {
      uSnow: atmo.uSnow, uSnowLine: atmo.uSnowLine, uWet: atmo.uWet, uCloudCover: atmo.uCloudCover,
      uCloudShadow: atmo.uCloudShadow, uCloudOffset: atmo.uCloudOffset, uSkyRefl: atmo.uSkyRefl,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoW;\nvarying vec3 vAtmoN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{ vec4 aw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  aw = instanceMatrix * aw;
#endif
#ifdef USE_BATCHING
  aw = batchingMatrix * aw;
#endif
  aw = modelMatrix * aw; vAtmoW = aw.xyz; vAtmoN = normalize(mat3(modelMatrix) * objectNormal); }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAtmoW; varying vec3 vAtmoN;
uniform float uSnow, uSnowLine, uWet, uCloudCover, uCloudShadow; uniform vec2 uCloudOffset; uniform vec3 uSkyRefl;
${GLSL_CLOUD_SHADOW}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float atmoSnow = ${snowK} * smoothstep(0.55, 0.85, vAtmoN.y) * smoothstep(uSnowLine - 8.0, uSnowLine + 8.0, vAtmoW.y + 12.0) * smoothstep(0.0, 0.35, uSnow);
float atmoWet = ${wetK} * uWet * (1.0 - atmoSnow);
diffuseColor.rgb *= 1.0 - atmoWet * 0.35;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.89, 0.95), atmoSnow);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, atmoWet * 0.7);')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{ float cl = atmoCloudLight(vAtmoW.xz); reflectedLight.directDiffuse *= cl; reflectedLight.directSpecular *= cl; }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{ vec3 av = normalize(cameraPosition - vAtmoW); float af = pow(1.0 - clamp(dot(normalize(vAtmoN), av), 0.0, 1.0), 4.0);
  outgoingLight += uSkyRefl * af * atmoWet * 0.25; }
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `atmo|${snowK}|${wetK}|${prev.toString()}`;
  mat.needsUpdate = true;
  return mat;
}
