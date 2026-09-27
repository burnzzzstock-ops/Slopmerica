// Grid mode for the road tool (as in Cities: Skylines II): pick a corner, the
// first side (it snaps to a road you start on, to 15° and to whole blocks),
// then the width, and a whole street grid goes down at once. Blocks are sized
// in lots: a medium block fits two rows of the deepest lots back to back.
// Streets that are already there are kept, streets that can't be built (too
// steep, water, a commune in the way, out of money) are left out and
// reported, one-ways alternate direction, and the whole grid is one undo.
import { bezTangent, lineCubic, type V2 } from '../core/math';
import { ROAD_TYPES, type RoadTypeId } from '../roads/roadTypes';
import type { RSeg, Snap } from '../roads/network';
import type { Game } from '../game';

export type GridBlock = 'S' | 'M' | 'L';
/** lot rows (8 m cells) on each side of a street, per block size */
export const GRID_BLOCKS: Record<GridBlock, { cells: number; label: string }> = {
  S: { cells: 3, label: 'Small' },
  M: { cells: 4, label: 'Medium' },
  L: { cells: 6, label: 'Large' },
};
/** the most blocks a grid runs in either direction */
export const GRID_MAX = 12;

/** street spacing (centre to centre) for a road type and block size: the road, the lot rows either side */
export function gridSpacing(type: RoadTypeId, block: GridBlock) {
  return ROAD_TYPES[type].width + 0.8 + 2 * GRID_BLOCKS[block].cells * 8;
}

export interface GridShape {
  /** first corner */
  a: V2;
  /** along the first side, and across toward the width (unit vectors) */
  u: V2;
  v: V2;
  /** blocks along and across */
  nu: number;
  nv: number;
  /** street spacing */
  S: number;
}

/**
 * The grid from corner a, first side toward b, width toward c (null: just
 * the first side so far). `align`: directions of a road the corner is on;
 * the first side lines up with one of them when it's close.
 */
export function gridShape(a: V2, b: V2, c: V2 | null, S: number, align: V2[] = []): GridShape | null {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < S * 0.5) return null;
  const raw = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
  let ang = Math.atan2(raw.z, raw.x);
  const best = align.reduce<V2 | null>((m, d) => (!m || d.x * raw.x + d.z * raw.z > m.x * raw.x + m.z * raw.z ? d : m), null);
  if (best && best.x * raw.x + best.z * raw.z > Math.cos(0.35)) ang = Math.atan2(best.z, best.x);
  else {
    const step = Math.PI / 12, snapped = Math.round(ang / step) * step;
    if (Math.abs(snapped - ang) < 0.06) ang = snapped;
  }
  const u = { x: Math.cos(ang), z: Math.sin(ang) };
  const nu = Math.max(1, Math.min(GRID_MAX, Math.round(L / S)));
  let v = { x: -u.z, z: u.x }, nv = 0;
  if (c) {
    const w = (c.x - a.x) * v.x + (c.z - a.z) * v.z;
    if (w < 0) v = { x: -v.x, z: -v.z };
    nv = Math.max(1, Math.min(GRID_MAX, Math.round(Math.abs(w) / S)));
  }
  return { a, u, v, nu, nv, S };
}

export interface GridLine { a: V2; b: V2 }

/**
 * The streets: nv + 1 along the first side, then nu + 1 across (none across
 * before the width is set). One-ways alternate, so every block can be driven
 * around.
 */
export function gridLines(g: GridShape, oneWay = false): GridLine[] {
  const P = (i: number, j: number) => ({ x: g.a.x + (g.u.x * i + g.v.x * j) * g.S, z: g.a.z + (g.u.z * i + g.v.z * j) * g.S });
  const out: GridLine[] = [];
  const add = (a: V2, b: V2, k: number) => out.push(oneWay && k % 2 ? { a: b, b: a } : { a, b });
  for (let j = 0; j <= g.nv; j++) add(P(0, j), P(g.nu, j), j);
  if (g.nv > 0) for (let i = 0; i <= g.nu; i++) add(P(i, 0), P(i, g.nv), i);
  return out;
}

const SNAP = 2.5;

/** a road already runs along (most of) this street */
function alreadyThere(game: Game, l: GridLine) {
  const dx = l.b.x - l.a.x, dz = l.b.z - l.a.z, L = Math.hypot(dx, dz);
  const n = Math.max(2, Math.ceil(L / 6));
  let on = 0;
  for (let k = 0; k <= n; k++) {
    const x = l.a.x + (dx * k) / n, z = l.a.z + (dz * k) / n;
    const p = game.net.pickSeg(x, z, 0.5);
    if (!p) continue;
    const t = bezTangent(p.seg.curve, p.t), tl = Math.hypot(t.x, t.z) || 1;
    if (Math.abs((t.x * dx + t.z * dz) / (tl * L)) > 0.95) on++;
  }
  return on >= (n + 1) * 0.8;
}

