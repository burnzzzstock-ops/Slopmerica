import * as THREE from 'three';
import { CELL, HALF, WORLD } from '../config';
import { hash2 } from '../core/rng';
import { registerInspector, registerPanel, registerSystem, registerTool, registerView } from '../ext/registry';
import type { Game } from '../game';
import type { Bld } from './buildings';
import { isZoned } from './buildings';
import {
  POLICY_BY_ID, POLICY_DEFS, POLICY_IDS, policyDemandDelta, policyEnabled, policyLandValue,
  policyTaxMultiplier, policyVacancyReason, type PolicyId, type PolicyOverride,
} from './policies';

const N = WORLD / CELL;
const EMPTY_POLICIES = new Set<PolicyId>();
const NAMES = ['Freedom Acres', 'East Grievanceville', 'Little Portland', 'The Stroadlands', 'Patriot Pointe', 'HOA-69', 'Content Gulch', 'Liberty Vape Commons'];
const COLORS = [0x35d0ba, 0xffb02e, 0xb477ff, 0xff6577, 0x68a7ff, 0xd4e157, 0xff75d1, 0x65d46e];

export interface District {
  id: number;
  name: string;
  color: number;
  overrides: PolicyOverride;
}

interface DistrictState {
  game: Game;
  grid: Uint16Array;
  occupied: Set<number>;
  districts: Map<number, District>;
  cityPolicies: Set<PolicyId>;
  selected: number;
  nextId: number;
  brush: number;
  erase: boolean;
  version: number;
  drawnVersion: number;
  group: THREE.Group;
  borders: THREE.LineSegments;
  labels: THREE.Sprite[];
  boundSize: number;
}

interface SavedDistricts {
  v: 1;
  nextId: number;
  districts: { id: number; name: string; color: number; overrides: PolicyOverride }[];
  cityPolicies: PolicyId[];
  runs: number[];
}

const STATES = new WeakMap<Game, DistrictState>();
const BLD_STATE = new WeakMap<Bld, DistrictState>();
const BLD_CACHE = new WeakMap<Bld, { version: number; ids: Set<PolicyId> }>();

const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cellCoord = (v: number) => Math.floor((v + HALF) / CELL);
const cellIndex = (x: number, z: number) => {
  const ix = cellCoord(x), iz = cellCoord(z);
  return ix < 0 || iz < 0 || ix >= N || iz >= N ? -1 : iz * N + ix;
};
const worldCoord = (i: number) => -HALF + i * CELL;

function districtAtState(s: DistrictState, x: number, z: number): District | null {
  const i = cellIndex(x, z);
  return i < 0 ? null : s.districts.get(s.grid[i]) ?? null;
}

export function districtForBuilding(b: Bld): District | null {
  const s = BLD_STATE.get(b);
  return s ? districtAtState(s, b.x, b.z) : null;
}

/** Effective policies after city settings are overridden by the building's district. */
export function activePolicyIdsFor(b: Bld): ReadonlySet<PolicyId> {
  const s = BLD_STATE.get(b);
  if (!s) return EMPTY_POLICIES;
  const old = BLD_CACHE.get(b);
  if (old?.version === s.version) return old.ids;
  const d = districtAtState(s, b.x, b.z);
  const ids = new Set<PolicyId>();
  for (const id of POLICY_IDS) if (policyEnabled(id, s.cityPolicies, d?.overrides)) ids.add(id);
  BLD_CACHE.set(b, { version: s.version, ids });
  return ids;
}

function createState(g: Game): DistrictState {
  const mat = new THREE.LineBasicMaterial({ color: 0x7fffee, transparent: true, opacity: 0.95, depthTest: false });
  const borders = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
  borders.renderOrder = 9;
  borders.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'district-overlay';
  group.visible = false;
  group.add(borders);
  g.scene.add(group);
  return { game: g, grid: new Uint16Array(N * N), occupied: new Set(), districts: new Map(), cityPolicies: new Set(), selected: 0, nextId: 1, brush: 40, erase: false, version: 1, drawnVersion: 0, group, borders, labels: [], boundSize: 0 };
}

