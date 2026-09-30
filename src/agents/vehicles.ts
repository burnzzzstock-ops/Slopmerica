import * as THREE from 'three';
import { GLOW } from '../config';
import type { VehicleKind } from '../contracts';
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from '../world/atmos';
import { buildModelLod, modelDef, vehicleDecalAtlas, vehicleModelList, variantsOf, type ModelLod } from './models/vehicleModels';
import type { LampSet, V3 } from './models/vehicleKit';
import { pickLook, type Look } from './models/vehiclePaint';
import { WHEEL_GLSL } from './models/vehicleWheel';
import { VehicleFx, type FxEnvironment } from './vehicleFx';

export interface VehicleSpec { length: number; width: number; height: number; maxSpeed: number; label: string }

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  sedan: { length: 4.6, width: 1.8, height: 1.4, maxSpeed: 38, label: 'Sedan' },
  hatchback: { length: 4.0, width: 1.75, height: 1.45, maxSpeed: 36, label: 'Hatchback' },
  suv: { length: 4.9, width: 1.95, height: 1.8, maxSpeed: 36, label: 'SUV' },
  minivan: { length: 5.1, width: 1.95, height: 1.8, maxSpeed: 34, label: 'Minivan' },
  pickup: { length: 5.8, width: 2.0, height: 1.9, maxSpeed: 38, label: 'Pickup' },
  liftedTruck: { length: 6.0, width: 2.2, height: 2.6, maxSpeed: 40, label: 'Lifted Truck' },
  cyberslop: { length: 5.7, width: 2.1, height: 1.9, maxSpeed: 44, label: 'Cyberslop' },
  semi: { length: 16, width: 2.5, height: 4, maxSpeed: 30, label: 'Semi' },
  boxTruck: { length: 8, width: 2.4, height: 3.4, maxSpeed: 30, label: 'Box Truck' },
  police: { length: 5.0, width: 1.95, height: 1.5, maxSpeed: 45, label: 'Sheriff' },
  ambulance: { length: 6.5, width: 2.3, height: 2.8, maxSpeed: 40, label: 'Ambulance' },
  firetruck: { length: 10, width: 2.5, height: 3.2, maxSpeed: 34, label: 'Fire Truck' },
  golfCart: { length: 2.4, width: 1.2, height: 1.8, maxSpeed: 9, label: 'Golf Cart' },
  vwBus: { length: 4.5, width: 1.8, height: 2.0, maxSpeed: 26, label: 'Hippie Bus' },
  slopVan: { length: 5.4, width: 2.0, height: 2.4, maxSpeed: 32, label: 'SLOP Van' },
  motorcycle: { length: 2.2, width: 0.8, height: 1.3, maxSpeed: 48, label: 'Motorcycle' },
  towTruck: { length: 7, width: 2.4, height: 3, maxSpeed: 32, label: 'Tow Truck' },
  cityBus: { length: 12, width: 2.55, height: 3.15, maxSpeed: 28, label: 'SLOP Transit Bus' },
  garbageTruck: { length: 9, width: 2.5, height: 3.4, maxSpeed: 28, label: 'Garbage Truck' },
};

/** Liveried vehicles ignore the random paint pool. */
export const FIXED_PAINT: Partial<Record<VehicleKind, number>> = {
  police: 0xe9e6de, ambulance: 0xf1efe8, firetruck: 0xb3151d, cityBus: 0xeceee8, garbageTruck: 0xe6e6e0,
};

const KINDS = Object.keys(VEHICLE_SPECS) as VehicleKind[];

export function randomVehicleKind(rnd: () => number): VehicleKind {
  const r = rnd();
  if (r < 0.28) return 'pickup';
  if (r < 0.46) return 'sedan';
  if (r < 0.62) return 'suv';
  if (r < 0.70) return 'liftedTruck';
  if (r < 0.78) return 'minivan';
  if (r < 0.84) return 'hatchback';
  if (r < 0.88) return 'cyberslop';
  if (r < 0.92) return 'boxTruck';
  if (r < 0.95) return 'semi';
  if (r < 0.97) return 'motorcycle';
  return 'slopVan';
}

/**
 * The colours traffic.ts draws its cars' paint from (its PAINT list). add() treats exactly these as "pick me a paint": the
 * renderer swaps in a realistic mix (mostly white, black, grey and silver) with a finish, age and dirt. Any other colour is
 * used as given, and so is a liveried kind's. If traffic.ts changes its list, cars keep whatever colour it sends.
 */
const RANDOM_PAINT_REQUEST = new Set([0xf2f2f2, 0x1a1a1a, 0x9aa0a6, 0x5a5e63, 0xb3202a, 0x1d3a8a, 0x2d4a2d, 0xc9b48a, 0xe0e0e0, 0x7a1f1f, 0x0f5f7a, 0xd8d8d2, 0xe89b2a, 0x2a2a2a]);

const nightUniform = { value: 0 };
const timeUniform = { value: 0 };

/**
 * One material for every part of every vehicle (paint, glass, trim, tyres, lamps): the geometry says which is which through
 * its vertex attributes (models/vehicleKit.ts), the instance says the paint, finish, age, dirt, lamp state and suspension.
 */
function vehicleMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.14 });
  material.onBeforeCompile = (shader) => {
    bindAtmos(shader);
    shader.uniforms.tVehicleAtlas = { value: vehicleDecalAtlas() };
    shader.uniforms.uVehicleNight = nightUniform;
    shader.uniforms.uVehicleTime = timeUniform;
    shader.uniforms.uGlow = GLOW;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aTint; attribute vec4 aInfo; attribute vec3 aHub;
attribute vec3 iPaint; attribute vec4 iLook; attribute vec4 iMisc; attribute vec2 iWheel; attribute vec3 iBody;
varying vec4 vTint; varying vec4 vLook; varying vec4 vMisc;
varying vec3 vPaint, vLocal, vVehWorld, vVehWorldNormal, vLocalN;
varying float vZone; varying vec2 vVehUv;
${WHEEL_GLSL}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
if (aInfo.y > 0.5) objectNormal = vehicleWheelNormal(objectNormal, iWheel, aInfo.y);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTint = aTint; vLook = iLook; vMisc = iMisc; vPaint = iPaint; vZone = aInfo.x; vVehUv = uv;
if (aInfo.y > 0.5) {
  transformed = vehicleWheelPosition(transformed, aHub * (1.0 / 1024.0), iWheel, aInfo.y);
} else {
  // the sprung body: heave, and pitch and roll about the middle of the car (the wheels stay on the road)
  transformed.y += iBody.x + iBody.y * transformed.z + iBody.z * transformed.x;
}
vLocal = transformed; vLocalN = objectNormal;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 vwp = vec4(transformed, 1.0);
  vec3 vwn = objectNormal;
#ifdef USE_INSTANCING
  vwp = instanceMatrix * vwp;
  vwn = mat3(instanceMatrix) * vwn;
#endif
  vVehWorld = (modelMatrix * vwp).xyz;
  vVehWorldNormal = normalize(mat3(modelMatrix) * vwn);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSnow, uSnowLine, uWet, uVehicleNight, uVehicleTime, uGlow;
uniform sampler2D tVehicleAtlas;
varying vec4 vTint; varying vec4 vLook; varying vec4 vMisc;
varying vec3 vPaint, vLocal, vVehWorld, vVehWorldNormal, vLocalN;
varying float vZone; varying vec2 vVehUv;
${CLOUD_GLSL}
float vehicleHash(vec3 p) { vec3 p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vehicleNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vehicleHash(i), vehicleHash(i + vec3(1,0,0)), f.x), mix(vehicleHash(i + vec3(0,1,0)), vehicleHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(vehicleHash(i + vec3(0,0,1)), vehicleHash(i + vec3(1,0,1)), f.x), mix(vehicleHash(i + vec3(0,1,1)), vehicleHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float vRough = 0.34, vMetal = 0.2, vGloss = 1.0;
vec3 lampEmit = vec3(0.0);
float zn = vZone + 0.5;
// how big one pixel is on the car, in metres: fine grain (flake, brushing, rust and dirt speckle) fades out as it gets smaller than a pixel, so it can't shimmer
float pixM = length(fwidth(vLocal));
#define GRAIN(freq) (1.0 - smoothstep(0.35 / (freq), 0.9 / (freq), pixM))
{
  vec3 tint = vTint.rgb * vTint.rgb * (0.4 + 0.6 * vTint.rgb) ; // sRGB bytes to linear, cheap (close to pow 2.2)
  tint = pow(vTint.rgb, vec3(2.2));
  vec3 base = tint * mix(vec3(1.0), vPaint, vTint.a);
  float finish = vLook.x, age = vLook.y, dirt = vLook.z, special = vLook.w;
  vec3 wn = normalize(vVehWorldNormal);
  float up = smoothstep(0.55, 0.92, wn.y);
  float lenScale = max(1.0, vMisc.w);
  float fz = vLocal.z / lenScale;
  // ---- zones
  if (zn < 1.0) {                                    // 0 paint
    vRough = 0.3; vMetal = 0.08; vGloss = 1.0;
    if (finish > 0.5 && finish < 1.5) { vMetal = 0.55; vRough = 0.26; float fl = vehicleHash(floor(vLocal * 380.0)); base *= 1.0 + (fl - 0.5) * 0.2 * GRAIN(380.0); }
    else if (finish > 1.5 && finish < 2.5) { vMetal = 0.06; vRough = 0.66; vGloss = 0.0; }
    else if (finish > 2.5) { vMetal = 0.3; vRough = 0.4; vGloss = 0.6; base *= 1.0 + (vehicleHash(floor(vLocal * 260.0)) - 0.5) * 0.2 * GRAIN(260.0); }
    if (vTint.a > 0.4) {
      // age: a chalky faded roof, hood and deck; rust at the lower edges of a beater
      float faded = age * up * 0.75;
      float luma = dot(base, vec3(0.3, 0.59, 0.11));
      base = mix(base, vec3(luma * 1.05 + 0.05), faded * 0.55);
      base *= 1.0 + faded * 0.12;
      vRough += faded * 0.32; vGloss *= 1.0 - faded * 0.85;
      float lowEdge = 1.0 - smoothstep(0.3, 0.75, vLocal.y);
      float rustN = vehicleNoise(vLocal * 9.0 + special);
      float rust = smoothstep(0.55, 0.95, age) * lowEdge * smoothstep(0.42, 0.7, rustN);
      base = mix(base, vec3(0.32, 0.15, 0.07) * (1.0 + (vehicleHash(floor(vLocal * 70.0)) - 0.5) * 0.6 * GRAIN(70.0)), rust * 0.92);
      vRough = mix(vRough, 0.8, rust); vGloss *= 1.0 - rust;
      // a primer panel or a mismatched door
      float pt = floor(mod(special, 8.0) + 0.5);
      if (pt > 0.5) {
        bool inHood = fz > 0.12 && fz < 0.5 && wn.y > 0.45;
        bool inFender = fz > 0.16 && abs(vLocal.x) > 0.3 && vLocal.y > 0.4 && vLocal.y < 1.1;
        bool inDoor = fz > -0.13 && fz < 0.13 && vLocal.y > 0.3 && abs(wn.x) > 0.6;
        bool inQuarter = fz < -0.16 && fz > -0.4 && abs(vLocal.x) > 0.3 && vLocal.y > 0.35 && vLocal.y < 1.1;
        float pm = 0.0;
        if (pt < 1.5) pm = inHood ? 1.0 : 0.0;
        else if (pt < 2.5) pm = (inFender && vLocal.x > 0.0) ? 1.0 : 0.0;
        else if (pt < 3.5) pm = (inDoor && vLocal.x > 0.0) ? 2.0 : 0.0;
        else if (pt < 4.5) pm = inQuarter ? 1.0 : 0.0;
        else pm = (inDoor && vLocal.x < 0.0) ? 2.0 : 0.0;
        if (pm > 0.5 && pm < 1.5) { base = vec3(0.19, 0.185, 0.18); vRough = 0.85; vGloss = 0.0; vMetal = 0.02; }
        else if (pm > 1.5) { // a door from another car: a different colour, shinier
          float pick = fract(special * 0.137 + 0.31);
          base = pick < 0.25 ? vec3(0.62, 0.62, 0.6) : pick < 0.5 ? vec3(0.05, 0.05, 0.06) : pick < 0.75 ? vec3(0.03, 0.09, 0.22) : vec3(0.3, 0.02, 0.02);
        }
      }
    }
  } else if (zn < 2.0) {                               // 1 glass
    base = tint * vec3(0.8, 0.92, 1.0); vRough = 0.05; vMetal = 0.62; vGloss = 1.0;
  } else if (zn < 3.0) {                               // 2 chrome
    vRough = 0.22; vMetal = 0.85; vGloss = 0.0;
  } else if (zn < 4.0) {                               // 3 plastic
    vRough = 0.8; vMetal = 0.0; vGloss = 0.0;
  } else if (zn < 5.0) {                               // 4 decal (atlas)
    vec4 decal = texture2D(tVehicleAtlas, vVehUv);
    if (decal.a < 0.08) discard;
    base = decal.rgb; vRough = 0.5; vMetal = 0.0; vGloss = 0.5;
  } else if (zn < 6.0) {                               // 5 headlamp
    float autoHead = smoothstep(0.25, 0.6, uVehicleNight);
    float headMode = floor(mod(vMisc.z, 18.0) / 6.0 + 0.01);
    float headOn = headMode > 1.5 ? 1.0 : headMode > 0.5 ? 0.0 : autoHead;
    vRough = 0.08; vMetal = 0.3; vGloss = 1.0;
    lampEmit = vec3(1.0, 0.93, 0.78) * (0.02 + headOn * 4.2);
  } else if (zn < 7.0) {                               // 6 tail lamp
    float autoHead = smoothstep(0.25, 0.6, uVehicleNight);
    float headMode = floor(mod(vMisc.z, 18.0) / 6.0 + 0.01);
    float lightsOn = headMode > 1.5 ? 1.0 : headMode > 0.5 ? 0.0 : autoHead;
    float brakeOn = mod(vMisc.z, 2.0);
    vRough = 0.12; vMetal = 0.2; vGloss = 1.0;
    lampEmit = vec3(1.0, 0.06, 0.03) * (0.05 + lightsOn * 0.75 + brakeOn * 3.8);
  } else if (zn < 8.0) {                               // 7 turn signal
    float turnDir = floor(mod(vMisc.z, 6.0) * 0.5 + 0.01) - 1.0;
    float side = vLocal.x > 0.0 ? 1.0 : -1.0;
    float blink = step(0.0, sin(uVehicleTime * 9.4 + vMisc.x * 6.0));
    float on = (turnDir != 0.0 && side * turnDir > 0.0) ? blink : 0.0;
    vRough = 0.12; vMetal = 0.2;
    lampEmit = vec3(1.0, 0.5, 0.05) * (0.04 + on * 4.6);
  } else if (zn < 9.0) {                               // 8 reverse
    float revOn = floor(mod(vMisc.z, 36.0) / 18.0 + 0.01);
    vRough = 0.1; vMetal = 0.2;
    lampEmit = vec3(1.0, 0.98, 0.9) * (0.03 + revOn * 3.6);
  } else if (zn < 12.0) {                              // 9 siren red, 10 siren blue, 11 amber beacon
    float sirenOn = floor(vMisc.z / 36.0 + 0.01);
    float sideK = zn < 10.0 ? 0.0 : zn < 11.0 ? 3.14159 : 1.6;
    float flash = step(0.15, sin(uVehicleTime * (zn < 11.0 ? 19.0 : 8.0) + vMisc.x * 13.0 + sideK));
    vec3 col = zn < 10.0 ? vec3(1.0, 0.05, 0.08) : zn < 11.0 ? vec3(0.08, 0.35, 1.0) : vec3(1.0, 0.55, 0.05);
    lampEmit = col * (0.1 + sirenOn * flash * 4.8);
    vRough = 0.1;
  } else if (zn < 13.0) {                              // 12 unpainted panel (liveries, cargo): fixed colour, semi-gloss
    vRough = 0.42; vMetal = 0.05; vGloss = 0.45;
  } else if (zn < 14.0) {                              // 13 tyre rubber
    vRough = 0.92; vMetal = 0.0; vGloss = 0.0;
  } else if (zn < 15.0) {                              // 14 dark trim, matte
    vRough = 0.7; vMetal = 0.1; vGloss = 0.0;
  } else if (zn < 16.0) {                              // 15 stainless steel (the Cyberslop)
    float brush = vehicleHash(vec3(floor(vLocal.z * 900.0), floor(vLocal.y * 40.0), 0.0));
    vRough = 0.34 + brush * 0.08 * GRAIN(900.0); vMetal = 0.95; vGloss = 0.0;
    base *= 1.0 + (brush - 0.5) * 0.1 * GRAIN(900.0);
  } else if (zn < 17.0) {                              // 16 marker lamp (steady amber, at night)
    lampEmit = vec3(1.0, 0.5, 0.05) * (0.05 + smoothstep(0.25, 0.6, uVehicleNight) * 0.9);
  } else {                                             // 17 work light
    lampEmit = vec3(1.0, 0.96, 0.85) * 0.03;
  }
  // ---- dirt and mud (paint, glass and trim alike, lower body first)
  float lowerGrime = 1.0 - smoothstep(0.2, 1.3, vLocal.y);
  bool mud = special >= 8.0;
  if (zn >= 12.0 && zn < 15.0 || zn < 1.0 || zn > 2.0 && zn < 4.0 || zn > 15.0 && zn < 16.0) {   // (glass gets only a film of dust, below)
    float n = vehicleNoise(vLocal * 6.0);
    float grimeAmt = dirt * lowerGrime * (0.35 + 0.6 * n);
    vec3 dirtCol = mud ? vec3(0.17, 0.11, 0.06) : vec3(0.28, 0.25, 0.21);
    if (mud) grimeAmt = clamp(dirt * (1.3 - smoothstep(0.1, 1.5, vLocal.y)) * (0.4 + 0.9 * vehicleNoise(vLocal * 11.0 + 3.0)), 0.0, 0.92);
    base = mix(base, dirtCol * (1.0 + (vehicleHash(floor(vLocal * 50.0)) - 0.5) * 0.5 * GRAIN(50.0)), clamp(grimeAmt, 0.0, 0.9));
    vRough = mix(vRough, 0.85, clamp(grimeAmt * 1.3, 0.0, 1.0)); vGloss *= 1.0 - clamp(grimeAmt * 1.6, 0.0, 1.0);
    // a film of road dust on everything horizontal
    base = mix(base, vec3(0.34, 0.31, 0.27), dirt * up * 0.22);
  }
  if (zn > 1.0 && zn < 2.0) base = mix(base, vec3(0.12, 0.11, 0.1), dirt * 0.18 * lowerGrime);
  // damage
  base = mix(base, base * vec3(0.34, 0.25, 0.20), vMisc.y * (0.18 + vehicleHash(vVehWorld * 5.0) * 0.18));
  // snow on horizontal panels
  float snow = uSnow * up * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vVehWorld.y);
  base = mix(base, vec3(0.86, 0.89, 0.92), snow * 0.82);
  diffuseColor.rgb = base;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(vRough, 0.1, uWet * 0.7 * step(zn, 3.0));
roughnessFactor = mix(roughnessFactor, 0.28, uWet * 0.6 * step(3.0, zn) * (1.0 - step(6.0, zn)));`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = vMetal;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= vGloss;
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += lampEmit * uGlow;
// a dark car at night still reads: at grazing angles the clearcoat mirrors the town's glow on the horizon (a thin bluish rim, not a lamp)
if (zn < 3.5) totalEmissiveRadiance += vec3(0.30, 0.36, 0.50) * pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0) * uVehicleNight * 0.12 * uGlow;`)
      .replace('#include <lights_fragment_end>', cloudShadowChunk('vVehWorld'));
  };
  material.customProgramCacheKey = () => 'aa-vehicle-unified-v3';
  return material;
}

