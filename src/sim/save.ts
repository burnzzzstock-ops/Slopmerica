// Save / load to localStorage (per browser). Autosaves every 30s and when the
// tab is hidden. The world is regenerated from its seed; only edits are saved.
import type { Game } from '../game';
import { EXT } from '../ext/registry';
import type { MapId } from '../world/maps';
import type { Mode } from './sim';

const KEY = 'slopmerica.save.v1';

export interface SaveData {
  v: 1;
  savedAt: number;
  map: MapId;
  mode: Mode;
  city: string;
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
  buildings: ReturnType<Game['buildings']['serialize']>;
  communes: [number, string, number, number, number][];
  /** extension system state keyed by system id */
  ext?: Record<string, unknown>;
  /** sim state beyond the core fields (streaks, accumulators, RNG, ledgers, history) */
  simx?: ReturnType<Game['sim']['serializeExtra']>;
}

export function snapshot(g: Game): SaveData {
  return {
    v: 1, savedAt: Date.now(), map: g.map.def.id, mode: g.sim.mode, city: g.cityName, day: g.sim.day, hour: g.hour,
    money: g.sim.money === Infinity ? null : g.sim.money, tax: g.sim.taxRate, loans: g.sim.loans, pop: g.sim.population,
    nature: g.sim.naturePct, sprawl: g.sim.sprawlPct, roads: g.net.serialize(), zones: g.zones.serialize(), buildings: g.buildings.serialize(),
    communes: g.communes.list.map((c) => [c.id, c.state === 'leaving' ? 'gone' : c.state, c.stubborn, c.suitDays, c.suitOdds]),
    ext: Object.fromEntries(EXT.systems.filter((s) => s.save).map((s) => [s.id, s.save!(g)])),
    simx: g.sim.serializeExtra(),
  };
}

export function saveGame(g: Game): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot(g)));
    return true;
  } catch {
    return false;
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d && d.v === 1 ? d : null;
  } catch {
    return null;
  }
}

/** The save exactly as stored (for a bug report's city file), or null. */
export function rawSave(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** A save that crashes the game on load: keep a copy aside, then clear it. */
export function shelveBrokenSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) localStorage.setItem(`${KEY}.broken`, raw);
  } catch {
    /* storage full or blocked: clearing still unblocks the player */
  }
  clearSave();
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
}

export function autosave(g: Game) {
  let t = 0, warned = -Infinity;
  // never fail quietly: a player who thinks the city is safe loses it
  const save = () => {
    if (saveGame(g)) return;
    if (performance.now() - warned < 5 * 60e3) return;
    warned = performance.now();
    g.toast("Couldn't save: this browser's storage is full or blocked. Settings → 🐞 Report bug → Save city file keeps a copy.", true);
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
}
