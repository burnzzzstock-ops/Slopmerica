import * as THREE from 'three';
import { WATER } from '../config';
import { hash2 } from '../core/rng';
import { registerPanel, registerSystem } from '../ext/registry';
import type { Game } from '../game';
import { usd } from './sim';
import { igniteBuilding } from './services';
import type { RSeg } from '../roads/network';
import { Paint } from '../world/terrain';
import { TUNING } from './tuning';

type Kind = 'hurricane' | 'landslide' | 'wildfire' | 'floridaMan';
const NAME: Record<Kind, string> = { hurricane: 'Hurricane', landslide: 'Landslide', wildfire: 'Wildfire', floridaMan: 'Florida Man' };
interface Event { kind: Kind; phase: 'warning' | 'response'; day: number; x: number; z: number; segs: number[]; cost: number; }
let enabled = false;
let initialized = false;
let event: Event | null = null;
let marker: THREE.Group | null = null;
let scars: [number, number, number][] = [];

function scorch(g: Game, x: number, z: number, paint: Paint) {
  const batch: { id: number; height: number; paint: Paint }[] = [];
  g.terrain.forEachIn(x - 34, z - 34, x + 34, z + 34, (_i, _j, px, pz, id) => {
    if (!g.terrain.roadMask[id] && Math.hypot(px - x, pz - z) < 34
      && (paint !== Paint.None || g.terrain.paint[id] === Paint.Scorched))
      batch.push({ id, height: g.terrain.heights[id], paint });
  });
  g.terrain.editHeights(batch);
}

function chooseRoad(g: Game, predicate: (s: RSeg) => boolean): RSeg | null {
  const list = Array.from(g.net.segs.values()).filter(predicate);
  if (!list.length) return null;
  return list[Math.floor(hash2(Math.floor(g.sim.day), list.length, g.map.def.seed) * list.length)];
}
function middle(s: RSeg) { return s.samp.pts[Math.floor(s.samp.pts.length / 2)]; }
function clearMarker(g: Game) {
  if (!marker) return;
  g.scene.remove(marker);
  marker.traverse(o => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  });
  marker = null;
}
function mudPile(g: Game, x: number, z: number) {
  clearMarker(g);
  marker = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const a = hash2(k, Math.floor(x), 41) * Math.PI * 2;
    const r = 2 + k * 1.4;
    const lump = new THREE.Mesh(
      new THREE.DodecahedronGeometry(2 + k * 0.45, 0),
      new THREE.MeshStandardMaterial({ color: k % 2 ? 0x5a4632 : 0x756047, roughness: 1 }),
    );
    lump.position.set(x + Math.cos(a) * r, g.terrain.h(x, z) + 0.4, z + Math.sin(a) * r);
    lump.scale.y = 0.55;
    marker.add(lump);
  }
  g.scene.add(marker);
}

/** the disaster world event for the current one (src/contracts.ts): where it is now, and its reach and strength from TUNING */
function say(g: Game, phase: 'warn' | 'hit' | 'response' | 'end') {
  if (!event) return;
  const look = TUNING.disasterLook[event.kind];
  g.sim.events.emit('disaster', { kind: event.kind, phase, x: event.x, z: event.z, radius: look.radius, intensity: look.intensity });
}

/** the burning edge of the wildfire at (x, z): seven points on the downwind half of its 35 m circle, in order across the wind */
const FRONT_POINTS = 7;
function sayFront(g: Game, x: number, z: number, ux: number, uz: number) {
  const points = new Float32Array(FRONT_POINTS * 2);
  for (let k = 0; k < FRONT_POINTS; k++) {
    // from 90 degrees left of the wind, through straight downwind, to 90 degrees right
    const a = (k / (FRONT_POINTS - 1) - 0.5) * Math.PI, c = Math.cos(a), s = Math.sin(a);
    points[k * 2] = x + (ux * c - uz * s) * 35;
    points[k * 2 + 1] = z + (ux * s + uz * c) * 35;
  }
  g.sim.events.emit('fireFront', { points });
}

function announce(g: Game, kind: Kind, x: number, z: number) {
  event = { kind, phase: 'warning', day: Math.floor(g.sim.day), x, z, segs: [], cost: 0 };
  say(g, 'warn');
  const line: Record<Kind, string> = {
    hurricane: 'Hurricane watch: coastal stroads may become canals. Insurance says this is character building.',
    landslide: 'Landslide watch: steep Appalachian road cuts are asking gravity for a meeting.',
    wildfire: 'Wildfire watch: NorCal trees have received a push notification from the wind.',
    floridaMan: 'Florida Man incident incoming. Traffic cones and local television crews are preparing.',
  };
  g.toast(line[kind], true);
  g.feed.push('weatherChange', { weather: g.climate.kind });
}