const MATERIAL = vehicleMaterial();
const PICK_MATERIAL = new THREE.MeshBasicMaterial();

// ---------------------------------------------------------------------------------------------------------------------------
// instancing

interface Attrs {
  paint: THREE.InstancedBufferAttribute; look: THREE.InstancedBufferAttribute; misc: THREE.InstancedBufferAttribute;
  wheel: THREE.InstancedBufferAttribute; body: THREE.InstancedBufferAttribute;
}
interface LodBatch {
  mesh: THREE.InstancedMesh; attrs: Attrs; count: number;
  sourceByRender: Int32Array; revisionByRender: Uint32Array;
  staticStart: number; staticEnd: number;
}
interface VariantBatch { id: string; kind: VehicleKind; lamps: LampSet; wheelRadius: number; nearTriangles: number; closeTriangles: number; close?: LodBatch; near: LodBatch }
interface KindBatch {
  kind: VehicleKind; used: number; free: number[];
  far: LodBatch; variants: Map<string, VariantBatch>;
  pickMesh: THREE.InstancedMesh; wheelRadius: number; farTriangles: number;
  active: Uint8Array; initialized: Uint8Array; handleByInstance: Int32Array; variantOf: Uint8Array;
  matrices: Float32Array; paint: Float32Array; look: Float32Array; seed: Float32Array;
  previousX: Float32Array; previousY: Float32Array; previousZ: Float32Array; previousYaw: Float32Array;
  spin: Float32Array; steer: Float32Array; braking: Uint8Array; turn: Int8Array; damaged: Uint8Array;
  parked: Uint8Array; reversing: Uint8Array; headlights: Uint8Array; siren: Uint8Array;
  heave: Float32Array; heaveV: Float32Array; pitch: Float32Array; pitchV: Float32Array; roll: Float32Array; rollV: Float32Array; vy: Float32Array;
  lod: Int8Array; revision: Uint32Array;
  reverseTimer: Float32Array; speed: Float32Array; accel: Float32Array; fxTimer: Float32Array; fxTimer2: Float32Array; surfaceTimer: Float32Array; onGravel: Uint8Array;
}
interface Slot { kind: VehicleKind; instance: number }

