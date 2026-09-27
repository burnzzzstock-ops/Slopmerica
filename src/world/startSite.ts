// Where a new county starts: the town site and the route Old County Road
// takes to it from the edge of the map.
//
// Sites are scored for flat, dry, roomy land with water a short drive away
// (pumps and outfalls need a shore) and a pull toward the middle of the map.
// The best few, spread apart, each get a route from the map's entry edge: the
// cheapest path over a 40 m grid, favouring gentle ground and paying dearly for
// every metre of water, so the road follows the valley and takes one bridge if
// it must (the playtest: the old straight line zig-zagged across the river
// twice). A new game picks one of the good sites at random; automated runs take
// the best one so tests are repeatable, and #start=<n> or #start=random picks.
import { HALF, WATER } from '../config';
import type { V2 } from '../core/math';
import type { Terrain } from './terrain';
import type { Edge } from './maps';

export interface StartSite {
  x: number;
  z: number;
  /** camera yaw looking at the site along the road */
  yaw: number;
  /** where the county road enters the map */
  edge: { x: number; z: number };
  /** the road's path from the edge to the site (none: a straight line) */
  route?: V2[];
}

const edgeFor = (entry: Edge, x: number, z: number) =>
  entry === 'west' ? { x: -HALF + 14, z } : entry === 'east' ? { x: HALF - 14, z } : entry === 'north' ? { x, z: -HALF + 14 } : { x, z: HALF - 14 };
const yawFor = (site: V2, from: V2) => Math.atan2(from.x - site.x, from.z - site.z) + 0.5;

/** The pick every city made before sites were saved (old saves rebuild their communes and land from it). */
export function legacyStart(T: Terrain, entry: Edge): StartSite {
  let best = { x: 0, z: 0 }, bestScore = -Infinity;
  for (let z = -HALF * 0.55; z <= HALF * 0.55; z += 150)
    for (let x = -HALF * 0.55; x <= HALF * 0.55; x += 150) {
      if (T.h(x, z) < 2) continue;
      let flat = 0;
      for (let k = 0; k < 36; k++) {
        const a = k * 2.399, r = 50 + (k / 36) * 330;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (T.h(px, pz) > 1.4 && T.slope(px, pz) < 0.12) flat++;
      }
      const score = flat - (Math.hypot(x, z) / HALF) * 8;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  const edge = edgeFor(entry, best.x, best.z);
  return { ...best, yaw: yawFor(best, edge), edge };
}

// ------------------------------------------------------------------ scoring sites
interface Cand { x: number; z: number; score: number }

function scoreSite(T: Terrain, x: number, z: number): number | null {
  if (T.h(x, z) < WATER + 2 || T.slope(x, z) > 0.1) return null;
  let flat = 0;
  for (let k = 0; k < 48; k++) {
    const a = k * 2.399, r = 40 + (k / 48) * 360;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (T.h(px, pz) > WATER + 1.4 && T.slope(px, pz) < 0.12) flat++;
  }
  if (flat < 30) return null;
  // water a short drive away, not on the doorstep
  let shore = Infinity;
  for (const r of [120, 200, 300, 420, 560, 750]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (T.h(x + Math.cos(a) * r, z + Math.sin(a) * r) < WATER) { shore = r; break; }
    }
    if (shore < Infinity) break;
  }
  const water = shore >= 200 && shore <= 750 ? 6 : shore < 200 ? 2 : 0;
  return flat + water - (Math.hypot(x, z) / HALF) * 6;
}

function candidates(T: Terrain): Cand[] {
  const all: Cand[] = [];
  for (let z = -HALF * 0.62; z <= HALF * 0.62; z += 150)
    for (let x = -HALF * 0.62; x <= HALF * 0.62; x += 150) {
      const s = scoreSite(T, x, z);
      if (s !== null) all.push({ x, z, score: s });
    }
  all.sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z);
  // the best few, spread apart, none far behind the best
  const out: Cand[] = [];
  for (const c of all) {
    if (out.length >= 6 || (out.length && c.score < out[0].score * 0.8)) break;
    if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= 700)) out.push(c);
  }
  return out;
}

// ------------------------------------------------------------------ routing
const G = 40;

/**
 * The cheapest path from (x, z) to the entry edge over a G-metre grid:
 * length, weighted up on slopes, plus a heavy toll per cell of water.
 * Returns the path from the edge to the site, and how much of it is water.
 */
