import * as THREE from 'three';
import type { PersonAction } from '../../contracts';
import type { Archetype, FaceStyle } from '../people';
import {
  attachPersonInstanceAttributes, buildFaceAtlas, buildPersonGeometry, createPersonDepthMaterial, createPersonMaterial,
  geometryTriangles, PROP, PersonStyle,
  type PersonInstanceAttributes, type PersonMaterialControl,
} from './personModel';
import { resolveLook } from './personLooks';
import { PersonPosePass, poseSupported } from './personPose';

const ACTION_ID: Record<PersonAction, number> = {
  walk: 0, run: 1, idle: 2, smoke: 3, drink: 4, vape: 5, phone: 6,
  protest: 7, dance: 8, drum: 9, yoga: 10, sit: 11, lie: 12, fight: 13,
};
const FACE_ID: Record<FaceStyle, number> = {
  plain: 0, smile: 1, scowl: 2, sleepy: 3, shades: 4, glasses: 5,
  mustache: 6, beard: 7, soyjak: 8, wojak: 9, blush: 10, npc: 11,
};
const propId = (p: string | undefined): number => (p && p in PROP ? PROP[p as keyof typeof PROP] : 0);

type Batch = { mesh: THREE.InstancedMesh; attributes: PersonInstanceAttributes; material: PersonMaterialControl; depth?: THREE.MeshDepthMaterial };
const REUSABLE_UPDATE_RANGES = new WeakMap<THREE.BufferAttribute, { start: number; count: number }>();

function markRange(attribute: THREE.BufferAttribute, min: number, max: number): void {
  if (max < min) return;
  let range = REUSABLE_UPDATE_RANGES.get(attribute);
  if (!range) { range = { start: 0, count: 0 }; REUSABLE_UPDATE_RANGES.set(attribute, range); }
  const start = min * attribute.itemSize;
  const end = (max + 1) * attribute.itemSize;
  // Several systems can flush the shared renderer before WebGL gets to upload it
  // (debug/showcase seeding followed by the normal pedestrian tick is one example).
  // Preserve the union of every pending write; replacing the range here strands the
  // earlier slots at their old GPU values until those exact handles move again.
  if (attribute.updateRanges.length > 0) {
    const pending = attribute.updateRanges[0];
    const pendingEnd = pending.start + pending.count;
    pending.start = Math.min(pending.start, start);
    pending.count = Math.max(pendingEnd, end) - pending.start;
    attribute.updateRanges.length = 1;
  } else {
    range.start = start;
    range.count = end - start;
    attribute.updateRanges.push(range);
  }
  attribute.needsUpdate = true;
}

/** Shared two-draw-call renderer. PeopleRenderer in people.ts supplies the catalog. */
export class PeopleRendererCore {
  readonly object = new THREE.Group();
  readonly stats: Readonly<{ nearTriangles: number; farTriangles: number; drawCalls: number }>;

  private readonly near: Batch;
  /** invisible stand-in the pointer is tested against: a column round each person (the drawn body is posed in the shader, so the rest-pose mesh is no guide) */
  private readonly pickMesh: THREE.InstancedMesh;
  private readonly far: Batch;
  private readonly batches: readonly Batch[];
  private readonly alive: Uint8Array;
  private readonly archetypeIndex: Uint8Array;
  private readonly cadence: Float32Array;
  /** set once a person has been placed (before that the slot is hidden) */
  private readonly placed: Uint8Array;
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
  private readonly style: PersonStyle;
  private readonly pose: PersonPosePass;
  /** the renderer the figure is drawn with (found the first time it draws, or given to bindRenderer) and whether it can run the pose pass */
  private gl: THREE.WebGLRenderer | null = null;
  private poseOn = false;
  private poseStale = true;
  /** where the figure was drawn from since the last flush (the main camera, the water's mirror camera ...): whoever is near any of them is on the near figure */
  private viewers: THREE.Vector3[] = [];
  private viewerCount = 0;
  private collecting = false;
  private lodDistance = 64;

