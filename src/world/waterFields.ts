// Read-only water presentation: real river paths and versioned pollution fields.
import * as THREE from 'three';
import { HALF, WORLD } from '../config';
import type { WorldFields, ScalarField } from '../contracts';
import type { Terrain } from './terrain';

export const WATER_POLLUTION_RANGE = 4;
export const RIVER_FIRE_THRESHOLD = 2.6;
const FLOW_N = 256;

/** RG = downstream tangent, B = bounded surface relief, A = river influence. */
export function riverFlowTexture(terrain: Terrain): THREE.DataTexture {
  const data = new Uint16Array(FLOW_N * FLOW_N * 4);
  const best = new Float32Array(FLOW_N * FLOW_N).fill(Infinity);
  const cell = WORLD / FLOW_N, radius = 160;
  for (const river of terrain.map.rivers) {
    let total = 0;
    for (let k = 1; k < river.length; k++) total += Math.hypot(river[k].x - river[k - 1].x, river[k].z - river[k - 1].z);
    let along = 0;
    for (let k = 1; k < river.length; k++) {
      const a = river[k - 1], b = river[k], dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius + HALF) / cell));
      const i1 = Math.min(FLOW_N - 1, Math.ceil((Math.max(a.x, b.x) + radius + HALF) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - radius + HALF) / cell));
      const j1 = Math.min(FLOW_N - 1, Math.ceil((Math.max(a.z, b.z) + radius + HALF) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + .5) * cell - HALF, z = (j + .5) * cell - HALF;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (len * len)));
        const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t), id = j * FLOW_N + i;
        if (distance > radius || distance >= best[id]) continue;
        best[id] = distance;
        const influence = 1 - THREE.MathUtils.smoothstep(distance, 40, radius);
        // The generated beds are flat. This is a small visual head, fading at the
        // actual outlet and wet banks; it never changes the terrain or water sim.
        const remaining = 1 - (along + len * t) / Math.max(1, total);
        data[id * 4] = THREE.DataUtils.toHalfFloat(dx / len);
        data[id * 4 + 1] = THREE.DataUtils.toHalfFloat(dz / len);
        data[id * 4 + 2] = THREE.DataUtils.toHalfFloat(.28 * remaining * influence);
        data[id * 4 + 3] = THREE.DataUtils.toHalfFloat(influence);
      }
      along += len;
    }
  }
  const texture = new THREE.DataTexture(data, FLOW_N, FLOW_N, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** One upload per field version; missing and NaN cells mean clean water. */
export class WaterPollution {
  readonly texture = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat);
  private field: ScalarField | null = null;
  private version = -1;
  uploads = 0;
  constructor() {
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }
  update(fields: WorldFields): boolean {
    const f = fields.fieldFor('pollution');
    if (f === this.field && (f?.version ?? -1) === this.version) return false;
    this.field = f;
    this.version = f?.version ?? -1;
    const w = f?.w ?? 1, h = f?.h ?? 1;
    if (this.texture.image.width !== w || this.texture.image.height !== h) {
      this.texture.dispose();
      this.texture.image = { data: new Uint8Array(w * h), width: w, height: h };
    }
    const out = this.texture.image.data as Uint8Array;
    const max = Math.max(1e-6, f?.max ?? 1);
    for (let i = 0; i < out.length; i++) {
      const value = f?.data[i] ?? 0;
      out[i] = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value / max / WATER_POLLUTION_RANGE)) * 255) : 0;
    }
    this.texture.needsUpdate = true;
    this.uploads++;
    return true;
  }
  dispose() { this.texture.dispose(); }
}
