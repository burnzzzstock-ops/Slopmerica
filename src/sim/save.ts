// Save / load to localStorage (per browser). Autosaves every 30s and when the
// tab is hidden. The world is regenerated from its seed; only edits are saved.
//
// A save has a version. An older one is brought up to date by the functions in MIGRATIONS, one version at a time, before
// anything reads it, so the loader only ever sees today's shape. A big save is stored packed (src/core/lz.ts): the same
// text, a quarter of the characters.
import type { Game } from '../game';
import { EXT } from '../ext/registry';
import type { MapId } from '../world/maps';
import type { Mode } from './sim';
import type { BldRow } from './buildings';
import { captureState, restoreState, type ExactState } from './state';
import { packString, unpackString } from '../core/lz';

/** (the key's name is from the first save format; it holds whatever version the game writes) */
const KEY = 'slopmerica.save.v1';
/** the version this build writes */
export const SAVE_VERSION = 2;
/**
 * A save longer than this many characters is stored packed; a town of a few thousand people stays readable JSON. (Tests that
 * want the packed path for a small town set localStorage['slopmerica.packFrom'] to a smaller number.)
 */
const PACK_FROM = 1_000_000;
const packFrom = () => { try { const v = localStorage.getItem('slopmerica.packFrom'); return v === null ? PACK_FROM : Number(v) || 0; } catch { return PACK_FROM; } };

/**
 * How a save of each older version becomes the next one. A save is run through every step from its own version up.
 *   1 -> 2  Version 2 adds the county's seed and the exact state of everything that moves (`state`). A version 1 save has
 *           neither: its town loads as it always did (roads, zoning, buildings, money, services' rounded numbers), a seed is
 *           drawn for it, and what moves (cars, people, buses, loads on the road, the weather) starts afresh.
 */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  1: (d) => ({ ...d, v: 2 }),
};

export interface SaveData {
  v: number;
  savedAt: number;
  map: MapId;
  mode: Mode;
  city: string;
  /** the county's seed: every stream of dice in the simulation is drawn from it (older saves have none and get one on load) */
  seed?: number;
  day: number;
  hour: number;
  money: number | null;
  tax: number;
  loans: { amount: number; weekly: number; weeksLeft: number }[];
  pop: number;
  nature: number;
  sprawl: number;
  roads: ReturnType<Game['net']['serialize']>;
  zones: ReturnType<Game['zones']['serialize']>;
  buildings: BldRow[];
  communes: [number, string, number, number, number][];
  /** the town site and the county road's way in (communes are placed around it; saves before this rebuild it the old way) */
  start?: { x: number; z: number; yaw: number; edge: { x: number; z: number }; route?: { x: number; z: number }[] };
  /** extension system state keyed by system id */
  ext?: Record<string, unknown>;
  /** sim state beyond the core fields (streaks, accumulators, RNG, ledgers, history) */
  simx?: ReturnType<Game['sim']['serializeExtra']>;
  /** everything else that shapes the next step, bit for bit (src/sim/state.ts). With it a reload carries on as the same county. */
  state?: ExactState;
}

export function snapshot(g: Game): SaveData {
  return {
    v: SAVE_VERSION, savedAt: Date.now(), map: g.map.def.id, mode: g.sim.mode, city: g.cityName, seed: g.seed, day: g.sim.day, hour: g.hour,
    money: g.sim.money === Infinity ? null : g.sim.money, tax: g.sim.taxRate, loans: g.sim.loans, pop: g.sim.population,
    nature: g.sim.naturePct, sprawl: g.sim.sprawlPct, roads: g.net.serialize(), zones: g.zones.serialize(), buildings: g.buildings.serialize(),
    communes: g.communes.list.map((c) => [c.id, c.state, c.stubborn, c.suitDays, c.suitOdds]),
    start: (({ x, z, yaw, edge, route }) => ({ x, z, yaw, edge, route: route?.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 })) }))(g.startView()),
    ext: Object.fromEntries(EXT.systems.filter((s) => s.save).map((s) => [s.id, s.save!(g)])),
    simx: g.sim.serializeExtra(),
    state: captureState(g),
  };
}

/**
 * A second, older known-good copy (blueprint: 'retain the previous validated
 * checkpoint'). Refreshed from the last save that parsed, at most every five
 * minutes, so a damaged or crashing save never takes the city with it.
 */
