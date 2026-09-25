// Camera-local ambient wildlife and boats. All actors live in a fixed pool and
// are compacted into instanced draw buffers each frame; the hot path allocates no
// objects and uploads only the matrix/color ranges that were written.
import * as THREE from 'three';
import type { Quality } from '../config';
import { WATER } from '../config';
import type { WeatherKind } from '../contracts';
import type { MapData, MapId } from '../world/maps';
import type { Terrain } from '../world/terrain';
import { bindAtmos, CLOUD_GLSL, cloudShadowChunk } from '../world/atmos';
import {
  AMBIENT_SPECIES,
  createAmbientFarGeometry,
  createAmbientModels,
  type AmbientFamily,
  type AmbientModelDef,
  type AmbientSpecies,
} from './models/ambientModels';

export interface AmbientWeather {
  kind?: WeatherKind;
  intensity?: number;
  wind?: { x: number; y?: number; z?: number };
}

export interface AmbientLifeStats {
  budget: number;
  active: number;
  drawCalls: number;
  nearTrianglesMax: number;
  farTrianglesMax: number;
  species: number;
}

interface SpeciesBatch {
  def: AmbientModelDef;
  mesh: THREE.InstancedMesh;
  count: number;
}

interface FarBatch {
  family: AmbientFamily;
  mesh: THREE.InstancedMesh;
  count: number;
  triangles: number;
}

const FAMILIES: readonly AmbientFamily[] = ['bird', 'land', 'shore', 'waterAnimal', 'boat'];
const FAMILY_INDEX: Record<AmbientFamily, number> = { bird: 0, land: 1, shore: 2, waterAnimal: 3, boat: 4 };
const SPECIES_INDEX = Object.fromEntries(AMBIENT_SPECIES.map((s, i) => [s, i])) as Record<AmbientSpecies, number>;

// Repeated entries are deliberate weights. Rare animals remain genuinely rare.
const SPAWN: Record<MapId, readonly [AmbientSpecies, number][]> = {
  appalachia: [['bird', 31], ['crow', 18], ['deer', 22], ['blackBear', 1], ['turkey', 13], ['fishingBoat', 8], ['bassBoat', 7]],
  norcal: [['bird', 10], ['crow', 7], ['seagull', 27], ['pelican', 13], ['seaLion', 10], ['elk', 2], ['fishingBoat', 7], ['bassBoat', 5], ['sailboat', 9]],
  florida: [['bird', 7], ['crow', 5], ['seagull', 12], ['pelican', 15], ['alligator', 19], ['flamingo', 17], ['manatee', 3], ['fishingBoat', 6], ['bassBoat', 7], ['jetSki', 9]],
};

const COLOR_BY_FAMILY: Record<AmbientFamily, number> = {
  bird: 0xcfd1cc,
  land: 0xb28b65,
  shore: 0x889481,
  waterAnimal: 0x849495,
  boat: 0xd3d8d5,
};

function weatherKind(weather: AmbientWeather | WeatherKind): WeatherKind {
  return typeof weather === 'string' ? weather : weather.kind ?? 'clear';
}

function weatherIntensity(weather: AmbientWeather | WeatherKind): number {
  return typeof weather === 'string' ? 1 : weather.intensity ?? 0;
}

function atmosMaterial(roughness: number) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    bindAtmos(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAmbientWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 ambientWP = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  ambientWP = instanceMatrix * ambientWP;
#endif
  vAmbientWPos = (modelMatrix * ambientWP).xyz;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAmbientWPos;\n${CLOUD_GLSL}\nuniform float uWet;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.48, uWet * 0.45);')
      .replace('#include <lights_fragment_end>', cloudShadowChunk('vAmbientWPos'));
  };
  mat.customProgramCacheKey = () => 'slop-ambient-atmos-v2';
  return mat;
}

function triangleCount(g: THREE.BufferGeometry) {
  return (g.index?.count ?? g.getAttribute('position').count) / 3;
}

export class AmbientLife {
  readonly object = new THREE.Group();
  readonly budget: number;

