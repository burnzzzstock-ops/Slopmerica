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

/** What a quality preset decides about how many people are drawn and how richly (the field names are the ones of `Quality` in config.ts). */
export interface PeopleDetail {
  /** metres from a camera within which a person is drawn as the near figure (3117 triangles held, 768 shown); beyond it the far figure (497 held, 210 shown) */
  peopleNear?: number;
  /** at most this many near figures at a time, the ones nearest a camera; the rest of the crowd in range is drawn as the far figure */
  peopleNearMax?: number;
  /** metres from a camera within which a person casts a shadow (when in the view, or out of it by no more than a shadow's reach: 24 m) */
  peopleShadow?: number;
}

/** beyond this a person is not drawn at all (the shaders used to test it) */
const FAR_DISTANCE = 1500;
/** a person's bounding sphere for the view test: centred 1 m up, 1.7 m round (a sign over the head, an arm out) */
const BODY_CENTER = 1.0, BODY_RADIUS = 1.7;
/** how far a shadow can reach from the person who casts it: the sun is never lower than 0.08 (sky.ts keeps the light's y above that), so 1.8 m of height throw 22 m, plus a prop */
const SHADOW_REACH = 24;
/** the view test uses the camera as it is when the lists are made (just before the frame is drawn), its frustum widened by this share of its tangent: a margin for the mirror camera, which is only placed when its own pass runs */
const FRUSTUM_WIDEN = 1 / 1.15;
const MAX_VIEWERS = 6;

type Batch = { mesh: THREE.InstancedMesh; attributes: PersonInstanceAttributes; material: PersonMaterialControl; depth?: THREE.MeshDepthMaterial };
type Viewer = { pos: THREE.Vector3; fwd: THREE.Vector3; frustum: THREE.Frustum; culls: boolean; camera: THREE.Camera | null };
const REUSABLE_UPDATE_RANGES = new WeakMap<THREE.BufferAttribute, { start: number; count: number }>();
const _m = new THREE.Matrix4(), _p = new THREE.Matrix4();

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

/**
 * Shared renderer of the citizens. PeopleRenderer in people.ts supplies the catalog.
 *
 * Who is drawn is decided here, on the CPU, once a frame (see `flush`), and each draw is given only its own people:
 *   near     people within `peopleNear` of a camera (at most `peopleNearMax`, the nearest) that are inside its frustum: the near figure
 *   far      the other people inside a frustum: the far figure
 *   shadow   everybody within `peopleShadow` of a camera who is in its frustum or out of it by no more than a shadow's reach (and every
 *            near figure): the far figure again, in the sun's shadow map only (a mesh of its own that draws nothing in a view, so the lists
 *            can differ)
 * The poses of all of them are worked out in one pose pass (personPose.ts). The master arrays (one slot per handle, written by `set`) are
 * what the lists are copied from.
 */
export class PeopleRendererCore {
  readonly object = new THREE.Group();
  readonly stats: Readonly<{ nearTriangles: number; farTriangles: number; drawCalls: number }>;

