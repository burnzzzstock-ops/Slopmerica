import * as THREE from 'three';
import { WATER } from '../config';
import { closestOnSampled, clamp, lerp, locate, norm, sub } from '../core/math';
import { hash2 } from '../core/rng';
import type { Game, Selection } from '../game';
import type { RSeg } from '../roads/network';
import { ROAD_TYPES } from '../roads/roadTypes';
import { CUSTOM_BUILDINGS, isZoned, type Bld } from '../sim/buildings';
import { registerInspector, registerPanel, registerSystem, registerTool, registerView } from '../ext/registry';
import { busDepotModel } from '../buildings/transitModels';
import { TransitRenderer } from './render';
import type { FarePolicy, TransitLine, TransitSave, TransitStats, TransitStop } from './types';

const DEPOT_COST = 24_000;
const WALK_LIMIT = 350;
const BUS_CAPACITY = 52;
const COLORS = [0x16a4d8, 0xf04e3e, 0xf0b429, 0x7ac943, 0xa76ee6, 0xff5ca8, 0x44c8aa];
const NAMES = ['The 69 Express', 'Route 420 Crosstown', 'Grievance Line', 'The Stroad Dodger', 'Freedom Loop', 'Late Stage Limited', 'Bus McBusface'];
const FARE: Record<FarePolicy, { label: string; price: number; demand: number }> = {
  free: { label: 'Free', price: 0, demand: 1.28 },
  standard: { label: '$2', price: 2, demand: 1 },
  surge: { label: '$9 surge pricing', price: 9, demand: 0.42 },
};

CUSTOM_BUILDINGS.set('busDepot', { label: "SLOP TRANSIT — We're Basically Uber", w: 5, d: 4, buildDays: 5, model: busDepotModel });

interface BusRun {
  key: string;
  lineId: number;
  slot: number;
  currentStop: number | null;
  nextIndex: number;
  dwell: number;
  driving: boolean;
  returning: boolean;
}

interface WalkAccess { lineId: number; distance: number }
interface RouteResult { distance: number; nodes: number[] }

class MinHeap {
  private a: { id: number; d: number }[] = [];
  get size() { return this.a.length; }
  push(id: number, d: number) {
    this.a.push({ id, d });
    for (let i = this.a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (this.a[p].d <= this.a[i].d) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (!top || !last || !this.a.length) return top;
    this.a[0] = last;
    for (let i = 0;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < this.a.length && this.a[l].d < this.a[m].d) m = l;
      if (r < this.a.length && this.a[r].d < this.a[m].d) m = r;
      if (m === i) break;
      [this.a[m], this.a[i]] = [this.a[i], this.a[m]]; i = m;
    }
    return top;
  }
}

