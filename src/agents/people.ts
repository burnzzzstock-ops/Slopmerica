// STUB — owned by the Atmosphere & People workstream (replace wholesale).
import * as THREE from 'three';
import type { PersonAction } from '../contracts';

export interface Archetype {
  id: string;
  name: string; // "Florida Man", "Crypto Bro", ...
  handle: string; // feed handle base, without @
  bio: string; // one-liner shown in the info panel
  lean: 'left' | 'right' | 'center' | 'chaos';
  vices: PersonAction[]; // what they do when idle: smoke / drink / vape / phone ...
  hippie?: boolean; // commune residents
  merch?: boolean; // wears Slop gear
}

export const ARCHETYPES: Archetype[] = [
  { id: 'floridaMan', name: 'Florida Man', handle: 'FloridaMan', bio: 'Arrested 14 times. Beloved by all.', lean: 'chaos', vices: ['drink', 'smoke'] },
  { id: 'cryptoBro', name: 'Crypto Bro', handle: 'HODL4Life', bio: 'Down 94%. Still early.', lean: 'center', vices: ['vape', 'phone'] },
  { id: 'hippie', name: 'Commune Hippie', handle: 'SunflowerVibes', bio: 'Has not worn shoes since 2011.', lean: 'left', vices: ['smoke', 'drum'], hippie: true },
];

export class PeopleRenderer {
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private free: number[] = [];
  private used = 0;
  private m = new THREE.Matrix4();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene, private max: number) {
    const g = new THREE.CapsuleGeometry(0.3, 1.1, 4, 8);
    g.translate(0, 0.85, 0);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xdddddd }), max);
    this.mesh.count = max;
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.hidden);
    this.object.add(this.mesh);
    scene.add(this.object);
  }

  add(archetype: number, seed: number): number {
    const h = this.free.length ? this.free.pop()! : this.used < this.max ? this.used++ : -1;
    if (h >= 0) this.mesh.setColorAt(h, new THREE.Color().setHSL((seed % 100) / 100, 0.6, 0.55));
    return h;
  }
  remove(h: number) {
    if (h < 0) return;
    this.mesh.setMatrixAt(h, this.hidden);
    this.free.push(h);
  }
  set(h: number, x: number, y: number, z: number, yaw: number, action: PersonAction, phase: number) {
    if (h < 0) return;
    this.m.makeRotationY(yaw).setPosition(x, y, z);
    this.mesh.setMatrixAt(h, this.m);
  }
  setNight(n: number) {}
  flush() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  pick(ray: THREE.Raycaster): number | null {
    const hit = ray.intersectObject(this.mesh, false)[0];
    return hit?.instanceId ?? null;
  }
}
