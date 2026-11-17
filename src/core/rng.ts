// Seeded randomness. Everything that shapes the world goes through here so a
// seed reproduces the same valley (Then & Now, save/load, bug reports).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Rng {
  /** mulberry32 state; save it to resume the exact sequence after a reload */
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  private next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(): number {
    return this.next();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}

/**
 * The seed of one named stream of a county's dice. Every system that rolls dice in the simulation has its own stream (traffic,
 * people, services, ...), all drawn from the county's one seed, so a roll in one never moves the rolls in another.
 */
export function streamSeed(seed: number, name: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < name.length; i++) { h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0; h = (h ^ (h >>> 15)) >>> 0; }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0 || 1;
}

/**
 * The dice for everything that only dresses the screen or picks words (feed posts, car colours, particles, idle poses). Seeded
 * from the clock, never saved. Nothing that changes the county may use it; the simulation's dice are the per-system streams.
 */
export const fx = new Rng((Math.random() * 2 ** 31) | 0);
