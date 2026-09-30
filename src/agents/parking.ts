// Live parking (traffic pass, audit round 7 #6: "an arriving car pulls in for
// 2.2 s and is deleted; a SprawlMart lot looks the same at 3 am as at noon").
//
// Parked cars are drawn instances only: they cost no simulation time and never
// change it. A car arriving at a building with lot stalls or a driveway pulls
// into a free one and stays there; a trip leaving that building takes a parked
// car of its kind and backs it out. Around the camera, lots fill and empty with
// the hour (offices mid-morning, shops at noon, bars at night, homes overnight)
// for buildings out of the middle of the view, so nothing pops in where the
// player is looking. The count is capped by the preset's vehicle pool, and the
// traffic on the road always comes first.
//
// Everything random here uses its own generator, never Math.random: the
// traffic simulation draws the same numbers whatever is parked, so graphics
// presets (which cap the parked cars) can't change the simulation.
import type { ParkSpot, VehicleKind } from '../contracts';
import { clamp } from '../core/math';
import { brandById } from '../art/brands';
import type { Bld, Buildings } from '../sim/buildings';
import { FIXED_PAINT, VEHICLE_SPECS, type VehicleRenderer } from './vehicles';

/** A spot in the world: where a car stands and the way it faces. */
export interface WorldSpot {
  b: Bld;
  /** index into the building model's spots */
  i: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: ParkSpot['kind'];
}

interface Parked {
  h: number;
  kind: VehicleKind;
  spot: WorldSpot;
  /** parked by the fill (not a car that drove here): the first to go when the lot empties */
  fill: boolean;
}

interface Lot {
  model: Bld['model'];
  spots: WorldSpot[];
  /** who is in each spot: a parked car, a car on its way in (held), or free */
  taken: (Parked | 'held' | null)[];
}

/**
 * Share of a lot's spots taken at each hour (0-23), by what the building is.
 * Hand-set defaults; scripts/parkingtags.mjs may refine them per brand
 * (src/agents/parkingTags.ts, read if present).
 */
const CURVES: Record<string, number[]> = {
  home: [0.9, 0.92, 0.92, 0.92, 0.9, 0.85, 0.7, 0.5, 0.35, 0.3, 0.3, 0.32, 0.35, 0.35, 0.35, 0.4, 0.5, 0.65, 0.75, 0.8, 0.85, 0.88, 0.9, 0.9],
  shop: [0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.08, 0.15, 0.25, 0.4, 0.55, 0.65, 0.7, 0.68, 0.6, 0.55, 0.55, 0.6, 0.6, 0.5, 0.35, 0.15, 0.06, 0.03],
  office: [0.03, 0.03, 0.03, 0.03, 0.03, 0.05, 0.15, 0.45, 0.8, 0.88, 0.9, 0.9, 0.85, 0.88, 0.9, 0.85, 0.7, 0.4, 0.2, 0.1, 0.06, 0.04, 0.03, 0.03],
  industry: [0.25, 0.25, 0.25, 0.25, 0.25, 0.35, 0.7, 0.85, 0.85, 0.85, 0.85, 0.85, 0.8, 0.85, 0.85, 0.75, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.3, 0.25],
  bar: [0.5, 0.45, 0.3, 0.15, 0.05, 0.03, 0.03, 0.03, 0.05, 0.08, 0.1, 0.15, 0.25, 0.25, 0.2, 0.2, 0.3, 0.45, 0.6, 0.75, 0.85, 0.9, 0.85, 0.7],
  food: [0.05, 0.03, 0.02, 0.02, 0.03, 0.08, 0.3, 0.45, 0.35, 0.25, 0.35, 0.7, 0.85, 0.6, 0.35, 0.3, 0.4, 0.6, 0.75, 0.6, 0.4, 0.25, 0.15, 0.08],
  gas: [0.15, 0.1, 0.1, 0.1, 0.12, 0.25, 0.45, 0.55, 0.45, 0.4, 0.4, 0.45, 0.5, 0.45, 0.4, 0.45, 0.55, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15],
  church: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.05, 0.1, 0.2, 0.3, 0.3, 0.2, 0.1, 0.08, 0.08, 0.08, 0.1, 0.15, 0.1, 0.05, 0.03, 0.02, 0.02],
};
const KIND_CURVE: Partial<Record<string, string>> = {
  bar: 'bar', food: 'food', coffee: 'food', gas: 'gas', propane: 'gas', church: 'church', office: 'office', tech: 'office', bank: 'office', industry: 'industry', drink: 'industry', storage: 'industry', resort: 'bar',
};