export type GridLineState = GridLine & { state: 'ok' | 'bad' | 'have'; reason?: string };

/**
 * What the grid would take, street by street, against today's network (each
 * street planned on its own, so crossings between them aren't priced yet).
 */
export function planGrid(game: Game, g: GridShape, type: RoadTypeId) {
  const net = game.net;
  let cost = 0, grant = 0, length = 0, money = game.sim.spendable();
  const reasons = new Map<string, number>();
  const lines: GridLineState[] = gridLines(g, !!ROAD_TYPES[type].oneWay).map((l) => {
    if (alreadyThere(game, l)) return { ...l, state: 'have' };
    const s = net.snap(l.a.x, l.a.z, SNAP), e = net.snap(l.b.x, l.b.z, SNAP);
    const plan = net.plan(s, lineCubic({ x: s.x, z: s.z }, { x: e.x, z: e.z }), type, money);
    if (plan.ok) { cost += plan.cost; grant += plan.grant; length += plan.length; money -= plan.cost - plan.grant; return { ...l, state: 'ok' }; }
    const why = plan.reason ?? 'Nope';
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
    return { ...l, state: 'bad', reason: why };
  });
  return { lines, cost, grant, length, ok: lines.filter((l) => l.state === 'ok').length, bad: lines.filter((l) => l.state === 'bad').length, have: lines.filter((l) => l.state === 'have').length, reasons };
}

/**
 * Build the grid street by street (later streets cross and join the earlier
 * ones). Returns what went down: the grid's own road pieces (for undo), the
 * streets built, kept and skipped, and what it cost.
 */
export function buildGrid(game: Game, g: GridShape, type: RoadTypeId) {
  const net = game.net, sim = game.sim;
  const lines = gridLines(g, !!ROAD_TYPES[type].oneWay);
  const firstSeg = Math.max(0, ...net.segs.keys()) + 1;
  let cost = 0, grant = 0, length = 0, have = 0, razed = 0, bridge = 0;
  const skipped = new Map<string, number>();
  const built: GridLine[] = [];
  let first: RSeg | null = null;
  game.trees.recordCuts();
  for (const l of lines) {
    if (alreadyThere(game, l)) { have++; continue; }
    const s: Snap = net.snap(l.a.x, l.a.z, SNAP), e: Snap = net.snap(l.b.x, l.b.z, SNAP);
    const curve = lineCubic({ x: s.x, z: s.z }, { x: e.x, z: e.z });
    const plan = net.plan(s, curve, type, sim.spendable());
    const why = plan.reason ?? 'Nope';
    if (!plan.ok) { skipped.set(why, (skipped.get(why) ?? 0) + 1); continue; }
    const segs = net.build(s, e, curve, type);
    if (!segs.length) { skipped.set(why, (skipped.get(why) ?? 0) + 1); continue; }
    sim.spend(plan.cost, 'Road construction');
    if (plan.grant > 0) sim.earn(plan.grant, 'grants');
    cost += plan.cost; grant += plan.grant; length += plan.length; bridge += plan.bridgeLen;
    // one build sound and one news item for the whole grid
    razed += game.onRoadBuilt(segs, plan, !!first);
    first ??= segs[0];
    built.push(l);
  }
  const trees = game.trees.takeCuts();
  // the grid's own pieces: new since we started and lying along a street it
  // built (crossings split the earlier streets, so their first ids are gone;
  // a road that was already there and got split stays out of the undo)
  const onLine = (p: V2) => built.some((l) => {
    const dx = l.b.x - l.a.x, dz = l.b.z - l.a.z, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((p.x - l.a.x) * dx + (p.z - l.a.z) * dz) / L2));
    return Math.hypot(l.a.x + dx * t - p.x, l.a.z + dz * t - p.z) < 1.5;
  });
  const segIds: number[] = [];
  for (const seg of net.segs.values()) {
    if (seg.id < firstSeg || seg.type !== type) continue;
    const P = seg.samp.pts, mid = P[P.length >> 1];
    if (onLine(P[0]) && onLine(P[P.length - 1]) && onLine(mid)) segIds.push(seg.id);
  }
  return { built: built.length, have, total: lines.length, skipped, cost, grant, length, bridge, razed, segIds, trees };
}