const CHECKPOINT = `${KEY}.checkpoint`;
const CHECKPOINT_EVERY = 5 * 60e3;
let lastCheckpoint = 0;

/**
 * Whether a save has the shape the loader walks (null: it does), or what is
 * missing. Sections that merely exist aren't enough: a city file with
 * `roads: {}` used to get past the title and die in applySave. Shapes only;
 * the game still guards the values.
 */
export function saveProblem(d: unknown): string | null {
  const s = d as Partial<SaveData> | null;
  if (!s || typeof s !== 'object' || typeof s.v !== 'number' || !(s.v >= 1)) return 'not a Slopmerica city';
  if (s.v > SAVE_VERSION) return 'made by a newer version of the game';
  const arr = Array.isArray, num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  if (typeof s.map !== 'string') return 'no county';
  const r = s.roads;
  if (!r || !arr(r.nodes) || !arr(r.segs) || !arr(r.next) || r.next.length < 3) return 'no roads section';
  if (!r.nodes.every((n) => arr(n) && n.length >= 4) || !r.segs.every((g) => arr(g) && arr(g[4]) && g[4].length >= 4 && g[4].every(arr))) return 'damaged roads';
  if (!arr(s.zones) || !s.zones.every(arr)) return 'damaged zoning';
  if (!arr(s.buildings) || !s.buildings.every((b) => arr(b) && b.length >= 13 && num(b[5]) && num(b[6]))) return 'damaged buildings';
  if (!arr(s.communes) || !s.communes.every(arr)) return 'damaged communes';
  if (!num(s.day) || !num(s.hour) || !num(s.tax) || !num(s.pop) || (s.money !== null && !num(s.money)) || !arr(s.loans)) return 'damaged treasury or clock';
  return null;
}

/**
 * A save as stored or as a file's text (packed or plain, any version this build knows) -> the save in today's shape, or what
 * is wrong with it in a few words ('not JSON', 'not a Slopmerica city', 'made by a newer version of the game', 'damaged roads').
 */
export function readSaveText(text: string): { save: SaveData; problem?: undefined } | { save?: undefined; problem: string } {
  let d: Record<string, unknown>;
  try { d = JSON.parse(unpackString(text)); } catch { return { problem: 'not JSON' }; }
  if (!d || typeof d !== 'object' || typeof d.v !== 'number' || !(d.v >= 1)) return { problem: 'not a Slopmerica city' };
  if (d.v > SAVE_VERSION) return { problem: 'made by a newer version of the game' };
  try { while ((d.v as number) < SAVE_VERSION) d = MIGRATIONS[d.v as number](d); } catch { return { problem: 'damaged' }; }
  const problem = saveProblem(d);
  return problem ? { problem } : { save: d as unknown as SaveData };
}

const parse = (raw: string | null): SaveData | null => (raw ? readSaveText(raw).save ?? null : null);

/** what the last failed save ran into, for the warning: 'full' (no room in this browser's storage) or 'blocked' */
export let saveFailure: 'full' | 'blocked' | null = null;

/** A save's text as it goes into storage: packed when it is big. */
export const storable = (json: string) => (json.length > packFrom() ? packString(json) : json);

export function saveGame(g: Game): boolean {
  let data: SaveData, stored: string;
  try {
    data = snapshot(g);
    stored = storable(JSON.stringify(data));
  } catch {
    saveFailure = 'blocked';
    return false;
  }
  const put = (text: string) => { localStorage.setItem(KEY, text); return localStorage.getItem(KEY)?.length === text.length; };
  try {
    // the save being replaced becomes the checkpoint if it's valid and the old one is stale
    const now = Date.now();
    if (now - lastCheckpoint > CHECKPOINT_EVERY || !localStorage.getItem(CHECKPOINT)) {
      const prev = localStorage.getItem(KEY);
      if (parse(prev) && prev!.length < 1_500_000) {
        try { localStorage.setItem(CHECKPOINT, prev!); lastCheckpoint = now; } catch { /* no room: the main save matters more */ }
      }
    }
    // a browser replaces a key's value whole or not at all
    if (put(stored)) { saveFailure = null; return true; }
  } catch { /* no room, or storage blocked: try to make room below */ }
  // No room. The city matters more than the backup copy, and the town more than where each car is: drop the checkpoint
  // and try again, then save the town without the exact state of what moves (it loads; traffic starts afresh).
  try {
    localStorage.removeItem(CHECKPOINT);
    if (put(stored)) { saveFailure = null; return true; }
  } catch { /* still no room */ }
  try {
    if (put(storable(JSON.stringify({ ...data, state: undefined })))) { saveFailure = 'full'; return true; }
  } catch { /* not even that */ }
  try { localStorage.setItem('slopmerica.probe', '1'); localStorage.removeItem('slopmerica.probe'); saveFailure = 'full'; } catch { saveFailure = 'blocked'; }
  return false;
}

