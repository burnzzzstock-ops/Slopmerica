import * as THREE from 'three';
import type { VehicleKind } from '../contracts';
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from '../world/atmos';
import { buildVehicleModel, vehicleDecalAtlas, type VehicleLodGeometry } from './models/vehicleModels';

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

const nightUniform = { value: 0 };
const timeUniform = { value: 0 };

function physicalMaterial(shell: boolean): THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial {
  const material = shell
    ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.22, clearcoat: 0.72, clearcoatRoughness: 0.17 })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.58, metalness: 0.12 });
  material.onBeforeCompile = (shader) => {
    bindAtmos(shader);
    if (!shell) shader.uniforms.tVehicleAtlas = { value: vehicleDecalAtlas() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float iDirt, iDamage;
${shell ? '' : 'attribute float iWheelSpin, iSteer; attribute float zone, wheel; attribute vec3 wheelCenter; varying float vVehZone; varying vec2 vVehUv;'}
varying float vVehDirt, vVehDamage, vVehLocalY;
varying vec3 vVehWorld, vVehWorldNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${shell ? '' : `vVehZone = zone;
vVehUv = uv;
if (wheel > 0.5) {
  transformed -= wheelCenter;
  float ws = sin(iWheelSpin), wc = cos(iWheelSpin);
  transformed.yz = mat2(wc, -ws, ws, wc) * transformed.yz;
  if (wheel < 1.5) {
    float ss = sin(iSteer), sc = cos(iSteer);
    transformed.xz = mat2(sc, ss, -ss, sc) * transformed.xz;
  }
  transformed += wheelCenter;
}`}
vVehDirt = iDirt;
vVehDamage = iDamage;
vVehLocalY = transformed.y;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 vwp = vec4(transformed, 1.0);
  vec3 vwn = normal;
#ifdef USE_INSTANCING
  vwp = instanceMatrix * vwp;
  vwn = mat3(instanceMatrix) * vwn;
#endif
  vVehWorld = (modelMatrix * vwp).xyz;
  vVehWorldNormal = normalize(mat3(modelMatrix) * vwn);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSnow, uSnowLine, uWet;
${shell ? '' : 'uniform sampler2D tVehicleAtlas; varying float vVehZone; varying vec2 vVehUv;'}
varying float vVehDirt, vVehDamage, vVehLocalY;
varying vec3 vVehWorld, vVehWorldNormal;
${CLOUD_GLSL}
float vehicleHash(vec3 p) { vec3 p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
${shell ? '' : `  if (vVehZone > 3.5) {
    vec4 decal = texture2D(tVehicleAtlas, vVehUv);
    if (decal.a < 0.08) discard;
    diffuseColor.rgb = decal.rgb;
  }
  if (vVehZone > 0.5 && vVehZone < 1.5) diffuseColor.rgb *= vec3(0.66, 0.78, 0.85);`}
  float lowerGrime = 1.0 - smoothstep(0.28, 1.2, vVehLocalY);
  float grime = vVehDirt * lowerGrime * (0.12 + vehicleHash(vVehWorld * 2.7) * 0.11);
  diffuseColor.rgb *= 1.0 - grime;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.34, 0.25, 0.20), vVehDamage * (0.18 + vehicleHash(vVehWorld * 5.0) * 0.18));
  float top = smoothstep(0.62, 0.9, normalize(vVehWorldNormal).y);
  float snow = uSnow * top * smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vVehWorld.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.92), snow * 0.82);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, ${shell ? '0.12' : '0.28'}, uWet * 0.78);