interface Grid { N: number; cost: Float32Array; wet: Uint8Array; hgt: Float32Array }
/** per-cell cost of road: 1 on the flat, more on slopes, a toll for water */
function makeGrid(T: Terrain): Grid {
  const N = Math.floor((2 * HALF) / G);
  const cost = new Float32Array(N * N), wet = new Uint8Array(N * N), hgt = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const cx = -HALF + (i + 0.5) * G, cz = -HALF + (j + 0.5) * G, h = T.h(cx, cz), s = T.slope(cx, cz);
      const w = h < WATER + 0.6;
      wet[j * N + i] = w ? 1 : 0;
      hgt[j * N + i] = h;
      cost[j * N + i] = (w ? 14 : 0) + (s > 0.3 ? 40 : 1 + 30 * Math.max(0, s - 0.04));
    }
  return { N, cost, wet, hgt };
}
/** the climb from one cell to the next: roads take 10% easily, 20% is a wall (bridges aside) */
function gradeToll(g: Grid, c: number, n: number, len: number) {
  if (g.wet[c] || g.wet[n]) return 0;
  const gr = Math.abs(g.hgt[n] - g.hgt[c]) / len;
  return gr > 0.2 ? 1e6 : gr > 0.08 ? len * (gr - 0.08) * 300 : 0;
}

export function routeToEdge(T: Terrain, x: number, z: number, entry: Edge, grid: Grid = makeGrid(T)): { pts: V2[]; water: number; length: number } | null {
  const { N, cost, wet } = grid;
  const at = (i: number) => -HALF + (i + 0.5) * G;
  const idx = (i: number, j: number) => j * N + i;
  const goal = (i: number, j: number) => (entry === 'west' ? i === 1 : entry === 'east' ? i === N - 2 : entry === 'north' ? j === 1 : j === N - 2);
  const hgt = (i: number, j: number) => G * (entry === 'west' ? i - 1 : entry === 'east' ? N - 2 - i : entry === 'north' ? j - 1 : N - 2 - j);
  const si = Math.max(1, Math.min(N - 2, Math.floor((x + HALF) / G))), sj = Math.max(1, Math.min(N - 2, Math.floor((z + HALF) / G)));
  const dist = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1);
  // binary heap of [f, cell]
  const heap: number[] = [], hc: number[] = [];
  const push = (f: number, c: number) => {
    heap.push(f); hc.push(c);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p] <= heap[k]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; [hc[p], hc[k]] = [hc[k], hc[p]]; k = p; }
  };
  const pop = () => {
    const c = hc[0], last = heap.length - 1;
    heap[0] = heap[last]; hc[0] = hc[last]; heap.pop(); hc.pop();
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < heap.length && heap[l] < heap[m]) m = l;
      if (r < heap.length && heap[r] < heap[m]) m = r;
      if (m === k) break;
      [heap[m], heap[k]] = [heap[k], heap[m]]; [hc[m], hc[k]] = [hc[k], hc[m]]; k = m;
    }
    return c;
  };
  const s0 = idx(si, sj);
  dist[s0] = 0;
  push(hgt(si, sj), s0);
  let end = -1;
  while (heap.length) {
    const c = pop(), i = c % N, j = (c - i) / N;
    if (goal(i, j)) { end = c; break; }
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 1 || nj < 1 || ni > N - 2 || nj > N - 2) continue;
        const n = idx(ni, nj), step = G * (di && dj ? Math.SQRT2 : 1);
        const d = dist[c] + step * (cost[c] + cost[n]) * 0.5 + gradeToll(grid, c, n, step);
        if (d < dist[n]) { dist[n] = d; from[n] = c; push(d + hgt(ni, nj), n); }
      }
  }
  if (end < 0) return null;
  const cells: number[] = [];
  for (let c = end; c >= 0; c = from[c]) cells.push(c);
  // cells run edge -> site
  const raw: V2[] = cells.map((c) => ({ x: at(c % N), z: at(Math.floor(c / N)) }));
  const e = edgeFor(entry, raw[0].x, raw[0].z);
  raw[0] = e;
  raw[raw.length - 1] = { x, z };
  let water = 0, length = 0;
  for (let k = 1; k < raw.length; k++) {
    const l = Math.hypot(raw[k].x - raw[k - 1].x, raw[k].z - raw[k - 1].z);
    length += l;
    const c = cells[k];
    if (wet[c]) water += l;
  }
  return { pts: simplify(T, raw), water, length };
}

