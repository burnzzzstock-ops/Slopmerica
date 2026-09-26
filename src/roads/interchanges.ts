// Prebuilt road layouts placed in one click (Roads → Interchanges):
// - a roundabout: a ring road with four stubs to connect to
// - a diamond interchange: the cross street bridges the highway on an
//   overpass (nothing joins it mid-span), and four ramps join the two
// Placed over an existing highway, the diamond lines up with it and uses it;
// anywhere else it brings its own stretch of highway. , and . rotate.
import * as THREE from 'three';
import { registerTool } from '../ext/registry';
import type { Game } from '../game';
import { bezPoint, Cubic, lineCubic, norm, quadCubic, sampleCubic, sub, tangentAt, V2 } from '../core/math';
import { crumb } from '../ui/bugreport';
import type { Plan, RSeg } from './network';
import { ROAD_TYPES, RoadTypeId } from './roadTypes';

export type LayoutId = 'roundabout' | 'diamond';

export const LAYOUTS: Record<LayoutId, { name: string; icon: string; blurb: string; unlockPop: number }> = {
  roundabout: { name: 'Freedom Circle', icon: '⭕', blurb: 'A roundabout with four stubs to connect. Traffic keeps moving; drivers keep circling.', unlockPop: 0 },
  diamond: { name: 'Diamond Interchange', icon: '💎', blurb: 'The cross street bridges the highway on an overpass; four ramps join them. Place it on a Slopway to use that one.', unlockPop: ROAD_TYPES.highway.unlockPop },
};
export const LAYOUT_ORDER: LayoutId[] = ['roundabout', 'diamond'];

/** clearance of the diamond's overpass above the ground (m) */
const OVERPASS = 7.5;

interface Piece { from: V2; to: V2; curve: Cubic; type: RoadTypeId; over?: number; /** a ramp merging into the highway at a shallow angle */ merge?: boolean }
interface Layout { pieces: Piece[]; onHighway: RSeg | null; c: V2; yaw: number }

const at = (c: V2, yaw: number, x: number, z: number): V2 => {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { x: c.x + x * cs - z * sn, z: c.z + x * sn + z * cs };
};

/** a quarter circle as a cubic */
function arc(c: V2, r: number, a0: number): Cubic {
  const a1 = a0 + Math.PI / 2, k = 0.5523 * r;
  const p0 = { x: c.x + Math.cos(a0) * r, z: c.z + Math.sin(a0) * r };
  const p3 = { x: c.x + Math.cos(a1) * r, z: c.z + Math.sin(a1) * r };
  return { p0, p1: { x: p0.x - Math.sin(a0) * k, z: p0.z + Math.cos(a0) * k }, p2: { x: p3.x + Math.sin(a1) * k, z: p3.z - Math.cos(a1) * k }, p3 };
}

function layout(g: Game, id: LayoutId, p: V2, yawIn: number): Layout {
  const pieces: Piece[] = [];
  const line = (a: V2, b: V2, type: RoadTypeId, over?: number) => pieces.push({ from: a, to: b, curve: lineCubic(a, b), type, over });
  if (id === 'roundabout') {
    const R = 28;
    for (let k = 0; k < 4; k++) {
      const a0 = yawIn + (k * Math.PI) / 2;
      const cv = arc(p, R, a0);
      pieces.push({ from: cv.p0, to: cv.p3, curve: cv, type: 'twoLane' });
    }
    for (let k = 0; k < 4; k++) {
      const a0 = yawIn + (k * Math.PI) / 2;
      line(at(p, a0, R, 0), at(p, a0, R + 46, 0), 'twoLane');
    }
    return { pieces, onHighway: null, c: p, yaw: yawIn };
  }
  // diamond: on a highway, line up with it
  let c = p, yaw = yawIn, onHighway: RSeg | null = null;
  const pick = g.net.pickSeg(p.x, p.z, 14);
  if (pick && pick.seg.type === 'highway' && !pick.seg.over) {
    onHighway = pick.seg;
    const s = Math.min(Math.max(pick.s, 1), pick.seg.length - 1);
    const t = tangentAt(pick.seg.samp, s);
    const q = pick.seg.samp.pts;
    // closest point on the highway's centre line
    let best = q[0], bd = Infinity;
    for (const v of q) { const d = (v.x - p.x) ** 2 + (v.z - p.z) ** 2; if (d < bd) { bd = d; best = v; } }
    c = { x: best.x, z: best.z };
    yaw = Math.atan2(t.z, t.x);
  }
  const L = (x: number, z: number) => at(c, yaw, x, z);
  if (!onHighway) line(L(-240, 0), L(240, 0), 'highway');
  line(L(0, -100), L(0, 100), 'stroad4', OVERPASS);
  line(L(0, -100), L(0, -150), 'stroad4');
  line(L(0, 100), L(0, 150), 'stroad4');
  for (const sz of [1, -1]) for (const sx of [1, -1]) {
    const a = L(0, 100 * sz), b = L(150 * sx, 0), k = L(90 * sx, 54 * sz);
    pieces.push({ from: a, to: b, curve: quadCubic(a, k, b), type: 'twoLane', merge: true });
  }
  return { pieces, onHighway, c, yaw };
}