const inst = (capacity: number, size: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);

function makeLod(name: string, geometry: THREE.BufferGeometry, capacity: number, shadows: boolean): LodBatch {
  const attrs: Attrs = { paint: inst(capacity, 3), look: inst(capacity, 4), misc: inst(capacity, 4), wheel: inst(capacity, 2), body: inst(capacity, 3) };
  geometry.setAttribute('iPaint', attrs.paint); geometry.setAttribute('iLook', attrs.look); geometry.setAttribute('iMisc', attrs.misc);
  geometry.setAttribute('iWheel', attrs.wheel); geometry.setAttribute('iBody', attrs.body);
  const mesh = new THREE.InstancedMesh(geometry, MATERIAL, capacity);
  mesh.name = name; mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
  mesh.castShadow = shadows; mesh.receiveShadow = true;
  return { mesh, attrs, count: 0, sourceByRender: new Int32Array(capacity).fill(-1), revisionByRender: new Uint32Array(capacity), staticStart: capacity, staticEnd: 0 };
}

type UploadRange = { start: number; count: number };
const UPLOAD_RANGES = new WeakMap<THREE.BufferAttribute, UploadRange>();
/** Reuses Three's update-range object instead of allocating in the frame loop. */
function markAttributeRange(attribute: THREE.BufferAttribute | THREE.InstancedBufferAttribute | undefined, start: number, end: number, itemSize = 1): void {
  if (!attribute || end <= start) return;
  let range = UPLOAD_RANGES.get(attribute);
  if (!range) { range = { start: 0, count: 0 }; UPLOAD_RANGES.set(attribute, range); }
  range.start = start * itemSize; range.count = (end - start) * itemSize;
  attribute.updateRanges.length = 0; attribute.updateRanges.push(range); attribute.needsUpdate = true;
}
function markLod(lod: LodBatch, count: number): void {
  lod.count = count; lod.mesh.count = count;
  markAttributeRange(lod.mesh.instanceMatrix, 0, count, 16);
  markAttributeRange(lod.attrs.wheel, 0, count, 2); markAttributeRange(lod.attrs.body, 0, count, 3);
  markAttributeRange(lod.attrs.misc, 0, count, 4); // the lamp state changes often; it rides with the static fields
  markAttributeRange(lod.attrs.paint, lod.staticStart, lod.staticEnd, 3); markAttributeRange(lod.attrs.look, lod.staticStart, lod.staticEnd, 4);
  lod.staticStart = lod.sourceByRender.length; lod.staticEnd = 0;
}

export interface VehicleRenderStats {
  active: number; drawCallsPerNearKind: number; drawCallsPerFarKind: number;
  kinds: Record<string, { nearTriangles: number; farTriangles: number }>;
  models?: Record<string, { closeTriangles: number; nearTriangles: number; farTriangles: number }>;
  modelsBuilt?: number; modelsTotal?: number;
}

const clamp = THREE.MathUtils.clamp;

/** Options a caller may pass to add(); all optional. The traffic session sends none. */
export interface VehicleAddOptions {
  /** A model id from vehicleModelList() (default: chosen by weight among the kind's variants). */
  variant?: string;
  /** Use `color` exactly (solid paint, no age): dev pages and tests. Liveried kinds always do. */
  exact?: boolean;
  /** Seed for the look (finish, age, dirt): a car keeps its look for as long as it exists. */
  seed?: number;
}

export class VehicleRenderer {
  readonly object = new THREE.Group();
  private readonly batches = new Map<VehicleKind, KindBatch>();
  private readonly slots: Array<Slot | undefined> = [];
  private readonly freeHandles: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly maxTotal: number;
  private readonly perKind: number;
  private activeTotal = 0;
  private cameraValid = false; private cameraX = 0; private cameraY = 0; private cameraZ = 0;
  private lodClose = 46; private lodNear = 180; private lodCull = 1500;
  private lodOverride = -1;
  private lastFlush = 0; private dt = 1 / 60;
  private rngState = 0x9e3779b1; private addCount = 0;
  private pending: string[] = [];
  private readonly closeQueue: VariantBatch[] = [];
  private readonly fx: VehicleFx;
  /** Optional: the game tells the renderer what the road under a point is (dust off gravel). Called at most twice a second per near car. */
  surfaceAt?: (x: number, z: number) => 'gravel' | 'paved';

  constructor(scene: THREE.Scene, maxTotal: number) {
    this.maxTotal = Math.max(0, Math.floor(maxTotal));
    this.perKind = Math.max(16, Math.ceil(this.maxTotal / 3));
    this.object.name = 'aa-vehicles';
    for (const kind of KINDS) this.buildKind(kind);
    // the variants of every kind come in over the first frames, so the first frame doesn't build 59 models
    const rest = vehicleModelList().filter((m) => m.id !== m.kind && variantsOf(m.kind)[0].id !== m.id);
    rest.sort((a, b) => b.weight - a.weight);
    this.pending = rest.map((m) => m.id);
    if (this.maxTotal <= 600) { this.lodClose = 36; this.lodNear = 112; this.lodCull = 930; }
    this.fx = new VehicleFx(Math.max(64, this.maxTotal * 6), this.maxTotal <= 600 ? 140 : 360, nightUniform, timeUniform);
    this.object.add(this.fx.mesh);
    scene.add(this.object);
  }

  private captureCamera = (_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, camera: THREE.Camera) => {
    this.cameraX = camera.matrixWorld.elements[12]; this.cameraY = camera.matrixWorld.elements[13]; this.cameraZ = camera.matrixWorld.elements[14];
    this.cameraValid = true;
  };

  private buildKind(kind: VehicleKind): void {
    const spec = VEHICLE_SPECS[kind];
    const base = variantsOf(kind)[0];
    // start-up builds only the near and far levels of each kind's base model (the close level, and the other variants, come in on demand)
    const nearModel = buildModelLod(kind, spec, base.id, 1);
    const farModel = buildModelLod(kind, spec, base.id, 2);
    const far = makeLod(`vehicle-${kind}-far`, farModel.geometry, this.perKind, false);
    far.mesh.onBeforeRender = this.captureCamera;
    this.object.add(far.mesh);
    const pickGeometry = new THREE.BoxGeometry(spec.width, spec.height, spec.length);
    pickGeometry.translate(0, spec.height * 0.5, 0);
    const pickMesh = new THREE.InstancedMesh(pickGeometry, PICK_MATERIAL, this.perKind);
    pickMesh.name = `vehicle-${kind}-pick`; pickMesh.visible = false; pickMesh.count = 0;
    pickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.object.add(pickMesh);
    const n = this.perKind;
    const kb: KindBatch = {
      kind, used: 0, free: [], far, variants: new Map(), pickMesh, wheelRadius: nearModel.wheelRadius, farTriangles: farModel.triangles,
      active: new Uint8Array(n), initialized: new Uint8Array(n), handleByInstance: new Int32Array(n).fill(-1), variantOf: new Uint8Array(n),
      matrices: new Float32Array(n * 16), paint: new Float32Array(n * 3), look: new Float32Array(n * 4), seed: new Float32Array(n),
      previousX: new Float32Array(n), previousY: new Float32Array(n), previousZ: new Float32Array(n), previousYaw: new Float32Array(n),
      spin: new Float32Array(n), steer: new Float32Array(n), braking: new Uint8Array(n), turn: new Int8Array(n), damaged: new Uint8Array(n),
      parked: new Uint8Array(n), reversing: new Uint8Array(n), headlights: new Uint8Array(n), siren: new Uint8Array(n),
      heave: new Float32Array(n), heaveV: new Float32Array(n), pitch: new Float32Array(n), pitchV: new Float32Array(n), roll: new Float32Array(n), rollV: new Float32Array(n), vy: new Float32Array(n),
      lod: new Int8Array(n), revision: new Uint32Array(n),
      reverseTimer: new Float32Array(n), speed: new Float32Array(n), accel: new Float32Array(n), fxTimer: new Float32Array(n), fxTimer2: new Float32Array(n), surfaceTimer: new Float32Array(n), onGravel: new Uint8Array(n),
    };
    this.batches.set(kind, kb);
    this.attachVariant(kb, base.id, nearModel);
  }

