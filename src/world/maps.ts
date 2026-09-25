// The three playable maps. Each generator fills a heightmap plus a "cover"
// field (0..1, biome-specific meaning: moisture / golden-vs-green / marshiness)
// and describes its palette, sky and tree rules.
import { HALF, HM_N, HM_STEP } from '../config';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { clamp, lerp, smoothstep, V2 } from '../core/math';

export type MapId = 'appalachia' | 'norcal' | 'florida';
export type TreeKind = 'decid' | 'pine' | 'redwood' | 'oak' | 'palm' | 'cypress' | 'mangrove' | 'shrub';

export interface Palette {
  grass: number;
  grass2: number; // alternate grass tone (golden hills, dry)
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
}

export interface MapData {
  def: MapDef;
  heights: Float32Array; // HM_N * HM_N
  cover: Float32Array; // HM_N * HM_N
  rivers: V2[][]; // centerlines (for naming / fish / pollution later)
  treeRule: (x: number, z: number, h: number, slope: number, cover: number, n: number) => { kind: TreeKind; p: number } | null;
}

export const MAPS: MapDef[] = [
  {
    id: 'appalachia',
    name: 'Holler County',
    place: 'Pennsylvania / West Virginia line',
    blurb: 'Ridge-and-valley country. Hollers, a big muddy river, hardwoods turning orange. Flat land is rare. Coal is not.',
    tagline: 'Almost Heaven, Soon Parking',
    seed: 1776,
    palette: { grass: 0x587a36, grass2: 0x76893f, forest: 0x34462a, rock: 0x7a7468, sand: 0xa89a74, mud: 0x6b5a3e, marsh: 0x5d6e3a, seabed: 0x6e6448, deepSeabed: 0x3e3a2c },
    water: { shallow: 0x5f8f7a, deep: 0x1f4a4c, murk: 0x6a6040 },
    sky: { turbidity: 6, rayleigh: 1.6, fog: 0xb9c7cf, fogDensity: 0.00042, hemiSky: 0xcfe3ff, hemiGround: 0x4a5a30 },
    treeDensity: 1,
    communes: 6,
  },
  {
    id: 'norcal',
    name: 'Golden Coast',
    place: 'Northern California',
    blurb: 'Malibu-grade beaches, golden oak hills, and a sequoia grove older than the Constitution. Zoned for none of it, yet.',
    tagline: 'Dude, Where\'s My Coastline',
    seed: 1849,
    palette: { grass: 0x7a9a48, grass2: 0xc9a85a, forest: 0x44522c, rock: 0x8d7f6c, sand: 0xe9dcb4, mud: 0x7d6a4a, marsh: 0x6f8a52, seabed: 0xc9b98e, deepSeabed: 0x2f4a55 },
    water: { shallow: 0x3fb5c0, deep: 0x0d3b66, murk: 0x5a7d6a },
    sky: { turbidity: 3.5, rayleigh: 1.2, fog: 0xcad9e3, fogDensity: 0.00036, hemiSky: 0xd8ecff, hemiGround: 0x8a7a48 },
    treeDensity: 0.9,
    communes: 7,
  },
  {
    id: 'florida',
    name: 'Gator Gulch',
    place: 'Florida Gulf Coast',
    blurb: 'Flat as a pancake. Bayous, sawgrass marsh, cypress domes and turquoise water. Mostly swamp. Perfect for a golf course.',
    tagline: 'Florida Man Approved',
    seed: 1513,
    palette: { grass: 0x6e9b3e, grass2: 0x8fae52, forest: 0x4a6a32, rock: 0x9a9480, sand: 0xf3ecd6, mud: 0x6d6440, marsh: 0x7c8c45, seabed: 0xeadfbe, deepSeabed: 0x2f7d95 },
    water: { shallow: 0x44d4d0, deep: 0x136f9a, murk: 0x5b6a3a },
    sky: { turbidity: 4.5, rayleigh: 1.4, fog: 0xd6e4ea, fogDensity: 0.00034, hemiSky: 0xdff2ff, hemiGround: 0x6a7a3a },
    treeDensity: 0.85,
    communes: 6,
  },
];

const idx = (i: number, j: number) => j * HM_N + i;
const wx = (i: number) => i * HM_STEP - HALF;

