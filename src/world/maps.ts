// The three playable 6 km maps. Each has a continuous macro landscape function
// (also used for the horizon beyond the county line), sampled at 8 m and
// upsampled to 4 m, then rivers, floodplains, lakes and coasts are carved in.
import { HALF, HM_N, HM_STEP, MAC_N, MAC_STEP, WORLD } from '../config';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { clamp, lerp, smoothstep, V2 } from '../core/math';

export type MapId = 'appalachia' | 'norcal' | 'florida';
export type TreeKind = 'decid' | 'pine' | 'redwood' | 'oak' | 'palm' | 'cypress' | 'mangrove' | 'shrub';
export type Edge = 'west' | 'east' | 'north' | 'south';

export interface Palette {
  grass: number;
  grass2: number; // dry / golden grass
  forest: number; // forest floor
  rock: number;
  sand: number;
  mud: number;
  marsh: number;
  seabed: number;
  deepSeabed: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  place: string;
  blurb: string;
  tagline: string;
  seed: number;
  palette: Palette;
  water: { shallow: number; deep: number; murk: number };
  sky: { turbidity: number; rayleigh: number; fog: number; fogDensity: number; hemiSky: number; hemiGround: number };
  treeDensity: number;
  communes: number;
  entry: Edge;
}

export interface MapData {
  def: MapDef;
  heights: Float32Array; // HM_N * HM_N
  cover: Float32Array; // HM_N * HM_N, biome-specific 0..1 (moisture / forest)
  rivers: V2[][];
  /** Macro landscape anywhere (used for horizon terrain beyond the map). */
  far: (x: number, z: number) => number;
  /** 0..1 beach/dune sand, so sand hugs the real coast instead of all low land. */
  sand?: (x: number, z: number) => number;
  treeRule: (x: number, z: number, h: number, slope: number, cover: number, r: number) => { kind: TreeKind; p: number } | null;
}

export const MAPS: MapDef[] = [
  {
    id: 'appalachia',
    name: 'Holler County',
    place: 'Pennsylvania / West Virginia line',
    blurb: 'Six kilometers of ridge-and-valley country: a big muddy river, deep hollers, a mountain lake and hardwoods to the horizon. Flat land is rare. Coal is not.',
    tagline: 'Almost Heaven, Soon Parking',
    seed: 1776,
    palette: { grass: 0x5d7a3c, grass2: 0x7e8a4a, forest: 0x3f4a2c, rock: 0x7a746a, sand: 0xa0916c, mud: 0x6a5a42, marsh: 0x5d6b3d, seabed: 0x5f5842, deepSeabed: 0x35332a },
    water: { shallow: 0x5c8a74, deep: 0x1d4448, murk: 0x6a6040 },
    sky: { turbidity: 5, rayleigh: 1.5, fog: 0xb6c3cb, fogDensity: 0.00011, hemiSky: 0xcfe3ff, hemiGround: 0x4a5a30 },
    treeDensity: 1,
    communes: 12,
    entry: 'west',
  },
  {
    id: 'norcal',
    name: 'Golden Coast',
    place: 'Northern California',
    blurb: 'Malibu-grade beaches and sea stacks, golden oak hills, a wine-country valley and a sequoia range older than the Constitution. Zoned for none of it, yet.',
    tagline: "Dude, Where's My Coastline",
    seed: 1849,
    palette: { grass: 0x6f8a45, grass2: 0xbf9d5a, forest: 0x46432e, rock: 0x8a7e6c, sand: 0xe2d3aa, mud: 0x7a6849, marsh: 0x6f8a52, seabed: 0xc2b28a, deepSeabed: 0x284651 },
    water: { shallow: 0x3aaab8, deep: 0x0c3a62, murk: 0x5a7d6a },
    sky: { turbidity: 3.2, rayleigh: 1.1, fog: 0xc8d7e0, fogDensity: 0.0001, hemiSky: 0xd8ecff, hemiGround: 0x8a7a48 },
    treeDensity: 0.9,
    communes: 14,
    entry: 'north',
  },
  {
    id: 'florida',
    name: 'Gator Gulch',
    place: 'Florida Gulf Coast',
    blurb: 'Flat as a pancake for miles. Bayous, a giant sawgrass marsh, cypress domes, a lake you can’t see across and turquoise water behind barrier islands. Perfect for a golf course.',
    tagline: 'Florida Man Approved',
    seed: 1513,
    palette: { grass: 0x6a8840, grass2: 0x8ea655, forest: 0x46563a, rock: 0x9a9480, sand: 0xece4cf, mud: 0x6d6440, marsh: 0x8a8d55, seabed: 0xe4d8b6, deepSeabed: 0x2a7a92 },
    water: { shallow: 0x3fd0cb, deep: 0x106c97, murk: 0x5b6a3a },
    sky: { turbidity: 4.2, rayleigh: 1.35, fog: 0xd4e2e8, fogDensity: 0.00009, hemiSky: 0xdff2ff, hemiGround: 0x6a7a3a },
    treeDensity: 0.85,
    communes: 12,
    entry: 'north',
  },
];