  /** Make (or find) a model's near batch. The close batch is built later, by buildClose, when a car of the model first comes within range. */
  private attachVariant(kb: KindBatch, id: string, near?: ModelLod): VariantBatch {
    const have = kb.variants.get(id);
    if (have) return have;
    const m = near ?? buildModelLod(kb.kind, VEHICLE_SPECS[kb.kind], id, 1);
    const nearLod = makeLod(`vehicle-${id}-near`, m.geometry, this.perKind, true);
    nearLod.mesh.onBeforeRender = this.captureCamera;
    this.object.add(nearLod.mesh);
    const vb: VariantBatch = { id, kind: kb.kind, lamps: m.lamps, wheelRadius: m.wheelRadius, nearTriangles: m.triangles, closeTriangles: 0, near: nearLod };
    kb.variants.set(id, vb);
    return vb;
  }

  /** Build a model's close-range level of detail (its own mesh): one per frame at most, so a first close-up doesn't stall a frame. */
  private buildClose(vb: VariantBatch): void {
    const m = buildModelLod(vb.kind, VEHICLE_SPECS[vb.kind], vb.id, 0);
    const close = makeLod(`vehicle-${vb.id}-close`, m.geometry, Math.min(this.perKind, 48), true);
    close.mesh.onBeforeRender = this.captureCamera;
    this.object.add(close.mesh);
    vb.close = close; vb.closeTriangles = m.triangles; vb.lamps = m.lamps;
  }

  /** Build one queued model (called from flush, so the load is spread over the first frames). */
  private warm(): void {
    while (this.pending.length) {
      const id = this.pending.shift()!;
      const d = modelDef(id);
      if (!d || this.batches.get(d.kind)!.variants.has(id)) continue;
      this.attachVariant(this.batches.get(d.kind)!, id);
      return;
    }
  }

  private rnd(): number {
    // xorshift32: the look of a car must not draw from the simulation's random stream
    let x = this.rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rngState = x >>> 0; return this.rngState / 4294967296;
  }

  /** Which model draws this car: by weight among the kind's models that are built (all of them, once the queue has run). */
  private pickVariant(kind: VehicleKind, requested?: string): string {
    const kb = this.batches.get(kind)!;
    if (requested) { const d = modelDef(requested); if (d && d.kind === kind) { this.attachVariant(kb, requested); return requested; } }
    const list = variantsOf(kind).filter((d) => kb.variants.has(d.id));
    let total = 0; for (const d of list) total += d.weight;
    let r = this.rnd() * total;
    for (const d of list) { r -= d.weight; if (r <= 0) return d.id; }
    return list[0].id;
  }

  add(kind: VehicleKind, color: number, options?: VehicleAddOptions): number {
    if (this.activeTotal >= this.maxTotal) return -1;
    const batch = this.batches.get(kind)!;
    const instance = batch.free.length ? batch.free.pop()! : batch.used < this.perKind ? batch.used++ : -1;
    if (instance < 0) return -1;
    const handle = this.freeHandles.length ? this.freeHandles.pop()! : this.slots.length;
    this.slots[handle] = { kind, instance }; batch.active[instance] = 1; batch.initialized[instance] = 0;
    batch.handleByInstance[instance] = handle; batch.braking[instance] = 0; batch.turn[instance] = 0; batch.damaged[instance] = 0;
    batch.spin[instance] = 0; batch.steer[instance] = 0;
    batch.parked[instance] = 0; batch.reversing[instance] = 0; batch.headlights[instance] = 0;
    batch.heave[instance] = batch.heaveV[instance] = batch.pitch[instance] = batch.pitchV[instance] = batch.roll[instance] = batch.rollV[instance] = 0;
    batch.reverseTimer[instance] = 0; batch.speed[instance] = batch.accel[instance] = batch.fxTimer[instance] = batch.fxTimer2[instance] = batch.surfaceTimer[instance] = 0; batch.onGravel[instance] = 0;
    batch.revision[instance]++;
    if (options?.seed !== undefined) this.rngState = (Math.imul(options.seed | 0, 2654435761) ^ 0x9e3779b1) >>> 0 || 1;
    this.addCount++;
    // the look: fixed livery, the exact colour asked for, or a realistic paint drawn from the mix
    const liveried = FIXED_PAINT[kind] !== undefined;
    const random = !options?.exact && !liveried && RANDOM_PAINT_REQUEST.has(color);
    const look: Look = pickLook(kind, random ? undefined : color, liveried || !!options?.exact, () => this.rnd());
    batch.paint[instance * 3] = look.rgb[0]; batch.paint[instance * 3 + 1] = look.rgb[1]; batch.paint[instance * 3 + 2] = look.rgb[2];
    batch.look[instance * 4] = look.finish; batch.look[instance * 4 + 1] = look.age; batch.look[instance * 4 + 2] = look.dirt; batch.look[instance * 4 + 3] = look.special;
    batch.seed[instance] = this.rnd();
    const id = this.pickVariant(kind, options?.variant);
    batch.variantOf[instance] = Math.max(0, variantsOf(kind).findIndex((d) => d.id === id));
    batch.pickMesh.count = batch.used; this.activeTotal++; return handle;
  }

  remove(handle: number): void {
    const slot = this.slots[handle]; if (!slot) return;
    const batch = this.batches.get(slot.kind)!;
    batch.active[slot.instance] = 0; batch.initialized[slot.instance] = 0; batch.handleByInstance[slot.instance] = -1; batch.free.push(slot.instance);
    this.matrix.makeScale(0, 0, 0); batch.pickMesh.setMatrixAt(slot.instance, this.matrix);
    markAttributeRange(batch.pickMesh.instanceMatrix, 0, (slot.instance + 1), 16);
    this.slots[handle] = undefined; this.freeHandles.push(handle); this.activeTotal--;
  }