/** Meandering river polyline between two points. */
function meander(rng: Rng, n: Noise2D, a: V2, b: V2, amp: number, wave: number, steps = 220): V2[] {
  const pts: V2[] = [];
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  const nx = -dz / L, nz = dx / L;
  const phase = rng.range(0, 10);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.8 + 0.2;
    const off = (Math.sin(t * wave + phase) * 0.6 + n.fbm(t * 3 + phase, 7.3, 3) * 0.9) * amp * env;
    pts.push({ x: a.x + dx * t + nx * off, z: a.z + dz * t + nz * off });
  }
  return pts;
}

/** Stamp min-distance-to-polyline into a field, within radius. */
function stampDistance(field: Float32Array, line: V2[], radius: number) {
  const r2 = radius * radius;
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
          const d = Math.sqrt(d2);
          const id = idx(i, j);
          if (d < field[id]) field[id] = d;
        }
      }
    }
  }
}

function newField(v: number) {
  const f = new Float32Array(HM_N * HM_N);
  f.fill(v);
  return f;
}

// ---------------------------------------------------------------- Appalachia
function genAppalachia(def: MapDef): MapData {
  const rng = new Rng(def.seed);
  const n = new Noise2D(def.seed);
  const n2 = new Noise2D(def.seed + 7);
  const heights = new Float32Array(HM_N * HM_N);
  const cover = new Float32Array(HM_N * HM_N);

  // Main river enters west, leaves east; a tributary comes down from the north.
  const river = meander(rng, n2, { x: -HALF - 60, z: rng.range(-250, 150) }, { x: HALF + 60, z: rng.range(-150, 300) }, 230, 9);
  const trib = meander(rng, n2, { x: rng.range(-250, 250), z: -HALF - 60 }, river[Math.floor(river.length * 0.55)], 90, 7, 140);
  const dRiver = newField(1e9);
  const dTrib = newField(1e9);
  stampDistance(dRiver, river, 420);
  stampDistance(dTrib, trib, 220);

  const ang = 0.62; // ridge orientation (NE-SW)
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let j = 0; j < HM_N; j++) {
    for (let i = 0; i < HM_N; i++) {
      const x = wx(i), z = wx(j);
      const u = x * ca + z * sa, v = -x * sa + z * ca;
      const warp = n.fbm(x / 700, z / 700, 3) * 120;
      const ridges = n.ridged((u + warp) / 1300, (v + warp) / 340, 4, 2.1, 0.45); // long parallel ridges
      const hills = n2.fbm(x / 380, z / 380, 5) * 0.5 + 0.5;
      const hollers = Math.pow(n.ridged(x / 520 + 3.1, z / 520 - 1.7, 4), 1.6); // dendritic
      let h = 14 + ridges * 95 + hills * 30 + hollers * 26 - 18;
      // broad benches: gently terrace mid slopes so there's buildable land
      const bench = 20 + n2.noise(x / 900, z / 900) * 10;
      if (h > bench - 6 && h < bench + 10) h = lerp(h, bench + (h - bench) * 0.35, 0.55);

      // River valley: floodplain ~4m, walls rising away from it
      const dr = dRiver[idx(i, j)];
      const riverW = 34 + n2.noise(x / 200, z / 200) * 8;
      const plainW = 140 + n.noise(x / 500, z / 500) * 60;
      const plainH = 3.2 + smoothstep(0, plainW, dr) * 3;
      if (dr < plainW + 260) {
        const t = smoothstep(plainW, plainW + 260, dr);
        h = lerp(plainH + n2.noise(x / 60, z / 60) * 0.5, h, t);
      }
      if (dr < riverW * 1.8) {
        const t = smoothstep(riverW * 0.55, riverW * 1.8, dr);
        h = lerp(-4.2, h, t);
      }
      // Tributary creek (narrower, its own little holler)
      const dt = dTrib[idx(i, j)];
      if (dt < 180) {
        const hv = 6 + dt * 0.08;
        h = lerp(Math.min(h, hv + 20), h, smoothstep(40, 180, dt));
        if (dt < 40) h = lerp(Math.min(h, 5), h, smoothstep(10, 40, dt));
        if (dt < 14) h = lerp(-2.5, h, smoothstep(5, 14, dt));
      }
      heights[idx(i, j)] = h;
      cover[idx(i, j)] = clamp(n2.fbm(x / 450 + 9, z / 450, 3) * 0.7 + 0.5, 0, 1); // forest vs meadow
    }
  }
  return {
    def,
    heights,
    cover,
    rivers: [river, trib],
    treeRule: (x, z, h, slope, c, r) => {
      if (h < 1.2) return null;
      const meadow = c < 0.36 && h < 30 && slope < 0.25;
      if (meadow) return r < 0.04 ? { kind: 'decid', p: 1 } : null;
      const nearRiver = h < 5;
      const p = nearRiver ? 0.45 : 0.88;
      if (h > 70 || (slope > 0.35 && r < 0.3)) return { kind: 'pine', p };
      return { kind: r < 0.18 ? 'pine' : 'decid', p };
    },
  };
}