/** metres of water along a straight line */
function wetAlong(T: Terrain, a: V2, b: V2) {
  const l = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(l / 10));
  let w = 0;
  for (let k = 0; k <= n; k++) if (T.h(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n) < WATER + 0.6) w += l / n;
  return w;
}
/** the steepest ground along a straight line */
function steepAlong(T: Terrain, a: V2, b: V2) {
  const l = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(l / 20));
  let s = 0;
  for (let k = 0; k <= n; k++) s = Math.max(s, T.slope(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n));
  return s;
}

/**
 * Fewer, longer legs (Douglas-Peucker), never cutting a corner across more
 * water or steeper ground than the grid path took; then no leg longer than 320 m.
 */
function simplify(T: Terrain, p: V2[]): V2[] {
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const pathWet = (a: number, b: number) => { let w = 0; for (let k = a + 1; k <= b; k++) w += wetAlong(T, p[k - 1], p[k]); return w; };
  const pathSteep = (a: number, b: number) => { let m = 0; for (let k = a; k <= b; k++) m = Math.max(m, T.slope(p[k].x, p[k].z)); return m; };
  const rec = (a: number, b: number) => {
    if (b - a < 2) return;
    let far = 0, fi = -1;
    const dx = p[b].x - p[a].x, dz = p[b].z - p[a].z, L = Math.hypot(dx, dz) || 1;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((p[k].x - p[a].x) * dz - (p[k].z - p[a].z) * dx) / L;
      if (d > far) { far = d; fi = k; }
    }
    // straight where the land allows: only bend to stay out of water or off steeper ground
    const L2 = Math.hypot(p[b].x - p[a].x, p[b].z - p[a].z);
    const climb = Math.abs(T.h(p[b].x, p[b].z) - T.h(p[a].x, p[a].z)) > 0.1 * L2 + 1;
    if (far > 60 || climb || wetAlong(T, p[a], p[b]) > pathWet(a, b) + 5 || steepAlong(T, p[a], p[b]) > Math.max(0.14, pathSteep(a, b) + 0.04)) {
      // points all on the line: split in the middle
      if (fi <= a || fi >= b) fi = (a + b) >> 1;
      keep[fi] = 1;
      rec(a, fi);
      rec(fi, b);
    }
  };
  rec(0, p.length - 1);
  const pts = p.filter((_, k) => keep[k]);
  const out: V2[] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 320));
    for (let m = 1; m <= n; m++) out.push({ x: a.x + ((b.x - a.x) * m) / n, z: a.z + ((b.z - a.z) * m) / n });
  }
  return out;
}

/**
 * A new county's site and road. `pick`: 'best' (tests), 'random' (players),
 * or a candidate number.
 */
export function pickStart(T: Terrain, entry: Edge, pick: 'best' | 'random' | number, rnd = Math.random): StartSite {
  const cands = candidates(T);
  const grid = makeGrid(T);
  const good: (Cand & { route: V2[]; rank: number })[] = [];
  for (const c of cands) {
    const r = routeToEdge(T, c.x, c.z, entry, grid);
    // a road that's mostly bridge, or a trek across the map, isn't a good start
    if (!r || r.water > 160 || r.length > HALF * 1.6) continue;
    good.push({ ...c, route: r.pts, rank: c.score - r.water / 40 - r.length / 900 });
  }
  if (!good.length) return legacyStart(T, entry);
  good.sort((a, b) => b.rank - a.rank);
  const i = typeof pick === 'number' ? Math.max(0, Math.min(good.length - 1, pick)) : pick === 'best' ? 0 : Math.floor(rnd() * good.length);
  const g = good[i];
  const edge = g.route[0];
  // look at the site along the road's last stretch
  const back = g.route[Math.max(0, g.route.length - 3)];
  return { x: g.x, z: g.z, yaw: yawFor(g, back), edge: { x: edge.x, z: edge.z }, route: g.route };
}

/** how many good sites a map has (tests) */
export function startCandidates(T: Terrain) {
  return candidates(T).length;
}

// tests
(globalThis as unknown as { __startSite?: unknown }).__startSite = { legacyStart, pickStart, routeToEdge, candidates: startCandidates };
