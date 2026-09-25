// STUB — owned by the Atmosphere & People workstream (replace wholesale).
import type * as THREE from 'three';
import type { Quality } from '../config';
import type { ParticleKind } from '../contracts';

export interface EmitOpts {
  count?: number;
  spread?: number; // meters
  vel?: [number, number, number];
  size?: number;
  life?: number; // seconds
}

export class Particles {
  constructor(scene: THREE.Scene, q: Quality) {}
  emit(kind: ParticleKind, x: number, y: number, z: number, opts: EmitOpts = {}) {}
  update(dt: number, camera: THREE.Camera) {}
}