${shell ? '' : 'roughnessFactor = mix(roughnessFactor, 0.08, step(0.5, vVehZone) * (1.0 - step(1.5, vVehZone)));'}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
${shell ? '' : 'metalnessFactor = mix(metalnessFactor, 0.72, step(1.5, vVehZone) * (1.0 - step(2.5, vVehZone)));'}`)
      .replace('#include <lights_fragment_end>', cloudShadowChunk('vVehWorld'));
  };
  material.customProgramCacheKey = () => shell ? 'aa-vehicle-shell-v3' : 'aa-vehicle-detail-v3';
  return material;
}

function lightMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVehicleNight = nightUniform;
    shader.uniforms.uVehicleTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float signal, fade, iBrake, iSeed;
varying float vSignal, vFade, vBrake, vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSignal = signal; vFade = fade; vBrake = iBrake; vSeed = iSeed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uVehicleNight, uVehicleTime;
varying float vSignal, vFade, vBrake, vSeed;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float power = 1.0;
  if (vSignal < 1.5) power = 0.22 + uVehicleNight * 3.7;
  else if (vSignal < 2.5) power = 0.28 + uVehicleNight * 0.55 + vBrake * 4.2;
  else if (vSignal < 4.5) {
    float side = step(3.5, vSignal);
    float flash = step(0.15, sin(uVehicleTime * 19.0 + vSeed * 13.0 + side * 3.14159));
    power = 0.12 + flash * 4.6;
  } else {
    power = uVehicleNight * 0.34;
    diffuseColor.a *= vFade * uVehicleNight * 0.58;
  }
  diffuseColor.rgb *= power;
}`);
  };
  material.customProgramCacheKey = () => 'aa-vehicle-lights-v3';
  return material;
}

const SHELL_MATERIAL = physicalMaterial(true);
const DETAIL_MATERIAL = physicalMaterial(false);
const LIGHT_MATERIAL = lightMaterial();
const PICK_MATERIAL = new THREE.MeshBasicMaterial();

interface InstanceAttrs {
  dirt: THREE.InstancedBufferAttribute;
  damage: THREE.InstancedBufferAttribute;
  spin?: THREE.InstancedBufferAttribute;
  steer?: THREE.InstancedBufferAttribute;
  brake?: THREE.InstancedBufferAttribute;
  seed?: THREE.InstancedBufferAttribute;
}
interface LodBatch {
  shell: THREE.InstancedMesh; detail: THREE.InstancedMesh; lights?: THREE.InstancedMesh;
  meshes: THREE.InstancedMesh[]; shellAttrs: InstanceAttrs; detailAttrs: InstanceAttrs; lightAttrs?: InstanceAttrs;
  sourceByRender: Int32Array; revisionByRender: Uint32Array; lastBrake: Uint8Array;
  staticDirtyStart: number; staticDirtyEnd: number; brakeDirtyStart: number; brakeDirtyEnd: number;
}
interface KindBatch {
  near: LodBatch; far: LodBatch; pickMesh: THREE.InstancedMesh; free: number[]; used: number;
  active: Uint8Array; initialized: Uint8Array; handleByInstance: Int32Array;
  matrices: Float32Array; colors: Float32Array; previousX: Float32Array; previousZ: Float32Array; previousYaw: Float32Array;
  spin: Float32Array; steer: Float32Array; braking: Uint8Array; damaged: Uint8Array; dirt: Float32Array; lod: Int8Array;
  revision: Uint32Array;
  wheelRadius: number; nearTriangles: number; farTriangles: number;
}
interface Slot { kind: VehicleKind; instance: number }

