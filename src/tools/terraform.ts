import { HALF, HM_N, HM_STEP, WATER } from '../config';
import { registerPanel, registerSystem, registerTool } from '../ext/registry';
import type { Game } from '../game';
import { Paint } from '../world/terrain';

type Mode = 'raise' | 'lower' | 'level' | 'smooth' | 'soften';
type Delta = { base: number; delta: number; paint: Paint; day: number };
const edits = new Map<number, Delta>();
let mode: Mode = 'raise';
let radius = 18;
let strength = 1;
let target = 0;
let runningCost = 0;
let lastX = Infinity, lastZ = Infinity;
let active = false;
let message = '';

function valid(g: Game, x: number, z: number, lowering: boolean): string | null {
  if (!g.terrain.inBounds(x, z, radius + 2)) return 'Outside the county line';
  if (g.net.allowed && !g.net.allowed(x, z)) return "You don't own this land yet";
  if (lowering && g.terrain.h(x, z) <= WATER + 0.15) return 'Water mask is baked; underwater lowering is unavailable';
  if (g.net.pickSeg(x, z, 12)) return 'Too close to a road';
  if (g.buildings.near(x, z, 10).length) return 'Too close to a building';
  if (g.communes.at(x, z)) return 'A commune lives here';
  return null;
}

function brush(g: Game, x: number, z: number) {
  const centreError = valid(g, x, z, mode === 'lower');
  if (centreError) { message = centreError; return; }
  const nearBuildings = g.buildings.near(x, z, radius + 16);
  const next: { id: number; height: number; paint?: Paint }[] = [];
  let volume = 0;
  const H = g.terrain.heights;
  g.terrain.forEachIn(x - radius, z - radius, x + radius, z + radius, (i, j, sx, sz, id) => {
    const d = Math.hypot(sx - x, sz - z);
    if (d > radius || g.terrain.roadMask[id]) return;
    const weight = (1 - d / radius) ** 2;
    if (weight < 0.005) return;
    if (g.net.pickSeg(sx, sz, 10) || g.communes.at(sx, sz)) return;
    if (g.net.allowed && !g.net.allowed(sx, sz)) return;
    if (nearBuildings.some(b => Math.abs(b.x - sx) < b.hw + 8 && Math.abs(b.z - sz) < b.hd + 8)) return;
    const before = H[id];
    let wanted = before;
    const step = 0.8 * strength * weight;
    if (mode === 'raise') wanted += step;
    else if (mode === 'lower') wanted -= step;
    else if (mode === 'level') wanted += Math.max(-step, Math.min(step, target - before));
    else {
      const avg = (H[id - 1] + H[id + 1] + H[id - HM_N] + H[id + HM_N]) / 4;
      const factor = mode === 'soften' ? 1.5 : 0.7;
      wanted += Math.max(-step, Math.min(step, (avg - before) * factor));
    }
    if (wanted < before && before <= WATER + 0.15) return;
    wanted = Math.max(WATER + 0.05, wanted);
    // A local grade cap keeps cuts from creating a sheer wall beside a road.
    const low = Math.min(H[id - 1], H[id + 1], H[id - HM_N], H[id + HM_N]) - HM_STEP * 0.7;
    const high = Math.max(H[id - 1], H[id + 1], H[id - HM_N], H[id + HM_N]) + HM_STEP * 0.7;
    wanted = Math.max(low, Math.min(high, wanted));
    if (Math.abs(wanted - before) < 0.002) return;
    const cost = Math.abs(wanted - before) * HM_STEP * HM_STEP * 0.3;
    if (g.sim.spendable() < volume * 0.3 + cost) return;
    volume += Math.abs(wanted - before) * HM_STEP * HM_STEP;
    const old = edits.get(id);
    edits.set(id, { base: old?.base ?? before, delta: wanted - (old?.base ?? before), paint: Paint.Dirt, day: g.sim.day });
    next.push({ id, height: wanted, paint: Paint.Dirt });
  });
  if (!next.length) { message = 'No editable ground under the brush'; return; }
  const cost = Math.round(volume * 0.3);
  g.sim.spend(cost, 'Terraforming', 'construction');
  runningCost += cost;
  g.terrain.editHeights(next);
  g.trees.cut(x - radius, z - radius, x + radius, z + radius, (tx, tz) => Math.hypot(tx - x, tz - z) < radius);
  message = `${next.length} ground samples moved`;
}