function createDistrict(s: DistrictState): District {
  const id = s.nextId++;
  const d: District = { id, name: NAMES[(id - 1) % NAMES.length], color: COLORS[(id - 1) % COLORS.length], overrides: {} };
  s.districts.set(id, d);
  s.selected = id;
  s.version++;
  return d;
}

function paint(s: DistrictState, x: number, z: number, erase = s.erase): number {
  const id = erase ? 0 : s.selected;
  if (!erase && !s.districts.has(id)) return 0;
  const r = s.brush;
  const minX = Math.max(0, cellCoord(x - r)), maxX = Math.min(N - 1, cellCoord(x + r));
  const minZ = Math.max(0, cellCoord(z - r)), maxZ = Math.min(N - 1, cellCoord(z + r));
  let changed = 0;
  for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
    const wx = worldCoord(ix) + CELL / 2, wz = worldCoord(iz) + CELL / 2;
    if ((wx - x) ** 2 + (wz - z) ** 2 > r * r) continue;
    const k = iz * N + ix;
    if (s.grid[k] !== id) {
      s.grid[k] = id;
      if (id) s.occupied.add(k); else s.occupied.delete(k);
      changed++;
    }
  }
  if (changed) s.version++;
  return changed;
}

function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const c = canvas.getContext('2d')!;
  c.fillStyle = 'rgba(5,10,18,.82)'; c.roundRect(4, 4, 504, 88, 18); c.fill();
  c.strokeStyle = `#${color.toString(16).padStart(6, '0')}`; c.lineWidth = 5; c.stroke();
  c.font = '700 34px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(text, 256, 50, 470);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(128, 24, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function rebuildVisual(s: DistrictState) {
  if (s.drawnVersion === s.version) return;
  s.drawnVersion = s.version;
  const pos: number[] = [];
  const sums = new Map<number, { x: number; z: number; n: number }>();
  const addEdge = (x1: number, z1: number, x2: number, z2: number) => {
    pos.push(x1, s.game.terrain.h(x1, z1) + 0.65, z1, x2, s.game.terrain.h(x2, z2) + 0.65, z2);
  };
  for (const k of s.occupied) {
    const iz = Math.floor(k / N), ix = k - iz * N;
    const id = s.grid[k];
    const wx = worldCoord(ix), wz = worldCoord(iz);
    const sum = sums.get(id) ?? { x: 0, z: 0, n: 0 };
    sum.x += wx + CELL / 2; sum.z += wz + CELL / 2; sum.n++; sums.set(id, sum);
    if (iz === 0 || s.grid[(iz - 1) * N + ix] !== id) addEdge(wx, wz, wx + CELL, wz);
    if (iz === N - 1 || s.grid[(iz + 1) * N + ix] !== id) addEdge(wx, wz + CELL, wx + CELL, wz + CELL);
    if (ix === 0 || s.grid[iz * N + ix - 1] !== id) addEdge(wx, wz, wx, wz + CELL);
    if (ix === N - 1 || s.grid[iz * N + ix + 1] !== id) addEdge(wx + CELL, wz, wx + CELL, wz + CELL);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  s.borders.geometry.dispose(); s.borders.geometry = geo;
  for (const label of s.labels) { s.group.remove(label); (label.material as THREE.SpriteMaterial).map?.dispose(); label.material.dispose(); }
  s.labels = [];
  for (const [id, a] of sums) {
    const d = s.districts.get(id); if (!d || !a.n) continue;
    const x = a.x / a.n, z = a.z / a.n;
    const label = makeLabel(d.name, d.color); label.position.set(x, s.game.terrain.h(x, z) + 15, z);
    s.labels.push(label); s.group.add(label);
  }
}

function bindBuildings(s: DistrictState) {
  for (const b of s.game.buildings.list.values()) BLD_STATE.set(b, s);
  s.boundSize = s.game.buildings.list.size;
}