const idx = (i: number, j: number) => j * HM_N + i;
const wx = (i: number) => i * HM_STEP - HALF;

/** Meandering polyline between two points. */
function meander(rng: Rng, n: Noise2D, a: V2, b: V2, amp: number, wave: number, steps = 300): V2[] {
  const pts: V2[] = [];
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  const nx = -dz / L, nz = dx / L;
  const phase = rng.range(0, 10);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.8 + 0.2;
    const off = (Math.sin(t * wave + phase) * 0.55 + n.fbm(t * 4 + phase, 7.3, 4) * 1.0) * amp * env;
    pts.push({ x: a.x + dx * t + nx * off, z: a.z + dz * t + nz * off });
  }
  return pts;
}

/** Min distance from every heightmap vertex (within radius) to a polyline. */
function distanceField(lines: V2[][], radius: number): Float32Array {
  const field = new Float32Array(HM_N * HM_N);
  field.fill(1e9);
  const r2 = radius * radius;
  for (const line of lines)
    for (let k = 0; k < line.length - 1; k++) {
      const a = line[k], b = line[k + 1];
      const minI = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius + HALF) / HM_STEP));
      const maxI = Math.min(HM_N - 1, Math.ceil((Math.max(a.x, b.x) + radius + HALF) / HM_STEP));
      const minJ = Math.max(0, Math.floor((Math.min(a.z, b.z) - radius + HALF) / HM_STEP));
      const maxJ = Math.min(HM_N - 1, Math.ceil((Math.max(a.z, b.z) + radius + HALF) / HM_STEP));
      const abx = b.x - a.x, abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1;
      for (let j = minJ; j <= maxJ; j++) {
        const z = wx(j);
        for (let i = minI; i <= maxI; i++) {
          const x = wx(i);
          let t = ((x - a.x) * abx + (z - a.z) * abz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a.x + abx * t - x, pz = a.z + abz * t - z;
          const d2 = px * px + pz * pz;
          if (d2 < r2) {
            const id = idx(i, j);
            const d = Math.sqrt(d2);
            if (d < field[id]) field[id] = d;
          }
        }
      }
    }
  return field;
}

/** Sample a macro function at 8 m and Catmull-Rom upsample to the 4 m grid. */
function macroToGrid(fn: (x: number, z: number) => [number, number]): { h: Float32Array; c: Float32Array } {
  const mh = new Float32Array(MAC_N * MAC_N);
  const mc = new Float32Array(MAC_N * MAC_N);
  for (let j = 0; j < MAC_N; j++)
    for (let i = 0; i < MAC_N; i++) {
      const [h, c] = fn(i * MAC_STEP - HALF, j * MAC_STEP - HALF);
      mh[j * MAC_N + i] = h;
      mc[j * MAC_N + i] = c;
    }
  const h = new Float32Array(HM_N * HM_N);
  const c = new Float32Array(HM_N * HM_N);
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const at = (arr: Float32Array, i: number, j: number) => arr[clamp(j, 0, MAC_N - 1) * MAC_N + clamp(i, 0, MAC_N - 1)];
  const ratio = MAC_STEP / HM_STEP;
  for (let j = 0; j < HM_N; j++) {
    const fj = j / ratio, j0 = Math.floor(fj), tj = fj - j0;
    for (let i = 0; i < HM_N; i++) {
      const fi = i / ratio, i0 = Math.floor(fi), ti = fi - i0;
      const k = j * HM_N + i;
      if (ti === 0 && tj === 0) { h[k] = at(mh, i0, j0); c[k] = at(mc, i0, j0); continue; }
      const rowH = [0, 0, 0, 0], rowC = [0, 0, 0, 0];
      for (let r = -1; r <= 2; r++) {
        rowH[r + 1] = cr(at(mh, i0 - 1, j0 + r), at(mh, i0, j0 + r), at(mh, i0 + 1, j0 + r), at(mh, i0 + 2, j0 + r), ti);
        rowC[r + 1] = cr(at(mc, i0 - 1, j0 + r), at(mc, i0, j0 + r), at(mc, i0 + 1, j0 + r), at(mc, i0 + 2, j0 + r), ti);
      }
      h[k] = cr(rowH[0], rowH[1], rowH[2], rowH[3], tj);
      c[k] = cr(rowC[0], rowC[1], rowC[2], rowC[3], tj);
    }
  }
  return { h, c };
}