// ---------------------------------------------------------------- NorCal
function genNorcal(def: MapDef): MapData {
  const rng = new Rng(def.seed);
  const n = new Noise2D(def.seed);
  const n2 = new Noise2D(def.seed + 3);
  const heights = new Float32Array(HM_N * HM_N);
  const cover = new Float32Array(HM_N * HM_N);

  // A creek from the redwood mountains (NE) down to a lagoon on the beach.
  const lagoonZ = rng.range(80, 260);
  const creek = meander(rng, n2, { x: HALF * 0.75, z: -HALF * 0.85 }, { x: -470, z: lagoonZ }, 120, 8, 200);
  const dCreek = newField(1e9);
  stampDistance(dCreek, creek, 260);

  for (let j = 0; j < HM_N; j++) {
    for (let i = 0; i < HM_N; i++) {
      const x = wx(i), z = wx(j);
      // coastline: x position of the shore varies with z; a headland in the north
      const coast = -560 + n.fbm(z / 900, 2.2, 4) * 160 + Math.max(0, -z - 350) * 0.22;
      const d = x - coast; // meters inland
      const cliffy = smoothstep(0.1, 0.45, n2.noise(z / 700, 5.5)); // cliffs vs beaches along the coast
      let h: number;
      if (d < 0) {
        // ocean floor: sandy shelf then deep
        h = -0.6 + d * 0.035 - Math.max(0, -d - 250) * 0.06;
      } else {
        const beachW = lerp(90, 14, cliffy);
        const beach = d < beachW ? 0.25 + (d / beachW) * 3.5 : 3.75;
        const cliff = lerp(0, 34, cliffy) * smoothstep(beachW, beachW + 30, d);
        const inland = Math.max(0, d - beachW);
        const rolling = (n.fbm(x / 420, z / 420, 5) * 0.5 + 0.5) * 55 * smoothstep(0, 300, inland);
        const rise = inland * 0.045;
        // Sequoia/redwood mountains in the NE
        const ne = smoothstep(200, 900, x + -z * 0.9);
        const mtn = ne * (n.ridged(x / 600, z / 600, 5) * 130 + 40);
        h = beach + cliff + rolling + rise + mtn;
      }
      // Creek canyon + lagoon
      const dc = dCreek[idx(i, j)];
      if (dc < 240 && d > -20) {
        const valleyH = 2.5 + Math.max(0, x - coast) * 0.03;
        h = lerp(Math.min(h, valleyH + dc * 0.18), h, smoothstep(60, 240, dc));
        if (dc < 16) h = lerp(-2.2, h, smoothstep(6, 16, dc));
      }
      const lag = Math.hypot(x - (coast + 35), (z - lagoonZ) * 0.8);
      if (lag < 70) h = lerp(-1.6, h, smoothstep(40, 70, lag));
      heights[idx(i, j)] = h;
      // cover: 0 = golden grass, 1 = green. Green near water, in canyons, north slopes, redwoods.
      const moist = n2.fbm(x / 380, z / 380, 3) * 0.35 + 0.35 + smoothstep(120, 0, dc) * 0.5 + smoothstep(300, 900, x + -z * 0.9) * 0.6;
      cover[idx(i, j)] = clamp(moist, 0, 1);
    }
  }
  return {
    def,
    heights,
    cover,
    rivers: [creek],
    treeRule: (x, z, h, slope, c, r) => {
      if (h < 3) return null;
      const redwood = x + -z * 0.9 > 420 && h > 40;
      if (redwood) return { kind: r < 0.85 ? 'redwood' : 'pine', p: 0.8 };
      if (c > 0.72) return { kind: r < 0.3 ? 'pine' : 'oak', p: 0.55 };
      if (c > 0.48) return { kind: 'oak', p: 0.16 }; // oak savanna
      return r < 0.08 ? { kind: 'shrub', p: 0.4 } : { kind: 'oak', p: 0.035 };
    },
  };
}