  private readonly near: Batch;
  private readonly far: Batch;
  private readonly shadow: Batch;
  /** invisible stand-in the pointer is tested against: a column round each person (the drawn body is posed in the shader, so the rest-pose mesh is no guide) */
  private readonly pickMesh: THREE.InstancedMesh;
  private readonly alive: Uint8Array;
  private readonly archetypeIndex: Uint8Array;
  private readonly cadence: Float32Array;
  /** set once a person has been placed (before that the slot is hidden) */
  private readonly placed: Uint8Array;
  /** the master arrays, one slot per handle: the matrix and the motion (action, phase, handle) `set` was given */
  private readonly matrices: Float32Array;
  private readonly motion: Float32Array;
  /** the pose row of a person is worked out (valid) and still matches what `set` gave (not dirty) */
  private readonly poseValid: Uint8Array;
  private readonly poseDirty: Uint8Array;
  /** drawn as the near figure at the last flush (so the person at the edge of the range does not flicker between the figures) */
  private readonly wasNear: Uint8Array;
  private readonly poseMotion: THREE.InstancedBufferAttribute;
  /** scratch for the lists */
  private readonly nearH: Int32Array;
  private readonly nearKey: Float32Array;
  private readonly farH: Int32Array;
  private readonly castH: Int32Array;
  private listN = { near: 0, far: 0, cast: 0 };
  private readonly inFar: Uint8Array;
  private readonly inNear: Uint8Array;
  private readonly free: number[] = [];
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly matrix = new THREE.Matrix4();
  private readonly hits: THREE.Intersection[] = [];
  private used = 0;
  private styleDirtyMin: number;
  private styleDirtyMax = -1;
  private readonly faceAtlas: THREE.CanvasTexture;
  private readonly style: PersonStyle;
  private readonly pose: PersonPosePass;
  /** the renderer the figure is drawn with (found the first time it draws, or given to bindRenderer) and whether it can run the pose pass */
  private gl: THREE.WebGLRenderer | null = null;
  private poseOn = false;
  /** where the figure was drawn from since the last flush (the main camera, the water's mirror camera ...): the lists are made from them */
  private viewers: Viewer[] = [];
  private viewerCount = 0;
  private viewerOverflow = false;
  private collecting = false;
  private active: Viewer[] = [];
  private detail = { near: 64, nearMax: Infinity, shadow: Infinity };
  private shadowCount = 0;
  private poseCount = 0;
  private readonly sphere = new THREE.Sphere();

  constructor(scene: THREE.Scene, private readonly max: number, private readonly archetypes: readonly Archetype[]) {
    this.alive = new Uint8Array(max);
    this.archetypeIndex = new Uint8Array(max);
    this.cadence = new Float32Array(max).fill(1);
    this.placed = new Uint8Array(max);
    this.matrices = new Float32Array(max * 16);
    this.motion = new Float32Array(max * 4);
    this.poseValid = new Uint8Array(max);
    this.poseDirty = new Uint8Array(max);
    this.wasNear = new Uint8Array(max);
    this.nearH = new Int32Array(max); this.nearKey = new Float32Array(max); this.farH = new Int32Array(max); this.castH = new Int32Array(max);
    this.inFar = new Uint8Array(max); this.inNear = new Uint8Array(max);
    this.styleDirtyMin = max;
    this.faceAtlas = buildFaceAtlas();
    this.style = new PersonStyle(max);
    this.pose = new PersonPosePass(max, this.style.texture);

    const nearGeometry = buildPersonGeometry(false);
    const farGeometry = buildPersonGeometry(true);
    const shadowGeometry = farGeometry.clone(); // (its own instance attributes; the rest-pose arrays are copies)
    this.near = this.makeBatch(nearGeometry, 'near');
    this.far = this.makeBatch(farGeometry, 'far');
    this.shadow = this.makeBatch(shadowGeometry, 'shadow', this.far.material);
    this.poseMotion = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.pose.connect(this.poseMotion);
    const column = new THREE.CylinderGeometry(0.28, 0.28, 1.85, 8, 1);
    column.translate(0, 0.925, 0);
    this.pickMesh = new THREE.InstancedMesh(column, new THREE.MeshBasicMaterial(), max);
    this.pickMesh.instanceMatrix = new THREE.InstancedBufferAttribute(this.matrices, 16); // the master matrices (never drawn: nothing to upload)
    this.pickMesh.count = 0;
    this.stats = Object.freeze({ nearTriangles: geometryTriangles(nearGeometry), farTriangles: geometryTriangles(farGeometry), drawCalls: 3 });
    this.object.name = 'people-aa';
    this.object.add(this.near.mesh, this.far.mesh, this.shadow.mesh);
    scene.add(this.object);
  }