  constructor(scene: THREE.Scene, private readonly max: number, private readonly archetypes: readonly Archetype[]) {
    this.alive = new Uint8Array(max);
    this.archetypeIndex = new Uint8Array(max);
    this.cadence = new Float32Array(max).fill(1);
    this.placed = new Uint8Array(max);
    this.matrixDirtyMin = this.styleDirtyMin = this.motionDirtyMin = max;
    this.faceAtlas = buildFaceAtlas();
    this.style = new PersonStyle(max);
    this.pose = new PersonPosePass(max, this.style.texture);

    const nearGeometry = buildPersonGeometry(false);
    const farGeometry = buildPersonGeometry(true);
    this.near = this.makeBatch(nearGeometry, false);
    this.far = this.makeBatch(farGeometry, true);
    this.pose.connect(farGeometry);
    this.batches = [this.near, this.far];
    const column = new THREE.CylinderGeometry(0.28, 0.28, 1.85, 8, 1);
    column.translate(0, 0.925, 0);
    this.pickMesh = new THREE.InstancedMesh(column, new THREE.MeshBasicMaterial(), max);
    this.pickMesh.instanceMatrix = this.far.mesh.instanceMatrix; // the same matrices (the far batch keeps one slot per handle): nothing extra to upload
    this.pickMesh.count = 0;
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
    const material = createPersonMaterial(this.faceAtlas, far, this.pose.uniforms);
    const mesh = new THREE.InstancedMesh(geometry, material.material, this.max);
    mesh.name = far ? 'people-far' : 'people-near';
    // draw only up to the highest handle in use: drawing every slot (hidden
    // ones included, in the shadow pass too) cost ~2M triangles a frame on
    // Ultra in a town of zero people
    mesh.count = 0;
    mesh.frustumCulled = false;
    // the shadow is cast by the far figure, for everybody: a third of the near figure's triangles go through the shadow pass, and nobody
    // reads the detail of a shadow (the near figure is only drawn once, in the view)
    mesh.castShadow = far;
    mesh.receiveShadow = true;
    const depth = far ? createPersonDepthMaterial(this.pose.uniforms) : undefined;
    if (depth) mesh.customDepthMaterial = depth;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // the first draw tells us the renderer, which the pose pass needs (and it allocates the pose textures before they are sampled)
    mesh.onBeforeRender = (r, _scene, camera) => { this.bindRenderer(r); this.seenFrom(camera); };
    mesh.onBeforeShadow = (r) => this.bindRenderer(r);
    return { mesh, attributes, material, depth };
  }

  private dirtyStyle(h: number): void { this.styleDirtyMin = Math.min(this.styleDirtyMin, h); this.styleDirtyMax = Math.max(this.styleDirtyMax, h); }
  private dirtyMotion(h: number): void { this.motionDirtyMin = Math.min(this.motionDirtyMin, h); this.motionDirtyMax = Math.max(this.motionDirtyMax, h); }
  private dirtyMatrix(h: number): void { this.matrixDirtyMin = Math.min(this.matrixDirtyMin, h); this.matrixDirtyMax = Math.max(this.matrixDirtyMax, h); }

  add(archetype: number, seed: number): number {
    const h = this.free.length ? this.free.pop()! : this.used < this.max ? this.used++ : -1;
    if (h < 0 || this.archetypes.length === 0) return -1;
    if (this.far.mesh.count < this.used) this.far.mesh.count = this.pickMesh.count = this.used;
    const ai = ((archetype % this.archetypes.length) + this.archetypes.length) % this.archetypes.length;
    const a = this.archetypes[ai];
    this.alive[h] = 1; this.archetypeIndex[h] = ai;
    const look = resolveLook(a, seed, FACE_ID[a.face ?? 'plain'], propId);
    this.cadence[h] = look.cadence;
    this.style.write(h, look);
    // the far batch keeps one slot per handle (the row of the style and pose textures, and of the pointer's stand-ins); the near batch is
    // made from it every flush, with only the people who are near
    this.far.attributes.motion.setXYZW(h, ACTION_ID.idle, 0, h, 0);
    this.far.mesh.setMatrixAt(h, this.hidden);
    this.placed[h] = 0;
    this.dirtyStyle(h); this.dirtyMotion(h); this.dirtyMatrix(h);
    return h;
  }

