// The exact state of a county, for saves that bring back the same county and not a similar one.
//
// The rows a save has always held (roads, zoning, buildings, money) are enough to rebuild a town that looks the same. To carry
// on as if nothing happened, everything that shapes the next step has to come back bit for bit: where the dice stand, the
// weather, the ground as roads and lots (some since bulldozed) left it, which trees are down, which lots were valid when they
// were last checked, every car and every person. That is this block (SaveData.state). A save without it (an older save) loads
// the old way: the same town, a fresh start for what moves.
import type { Game } from '../game';
import { fromBase64, toBase64, type Json, type Refs } from '../core/snapshot';
import { transitFor } from '../transit/system';
import { EXT } from '../ext/registry';
import type { Bld, BldRow } from './buildings';

export interface ExactState {
  /** fixed steps since the county began */
  steps: number;
  /** the county's own dice */
  dice: number;
  climate: ReturnType<Game['climate']['save']>;
  buildings: ReturnType<Game['buildings']['serializeState']>;
  zones: ReturnType<Game['zones']['serializeExact']>;
  sim: Json;
  /** per commune: id, state, next protest day, how long it has been leaving */
  communes: [number, string, number, number][];
  /** the ground where it is no longer the untouched valley: runs of cells (start, count) and their heights */
  terrain: { runs: string; heights: string };
  /** one bit a tree, set where it is down */
  trees: string;
  /** every car, signal and queue (Traffic.serialize) */
  traffic: Json;
  /** everyone on foot (Pedestrians.serialize) */
  people: Json;
  /** each extension system's exact state, by id (ExtSystem.saveExact) */
  ext: Record<string, Json>;
  /** demolished buildings something still points at (a car on its way there), as building rows */
  ghosts: BldRow[];
}

/**
 * How the moving parts name what they point at: a building, a road, a junction, a building's model. Those are rebuilt from the
 * save's rows; a car's destination comes back as the building itself, not a copy of it.
 */
export function refsFor(g: Game, cars = true, ghosts: Map<number, Bld> = new Map()): Refs {
  // (the traffic's own snapshot holds the cars themselves; everyone else names a car by its number)
  const carIds = new Map<object, number>(), carById = new Map<number, object>();
  if (cars) for (const c of g.traffic.cars) { carIds.set(c, c.id); carById.set(c.id, c); }
  const models = new Map<object, number>();
  for (const b of g.buildings.list.values()) if (!models.has(b.model)) models.set(b.model, b.id);
  const stopModel = (transitFor(g) as unknown as { proxyModel?: object } | undefined)?.proxyModel ?? null;
  return {
    out(o) {
      const x = o as { id?: unknown; zone?: unknown; hw?: unknown; samp?: unknown; segs?: unknown; geometry?: unknown; emitters?: unknown };
      if (typeof x.id === 'number') {
        if (x.zone !== undefined && x.hw !== undefined && g.buildings.list.get(x.id) === o) return ['b', x.id];
        // a building that has been demolished but is still pointed at: named, and saved once as a row (a bus stop's stand-in has id < 0: plain data)
        if (x.zone !== undefined && x.hw !== undefined && x.id > 0 && x.geometry === undefined) { ghosts.set(x.id, o as Bld); return ['g', x.id]; }
        if (x.samp !== undefined && g.net.segs.get(x.id) === o) return ['s', x.id];
        if (Array.isArray(x.segs) && g.net.nodes.get(x.id) === o) return ['n', x.id];
      }
      // a building's model (its mesh and parking spots): named by a building that wears it; 0 is the bus stops' stand-in
      if (x.geometry !== undefined && x.emitters !== undefined) return ['m', models.get(o) ?? 0];
      const car = carIds.get(o);
      if (car !== undefined) return ['c', car];
      return undefined;
    },
    in(kind, id) {
      if (kind === 'b') return g.buildings.list.get(id as number) ?? null;
      if (kind === 's') return g.net.segs.get(id as number) ?? null;
      if (kind === 'n') return g.net.nodes.get(id as number) ?? null;
      if (kind === 'm') return g.buildings.list.get(id as number)?.model ?? stopModel;
      if (kind === 'c') return carById.get(id as number) ?? null;
      if (kind === 'g') return ghosts.get(id as number) ?? null;
      return null;
    },
  };
}

type TreesInner = { A: Uint8Array; X: Float32Array; Z: Float32Array; n: number };

/** the cells of the heightmap that differ from the valley as generated, as runs */
function terrainDiff(g: Game): ExactState['terrain'] {
  const H = g.terrain.heights, P = g.pristine;
  const runs: number[] = [], vals: number[] = [];
  for (let i = 0; i < H.length; i++) {
    if (H[i] === P[i]) continue;
    let j = i;
    while (j < H.length && H[j] !== P[j]) { vals.push(H[j]); j++; }
    runs.push(i, j - i);
    i = j;
  }
  return { runs: toBase64(new Uint32Array(runs)), heights: toBase64(new Float32Array(vals)) };
}