  private makeBatch(geometry: THREE.BufferGeometry, role: 'near' | 'far' | 'shadow', shared?: PersonMaterialControl): Batch {
    const attributes = attachPersonInstanceAttributes(geometry, this.max);
    const material = shared ?? createPersonMaterial(this.faceAtlas, this.pose.uniforms);
    const mesh = new THREE.InstancedMesh(geometry, material.material, this.max);
    mesh.name = `people-${role}`;
    // draw only the people on the list: drawing every slot (hidden ones included, in the shadow pass too) cost ~2M triangles a frame
    // on Ultra in a town of zero people
    mesh.count = 0;
    mesh.frustumCulled = false;
    // the shadow is cast by the far figure, for everybody on the shadow list: a third of the near figure's triangles would go through the
    // shadow pass, and nobody reads the detail of a shadow (the near figure is only drawn once, in the view)
    mesh.castShadow = role === 'shadow';
    mesh.receiveShadow = role !== 'shadow';
    const depth = role === 'shadow' ? createPersonDepthMaterial(this.pose.uniforms) : undefined;
    if (depth) mesh.customDepthMaterial = depth;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // the first draw tells us the renderer, which the pose pass needs (and it allocates the pose textures before they are sampled)
    if (role === 'shadow') {
      // this mesh is only there for the sun's shadow map: in a view it draws nothing (zero instances are not drawn at all)
      mesh.onBeforeRender = (r) => { this.bindRenderer(r); mesh.count = 0; };
      mesh.onBeforeShadow = (r) => { this.bindRenderer(r); mesh.count = this.shadowCount; };
    } else {
      mesh.onBeforeRender = (r, _scene, camera) => { this.bindRenderer(r); this.seenFrom(camera); };
    }
    return { mesh, attributes, material, depth };
  }

  private dirtyStyle(h: number): void { this.styleDirtyMin = Math.min(this.styleDirtyMin, h); this.styleDirtyMax = Math.max(this.styleDirtyMax, h); }

  add(archetype: number, seed: number): number {
    const h = this.free.length ? this.free.pop()! : this.used < this.max ? this.used++ : -1;
    if (h < 0 || this.archetypes.length === 0) return -1;
    if (this.pickMesh.count < this.used) this.pickMesh.count = this.used;
    const ai = ((archetype % this.archetypes.length) + this.archetypes.length) % this.archetypes.length;
    const a = this.archetypes[ai];
    this.alive[h] = 1; this.archetypeIndex[h] = ai;
    const look = resolveLook(a, seed, FACE_ID[a.face ?? 'plain'], propId);
    this.cadence[h] = look.cadence;
    this.style.write(h, look);
    this.motion.set([ACTION_ID.idle, 0, h, 0], h * 4);
    this.matrices.set(this.hidden.elements, h * 16);
    this.placed[h] = 0;
    this.poseDirty[h] = 1;
    this.dirtyStyle(h);
    return h;
  }

  remove(h: number): void {
    if (h < 0 || h >= this.max || this.alive[h] === 0) return;
    this.alive[h] = 0;
    this.matrices.set(this.hidden.elements, h * 16);
    this.motion.set([-1, 0, h, 0], h * 4); // action -1: a free slot, skipped by both shaders
    this.placed[h] = 0;
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
    this.matrices.set(this.matrix.elements, h * 16);
    const o = h * 4, a = ACTION_ID[action];
    if (this.motion[o] !== a || this.motion[o + 1] !== t) this.poseDirty[h] = 1; // (the pose reads nothing else)
    this.motion[o] = a; this.motion[o + 1] = t; this.motion[o + 2] = h; this.motion[o + 3] = 0;
    this.placed[h] = 1;
  }

