// Street sound, the data half: what every vehicle kind sounds like (engine,
// tyres, horn, siren) plus the small pure functions the voices are driven by
// (Doppler, distance, jam clustering helpers). No WebAudio in here, so the
// numbers can be unit-tested and tuned without a sound card.
//
// Everything is procedural. A profile only names the recipe; streetAudio.ts
// builds the nodes.
import type { VehicleKind } from '../contracts';

export const SOUND_C = 343; // m/s

// ------------------------------------------------------------------ physics
/** Doppler pitch ratio for a source moving away from the listener at `vr` m/s (negative = approaching). */
export function dopplerRatio(vr: number): number {
  const v = vr < -0.7 * SOUND_C ? -0.7 * SOUND_C : vr > 0.7 * SOUND_C ? 0.7 * SOUND_C : vr;
  return SOUND_C / (SOUND_C + v);
}
export const cents = (ratio: number) => 1200 * Math.log2(ratio);

const smooth = (a: number, b: number, x: number) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
/** Loudness left at distance `d` for a source that is nominal at `ref` and inaudible past `reach`. */
export function distGain(d: number, ref: number, reach: number): number {
  const near = d <= ref ? 1 : Math.pow(ref / d, 1.15);
  return near * (1 - smooth(reach * 0.55, reach, d));
}