function coverage(s: DistrictState, id: PolicyId): number {
  let total = 0, enabled = 0;
  for (const b of s.game.buildings.list.values()) {
    if (!isZoned(b)) continue;
    total++;
    BLD_STATE.set(b, s);
    if (activePolicyIdsFor(b).has(id)) enabled++;
  }
  if (total) return enabled / total;
  return s.cityPolicies.has(id) ? 1 : 0;
}

function districtStats(s: DistrictState, id: number) {
  let population = 0, jobs = 0, lv = 0, n = 0;
  for (const b of s.game.buildings.list.values()) {
    if (districtAtState(s, b.x, b.z)?.id !== id || !isZoned(b)) continue;
    if (b.zone === 'resLow' || b.zone === 'resHigh') population += b.occ; else jobs += b.occ;
    lv += b.lv; n++;
  }
  return { population, jobs, lv: n ? lv / n : 0 };
}

function encodeRuns(grid: Uint16Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.length;) {
    if (!grid[i]) { i++; continue; }
    const start = i, id = grid[i];
    while (i < grid.length && grid[i] === id) i++;
    out.push(start, i - start, id);
  }
  return out;
}

function saveState(s: DistrictState): SavedDistricts {
  return { v: 1, nextId: s.nextId, districts: [...s.districts.values()].map((d) => ({ ...d, overrides: { ...d.overrides } })), cityPolicies: [...s.cityPolicies], runs: encodeRuns(s.grid) };
}

function loadState(s: DistrictState, raw: unknown) {
  const d = raw as Partial<SavedDistricts>;
  s.grid.fill(0); s.occupied.clear(); s.districts.clear(); s.cityPolicies.clear();
  if (d?.v === 1) {
    for (const row of d.districts ?? []) if (row.id > 0 && row.id < 65536) s.districts.set(row.id, { id: row.id, name: String(row.name), color: Number(row.color), overrides: { ...row.overrides } });
    for (const id of d.cityPolicies ?? []) if ((POLICY_IDS as readonly string[]).includes(id)) s.cityPolicies.add(id);
    const runs = d.runs ?? [];
    for (let i = 0; i + 2 < runs.length; i += 3) {
      const start = Math.max(0, Math.floor(runs[i])), len = Math.max(0, Math.floor(runs[i + 1])), id = Math.floor(runs[i + 2]);
      if (!s.districts.has(id)) continue;
      const end = Math.min(s.grid.length, start + len);
      s.grid.fill(id, start, end);
      for (let k = start; k < end; k++) s.occupied.add(k);
    }
    s.nextId = Math.max(Number(d.nextId) || 1, ...s.districts.keys(), 0) + (d.nextId ? 0 : 1);
  }
  s.selected = s.districts.keys().next().value ?? 0;
  s.version++; s.drawnVersion = 0; bindBuildings(s); rebuildVisual(s);
}

function policyCost(s: DistrictState, id: PolicyId) {
  const def = POLICY_BY_ID.get(id)!;
  let people = 0, any = s.cityPolicies.has(id);
  for (const b of s.game.buildings.list.values()) {
    if (!isZoned(b)) continue;
    BLD_STATE.set(b, s);
    if (activePolicyIdsFor(b).has(id)) { people += b.occ; any = true; }
  }
  return any ? Math.round(def.weeklyBase + people * def.weeklyPerPerson) : 0;
}

function renderPolicies(s: DistrictState, district: District | null) {
  return POLICY_DEFS.map((p) => {
    const own = district?.overrides[p.id];
    const effective = district ? policyEnabled(p.id, s.cityPolicies, district.overrides) : s.cityPolicies.has(p.id);
    const state = district ? own === undefined ? 'inherit' : own ? 'on' : 'off' : effective ? 'on' : 'off';
    const suffix = state === 'inherit' ? `inherits ${effective ? 'ON' : 'OFF'}` : state.toUpperCase();
    return `<button class="card ${effective ? 'on' : ''}" data-policy="${p.id}" title="${esc(p.summary)}"><span class="ci">${p.icon}</span><b>${esc(p.label)}</b><small>${esc(p.summary)} · ${suffix}</small></button>`;
  }).join('');
}

