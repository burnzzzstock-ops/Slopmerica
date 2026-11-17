import * as THREE from 'three';
import type { VehicleKind } from '../contracts';
import type { Car } from './traffic';

/** A drawing candidate. Handles remain owned by traffic/parking; slot is only a presentation slot. */
export interface VehicleCandidate {
  key: number; car?: Car; handle: number; kind: VehicleKind;
  selected: boolean; slot: number; seen: number; score: number; drawnFrame: number;
}

/** Camera ranking has its own clock and no simulation writes or random draws. */
export class VehiclePresentation {
  readonly selected: VehicleCandidate[] = [];
  private readonly records = new Map<number, VehicleCandidate>();
  private readonly candidates: VehicleCandidate[] = [];
  private readonly counts = new Map<VehicleKind, number>();
  private readonly point = new THREE.Vector3();
  private readonly previousCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly previousDirection = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private camera!: THREE.Camera;
  private generation = 0;
  private elapsed = 1;
  private cull2 = Infinity;
  scans = 0;

  constructor(readonly capacity: number, readonly perKind: number) {}

  begin(camera: THREE.Camera, dt: number, cull: number): boolean {
    this.elapsed += dt;
    camera.getWorldDirection(this.direction);
    const moved = this.previousCamera.distanceToSquared(camera.position) > 900;
    const turned = this.previousDirection.dot(this.direction) < 0.985;
    if (this.elapsed < 0.5 && !moved && !turned) return false;
    this.elapsed = 0; this.scans++; this.generation++;
    this.camera = camera; this.cull2 = cull * cull;
    this.previousCamera.copy(camera.position); this.previousDirection.copy(this.direction);
    this.candidates.length = 0;
    return true;
  }

  offer(handle: number, kind: VehicleKind, x: number, y: number, z: number, car?: Car): void {
    if (!Number.isFinite(x + y + z)) return;
    const key = car ? car.id : -handle - 1;
    let record = this.records.get(key);
    // Loading a save can reuse an ID with a new object. Retire the old presentation record.
    if (record && (record.car !== car || record.kind !== kind)) { record.selected = false; record = undefined; }
    if (!record) {
      record = { key, car, handle, kind, selected: false, slot: -1, seen: 0, score: 0, drawnFrame: -1 };
      this.records.set(key, record);
    }
    record.handle = handle; record.seen = this.generation;
    const distance2 = this.point.set(x, y, z).distanceToSquared(this.camera.position);
    if (distance2 > this.cull2) { record.selected = false; return; }
    this.point.project(this.camera);
    // A margin keeps cars just outside the image ready to enter. Inside that margin, nearer cars win.
    const inView = this.point.z >= -1 && this.point.z <= 1 && Math.abs(this.point.x) < 1.25 && Math.abs(this.point.y) < 1.25;
    record.score = distance2 * (record.selected ? 0.85 : 1) + (inView ? 0 : 1e9);
    this.candidates.push(record);
  }

  finish(): void {
    for (const record of this.selected) record.selected = false;
    this.selected.length = 0; this.counts.clear();
    this.candidates.sort((a, b) => a.score - b.score || a.key - b.key);
    for (const record of this.candidates) {
      if (this.selected.length >= this.capacity) break;
      const count = this.counts.get(record.kind) ?? 0;
      if (count >= this.perKind) continue;
      this.counts.set(record.kind, count + 1);
      record.selected = true; this.selected.push(record);
    }
    // Bound the cache by the currently observed population, not the number of trips ever made.
    for (const [key, record] of this.records) if (record.seen !== this.generation) {
      record.selected = false; this.records.delete(key);
    }
  }
}