// ---------------------------------------------------------------- Florida
function genFlorida(def: MapDef): MapData {
  const rng = new Rng(def.seed);
  const n = new Noise2D(def.seed);
  const n2 = new Noise2D(def.seed + 11);
  const heights = new Float32Array(HM_N * HM_N);
  const cover = new Float32Array(HM_N * HM_N);

  // Coast runs along the south; a barrier island sits offshore with a lagoon behind it.
  const bayous: V2[][] = [];
  for (let k = 0; k < 4; k++) {
    const sx = -HALF * 0.8 + k * 480 + rng.range(-100, 100);
    bayous.push(meander(rng, n2, { x: sx, z: -HALF - 40 }, { x: sx + rng.range(-300, 300), z: 330 }, 150, 12, 200));
  }
  const dBayou = newField(1e9);
  for (const b of bayous) stampDistance(dBayou, b, 90);
  // sinkhole lakes
  const lakes: { x: number; z: number; r: number }[] = [];
  for (let k = 0; k < 9; k++) lakes.push({ x: rng.range(-900, 900), z: rng.range(-900, 150), r: rng.range(28, 75) });

  for (let j = 0; j < HM_N; j++) {
    for (let i = 0; i < HM_N; i++) {
      const x = wx(i), z = wx(j);
      const shore = 360 + n.fbm(x / 800, 1.3, 4) * 90;
      const d = shore - z; // meters inland (positive = land)
      let h: number;
      if (d > 0) {
        const base = 1.4 + smoothstep(0, 900, d) * 2.2 + n.fbm(x / 500, z / 500, 5) * 1.1;
        const beach = smoothstep(0, 40, d);
        h = lerp(0.2, base, beach);
        // marsh depressions
        const m = n2.fbm(x / 300 + 4, z / 300, 4);
        if (m > 0.12) h = lerp(h, 0.35 + (0.3 - Math.min(0.3, m)) * 0.8, smoothstep(0.12, 0.3, m));
      } else {
        // lagoon then barrier island then gulf shelf
        const off = -d;
        const islandC = 150 + n2.noise(x / 600, 3) * 25;
        const islandW = 34 + n.noise(x / 300, 8) * 10;
        const di = Math.abs(off - islandC);
        const gap = Math.abs(((x + 2048) % 1400) - 700) < 60; // a pass through the island
        if (di < islandW && !gap) {
          h = 0.4 + (1 - di / islandW) * 2.4;
        } else if (off < islandC) {
          h = -1.3 - Math.sin((off / islandC) * Math.PI) * 1.2; // shallow lagoon
        } else {
          h = -1.2 - (off - islandC) * 0.012 - Math.max(0, off - islandC - 350) * 0.05; // long turquoise shelf
        }
      }
      const db = dBayou[idx(i, j)];
      const bw = 9 + n.noise(x / 150, z / 150) * 3;
      if (db < bw * 2.5 && d > -10) h = lerp(-1.4, h, smoothstep(bw * 0.6, bw * 2.5, db));
      for (const L of lakes) {
        const dl = Math.hypot(x - L.x, z - L.z);
        if (dl < L.r * 1.4) h = lerp(-2.5, h, smoothstep(L.r * 0.8, L.r * 1.4, dl));
      }
      heights[idx(i, j)] = h;
      cover[idx(i, j)] = clamp(n.fbm(x / 350 + 2, z / 350, 3) * 0.6 + 0.5, 0, 1);
    }
  }
  return {
    def,
    heights,
    cover,
    rivers: bayous,
    treeRule: (x, z, h, slope, c, r) => {
      if (h < 0.05) return h > -0.9 && c > 0.55 ? { kind: 'cypress', p: 0.18 } : null; // cypress standing in water
      if (h < 0.9) return c > 0.6 ? { kind: 'cypress', p: 0.35 } : r < 0.05 ? { kind: 'mangrove', p: 0.5 } : null;
      if (h < 1.6 && z > 250) return { kind: r < 0.5 ? 'palm' : 'mangrove', p: 0.2 };
      if (c > 0.62) return { kind: r < 0.65 ? 'pine' : 'decid', p: 0.42 }; // pine flatwoods + hammocks
      if (c > 0.45) return { kind: r < 0.5 ? 'palm' : 'shrub', p: 0.1 };
      return r < 0.3 ? { kind: 'palm', p: 0.03 } : null;
    },
  };
}

export function generateMap(id: MapId): MapData {
  const def = MAPS.find((m) => m.id === id)!;
  if (id === 'appalachia') return genAppalachia(def);
  if (id === 'norcal') return genNorcal(def);
  return genFlorida(def);
}