let panelTab: 'district' | 'city' = 'district';

registerPanel({
  id: 'districts', icon: '🗺️', label: 'Districts', order: 58,
  render(el, g, rerender) {
    const s = STATES.get(g)!;
    const selected = s.districts.get(s.selected) ?? null;
    const stats = selected ? districtStats(s, selected.id) : null;
    el.innerHTML = `<div class="sp-title">Districts & Policies <small>Paint an 8 m civic identity crisis. District settings override city policy.</small></div>
      <div class="sp-row"><button class="chip ${panelTab === 'district' ? 'on' : ''}" data-tab="district">Districts</button><button class="chip ${panelTab === 'city' ? 'on' : ''}" data-tab="city">City-wide</button></div>
      ${panelTab === 'city' ? `<div class="sp-grid">${renderPolicies(s, null)}</div>` : `
        <div class="sp-row"><button class="chip" id="district-new">+ New district</button>${selected ? `<button class="chip ${!s.erase ? 'on' : ''}" id="district-paint">Paint</button><button class="chip ${s.erase ? 'on' : ''}" id="district-erase">Erase</button><button class="chip" id="district-rename">Rename</button>` : ''}</div>
        <div class="sp-row">Brush ${[24, 40, 64].map((r) => `<button class="chip ${s.brush === r ? 'on' : ''}" data-brush="${r}">${r / 8} cells</button>`).join('')}</div>
        <div class="sp-row">${[...s.districts.values()].map((d) => `<button class="chip ${s.selected === d.id ? 'on' : ''}" data-district="${d.id}" style="border-color:#${d.color.toString(16).padStart(6, '0')}">${esc(d.name)}</button>`).join('') || '<small>Create a district, then drag on the map.</small>'}</div>
        ${selected ? `<div class="sp-title">${esc(selected.name)} <small>Pop ${stats!.population.toLocaleString()} · Jobs ${stats!.jobs.toLocaleString()} · Avg value ${Math.round(stats!.lv)}</small></div><div class="sp-grid">${renderPolicies(s, selected)}</div>` : ''}`}`;
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.onclick = () => { panelTab = b.dataset.tab as typeof panelTab; rerender(); });
    el.querySelector('#district-new')?.addEventListener('click', () => { createDistrict(s); s.erase = false; g.tools.setExt('district-paint'); s.group.visible = true; rerender(); });
    el.querySelectorAll<HTMLButtonElement>('[data-district]').forEach((b) => b.onclick = () => { s.selected = Number(b.dataset.district); s.erase = false; g.tools.setExt('district-paint'); s.group.visible = true; rerender(); });
    el.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach((b) => b.onclick = () => { s.brush = Number(b.dataset.brush); rerender(); });
    el.querySelector('#district-paint')?.addEventListener('click', () => { s.erase = false; g.tools.setExt('district-paint'); s.group.visible = true; rerender(); });
    el.querySelector('#district-erase')?.addEventListener('click', () => { s.erase = true; g.tools.setExt('district-paint'); s.group.visible = true; rerender(); });
    el.querySelector('#district-rename')?.addEventListener('click', () => { if (!selected) return; const name = prompt('District name', selected.name)?.trim(); if (name) { selected.name = name.slice(0, 40); s.version++; rerender(); } });
    el.querySelectorAll<HTMLButtonElement>('[data-policy]').forEach((b) => b.onclick = () => {
      const id = b.dataset.policy as PolicyId;
      if (panelTab === 'city') { s.cityPolicies.has(id) ? s.cityPolicies.delete(id) : s.cityPolicies.add(id); }
      else if (selected) { const old = selected.overrides[id]; if (old === undefined) selected.overrides[id] = true; else if (old) selected.overrides[id] = false; else delete selected.overrides[id]; }
      s.version++; bindBuildings(s); rerender();
    });
  },
  close(g) { const s = STATES.get(g); if (s && g.overlays.ext?.id !== 'districts') s.group.visible = false; },
});