  set(handle: number, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0): void {
    const slot = this.slots[handle]; if (!slot) return;
    const batch = this.batches.get(slot.kind)!; const i = slot.instance;
    if (batch.initialized[i]) {
      const dx = x - batch.previousX[i], dz = z - batch.previousZ[i], distance = Math.hypot(dx, dz);
      if (distance < 30 && !batch.parked[i]) {
        // wheels turn with the ground they cover: forwards when the car moves along its nose, backwards when it backs up
        const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        if (along < -0.01) batch.reverseTimer[i] = 0.4; // moving backwards along its own nose: the reverse lamps come on by themselves
        batch.spin[i] = (batch.spin[i] + (along >= 0 ? distance : -distance) / Math.max(0.18, batch.wheelRadius)) % (Math.PI * 2);
      }
      let dyaw = yaw - batch.previousYaw[i]; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const target = distance > 0.015 ? clamp(dyaw * 4.5, -0.48, 0.48) : 0;
      batch.steer[i] += (target - batch.steer[i]) * 0.42;
      // suspension input: how the road height moves under the car (a junction join, a crest, a kerb ramp)
      batch.vy[i] = (y - batch.previousY[i]) / Math.max(0.004, this.dt);
      const sp = distance < 30 ? distance / Math.max(0.004, this.dt) : 0;
      batch.accel[i] += ((sp - batch.speed[i]) / Math.max(0.004, this.dt) - batch.accel[i]) * 0.15;
      batch.speed[i] += (sp - batch.speed[i]) * 0.3;
    } else batch.initialized[i] = 1;
    batch.previousX[i] = x; batch.previousY[i] = y; batch.previousZ[i] = z; batch.previousYaw[i] = yaw;
    this.euler.set(pitch, yaw, roll, 'YXZ'); this.quaternion.setFromEuler(this.euler);
    this.matrix.makeRotationFromQuaternion(this.quaternion).setPosition(x, y, z);
    this.matrix.toArray(batch.matrices, i * 16); batch.pickMesh.setMatrixAt(i, this.matrix);
  }

  setBraking(handle: number, on: boolean): void {
    const slot = this.slots[handle]; if (slot) this.batches.get(slot.kind)!.braking[slot.instance] = on ? 1 : 0;
  }
  /** Turn signal: -1 right, 0 off, 1 left. */
  setTurn(handle: number, dir: number): void {
    const slot = this.slots[handle]; if (slot) this.batches.get(slot.kind)!.turn[slot.instance] = dir > 0 ? 1 : dir < 0 ? -1 : 0;
  }
  setDamaged(handle: number, on: boolean): void {
    const slot = this.slots[handle];
    if (slot) {
      const batch = this.batches.get(slot.kind)!;
      const value = on ? 1 : 0;
      if (batch.damaged[slot.instance] !== value) { batch.damaged[slot.instance] = value; batch.revision[slot.instance]++; }
    }
  }
  /**
   * Optional (the traffic session calls it only if it exists): a parked car sits still. The suspension settles, the wheels stop
   * turning, and the lamps go off (no headlights, no tail glow, no blinker); the engine is off.
   */
  setParked(handle: number, on: boolean): void {
    const slot = this.slots[handle]; if (!slot) return;
    const b = this.batches.get(slot.kind)!; const i = slot.instance, v = on ? 1 : 0;
    if (b.parked[i] !== v) { b.parked[i] = v; b.headlights[i] = on ? 1 : 0; if (on) { b.braking[i] = 0; b.turn[i] = 0; } b.revision[i]++; }
  }
  /**
   * Optional: reverse lamps on (backing out of a parking space). The renderer also lights them by itself whenever a car moves backwards
   * along its own nose, and the wheels turn backwards from the motion, so this only matters for a car that is stopped in reverse.
   */
  setReversing(handle: number, on: boolean): void {
    const slot = this.slots[handle]; if (slot) this.batches.get(slot.kind)!.reversing[slot.instance] = on ? 1 : 0;
  }
  /**
   * Optional headlights: 0 automatic (on at night and in heavy rain, off by day), 1 off, 2 on. Parked cars are off.
   */
  setHeadlights(handle: number, level: number): void {
    const slot = this.slots[handle]; if (slot) this.batches.get(slot.kind)!.headlights[slot.instance] = level >= 2 ? 2 : level >= 1 ? 1 : 0;
  }
  /** Optional: emergency lights and siren state for a liveried vehicle (default on for sheriff, ambulance, fire truck). */
  setSiren(handle: number, on: boolean): void {
    const slot = this.slots[handle]; if (slot) this.batches.get(slot.kind)!.siren[slot.instance] = on ? 2 : 1;
  }
  /** Optional: the weather, for exhaust that shows in the cold and spray in rain (the game sets it every frame; a page that doesn't leaves the defaults). */
  setEnvironment(env: Partial<FxEnvironment>): void { Object.assign(this.fx.env, env); }
  setNight(night: number): void { nightUniform.value = THREE.MathUtils.clamp(night, 0, 1); }
  /** Dev and tests: force a level of detail for every car (0 close, 1 near, 2 far); -1 back to by-distance. */
  setLodOverride(level: number): void { this.lodOverride = level; }

  /** Stores camera state; flush() performs the allocation-free near/far instance pack. */
  updateLod(camera: THREE.Camera, quality: 'high' | 'low' | number = 'high'): void {
    this.cameraX = camera.matrixWorld.elements[12]; this.cameraY = camera.matrixWorld.elements[13]; this.cameraZ = camera.matrixWorld.elements[14];
    const scale = typeof quality === 'number' ? Math.max(0.45, quality) : quality === 'low' ? 0.62 : 1;
    this.lodClose = 46 * scale; this.lodNear = 180 * scale; this.lodCull = 1500 * scale; this.cameraValid = true;
  }

  private lampCode(b: KindBatch, i: number): number {
    const kindSiren = b.kind === 'police' || b.kind === 'ambulance' || b.kind === 'firetruck' || b.kind === 'towTruck';
    const siren = b.siren[i] === 2 ? 1 : b.siren[i] === 1 ? 0 : kindSiren && !b.parked[i] ? 1 : 0;
    return (b.braking[i] && !b.parked[i] ? 1 : 0) + (b.turn[i] + 1) * 2 + (b.parked[i] ? 1 : b.headlights[i]) * 6 + (b.reversing[i] || b.reverseTimer[i] > 0 ? 18 : 0) + siren * 36;
  }

  /** Spring the body on its wheels: road-height changes kick it, gravity and damping settle it. Purely a drawing effect. */
  private suspension(b: KindBatch, i: number, dt: number): void {
    if (b.parked[i]) {
      // settle: the spring relaxes to rest and the motion state is zeroed
      b.heave[i] *= 0.8; b.heaveV[i] = 0; b.pitch[i] *= 0.8; b.pitchV[i] = 0; b.roll[i] *= 0.8; b.rollV[i] = 0; return;
    }
    const k = 120, c = 15; // ~1.7 Hz, damping ratio ~0.7
    const kick = clamp(b.vy[i], -3, 3);
    b.vy[i] *= 0.5;
    b.heaveV[i] += (-k * b.heave[i] - c * b.heaveV[i] - kick * 10) * dt;
    b.heave[i] = clamp(b.heave[i] + b.heaveV[i] * dt, -0.06, 0.06);
    b.pitchV[i] += (-k * 1.4 * b.pitch[i] - c * b.pitchV[i] - kick * 0.9) * dt;
    b.pitch[i] = clamp(b.pitch[i] + b.pitchV[i] * dt, -0.02, 0.02);
    b.rollV[i] += (-k * 1.4 * b.roll[i] - c * b.rollV[i]) * dt;
    b.roll[i] = clamp(b.roll[i] + b.rollV[i] * dt, -0.02, 0.02);
  }