function instancedAttribute(capacity: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
}
function attachAttrs(geometry: THREE.BufferGeometry, capacity: number, detail = false, light = false): InstanceAttrs {
  const attrs: InstanceAttrs = { dirt: instancedAttribute(capacity), damage: instancedAttribute(capacity) };
  geometry.setAttribute('iDirt', attrs.dirt); geometry.setAttribute('iDamage', attrs.damage);
  if (detail) {
    attrs.spin = instancedAttribute(capacity); attrs.steer = instancedAttribute(capacity);
    geometry.setAttribute('iWheelSpin', attrs.spin); geometry.setAttribute('iSteer', attrs.steer);
  }
  if (light) {
    attrs.brake = instancedAttribute(capacity); attrs.seed = instancedAttribute(capacity);
    geometry.setAttribute('iBrake', attrs.brake); geometry.setAttribute('iSeed', attrs.seed);
  }
  return attrs;
}
function makeLod(kind: VehicleKind, label: 'near' | 'far', geometry: VehicleLodGeometry, capacity: number): LodBatch {
  const shellAttrs = attachAttrs(geometry.shell, capacity);
  const detailAttrs = attachAttrs(geometry.detail, capacity, label === 'near');
  const shell = new THREE.InstancedMesh(geometry.shell, SHELL_MATERIAL, capacity);
  const detail = new THREE.InstancedMesh(geometry.detail, DETAIL_MATERIAL, capacity);
  const meshes: THREE.InstancedMesh[] = [shell, detail];
  let lights: THREE.InstancedMesh | undefined;
  let lightAttrs: InstanceAttrs | undefined;
  if (geometry.lights && geometry.lights.getAttribute('position').count > 0) {
    lightAttrs = attachAttrs(geometry.lights, capacity, false, true);
    lights = new THREE.InstancedMesh(geometry.lights, LIGHT_MATERIAL, capacity); meshes.push(lights);
  }
  for (const mesh of meshes) {
    mesh.name = `vehicle-${kind}-${label}-${mesh === shell ? 'paint' : mesh === detail ? 'detail' : 'lights'}`;
    mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    mesh.castShadow = mesh !== lights && label === 'near'; mesh.receiveShadow = mesh !== lights;
  }
  return {
    shell, detail, lights, meshes, shellAttrs, detailAttrs, lightAttrs,
    sourceByRender: new Int32Array(capacity).fill(-1), revisionByRender: new Uint32Array(capacity), lastBrake: new Uint8Array(capacity),
    staticDirtyStart: capacity, staticDirtyEnd: 0, brakeDirtyStart: capacity, brakeDirtyEnd: 0,
  };
}
type UploadRange = { start: number; count: number };
const UPLOAD_RANGES = new WeakMap<THREE.BufferAttribute, UploadRange>();

/** Reuses Three's update-range object instead of allocating in the frame loop. */
function markAttributeRange(attribute: THREE.BufferAttribute | THREE.InstancedBufferAttribute | undefined, start: number, end: number, itemSize = 1): void {
  if (!attribute || end <= start) return;
  let range = UPLOAD_RANGES.get(attribute);
  if (!range) {
    range = { start: 0, count: 0 };
    UPLOAD_RANGES.set(attribute, range);
  }
  range.start = start * itemSize;
  range.count = (end - start) * itemSize;
  attribute.updateRanges.length = 0;
  attribute.updateRanges.push(range);
  attribute.needsUpdate = true;
}
function markAttribute(attribute: THREE.BufferAttribute | THREE.InstancedBufferAttribute | undefined, count: number): void {
  markAttributeRange(attribute, 0, count);
}
function markLod(lod: LodBatch, count: number): void {
  for (const mesh of lod.meshes) { mesh.count = count; markAttribute(mesh.instanceMatrix, count * 16); }
  markAttributeRange(lod.shell.instanceColor ?? undefined, lod.staticDirtyStart, lod.staticDirtyEnd, 3);
  markAttributeRange(lod.shellAttrs.dirt, lod.staticDirtyStart, lod.staticDirtyEnd); markAttributeRange(lod.shellAttrs.damage, lod.staticDirtyStart, lod.staticDirtyEnd);
  markAttributeRange(lod.detailAttrs.dirt, lod.staticDirtyStart, lod.staticDirtyEnd); markAttributeRange(lod.detailAttrs.damage, lod.staticDirtyStart, lod.staticDirtyEnd);
  markAttribute(lod.detailAttrs.spin, count); markAttribute(lod.detailAttrs.steer, count);
  markAttributeRange(lod.lightAttrs?.seed, lod.staticDirtyStart, lod.staticDirtyEnd);
  markAttributeRange(lod.lightAttrs?.brake, lod.brakeDirtyStart, lod.brakeDirtyEnd);
  lod.staticDirtyStart = lod.sourceByRender.length; lod.staticDirtyEnd = 0;
  lod.brakeDirtyStart = lod.sourceByRender.length; lod.brakeDirtyEnd = 0;
}