function respond(g: Game) {
  if (!event) return;
  const e = event;
  e.phase = 'response';
  e.day = Math.floor(g.sim.day);
  if (e.kind === 'hurricane') {
    const candidates = Array.from(g.net.segs.values()).filter(s => {
      const p = middle(s);
      return g.terrain.h(p.x, p.z) < WATER + 3.5;
    }).slice(0, 24);
    for (const s of candidates) { s.blocked = Math.max(s.blocked, 1200); e.segs.push(s.id); }
    let damaged = 0;
    for (const b of g.buildings.list.values()) {
      if (damaged >= 5 || g.terrain.h(b.x, b.z) > WATER + 2.5) continue;
      if (hash2(b.id, e.day, 802) < 0.22) { g.buildings.demolish(b, 'storm surge'); damaged++; }
    }
    e.cost = candidates.length * 180 + damaged * 850;
    g.toast(`Storm surge closed ${candidates.length} roads and damaged ${damaged} buildings. Recovery: $${e.cost.toLocaleString()}.`, true);
  } else if (e.kind === 'landslide') {
    const s = chooseRoad(g, seg => { const p = middle(seg); return g.terrain.slope(p.x, p.z) > 0.35; });
    if (s) {
      const p = middle(s); e.x = p.x; e.z = p.z;
      s.blocked = Math.max(s.blocked, 1200); e.segs.push(s.id);
      mudPile(g, p.x, p.z); g.particles.emit('dust', p.x, g.terrain.h(p.x, p.z) + 1, p.z, { count: 18, spread: 12 });
      e.cost = 1900;
      g.toast(`Mud buried ${s.name}. Crews estimate three to five days and a suspiciously round invoice.`, true);
    }
  } else if (e.kind === 'wildfire') {
    e.cost = 1400;
    fireStep(g, e);
    g.toast('Wildfire front is moving with the wind. Trees and buildings are at risk.', true);
  } else {
    const s = chooseRoad(g, () => true);
    if (s) {
      const p = middle(s); e.x = p.x; e.z = p.z;
      s.blocked = Math.max(s.blocked, 220); e.segs.push(s.id);
      const b = g.buildings.near(p.x, p.z, 250).find(b => b.state === 'active');
      if (b) g.traffic.dispatch('police', 'edge', b, 'incident', b.label, g.hour, { sober: true });
      g.toast(`Florida Man blocked ${s.name} with a homemade parade float.`, true);
    }
    e.cost = 350;
  }
  g.feed.push('trafficJam', { road: e.kind === 'floridaMan' ? 'Florida Man Boulevard' : `${e.kind} response` });
  // it struck where it is now (a landslide and Florida Man find their road above, a wildfire has moved once), and the
  // response starts in the same step: crews out, roads closed until recovery
  say(g, 'hit');
  say(g, 'response');
}

function fireStep(g: Game, e: Event) {
  const wind = g.climate.wind;
  const len = Math.hypot(wind.x, wind.y) || 1;
  e.x += wind.x / len * 30;
  e.z += wind.y / len * 30;
  // (blown off the county: nothing is burning any more)
  if (!g.terrain.inBounds(e.x, e.z, 30)) { g.sim.events.emit('fireFront', { points: new Float32Array(0) }); return; }
  const x = e.x, z = e.z;
  const count = g.trees.cut(x - 35, z - 35, x + 35, z + 35, (tx, tz) => Math.hypot(tx - x, tz - z) < 35);
  if (count) g.sim.events.emit('treesCleared', { x, z, r: 35, count, cause: 'fire' });
  // (in a dead calm the fire moved nowhere new; its front is drawn facing +x rather than collapsing to a point)
  if (wind.x || wind.y) sayFront(g, x, z, wind.x / len, wind.y / len); else sayFront(g, x, z, 1, 0);
  scorch(g, x, z, Paint.Scorched);
  scars.push([x, z, Math.floor(g.sim.day)]);
  g.particles.emit('fire', x, g.terrain.h(x, z) + 1, z, { count: 12, spread: 25 });
  const b = g.buildings.near(x, z, 32).find(b => b.state === 'active');
  if (b) {
    igniteBuilding(g, b);   // (now, in this step: it used to land whenever a lazy import resolved)
    e.cost += 700;
  }
}