/** plan every piece against today's network: total cost, and the first reason it can't be built */
function planLayout(g: Game, lay: Layout): { ok: boolean; cost: number; grant: number; reason?: string } {
  let cost = 0, grant = 0;
  // an existing road under the middle of a piece: the spot is taken
  for (const pc of lay.pieces) {
    if (pc.over || pc.merge) continue;
    const mid = bezPoint(pc.curve, 0.5);
    const hit = g.net.pickSeg(mid.x, mid.z, 1);
    if (hit && hit.seg !== lay.onHighway) return { ok: false, cost: 0, grant: 0, reason: `${hit.seg.name} is in the way: find open ground, or bulldoze it first.` };
  }
  for (const pc of lay.pieces) {
    const start = g.net.snap(pc.from.x, pc.from.z, 6);
    const plan: Plan = g.net.plan(start, pc.curve, pc.type, Infinity, { over: pc.over });
    // ramps run alongside the highway where they merge into it, by design;
    // anything else in the way (an existing road included) stops the layout
    const merging = pc.merge && (plan.reason === 'Overlaps an existing road' || /Too sharp a junction/.test(plan.reason ?? ''));
    if (!plan.ok && !merging) return { ok: false, cost, grant, reason: plan.reason === 'Overlaps an existing road' ? 'Overlaps an existing road: find open ground, or bulldoze what is in the way.' : plan.reason };
    cost += plan.cost;
    grant += plan.grant;
  }
  if (cost - grant > g.sim.spendable()) return { ok: false, cost, grant, reason: `Needs $${Math.round(cost - grant).toLocaleString()}; you can spend $${Math.max(0, Math.round(g.sim.spendable())).toLocaleString()} (cash + credit).` };
  return { ok: true, cost, grant };
}

// ------------------------------------------------------------------ tool state
let current: LayoutId = 'roundabout';
let yaw = 0;
let hover: THREE.Vector3 | null = null;
let planned: THREE.Vector3 | null = null;
let last: { lay: Layout; check: ReturnType<typeof planLayout> } | null = null;
let ghost: THREE.Mesh | null = null;
let game: Game | null = null;

export function selectLayout(g: Game, id: LayoutId) {
  game = g;
  current = id;
  planned = null;
  g.tools.setExt('interchange');
}
export function currentLayout(g: Game): LayoutId | null {
  return g.tools.active === 'ext' && g.tools.extTool === 'interchange' ? current : null;
}
export function rotateLayout(g: Game, by = Math.PI / 12) {
  yaw += by;
  if (hover || planned) refresh(g, planned ?? hover);
}