// ---------------------------------------------------------------- Holler County
function genAppalachia(def: MapDef): MapData {
  const rng = new Rng(def.seed);
  const n = new Noise2D(def.seed);
  const n2 = new Noise2D(def.seed + 7);
  const n3 = new Noise2D(def.seed + 13);
  const ang = 0.62, ca = Math.cos(ang), sa = Math.sin(ang);
  const base = (x: number, z: number): [number, number] => {
    const u = x * ca + z * sa, v = -x * sa + z * ca;
    const warp = n.fbm(x / 1500, z / 1500, 3) * 260;
    const ridges = n.ridged((u + warp) / 2600, (v + warp) / 620, 5, 2.1, 0.45);
    const hollers = Math.pow(n3.ridged(x / 1100 + 3.1, z / 1100 - 1.7, 5), 1.5);
    const rolling = n2.fbm(x / 800, z / 800, 5) * 0.5 + 0.5;
    const ridgeZone = smoothstep(-0.25, 0.35, n2.noise(x / 6000 + 1.3, z / 6000 - 0.4) + (x + z) / 9000);
    let h = lerp(28 + hollers * 170 + rolling * 55, 18 + ridges * 250 + rolling * 30, ridgeZone);
    // terraced benches = the rare flat land
    const bench = 48 + n3.noise(x / 1800, z / 1800) * 22;
    if (h > bench - 10 && h < bench + 18) h = lerp(h, bench + (h - bench) * 0.3, 0.6);
    // the horizon beyond the county gets taller (enclosed valley feeling)
    const out = Math.max(Math.abs(x), Math.abs(z)) - HALF;
    if (out > 0) h += smoothstep(0, 5000, out) * 260 * (0.6 + n2.noise(x / 3000, z / 3000) * 0.4);
    const cover = clamp(n2.fbm(x / 900 + 9, z / 900, 3) * 0.7 + 0.55, 0, 1);
    return [h, cover];
  };
  const { h: heights, c: cover } = macroToGrid(base);

  const river = meander(rng, n2, { x: -HALF - 100, z: rng.range(-500, 200) }, { x: HALF + 100, z: rng.range(-300, 600) }, 520, 11, 420);
  const tribs = [
    meander(rng, n2, { x: rng.range(-1600, -600), z: -HALF - 80 }, river[Math.floor(river.length * 0.3)], 170, 8, 220),
    meander(rng, n2, { x: rng.range(600, 1700), z: -HALF - 80 }, river[Math.floor(river.length * 0.7)], 170, 8, 220),
    meander(rng, n2, { x: rng.range(-400, 900), z: HALF + 80 }, river[Math.floor(river.length * 0.5)], 200, 9, 240),
  ];
  const dRiver = distanceField([river], 900);
  const dTrib = distanceField(tribs, 360);
  const lakeAt = tribs[2][Math.floor(tribs[2].length * 0.35)];
  const lake = { x: lakeAt.x, z: lakeAt.z, r: 260 + rng.range(0, 140) };

  for (let j = 0; j < HM_N; j++)
    for (let i = 0; i < HM_N; i++) {
      const k = idx(i, j);
      const x = wx(i), z = wx(j);
      let h = heights[k] + n3.noise(x / 31, z / 31) * 0.9 + n.noise(x / 9, z / 9) * 0.25;
      const dr = dRiver[k];
      const riverW = 46 + n2.noise(x / 400, z / 400) * 12;
      const plainW = 260 + n.noise(x / 900, z / 900) * 120;
      if (dr < plainW + 520) {
        const plainH = 3.2 + smoothstep(riverW, plainW, dr) * 5 + n2.noise(x / 90, z / 90) * 0.5;
        h = lerp(plainH, h, smoothstep(plainW, plainW + 520, dr));
      }
      if (dr < riverW * 1.9) h = lerp(-5, h, smoothstep(riverW * 0.55, riverW * 1.9, dr));
      const dt = dTrib[k];
      if (dt < 340) {
        const floor = 7 + dt * 0.05;
        h = lerp(Math.min(h, floor + 36), h, smoothstep(90, 340, dt));
        if (dt < 70) h = lerp(Math.min(h, floor), h, smoothstep(22, 70, dt));
        if (dt < 16) h = lerp(-2.6, h, smoothstep(6, 16, dt));
      }
      const dl = Math.hypot(x - lake.x, (z - lake.z) * 1.3);
      if (dl < lake.r * 1.5) h = lerp(-8, h, smoothstep(lake.r * 0.75, lake.r * 1.5, dl));
      heights[k] = h;
    }

  return {
    def, heights, cover, rivers: [river, ...tribs],
    far: (x, z) => base(x, z)[0],
    treeRule: (x, z, h, slope, c, r) => {
      if (h < 1.3) return null;
      if (c < 0.36 && h < 60 && slope < 0.2) return r < 0.035 ? { kind: 'decid', p: 1 } : null; // hay meadows
      const p = h < 9 ? 0.45 : 0.92;
      if (h > 170 || (slope > 0.45 && r < 0.35)) return { kind: 'pine', p };
      return { kind: r < 0.16 ? 'pine' : 'decid', p };
    },
  };
}

