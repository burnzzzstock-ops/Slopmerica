// STUB — owned by the Buildings, Vehicles, Brands & Feed workstream (replace wholesale).
import * as THREE from 'three';
import type { VehicleKind } from '../contracts';

export interface VehicleSpec {
  length: number; // meters
  width: number;
  height: number;
  maxSpeed: number; // m/s
  label: string;
}

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
};

const KINDS = Object.keys(VEHICLE_SPECS) as VehicleKind[];

/** Traffic mix for normal civilian trips. */
export function randomVehicleKind(rnd: () => number): VehicleKind {
  const r = rnd();
  if (r < 0.28) return 'pickup';
  if (r < 0.46) return 'sedan';
  if (r < 0.62) return 'suv';
  if (r < 0.7) return 'liftedTruck';
  if (r < 0.78) return 'minivan';
  if (r < 0.84) return 'hatchback';
  if (r < 0.88) return 'cyberslop';
  if (r < 0.92) return 'boxTruck';
  if (r < 0.95) return 'semi';
  if (r < 0.97) return 'motorcycle';
  return 'slopVan';
}

export class VehicleRenderer {
  readonly object = new THREE.Group();
  private meshes = new Map<VehicleKind, THREE.InstancedMesh>();
  private slots: { kind: VehicleKind; i: number }[] = [];
  private free = new Map<VehicleKind, number[]>();
  private used = new Map<VehicleKind, number>();
  private freeHandles: number[] = [];
  private m = new THREE.Matrix4();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private perKind: number;

  constructor(scene: THREE.Scene, maxTotal: number) {
    this.perKind = Math.max(16, Math.ceil(maxTotal / 3));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });
    for (const k of KINDS) {
      const s = VEHICLE_SPECS[k];
      const g = new THREE.BoxGeometry(s.width, s.height, s.length);
      g.translate(0, s.height / 2 + 0.2, 0);
      const im = new THREE.InstancedMesh(g, mat, this.perKind);
      for (let i = 0; i < this.perKind; i++) im.setMatrixAt(i, this.hidden);
      im.castShadow = true;
      this.meshes.set(k, im);
      this.free.set(k, []);
      this.used.set(k, 0);
      this.object.add(im);
    }
    scene.add(this.object);
  }

  /** Returns a handle, or -1 if the pool for that kind is full. Model faces +Z. */
  add(kind: VehicleKind, color: number): number {
    const fr = this.free.get(kind)!;
    let i = fr.length ? fr.pop()! : this.used.get(kind)!;
    if (!fr.length && i === this.used.get(kind)) {
      if (i >= this.perKind) return -1;
      this.used.set(kind, i + 1);
    }
    this.meshes.get(kind)!.setColorAt(i, new THREE.Color(color));
    const h = this.freeHandles.length ? this.freeHandles.pop()! : this.slots.length;
    this.slots[h] = { kind, i };
    return h;
  }
  remove(h: number) {
    const s = this.slots[h];
    if (!s) return;
    this.meshes.get(s.kind)!.setMatrixAt(s.i, this.hidden);
    this.free.get(s.kind)!.push(s.i);
    this.freeHandles.push(h);
    delete this.slots[h];
  }
  /** yaw: rotation about +Y (0 = facing +Z). pitch/roll for hills and crashes. */
  set(h: number, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0) {
    const s = this.slots[h];
    if (!s) return;
    this.e.set(pitch, yaw, roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m.makeRotationFromQuaternion(this.q).setPosition(x, y, z);
    this.meshes.get(s.kind)!.setMatrixAt(s.i, this.m);
  }
  setBraking(h: number, on: boolean) {}
  setNight(n: number) {}
  flush() {
    for (const im of this.meshes.values()) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
  pick(ray: THREE.Raycaster): number | null {
    for (const [kind, im] of this.meshes) {
      const hit = ray.intersectObject(im, false)[0];
      if (hit && hit.instanceId !== undefined) {
        const h = this.slots.findIndex((s) => s && s.kind === kind && s.i === hit.instanceId);
        if (h >= 0) return h;
      }
    }
    return null;
  }
}
