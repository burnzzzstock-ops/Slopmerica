// Spatial fields sampled at a coarse grid, updated at sim-day rate (not per
// frame): ground/air pollution (accumulates, diffuses, drifts with the wind,
// decays) and noise (recomputed from roads and noisy buildings).
import { WORLD } from '../config';

export const FIELD_N = 96;
export const FIELD_CELL = WORLD / FIELD_N; // 64 m

export class Fields {
  readonly pol = new Float32Array(FIELD_N * FIELD_N);
  readonly noise = new Float32Array(FIELD_N * FIELD_N);
  private tmp = new Float32Array(FIELD_N * FIELD_N);
  private emit = new Float32Array(FIELD_N * FIELD_N);

  cell(x: number, z: number): number {
    const i = Math.min(FIELD_N - 1, Math.max(0, Math.floor((x + WORLD / 2) / FIELD_CELL)));
    const j = Math.min(FIELD_N - 1, Math.max(0, Math.floor((z + WORLD / 2) / FIELD_CELL)));
    return j * FIELD_N + i;
  }

  /** Bilinear sample of a field at world x,z. */
  sample(f: Float32Array, x: number, z: number): number {
    const fx = (x + WORLD / 2) / FIELD_CELL - 0.5, fz = (z + WORLD / 2) / FIELD_CELL - 0.5;
    const i = Math.max(0, Math.min(FIELD_N - 2, Math.floor(fx))), j = Math.max(0, Math.min(FIELD_N - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
    const a = f[j * FIELD_N + i], b = f[j * FIELD_N + i + 1], c = f[(j + 1) * FIELD_N + i], d = f[(j + 1) * FIELD_N + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  addEmission(x: number, z: number, amount: number) {
    this.emit[this.cell(x, z)] += amount;
  }

  /**
   * One pollution day. Paired transfers conserve mass before decay:
   * next = cur*(1-decay) + emissions + inflow - outflow (never negative).
   */
  stepPollution(days: number, windX: number, windZ: number) {
    const N = FIELD_N, P = this.pol, T = this.tmp;
    const k = Math.min(0.2, 0.1 * days); // diffusion share to each neighbor
    const wx = Math.max(-1, Math.min(1, windX)), wz = Math.max(-1, Math.min(1, windZ));
    const adv = Math.min(0.25, 0.12 * days); // share blown downwind
    const decay = 1 - Math.pow(1 - 0.07, days);
    for (let i = 0; i < P.length; i++) { P[i] += this.emit[i] * days; this.emit[i] = 0; }
    T.fill(0);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const id = j * N + i, v = P[id];
        if (v <= 1e-5) continue;
        let keep = v;
        // diffusion to 4 neighbors (edges lose mass off-map, like air leaving the county)
        const share = v * k;
        const nb = [i > 0 ? id - 1 : -1, i < N - 1 ? id + 1 : -1, j > 0 ? id - N : -1, j < N - 1 ? id + N : -1];
        for (const n of nb) { if (n >= 0) T[n] += share; keep -= share; }
        // wind advection
        const ax = Math.abs(wx) * adv * v, az = Math.abs(wz) * adv * v;
        const tx = i + Math.sign(wx), tz = j + Math.sign(wz);
        if (ax > 0) { if (tx >= 0 && tx < N) T[j * N + tx] += ax; keep -= ax; }
        if (az > 0) { if (tz >= 0 && tz < N) T[tz * N + i] += az; keep -= az; }
        T[id] += keep;
      }
    for (let i = 0; i < P.length; i++) P[i] = Math.max(0, T[i] * (1 - decay));
  }

  /** Rebuild noise from scratch; call stamp(x,z,level,radiusCells) for every source. */
  rebuildNoise(fill: (stamp: (x: number, z: number, level: number, r: number) => void) => void) {
    const N = FIELD_N, S = this.noise;
    S.fill(0);
    fill((x, z, level, r) => {
      const ci = Math.floor((x + WORLD / 2) / FIELD_CELL), cj = Math.floor((z + WORLD / 2) / FIELD_CELL);
      const R = Math.max(0, Math.ceil(r));
      for (let dj = -R; dj <= R; dj++)
        for (let di = -R; di <= R; di++) {
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const d = Math.hypot(di, dj);
          if (d > r + 0.5) continue;
          const v = level / (1 + d * d * 0.8);
          const id = j * N + i;
          // decibels add logarithmically-ish: louder source dominates
          S[id] = Math.max(S[id], v) + Math.min(S[id], v) * 0.3;
        }
    });
  }

  save() {
    // quantized, sparse
    const out: [number, number][] = [];
    for (let i = 0; i < this.pol.length; i++) if (this.pol[i] > 0.01) out.push([i, Math.round(this.pol[i] * 100)]);
    return out;
  }

  load(rows: [number, number][] | undefined) {
    this.pol.fill(0);
    if (!Array.isArray(rows)) return;
    for (const [i, v] of rows) if (i >= 0 && i < this.pol.length) this.pol[i] = v / 100;
  }
}