// ---------------------------------------------------------------- Golden Coast
function genNorcal(def: MapDef): MapData {
  const rng = new Rng(def.seed);
  const n = new Noise2D(def.seed);
  const n2 = new Noise2D(def.seed + 3);
  const n3 = new Noise2D(def.seed + 9);
  const coastX = (z: number) => -HALF * 0.52 + n.fbm(z / 2600, 2.2, 4) * 420 + Math.max(0, -z - 900) * 0.18;
  const valleyX = (z: number) => 350 + n3.fbm(z / 2200, 5.1, 3) * 380;
  const base = (x: number, z: number): [number, number] => {
    const d = x - coastX(z);
    const cliffy = smoothstep(0.05, 0.4, n2.noise(z / 1500, 5.5));
    let h: number;
    if (d < 0) {
      h = -0.8 + d * 0.028 - Math.max(0, -d - 700) * 0.05;
      // sea stacks
      const st = n3.noise(x / 60, z / 60);
      if (d > -260 && d < -30 && st > 0.72) h = lerp(h, 16 + (st - 0.72) * 90, smoothstep(0.72, 0.8, st));
    } else {
      const beachW = lerp(110, 16, cliffy);
      const beach = d < beachW ? 0.3 + (d / beachW) * 3.4 : 3.7;
      const cliff = lerp(0, 38, cliffy) * smoothstep(beachW, beachW + 35, d);
      const terrace = 10 + n.noise(x / 700, z / 700) * 6; // flat marine terrace
      const inland = Math.max(0, d - beachW);
      const hills = (n.fbm(x / 950, z / 950, 5) * 0.5 + 0.5) * 150 * smoothstep(250, 1100, inland);
      const vd = Math.abs(x - valleyX(z));
      const valley = smoothstep(260, 900, vd); // flat wine-country valley floor
      const mtn = smoothstep(1500, 2900, x + n2.noise(z / 1800, 1.7) * 400) * (n.ridged(x / 1700, z / 1700, 5) * 520 + 170);
      h = beach + cliff + lerp(terrace, terrace + hills, valley) + mtn * valley + (1 - valley) * 30 * smoothstep(0, 900, inland);
    }
    const out = Math.max(Math.abs(x), Math.abs(z)) - HALF;
    if (out > 0 && x > -HALF) h += smoothstep(0, 5000, out) * 300 * smoothstep(-2000, 1000, x);
    const moist = n2.fbm(x / 800, z / 800, 3) * 0.3 + 0.32 + smoothstep(1300, 2600, x) * 0.6 + smoothstep(600, 0, Math.abs(x - valleyX(z))) * 0.15;
    return [h, clamp(moist, 0, 1)];
  };
  const { h: heights, c: cover } = macroToGrid(base);

  const mouthZ = rng.range(-300, 500);
  const river = meander(rng, n2, { x: HALF + 60, z: rng.range(-1800, -900) }, { x: coastX(mouthZ) - 40, z: mouthZ }, 300, 9, 360);
  const creeks = [
    meander(rng, n2, { x: 2400, z: HALF + 60 }, river[Math.floor(river.length * 0.45)], 160, 7, 200),
    meander(rng, n2, { x: 900, z: -HALF - 60 }, river[Math.floor(river.length * 0.6)], 160, 7, 200),
  ];
  const dRiver = distanceField([river], 420);
  const dCreek = distanceField(creeks, 260);
  for (let j = 0; j < HM_N; j++)
    for (let i = 0; i < HM_N; i++) {
      const k = idx(i, j);
      const x = wx(i), z = wx(j);
      let h = heights[k] + n3.noise(x / 29, z / 29) * 0.6;
      const d = x - coastX(z);
      const dr = dRiver[k];
      if (dr < 400 && d > -30) {
        const floor = 2.2 + Math.max(0, d) * 0.012;
        h = lerp(Math.min(h, floor + dr * 0.1), h, smoothstep(120, 400, dr));
        if (dr < 24) h = lerp(-2.8, h, smoothstep(9, 24, dr));
      }
      const dc = dCreek[k];
      if (dc < 240 && d > 0) {
        h = lerp(Math.min(h, 6 + dc * 0.12 + Math.max(0, d) * 0.01), h, smoothstep(60, 240, dc));
        if (dc < 10) h = lerp(-1.8, h, smoothstep(4, 10, dc));
      }
      const lag = Math.hypot(x - (coastX(mouthZ) + 60), (z - mouthZ) * 0.7);
      if (lag < 150) h = lerp(-2, h, smoothstep(80, 150, lag));
      heights[k] = h;
      cover[k] = clamp(cover[k] + smoothstep(160, 0, Math.min(dr, dc)) * 0.45, 0, 1);
    }
  return {
    def, heights, cover, rivers: [river, ...creeks],
    far: (x, z) => base(x, z)[0],
    sand: (x, z) => { const d = x - coastX(z); return d < -60 ? 1 : smoothstep(lerp(120, 26, smoothstep(0.05, 0.4, n2.noise(z / 1500, 5.5))), 10, d); },
    treeRule: (x, z, h, slope, c, r) => {
      if (h < 3.5) return null;
      if (x > 1500 && h > 120) return { kind: r < 0.85 ? 'redwood' : 'pine', p: 0.85 };
      if (c > 0.72) return { kind: r < 0.3 ? 'pine' : 'oak', p: 0.6 };
      if (c > 0.46) return { kind: 'oak', p: 0.14 }; // oak savanna
      return r < 0.1 ? { kind: 'shrub', p: 0.35 } : { kind: 'oak', p: 0.03 };
    },
  };
}