  private readonly mapId: MapId;
  private readonly models: AmbientModelDef[];
  private readonly batches: SpeciesBatch[] = [];
  private readonly farBatches: FarBatch[] = [];
  private readonly material = atmosMaterial(.86);
  private readonly farMaterial = atmosMaterial(.92);
  private readonly wakeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(.6, .78, .82), transparent: true, opacity: .24, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private readonly lightMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.8, 3.1, 1.6), toneMapped: true });
  private readonly wakes: THREE.InstancedMesh;
  private readonly runningLights: THREE.InstancedMesh;

  private readonly active: Uint8Array;
  private readonly locked: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly heading: Float32Array;
  private readonly phase: Float32Array;
  private readonly speed: Float32Array;
  private readonly scale: Float32Array;
  private readonly shade: Float32Array;
  private readonly flock: Uint8Array;

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpColor = new THREE.Color();

  private focusX = 0;
  private focusZ = 0;
  private observerX = 0;
  private observerY = 0;
  private observerZ = 0;
  private haveFocus = false;
  private recycleT = 0;
  private elapsed = 0;
  private seed = 0x51a7c0de;
  private showcaseOn = false;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    map: MapId | MapData,
    private readonly quality: Quality,
  ) {
    this.mapId = typeof map === 'string' ? map : map.def.id;
    this.budget = quality.name === 'low' ? 80 : 300;
    this.models = createAmbientModels();
    this.active = new Uint8Array(this.budget);
    this.locked = new Uint8Array(this.budget);
    this.kind = new Uint8Array(this.budget);
    this.x = new Float32Array(this.budget);
    this.y = new Float32Array(this.budget);
    this.z = new Float32Array(this.budget);
    this.heading = new Float32Array(this.budget);
    this.phase = new Float32Array(this.budget);
    this.speed = new Float32Array(this.budget);
    this.scale = new Float32Array(this.budget);
    this.shade = new Float32Array(this.budget);
    this.flock = new Uint8Array(this.budget);

    this.object.name = 'ambient-life';
    for (const def of this.models) {
      const mesh = new THREE.InstancedMesh(def.geometry, this.material, this.budget);
      mesh.name = `ambient-${def.kind}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.matrixUpdateRange = { start: 0, count: 0 };
      this.tmpColor.setScalar(1);
      mesh.setColorAt(0, this.tmpColor);
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.colorUpdateRange = { start: 0, count: 0 };
      mesh.count = 0;
      mesh.castShadow = quality.name === 'high';
      mesh.receiveShadow = quality.name === 'high';
      mesh.frustumCulled = false;
      this.object.add(mesh);
      this.batches.push({ def, mesh, count: 0 });
    }
    for (const family of FAMILIES) {
      const geometry = createAmbientFarGeometry(family);
      const mesh = new THREE.InstancedMesh(geometry, this.farMaterial, this.budget);
      mesh.name = `ambient-far-${family}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.matrixUpdateRange = { start: 0, count: 0 };
      this.tmpColor.setScalar(1);
      mesh.setColorAt(0, this.tmpColor);
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.colorUpdateRange = { start: 0, count: 0 };
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.object.add(mesh);
      this.farBatches.push({ family, mesh, count: 0, triangles: triangleCount(geometry) });
    }

    const wakeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.wakes = new THREE.InstancedMesh(wakeGeo, this.wakeMaterial, this.budget);
    this.wakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wakes.userData.matrixUpdateRange = { start: 0, count: 0 };
    this.wakes.count = 0;
    this.wakes.frustumCulled = false;
    this.wakes.renderOrder = 2;
    this.object.add(this.wakes);

    const lightGeo = new THREE.SphereGeometry(1, 5, 3);
    this.runningLights = new THREE.InstancedMesh(lightGeo, this.lightMaterial, this.budget);
    this.runningLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.runningLights.userData.matrixUpdateRange = { start: 0, count: 0 };
    this.runningLights.count = 0;
    this.runningLights.frustumCulled = false;
    this.object.add(this.runningLights);

    scene.add(this.object);
  }

  private rnd() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private chooseKind(): number {
    const table = SPAWN[this.mapId];
    let total = 0;
    for (let i = 0; i < table.length; i++) total += table[i][1];
    let r = this.rnd() * total;
    for (let i = 0; i < table.length; i++) {
      r -= table[i][1];
      if (r <= 0) return SPECIES_INDEX[table[i][0]];
    }
    return SPECIES_INDEX[table[table.length - 1][0]];
  }

  private validSite(def: AmbientModelDef, x: number, z: number, h: number): boolean {
    if (!this.terrain.inBounds(x, z, 8)) return false;
    if (def.family === 'bird') return true;
    if (def.family === 'boat') return h < WATER - 1.5;
    if (def.kind === 'manatee') return h < WATER - .7 && h > WATER - 12;
    if (def.kind === 'alligator') return h > WATER - 1.2 && h < WATER + 1.7 && this.terrain.slope(x, z) < .16;
    if (def.kind === 'flamingo') return h > WATER - 1.4 && h < WATER + .7 && this.terrain.slope(x, z) < .1;
    if (def.kind === 'seaLion') {
      const sand = this.terrain.map.sand?.(x, z) ?? 0;
      return h > WATER - .35 && h < WATER + 4 && (sand > .18 || this.terrain.slope(x, z) < .12);
    }
    if (h < WATER + .5 || this.terrain.slope(x, z) > .3) return false;
    const cover = this.terrain.coverAt(x, z);
    if (def.kind === 'blackBear') return cover > .48;
    if (def.kind === 'deer' || def.kind === 'elk') return cover > .18 && cover < .86;
    return cover > .08;
  }

  private placeHeight(def: AmbientModelDef, x: number, z: number, h: number) {
    if (def.family === 'bird') return Math.max(WATER, h) + 14 + this.rnd() * 42;
    if (def.family === 'boat') return WATER + .18;
    if (def.kind === 'manatee') return WATER - .18 - this.rnd() * .35;
    if (def.kind === 'alligator' || def.kind === 'flamingo') return Math.max(WATER, h) + .04;
    return Math.max(WATER, h) + .03;
  }

  private spawnSlot(i: number) {
    const ki = this.chooseKind();
    const def = this.models[ki];
    this.kind[i] = ki;
    this.active[i] = 0;
    for (let tries = 0; tries < 42; tries++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 35 + Math.sqrt(this.rnd()) * 555;
      const x = this.focusX + Math.cos(a) * r;
      const z = this.focusZ + Math.sin(a) * r;
      if (!this.terrain.inBounds(x, z, 8)) continue;
      const h = this.terrain.h(x, z);
      if (!this.validSite(def, x, z, h)) continue;
      this.x[i] = x;
      this.z[i] = z;
      this.y[i] = this.placeHeight(def, x, z, h);
      this.heading[i] = this.rnd() * Math.PI * 2;
      this.phase[i] = this.rnd() * Math.PI * 2;
      this.speed[i] = def.speed * (.72 + this.rnd() * .55);
      this.scale[i] = def.scale * (.82 + this.rnd() * .34);
      this.shade[i] = .82 + this.rnd() * .27;
      this.flock[i] = Math.floor(this.rnd() * 12);
      this.active[i] = 1;
      return;
    }
  }

  private cameraFocus(camera: THREE.Camera) {
    camera.getWorldDirection(this.tmpDir);
    let t = this.tmpDir.y < -.035 ? (WATER - camera.position.y) / this.tmpDir.y : 220;
    t = THREE.MathUtils.clamp(t, 20, 5000);
    let x = camera.position.x + this.tmpDir.x * t;
    let z = camera.position.z + this.tmpDir.z * t;
    if (this.terrain.inBounds(x, z, 0) && this.tmpDir.y < -.035) {
      for (let k = 0; k < 2; k++) {
        const h = Math.max(WATER, this.terrain.h(x, z));
        t = THREE.MathUtils.clamp((h - camera.position.y) / this.tmpDir.y, 20, 5000);
        x = camera.position.x + this.tmpDir.x * t;
        z = camera.position.z + this.tmpDir.z * t;
      }
    }
    this.tmpPos.set(x, 0, z);
  }

  private recycle(view: THREE.Camera | THREE.Vector3) {
    if ('isCamera' in view && view.isCamera) {
      const camera = view as THREE.Camera;
      this.observerX = camera.position.x;
      this.observerY = camera.position.y;
      this.observerZ = camera.position.z;
      this.cameraFocus(camera);
    } else {
      const focus = view as THREE.Vector3;
      this.observerX = focus.x;
      this.observerY = focus.y;
      this.observerZ = focus.z;
      this.tmpPos.set(focus.x, 0, focus.z);
    }
    const nx = this.tmpPos.x, nz = this.tmpPos.z;
    const moved = !this.haveFocus || Math.hypot(nx - this.focusX, nz - this.focusZ) > 115;
    if (!moved && this.recycleT > 0) return;
    this.recycleT = 1.5;
    this.focusX = nx;
    this.focusZ = nz;
    this.haveFocus = true;
    if (this.showcaseOn) return;
    for (let i = 0; i < this.budget; i++) {
      if (this.locked[i]) continue;
      const dx = this.x[i] - nx, dz = this.z[i] - nz;
      if (!this.active[i] || dx * dx + dz * dz > 620 * 620 || moved && dx * dx + dz * dz > 500 * 500) this.spawnSlot(i);
    }
  }

  private moveSlot(i: number, dt: number, night: number, storm: number) {
    const def = this.models[this.kind[i]];
    this.phase[i] += dt * (def.family === 'bird' ? 5.2 : 1.7);
    if (this.locked[i]) return;
    const dxFocus = this.focusX - this.x[i], dzFocus = this.focusZ - this.z[i];
    const dist2 = dxFocus * dxFocus + dzFocus * dzFocus;
    let turn = Math.sin(this.phase[i] * .23 + this.flock[i]) * .12;
    let speed = this.speed[i];

    if (dist2 > 500 * 500) {
      const want = Math.atan2(dxFocus, dzFocus);
      let d = want - this.heading[i];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn += d * .65;
    }
    if (def.family === 'bird') {
      // Flock members share a slow steering pulse while retaining individual orbit.
      turn += Math.sin(this.elapsed * .35 + this.flock[i] * 1.71) * .18;
      speed *= 1 - storm * .5;
      this.y[i] += Math.sin(this.phase[i] + this.flock[i]) * dt * .8;
    } else if (def.family === 'land') {
      speed *= night > .58 ? .12 : .32;
      const cx = this.observerX - this.x[i], cz = this.observerZ - this.z[i];
      if ((def.kind === 'deer' || def.kind === 'elk') && cx * cx + cz * cz < 95 * 95) {
        this.heading[i] = Math.atan2(-cx, -cz);
        speed = this.speed[i] * 2.4;
      }
    } else if (def.family === 'shore' || def.family === 'waterAnimal') {
      speed *= night > .68 ? .08 : .25;
    }
    this.heading[i] += turn * dt;
    const sx = Math.sin(this.heading[i]), sz = Math.cos(this.heading[i]);
    const nx = this.x[i] + sx * speed * dt;
    const nz = this.z[i] + sz * speed * dt;
    if (!this.terrain.inBounds(nx, nz, 7)) {
      this.heading[i] += Math.PI * .73;
      return;
    }
    const h = this.terrain.h(nx, nz);
    if (def.family !== 'bird' && !this.validSite(def, nx, nz, h)) {
      this.heading[i] += .8 + this.rnd() * 1.5;
      return;
    }
    this.x[i] = nx;
    this.z[i] = nz;
    if (def.family !== 'bird') this.y[i] = this.placeHeight(def, nx, nz, h);
  }

  private setInstance(mesh: THREE.InstancedMesh, at: number, i: number, sx: number, sy: number, sz: number, yOffset = 0, xOffset = 0, zOffset = 0) {
    const yaw = this.heading[i];
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    this.tmpPos.set(this.x[i] + xOffset * cos + zOffset * sin, this.y[i] + yOffset, this.z[i] - xOffset * sin + zOffset * cos);
    this.tmpEuler.set(0, yaw, 0);
    this.tmpQuat.setFromEuler(this.tmpEuler);
    this.tmpScale.set(sx, sy, sz);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    mesh.setMatrixAt(at, this.tmpMatrix);
  }

  private finishBatch(mesh: THREE.InstancedMesh, count: number, colors: boolean) {
    mesh.count = count;
    if (count <= 0) return;
    const matrixRange = mesh.userData.matrixUpdateRange as { start: number; count: number };
    matrixRange.count = count * 16;
    mesh.instanceMatrix.updateRanges.push(matrixRange);
    mesh.instanceMatrix.needsUpdate = true;
    if (colors && mesh.instanceColor) {
      const colorRange = mesh.userData.colorUpdateRange as { start: number; count: number };
      colorRange.count = count * 3;
      mesh.instanceColor.updateRanges.push(colorRange);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  /** dt is real seconds; weather accepts either WeatherSystem or its WeatherKind. */
  update(dt: number, view: THREE.Camera | THREE.Vector3, night: number, weather: AmbientWeather | WeatherKind) {
    if (this.disposed) return;
    this.elapsed += dt;
    this.recycleT -= dt;
    this.recycle(view);
    const wk = weatherKind(weather);
    const wi = weatherIntensity(weather);
    const storm = (wk === 'storm' || wk === 'hurricane' || wk === 'blizzard') ? wi : wk === 'rain' || wk === 'snow' ? wi * .55 : 0;
    const birdKeep = Math.max(.08, (1 - night * .88) * (1 - storm * .83));
    const nearD2 = (this.quality.name === 'low' ? 125 : 180) ** 2;
    for (let k = 0; k < this.batches.length; k++) this.batches[k].count = 0;
    for (let k = 0; k < this.farBatches.length; k++) this.farBatches[k].count = 0;
    let wakeCount = 0, lightCount = 0;

    for (let i = 0; i < this.budget; i++) {
      if (!this.active[i]) continue;
      const def = this.models[this.kind[i]];
      this.moveSlot(i, dt, night, storm);
      if (def.family === 'bird' && !this.locked[i] && (i * .61803398875 % 1) > birdKeep) continue;
      const cdx = this.x[i] - this.observerX, cdy = this.y[i] - this.observerY, cdz = this.z[i] - this.observerZ;
      const d2 = cdx * cdx + cdy * cdy + cdz * cdz;
      const flap = def.family === 'bird' ? .86 + Math.sin(this.phase[i] * 2.5) * .15 : 1;
      const bob = def.family === 'land' ? Math.abs(Math.sin(this.phase[i])) * .035 : 0;
      if (d2 <= nearD2 || this.locked[i]) {
        const batch = this.batches[this.kind[i]];
        const at = batch.count++;
        this.setInstance(batch.mesh, at, i, this.scale[i], this.scale[i] * flap, this.scale[i], bob);
        this.tmpColor.setScalar(this.shade[i]);
        batch.mesh.setColorAt(at, this.tmpColor);
      } else {
        const far = this.farBatches[FAMILY_INDEX[def.family]];
        const at = far.count++;
        this.setInstance(far.mesh, at, i, this.scale[i], this.scale[i] * flap, this.scale[i], bob);
        this.tmpColor.set(COLOR_BY_FAMILY[def.family]).multiplyScalar(this.shade[i]);
        far.mesh.setColorAt(at, this.tmpColor);
      }
      if (def.family === 'boat') {
        const wakeScale = Math.max(.5, this.speed[i] * .3);
        this.setInstance(this.wakes, wakeCount++, i, wakeScale, 1, wakeScale * 3.2, .025, 0, -1.5 * this.scale[i]);
        if (night > .08) this.setInstance(this.runningLights, lightCount++, i, .075, .075, .075, .82 * this.scale[i], 0, .25);
      }
    }

    for (let k = 0; k < this.batches.length; k++) this.finishBatch(this.batches[k].mesh, this.batches[k].count, true);
    for (let k = 0; k < this.farBatches.length; k++) this.finishBatch(this.farBatches[k].mesh, this.farBatches[k].count, true);
    this.finishBatch(this.wakes, wakeCount, false);
    this.finishBatch(this.runningLights, lightCount, false);
    this.runningLights.visible = night > .08;
    this.lightMaterial.color.setRGB(3.8 * night, 3.1 * night, 1.6 * night);
  }

  /**
   * Locks one of every species into a 4x4 inspection grid and uploads it
   * immediately. Call clearShowcase() to return this instance to simulation.
   */
  showcase(x: number, z: number) {
    this.showcaseOn = true;
    this.active.fill(0);
    this.locked.fill(0);
    const spacing = 9;
    for (let i = 0; i < AMBIENT_SPECIES.length && i < this.budget; i++) {
      const px = x + (i % 4 - 1.5) * spacing;
      const pz = z + (Math.floor(i / 4) - 1.5) * spacing;
      const h = this.terrain.inBounds(px, pz, 0) ? this.terrain.h(px, pz) : WATER;
      const def = this.models[i];
      this.active[i] = 1;
      this.locked[i] = 1;
      this.kind[i] = i;
      this.x[i] = px;
      this.z[i] = pz;
      this.y[i] = def.family === 'bird' ? Math.max(WATER, h) + 3.5 : def.family === 'boat' || def.family === 'waterAnimal' ? Math.max(WATER, h) + .18 : Math.max(WATER, h) + .03;
      this.heading[i] = Math.PI;
      this.phase[i] = i * .71;
      this.speed[i] = 0;
      this.scale[i] = def.scale;
      this.shade[i] = 1;
    }
    // A dev-only showcase may not be registered with the game frame loop, so
    // populate its instance buffers immediately and leave the tableau static.
    const centerY = this.terrain.inBounds(x, z, 0) ? this.terrain.h(x, z) : WATER;
    this.update(0, this.tmpPos.set(x, centerY, z), 0, 'clear');
    return Math.min(AMBIENT_SPECIES.length, this.budget);
  }

  clearShowcase() {
    if (!this.showcaseOn) return;
    this.showcaseOn = false;
    for (let i = 0; i < AMBIENT_SPECIES.length && i < this.budget; i++) {
      this.locked[i] = 0;
      this.active[i] = 0;
    }
    this.haveFocus = false;
    this.recycleT = 0;
  }

  stats(): AmbientLifeStats {
    let active = 0, draws = 0, nearTrianglesMax = 0, farTrianglesMax = 0;
    for (let i = 0; i < this.budget; i++) active += this.active[i];
    for (const b of this.batches) {
      if (b.count) draws++;
      nearTrianglesMax = Math.max(nearTrianglesMax, b.def.triangles);
    }
    for (const b of this.farBatches) {
      if (b.count) draws++;
      farTrianglesMax = Math.max(farTrianglesMax, b.triangles);
    }
    if (this.wakes.count) draws++;
    if (this.runningLights.count && this.runningLights.visible) draws++;
    return { budget: this.budget, active, drawCalls: draws, nearTrianglesMax, farTrianglesMax, species: this.models.length };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.object);
    for (const b of this.batches) b.mesh.geometry.dispose();
    for (const b of this.farBatches) b.mesh.geometry.dispose();
    this.wakes.geometry.dispose();
    this.runningLights.geometry.dispose();
    this.material.dispose();
    this.farMaterial.dispose();
    this.wakeMaterial.dispose();
    this.lightMaterial.dispose();
    this.object.clear();
  }
}

export { AMBIENT_SPECIES } from './models/ambientModels';
export type { AmbientSpecies } from './models/ambientModels';