registerTool({
  id: 'district-paint', capturesDrag: true, touchLift: 52,
  down(g, p) { const s = STATES.get(g)!; paint(s, p.x, p.z); s.group.visible = true; rebuildVisual(s); },
  move(g, p, _e, dragging) { if (!p || !dragging) return; const s = STATES.get(g)!; paint(s, p.x, p.z); rebuildVisual(s); },
  up(g) { rebuildVisual(STATES.get(g)!); },
  cancel(g) { const s = STATES.get(g); if (s && g.overlays.ext?.id !== 'districts') s.group.visible = false; },
  tip(g) { const s = STATES.get(g)!; const d = s.districts.get(s.selected); return { text: s.erase ? `Erase district · ${s.brush} m brush` : d ? `Paint ${d.name} · ${s.brush} m brush` : 'Create a district first', bad: !s.erase && !d }; },
});

registerView({
  id: 'districts', icon: '🗺️', label: 'Districts',
  enable(g) {
    const s = STATES.get(g)!; rebuildVisual(s); s.group.visible = true;
    const colors = new Map<number, THREE.Color>();
    g.overlays.tintBuildings((b) => { const d = districtAtState(s, b.x, b.z); if (!d) return new THREE.Color(0x4a4f59); let c = colors.get(d.id); if (!c) colors.set(d.id, c = new THREE.Color(d.color)); return c; });
  },
  disable(g) { const s = STATES.get(g)!; if (!(g.tools.active === 'ext' && g.tools.extTool === 'district-paint')) s.group.visible = false; g.overlays.resetBuildingColors(); },
  update(g) { const s = STATES.get(g)!; rebuildVisual(s); },
  legend() { return '<i style="background:#35d0ba"></i> District color &nbsp; <i style="background:#4a4f59"></i> Unincorporated &nbsp; glowing lines = borders'; },
});

registerInspector((sel) => {
  if (sel.kind !== 'building') return null;
  const d = districtForBuilding(sel.b);
  const ids = [...activePolicyIdsFor(sel.b)];
  return `<div class="in-stats"><div><span>District</span><b>${esc(d?.name ?? 'Unincorporated')}</b></div><div><span>Active policies</span><b>${ids.length ? ids.map((id) => esc(POLICY_BY_ID.get(id)?.label ?? id)).join(', ') : 'None'}</b></div></div>`;
});