// ---------------------------------------------------------------- Gator Gulch
function genFlorida(def: MapDef): MapData {
  const rng = new Rng(def.seed);
  const n = new Noise2D(def.seed);
  const n2 = new Noise2D(def.seed + 11);
  const n3 = new Noise2D(def.seed + 23);
  const shoreZ = (x: number) => HALF * 0.46 + n.fbm(x / 2600, 1.3, 4) * 320;
  const lakeBig = { x: rng.range(-900, 900), z: rng.range(-2200, -1500), r: rng.range(520, 700) };
  const base = (x: number, z: number): [number, number] => {
    const d = shoreZ(x) - z;
    let h: number;
    if (d > 0) {
      h = 1.3 + smoothstep(0, 2600, d) * 5.5 + n.fbm(x / 1500, z / 1500, 5) * 1.6;
      const beach = smoothstep(0, 45, d);
      h = lerp(0.25, h, beach);
      const m = n2.fbm(x / 1900 + 4, z / 1900, 4); // the big sawgrass marsh
      if (m > 0.02) h = lerp(h, 0.35 + (0.3 - Math.min(0.3, m)) * 0.9, smoothstep(0.02, 0.2, m));
    } else {
      const off = -d;
      const islandC = 260 + n2.noise(x / 900, 3) * 40;
      const islandW = 55 + n.noise(x / 500, 8) * 15;
      const di = Math.abs(off - islandC);
      const pass = Math.abs(((x + 6144) % 2100) - 1050) < 70;
      if (di < islandW && !pass) h = 0.45 + (1 - di / islandW) * 2.8;
      else if (off < islandC) h = -1.3 - Math.sin((off / islandC) * Math.PI) * 1.4;
      else h = -1.2 - (off - islandC) * 0.01 - Math.max(0, off - islandC - 900) * 0.035;
    }
    const cover = clamp(n.fbm(x / 700 + 2, z / 700, 3) * 0.6 + 0.5, 0, 1);
    return [h, cover];
  };
  const { h: heights, c: cover } = macroToGrid(base);

  const bayous: V2[][] = [];
  for (let k = 0; k < 6; k++) {
    const sx = -HALF * 0.85 + k * 1050 + rng.range(-150, 150);
    bayous.push(meander(rng, n2, { x: sx, z: -HALF - 60 }, { x: sx + rng.range(-500, 500), z: shoreZ(sx) + 40 }, 240, 14, 320));
  }
  const bigRiver = meander(rng, n2, { x: lakeBig.x, z: lakeBig.z + lakeBig.r * 0.8 }, { x: lakeBig.x + rng.range(-800, 800), z: shoreZ(lakeBig.x) + 60 }, 260, 10, 320);
  const dBayou = distanceField(bayous, 90);
  const dRiver = distanceField([bigRiver], 120);
  const lakes: { x: number; z: number; r: number }[] = [lakeBig];
  for (let k = 0; k < 24; k++) lakes.push({ x: rng.range(-2800, 2800), z: rng.range(-2800, 900), r: rng.range(30, 130) });
  for (let j = 0; j < HM_N; j++)
    for (let i = 0; i < HM_N; i++) {
      const k = idx(i, j);
      const x = wx(i), z = wx(j);
      let h = heights[k] + n3.noise(x / 23, z / 23) * 0.12;
      const d = shoreZ(x) - z;
      const db = dBayou[k];
      const bw = 10 + n.noise(x / 180, z / 180) * 3;
      if (db < bw * 2.6 && d > -20) h = lerp(-1.5, h, smoothstep(bw * 0.6, bw * 2.6, db));
      const dr = dRiver[k];
      if (dr < 70 && d > -20) h = lerp(-2.4, h, smoothstep(20, 70, dr));
      for (const L of lakes) {
        const dl = Math.hypot(x - L.x, z - L.z);
        if (dl < L.r * 1.4) h = lerp(L.r > 400 ? -4 : -2.6, h, smoothstep(L.r * 0.82, L.r * 1.4, dl));
      }
      heights[k] = h;
    }
  return {
    def, heights, cover, rivers: [...bayous, bigRiver],
    far: (x, z) => base(x, z)[0],
    sand: (x, z) => { const d = shoreZ(x) - z; return d < 0 ? 0.85 : smoothstep(70, 15, d); },
    treeRule: (x, z, h, slope, c, r) => {
      if (h < 0.05) return h > -0.9 && c > 0.45 ? { kind: 'cypress', p: 0.34 } : null; // cypress standing in the swamp
      if (h < 0.9) return c > 0.5 ? { kind: 'cypress', p: 0.55 } : r < 0.08 ? { kind: 'mangrove', p: 0.6 } : null;
      if (h < 1.8 && z > shoreZ(x) - 400) return { kind: r < 0.55 ? 'palm' : 'mangrove', p: 0.3 };
      if (c > 0.56) return { kind: r < 0.55 ? 'pine' : r < 0.85 ? 'decid' : 'palm', p: 0.8 }; // pine flatwoods + hammocks
      if (c > 0.44) return { kind: r < 0.4 ? 'palm' : r < 0.7 ? 'pine' : 'shrub', p: 0.22 };
      return r < 0.3 ? { kind: 'palm', p: 0.06 } : null;
    },
  };
}

export function generateMap(id: MapId): MapData {
  const def = MAPS.find((m) => m.id === id)!;
  if (id === 'appalachia') return genAppalachia(def);
  if (id === 'norcal') return genNorcal(def);
  return genFlorida(def);
}

export const MAP_SIZE_KM = WORLD / 1000;