export interface VehicleRenderStats {
  active: number; drawCallsPerNearKind: 3; drawCallsPerFarKind: 2;
  kinds: Record<string, { nearTriangles: number; farTriangles: number }>;
}

export class VehicleRenderer {
  readonly object = new THREE.Group();
  private readonly batches = new Map<VehicleKind, KindBatch>();
  private readonly slots: Array<Slot | undefined> = [];
  private readonly freeHandles: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly color = new THREE.Color();
  private readonly maxTotal: number;
  private readonly perKind: number;
  private activeTotal = 0;
  private cameraValid = false; private cameraX = 0; private cameraY = 0; private cameraZ = 0;
  private lodNear = 180; private lodCull = 1500;

  constructor(scene: THREE.Scene, maxTotal: number) {
    this.maxTotal = Math.max(0, Math.floor(maxTotal));
    this.perKind = Math.max(16, Math.ceil(this.maxTotal / 3));
    this.object.name = 'aa-vehicles';
    for (const kind of KINDS) {
      const model = buildVehicleModel(kind, VEHICLE_SPECS[kind]);
      const near = makeLod(kind, 'near', model.near, this.perKind);
      const far = makeLod(kind, 'far', model.far, this.perKind);
      for (const mesh of near.meshes) this.object.add(mesh);
      for (const mesh of far.meshes) this.object.add(mesh);
      const spec = VEHICLE_SPECS[kind];
      const pickGeometry = new THREE.BoxGeometry(spec.width, spec.height, spec.length);
      pickGeometry.translate(0, spec.height * 0.5, 0);
      const pickMesh = new THREE.InstancedMesh(pickGeometry, PICK_MATERIAL, this.perKind);
      pickMesh.name = `vehicle-${kind}-pick`; pickMesh.visible = false; pickMesh.count = 0;
      pickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.object.add(pickMesh);
      this.batches.set(kind, {
        near, far, pickMesh, free: [], used: 0, active: new Uint8Array(this.perKind), initialized: new Uint8Array(this.perKind),
        handleByInstance: new Int32Array(this.perKind).fill(-1), matrices: new Float32Array(this.perKind * 16), colors: new Float32Array(this.perKind * 3),
        previousX: new Float32Array(this.perKind), previousZ: new Float32Array(this.perKind), previousYaw: new Float32Array(this.perKind),
        spin: new Float32Array(this.perKind), steer: new Float32Array(this.perKind), braking: new Uint8Array(this.perKind), damaged: new Uint8Array(this.perKind),
        dirt: new Float32Array(this.perKind), lod: new Int8Array(this.perKind), revision: new Uint32Array(this.perKind), wheelRadius: model.wheelRadius,
        nearTriangles: model.nearTriangles, farTriangles: model.farTriangles,
      });
      const captureCamera = (_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, camera: THREE.Camera) => {
        this.cameraX = camera.matrixWorld.elements[12]; this.cameraY = camera.matrixWorld.elements[13]; this.cameraZ = camera.matrixWorld.elements[14];
        this.cameraValid = true;
      };
      for (const mesh of [...near.meshes, ...far.meshes]) mesh.onBeforeRender = captureCamera;
    }
    if (this.maxTotal <= 600) { this.lodNear = 112; this.lodCull = 930; }
    scene.add(this.object);
  }