/** stable 0..1 per car id: who leans on the horn, and what their horn sounds like */
export function hash01(id: number): number {
  let h = Math.imul((id | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ engines
export type EngineWave = 'four' | 'six' | 'v8' | 'diesel' | 'bike' | 'ev' | 'cart';

export interface EngineProfile {
  wave: EngineWave;
  /** firing frequency (Hz) at idle and at the top of the top gear, and the speed (m/s) where that is */
  idle: number;
  top: number;
  vTop: number;
  gears: number;
  /** nominal loudness at `ref` metres under load (linear gain), and the share of it left at standstill */
  level: number;
  idleLevel: number;
  ref: number;
  reach: number;
  /** engine lowpass at idle / at full load (Hz) */
  cut0: number;
  cut1: number;
  /** exhaust / intake noise (0..1) */
  noise: number;
  /** firing lope: amplitude modulation depth at idle and its rate (Hz); fades as the truck gets going */
  rough: number;
  roughHz: number;
  /** tonal whine: level, and its pitch at rest and at top speed. `whineMode` says what drives it. */
  whine: number;
  whine0: number;
  whine1: number;
  whineMode: 'speed' | 'stopped' | 'load' | 'off';
  /** FM depth of the whine (Hz), for the hydraulic warble */
  whineFm: number;
  /** tyre roar scale (heavy trucks roar, golf carts don't) */
  tyre: number;
  /** engine brake: the loud buzz a heavy diesel makes when it lifts off the throttle */
  jake: boolean;
  /** air brakes: a hiss when it stops */
  air: boolean;
}

const E = (o: Partial<EngineProfile> & Pick<EngineProfile, 'wave' | 'idle' | 'top' | 'vTop' | 'level'>): EngineProfile => ({
  gears: 5, idleLevel: 0.2, ref: 12, reach: 210, cut0: 380, cut1: 1500, noise: 0.25, rough: 0, roughHz: 7,
  whine: 0, whine0: 0, whine1: 0, whineMode: 'off', whineFm: 0, tyre: 1, jake: false, air: false, ...o,
});

export const ENGINES: Record<VehicleKind, EngineProfile> = {
  sedan: E({ wave: 'four', idle: 26, top: 110, vTop: 38, level: 0.1, cut0: 380, cut1: 1500 }),
  hatchback: E({ wave: 'four', idle: 30, top: 122, vTop: 36, level: 0.085, cut0: 430, cut1: 1800, noise: 0.3 }),
  suv: E({ wave: 'six', idle: 24, top: 96, vTop: 36, level: 0.115, cut0: 340, cut1: 1300, tyre: 1.15 }),
  minivan: E({ wave: 'six', idle: 23, top: 90, vTop: 34, level: 0.11, cut0: 320, cut1: 1200, tyre: 1.15 }),
  pickup: E({ wave: 'v8', idle: 21, top: 82, vTop: 38, level: 0.13, cut0: 300, cut1: 1100, rough: 0.1, roughHz: 7, ref: 14, tyre: 1.3 }),
  // the lifted truck is the loudest thing that isn't diesel: deep V8 lope, open exhaust, mud tyres
  liftedTruck: E({ wave: 'v8', idle: 17, top: 72, vTop: 40, level: 0.19, cut0: 260, cut1: 1500, noise: 0.55, rough: 0.26, roughHz: 6, ref: 16, reach: 300, tyre: 1.5 }),
  // stainless, silent, and it whines: a rising motor tone instead of a rumble
  cyberslop: E({ wave: 'ev', idle: 90, top: 150, vTop: 44, level: 0.07, idleLevel: 0.05, gears: 1, cut0: 700, cut1: 1400, noise: 0, whine: 0.1, whine0: 700, whine1: 3600, whineMode: 'speed', tyre: 0.8 }),
  semi: E({ wave: 'diesel', idle: 15, top: 58, vTop: 30, level: 0.25, idleLevel: 0.22, cut0: 300, cut1: 950, noise: 0.5, rough: 0.16, roughHz: 5, ref: 18, reach: 340, tyre: 1.4, jake: true, air: true, gears: 6, whine: 0.012, whine0: 2100, whine1: 3500, whineMode: 'load' }),
  boxTruck: E({ wave: 'diesel', idle: 17, top: 65, vTop: 30, level: 0.16, cut0: 320, cut1: 1000, noise: 0.4, rough: 0.1, roughHz: 6, ref: 15, reach: 270, tyre: 1.5, air: true }),
  police: E({ wave: 'v8', idle: 22, top: 92, vTop: 45, level: 0.12, cut0: 320, cut1: 1400, ref: 13, tyre: 1.1 }),
  ambulance: E({ wave: 'diesel', idle: 19, top: 76, vTop: 40, level: 0.14, cut0: 330, cut1: 1100, noise: 0.35, ref: 14, tyre: 1.3 }),
  firetruck: E({ wave: 'diesel', idle: 14, top: 56, vTop: 34, level: 0.2, cut0: 290, cut1: 900, noise: 0.5, rough: 0.14, roughHz: 5, ref: 18, reach: 340, tyre: 1.9, air: true, gears: 6 }),
  golfCart: E({ wave: 'cart', idle: 70, top: 110, vTop: 9, level: 0.04, idleLevel: 0.1, gears: 1, cut0: 900, cut1: 1600, noise: 0, whine: 0.075, whine0: 480, whine1: 1250, whineMode: 'speed', tyre: 0.2, reach: 110 }),
  vwBus: E({ wave: 'four', idle: 30, top: 100, vTop: 26, level: 0.1, cut0: 520, cut1: 1900, noise: 0.35, rough: 0.14, roughHz: 9, tyre: 1.1 }),
  slopVan: E({ wave: 'six', idle: 23, top: 92, vTop: 32, level: 0.13, cut0: 340, cut1: 1300, tyre: 1.3 }),
  // buzzy, high and close to the ear: a small engine wound out
  motorcycle: E({ wave: 'bike', idle: 45, top: 230, vTop: 48, level: 0.3, idleLevel: 0.2, cut0: 1400, cut1: 4800, noise: 0.35, gears: 6, tyre: 0.5, ref: 11, reach: 240 }),
  towTruck: E({ wave: 'diesel', idle: 17, top: 65, vTop: 32, level: 0.16, cut0: 320, cut1: 1000, noise: 0.4, rough: 0.08, roughHz: 6, ref: 15, tyre: 1.5, air: true }),
  cityBus: E({ wave: 'diesel', idle: 16, top: 60, vTop: 28, level: 0.19, idleLevel: 0.25, cut0: 300, cut1: 900, noise: 0.45, rough: 0.1, roughHz: 5.5, ref: 17, reach: 320, tyre: 1.5, air: true, gears: 5 }),
  // the compactor's hydraulic whine is the point: it whirs while the truck stands still
  garbageTruck: E({ wave: 'diesel', idle: 15, top: 56, vTop: 28, level: 0.2, idleLevel: 0.3, cut0: 300, cut1: 900, noise: 0.5, rough: 0.12, roughHz: 5, ref: 17, reach: 320, tyre: 1.6, air: true, whine: 0.09, whine0: 620, whine1: 620, whineMode: 'stopped', whineFm: 40 }),
};

// ------------------------------------------------------------------ horns
export interface HornProfile {
  /** the notes (Hz) */
  f: readonly number[];
  type: OscillatorType;
  /** honk length range (s) */
  len: readonly [number, number];
  /** loudness relative to a car */
  level: number;
  cut: number;
}
const H = (f: number[], type: OscillatorType, len: [number, number], level: number, cut = 2400): HornProfile => ({ f, type, len, level, cut });
export const HORNS: Record<VehicleKind, HornProfile> = {
  sedan: H([415, 523], 'sawtooth', [0.16, 0.42], 1),
  hatchback: H([466, 587], 'sawtooth', [0.14, 0.34], 0.85),
  suv: H([370, 466], 'sawtooth', [0.2, 0.5], 1.05),
  minivan: H([349, 440], 'sawtooth', [0.2, 0.5], 1),
  pickup: H([330, 415], 'sawtooth', [0.25, 0.6], 1.15),
  liftedTruck: H([233, 294, 349], 'sawtooth', [0.4, 1.0], 1.5, 2000), // three-note "truck nuts" horn
  cyberslop: H([440, 660], 'square', [0.18, 0.4], 0.9, 3200), // one flat synthetic chord, no soul
  semi: H([175, 220, 262], 'sawtooth', [0.6, 1.5], 1.9, 1800), // air horn
  boxTruck: H([262, 330], 'sawtooth', [0.3, 0.8], 1.4, 2100),
  police: H([415, 523], 'sawtooth', [0.15, 0.4], 1),
  ambulance: H([392, 494], 'sawtooth', [0.2, 0.5], 1.1),
  firetruck: H([196, 247, 294], 'sawtooth', [0.7, 1.6], 1.9, 1800),
  golfCart: H([660], 'triangle', [0.08, 0.16], 0.5, 3000), // meep
  vwBus: H([520, 660], 'triangle', [0.2, 0.5], 0.8, 3000), // aaa-ooga, a hippie apologising
  slopVan: H([349, 466], 'sawtooth', [0.2, 0.5], 1),
  motorcycle: H([880], 'square', [0.08, 0.22], 0.55, 2800), // a beep, with regret
  towTruck: H([277, 349], 'sawtooth', [0.3, 0.8], 1.3, 2100),
  cityBus: H([311, 392], 'sawtooth', [0.4, 1.0], 1.5, 2000),
  garbageTruck: H([247, 311], 'sawtooth', [0.4, 1.0], 1.5, 2000),
};

// ------------------------------------------------------------------ sirens
/** Only these sound a siren. The tow truck has an amber beacon and nothing else. */
export function hasSiren(kind: VehicleKind): boolean {
  return kind === 'police' || kind === 'ambulance' || kind === 'firetruck';
}

export interface SirenNow {
  /** the tone sweeps center +/- depth (Hz) at `rate` (Hz) along a triangle (or, if !tri, jumps between the two ends: hi-lo) */
  center: number;
  depth: number;
  rate: number;
  tri: boolean;
  /** air horn on (0/1) */
  horn: number;
}
export interface SirenProfile {
  level: number;
  /** lowpass on the carriers (dark mechanical siren vs bright electronic one) */
  cut: number;
  period: number;
  hornF: readonly [number, number];
}
export const SIRENS: Partial<Record<VehicleKind, SirenProfile>> = {
  police: { level: 0.15, cut: 3200, period: 16, hornF: [0, 0] },
  ambulance: { level: 0.16, cut: 3000, period: 14, hornF: [0, 0] },
  firetruck: { level: 0.19, cut: 1500, period: 9, hornF: [262, 330] },
};

/** where in its pattern a siren is at pattern-clock `t` seconds */
export function sirenAt(kind: VehicleKind, t: number, o: SirenNow): SirenNow {
  o.horn = 0;
  if (kind === 'police') {
    const u = t % 16;
    // wail, then a burst of yelp, then wail again
    if (u >= 7 && u < 10) { o.center = 1000; o.depth = 340; o.rate = 3.3; o.tri = true; } else { o.center = 900; o.depth = 380; o.rate = 0.2; o.tri = true; }
  } else if (kind === 'ambulance') {
    const u = t % 14;
    // hi-lo two-tone, then a fast wail
    if (u < 9) { o.center = 800; o.depth = 120; o.rate = 1.35; o.tri = false; } else { o.center = 850; o.depth = 300; o.rate = 0.5; o.tri = true; }
  } else {
    const u = t % 9;
    // the fire engine's slow mechanical wail, with the air horn leaning in
    o.center = 650; o.depth = 260; o.rate = 0.16; o.tri = true;
    if (u >= 6.2 && u < 7.6) o.horn = 1;
  }
  return o;
}

// ------------------------------------------------------------------ jams
export const SLOW_V = 0.8; // m/s: below this a car is "waiting"
/** two waiting cars are in the same queue when their centres are closer than this */
export function queueLink(lenA: number, lenB: number): number {
  return 0.5 * (lenA + lenB) + 5.5;
}
/**
 * Horn rate (honks/s) for one waiting car: `size` cars in its queue, `dwell` seconds stopped, `imp` how
 * impatient this driver is (0..1). Nobody honks in the first few seconds, a lone car at a light never
 * does, and it climbs with the size of the queue.
 */
export function honkRate(size: number, dwell: number, imp: number): number {
  if (size < 3 || imp <= 0) return 0;
  const sizeF = Math.min(3, Math.pow(size - 2, 0.55));
  const dwellF = Math.min(1, Math.max(0, (dwell - 6) / 24));
  return 0.035 * imp * sizeF * dwellF;
}
export const IMPATIENT = 0.35; // hash01(id) below this: a saint, never honks
export function impatience(id: number): number {
  const h = hash01(id);
  return h < IMPATIENT ? 0 : (h - IMPATIENT) / (1 - IMPATIENT);
}