type TagFile = { PARKING_CURVES: Record<string, number[]> };
const tagFiles: Record<string, TagFile> = import.meta.env ? import.meta.glob<TagFile>('./parkingTags.ts', { eager: true }) : {};
const TAGS: Record<string, number[]> = Object.values(tagFiles)[0]?.PARKING_CURVES ?? {};

/** The share of this building's spots taken at this hour. */
export function occupancy(b: Bld, hour: number): number {
  const brand = b.brand ? brandById(b.brand) : undefined;
  const curve = (b.brand && TAGS[b.brand]) || CURVES[
    b.zone === 'resLow' || b.zone === 'resHigh' ? 'home'
      : b.zone === 'office' ? 'office'
      : b.zone === 'industry' ? 'industry'
      : (brand && KIND_CURVE[brand.kind]) || 'shop'
  ];
  const h = ((hour % 24) + 24) % 24, i = Math.floor(h), f = h - i;
  return curve[i] * (1 - f) + curve[(i + 1) % 24] * f;
}

/** kinds of car that park in a stall or a driveway (no semis in the SprawlMart lot) */
const PARK_KINDS: [VehicleKind, number][] = [['pickup', 0.28], ['sedan', 0.2], ['suv', 0.18], ['liftedTruck', 0.07], ['minivan', 0.09], ['hatchback', 0.08], ['cyberslop', 0.04], ['slopVan', 0.03], ['motorcycle', 0.03]];
/** stall-sized kinds: everything longer queues at a drive-thru or pulls into the lot and goes as before */
const FITS = new Set<VehicleKind>(PARK_KINDS.map(([k]) => k));

export class Parking {
  private lots = new Map<Bld, Lot>();
  private parked = new Set<Parked>();
  private seed = 0x5eed1234;
  private t = 0;
  /** most parked cars this preset draws (its vehicle pool less room for the traffic) */
  readonly cap: number;
  /**
   * Is this point on screen? (set by the game from the camera). The hour fills
   * and empties lots only where the player isn't looking; without it, the
   * middle of the view (near the camera's target) counts as on screen.
   */
  inView?: (x: number, z: number) => boolean;
  /** the hour at the last update */
  private hour = 12;
  /** terrain height (set by the game), so a parked car sits where the pull-in left it */
  groundAt?: (x: number, z: number) => number;
  /** a paint for a parked car of this kind (set by the game: the traffic's paint mix) */
  paint: (kind: VehicleKind, rnd: () => number) => number = (k, r) => FIXED_PAINT[k] ?? [0xf2f2f2, 0x1a1a1a, 0x9aa0a6, 0x5a5e63][Math.floor(r() * 4)];

  constructor(private buildings: Buildings, private renderer: VehicleRenderer, private pool: number) {
    this.cap = Math.floor(pool * 0.4);
  }