  add(kind: VehicleKind, color: number): number {
    if (this.activeTotal >= this.maxTotal) return -1;
    const batch = this.batches.get(kind)!;
    const instance = batch.free.length ? batch.free.pop()! : batch.used < this.perKind ? batch.used++ : -1;
    if (instance < 0) return -1;
    const handle = this.freeHandles.length ? this.freeHandles.pop()! : this.slots.length;
    this.slots[handle] = { kind, instance }; batch.active[instance] = 1; batch.initialized[instance] = 0;
    batch.handleByInstance[instance] = handle; batch.braking[instance] = 0; batch.damaged[instance] = 0;
    batch.spin[instance] = 0; batch.steer[instance] = 0;
    batch.revision[instance]++;
    batch.dirt[instance] = 0.1 + (((handle * 1103515245 + 12345) >>> 8) & 255) / 255 * 0.72;
    this.color.setHex(color);
    batch.colors[instance * 3] = this.color.r; batch.colors[instance * 3 + 1] = this.color.g; batch.colors[instance * 3 + 2] = this.color.b;
    batch.pickMesh.count = batch.used; this.activeTotal++; return handle;
  }

  remove(handle: number): void {
    const slot = this.slots[handle]; if (!slot) return;
    const batch = this.batches.get(slot.kind)!;
    batch.active[slot.instance] = 0; batch.initialized[slot.instance] = 0; batch.handleByInstance[slot.instance] = -1; batch.free.push(slot.instance);
    this.matrix.makeScale(0, 0, 0); batch.pickMesh.setMatrixAt(slot.instance, this.matrix);
    markAttribute(batch.pickMesh.instanceMatrix, (slot.instance + 1) * 16);
    this.slots[handle] = undefined; this.freeHandles.push(handle); this.activeTotal--;
  }

  set(handle: number, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0): void {
    const slot = this.slots[handle]; if (!slot) return;
    const batch = this.batches.get(slot.kind)!; const i = slot.instance;
    if (batch.initialized[i]) {
      const dx = x - batch.previousX[i], dz = z - batch.previousZ[i], distance = Math.hypot(dx, dz);
      if (distance < 30) batch.spin[i] = (batch.spin[i] + distance / Math.max(0.18, batch.wheelRadius)) % (Math.PI * 2);
      let dyaw = yaw - batch.previousYaw[i]; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const target = distance > 0.015 ? THREE.MathUtils.clamp(dyaw * 4.5, -0.48, 0.48) : 0;
      batch.steer[i] += (target - batch.steer[i]) * 0.42;
    } else batch.initialized[i] = 1;
    batch.previousX[i] = x; batch.previousZ[i] = z; batch.previousYaw[i] = yaw;
    this.euler.set(pitch, yaw, roll, 'YXZ'); this.quaternion.setFromEuler(this.euler);
    this.matrix.makeRotationFromQuaternion(this.quaternion).setPosition(x, y, z);
    this.matrix.toArray(batch.matrices, i * 16); batch.pickMesh.setMatrixAt(i, this.matrix);
  }

  setBraking(handle: number, on: boolean): void {
    const slot = this.slots[handle]; if (slot) this.batches.get(slot.kind)!.braking[slot.instance] = on ? 1 : 0;
  }
  setDamaged(handle: number, on: boolean): void {
    const slot = this.slots[handle];
    if (slot) {
      const batch = this.batches.get(slot.kind)!;
      const value = on ? 1 : 0;
      if (batch.damaged[slot.instance] !== value) { batch.damaged[slot.instance] = value; batch.revision[slot.instance]++; }
    }
  }
  setNight(night: number): void { nightUniform.value = THREE.MathUtils.clamp(night, 0, 1); }

  /** Stores camera state; flush() performs the allocation-free near/far instance pack. */
  updateLod(camera: THREE.Camera, quality: 'high' | 'low' | number = 'high'): void {
    this.cameraX = camera.matrixWorld.elements[12]; this.cameraY = camera.matrixWorld.elements[13]; this.cameraZ = camera.matrixWorld.elements[14];
    const scale = typeof quality === 'number' ? Math.max(0.45, quality) : quality === 'low' ? 0.62 : 1;
    this.lodNear = 180 * scale; this.lodCull = 1500 * scale; this.cameraValid = true;
  }

