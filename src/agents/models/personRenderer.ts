import * as THREE from 'three';
import type { PersonAction } from '../../contracts';
import type { Archetype, BodyType, FaceStyle, HairStyle, HatStyle, Outfit, PersonProp } from '../people';
import {
  attachPersonInstanceAttributes, buildFaceAtlas, buildPersonGeometry, createPersonDepthMaterial, createPersonMaterial,
  geometryTriangles, HAIR_ID, HAT_ID, OUTFIT_ID, PROP_ID,
  type PersonInstanceAttributes, type PersonMaterialControl,
} from './personModel';

const ACTION_ID: Record<PersonAction, number> = {
  walk: 0, run: 1, idle: 2, smoke: 3, drink: 4, vape: 5, phone: 6,
  protest: 7, dance: 8, drum: 9, yoga: 10, sit: 11, lie: 12, fight: 13,
};
const FACE_ID: Record<FaceStyle, number> = {
  plain: 0, smile: 1, scowl: 2, sleepy: 3, shades: 4, glasses: 5,
  mustache: 6, beard: 7, soyjak: 8, wojak: 9, blush: 10, npc: 11,
};
const BODY_SHAPE: Record<BodyType, readonly [number, number, number]> = {
  slim: [0.84, 1, 0.86], average: [1, 1, 1], broad: [1.17, 1.02, 1.08],
  stocky: [1.16, 0.92, 1.12], tall: [0.92, 1.09, 0.94],
};
const SKIN = [0xf3c9a4, 0xdba276, 0xb97850, 0x895638, 0x603b2a, 0xf0bfa0] as const;
const HAIR = [0x2b1b15, 0x4a2c1b, 0x8a5a2b, 0xc9a45f, 0xd8d2c4, 0x161616, 0x9b3f2f] as const;
const PANTS = [0x283447, 0x393735, 0x45513f, 0x31516a, 0x604f3f, 0x1d2026] as const;
const SHIRT = [0x315b73, 0xb64a3c, 0x5d7047, 0xc8913c, 0x6d547d, 0xd7d0bf, 0x303338, 0x8d5b3e] as const;
const TAU = Math.PI * 2;

type Batch = { mesh: THREE.InstancedMesh; attributes: PersonInstanceAttributes; material: PersonMaterialControl; depth?: THREE.MeshDepthMaterial };
const REUSABLE_UPDATE_RANGES = new WeakMap<THREE.BufferAttribute, { start: number; count: number }>();

function colorToAttribute(attribute: THREE.InstancedBufferAttribute, index: number, color: THREE.Color): void {
  attribute.setXYZ(index, color.r, color.g, color.b);
}

function markRange(attribute: THREE.BufferAttribute, min: number, max: number): void {
  if (max < min) return;
  let range = REUSABLE_UPDATE_RANGES.get(attribute);
  if (!range) { range = { start: 0, count: 0 }; REUSABLE_UPDATE_RANGES.set(attribute, range); }
  range.start = min * attribute.itemSize;
  range.count = (max - min + 1) * attribute.itemSize;
  attribute.updateRanges.length = 0;
  attribute.updateRanges.push(range);
  attribute.needsUpdate = true;
}

/** Shared two-draw-call renderer. PeopleRenderer in people.ts supplies the catalog. */
export class PeopleRendererCore {
  readonly object = new THREE.Group();
  readonly stats: Readonly<{ nearTriangles: number; farTriangles: number; drawCalls: number }>;

