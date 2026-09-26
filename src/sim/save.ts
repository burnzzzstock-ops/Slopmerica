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

/**
 * A second, older known-good copy (blueprint: 'retain the previous validated
 * checkpoint'). Refreshed from the last save that parsed, at most every five
 * minutes, so a damaged or crashing save never takes the city with it.
 */
const CHECKPOINT = `${KEY}.checkpoint`;
const CHECKPOINT_EVERY = 5 * 60e3;
let lastCheckpoint = 0;

const parse = (raw: string | null): SaveData | null => {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SaveData;
    // enough to build a world from: the right version and the core sections
    return d && d.v === 1 && d.map && d.roads && d.zones && d.buildings ? d : null;
  } catch {
    return null;
  }
};

export function saveGame(g: Game): boolean {
  let json: string;
  try {
    json = JSON.stringify(snapshot(g));
  } catch {
    return false;
  }
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
    localStorage.setItem(KEY, json);
    return localStorage.getItem(KEY)?.length === json.length;
  } catch {
    return false;
  }
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

/** The save exactly as stored (for a bug report's city file), or null. */
export function rawSave(): string | null {
  try {
    return localStorage.getItem(KEY);
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