  private pack(batch: KindBatch, source: number, lod: LodBatch, target: number): void {
    this.matrix.fromArray(batch.matrices, source * 16); for (const mesh of lod.meshes) mesh.setMatrixAt(target, this.matrix);
    const staticChanged = lod.sourceByRender[target] !== source || lod.revisionByRender[target] !== batch.revision[source];
    if (staticChanged) {
      lod.sourceByRender[target] = source; lod.revisionByRender[target] = batch.revision[source];
      this.color.setRGB(batch.colors[source * 3], batch.colors[source * 3 + 1], batch.colors[source * 3 + 2], THREE.LinearSRGBColorSpace);
      lod.shell.setColorAt(target, this.color);
      const dirt = batch.dirt[source], damage = batch.damaged[source];
      lod.shellAttrs.dirt.setX(target, dirt); lod.shellAttrs.damage.setX(target, damage);
      lod.detailAttrs.dirt.setX(target, dirt); lod.detailAttrs.damage.setX(target, damage);
      lod.lightAttrs?.seed?.setX(target, (source * 0.61803398875) % 1);
      lod.staticDirtyStart = Math.min(lod.staticDirtyStart, target); lod.staticDirtyEnd = Math.max(lod.staticDirtyEnd, target + 1);
    }
    lod.detailAttrs.spin?.setX(target, batch.spin[source]); lod.detailAttrs.steer?.setX(target, batch.steer[source]);
    const brake = batch.braking[source];
    if (staticChanged || lod.lastBrake[target] !== brake) {
      lod.lastBrake[target] = brake; lod.lightAttrs?.brake?.setX(target, brake);
      lod.brakeDirtyStart = Math.min(lod.brakeDirtyStart, target); lod.brakeDirtyEnd = Math.max(lod.brakeDirtyEnd, target + 1);
    }
  }

  flush(): void {
    timeUniform.value = performance.now() * 0.001;
    const near2 = this.lodNear * this.lodNear, far2 = this.lodCull * this.lodCull;
    // Keep one far vehicle as a camera-capture sentinel when every real instance
    // is beyond the cull radius. At >1.5 km it is sub-pixel, but onBeforeRender
    // still sees the new camera so the fleet can re-enter on the following frame.
    let sentinelClaimed = false;
    for (const batch of this.batches.values()) {
      let nearCount = 0, farCount = 0;
      for (let i = 0; i < batch.used; i++) {
        if (!batch.active[i] || !batch.initialized[i]) continue;
        let nextLod = 0;
        if (this.cameraValid) {
          const o = i * 16, dx = batch.matrices[o + 12] - this.cameraX, dy = batch.matrices[o + 13] - this.cameraY, dz = batch.matrices[o + 14] - this.cameraZ;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > far2) nextLod = 2;
          else nextLod = d2 > near2 * (batch.lod[i] === 1 ? 0.84 : 1) ? 1 : 0;
        }
        batch.lod[i] = nextLod;
        if (nextLod === 0) this.pack(batch, i, batch.near, nearCount++);
        else if (nextLod === 1 || !sentinelClaimed) {
          this.pack(batch, i, batch.far, farCount++);
          if (nextLod === 2) sentinelClaimed = true;
        }
      }
      markLod(batch.near, nearCount); markLod(batch.far, farCount); markAttribute(batch.pickMesh.instanceMatrix, batch.used * 16);
    }
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

  stats(): VehicleRenderStats {
    const kinds: Record<string, { nearTriangles: number; farTriangles: number }> = {};
    for (const [kind, batch] of this.batches) kinds[kind] = { nearTriangles: batch.nearTriangles, farTriangles: batch.farTriangles };
    return { active: this.activeTotal, drawCallsPerNearKind: 3, drawCallsPerFarKind: 2, kinds };
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const batch of this.batches.values()) for (const mesh of [...batch.near.meshes, ...batch.far.meshes, batch.pickMesh]) mesh.geometry.dispose();
  }
}