  private readonly near: Batch;
  private readonly far: Batch;
  private readonly batches: readonly Batch[];
  private readonly alive: Uint8Array;
  private readonly archetypeIndex: Uint8Array;
  private readonly free: number[] = [];
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly hits: THREE.Intersection[] = [];
  private used = 0;
  private matrixDirtyMin: number;
  private matrixDirtyMax = -1;
  private styleDirtyMin: number;
  private styleDirtyMax = -1;
  private motionDirtyMin: number;
  private motionDirtyMax = -1;
  private readonly faceAtlas: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, private readonly max: number, private readonly archetypes: readonly Archetype[]) {
    this.alive = new Uint8Array(max);
    this.archetypeIndex = new Uint8Array(max);
    this.matrixDirtyMin = this.styleDirtyMin = this.motionDirtyMin = max;
    this.faceAtlas = buildFaceAtlas();

    const nearGeometry = buildPersonGeometry(false);
    const farGeometry = buildPersonGeometry(true);
    this.near = this.makeBatch(nearGeometry, false);
    this.far = this.makeBatch(farGeometry, true);
    this.batches = [this.near, this.far];
    this.stats = Object.freeze({ nearTriangles: geometryTriangles(nearGeometry), farTriangles: geometryTriangles(farGeometry), drawCalls: 2 });
    this.object.name = 'people-aa';
    this.object.add(this.near.mesh, this.far.mesh);
    scene.add(this.object);
    for (let i = 0; i < max; i++) {
      this.near.mesh.setMatrixAt(i, this.hidden);
      this.far.mesh.setMatrixAt(i, this.hidden);
    }
    this.matrixDirtyMin = 0; this.matrixDirtyMax = max - 1;
  }

  private makeBatch(geometry: THREE.BufferGeometry, far: boolean): Batch {
    const attributes = attachPersonInstanceAttributes(geometry, this.max);
    const material = createPersonMaterial(this.faceAtlas, far);
    const mesh = new THREE.InstancedMesh(geometry, material.material, this.max);
    mesh.name = far ? 'people-far' : 'people-near';
    mesh.count = this.max;
    mesh.frustumCulled = false;
    mesh.castShadow = !far;
    mesh.receiveShadow = true;
    const depth = far ? undefined : createPersonDepthMaterial();
    if (depth) mesh.customDepthMaterial = depth;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh, attributes, material, depth };
  }

  private dirtyStyle(h: number): void { this.styleDirtyMin = Math.min(this.styleDirtyMin, h); this.styleDirtyMax = Math.max(this.styleDirtyMax, h); }
  private dirtyMotion(h: number): void { this.motionDirtyMin = Math.min(this.motionDirtyMin, h); this.motionDirtyMax = Math.max(this.motionDirtyMax, h); }
  private dirtyMatrix(h: number): void { this.matrixDirtyMin = Math.min(this.matrixDirtyMin, h); this.matrixDirtyMax = Math.max(this.matrixDirtyMax, h); }

  private setColorForAll(key: 'skin' | 'shirt' | 'pants' | 'hair' | 'accent', h: number, hex: number): void {
    this.color.setHex(hex);
    for (let i = 0; i < this.batches.length; i++) colorToAttribute(this.batches[i].attributes[key], h, this.color);
  }

  add(archetype: number, seed: number): number {
    const h = this.free.length ? this.free.pop()! : this.used < this.max ? this.used++ : -1;
    if (h < 0 || this.archetypes.length === 0) return -1;
    const ai = ((archetype % this.archetypes.length) + this.archetypes.length) % this.archetypes.length;
    const a = this.archetypes[ai];
    const s = seed >>> 0;
    this.alive[h] = 1; this.archetypeIndex[h] = ai;
    const skin = a.face === 'npc' ? 0x8b9093 : SKIN[(s >>> 3) % SKIN.length];
    const hair = HAIR[(s >>> 7) % HAIR.length];
    const pants = PANTS[(s >>> 11) % PANTS.length];
    const shirt = a.merch ? 0x171717 : SHIRT[(s >>> 15) % SHIRT.length];
    const accent = a.outfit === 'suit' ? 0x252b36 : a.outfit === 'raincoat' ? 0xd4a72c : a.outfit === 'workwear' ? 0xd48c25 : shirt;
    this.setColorForAll('skin', h, skin); this.setColorForAll('hair', h, hair); this.setColorForAll('pants', h, pants);
    this.setColorForAll('shirt', h, shirt); this.setColorForAll('accent', h, accent);
    const shape = BODY_SHAPE[a.body ?? 'average'];
    const outfit = OUTFIT_ID[a.outfit ?? 'tee'];
    const hairStyle = HAIR_ID[a.hair ?? 'crop'];
    const hat = HAT_ID[a.hat ?? 'none'];
    const prop = PROP_ID[a.prop ?? 'none'];
    const face = FACE_ID[a.face ?? 'plain'];
    for (let i = 0; i < this.batches.length; i++) {
      const at = this.batches[i].attributes;
      at.shape.setXYZ(h, shape[0], shape[1], shape[2]);
      at.style.setXYZW(h, outfit, hairStyle, hat, prop);
      at.motion.setXYZW(h, ACTION_ID.idle, 0, face, a.merch ? 1 : 0);
      this.batches[i].mesh.setMatrixAt(h, this.hidden);
    }
    this.dirtyStyle(h); this.dirtyMotion(h); this.dirtyMatrix(h);
    return h;
  }

  remove(h: number): void {
    if (h < 0 || h >= this.max || this.alive[h] === 0) return;
    this.alive[h] = 0;
    for (let i = 0; i < this.batches.length; i++) this.batches[i].mesh.setMatrixAt(h, this.hidden);
    this.dirtyMatrix(h);
    this.free.push(h);
  }

  set(h: number, x: number, y: number, z: number, yaw: number, action: PersonAction, phase: number): void {
    if (h < 0 || h >= this.max || this.alive[h] === 0) return;
    this.matrix.makeRotationY(yaw); this.matrix.setPosition(x, y, z);
    const a = this.archetypes[this.archetypeIndex[h]];
    const face = FACE_ID[a.face ?? 'plain'];
    for (let i = 0; i < this.batches.length; i++) {
      this.batches[i].mesh.setMatrixAt(h, this.matrix);
      this.batches[i].attributes.motion.setXYZW(h, ACTION_ID[action], phase * TAU, face, a.merch ? 1 : 0);
    }
    this.dirtyMatrix(h); this.dirtyMotion(h);
  }

  setNight(n: number): void {
    this.near.material.setNight(n); this.far.material.setNight(n);
  }

  /** The shader reads cameraPosition directly; this method only chooses the switch range. */
  updateLod(_camera: THREE.Camera, quality: 'low' | 'medium' | 'high' | number = 'high'): void {
    const distance = typeof quality === 'number' ? quality : quality === 'low' ? 55 : quality === 'medium' ? 65 : 78;
    this.near.material.setLodDistance(distance); this.far.material.setLodDistance(distance);
  }

  flush(): void {
    if (this.matrixDirtyMax >= this.matrixDirtyMin) {
      markRange(this.near.mesh.instanceMatrix, this.matrixDirtyMin, this.matrixDirtyMax);
      markRange(this.far.mesh.instanceMatrix, this.matrixDirtyMin, this.matrixDirtyMax);
    }
    if (this.styleDirtyMax >= this.styleDirtyMin) {
      for (let b = 0; b < this.batches.length; b++) {
        const all = this.batches[b].attributes.all;
        for (let i = 0; i < all.length - 1; i++) markRange(all[i], this.styleDirtyMin, this.styleDirtyMax);
      }
    }
    if (this.motionDirtyMax >= this.motionDirtyMin) {
      markRange(this.near.attributes.motion, this.motionDirtyMin, this.motionDirtyMax);
      markRange(this.far.attributes.motion, this.motionDirtyMin, this.motionDirtyMax);
    }
    this.matrixDirtyMin = this.styleDirtyMin = this.motionDirtyMin = this.max;
    this.matrixDirtyMax = this.styleDirtyMax = this.motionDirtyMax = -1;
  }

  pick(ray: THREE.Raycaster): number | null {
    this.hits.length = 0;
    ray.intersectObject(this.near.mesh, false, this.hits);
    for (let i = 0; i < this.hits.length; i++) {
      const id = this.hits[i].instanceId;
      if (id !== undefined && this.alive[id] !== 0) return id;
    }
    return null;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.near.mesh.geometry.dispose(); this.far.mesh.geometry.dispose();
    this.near.depth?.dispose();
    this.near.material.dispose(); this.far.material.dispose(); this.faceAtlas.dispose();
  }
}