/** Which copy the last load came from, for a notice ('checkpoint' = the main save was damaged). */
export let loadedFrom: 'main' | 'checkpoint' | null = null;

export function loadSave(): SaveData | null {
  try {
    const main = parse(localStorage.getItem(KEY));
    if (main) { loadedFrom = 'main'; return main; }
    const cp = parse(localStorage.getItem(CHECKPOINT));
    loadedFrom = cp ? 'checkpoint' : null;
    return cp;
  } catch {
    return null;
  }
}

/**
 * A city is stored in this browser and cannot be read: what is wrong with it in a few words, or null (nothing stored, or it
 * reads fine, or its checkpoint does). The title screen says so, and nothing is deleted.
 */
export function unreadableSave(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || parse(raw) || parse(localStorage.getItem(CHECKPOINT))) return null;
    return readSaveText(raw).problem ?? null;
  } catch {
    return null;
  }
}

/** The save as readable text (for a bug report's city file), or null. */
export function rawSave(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? unpackString(raw) : null;
  } catch {
    return null;
  }
}

/**
 * A save that crashes the game on load: keep a copy aside, then clear it. The
 * checkpoint (if it isn't the same city state) becomes the save to continue.
 */
export function shelveBrokenSave() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) localStorage.setItem(`${KEY}.broken`, raw);
  } catch {
    /* storage full or blocked: clearing still unblocks the player */
  }
  clearSave();
  try {
    const cp = localStorage.getItem(CHECKPOINT);
    if (cp && cp !== raw && parse(cp)) localStorage.setItem(KEY, cp);
    localStorage.removeItem(CHECKPOINT);
  } catch {
    /* ignore */
  }
}

/** Whether an earlier checkpoint exists to fall back to (the rescue screen offers it). */
export function hasCheckpoint(): boolean {
  try {
    const cp = localStorage.getItem(CHECKPOINT);
    return !!cp && cp !== localStorage.getItem(KEY) && !!parse(cp);
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function applySave(g: Game, d: SaveData) {
  for (const [id, state, stubborn, suitDays, suitOdds] of d.communes) {
    const c = g.communes.list.find((x) => x.id === id);
    if (!c) continue;
    c.stubborn = stubborn;
    c.suitDays = suitDays;
    c.suitOdds = suitOdds;
    if (state === 'gone') {
      c.state = 'gone';
      g.communes.group.remove(c.group);
    } else c.state = state as typeof c.state;
  }
  g.syncBlockers();
  for (const s of EXT.systems) if (s.preload && d.ext && s.id in d.ext) s.preload(g, d.ext[s.id]);
  g.net.restore(d.roads);
  g.zones.update();
  g.zones.restore(d.zones);
  g.buildings.restore(d.buildings);
  g.hour = d.hour;
  g.sim.restoreState(d.day, d.money, d.tax, d.loans, d.pop, d.nature, d.sprawl);
  g.sim.restoreExtra(d.simx);
  for (const s of EXT.systems) if (s.load && d.ext && s.id in d.ext) s.load(g, d.ext[s.id]);
  if (d.state) restoreState(g, d.state, d.roads);
}

export function autosave(g: Game) {
  let t = 0, warned = -Infinity;
  // never fail quietly: a player who thinks the city is safe loses it
  const save = () => {
    if (saveGame(g)) return;
    if (performance.now() - warned < 5 * 60e3) return;
    warned = performance.now();
    g.toast(saveFailure === 'full'
      ? "Couldn't save: this browser has no room left for the city. Settings → 🐞 Report bug → Save city file keeps a copy on your device."
      : "Couldn't save: this browser is blocking storage (private browsing does). Settings → 🐞 Report bug → Save city file keeps a copy on your device.", true);
  };
  g.onFrame.push((dt) => {
    t += dt;
    if (t > 30) {
      t = 0;
      save();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  // the page going away without being hidden first (a new build of the
  // artifact replacing it mid-game rolled a city back to its last autosave)
  window.addEventListener('pagehide', () => save());
}
