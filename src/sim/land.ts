// Land: the county is an 8x8 grid of 768 m tiles. You start with a 2x2 block
// around the town site and buy neighboring tiles to expand (Cities: Skylines
// style). Roads, zoning, services, landmarks, depots and terraforming are
// limited to land you own. Sandbox starts with the whole county.
import * as THREE from 'three';
import { HALF, WATER, WORLD } from '../config';
import { registerPanel, registerSystem, registerTool } from '../ext/registry';
import type { Game } from '../game';
import { LAND_MASK } from '../world/terrain';

export const LAND_N = 8;
export const TILE = WORLD / LAND_N;

const L = {
  owned: new Uint8Array(LAND_N * LAND_N),
  bought: 0,
  all: false,
  tex: null as THREE.DataTexture | null,
  border: null as THREE.Mesh | null,
  borderMat: null as THREE.ShaderMaterial | null,
  thumb: '' as string,
  panelOpen: false,
  selected: -1,
  rerender: null as (() => void) | null,
  loaded: false,
  checkedLegacy: false,
  start: -1,
};

const idx = (i: number, j: number) => j * LAND_N + i;
const clampT = (v: number) => Math.max(0, Math.min(LAND_N - 1, v));
export function tileOf(x: number, z: number): [number, number] {
  return [clampT(Math.floor((x + HALF) / TILE)), clampT(Math.floor((z + HALF) / TILE))];
}
export function landOwned(x: number, z: number): boolean {
  if (L.all) return true;
  const [i, j] = tileOf(x, z);
  return L.owned[idx(i, j)] === 1;
}
function buyable(i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= LAND_N || j >= LAND_N || L.owned[idx(i, j)]) return false;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
    const a = i + di, b = j + dj;
    return a >= 0 && b >= 0 && a < LAND_N && b < LAND_N && L.owned[idx(a, b)] === 1;
  });
}
/** Price of the next tile: each purchase makes the next one pricier. */
export function landPrice(): number {
  return 15000 + 9000 * L.bought;
}
const ownedCount = () => L.owned.reduce((a, b) => a + b, 0);
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function buy(g: Game, t: number): boolean {
  const i = t % LAND_N, j = Math.floor(t / LAND_N);
  if (!buyable(i, j)) { g.toast('You can only buy land next to land you already own.', true); g.audio.play('error'); return false; }
  const price = landPrice();
  if (price > g.sim.spendable()) { g.toast(`Not enough money: this tile costs ${money(price)}.`, true); g.audio.play('error'); return false; }
  g.sim.spend(price, 'Land purchase', 'construction');
  L.owned[t] = 1;
  L.bought++;
  L.selected = -1;
  refresh(g);
  g.audio.play('build');
  g.toast(`Bought a new tile of ${g.cityName} for ${money(price)}. Go sprawl on it.`);
  g.feed.push('zoned', {});
  return true;
}

// ------------------------------------------------------------------ visuals
function maskTexture(): THREE.DataTexture {
  if (!L.tex) {
    L.tex = new THREE.DataTexture(new Uint8Array(LAND_N * LAND_N * 4), LAND_N, LAND_N);
    L.tex.magFilter = THREE.NearestFilter;
    L.tex.minFilter = THREE.NearestFilter;
  }
  return L.tex;
}

function paintMask() {
  const tex = maskTexture();
  const D = tex.image.data as Uint8Array;
  for (let t = 0; t < LAND_N * LAND_N; t++) {
    const i = t % LAND_N, j = Math.floor(t / LAND_N);
    // owned = full light; while shopping, tiles for sale glow halfway
    const v = L.owned[t] ? 255 : L.panelOpen && buyable(i, j) ? (t === L.selected ? 230 : 150) : 0;
    D[t * 4] = D[t * 4 + 1] = D[t * 4 + 2] = v;
    D[t * 4 + 3] = 255;
  }
  tex.needsUpdate = true;
  LAND_MASK.tex.value = tex;
  LAND_MASK.on.value = L.all ? 0 : 1;
}

