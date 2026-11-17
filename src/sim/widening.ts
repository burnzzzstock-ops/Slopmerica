// ONE MORE LANE, remembered. Every widening is written down with how full the road got at its busiest before it, and that
// is read again once a week for as long as the design says a new lane works ("about 18 months"). The road's inspector draws
// the readings, so the player can watch the traffic come back; the first week it is back where it was, the county's paper
// says so. Nothing here changes the traffic: this only watches it.
//
// "How full at its busiest": the traffic keeps each road's fullness (cars on it over the room it has), which swings with the
// hour, and the day-and-night clock turns once in 144 calendar days, so one reading says more about the hour than the road.
// This keeps, per road, the highest fullness in this turn of that clock and in the one before (two numbers a road), and
// the higher of the two is what "before" and "now" mean here: the fullest it got in the last one to two turns.
import { fromBase64, toBase64, type Json } from '../core/snapshot';
import { registerInspector, registerSystem } from '../ext/registry';
import type { Game } from '../game';
import { ROAD_TYPES, type RoadTypeId } from '../roads/roadTypes';
import { TUNING } from './tuning';

export interface Widening {
  /** the road piece (its id; a piece split by a new junction hands its record to both halves) */
  seg: number;
  /** the calendar day it was widened */
  day: number;
  /** its lanes after, both ways together */
  lanes: number;
  /** the share of the bill the federal grant paid, 0..1 */
  grant: number;
  /** how full it got at its busiest before the lane (1 = bumper to bumper) */
  before: number;
  /** its busiest fullness at each week's end since (the newest last) */
  weeks: number[];
  /** the day its traffic was back to what it was, or null */
  back: number | null;
}

const list = new Map<number, Widening>();
/** each road piece's highest fullness in this turn of the clock and in the last one (see the top of the file) */
const peaks = new Map<number, [number, number]>();
/** calendar days into this turn of the clock */
let turnDay = 0;
const peak = (id: number) => { const p = peaks.get(id); return p ? Math.max(p[0], p[1]) : 0; };
let owner: Game | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (v: number) => `${Math.round(Math.min(1.5, Math.max(0, v)) * 100)}%`;

/** The widening on record for a road piece (the latest), or undefined. */
export const wideningOf = (segId: number): Widening | undefined => list.get(segId);
export const widenings = (): Widening[] => [...list.values()];
/** How full a road piece got at its busiest lately (0 for one never read). */
export const busiestOf = (segId: number): number => peak(segId);

/** lanes one way of the road type that is widened into `to` (the type it was) */
function lanesBefore(to: RoadTypeId): number {
  for (const t of Object.values(ROAD_TYPES)) if (t.next === to) return t.lanesPerDir;
  return ROAD_TYPES[to].lanesPerDir;
}

function record(g: Game, segId: number, lanes: number) {
  const s = g.net.segs.get(segId);
  if (!s) return;
  const was = list.get(segId);
  // (widened again within a fortnight: the same works, so "before" stays what it was before the first of them)
  const before = was && g.sim.day - was.day < 14 ? was.before : Math.max(peak(segId), s.vc);
  list.set(segId, { seg: segId, day: g.sim.day, lanes, grant: ROAD_TYPES[s.type].fedGrant, before, weeks: [], back: null });
  // the same cars have more room now: the peak starts again from what those cars are in the wider road
  const k = lanesBefore(s.type) / ROAD_TYPES[s.type].lanesPerDir, p = peaks.get(segId) ?? [0, 0];
  peaks.set(segId, [Math.fround(Math.max(p[0], s.vc) * k), Math.fround(p[1] * k)]);
}

/** The inspector's block for a widened road: before, now, and a line of the weeks between. */
function chart(w: Widening, now: number, day: number): string {
  const T = TUNING.widening, n = w.weeks.length;
  const W = 220, H = 46, top = Math.max(0.2, w.before, now, ...w.weeks) * 1.1;
  const y = (v: number) => (H - 3 - (Math.min(top, v) / top) * (H - 6)).toFixed(1);
  const pts = w.weeks.map((v, i) => `${(((i + 1) / Math.max(1, T.weeks)) * W).toFixed(1)},${y(v)}`).join(' ');
  const weeks = Math.floor((day - w.day) / 7), months = Math.max(1, Math.round((w.back !== null ? w.back - w.day : day - w.day) / 30));
  const head = w.back !== null
    ? `Back to ${pct(w.before)} full at its busiest after ${months} month${months === 1 ? '' : 's'}. Experts stunned.`
    : weeks > T.weeks ? `Still under what it was after ${T.weeks} weeks.`
    : `At its busiest: ${pct(w.before)} full before the lane, ${pct(now)} now (${weeks} week${weeks === 1 ? '' : 's'} on).`;
  return `<div class="in-widen" data-widen="${w.seg}">
    <div class="in-widen-head"><b>ONE MORE LANE</b> <span>${esc(head)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="How full this road got at its busiest, each week since it was widened: ${pct(w.before)} before, ${pct(now)} now">
      <line x1="0" x2="${W}" y1="${y(w.before)}" y2="${y(w.before)}" class="was"/>
      ${n > 1 ? `<polyline points="${pts}" class="now"/>` : ''}
      ${w.back !== null ? `<circle cx="${(((w.back - w.day) / 7 / Math.max(1, T.weeks)) * W).toFixed(1)}" cy="${y(w.before)}" r="3.2" class="back"/>` : ''}
    </svg>
    <div class="in-widen-key"><span class="k was">before the lane</span><span class="k now">each week since</span>${w.grant > 0 ? `<span>grant paid ${Math.round(w.grant * 100)}%</span>` : ''}</div>
  </div>`;
}