  private pack(b: KindBatch, source: number, lod: LodBatch, target: number, length: number): void {
    this.matrix.fromArray(b.matrices, source * 16); lod.mesh.setMatrixAt(target, this.matrix);
    const staticChanged = lod.sourceByRender[target] !== source || lod.revisionByRender[target] !== b.revision[source];
    const a = lod.attrs;
    if (staticChanged) {
      lod.sourceByRender[target] = source; lod.revisionByRender[target] = b.revision[source];
      const pa = a.paint.array as Float32Array, la = a.look.array as Float32Array;
      pa[target * 3] = b.paint[source * 3]; pa[target * 3 + 1] = b.paint[source * 3 + 1]; pa[target * 3 + 2] = b.paint[source * 3 + 2];
      la[target * 4] = b.look[source * 4]; la[target * 4 + 1] = b.look[source * 4 + 1]; la[target * 4 + 2] = b.look[source * 4 + 2]; la[target * 4 + 3] = b.look[source * 4 + 3];
      lod.staticStart = Math.min(lod.staticStart, target); lod.staticEnd = Math.max(lod.staticEnd, target + 1);
    }
    const ma = a.misc.array as Float32Array;
    ma[target * 4] = b.seed[source]; ma[target * 4 + 1] = b.damaged[source]; ma[target * 4 + 2] = this.lampCode(b, source); ma[target * 4 + 3] = length;
    const wa = a.wheel.array as Float32Array, ba = a.body.array as Float32Array;
    wa[target * 2] = b.spin[source]; wa[target * 2 + 1] = b.steer[source];
    ba[target * 3] = b.heave[source]; ba[target * 3 + 1] = b.pitch[source]; ba[target * 3 + 2] = b.roll[source];
  }

  private readonly v3 = new THREE.Vector3();
  /**
   * The light and the air a car gives off: lamp halos, headlight pool, siren tint (all in the effects mesh, no draw call per car), and
   * exhaust, dust and spray puffs. Only for cars in the close and near levels of detail.
   */
  private emit(b: KindBatch, i: number, variant: VariantBatch, dist: number): void {
    const fx = this.fx, lamps = variant.lamps, night = nightUniform.value, t = timeUniform.value, dt = this.dt;
    const M = this.matrix.fromArray(b.matrices, i * 16), e = M.elements;
    const parked = b.parked[i] === 1;
    const mode = parked ? 1 : b.headlights[i];
    const autoHead = THREE.MathUtils.smoothstep(night, 0.25, 0.6);
    const headOn = mode === 2 ? 1 : mode === 1 ? 0 : autoHead;
    const brake = b.braking[i] && !parked ? 1 : 0;
    if (b.reverseTimer[i] > 0) b.reverseTimer[i] -= dt;
    const sizeK = Math.min(3.4, 1 + dist * 0.012);
    const w = (p: readonly number[]) => this.v3.set(p[0], p[1], p[2]).applyMatrix4(M);
    const seed = b.seed[i];
    const world = (p: readonly number[], size: number, r: number, g: number, bl: number, a: number) => { const v = w(p); fx.halo(v.x, v.y, v.z, size * sizeK, r, g, bl, a); };
    if (headOn > 0.02 && night > 0.02) {
      for (const p of lamps.head) world(p, 0.55, 1.0, 0.9, 0.7, 0.95 * headOn * Math.max(night, 0.35));
      if (dist < 130) {
        // the road ahead: a pool from the nose along the car's heading, following the slope it stands on
        const nose = w([0, 0.06, lamps.nose[0] - 0.05]);
        const yaw = Math.atan2(e[8], e[10]), pitch = -Math.asin(THREE.MathUtils.clamp(e[9], -0.5, 0.5));
        fx.pool(nose.x, nose.y, nose.z, yaw, pitch, 17, lamps.nose[1] * 5, 1.0, 0.87, 0.6, 0.42 * headOn * night);
      }
    }
    const tailA = brake * (0.4 + 0.6 * night) + headOn * 0.28 * night;
    if (tailA > 0.02) {
      for (const p of lamps.tail) world(p, brake ? 0.72 : 0.42, 1.0, 0.08, 0.05, tailA * (brake ? 1.3 : 1));
      if (brake && night > 0.3 && dist < 90) { const v = w([0, 0.05, lamps.tailZ - 0.7]); fx.disc(v.x, v.y, v.z, 1.5, 1.0, 0.1, 0.06, 0.26 * night); }
    }
    if ((b.reversing[i] || b.reverseTimer[i] > 0) && !parked) for (const p of lamps.reverse) world(p, 0.42, 1.0, 0.98, 0.9, 0.8 * (0.5 + 0.5 * night));
    const turn = b.turn[i];
    if (turn !== 0 && !parked && Math.sin(t * 9.4 + seed * 6) >= 0) {
      for (const p of turn > 0 ? lamps.turnLeft : lamps.turnRight) world(p, 0.36, 1.0, 0.55, 0.06, 1.0 * (0.4 + 0.6 * night));
    }
    // emergency lights: red and blue flashes with a tint on the ground round the vehicle
    const kindSiren = b.kind === 'police' || b.kind === 'ambulance' || b.kind === 'firetruck';
    const sirenOn = b.siren[i] === 2 || (b.siren[i] !== 1 && kindSiren && !parked);
    if (sirenOn && lamps.siren.length) {
      let redOn = false, blueOn = false;
      for (const p of lamps.siren) {
        const blue = lamps.sirenBlue.includes(p as never);
        const flash = Math.sin(t * 19 + seed * 13 + (blue ? 3.14159 : 0)) > 0.15;
        if (!flash) continue;
        if (blue) blueOn = true; else redOn = true;
        world(p, 1.05, blue ? 0.08 : 1.0, blue ? 0.35 : 0.05, blue ? 1.0 : 0.08, 1.2);
      }
      if ((redOn || blueOn) && dist < 120) {
        const c = w([0, 0.06, 0]);
        fx.disc(c.x, c.y, c.z, 7.5, redOn ? 1.0 : 0.1, redOn ? 0.06 : 0.3, redOn ? 0.08 : 1.0, (0.1 + 0.6 * night) * (redOn && blueOn ? 1 : 0.85));
      }
    }
    if (lamps.beacon.length && !lamps.siren.length && !parked && b.speed[i] > 0.5) {
      // an amber work beacon (tow truck, garbage truck) turning slowly
      if (Math.sin(t * 8 + seed * 5) > 0.1) for (const p of lamps.beacon) world(p, 0.9, 1.0, 0.55, 0.05, 1.0);
    }
    if (dist > 75 || parked) return;
    // ---- puffs
    const env = fx.env, speed = b.speed[i];
    const heavy = b.kind === 'semi' || b.kind === 'cityBus' || b.kind === 'garbageTruck' || b.kind === 'firetruck' || b.kind === 'boxTruck' || b.kind === 'towTruck' || b.kind === 'ambulance';
    const electric = b.kind === 'cyberslop' || b.kind === 'golfCart';
    const cold = THREE.MathUtils.clamp((13 - env.temperature) / 13, 0, 1);
    b.fxTimer[i] += dt;
    const fwdX = e[8], fwdZ = e[10];
    if (!electric) {
      const ex = lamps.exhaust.length ? lamps.exhaust : [[(lamps.tail[0]?.[0] ?? 0.5) * 0.6, 0.28, lamps.tailZ + 0.05] as V3];
      const launching = b.accel[i] > (heavy ? 0.9 : 1.6) && speed < 14;
      const idle = speed < 0.6;
      const want = launching ? 0.11 : idle && cold > 0.25 ? 0.5 / (0.4 + cold) : cold > 0.4 && speed > 1 ? 0.35 : 0;
      if (want > 0 && b.fxTimer[i] > want && (cold > 0.15 || (heavy && launching))) {
        b.fxTimer[i] = 0;
        const p = w(ex[(Math.floor(seed * 7) + Math.floor(t * 3)) % ex.length]);
        fx.exhaust(p.x, p.y, p.z, -fwdX * Math.max(speed * 0.3, 0.6), -fwdZ * Math.max(speed * 0.3, 0.6), heavy && launching, cold);
      }
    }
    if (speed > 3.2) {
      b.surfaceTimer[i] -= dt;
      if (b.surfaceTimer[i] <= 0) { b.surfaceTimer[i] = 0.5 + seed * 0.3; b.onGravel[i] = this.surfaceAt && this.surfaceAt(e[12], e[14]) === 'gravel' ? 1 : 0; }
      const dusty = b.onGravel[i] === 1, wet = env.wet > 0.35 && env.rain > 0.12 && speed > 6.5;
      b.fxTimer2[i] += dt;
      if ((dusty || wet) && b.fxTimer2[i] > (dusty ? 0.06 : 0.05)) {
        b.fxTimer2[i] = 0;
        const half = Math.abs(lamps.tail[0]?.[0] ?? 0.8) * 0.9, zr = lamps.tailZ + Math.min(1.4, VEHICLE_SPECS[b.kind].length * 0.2);
        for (const sgn of [-1, 1]) {
          const p = w([sgn * half, 0.12, zr]);
          if (dusty) fx.dust(p.x, p.y, p.z, -fwdX * speed * 0.2, -fwdZ * speed * 0.2, speed);
          else fx.spray(p.x, p.y, p.z, -fwdX * speed * 0.12, -fwdZ * speed * 0.12, speed);
        }
      }
    }
  }