  remove(h: number): void {
    if (h < 0 || h >= this.max || this.alive[h] === 0) return;
    this.alive[h] = 0;
    this.far.mesh.setMatrixAt(h, this.hidden); this.far.attributes.motion.setXYZW(h, -1, 0, h, 0); // action -1: a free slot, skipped by both shaders
    this.placed[h] = 0;
    this.dirtyMatrix(h); this.dirtyMotion(h);
    this.free.push(h);
  }

  /**
   * Place and pose one person. `phase` is what pedestrians.ts advances: leg cycles (ground / STRIDE) while walking or running,
   * seconds for everything else. A person with their own stride takes `cadence` cycles per unit of walking phase, so their feet
   * still keep up with the ground (see personLooks.ts).
   */
  set(h: number, x: number, y: number, z: number, yaw: number, action: PersonAction, phase: number): void {
    if (h < 0 || h >= this.max || this.alive[h] === 0) return;
    this.matrix.makeRotationY(yaw); this.matrix.setPosition(x, y, z);
    const t = action === 'walk' || action === 'run' ? phase * this.cadence[h] : phase;
    this.far.mesh.setMatrixAt(h, this.matrix);
    this.far.attributes.motion.setXYZW(h, ACTION_ID[action], t, h, 0);
    this.placed[h] = 1;
    this.dirtyMatrix(h); this.dirtyMotion(h);
  }