  /** Optional: hand over the renderer before the first frame (the figure finds it itself when it first draws). */
  bindRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.gl === renderer) return;
    this.gl = renderer;
    this.poseOn = poseSupported(renderer);
    if (this.poseOn) this.pose.init(renderer);
    this.poseValid.fill(0);
  }

  setNight(n: number): void {
    this.near.material.setNight(n); this.far.material.setNight(n);
  }

  /** The preset's choices (the fields of `Quality` in config.ts); what is left out keeps its value (the default is High: 64 m, no cap, every shadow). */
  setDetail(d: PeopleDetail): void {
    if (d.peopleNear !== undefined) this.detail.near = d.peopleNear;
    if (d.peopleNearMax !== undefined) this.detail.nearMax = d.peopleNearMax;
    if (d.peopleShadow !== undefined) this.detail.shadow = d.peopleShadow;
  }

  /** kept for callers of the old API: only the switch distance */
  updateLod(_camera: THREE.Camera, quality: 'low' | 'medium' | 'high' | number = 'high'): void {
    this.detail.near = typeof quality === 'number' ? quality : quality === 'low' ? 48 : quality === 'medium' ? 58 : 66;
  }

  /** remember a camera the figure is being drawn from (see flush) */
  private seenFrom(camera: THREE.Camera): void {
    if (!this.collecting) { this.viewerCount = 0; this.viewerOverflow = false; this.collecting = true; } // the first draw since the last flush: forget last frame's cameras
    const e = camera.matrixWorld.elements;
    for (let i = 0; i < this.viewerCount; i++) {
      const v = this.viewers[i], dx = v.pos.x - e[12], dy = v.pos.y - e[13], dz = v.pos.z - e[14];
      if (dx * dx + dy * dy + dz * dz < 0.25 && v.fwd.x * -e[8] + v.fwd.y * -e[9] + v.fwd.z * -e[10] > 0.9995) return; // the same view again (a second pass of the same camera)
    }
    if (this.viewerCount >= MAX_VIEWERS) { this.viewerOverflow = true; return; }
    let v = this.viewers[this.viewerCount];
    if (!v) v = this.viewers[this.viewerCount] = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), frustum: new THREE.Frustum(), culls: false, camera: null };
    this.setViewer(v, camera);
    this.viewerCount++;
  }

  private setViewer(v: Viewer, camera: THREE.Camera): void {
    v.camera = camera;
    const e = camera.matrixWorld.elements;
    v.pos.set(e[12], e[13], e[14]); v.fwd.set(-e[8], -e[9], -e[10]);
    v.culls = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    if (v.culls) {
      _p.copy(camera.projectionMatrix);
      _p.elements[0] *= FRUSTUM_WIDEN; _p.elements[5] *= FRUSTUM_WIDEN; // wider tangent: the planes of the sides move out
      v.frustum.setFromProjectionMatrix(_m.multiplyMatrices(_p, camera.matrixWorldInverse));
    }
  }

  /** the motion of one person as the shaders read it: action (-1 free), phase, handle (the row of the style and pose textures) */
  motionOf(h: number): [number, number, number, number] {
    const o = h * 4;
    return [this.motion[o], this.motion[o + 1], this.motion[o + 2], this.motion[o + 3]];
  }

  /** how many people each draw holds right now */
  listCounts(): { near: number; far: number; shadow: number; pose: number; used: number } {
    return { near: this.near.mesh.count, far: this.far.mesh.count, shadow: this.shadowCount, pose: this.poseCount, used: this.used };
  }

  /** who is on each list right now, by handle (for tests) */
  listHandles(): { near: number[]; far: number[]; shadow: number[] } {
    const a = (arr: Int32Array, n: number) => Array.from(arr.subarray(0, n));
    return { near: a(this.nearH, this.listN.near), far: a(this.farH, this.listN.far), shadow: this.shadowCount ? a(this.castH, this.listN.cast) : [] };
  }

  /** the viewers the lists are made from: the cameras given, else the ones the figure was drawn from since the last flush */
  private gatherViewers(given?: readonly (THREE.Vector3 | THREE.Camera)[]): number {
    if (!given) {
      // the cameras the figure was drawn from, as they are now (the game moves its camera before the people are updated and the camera's
      // matrices are only brought up to date by the render that follows)
      for (let i = 0; i < this.viewerCount; i++) {
        const c = this.viewers[i].camera;
        if (c) { if (c.parent === null && c.matrixWorldAutoUpdate) c.updateMatrixWorld(); this.setViewer(this.viewers[i], c); }
      }
      this.active = this.viewers;
      return this.viewerCount;
    }
    const out: Viewer[] = [];
    for (let i = 0; i < given.length; i++) {
      const g = given[i];
      const v: Viewer = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), frustum: new THREE.Frustum(), culls: false, camera: null };
      if ((g as THREE.Camera).isCamera) this.setViewer(v, g as THREE.Camera); else v.pos.copy(g as THREE.Vector3);
      out.push(v);
    }
    this.active = out;
    return out.length;
  }

  /**
   * Make the lists. Every instance of a draw goes through the vertex stage, drawn or not, and the near figure holds 3.7 times the far
   * one's triangles, so each draw is given only the people it shows: see the class comment. Before anything has been drawn (no camera
   * known) everybody is in range and in view, and in the shadow map.
   */
  private fillLists(given?: readonly (THREE.Vector3 | THREE.Camera)[]): void {
    const n = this.gatherViewers(given), vs = this.active;
    const open = n === 0 || (!given && this.viewerOverflow); // no camera known (or too many to test): nobody is culled
    const d = this.detail, mat = this.matrices, mo = this.motion;
    const nearR2 = d.near * d.near, stickyR2 = nearR2 * 1.21, farR2 = FAR_DISTANCE * FAR_DISTANCE;
    const shR = Math.max(d.shadow, d.near * 1.1), shR2 = shR * shR;
    const shadowsOn = !this.gl || this.gl.shadowMap.enabled;
    const sp = this.sphere;
    const nearH = this.nearH, nearKey = this.nearKey, farH = this.farH, castH = this.castH, inFar = this.inFar, inNear = this.inNear;
    let nc = 0, nf = 0, ncast = 0;
    inFar.fill(0, 0, this.used); inNear.fill(0, 0, this.used);
    for (let h = 0; h < this.used; h++) {
      if (this.placed[h] === 0 || this.alive[h] === 0) { this.wasNear[h] = 0; continue; }
      const cx = mat[h * 16 + 12], cy = mat[h * 16 + 13] + BODY_CENTER, cz = mat[h * 16 + 14];
      let dCast = open ? 0 : Infinity, dSeen = open ? 0 : Infinity;
      if (!open) {
        sp.center.set(cx, cy, cz);
        for (let i = 0; i < n; i++) {
          const v = vs[i], dx = cx - v.pos.x, dy = cy - v.pos.y, dz = cz - v.pos.z, d2 = dx * dx + dy * dy + dz * dz;
          const canCast = d2 < dCast, canSee = d2 < dSeen;
          if (!canCast && !canSee) continue;
          if (!v.culls) { if (canSee) dSeen = d2; if (canCast) dCast = d2; continue; } // (a position only: no frustum to test)
          sp.radius = BODY_RADIUS + SHADOW_REACH; // (the shadow of somebody just out of the view can fall into it)
          if (!v.frustum.intersectsSphere(sp)) continue;
          if (canCast) dCast = d2;
          if (canSee) { sp.radius = BODY_RADIUS; if (v.frustum.intersectsSphere(sp)) dSeen = d2; }
        }
      }
      if (dSeen < farR2) {
        if (dSeen <= (this.wasNear[h] ? stickyR2 : nearR2)) { nearH[nc] = h; nearKey[nc] = this.wasNear[h] ? dSeen * 0.81 : dSeen; nc++; }
        else { farH[nf++] = h; inFar[h] = 1; }
      }
      if (dCast <= shR2) castH[ncast++] = h;
    }
    // too many in range: the nearest keep the near figure, the others are the far one
    if (nc > d.nearMax) {
      const order = Array.from({ length: nc }, (_, i) => i).sort((a, b) => nearKey[a] - nearKey[b]);
      const keep = new Uint8Array(nc);
      for (let i = 0; i < d.nearMax; i++) keep[order[i]] = 1;
      let w = 0;
      for (let i = 0; i < nc; i++) {
        if (keep[i]) nearH[w++] = nearH[i]; else { farH[nf++] = nearH[i]; inFar[nearH[i]] = 1; }
      }
      nc = w;
    }
    this.wasNear.fill(0, 0, this.used);
    for (let i = 0; i < nc; i++) { this.wasNear[nearH[i]] = 1; inNear[nearH[i]] = 1; }

    // copy the people of each list from the master arrays, in list order
    const nm = this.near.mesh.instanceMatrix.array as Float32Array, no = this.near.attributes.motion.array as Float32Array;
    for (let i = 0; i < nc; i++) { const h = nearH[i]; nm.set(mat.subarray(h * 16, h * 16 + 16), i * 16); no.set(mo.subarray(h * 4, h * 4 + 4), i * 4); }
    this.near.mesh.count = nc;
    const fm = this.far.mesh.instanceMatrix.array as Float32Array, fo = this.far.attributes.motion.array as Float32Array;
    for (let i = 0; i < nf; i++) { const h = farH[i]; fm.set(mat.subarray(h * 16, h * 16 + 16), i * 16); fo.set(mo.subarray(h * 4, h * 4 + 4), i * 4); }
    this.far.mesh.count = nf;
    // (without a shadow map the shadow list is empty: only the people on the other two lists need a pose)
    const sm = this.shadow.mesh.instanceMatrix.array as Float32Array, so = this.shadow.attributes.motion.array as Float32Array;
    let ns = 0;
    if (shadowsOn) for (let i = 0; i < ncast; i++) { const h = castH[i]; sm.set(mat.subarray(h * 16, h * 16 + 16), ns * 16); so.set(mo.subarray(h * 4, h * 4 + 4), ns * 4); ns++; }
    this.shadowCount = ns;
    // the pose rows: everybody on any list (the handle is in the motion)
    const pm = this.poseMotion.array as Float32Array;
    let np = 0;
    for (let i = 0; i < nf; i++) { pm.set(mo.subarray(farH[i] * 4, farH[i] * 4 + 4), np * 4); np++; }
    for (let i = 0; i < nc; i++) { pm.set(mo.subarray(nearH[i] * 4, nearH[i] * 4 + 4), np * 4); np++; }
    if (shadowsOn) for (let i = 0; i < ncast; i++) { const h = castH[i]; if (inFar[h] === 0 && inNear[h] === 0) { pm.set(mo.subarray(h * 4, h * 4 + 4), np * 4); np++; } }
    this.poseCount = np;
    this.listN.near = nc; this.listN.far = nf; this.listN.cast = ncast;
    if (nc > 0) { markRange(this.near.mesh.instanceMatrix, 0, nc - 1); markRange(this.near.attributes.motion, 0, nc - 1); }
    if (nf > 0) { markRange(this.far.mesh.instanceMatrix, 0, nf - 1); markRange(this.far.attributes.motion, 0, nf - 1); }
    if (ns > 0) { markRange(this.shadow.mesh.instanceMatrix, 0, ns - 1); markRange(this.shadow.attributes.motion, 0, ns - 1); }
    if (np > 0) markRange(this.poseMotion, 0, np - 1);
  }

  /**
   * Once a frame, after the people were `set` and before the frame is drawn: make the draw lists and work out the poses of everybody on
   * them. `viewers` are the cameras (or just positions: then nobody is culled by view) to make the lists for, when the caller knows
   * better than the cameras the figure was last drawn from.
   */
  flush(viewers?: readonly (THREE.Vector3 | THREE.Camera)[]): void {
    if (this.styleDirtyMax >= this.styleDirtyMin) this.style.upload();
    this.styleDirtyMin = this.max; this.styleDirtyMax = -1;
    this.fillLists(viewers);
    if (!viewers) this.collecting = false; // (the cameras stay until the next draw brings new ones, so a second flush in a frame sees them too)
    // the poses, for everybody on a list, once per frame and only when somebody's pose is not what `set` last gave (a person who was off
    // every list has a row that is out of date)
    if (this.poseOn && this.gl && this.poseCount > 0) {
      const pm = this.poseMotion.array as Float32Array;
      let need = false;
      for (let i = 0; i < this.poseCount && !need; i++) { const h = pm[i * 4 + 2]; need = this.poseDirty[h] !== 0 || this.poseValid[h] === 0; }
      if (need) this.pose.update(this.gl, this.poseCount);
      this.poseValid.fill(0, 0, this.used);
      for (let i = 0; i < this.poseCount; i++) { const h = pm[i * 4 + 2]; if (need) this.poseDirty[h] = 0; this.poseValid[h] = 1; }
    }
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
    this.near.mesh.geometry.dispose(); this.far.mesh.geometry.dispose(); this.shadow.mesh.geometry.dispose();
    this.shadow.depth?.dispose();
    this.pickMesh.geometry.dispose(); (this.pickMesh.material as THREE.Material).dispose();
    this.near.material.dispose(); this.far.material.dispose(); this.faceAtlas.dispose(); this.pose.dispose(); this.style.dispose();
  }
}
