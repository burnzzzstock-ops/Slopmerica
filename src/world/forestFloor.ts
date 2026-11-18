import * as THREE from 'three';
import { HALF, WORLD } from '../config';
import { withVisualRandom } from '../render/visualRandom';

// A texel spans 12 m. Supersampled crown footprints avoid painting a 72 m shadow
// around one isolated oak, while overlapping live crowns form a continuous floor.
const SIDE = 512;
const CELL = WORLD / SIDE;
const COVERAGE = 1024;

export class ForestFloor {
  private readonly standing = new Uint32Array(SIDE * SIDE);
  private readonly original = new Uint32Array(SIDE * SIDE);
  private readonly pixels = new Uint8Array(SIDE * SIDE);
  private readonly cleared = new Uint8Array(SIDE * SIDE);
  readonly texture = withVisualRandom(() => new THREE.DataTexture(this.pixels, SIDE, SIDE, THREE.RedFormat));
  readonly clearedTexture = withVisualRandom(() => new THREE.DataTexture(this.cleared, SIDE, SIDE, THREE.RedFormat));
  /** Ground-detail placement follows cuts and undo even if terrain is level. */
  version = 0;

  constructor() {
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.clearedTexture.minFilter = this.clearedTexture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.clearedTexture.needsUpdate = true;
  }

  // Keep the unsaturated counts. Removing then restoring a tree in a dense
  // stand must restore the exact same two channels, even at maximum shade.
  private stamp(x: number, z: number, radius: number, delta: number, edit: boolean) {
    const r = Math.max(1, radius), r2 = r * r;
    const x0 = Math.max(0, Math.floor((x - r + HALF) / CELL));
    const x1 = Math.min(SIDE - 1, Math.floor((x + r + HALF) / CELL));
    const z0 = Math.max(0, Math.floor((z - r + HALF) / CELL));
    const z1 = Math.min(SIDE - 1, Math.floor((z + r + HALF) / CELL));
    for (let row = z0; row <= z1; row++) {
      for (let col = x0; col <= x1; col++) {
        let coverage = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
          const dx = (col + (sx + .5) / 4) * CELL - HALF - x;
          const dz = (row + (sy + .5) / 4) * CELL - HALF - z;
          const t = Math.max(0, Math.min(1, (dx * dx + dz * dz - r2 * .49) / (r2 * .51)));
          coverage += 1 - t * t * (3 - 2 * t);
        }
        const weight = Math.round(coverage / 16 * COVERAGE);
        if (!weight) continue;
        const i = row * SIDE + col;
        this.standing[i] = Math.max(0, this.standing[i] + delta * weight);
        if (edit) {
          this.pixels[i] = Math.min(255, Math.round(this.standing[i] / COVERAGE * 255));
          this.cleared[i] = Math.min(255, Math.round(Math.max(0, this.original[i] - this.standing[i]) / COVERAGE * 255));
        }
      }
    }
  }

  bake(xs: Float32Array, zs: Float32Array, radii?: Float32Array) {
    this.standing.fill(0);
    this.pixels.fill(0);
    this.cleared.fill(0);
    for (let i = 0; i < xs.length; i++) this.stamp(xs[i], zs[i], radii?.[i] ?? 6, 1, false);
    this.original.set(this.standing);
    for (let i = 0; i < this.standing.length; i++) {
      this.pixels[i] = Math.min(255, Math.round(this.standing[i] / COVERAGE * 255));
    }
    this.texture.needsUpdate = true;
    this.clearedTexture.needsUpdate = true;
    this.version++;
  }

  edit(x: number, z: number, delta: -1 | 1, radius = 6) {
    this.stamp(x, z, radius, delta, true);
    // Only cells under this crown change. Three uploads the final pair
    // of 256 KiB R8 textures on the next draw, regardless
    // of the number of trees a single bulldozer stroke cleared.
    this.texture.needsUpdate = true;
    this.clearedTexture.needsUpdate = true;
    this.version++;
  }

  private sample(data: Uint8Array, x: number, z: number) {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return 0;
    const u = Math.max(0, Math.min(SIDE - 1, (x + HALF) / CELL - 0.5));
    const v = Math.max(0, Math.min(SIDE - 1, (z + HALF) / CELL - 0.5));
    const x0 = Math.floor(u), z0 = Math.floor(v);
    const x1 = Math.min(SIDE - 1, x0 + 1), z1 = Math.min(SIDE - 1, z0 + 1);
    const tx = u - x0, tz = v - z0;
    const a = data[z0 * SIDE + x0] * (1 - tx) + data[z0 * SIDE + x1] * tx;
    const b = data[z1 * SIDE + x0] * (1 - tx) + data[z1 * SIDE + x1] * tx;
    return (a * (1 - tz) + b * tz) / 255;
  }

  densityAt(x: number, z: number) {
    return this.sample(this.pixels, x, z);
  }

  clearedAt(x: number, z: number) {
    return this.sample(this.cleared, x, z);
  }
}