  /** Optional: hand over the renderer before the first frame (the figure finds it itself when it first draws). */
  bindRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.gl === renderer) return;
    this.gl = renderer;
    this.poseOn = poseSupported(renderer);
    if (this.poseOn) this.pose.init(renderer);
    this.poseStale = true;
  }

  setNight(n: number): void {
    this.near.material.setNight(n); this.far.material.setNight(n);
  }

  /** The shader reads cameraPosition directly; this method only chooses the switch range. */
  updateLod(_camera: THREE.Camera, quality: 'low' | 'medium' | 'high' | number = 'high'): void {
    const distance = typeof quality === 'number' ? quality : quality === 'low' ? 48 : quality === 'medium' ? 58 : 66;
    this.lodDistance = distance;
    this.near.material.setLodDistance(distance); this.far.material.setLodDistance(distance);
  }

  /** remember a camera the figure is being drawn from (see flush) */
  private seenFrom(camera: THREE.Camera): void {
    if (!this.collecting) { this.viewerCount = 0; this.collecting = true; } // the first draw since the last flush: forget last frame's cameras
    let v = this.viewers[this.viewerCount];
    if (!v) v = this.viewers[this.viewerCount] = new THREE.Vector3();
    v.setFromMatrixPosition(camera.matrixWorld);
    for (let i = 0; i < this.viewerCount; i++) if (this.viewers[i].distanceToSquared(v) < 0.25) return; // the same place again (a second pass of the same camera)
    if (this.viewerCount < 6) this.viewerCount++;
  }

  /** the state of one person as the shaders read it: action (-1 free), phase, handle (the row of the style and pose textures) */
  motionOf(h: number): [number, number, number, number] {
    const a = this.far.attributes.motion;
    return [a.getX(h), a.getY(h), a.getZ(h), a.getW(h)];
  }

  /**
   * The near figure has 3.7 times the far one's triangles and every instance of a batch goes through the vertex stage, drawn or not, so
   * it is given only the people who are near: those within the switch range (plus a tenth, so a person the shader still draws far
   * cannot fall between the two) of a camera the figure was drawn from since the last flush, or of `viewers` when the caller knows
   * better. Before anything has been drawn everybody is on it (the shader still picks by distance).
   */
  private fillNear(viewers?: readonly THREE.Vector3[]): void {
    const src = this.far.mesh.instanceMatrix.array as Float32Array, dst = this.near.mesh.instanceMatrix.array as Float32Array;
    const ms = this.far.attributes.motion.array as Float32Array, md = this.near.attributes.motion.array as Float32Array;
    const list = viewers ?? this.viewers, n = viewers ? viewers.length : this.viewerCount;
    const r2 = (this.lodDistance * 1.1) * (this.lodDistance * 1.1);
    let k = 0;
    for (let h = 0; h < this.used; h++) {
      if (this.placed[h] === 0 || this.alive[h] === 0) continue;
      let near = n === 0;
      for (let i = 0; i < n && !near; i++) {
        const v = list[i], dx = src[h * 16 + 12] - v.x, dy = src[h * 16 + 13] - v.y, dz = src[h * 16 + 14] - v.z;
        near = dx * dx + dy * dy + dz * dz <= r2;
      }
      if (!near) continue;
      for (let c = 0; c < 16; c++) dst[k * 16 + c] = src[h * 16 + c];
      md[k * 4] = ms[h * 4]; md[k * 4 + 1] = ms[h * 4 + 1]; md[k * 4 + 2] = ms[h * 4 + 2]; md[k * 4 + 3] = ms[h * 4 + 3];
      k++;
    }
    this.near.mesh.count = k;
    if (k > 0) { markRange(this.near.mesh.instanceMatrix, 0, k - 1); markRange(this.near.attributes.motion, 0, k - 1); }
    if (viewers === undefined) this.collecting = false; // (the cameras stay until the next draw brings new ones, so a second flush in a frame sees them too)
  }

  flush(viewers?: readonly THREE.Vector3[]): void {
    const changed = this.styleDirtyMax >= this.styleDirtyMin || this.motionDirtyMax >= this.motionDirtyMin;
    if (this.matrixDirtyMax >= this.matrixDirtyMin) markRange(this.far.mesh.instanceMatrix, this.matrixDirtyMin, this.matrixDirtyMax);
    if (this.styleDirtyMax >= this.styleDirtyMin) this.style.upload();
    if (this.motionDirtyMax >= this.motionDirtyMin) markRange(this.far.attributes.motion, this.motionDirtyMin, this.motionDirtyMax);
    this.fillNear(viewers);
    this.matrixDirtyMin = this.styleDirtyMin = this.motionDirtyMin = this.max;
    this.matrixDirtyMax = this.styleDirtyMax = this.motionDirtyMax = -1;
    // the poses, for everybody who is in use, once per frame and only when something about a person changed
    if (this.poseOn && this.gl && this.used > 0 && (changed || this.poseStale)) { this.pose.update(this.gl, this.used); this.poseStale = false; }
  }

  pick(ray: THREE.Raycaster): number | null {
    this.hits.length = 0;
    // (an InstancedMesh caches the sphere round all its instances the first time it is tested: people walk, so start afresh)
    this.pickMesh.boundingSphere = null;
    ray.intersectObject(this.pickMesh, false, this.hits);
    for (let i = 0; i < this.hits.length; i++) {
      const id = this.hits[i].instanceId;
      if (id !== undefined && this.alive[id] !== 0) return id;
    }
    return null;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.near.mesh.geometry.dispose(); this.far.mesh.geometry.dispose();
    this.far.depth?.dispose();
    this.pickMesh.geometry.dispose(); (this.pickMesh.material as THREE.Material).dispose();
    this.near.material.dispose(); this.far.material.dispose(); this.faceAtlas.dispose(); this.pose.dispose(); this.style.dispose();
  }
}