registerSystem({
  id: 'districts',
  init(g) {
    const s = createState(g); STATES.set(g, s); bindBuildings(s);
    g.traffic.policySmokingAllowed = (b) => !activePolicyIdsFor(b).has('smokeFree');
    g.peds.policySmokingAllowedAt = (x, z) => !policyEnabled('smokeFree', s.cityPolicies, districtAtState(s, x, z)?.overrides);
    const baseCommunePenalty = g.sim.communePenalty;
    g.sim.communePenalty = (x, z) => baseCommunePenalty(x, z) * (policyEnabled('legalizeIt', s.cityPolicies, districtAtState(s, x, z)?.overrides) ? 0.5 : 1);
    g.sim.hooks.taxMul.push((b) => { BLD_STATE.set(b, s); return policyTaxMultiplier(activePolicyIdsFor(b), b); });
    g.sim.hooks.landValue.push((b) => { BLD_STATE.set(b, s); const road = g.net.segs.get(b.seg); return policyLandValue(activePolicyIdsFor(b), b, !!road?.type.startsWith('stroad')); });
    g.sim.hooks.vacancy.push((b) => { BLD_STATE.set(b, s); return policyVacancyReason(activePolicyIdsFor(b), b); });
    g.sim.hooks.levelCap.push((b) => {
      BLD_STATE.set(b, s);
      const ids = activePolicyIdsFor(b);
      if (ids.has('heavyTrafficBan') && b.zone === 'industry') return { max: 3, why: 'Heavy traffic ban blocks industrial logistics' };
      if (ids.has('bookBans') && b.zone === 'office') return { max: 4, why: 'Book bans shrank the educated workforce' };
      return null;
    });
    g.sim.hooks.demand.push((d, why) => {
      for (const id of POLICY_IDS) {
        const share = coverage(s, id); if (share <= 0) continue;
        const delta = policyDemandDelta(id); const label = POLICY_BY_ID.get(id)!.label;
        for (const k of ['res', 'com', 'ind', 'off'] as const) if (delta[k]) { const n = delta[k] * share; d[k] += n; why[k].push(`${label} ${n > 0 ? '+' : ''}${n.toFixed(1)} (${Math.round(share * 100)}% coverage)`); }
      }
    });
    g.sim.hooks.weekly.push((add) => { for (const id of POLICY_IDS) { const cost = policyCost(s, id); if (cost) add(`Policy: ${POLICY_BY_ID.get(id)!.label}`, cost, 'other'); } });
    (g as unknown as { districts: unknown }).districts = {
      create: () => createDistrict(s), paint: (x: number, z: number, districtId = s.selected, radius = s.brush) => { s.selected = districtId; s.brush = radius; const n = paint(s, x, z, false); rebuildVisual(s); return n; },
      erase: (x: number, z: number, radius = s.brush) => { s.brush = radius; const n = paint(s, x, z, true); rebuildVisual(s); return n; },
      at: (x: number, z: number) => districtAtState(s, x, z),
      setCityPolicy: (id: PolicyId, on: boolean) => { on ? s.cityPolicies.add(id) : s.cityPolicies.delete(id); s.version++; },
      setDistrictPolicy: (districtId: number, id: PolicyId, on: boolean | undefined) => { const d = s.districts.get(districtId); if (!d) return false; if (on === undefined) delete d.overrides[id]; else d.overrides[id] = on; s.version++; return true; },
      policiesFor: (b: Bld) => [...activePolicyIdsFor(b)], save: () => saveState(s), load: (v: unknown) => loadState(s, v), stats: (id: number) => districtStats(s, id),
    };
  },
  frame(g) { const s = STATES.get(g)!; if (s.boundSize !== g.buildings.list.size) bindBuildings(s); if (s.group.visible) rebuildVisual(s); },
  daily(g, day) {
    const s = STATES.get(g)!; bindBuildings(s);
    let tripWeight = 0, tripTotal = 0;
    for (const b of g.buildings.list.values()) {
      const ids = activePolicyIdsFor(b);
      if (isZoned(b)) {
        const w = Math.max(1, b.occ);
        const tripMul = (ids.has('freeParking') ? 1.12 : 1) * (ids.has('banBikes') ? 1.14 : 1) * (ids.has('fourDayWeek') ? 0.88 : 1);
        tripWeight += w; tripTotal += tripMul * w;
      }
      if (b.state === 'building' && ids.has('sprawlZone')) b.progress = Math.min(0.999, b.progress + 0.5 / Math.max(1, b.buildDays));
      if (isZoned(b) && b.zone === 'industry' && b.state === 'active' && ids.has('rightToRepair')) b.levelProgress += 0.01;
    }
    g.traffic.policyTripMul = tripWeight ? tripTotal / tripWeight : 1;
    g.peds.policyOutdoorMul = 1 - coverage(s, 'banBikes') * 0.3;
    if (day % 7 === 0 && hash2(day / 7, 91, 773) < 0.18) {
      let hit = 0;
      for (const b of g.buildings.list.values()) if (b.zone === 'office' && activePolicyIdsFor(b).has('cryptoHaven') && b.occ > 0) { b.occ = Math.max(0, Math.floor(b.occ * 0.65)); hit++; }
      if (hit) { g.ui.toast(`Crypto rug pull: ${hit} office${hit === 1 ? '' : 's'} discovered decentralization.`, true); g.feed.push('ambient'); }
    }
    if (day % 14 === 0 && [...g.buildings.list.values()].some((b) => activePolicyIdsFor(b).has('hoaTyranny')) && hash2(day, 22, 91) < 0.35) { g.ui.toast('HOA citation issued: lawn was 0.4 inches too emotionally available.'); g.feed.push('ambient'); }
  },
  save(g) { return saveState(STATES.get(g)!); },
  load(g, data) { loadState(STATES.get(g)!, data); },
});