const runtime = new WeakMap<Game, TransitSystem>();
export const transitFor = (g: Game) => runtime.get(g);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export class TransitSystem {
  readonly lines = new Map<number, TransitLine>();
  readonly stops = new Map<number, TransitStop>();
  readonly stats: TransitStats = { ridersToday: 0, ridersThisWeek: 0, divertedCarTrips: 0, busesCompletedLoops: 0, servedBuildings: 0, modeShare: 0 };
  fare: FarePolicy = 'standard';
  nextLine = 1;
  nextStop = 1;
  private modeRoll = 0;
  unlockedNotice = false;
  private renderer: TransitRenderer;
  private draft: number[] = [];
  private draftColor = COLORS[0];
  private access = new Map<number, WalkAccess[]>();
  private runs = new Map<string, BusRun>();
  private retiredLineStops = new Map<number, number[]>();
  private blockedCells = new Map<number, number>();
  private visualDirty = true;
  private accessDirty = true;
  private fleetT = 0;
  private tintT = 0;
  private readonly proxyModel = busDepotModel();

  constructor(readonly g: Game) {
    this.renderer = new TransitRenderer(g);
    runtime.set(g, this);
    (g as Game & { transit?: TransitSystem }).transit = this;
    // Hooks are callbacks rather than hard dependencies, so loading a city without transit state remains safe.
    g.traffic.transitModeChoice = (from, to) => this.chooseTransit(from, to);
    g.peds.transitStops = () => this.waitingStops();
    g.sim.hooks.weekly.push((add) => {
      const activeBuses = [...this.lines.values()].reduce((n, l) => n + (this.lineCanRun(l) ? l.buses : 0), 0);
      const depotCount = this.depots().length;
      const upkeep = activeBuses * 135 + depotCount * 420;
      const fares = [...this.lines.values()].reduce((n, l) => n + l.lastWeekRiders, 0) * FARE[this.fare].price;
      if (upkeep) add('SLOP Transit operations', upkeep, 'other');
      if (fares) add('Bus fares', -fares, 'other');
    });
    g.net.events.on('segRemoved', (seg) => this.roadGone(seg.id));
    g.net.events.on('changed', () => { this.accessDirty = true; this.visualDirty = true; });
  }

  get unlocked() { return this.g.sim.population >= 300; }
  get drawing() { return this.draft.length > 0; }

  depots() {
    return [...this.g.buildings.list.values()].filter((b) => b.zone === 'service' && b.kind === 'busDepot' && b.state === 'active');
  }

  canPlaceDepot(x: number, z: number) {
    const r = 23;
    const pick = this.g.net.pickSeg(x, z, 42);
    const yaw = pick ? (() => {
      const p = pick.seg.samp.pts[Math.min(pick.seg.samp.pts.length - 1, Math.round((pick.s / pick.seg.length) * (pick.seg.samp.pts.length - 1)))];
      return Math.atan2(p.x - x, p.z - z);
    })() : 0;
    if (!this.unlocked) return { ok: false, yaw, reason: `Unlocks at 300 population (${this.g.sim.population}/300)` };
    if (!this.g.terrain.inBounds(x, z, r + 10)) return { ok: false, yaw, reason: 'Outside the county' };
    if (this.g.net.allowed && !this.g.net.allowed(x, z)) return { ok: false, yaw, reason: "You don't own this land yet. Buy it in 🏞️ Land." };
    if (this.g.terrain.h(x, z) < WATER + 0.8) return { ok: false, yaw, reason: 'The buses are not amphibious' };
    if (!pick) return { ok: false, yaw, reason: 'Needs road access within 40 m' };
    if (this.g.net.pickSeg(x, z, r - 2)) return { ok: false, yaw, reason: 'Overlaps a road' };
    for (const b of this.g.buildings.near(x, z, r + 35)) if (Math.hypot(b.x - x, b.z - z) < r + Math.max(b.hw, b.hd)) return { ok: false, yaw, reason: `Overlaps ${b.label}` };
    if (this.g.communes.at(x, z)) return { ok: false, yaw, reason: 'The drum circle rejected the bus easement' };
    if (DEPOT_COST > this.g.sim.spendable()) return { ok: false, yaw, reason: `Needs ${money(DEPOT_COST)}` };
    return { ok: true, yaw };
  }

  placeDepot(x: number, z: number) {
    const chk = this.canPlaceDepot(x, z);
    if (!chk.ok) { this.g.toast(chk.reason ?? 'Nope', true); this.g.audio.play('error'); return false; }
    const b = this.g.buildings.placeCustom('busDepot', x, z, chk.yaw);
    if (!b) return false;
    this.g.sim.spend(DEPOT_COST, 'Bus depot', 'services');
    this.g.audio.play('build');
    this.g.toast("Bus depot ordered. The sign's confidence exceeds the timetable's.");
    return true;
  }

  addDraftPoint(x: number, z: number) {
    if (!this.unlocked) { this.g.toast(`Transit unlocks at 300 population (${this.g.sim.population}/300)`, true); return false; }
    const hit = this.g.net.pickSeg(x, z, 8);
    if (!hit || hit.seg.type === 'highway') { this.g.toast('Put the stop on a non-highway road', true); return false; }
    const first = this.stops.get(this.draft[0]);
    if (first && this.draft.length >= 2 && Math.hypot(first.x - x, first.z - z) < 18) return this.finishDraft();
    let stop = [...this.stops.values()].find((s) => Math.hypot(s.x - x, s.z - z) < 14);
    if (!stop) stop = this.makeStop(hit.seg, hit.s, x, z);
    const prev = this.stops.get(this.draft[this.draft.length - 1]);
    if (prev) {
      const d = this.stopRoute(prev, stop).distance;
      if (d < 120) { if (!this.linesUsing(stop.id).length) this.removeStop(stop.id); this.g.toast('Stops need breathing room (about 150–400 m)', true); return false; }
      if (d > 450) { if (!this.linesUsing(stop.id).length) this.removeStop(stop.id); this.g.toast('That gap is over 450 m. Add an intermediate stop.', true); return false; }
    }
    if (this.draft.includes(stop.id)) { this.g.toast('That stop is already on this line', true); return false; }
    this.draft.push(stop.id);
    this.blockStopCell(stop);
    this.refreshDraft();
    this.g.audio.play('click');
    return true;
  }

  undoDraft() {
    const id = this.draft.pop();
    if (id !== undefined && !this.linesUsing(id).length) this.removeStop(id);
    this.refreshDraft();
  }

  finishDraft() {
    if (this.draft.length < 2) { this.g.toast('A loop needs at least two stops', true); return false; }
    const line: TransitLine = {
      id: this.nextLine++, name: NAMES[(this.nextLine - 2) % NAMES.length], color: this.draftColor, stopIds: [...this.draft], buses: 1,
      loopLength: 0, weeklyRiders: 0, lastWeekRiders: 0, busiestStop: null, active: true,
    };
    line.loopLength = this.computeLoopLength(line);
    this.lines.set(line.id, line);
    this.draft = [];
    this.draftColor = COLORS[this.nextLine % COLORS.length];
    this.accessDirty = true; this.visualDirty = true;
    this.refreshDraft();
    this.g.toast(`${line.name} created. It will run when an active depot can pretend to supervise it.`);
    return true;
  }

  cancelDraft() {
    for (const id of this.draft) if (!this.linesUsing(id).length) this.removeStop(id);
    this.draft = [];
    this.refreshDraft();
  }

  deleteLine(id: number) {
    const line = this.lines.get(id);
    if (!line) return;
    this.lines.delete(id);
    for (const run of this.runs.values()) if (run.lineId === id) run.returning = true;
    this.retiredLineStops.set(id, [...line.stopIds]);
    this.cleanupUnusedStops();
    this.accessDirty = true; this.visualDirty = true;
  }

  daily() {
    if (this.unlocked && !this.unlockedNotice) { this.unlockedNotice = true; this.g.toast('Public transit unlocked: buses now available for civic disappointment.'); }
    if (this.accessDirty) this.rebuildAccess();
    this.stats.ridersToday = 0;
    for (const stop of this.stops.values()) stop.boardings *= 0.82;
    for (const line of this.lines.values()) {
      line.loopLength = this.computeLoopLength(line);
      if (!this.lineCanRun(line)) { line.busiestStop = null; continue; }
      const served = [...this.access.entries()].filter(([, a]) => a.some((v) => v.lineId === line.id)).map(([id]) => this.g.buildings.list.get(id)).filter((b): b is Bld => !!b);
      const homes = served.filter((b) => b.zone === 'resLow' || b.zone === 'resHigh').reduce((n, b) => n + b.occ, 0);
      const jobs = served.filter((b) => b.zone !== 'resLow' && b.zone !== 'resHigh' && b.zone !== 'service' && b.zone !== 'landmark').reduce((n, b) => n + b.occ, 0);
      const headway = this.headway(line);
      const attractiveness = clamp((18 - headway) / 18, 0.08, 0.72) * FARE[this.fare].demand;
      const capacity = Math.max(1, line.buses * BUS_CAPACITY * 8);
      const raw = Math.round(Math.min(homes * 0.65, jobs * 0.9) * attractiveness);
      const riders = Math.round(raw * Math.min(1, capacity / Math.max(1, raw)));
      line.weeklyRiders += riders;
      this.stats.ridersToday += riders;
      if (line.stopIds.length) {
        const perStop = riders / line.stopIds.length;
        for (const id of line.stopIds) { const s = this.stops.get(id); if (s) s.boardings += perStop; }
        line.busiestStop = line.stopIds.reduce((a, b) => (this.stops.get(a)?.boardings ?? 0) >= (this.stops.get(b)?.boardings ?? 0) ? a : b);
      }
    }
    this.stats.ridersThisWeek = [...this.lines.values()].reduce((n, l) => n + l.weeklyRiders, 0);
    this.stats.servedBuildings = this.access.size;
    const attempts = this.stats.divertedCarTrips + this.g.traffic.totalTrips;
    this.stats.modeShare = attempts ? this.stats.divertedCarTrips / attempts : 0;
    this.visualDirty = true;
    for (const stop of this.stops.values()) this.blockStopCell(stop);
  }

  weekly() {
    for (const line of this.lines.values()) { line.lastWeekRiders = line.weeklyRiders; line.weeklyRiders = 0; }
    this.stats.ridersThisWeek = 0;
  }

  frame(dt: number) {
    const routesVisible = this.g.tools.active === 'ext' && this.g.tools.extTool === 'transit-line' || this.g.overlays.ext?.id === 'transit';
    this.renderer.setRoutesVisible(routesVisible);
    if (this.visualDirty) { this.syncVisuals(); this.visualDirty = false; }
    this.fleetT -= dt;
    if (this.fleetT <= 0) { this.fleetT = 0.5; this.syncFleet(); }
    for (const run of this.runs.values()) {
      if (run.driving) continue;
      if (run.dwell > 0) { run.dwell -= dt * Math.max(0.25, this.g.sim.speed); continue; }
      const line = this.lines.get(run.lineId);
      if (!line || run.returning || run.slot >= line.buses || !this.lineCanRun(line)) this.returnRun(run);
      else this.launchNext(run, line);
    }
    if (this.g.overlays.ext?.id === 'transit') {
      this.tintT -= dt;
      if (this.tintT <= 0) { this.tintT = 0.5; this.tintAccess(); }
    }
  }

  save(): TransitSave {
    return { fare: this.fare, nextLine: this.nextLine, nextStop: this.nextStop, modeRoll: this.modeRoll, lines: [...this.lines.values()].map((l) => ({ ...l, stopIds: [...l.stopIds] })), stops: [...this.stops.values()].map((s) => ({ ...s })) };
  }

  load(data: unknown) {
    const d = data as Partial<TransitSave> | null;
    this.lines.clear(); this.stops.clear(); this.runs.clear(); this.retiredLineStops.clear();
    if (d?.fare && d.fare in FARE) this.fare = d.fare;
    this.nextLine = Math.max(1, Number(d?.nextLine) || 1);
    this.nextStop = Math.max(1, Number(d?.nextStop) || 1);
    this.modeRoll = Math.max(0, Number(d?.modeRoll) || 0);
    for (const s of d?.stops ?? []) if (this.g.net.segs.has(s.seg)) { this.stops.set(s.id, { ...s }); this.blockStopCell(s); }
    for (const l of d?.lines ?? []) {
      const stopIds = l.stopIds.filter((id) => this.stops.has(id));
      if (stopIds.length >= 2) this.lines.set(l.id, { ...l, stopIds, active: true });
    }
    this.accessDirty = true; this.visualDirty = true;
  }

  private makeStop(seg: RSeg, sAlong: number, clickX: number, clickZ: number): TransitStop {
    const at = locate(seg.samp, clamp(sAlong, 0, seg.length));
    const a = seg.samp.pts[at.i], b = seg.samp.pts[at.i + 1];
    const tan = norm(sub(b, a));
    const right = { x: -tan.z, z: tan.x };
    const cx = lerp(a.x, b.x, at.f), cz = lerp(a.z, b.z, at.f);
    const side: 1 | -1 = (clickX - cx) * right.x + (clickZ - cz) * right.z >= 0 ? 1 : -1;
    const off = ROAD_TYPES[seg.type].width / 2 + 1.2;
    const x = cx + right.x * off * side, z = cz + right.z * off * side;
    const y = lerp(seg.hs[at.i], seg.hs[at.i + 1], at.f);
    const stop: TransitStop = { id: this.nextStop++, seg: seg.id, s: clamp(sAlong, 2, seg.length - 2), side, x, y, z, yaw: Math.atan2(tan.x, tan.z), boardings: 0 };
    this.stops.set(stop.id, stop);
    this.visualDirty = true; this.accessDirty = true;
    return stop;
  }

  private blockStopCell(stop: TransitStop) {
    const old = this.blockedCells.get(stop.id);
    if (old && this.g.zones.cells.get(old)?.bld === -1) return;
    const cell = this.g.zones.cellsNear(stop.x, stop.z, 15).filter((c) => c.seg === stop.seg && c.side === stop.side).sort((a, b) => Math.hypot(a.x - stop.x, a.z - stop.z) - Math.hypot(b.x - stop.x, b.z - stop.z))[0];
    if (cell && !cell.bld) { cell.bld = -1; cell.zone = null; this.blockedCells.set(stop.id, cell.id); this.g.zones.markOverlayDirty(); }
  }

  private removeStop(id: number) {
    const cellId = this.blockedCells.get(id), cell = cellId ? this.g.zones.cells.get(cellId) : undefined;
    if (cell?.bld === -1) cell.bld = 0;
    this.blockedCells.delete(id); this.stops.delete(id);
    this.g.zones.markOverlayDirty(); this.visualDirty = true; this.accessDirty = true;
  }

  private linesUsing(stopId: number) { return [...this.lines.values()].filter((l) => l.stopIds.includes(stopId)); }

  private cleanupUnusedStops() {
    const current = new Set([...this.runs.values()].map((r) => r.currentStop).filter((id): id is number => id !== null));
    const retiring = new Set<number>();
    for (const [lineId, ids] of this.retiredLineStops) {
      if ([...this.runs.values()].some((r) => r.lineId === lineId)) for (const id of ids) retiring.add(id);
      else this.retiredLineStops.delete(lineId);
    }
    for (const id of [...this.stops.keys()]) if (!this.linesUsing(id).length && !this.draft.includes(id) && !current.has(id) && !retiring.has(id)) this.removeStop(id);
  }

  private roadGone(segId: number) {
    const affected = new Set([...this.stops.values()].filter((s) => s.seg === segId).flatMap((s) => this.linesUsing(s.id).map((l) => l.id)));
    for (const id of affected) this.deleteLine(id);
    for (const s of [...this.stops.values()]) if (s.seg === segId && !this.linesUsing(s.id).length) this.removeStop(s.id);
    if (affected.size) this.g.toast('A transit line vanished with its road. Planning remains undefeated.', true);
  }

  private anchorForBuilding(b: Bld) {
    const seg = this.g.net.segs.get(b.seg) ?? this.g.net.pickSeg(b.x, b.z, 50)?.seg;
    if (!seg) return null;
    const c = closestOnSampled({ x: b.x, z: b.z }, seg.samp);
    return { seg, s: clamp(c.s, 0, seg.length) };
  }

  private dijkstra(seeds: { id: number; d: number }[], limit = Infinity) {
    const dist = new Map<number, number>(), prev = new Map<number, number>();
    const heap = new MinHeap();
    for (const seed of seeds) if (seed.d < (dist.get(seed.id) ?? Infinity)) { dist.set(seed.id, seed.d); heap.push(seed.id, seed.d); }
    while (heap.size) {
      const cur = heap.pop()!;
      if (cur.d !== dist.get(cur.id) || cur.d > limit) continue;
      const node = this.g.net.nodes.get(cur.id);
      if (!node) continue;
      for (const segId of node.segs) {
        const seg = this.g.net.segs.get(segId); if (!seg) continue;
        const next = seg.a === node.id ? seg.b : seg.a, nd = cur.d + seg.length;
        if (nd < (dist.get(next) ?? Infinity) && nd <= limit) { dist.set(next, nd); prev.set(next, cur.id); heap.push(next, nd); }
      }
    }
    return { dist, prev };
  }

  private anchorRoute(a: { seg: RSeg; s: number }, b: { seg: RSeg; s: number }): RouteResult {
    if (a.seg.id === b.seg.id) return { distance: Math.abs(a.s - b.s), nodes: [] };
    const graph = this.dijkstra([{ id: a.seg.a, d: a.s }, { id: a.seg.b, d: a.seg.length - a.s }]);
    const ca = (graph.dist.get(b.seg.a) ?? Infinity) + b.s;
    const cb = (graph.dist.get(b.seg.b) ?? Infinity) + b.seg.length - b.s;
    const target = ca <= cb ? b.seg.a : b.seg.b;
    const distance = Math.min(ca, cb);
    if (!Number.isFinite(distance)) return { distance, nodes: [] };
    const nodes: number[] = [target];
    for (let n = target, guard = 0; graph.prev.has(n) && guard++ < 5000;) { n = graph.prev.get(n)!; nodes.push(n); }
    nodes.reverse();
    return { distance, nodes };
  }

  private stopRoute(a: TransitStop, b: TransitStop) {
    const as = this.g.net.segs.get(a.seg), bs = this.g.net.segs.get(b.seg);
    return as && bs ? this.anchorRoute({ seg: as, s: a.s }, { seg: bs, s: b.s }) : { distance: Infinity, nodes: [] };
  }

  private computeLoopLength(line: TransitLine) {
    let n = 0;
    for (let i = 0; i < line.stopIds.length; i++) {
      const a = this.stops.get(line.stopIds[i]), b = this.stops.get(line.stopIds[(i + 1) % line.stopIds.length]);
      if (a && b) n += this.stopRoute(a, b).distance;
    }
    return Number.isFinite(n) ? n : 0;
  }

  headway(line: TransitLine) {
    if (!line.buses || !line.loopLength) return Infinity;
    return (line.loopLength / 8.5 / 60 + line.stopIds.length * 0.22) / line.buses;
  }

  private rebuildAccess() {
    this.access.clear();
    for (const line of this.lines.values()) {
      if (!line.stopIds.length) continue;
      const seeds: { id: number; d: number }[] = [];
      for (const id of line.stopIds) {
        const stop = this.stops.get(id), seg = stop && this.g.net.segs.get(stop.seg);
        if (stop && seg) seeds.push({ id: seg.a, d: stop.s }, { id: seg.b, d: seg.length - stop.s });
      }
      const { dist } = this.dijkstra(seeds, WALK_LIMIT);
      for (const b of this.g.buildings.list.values()) {
        if (!isZoned(b) || b.state !== 'active') continue;
        const a = this.anchorForBuilding(b); if (!a) continue;
        let d = Math.min((dist.get(a.seg.a) ?? Infinity) + a.s, (dist.get(a.seg.b) ?? Infinity) + a.seg.length - a.s);
        for (const stopId of line.stopIds) {
          const stop = this.stops.get(stopId);
          if (stop?.seg === a.seg.id) d = Math.min(d, Math.abs(stop.s - a.s));
        }
        if (d <= WALK_LIMIT) {
          const arr = this.access.get(b.id) ?? [];
          arr.push({ lineId: line.id, distance: d }); this.access.set(b.id, arr);
        }
      }
    }
    this.accessDirty = false;
  }

  private lineCanRun(line: TransitLine) { return line.active && line.buses > 0 && line.stopIds.length >= 2 && this.depots().length > 0; }

  private chooseTransit(from: Bld, to: Bld) {
    if (this.accessDirty) this.rebuildAccess();
    const fa = this.access.get(from.id) ?? [], ta = this.access.get(to.id) ?? [];
    if (!fa.length || !ta.length) return false;
    let best: { walk: number; wait: number; lines: TransitLine[] } | null = null;
    for (const f of fa) for (const t of ta) {
      const a = this.lines.get(f.lineId), b = this.lines.get(t.lineId);
      if (!a || !b || !this.lineCanRun(a) || !this.lineCanRun(b)) continue;
      const direct = a.id === b.id;
      const transfer = !direct && a.stopIds.some((id) => b.stopIds.includes(id));
      if (!direct && !transfer) continue;
      const wait = this.headway(a) / 2 + (direct ? 0 : this.headway(b) / 2 + 4);
      if (!best || wait < best.wait) best = { walk: (f.distance + t.distance) / 1.35 / 60, wait, lines: direct ? [a] : [a, b] };
    }
    if (!best) return false;
    const oa = this.anchorForBuilding(from), da = this.anchorForBuilding(to);
    if (!oa || !da) return false;
    const distance = this.anchorRoute(oa, da).distance;
    if (!Number.isFinite(distance)) return false;
    const carMinutes = distance / 12 / 60 + 4.5;
    const transitMinutes = best.walk + best.wait + distance / 8.5 / 60;
    const crowded = Math.max(...best.lines.map((l) => l.weeklyRiders / Math.max(1, l.buses * BUS_CAPACITY * 56)));
    const crowdMul = 1 / (1 + Math.max(0, crowded - 1) * 1.6);
    const p = clamp((1 / (1 + Math.exp(-0.72 * (carMinutes - transitMinutes)))) * FARE[this.fare].demand * crowdMul, 0.015, 0.88);
    if (hash2(from.id * 4099 + to.id, this.modeRoll++, Math.floor(this.g.sim.day)) >= p) return false;
    this.stats.divertedCarTrips++;
    this.stats.ridersThisWeek++;
    for (const line of best.lines) line.weeklyRiders++;
    return true;
  }

  private waitingStops() {
    return [...this.stops.values()].filter((s) => s.boardings > 0.5).map((s) => ({ id: s.id, seg: s.seg, s: s.s, side: s.side, label: 'Waiting for SLOP Transit', riders: s.boardings }));
  }

  private stopProxy(stop: TransitStop): Bld {
    return { id: -stop.id, zone: 'service', kind: 'busStop', level: 1, w: 1, d: 1, x: stop.x, y: stop.y, z: stop.z, yaw: stop.yaw, hw: 1, hd: 1, cells: [], seg: stop.seg, label: 'Bus stop', model: this.proxyModel, state: 'active', progress: 1, buildDays: 0, cap: 0, occ: 0, lv: 0, levelProgress: 0, born: 0, inst: -1, buildInst: -1, buildH: 1, emitT: 0 };
  }

  private syncFleet() {
    for (const line of this.lines.values()) {
      for (let slot = 0; slot < line.buses; slot++) {
        const key = `${line.id}:${slot}`;
        if (!this.runs.has(key)) this.runs.set(key, { key, lineId: line.id, slot, currentStop: null, nextIndex: 0, dwell: slot * 1.5, driving: false, returning: false });
      }
    }
    for (const run of this.runs.values()) {
      const line = this.lines.get(run.lineId);
      if (!line || run.slot >= line.buses) run.returning = true;
    }
  }

  private launchNext(run: BusRun, line: TransitLine) {
    const depot = this.depots()[run.slot % Math.max(1, this.depots().length)];
    const stop = this.stops.get(line.stopIds[run.nextIndex]);
    if (!depot || !stop) { run.dwell = 2; return; }
    const from = run.currentStop === null ? depot : this.stopProxy(this.stops.get(run.currentStop) ?? stop);
    run.driving = true;
    const car = this.g.traffic.dispatch('cityBus', from, this.stopProxy(stop), `running ${line.name}`, `Stop ${run.nextIndex + 1}`, this.g.hour, { sober: true, local: true, onDone: (_car, arrived) => {
      run.driving = false;
      if (arrived) {
        run.currentStop = stop.id;
        stop.boardings += Math.max(1, Math.round(line.lastWeekRiders / Math.max(1, line.stopIds.length * 14)));
        run.nextIndex = (run.nextIndex + 1) % line.stopIds.length;
        if (run.nextIndex === 0) this.stats.busesCompletedLoops++;
        run.dwell = 8 + Math.random() * 12;
      } else run.dwell = 3;
      if (!this.lines.has(run.lineId)) run.returning = true;
    } });
    if (!car) { run.driving = false; run.dwell = 2; }
  }

  private returnRun(run: BusRun) {
    if (run.driving) return;
    const depot = this.depots()[0], stop = run.currentStop !== null ? this.stops.get(run.currentStop) : null;
    if (!depot || !stop) { this.runs.delete(run.key); this.cleanupUnusedStops(); return; }
    run.driving = true; run.returning = true;
    const car = this.g.traffic.dispatch('cityBus', this.stopProxy(stop), depot, 'deadheading to depot', depot.label, this.g.hour, { sober: true, local: true, onDone: () => { this.runs.delete(run.key); this.cleanupUnusedStops(); } });
    if (!car) { this.runs.delete(run.key); this.cleanupUnusedStops(); }
  }

  private pathForLine(line: TransitLine) {
    const points: THREE.Vector3[] = [];
    const add = (x: number, z: number, y = this.g.terrain.h(x, z)) => { const last = points[points.length - 1]; if (!last || Math.hypot(last.x - x, last.z - z) > 0.5) points.push(new THREE.Vector3(x, y, z)); };
    const along = (seg: RSeg, fromS: number, toS: number) => {
      const forward = toS >= fromS;
      const ids: number[] = [];
      for (let j = 0; j < seg.samp.cum.length; j++) if (seg.samp.cum[j] > Math.min(fromS, toS) && seg.samp.cum[j] < Math.max(fromS, toS)) ids.push(j);
      if (!forward) ids.reverse();
      for (const j of ids) add(seg.samp.pts[j].x, seg.samp.pts[j].z, seg.hs[j]);
    };
    for (let i = 0; i < line.stopIds.length; i++) {
      const a = this.stops.get(line.stopIds[i]), b = this.stops.get(line.stopIds[(i + 1) % line.stopIds.length]);
      if (!a || !b) continue;
      const as = this.g.net.segs.get(a.seg), bs = this.g.net.segs.get(b.seg), route = this.stopRoute(a, b);
      add(a.x, a.z, a.y);
      if (as && bs && !route.nodes.length && as.id === bs.id) along(as, a.s, b.s);
      else if (as && bs && route.nodes.length) {
        const first = route.nodes[0];
        along(as, a.s, first === as.a ? 0 : as.length);
        for (let j = 0; j < route.nodes.length - 1; j++) {
          const n = this.g.net.nodes.get(route.nodes[j]);
          const next = route.nodes[j + 1];
          const seg = n?.segs.map((id) => this.g.net.segs.get(id)).find((s): s is RSeg => !!s && (s.a === next || s.b === next));
          if (seg) along(seg, seg.a === n?.id ? 0 : seg.length, seg.a === next ? 0 : seg.length);
        }
        const last = route.nodes[route.nodes.length - 1];
        along(bs, last === bs.a ? 0 : bs.length, b.s);
      }
      add(b.x, b.z);
    }
    return points;
  }

  private refreshDraft() {
    if (this.draft.length < 2) this.renderer.setDraft([], this.draftColor);
    else this.renderer.setDraft(this.pathForLine({ id: 0, name: '', color: this.draftColor, stopIds: this.draft, buses: 0, loopLength: 0, weeklyRiders: 0, lastWeekRiders: 0, busiestStop: null, active: true }), this.draftColor);
    this.renderer.syncStops(this.stops.values());
  }

  private syncVisuals() {
    this.renderer.syncStops(this.stops.values());
    this.renderer.syncLines(this.lines.values(), (line) => this.pathForLine(line));
    this.refreshDraft();
  }

  tintAccess() {
    if (this.accessDirty) this.rebuildAccess();
    const good = new THREE.Color(0x36d98b), bad = new THREE.Color(0x554c62), depot = new THREE.Color(0x16a4d8);
    this.g.overlays.tintBuildings((b) => b.kind === 'busDepot' ? depot : isZoned(b) ? (this.access.has(b.id) ? good : bad) : null);
  }

  renderPanel(el: HTMLElement, rerender: () => void) {
    if (!this.unlocked) {
      el.innerHTML = `<div class="sp-title">Public Transit <small>Population unlock</small></div><p>Reach 300 residents to unlock buses. Current population: <b>${this.g.sim.population}/300</b>.</p>`;
      return;
    }
    const depotCount = this.depots().length;
    el.innerHTML = `<div class="sp-title">SLOP Transit <small>${depotCount ? `${depotCount} active depot(s)` : 'Lines require an active depot'}</small></div>
      <div class="sp-row"><button class="chip" data-action="depot">🏚️ Place depot · ${money(DEPOT_COST)}</button><button class="chip" data-action="line">➕ Draw bus line</button>${this.drawing ? '<button class="chip on" data-action="done">Done / close loop</button><button class="chip" data-action="undo">Undo stop</button>' : ''}</div>
      <div class="sp-row"><b>City fare</b>${(Object.keys(FARE) as FarePolicy[]).map((f) => `<button class="chip ${this.fare === f ? 'on' : ''}" data-fare="${f}">${FARE[f].label}</button>`).join('')}</div>
      <div class="sp-list">${[...this.lines.values()].map((line) => {
        const busiest = line.busiestStop ? this.stops.get(line.busiestStop) : null;
        const h = this.headway(line);
        const income = line.lastWeekRiders * FARE[this.fare].price;
        return `<div class="li" style="border-left:6px solid #${line.color.toString(16).padStart(6, '0')};gap:6px">
          <div class="sp-row" style="width:100%"><input data-name="${line.id}" value="${esc(line.name)}" maxlength="32" aria-label="Line name" style="min-width:150px;flex:1;background:#111;color:white;border:1px solid #555;border-radius:6px;padding:7px"><input type="color" data-color="${line.id}" value="#${line.color.toString(16).padStart(6, '0')}" aria-label="Line color"></div>
          <small>${line.stopIds.length} stops · ${Number.isFinite(h) ? h.toFixed(1) : '∞'} min headway · ${line.lastWeekRiders.toLocaleString()} riders/wk</small>
          <small>Fare ${money(income)}/wk · upkeep ${money(line.buses * 135)}/wk · busiest stop ${busiest ? busiest.id : '—'}</small>
          <div class="sp-row"><label>Buses <b>${line.buses}</b> <input type="range" min="1" max="10" value="${line.buses}" data-buses="${line.id}"></label><button class="chip" data-delete="${line.id}">Delete line</button></div>
        </div>`;
      }).join('') || '<p>No routes. Build a depot, then draw a loop by clicking roads.</p>'}</div>`;
    el.querySelector('[data-action="depot"]')?.addEventListener('click', () => { this.g.tools.setExt('transit-depot'); rerender(); });
    el.querySelector('[data-action="line"]')?.addEventListener('click', () => { this.g.tools.setExt('transit-line'); rerender(); });
    el.querySelector('[data-action="done"]')?.addEventListener('click', () => { this.finishDraft(); rerender(); });
    el.querySelector('[data-action="undo"]')?.addEventListener('click', () => { this.undoDraft(); rerender(); });
    el.querySelectorAll<HTMLElement>('[data-fare]').forEach((e) => e.addEventListener('click', () => { this.fare = e.dataset.fare as FarePolicy; rerender(); }));
    el.querySelectorAll<HTMLInputElement>('[data-name]').forEach((e) => e.addEventListener('change', () => { const line = this.lines.get(Number(e.dataset.name)); if (line) line.name = e.value.trim() || line.name; rerender(); }));
    el.querySelectorAll<HTMLInputElement>('[data-color]').forEach((e) => e.addEventListener('change', () => { const line = this.lines.get(Number(e.dataset.color)); if (line) { line.color = Number.parseInt(e.value.slice(1), 16); this.visualDirty = true; } rerender(); }));
    el.querySelectorAll<HTMLInputElement>('[data-buses]').forEach((e) => e.addEventListener('input', () => { const line = this.lines.get(Number(e.dataset.buses)); if (line) line.buses = clamp(Number(e.value), 1, 10); rerender(); }));
    el.querySelectorAll<HTMLElement>('[data-delete]').forEach((e) => e.addEventListener('click', () => { this.deleteLine(Number(e.dataset.delete)); rerender(); }));
  }

  inspector(sel: NonNullable<Selection>) {
    if (sel.kind !== 'building' || !isZoned(sel.b)) return null;
    if (this.accessDirty) this.rebuildAccess();
    const access = this.access.get(sel.b.id) ?? [];
    if (!access.length) return '<div class="in-bind"><span>Transit access</span><b>None within a 350 m walk</b></div>';
    const rows = access.map((a) => {
      const line = this.lines.get(a.lineId);
      return line ? `${esc(line.name)} (${Math.round(a.distance)} m walk, ${this.headway(line).toFixed(1)} min headway)` : '';
    }).filter(Boolean).join('<br>');
    return `<div class="in-bind"><span>Transit access</span><b>${rows}</b></div>`;
  }
}