registerSystem({
  id: 'widening',
  init(g) {
    if (owner === g) return;
    owner = g;
    list.clear(); peaks.clear(); turnDay = 0;
    g.sim.events.on('laneAdded', ({ segId, lanes }) => record(g, segId, lanes));
    // a new junction cuts a piece in two: both halves were widened that day, and were as busy
    g.net.events.on('segSplit', ({ old, into }) => {
      const w = list.get(old), p = peaks.get(old);
      list.delete(old); peaks.delete(old);
      for (const s of into) { if (w) list.set(s.id, { ...w, seg: s.id, weeks: [...w.weeks] }); if (p) peaks.set(s.id, [p[0], p[1]]); }
    });
    g.net.events.on('segRemoved', (s) => { list.delete(s.id); peaks.delete(s.id); });
  },
  daily(g) {
    const turn = ++turnDay >= TUNING.widening.peakDays;
    if (turn) turnDay = 0;
    // (single precision: they are saved packed, two numbers a road, and must come back exactly as they were)
    for (const s of g.net.segs.values()) {
      const p = peaks.get(s.id), v = Math.fround(s.vc);
      if (!p) peaks.set(s.id, [v, 0]);
      else if (turn) { p[1] = p[0]; p[0] = v; }
      else if (v > p[0]) p[0] = v;
    }
  },
  weekly(g) {
    const T = TUNING.widening;
    // (in the order they were made: the same order on every machine)
    for (const w of [...list.values()].sort((a, b) => a.day - b.day || a.seg - b.seg)) {
      const s = g.net.segs.get(w.seg);
      if (!s) { list.delete(w.seg); continue; }
      if (w.weeks.length >= T.weeks) continue;
      const now = peak(w.seg);
      w.weeks.push(now);
      // back: as full at its busiest as it was (and it was worth widening: a road nobody was on is "back" by default)
      if (w.back === null && w.before >= T.minBefore && w.weeks.length >= T.minWeeks && now >= w.before) {
        w.back = g.sim.day;
        g.feed.push('laneFilled', { road: s.name, count: Math.max(1, Math.round((w.back - w.day) / 30)) });
      }
    }
  },
  saveExact() {
    const ids = [...peaks.keys()].sort((a, b) => a - b), f = new Float32Array(ids.length * 2);
    ids.forEach((id, i) => { const p = peaks.get(id)!; f[i * 2] = p[0]; f[i * 2 + 1] = p[1]; });
    return { list: [...list.values()].sort((a, b) => a.seg - b.seg).map((w) => ({ ...w, weeks: [...w.weeks] })), turnDay, ids, peaks: toBase64(f) } as unknown as Json;
  },
  loadExact(_g, data) {
    list.clear(); peaks.clear(); turnDay = 0;
    const d = data as unknown as { list?: Widening[]; turnDay?: number; ids?: number[]; peaks?: string } | null;
    if (!d || typeof d !== 'object') return;
    for (const w of d.list ?? []) if (w && Number.isFinite(w.seg)) list.set(w.seg, { seg: w.seg, day: w.day, lanes: w.lanes, grant: w.grant ?? 0, before: w.before, weeks: [...(w.weeks ?? [])], back: w.back ?? null });
    turnDay = d.turnDay ?? 0;
    if (d.ids && typeof d.peaks === 'string') {
      const u = fromBase64(d.peaks), f = new Float32Array(u.buffer, u.byteOffset, Math.floor(u.byteLength / 4));
      d.ids.forEach((id, i) => { if (i * 2 + 1 < f.length) peaks.set(id, [f[i * 2], f[i * 2 + 1]]); });
    }
  },
});

// for the tests (scripts/onemorelane.mjs): the game's own record, whatever copy of this module a test page imports
(globalThis as unknown as { __widening?: unknown }).__widening = { of: wideningOf, all: widenings, busiest: busiestOf };

registerInspector((sel, g) => {
  if (sel.kind !== 'road') return null;
  const w = list.get(sel.s.id);
  return w ? chart(w, peak(sel.s.id), g.sim.day) : null;
});