  /** Packs the frame. `dt` (optional, seconds) overrides the measured frame time: tests step the suspension with it. */
  flush(dt?: number): void {
    const now = performance.now() * 0.001;
    this.dt = dt ?? clamp(now - this.lastFlush, 0.001, 0.1); this.lastFlush = now;
    timeUniform.value = now;
    if (this.closeQueue.length) this.buildClose(this.closeQueue.shift()!);
    else if (this.pending.length) this.warm();
    this.fx.begin();
    const close2 = this.lodClose * this.lodClose, near2 = this.lodNear * this.lodNear, far2 = this.lodCull * this.lodCull;
    // Keep one far vehicle as a camera-capture sentinel when every real instance
    // is beyond the cull radius. At >1.5 km it is sub-pixel, but onBeforeRender
    // still sees the new camera so the fleet can re-enter on the following frame.
    let sentinelClaimed = false;
    for (const batch of this.batches.values()) {
      const kindVariants = variantsOf(batch.kind);
      const length = VEHICLE_SPECS[batch.kind].length;
      let farCount = 0;
      for (const vb of batch.variants.values()) { if (vb.close) vb.close.count = 0; vb.near.count = 0; }
      for (let i = 0; i < batch.used; i++) {
        if (!batch.active[i] || !batch.initialized[i]) continue;
        // 0 close, 1 near, 2 far, 3 beyond the cull radius (drawn only as the camera-capture sentinel)
        let nextLod = 1;
        if (this.lodOverride >= 0) nextLod = Math.min(2, this.lodOverride);
        else if (this.cameraValid) {
          const o = i * 16, dx = batch.matrices[o + 12] - this.cameraX, dy = batch.matrices[o + 13] - this.cameraY, dz = batch.matrices[o + 14] - this.cameraZ;
          const d2 = dx * dx + dy * dy + dz * dz, prev = batch.lod[i];
          if (d2 > far2) nextLod = 3;
          else if (d2 > near2 * (prev >= 2 ? 0.84 : 1)) nextLod = 2;
          else nextLod = d2 > close2 * (prev === 0 ? 1 : 0.8) ? 1 : 0;
        }
        batch.lod[i] = nextLod;
        // lod 3 (beyond the cull radius) is a far instance only for the sentinel; the rest are not drawn
        const variant = batch.variants.get(kindVariants[batch.variantOf[i]]?.id) ?? batch.variants.get(kindVariants[0].id)!;
        if (nextLod <= 1) {
          this.suspension(batch, i, this.dt);
          if (this.cameraValid) { const o = i * 16; this.emit(batch, i, variant, Math.hypot(batch.matrices[o + 12] - this.cameraX, batch.matrices[o + 13] - this.cameraY, batch.matrices[o + 14] - this.cameraZ)); }
          else this.emit(batch, i, variant, 30);
        }
        if (nextLod === 0 && !variant.close && !this.closeQueue.includes(variant)) this.closeQueue.push(variant);
        if (nextLod === 0 && variant.close && variant.close.count < variant.close.sourceByRender.length) this.pack(batch, i, variant.close, variant.close.count++, length);
        else if (nextLod <= 1) this.pack(batch, i, variant.near, variant.near.count++, length);
        else if (nextLod === 2 || !sentinelClaimed) {
          this.pack(batch, i, batch.far, farCount++, length);
          if (nextLod === 3) sentinelClaimed = true;
        }
      }
      for (const vb of batch.variants.values()) { if (vb.close) markLod(vb.close, vb.close.count); markLod(vb.near, vb.near.count); }
      markLod(batch.far, farCount);
      markAttributeRange(batch.pickMesh.instanceMatrix, 0, batch.used, 16);
    }
    this.fx.end(this.dt);
  }

  pick(ray: THREE.Raycaster): number | null {
    let nearestHandle: number | null = null, nearestDistance = Infinity;
    for (const batch of this.batches.values()) {
      const hit = ray.intersectObject(batch.pickMesh, false)[0];
      if (!hit || hit.instanceId === undefined || hit.distance >= nearestDistance) continue;
      const handle = batch.handleByInstance[hit.instanceId];
      if (handle >= 0) { nearestHandle = handle; nearestDistance = hit.distance; }
    }
    return nearestHandle;
  }

  /** Lamp positions of a car's model (body space), for the effects pass and tests. */
  lampsOf(handle: number): LampSet | undefined {
    const slot = this.slots[handle]; if (!slot) return undefined;
    const b = this.batches.get(slot.kind)!;
    const id = variantsOf(slot.kind)[b.variantOf[slot.instance]]?.id;
    return (id ? b.variants.get(id) : undefined)?.lamps;
  }

  /** Which model draws a car (dev pages, tests). */
  modelOf(handle: number): string | undefined {
    const slot = this.slots[handle]; if (!slot) return undefined;
    return variantsOf(slot.kind)[this.batches.get(slot.kind)!.variantOf[slot.instance]]?.id;
  }

  stats(): VehicleRenderStats {
    const kinds: Record<string, { nearTriangles: number; farTriangles: number }> = {};
    const models: Record<string, { closeTriangles: number; nearTriangles: number; farTriangles: number }> = {};
    let built = 0;
    for (const [kind, batch] of this.batches) {
      const base = batch.variants.values().next().value as VariantBatch | undefined;
      kinds[kind] = { nearTriangles: base?.nearTriangles ?? 0, farTriangles: batch.farTriangles };
      for (const vb of batch.variants.values()) { models[vb.id] = { closeTriangles: vb.closeTriangles, nearTriangles: vb.nearTriangles, farTriangles: batch.farTriangles }; built++; }
    }
    return { active: this.activeTotal, drawCallsPerNearKind: 1, drawCallsPerFarKind: 1, kinds, models, modelsBuilt: built, modelsTotal: vehicleModelList().length };
  }

  dispose(): void {
    this.object.removeFromParent();
    this.fx.mesh.geometry.dispose();
    for (const batch of this.batches.values()) {
      batch.far.mesh.geometry.dispose(); batch.pickMesh.geometry.dispose();
      for (const vb of batch.variants.values()) { vb.close?.mesh.geometry.dispose(); vb.near.mesh.geometry.dispose(); }
    }
  }
}