function applyTerrain(g: Game, t: ExactState['terrain']) {
  const H = g.terrain.heights, P = g.pristine;
  const runs = new Uint32Array(fromBase64(t.runs).buffer), vals = new Float32Array(fromBase64(t.heights).buffer);
  // what every cell should be: the saved height where the save has one, the untouched valley everywhere else
  const want = new Float32Array(P);
  let k = 0;
  for (let r = 0; r < runs.length; r += 2) for (let i = runs[r], end = runs[r] + runs[r + 1]; i < end; i++) want[i] = vals[k++];
  const edits: { id: number; height: number }[] = [];
  for (let i = 0; i < H.length; i++) if (H[i] !== want[i]) edits.push({ id: i, height: want[i] });
  // (the terrain redraws what moved by a millimetre or more; the rest is set as it is, unseen but exact)
  g.terrain.editHeights(edits);
  for (const e of edits) H[e.id] = e.height;
}

function treeBits(g: Game): string {
  const T = g.trees as unknown as TreesInner, bits = new Uint8Array(Math.ceil(T.n / 8));
  for (let i = 0; i < T.n; i++) if (!T.A[i]) bits[i >> 3] |= 1 << (i & 7);
  return toBase64(bits);
}

function applyTrees(g: Game, b64: string) {
  const T = g.trees as unknown as TreesInner, bits = fromBase64(b64);
  const down = new Set<string>(), up: number[] = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < T.n; i++) {
    const dead = ((bits[i >> 3] ?? 0) >> (i & 7)) & 1;
    if (dead && T.A[i]) {
      down.add(`${T.X[i]},${T.Z[i]}`);
      minX = Math.min(minX, T.X[i]); maxX = Math.max(maxX, T.X[i]); minZ = Math.min(minZ, T.Z[i]); maxZ = Math.max(maxZ, T.Z[i]);
    } else if (!dead && !T.A[i]) up.push(i);
  }
  // trees felled by something since bulldozed stay felled; trees an undo put back stay standing
  if (down.size) g.trees.cut(minX - 1, minZ - 1, maxX + 1, maxZ + 1, (x, z) => down.has(`${x},${z}`));
  if (up.length) g.trees.replant(up);
}

/** Everything that is not in the save's rows and shapes what happens next. */
export function captureState(g: Game): ExactState {
  const ghosts = new Map<number, Bld>();
  const state: Omit<ExactState, 'ghosts'> = {
    steps: g.steps,
    dice: g.dice.state,
    climate: g.climate.save(),
    buildings: g.buildings.serializeState(),
    zones: g.zones.serializeExact(),
    sim: g.sim.serializeExact(),
    communes: g.communes.list.map((c) => [c.id, c.state, c.nextProtest, c.leaveT]),
    terrain: terrainDiff(g),
    trees: treeBits(g),
    traffic: g.traffic.serialize(refsFor(g, false, ghosts)),
    people: g.peds.serialize(refsFor(g, true, ghosts)),
    ext: Object.fromEntries(EXT.systems.filter((x) => x.saveExact).map((x) => [x.id, x.saveExact!(g, refsFor(g, true, ghosts))])),
  };
  return { ...state, ghosts: [...ghosts.values()].map((b) => g.buildings.rowOf(b)) };
}

/** After the save's rows have rebuilt the town: put back the exact state. */
export function restoreState(g: Game, s: ExactState, roads?: ReturnType<Game['net']['serialize']>) {
  g.steps = s.steps;
  g.dice.state = s.dice;
  g.climate.load(s.climate);
  g.buildings.restoreState(s.buildings);
  g.sim.restoreExact(s.sim);
  for (const [id, state, nextProtest, leaveT] of s.communes) {
    const c = g.communes.list.find((x) => x.id === id);
    if (!c) continue;
    if (state === 'leaving' && c.state !== 'gone') c.state = 'leaving';
    c.nextProtest = nextProtest;
    c.leaveT = leaveT;
  }
  applyTerrain(g, s.terrain);
  applyTrees(g, s.trees);
  g.zones.restoreExact(s.zones);
  const ghosts = new Map<number, Bld>();
  for (const row of s.ghosts ?? []) { const b = g.buildings.ghostFrom(row); if (b) ghosts.set(b.id, b); }
  g.traffic.restore(s.traffic, refsFor(g, false, ghosts));
  const refs = refsFor(g, true, ghosts);
  g.peds.restore(s.people, refs);
  for (const x of EXT.systems) if (x.loadExact && s.ext && x.id in s.ext && s.ext[x.id] !== null) x.loadExact(g, s.ext[x.id], refs);
  // (a disaster's load() blocks its roads afresh; the roads' own rows say how long each is still blocked)
  for (const row of roads?.segs ?? []) { const seg = g.net.segs.get(row[0]); if (seg && row[12] !== undefined) seg.blocked = row[12]; }
}