/** Scenario-test entry point; uses the same guard and accounting as pointer input. */
export function terraformAt(g: Game, x: number, z: number, requested: Mode = 'raise') {
  mode = requested;
  const before = runningCost;
  brush(g, x, z);
  return { moved: runningCost - before, reason: message };
}

registerTool({
  id: 'terraform', capturesDrag: true, touchLift: 48,
  down(g, p) {
    active = true; runningCost = 0; lastX = Infinity; lastZ = Infinity;
    target = g.terrain.h(p.x, p.z);
    brush(g, p.x, p.z); lastX = p.x; lastZ = p.z;
  },
  move(g, p, _e, dragging) {
    if (!dragging || !active || !p || Math.hypot(p.x - lastX, p.z - lastZ) < Math.max(3, radius * 0.25)) return;
    brush(g, p.x, p.z); lastX = p.x; lastZ = p.z;
  },
  up() { active = false; },
  cancel() { active = false; },
  tip(g) {
    const p = g.tools.hoverPoint;
    const error = p && valid(g, p.x, p.z, mode === 'lower');
    return { text: error ?? `${mode.toUpperCase()} · ${radius} m brush · $${runningCost.toLocaleString()} this stroke${message ? ` · ${message}` : ''}`, bad: !!error };
  },
});

registerPanel({
  id: 'terraform', icon: '⛰️', label: 'Terraform', order: 86,
  render(el, g, rerender) {
    el.innerHTML = `<div class="sp-title">Terraform <small>Cut, fill, and send the bill to future taxpayers.</small></div>
      <div class="sp-row terra-modes"></div>
      <label class="terra-field">Brush size <input type="range" min="8" max="48" step="2" value="${radius}"><b>${radius} m</b></label>
      <label class="terra-field">Strength <input type="range" min="0.25" max="3" step="0.25" value="${strength}"><b>${strength}×</b></label>
      <button class="terra-use">Use brush</button>
      <p>Moved soil costs $0.30 per m³. Roads, buildings, communes, and underwater terrain are protected. Bare ground regrows in about 20 days.</p>`;
    const row = el.querySelector('.terra-modes')!;
    for (const m of ['raise', 'lower', 'level', 'smooth', 'soften'] as Mode[]) {
      const button = document.createElement('button');
      button.className = `chip${mode === m ? ' on' : ''}`;
      button.textContent = m === 'soften' ? 'Soften cliff' : m[0].toUpperCase() + m.slice(1);
      button.onclick = () => { mode = m; g.tools.setExt('terraform'); rerender(); };
      row.append(button);
    }
    const sliders = el.querySelectorAll<HTMLInputElement>('input');
    sliders[0].oninput = () => { radius = Number(sliders[0].value); sliders[0].nextElementSibling!.textContent = `${radius} m`; };
    sliders[1].oninput = () => { strength = Number(sliders[1].value); sliders[1].nextElementSibling!.textContent = `${strength}×`; };
    el.querySelector<HTMLButtonElement>('.terra-use')!.onclick = () => g.tools.setExt('terraform');
  },
});

registerSystem({
  id: 'terraform',
  daily(g, day) {
    const recovered: { id: number; height: number; paint?: Paint }[] = [];
    for (const [id, e] of edits) {
      if (day - e.day >= 20 && e.paint === Paint.Dirt) {
        e.paint = Paint.None;
        recovered.push({ id, height: g.terrain.heights[id], paint: Paint.None });
        if (recovered.length >= 500) break;
      }
    }
    g.terrain.editHeights(recovered);
  },
  save() {
    return Array.from(edits, ([id, e]) => [id, Math.round(e.delta * 100) / 100, e.paint, e.day]);
  },
  // Runs before roads/buildings restore, so they grade onto the edited ground.
  preload(g, data) {
    edits.clear();
    if (!Array.isArray(data)) return;
    const batch: { id: number; height: number; paint?: Paint }[] = [];
    for (const row of data) {
      if (!Array.isArray(row) || row.length < 4) continue;
      const [id, delta, paint, day] = row.map(Number);
      if (!Number.isInteger(id) || id < 0 || id >= HM_N * HM_N || !Number.isFinite(delta)) continue;
      const i = id % HM_N, j = Math.floor(id / HM_N);
      const x = i * HM_STEP - HALF, z = j * HM_STEP - HALF;
      if (g.terrain.roadMask[id] || g.net.pickSeg(x, z, 10)) continue;
      const base = g.terrain.heights[id];
      edits.set(id, { base, delta, paint: paint as Paint, day });
      batch.push({ id, height: base + delta, paint: paint as Paint });
    }
    g.terrain.editHeights(batch);
  },
});