/** A soft wall of light along the edge of the land you own. */
function buildBorder(g: Game) {
  if (L.border) { g.scene.remove(L.border); L.border.geometry.dispose(); L.border = null; }
  if (L.all) return;
  const pos: number[] = [], uv: number[] = [];
  const yAt = (x: number, z: number) => Math.max(g.terrain.h(x, z), WATER) + 0.3;
  const wall = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 24);
    for (let k = 0; k < n; k++) {
      const ax = x0 + ((x1 - x0) * k) / n, az = z0 + ((z1 - z0) * k) / n;
      const bx = x0 + ((x1 - x0) * (k + 1)) / n, bz = z0 + ((z1 - z0) * (k + 1)) / n;
      const ya = yAt(ax, az), yb = yAt(bx, bz), H = 7;
      pos.push(ax, ya, az, bx, yb, bz, bx, yb + H, bz, ax, ya, az, bx, yb + H, bz, ax, ya + H, az);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
  };
  for (let j = 0; j < LAND_N; j++)
    for (let i = 0; i < LAND_N; i++) {
      if (!L.owned[idx(i, j)]) continue;
      const x0 = -HALF + i * TILE, z0 = -HALF + j * TILE, x1 = x0 + TILE, z1 = z0 + TILE;
      const out = (a: number, b: number) => a < 0 || b < 0 || a >= LAND_N || b >= LAND_N || !L.owned[idx(a, b)];
      if (out(i, j - 1)) wall(x0, z0, x1, z0);
      if (out(i, j + 1)) wall(x0, z1, x1, z1);
      if (out(i - 1, j)) wall(x0, z0, x0, z1);
      if (out(i + 1, j)) wall(x1, z0, x1, z1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (!L.borderMat) {
    L.borderMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.35 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * uOpacity; gl_FragColor = vec4(vec3(0.78, 0.96, 0.2) * 1.6, a); }',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  L.border = new THREE.Mesh(geo, L.borderMat);
  L.border.frustumCulled = false;
  L.border.renderOrder = 5;
  g.scene.add(L.border);
}

function refresh(g: Game) {
  const lim = L.all ? null : landOwned;
  g.net.allowed = lim;
  g.zones.allowed = lim;
  paintMask();
  buildBorder(g);
  if (L.borderMat) L.borderMat.uniforms.uOpacity.value = L.panelOpen ? 0.8 : 0.35;
  L.rerender?.();
}

/** Small top-down terrain picture for the panel (water blue, hills shaded). */
function thumbnail(g: Game): string {
  if (L.thumb) return L.thumb;
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  const img = x.createImageData(N, N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const wx = -HALF + ((i + 0.5) / N) * WORLD, wz = -HALF + ((j + 0.5) / N) * WORLD;
      const h = g.terrain.h(wx, wz);
      const k = (j * N + i) * 4;
      if (h < WATER) { img.data[k] = 40; img.data[k + 1] = 92; img.data[k + 2] = 128; }
      else {
        const t = Math.min(1, h / 140);
        img.data[k] = 70 + 90 * t; img.data[k + 1] = 110 + 40 * t; img.data[k + 2] = 58 + 60 * t;
      }
      img.data[k + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  L.thumb = c.toDataURL();
  return L.thumb;
}

// ------------------------------------------------------------------ UI
registerTool({
  id: 'landBuy',
  up: (g, p, _e, wasDrag) => {
    if (!p || wasDrag) return;
    const [i, j] = tileOf(p.x, p.z);
    const t = idx(i, j);
    if (L.owned[t]) { g.toast('You already own this land.'); return; }
    if (!buyable(i, j)) { g.toast('Buy the land next to yours first.', true); return; }
    if (L.selected === t) buy(g, t);
    else { L.selected = t; paintMask(); L.rerender?.(); }
  },
  tip: (g) => {
    const p = g.tools.hoverPoint;
    if (!p) return null;
    const [i, j] = tileOf(p.x, p.z);
    const t = idx(i, j);
    if (L.owned[t]) return { text: 'Your land' };
    if (!buyable(i, j)) return { text: 'Not for sale yet: buy the land next to yours first', bad: true };
    return { text: `${L.selected === t ? 'Tap again to buy' : 'Tile for sale'}: ${money(landPrice())}` };
  },
});

registerPanel({
  id: 'land',
  icon: '🏞️',
  label: 'Land',
  order: 32,
  render(el, g, rerender) {
    L.rerender = rerender;
    if (!L.panelOpen) {
      L.panelOpen = true;
      paintMask();
      if (L.borderMat) L.borderMat.uniforms.uOpacity.value = 0.8;
      if (!L.all) g.tools.setExt('landBuy');
    }
    if (L.all) {
      el.innerHTML = `<div class="sp-title">Land <small>Sandbox: the whole county is yours.</small></div>`;
      return;
    }
    const price = landPrice();
    const cells: string[] = [];
    for (let j = 0; j < LAND_N; j++)
      for (let i = 0; i < LAND_N; i++) {
        const t = idx(i, j);
        const cls = L.owned[t] ? 'own' : buyable(i, j) ? (t === L.selected ? 'sale sel' : 'sale') : 'no';
        cells.push(`<button class="land-cell ${cls}" data-t="${t}" ${cls === 'no' ? 'disabled' : ''}>${t === L.start ? '★' : cls.startsWith('sale') ? '$' : ''}</button>`);
      }
    const sel = L.selected >= 0 && buyable(L.selected % LAND_N, Math.floor(L.selected / LAND_N));
    el.innerHTML = `
      <div class="sp-title">Land <small>You own ${ownedCount()} of ${LAND_N * LAND_N} tiles. Buy land next to yours to keep sprawling.</small></div>
      <div class="land-wrap">
        <div class="land-map" style="background-image:url(${thumbnail(g)})">${cells.join('')}</div>
        <div class="land-side">
          <div class="svc-stat">Next tile: <b>${money(price)}</b><br><small>Each purchase costs $9,000 more than the last.</small></div>
          <button class="land-buy" ${sel ? '' : 'disabled'}>${sel ? `Buy this tile for ${money(price)}` : 'Pick a tile marked $'}</button>
          <small class="land-hint">Tap a glowing tile on the map (or here) to pick it, then buy. ★ = where the town started.</small>
        </div>
      </div>`;
    el.querySelectorAll<HTMLButtonElement>('.land-cell').forEach((b) => b.addEventListener('click', () => {
      const t = Number(b.dataset.t);
      if (L.owned[t]) return;
      L.selected = t;
      paintMask();
      rerender();
    }));
    el.querySelector<HTMLButtonElement>('.land-buy')?.addEventListener('click', () => { if (L.selected >= 0) buy(g, L.selected); });
  },
  close(g) {
    L.panelOpen = false;
    L.selected = -1;
    L.rerender = null;
    paintMask();
    if (L.borderMat) L.borderMat.uniforms.uOpacity.value = 0.35;
    if (g.tools.active === 'ext' && g.tools.extTool === 'landBuy') g.tools.set('inspect');
  },
});

// ------------------------------------------------------------------ system
function startBlock(g: Game) {
  L.owned.fill(0);
  L.bought = 0;
  const s = g.startView();
  const [si, sj] = tileOf(s.x, s.z);
  // of the four 2x2 blocks around the town site, prefer one with a shoreline
  // (water and sewage plants need one), then the one best centered on the site
  let best = { i0: 0, j0: 0, score: -Infinity };
  for (const i0 of [si - 1, si]) for (const j0 of [sj - 1, sj]) {
    const a = Math.max(0, Math.min(LAND_N - 2, i0)), b = Math.max(0, Math.min(LAND_N - 2, j0));
    let wet = 0;
    for (let v = 0; v < 24; v++) for (let u = 0; u < 24; u++) {
      const x = -HALF + (a + (u + 0.5) / 12) * TILE, z = -HALF + (b + (v + 0.5) / 12) * TILE;
      if (g.terrain.h(x, z) < WATER) wet++;
    }
    const cx = -HALF + (a + 1) * TILE, cz = -HALF + (b + 1) * TILE;
    const score = (wet > 3 && wet < 300 ? 1000 : 0) - Math.hypot(cx - s.x, cz - s.z) / TILE * 100;
    if (score > best.score) best = { i0: a, j0: b, score };
  }
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) L.owned[idx(best.i0 + di, best.j0 + dj)] = 1;
  L.start = idx(si, sj);
}

registerSystem({
  id: 'land',
  init(g) {
    L.all = g.sim.mode === 'sandbox';
    if (L.all) L.owned.fill(1);
    else startBlock(g);
    refresh(g);
  },
  daily(g) {
    if (L.checkedLegacy) return;
    L.checkedLegacy = true;
    // a city saved before land existed keeps every tile it already built on
    if (!L.loaded && !L.all) {
      let added = 0;
      for (const b of g.buildings.list.values()) {
        const [i, j] = tileOf(b.x, b.z);
        if (!L.owned[idx(i, j)]) { L.owned[idx(i, j)] = 1; added++; }
      }
      if (added) refresh(g);
    }
  },
  save() {
    return { owned: Array.from(L.owned).join(''), bought: L.bought, start: L.start };
  },
  load(g, data) {
    const d = data as { owned?: string; bought?: number; start?: number } | undefined;
    if (!d || typeof d.owned !== 'string' || d.owned.length !== LAND_N * LAND_N) return;
    L.loaded = true;
    if (L.all) return;
    for (let t = 0; t < L.owned.length; t++) L.owned[t] = d.owned[t] === '1' ? 1 : 0;
    L.bought = d.bought ?? 0;
    if (typeof d.start === 'number') L.start = d.start;
    refresh(g);
  },
});

(globalThis as unknown as { __land?: unknown }).__land = { L, buy, landOwned, landPrice, tileOf };