function recover(g: Game) {
  if (!event) return;
  for (const id of event.segs) {
    const s = g.net.segs.get(id);
    if (s) s.blocked = 0;
  }
  clearMarker(g);
  if (event.cost) g.sim.spend(event.cost, `${NAME[event.kind]} recovery`, 'disasters');
  // say what it cost: the response toast only knew the hurricane's bill, and a landslide's was never named
  g.toast(`${NAME[event.kind]} recovery complete${event.cost ? `: ${usd(event.cost)} billed to the treasury` : ''}. The invoice survived.`);
  g.feed.push('weatherChange', { weather: g.climate.kind });
  say(g, 'end');
  if (event.kind === 'wildfire') g.sim.events.emit('fireFront', { points: new Float32Array(0) });
  event = null;
}

/** Debug entry point for deterministic scenario tests. */
export function triggerDisaster(g: Game, kind: Kind, x = 0, z = 0) { announce(g, kind, x, z); }
export function disasterState() { return { enabled, event }; }
export function setDisasters(on: boolean) { enabled = on; }

registerPanel({
  id: 'disasters', icon: '🌪️', label: 'Disasters', order: 104,
  render(el, g, rerender) {
    el.innerHTML = `<div class="sp-title">Disasters <small>Optional, expensive, and extremely televised.</small></div>
      <label class="terra-field"><input type="checkbox" ${enabled ? 'checked' : ''}> Enable regional disasters</label>
      <p>${event ? `${NAME[event.kind]}: ${event.phase === 'warning' ? 'warning issued, it hits tomorrow' : 'in progress, roads closed until recovery'}` : 'No active incident.'} Sandbox starts with disasters off.</p>`;
    el.querySelector<HTMLInputElement>('input')!.onchange = ev => {
      enabled = (ev.target as HTMLInputElement).checked;
      if (!enabled) recover(g);
      rerender();
    };
  },
});

registerSystem({
  id: 'disasters',
  init(g) { if (!initialized) { enabled = g.sim.mode !== 'sandbox'; initialized = true; } },
  daily(g, day) {
    for (const scar of scars.filter(s => day - s[2] >= 30)) scorch(g, scar[0], scar[1], Paint.None);
    scars = scars.filter(s => day - s[2] < 30);
    if (!enabled) return;
    if (event) {
      if (event.phase === 'warning' && day > event.day) respond(g);
      else if (event.phase === 'response') {
        if (event.kind === 'wildfire' && day - event.day < 4) fireStep(g, event);
        if (day - event.day >= (event.kind === 'landslide' ? 5 : event.kind === 'floridaMan' ? 2 : 4)) recover(g);
      }
      return;
    }
    const seed = g.map.def.seed;
    if (g.map.def.id === 'florida' && g.climate.kind === 'hurricane') announce(g, 'hurricane', 0, 0);
    else if (g.map.def.id === 'appalachia' && (g.climate.kind === 'rain' || g.climate.kind === 'storm') && hash2(day, seed, 112) < 0.07) announce(g, 'landslide', 0, 0);
    else if (g.map.def.id === 'norcal' && (g.climate.kind === 'heatwave' || g.climate.kind === 'wildfireSmoke') && hash2(day, seed, 222) < 0.12) {
      const b = [...g.buildings.list.values()].find(b => b.state === 'active');
      announce(g, 'wildfire', b?.x ?? 0, b?.z ?? 0);
    } else if (g.map.def.id === 'florida' && hash2(day, seed, 333) < 0.025) announce(g, 'floridaMan', 0, 0);
  },
  save() { return { enabled, event, scars }; },
  load(g, data) {
    if (!data || typeof data !== 'object') return;
    const saved = data as { enabled?: boolean; event?: Event | null; scars?: [number, number, number][] };
    enabled = !!saved.enabled; event = saved.event ?? null;
    scars = Array.isArray(saved.scars) ? saved.scars.filter(s => Array.isArray(s) && s.length === 3 && s.every(Number.isFinite)) : [];
    for (const [x, z] of scars) scorch(g, x, z, Paint.Scorched);
    if (event?.phase === 'response') {
      for (const id of event.segs) { const s = g.net.segs.get(id); if (s) s.blocked = 1200; }
      if (event.kind === 'landslide') mudPile(g, event.x, event.z);
    }
  },
});