registerTool({
  id: 'transit-depot', touchLift: 64,
  up(g, p, _e, wasDrag) { if (!wasDrag && p) transitFor(g)?.placeDepot(p.x, p.z); },
  tip(g) {
    const t = transitFor(g), p = g.tools.hoverPoint;
    if (!t || !p) return { text: `Place bus depot · ${money(DEPOT_COST)}` };
    const c = t.canPlaceDepot(p.x, p.z);
    return c.ok ? { text: `Place bus depot · ${money(DEPOT_COST)}` } : { text: c.reason ?? 'Nope', bad: true };
  },
});

registerTool({
  id: 'transit-line', touchLift: 52,
  up(g, p, _e, wasDrag) { if (!wasDrag && p) transitFor(g)?.addDraftPoint(p.x, p.z); },
  cancel(g) { transitFor(g)?.cancelDraft(); },
  tip(g) {
    const t = transitFor(g);
    if (!t?.drawing) return { text: 'Tap a road to place the first stop' };
    return { text: 'Add stops 150–400 m apart · tap first stop or use Done to close · Undo removes the last stop' };
  },
});

registerPanel({
  id: 'transit', icon: '🚌', label: 'Transit', order: 45,
  render(el, g, rerender) { transitFor(g)?.renderPanel(el, rerender); },
  close(g) { if (g.tools.extTool === 'transit-line') transitFor(g)?.cancelDraft(); },
});

registerView({
  id: 'transit', icon: '🚌', label: 'Transit access',
  enable(g) { const t = transitFor(g); t?.tintAccess(); },
  disable(g) { g.overlays.resetBuildingColors(); },
  legend() { return '<span><i style="background:#36d98b"></i>Within a 350 m network walk</span><span><i style="background:#554c62"></i>No access</span><span><i style="background:#16a4d8"></i>Depot</span><span>Stop size = boardings</span>'; },
});

registerInspector((sel, g) => transitFor(g)?.inspector(sel) ?? null);

registerSystem({
  id: 'transit',
  init(g) { new TransitSystem(g); },
  frame(g, dt) { transitFor(g)?.frame(dt); },
  daily(g) { transitFor(g)?.daily(); },
  weekly(g) { transitFor(g)?.weekly(); },
  save(g) { return transitFor(g)?.save(); },
  load(g, data) { transitFor(g)?.load(data); },
});