  /** a number in [0, 1) from parking's own generator (mulberry32) */
  private rnd = () => {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  get count() {
    return this.parked.size;
  }

  /** The lot of a building with stalls or a driveway (drive-thru lanes are the traffic's), or null. */
  private lot(b: Bld): Lot | null {
    let L = this.lots.get(b);
    if (L && L.model !== b.model) { this.clear(b); L = undefined; }
    if (L) return L;
    const src = b.model.spots;
    if (!src || b.state !== 'active') return null;
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const spots: WorldSpot[] = [];
    src.forEach((p, i) => {
      if (p.kind !== 'stall' && p.kind !== 'drive') return;
      const x = b.x + p.x * c + p.z * s, z = b.z - p.x * s + p.z * c;
      spots.push({ b, i, x, y: this.groundAt ? this.groundAt(x, z) + 0.1 : b.y, z, yaw: b.yaw + p.yaw, kind: p.kind });
    });
    if (!spots.length) return null;
    L = { model: b.model, spots, taken: spots.map(() => null) };
    this.lots.set(b, L);
    return L;
  }

  /** Remove every car parked at a building (demolished, rebuilt, or far from the camera). */
  clear(b: Bld) {
    const L = this.lots.get(b);
    if (!L) return;
    L.taken.forEach((p) => { if (p && p !== 'held') this.drop(p); });
    this.lots.delete(b);
  }

  private drop(p: Parked) {
    this.renderer.remove(p.h);
    this.parked.delete(p);
    const L = this.lots.get(p.spot.b);
    const k = L ? L.spots.indexOf(p.spot) : -1;
    if (L && k >= 0 && L.taken[k] === p) L.taken[k] = null;
  }

  private place(p: Parked) {
    const q = p.spot;
    this.renderer.set(p.h, q.x, q.y, q.z, q.yaw);
    this.renderer.setBraking(p.h, false);
    this.renderer.setTurn(p.h, 0);
    (this.renderer as { setParked?: (h: number, on: boolean) => void }).setParked?.(p.h, true);
  }

  /**
   * A car on its way into this building: the free stall or driveway it pulls
   * into (held for it), or null (no room, or a kind that doesn't fit a stall).
   */
  claim(b: Bld, kind: VehicleKind): WorldSpot | null {
    if (!FITS.has(kind)) return null;
    const L = this.lot(b);
    if (!L) return null;
    const free: number[] = [];
    L.taken.forEach((t, i) => { if (!t) free.push(i); });
    // (a lot already as full as the hour has it: this one drops someone off and goes, as before)
    if (!free.length || L.spots.length - free.length >= Math.ceil(L.spots.length * clamp(occupancy(b, this.hour), 0, 1)) + 1) return null;
    // drivers take the nearest free stalls first: the front rows fill before the back
    const k = free[Math.min(free.length - 1, Math.floor(this.rnd() * this.rnd() * free.length))];
    L.taken[k] = 'held';
    return L.spots[k];
  }

  /** A held spot the car never reached (it crashed or its road went). */
  release(spot: WorldSpot) {
    const L = this.lots.get(spot.b), k = L ? L.spots.indexOf(spot) : -1;
    if (L && k >= 0 && L.taken[k] === 'held') L.taken[k] = null;
  }

  /** The car has pulled into its spot: it stays there, drawn by handle `h`. */
  park(spot: WorldSpot, h: number, kind: VehicleKind): boolean {
    const L = this.lots.get(spot.b), k = L ? L.spots.indexOf(spot) : -1;
    if (!L || k < 0 || h < 0) { this.release(spot); return false; }
    const p: Parked = { h, kind, spot, fill: false };
    L.taken[k] = p;
    this.parked.add(p);
    this.place(p);
    return true;
  }

  /**
   * A trip leaving this building in a car of this kind: a parked one, if there
   * is one (its handle and the spot it backs out of). It is no longer parked.
   */
  take(b: Bld, kind: VehicleKind): { h: number; spot: WorldSpot } | null {
    const L = this.lots.get(b);
    if (!L) return null;
    // the same kind, or one as long (the traffic moves it as the length it has)
    const len = VEHICLE_SPECS[kind].length;
    let best = -1;
    for (let k = 0; k < L.taken.length; k++) {
      const p = L.taken[k];
      if (!p || p === 'held') continue;
      if (p.kind === kind) { best = k; break; }
      if (best < 0 && Math.abs(VEHICLE_SPECS[p.kind].length - len) <= 0.4) best = k;
    }
    const p = best >= 0 ? L.taken[best] : null;
    if (!p || p === 'held') return null;
    L.taken[best] = null;
    this.parked.delete(p);
    (this.renderer as { setParked?: (h: number, on: boolean) => void }).setParked?.(p.h, false);
    return { h: p.h, spot: p.spot };
  }

  /**
   * Lots near the camera follow the hour where the player isn't looking; lots
   * far away empty. `drawnNow`: vehicles the renderer draws now (traffic included).
   */
  update(dt: number, hour: number, camX: number, camZ: number, camDist: number, drawnNow: () => number) {
    this.hour = hour;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const R = camDist > 1500 ? 0 : Math.min(700, camDist * 1.3 + 150), quiet = Math.max(90, R * 0.45);
    const seen = this.inView ?? ((x: number, z: number) => Math.hypot(x - camX, z - camZ) < quiet);
    // lots out of range, or gone: empty them
    for (const b of [...this.lots.keys()]) {
      if (b.state !== 'active' || !this.buildings.list.has(b.id) || Math.hypot(b.x - camX, b.z - camZ) > R * 1.15) this.clear(b);
    }
    // room left: the pool less the traffic's share (it always comes first)
    const traffic = drawnNow() - this.parked.size;
    const room = () => Math.min(this.cap, this.pool - 60 - traffic) - this.parked.size;
    if (room() < 0) {
      // too many: the fill cars farthest from the camera go first
      const far = [...this.parked].filter((p) => p.fill).sort((a, b) => Math.hypot(b.spot.x - camX, b.spot.z - camZ) - Math.hypot(a.spot.x - camX, a.spot.z - camZ));
      for (const p of far) { if (room() >= 0) break; this.drop(p); }
    }
    if (!R) return;
    for (const b of this.buildings.near(camX, camZ, R)) {
      const fresh = !this.lots.has(b);
      const L = this.lot(b);
      if (!L) continue;
      // on screen, only cars that drive in and out change a lot (a lot seen for
      // the first time fills at once)
      const off = (q: WorldSpot) => fresh || !seen(q.x, q.z);
      const want = Math.round(L.spots.length * clamp(occupancy(b, hour), 0, 1));
      let have = L.taken.filter((t) => t).length;
      for (let k = 0; k < L.spots.length && have < want && room() > 0; k++) {
        const j = (k * 7 + b.id) % L.spots.length;
        if (L.taken[j] || !off(L.spots[j])) continue;
        const kind = this.pickKind(), h = this.renderer.add(kind, this.paint(kind, this.rnd));
        if (h < 0) break;
        const p: Parked = { h, kind, spot: L.spots[j], fill: true };
        L.taken[j] = p;
        this.parked.add(p);
        this.place(p);
        have++;
      }
      // more than the hour wants: fill cars leave first, then ones that drove in
      for (let k = L.spots.length - 1; k >= 0 && have > want; k--) {
        const p = L.taken[k];
        if (p && p !== 'held' && p.fill && off(p.spot)) { this.drop(p); have--; }
      }
      for (let k = L.spots.length - 1; k >= 0 && have > want; k--) {
        const p = L.taken[k];
        if (p && p !== 'held' && off(p.spot)) { this.drop(p); have--; }
      }
    }
  }

  private pickKind(): VehicleKind {
    let r = this.rnd();
    for (const [k, w] of PARK_KINDS) if ((r -= w) < 0) return k;
    return 'sedan';
  }

  /** Cars parked at each building near a point, for tests and the inspector. */
  parkedAt(b: Bld): { cars: number; spots: number } {
    const L = this.lots.get(b);
    return { cars: L ? L.taken.filter((t) => t && t !== 'held').length : 0, spots: L ? L.spots.length : (b.model.spots ?? []).filter((p) => p.kind === 'stall' || p.kind === 'drive').length };
  }
}