function ribbon(pos: number[], idx: number[], g: Game, c: Cubic, width: number) {
  const s = sampleCubic(c, 3), hw = width / 2, base = pos.length / 3;
  for (let i = 0; i < s.pts.length; i++) {
    const p = s.pts[i], q = s.pts[Math.min(i + 1, s.pts.length - 1)], o = s.pts[Math.max(0, i - 1)];
    const t = norm(sub(q, o)), r = { x: -t.z, z: t.x };
    const y = Math.max(g.terrain.h(p.x, p.z), 0) + 0.9;
    pos.push(p.x - r.x * hw, y, p.z - r.z * hw, p.x + r.x * hw, y, p.z + r.z * hw);
    if (i > 0) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
}

function refresh(g: Game, p: THREE.Vector3 | null) {
  if (!ghost) {
    ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    ghost.renderOrder = 5;
    g.scene.add(ghost);
  }
  if (!p) { ghost.visible = false; last = null; return; }
  const lay = layout(g, current, { x: p.x, z: p.z }, yaw);
  const check = planLayout(g, lay);
  last = { lay, check };
  const pos: number[] = [], idx: number[] = [];
  for (const pc of lay.pieces) ribbon(pos, idx, g, pc.curve, ROAD_TYPES[pc.type].width);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  ghost.geometry.dispose();
  ghost.geometry = geo;
  (ghost.material as THREE.MeshBasicMaterial).color.set(check.ok ? 0x7fd8ff : 0xff4d4d);
  ghost.visible = true;
}

/** whether the layout can go at p, what it costs and why not (for the UI and tests) */
export function checkLayout(g: Game, id: LayoutId, p: V2, yawAt = yaw) {
  const lay = layout(g, id, p, yawAt);
  return { ...planLayout(g, lay), onHighway: !!lay.onHighway };
}

/** build the layout at p; false (and a toast) if it can't be */
export function placeLayout(g: Game, id: LayoutId, p: V2, yawAt = yaw): RSeg[] | null {
  const lay = layout(g, id, p, yawAt);
  const check = planLayout(g, lay);
  const def = LAYOUTS[id];
  if (!check.ok) { g.toast(check.reason ?? "Can't build that here", true); g.audio.play('error'); return null; }
  const built: RSeg[] = [];
  for (const pc of lay.pieces) {
    const start = g.net.snap(pc.from.x, pc.from.z, 6), end = g.net.snap(pc.to.x, pc.to.z, 6);
    built.push(...g.net.build(start, end, { ...pc.curve, p0: { x: start.x, z: start.z }, p3: { x: end.x, z: end.z } }, pc.type, undefined, { over: pc.over }));
  }
  if (!built.length) return null;
  g.sim.spend(check.cost, def.name);
  if (check.grant > 0) g.sim.earn(check.grant, 'grants', 'Federal Slop Grant');
  g.onRoadBuilt(built, { ok: true, length: 0, cost: check.cost, grant: check.grant, bridgeLen: 0, crossings: [] });
  g.pushUndo({ kind: 'build', segIds: built.map((s) => s.id), refund: check.cost - check.grant, label: def.name });
  crumb(`built ${def.name} ($${check.cost - check.grant})${lay.onHighway ? ' on the highway' : ''}`);
  return built;
}

registerTool({
  id: 'interchange',
  touchLift: 64,
  placing: () => `${LAYOUTS[current].icon} ${LAYOUTS[current].name}`,
  move: (g, p) => { hover = p; if (!planned) refresh(g, p); },
  up: (g, p, e, wasDrag) => {
    if (!p || wasDrag) return;
    if (e.pointerType !== 'mouse') { planned = p.clone(); refresh(g, planned); return; }
    if (placeLayout(g, current, { x: p.x, z: p.z })) refresh(g, p);
  },
  pending: () => (planned ? { cost: last?.check.ok ? last.check.cost - last.check.grant : null } : null),
  confirm: (g) => {
    if (!planned) return;
    if (placeLayout(g, current, { x: planned.x, z: planned.z })) { planned = null; if (ghost) ghost.visible = false; last = null; }
    else refresh(g, planned);
  },
  cancel: () => { planned = null; hover = null; if (ghost) ghost.visible = false; last = null; },
  tip: (g) => {
    const def = LAYOUTS[current];
    if (!last) return { text: `${def.icon} ${def.name} · ${g.isTouch ? 'tap' : 'click'} where it goes${g.isTouch ? '' : ' · , and . rotate'}` };
    const net = last.check.cost - last.check.grant;
    if (!last.check.ok) return { text: `${def.name}: ${last.check.reason}`, bad: true };
    const where = current === 'diamond' ? (last.lay.onHighway ? ' · lines up with this Slopway' : ' · brings its own stretch of Slopway (place it on one to use that)') : '';
    return { text: `${def.icon} ${def.name} · $${net.toLocaleString()}${last.check.grant ? ` (feds pay $${last.check.grant.toLocaleString()})` : ''}${where}${g.isTouch ? (planned ? ' · tap Build' : '') : ' · , and . rotate'}` };
  },
});

// , and . rotate while placing
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const g = game;
    if (!g || !currentLayout(g) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ',' || e.key === '<') rotateLayout(g, -Math.PI / 12);
    else if (e.key === '.' || e.key === '>') rotateLayout(g, Math.PI / 12);
  });
}
