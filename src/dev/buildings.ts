// Dev gallery for the City Look workstream: every zone x level at a few lot
// sizes and seeds, all landmarks and billboards, orbit camera, day/night.
// Hash params: view=zones|landmarks|billboards|atlas, zone=<ZoneType>, level=<n>,
// night=1, labels=0, cols=<n>, e=1 (atlas: emissive layer)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZONE_TYPES, type BuildingModel, type LandmarkId, type ZoneType } from '../contracts';
import { buildingMaterial, generateBillboard, generateBuilding, generateLandmark, landmarkFootprint, loadArt, setBuildingNight } from '../buildings/generator';
import { BILLBOARDS } from '../art/billboards';
import { atlasStats, atlasTextures } from '../art';

const P = new URLSearchParams(location.hash.replace('#', ''));
const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const info = document.getElementById('info')!;

const LANDMARKS: LandmarkId[] = ['slopCannon', 'slop69Field', 'pigCabanaResort', 'neuralFlyDatacenter', 'propaneParadise', 'fillErUpMegaStation', 'megachurch', 'waterTower'];
const SIZES: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 4], [2, 3], [1, 2], [4, 2], [3, 4]];

// ------------------------------------------------------------------ three setup
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;

const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dd, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);
scene.fog = new THREE.Fog(0xb8c8d8, 600, 2600);

// subdivided so SwiftShader's depth interpolation doesn't let it poke through roads
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 80, 80), new THREE.MeshStandardMaterial({ color: 0x6f8a4a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3d, roughness: 0.95 });
const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8d25a });

let night = P.get('night') === '1';
function applyNight() {
  setBuildingNight(night ? 1 : 0);
  // roughly matches world/sky.ts at night (hemi 0.25, moon 0.35), a touch brighter to judge massing
  hemi.intensity = night ? 0.32 : 1.1;
  hemi.color.set(night ? 0x5a6a9a : 0xcfe3ff);
  sun.intensity = night ? 0.45 : 3.0;
  sun.color.set(night ? 0x8aa0ff : 0xfff1dd);
  const bg = night ? 0x0b1020 : 0xa9c4dc;
  scene.background = new THREE.Color(bg);
  (scene.fog as THREE.Fog).color.set(night ? 0x0b1020 : 0xb8c8d8);
  (ground.material as THREE.MeshStandardMaterial).color.set(night ? 0x2a3320 : 0x6f8a4a);
  refreshHud();
}

// ------------------------------------------------------------------ gallery content
interface Item {
  model: BuildingModel;
  x: number;
  z: number;
  label: string;
  sub: string;
  tris: number;
  ms: number;
}
const items: Item[] = [];
const group = new THREE.Group();
scene.add(group);
const labelEls: HTMLDivElement[] = [];
let showLabels = P.get('labels') !== '0';

function addRoad(x0: number, x1: number, z: number) {
  const r = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 10, Math.ceil((x1 - x0) / 20), 1), roadMat);
  r.rotation.x = -Math.PI / 2;
  r.position.set((x0 + x1) / 2, 0.01, z + 5);
  r.receiveShadow = true;
  group.add(r);
  const l = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.25), lineMat);
  l.rotation.x = -Math.PI / 2;
  l.position.set((x0 + x1) / 2, 0.02, z + 5);
  group.add(l);
}

function place(model: BuildingModel, x: number, z: number, D: number, sub: string, ms: number) {
  const tris = model.geometry.getAttribute('position').count / 3;
  items.push({ model, x, z: z - D / 2, label: model.label, sub, tris, ms });
}

function flush() {
  // Merge like core does: translate copies, then mergeGeometries in chunks.
  const chunk: THREE.BufferGeometry[] = [];
  const emPts: number[] = [];
  const emCol: number[] = [];
  const EMC: Record<string, number[]> = { smoke: [0.8, 0.8, 0.8], steam: [0.6, 0.9, 1], fire: [1, 0.4, 0.1], cigarette: [1, 0.2, 0.2], sparkle: [0.8, 1, 0.2] };
  const doMerge = () => {
    if (!chunk.length) return;
    const g = mergeGeometries(chunk, false);
    if (!g) throw new Error('mergeGeometries failed: attribute mismatch');
    const mesh = new THREE.Mesh(g, buildingMaterial());
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    chunk.forEach((c) => c.dispose());
    chunk.length = 0;
  };
  for (const it of items) {
    const g = it.model.geometry;
    g.translate(it.x, 0, it.z);
    chunk.push(g);
    if (chunk.length >= 40) doMerge();
    for (const e of it.model.emitters) {
      emPts.push(e.pos[0] + it.x, e.pos[1], e.pos[2] + it.z);
      emCol.push(...(EMC[e.kind] ?? [1, 1, 1]));
    }
  }
  doMerge();
  if (emPts.length) {
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(emPts, 3));
    eg.setAttribute('color', new THREE.Float32BufferAttribute(emCol, 3));
    const pts = new THREE.Points(eg, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    pts.name = 'emitters';
    group.add(pts);
  }
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.textContent = it.label;
    el.title = `${it.sub} · ${it.tris} tris · ${it.ms.toFixed(2)} ms`;
    document.body.appendChild(el);
    labelEls.push(el);
  }
}

function timed<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}

const stats: Record<string, { n: number; ms: number; maxMs: number; maxTris: number }> = {};
function stat(key: string, ms: number, tris: number) {
  const s = (stats[key] ??= { n: 0, ms: 0, maxMs: 0, maxTris: 0 });
  s.n++;
  s.ms += ms;
  s.maxMs = Math.max(s.maxMs, ms);
  s.maxTris = Math.max(s.maxTris, tris);
}

function buildZones() {
  const zones = P.get('zone') ? [P.get('zone') as ZoneType] : ZONE_TYPES;
  const levels = P.get('level') ? [+P.get('level')!] : [1, 2, 3, 4, 5];
  const cols = +(P.get('cols') ?? '8');
  const seeds = +(P.get('seeds') ?? '2');
  const colW = 40, rowD = 52;
  let row = 0;
  for (const zone of zones) {
    for (const level of levels) {
      let x = 0;
      const z = -row * rowD;
      let c = 0;
      for (const [w, d] of SIZES) {
        for (let s = 0; s < seeds && c < cols; s++, c++) {
          const seed = 1000 * level + 17 * w + 5 * d + s * 7919 + row * 131;
          const [m, ms] = timed(() => generateBuilding({ zone, level, widthCells: w, depthCells: d, seed }));
          const tris = m.geometry.getAttribute('position').count / 3;
          stat(`${zone} L${level}`, ms, tris);
          place(m, x + (w * 8) / 2, z, d * 8, `${zone} L${level} ${w}x${d} s${seed}`, ms);
          x += colW;
        }
      }
      addRoad(-10, x, z);
      row++;
    }
  }
  return { w: cols * colW, d: row * rowD };
}

function buildLandmarks() {
  let x = 0;
  for (const id of LANDMARKS) {
    const fp = landmarkFootprint(id);
    const [m, ms] = timed(() => generateLandmark(id, 1));
    const tris = m.geometry.getAttribute('position').count / 3;
    stat(`landmark ${id}`, ms, tris);
    place(m, x + (fp.widthCells * 8) / 2, 0, fp.depthCells * 8, `${id} ${fp.widthCells}x${fp.depthCells}`, ms);
    x += fp.widthCells * 8 + 24;
  }
  addRoad(-10, x, 0);
  return { w: x, d: 90 };
}

function buildBillboards() {
  const normal = BILLBOARDS.filter((b) => !b.merch).length;
  const merch = BILLBOARDS.length - normal;
  const perRow = 10;
  let i = 0;
  const put = (seed: number, m: boolean) => {
    const [model, ms] = timed(() => generateBillboard(seed, m));
    stat('billboard', ms, model.geometry.getAttribute('position').count / 3);
    const x = (i % perRow) * 30, z = -Math.floor(i / perRow) * 30;
    place(model, x, z, 4, `billboard seed ${seed}${m ? ' merch' : ''}`, ms);
    if (i % perRow === 0) addRoad(-16, perRow * 30, z);
    i++;
  };
  for (let s = 0; s < normal; s++) put(s, false);
  for (let s = 0; s < merch; s++) put(s, true);
  return { w: perRow * 30, d: Math.ceil(i / perRow) * 30 };
}

// ------------------------------------------------------------------ HUD
function refreshHud() {
  const view = P.get('view') ?? 'zones';
  hud.innerHTML = '';
  const btn = (label: string, on: boolean, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (on) b.className = 'on';
    b.onclick = fn;
    hud.appendChild(b);
  };
  const go = (k: string, v: string | null) => {
    if (v === null) P.delete(k);
    else P.set(k, v);
    location.hash = P.toString();
    location.reload();
  };
  btn(night ? 'Night' : 'Day', night, () => {
    night = !night;
    P.set('night', night ? '1' : '0');
    history.replaceState(null, '', '#' + P.toString());
    applyNight();
  });
  btn('Labels', showLabels, () => {
    showLabels = !showLabels;
    refreshHud();
  });
  hud.appendChild(document.createElement('br'));
  btn('All zones', view === 'zones' && !P.get('zone'), () => (P.delete('zone'), go('view', 'zones')));
  for (const z of ZONE_TYPES) btn(z, P.get('zone') === z, () => (P.set('view', 'zones'), go('zone', z)));
  hud.appendChild(document.createElement('br'));
  btn('Landmarks', view === 'landmarks', () => go('view', 'landmarks'));
  btn('Billboards', view === 'billboards', () => go('view', 'billboards'));
  btn('Atlas', view === 'atlas', () => go('view', 'atlas'));
}

// ------------------------------------------------------------------ main
function frame(target: THREE.Vector3, dist: number) {
  controls.target.copy(target);
  camera.position.set(target.x - dist * 0.55, dist * 0.62, target.z + dist * 0.75);
}

async function main() {
  refreshHud();
  const t0 = performance.now();
  await loadArt();
  const artMs = performance.now() - t0;
  const view = P.get('view') ?? 'zones';
  if (view === 'atlas') return showAtlas();
  applyNight();
  const t1 = performance.now();
  const ext = view === 'landmarks' ? buildLandmarks() : view === 'billboards' ? buildBillboards() : buildZones();
  const genMs = performance.now() - t1;
  flush();
  // camera
  const cam = P.get('cam');
  if (cam) {
    const [x, y, z, tx, ty, tz] = cam.split(',').map(Number);
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
  } else frame(new THREE.Vector3(ext.w * 0.3, 0, -ext.d * 0.35), Math.max(ext.w, ext.d) * 0.55);
  controls.update();
  const totalTris = items.reduce((a, b) => a + b.tris, 0);
  const lines = Object.entries(stats).map(([k, s]) => `${k.padEnd(28)} avg ${(s.ms / s.n).toFixed(2)}ms  max ${s.maxMs.toFixed(1)}ms  tris<=${s.maxTris}`);
  const st = atlasStats();
  info.textContent = `art ${artMs.toFixed(0)}ms · gen ${genMs.toFixed(0)}ms · ${items.length} models · ${totalTris.toLocaleString()} tris · atlas ${(st.fill * 100).toFixed(0)}%\n` + lines.join('\n');
  (window as unknown as { __gallery: unknown }).__gallery = {
    stats,
    items: items.map((i) => ({ label: i.label, sub: i.sub, tris: i.tris, ms: i.ms, x: i.x, z: i.z })),
    look(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
      camera.position.set(x, y, z);
      controls.target.set(tx, ty, tz);
      controls.update();
    },
    focus(i: number, dist = 40, az = 0.6, el = 0.5) {
      const it = items[i];
      const t = new THREE.Vector3(it.x, 4, it.z);
      controls.target.copy(t);
      camera.position.set(t.x + Math.sin(az) * dist * Math.cos(el), t.y + dist * Math.sin(el), t.z + Math.cos(az) * dist * Math.cos(el));
      controls.update();
    },
    night(n: boolean) {
      night = n;
      applyNight();
    },
    validate,
  };
  animate();
}

/**
 * Contract sweep: every level x lot size x 16 seeds for a zone. Checks the
 * geometry contract (non-indexed; exactly position/normal/uv/color; finite;
 * uv inside [0,1]), footprint overhang, triangle counts and generation time.
 */
function validate(zone: ZoneType) {
  const over: Record<string, { n: number; x: number; z: number }> = {};
  const worst: Record<string, number> = {};
  const times: number[] = [];
  let bad = 0, n = 0;
  for (let level = 1; level <= 5; level++) for (let w = 1; w <= 4; w++) for (let d = 1; d <= 4; d++) for (let s = 0; s < 16; s++) {
    const seed = 7 + s * 104729 + w * 31 + d * 17;
    const t0 = performance.now();
    const m = generateBuilding({ zone, level, widthCells: w, depthCells: d, seed });
    times.push(performance.now() - t0);
    n++;
    const g = m.geometry;
    if (g.index || Object.keys(g.attributes).sort().join(',') !== 'color,normal,position,uv') bad++;
    const p = g.getAttribute('position').array as Float32Array;
    const uv = g.getAttribute('uv').array as Float32Array;
    for (let i = 0; i < uv.length; i++) if (!(uv[i] >= 0 && uv[i] <= 1)) { bad++; break; }
    let ox = 0, oz = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (!Number.isFinite(p[i] + p[i + 1] + p[i + 2])) { bad++; break; }
      ox = Math.max(ox, Math.abs(p[i]) - w * 4);
      oz = Math.max(oz, Math.abs(p[i + 2]) - d * 4);
    }
    worst['L' + level] = Math.max(worst['L' + level] ?? 0, p.length / 9);
    if (ox > 0.3 || oz > 0.3) {
      const k = `L${level} ${m.label.replace(/\(.*\)/, '').trim().slice(0, 26)}`;
      const o = (over[k] ??= { n: 0, x: 0, z: 0 });
      o.n++;
      o.x = Math.max(o.x, ox);
      o.z = Math.max(o.z, oz);
    }
    g.dispose();
  }
  times.sort((a, b) => a - b);
  return {
    zone,
    n,
    bad,
    overhangs: Object.values(over).reduce((a, b) => a + b.n, 0),
    avgMs: +(times.reduce((a, b) => a + b, 0) / n).toFixed(2),
    p95Ms: +times[Math.floor(n * 0.95)].toFixed(2),
    maxTris: worst,
    top: Object.entries(over).sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, o]) => `${k}: n=${o.n} x+${o.x.toFixed(1)} z+${o.z.toFixed(1)}`),
  };
}

function showAtlas() {
  const { canvas, emissiveCanvas } = atlasTextures();
  const view = document.getElementById('atlasView')!;
  view.style.display = 'block';
  const em = P.get('e') === '1';
  const cv = em ? emissiveCanvas : canvas;
  const scale = +(P.get('s') ?? '0.25');
  const x = +(P.get('x') ?? '0'), y = +(P.get('y') ?? '0');
  const out = document.createElement('canvas');
  out.width = innerWidth;
  out.height = innerHeight;
  const c = out.getContext('2d')!;
  const k = em ? 2 : 1;
  c.drawImage(cv, x / k, y / k, innerWidth / scale / k, innerHeight / scale / k, 0, 0, innerWidth, innerHeight);
  view.appendChild(out);
  const st = atlasStats();
  info.textContent = `${st.tiles} tiles · fill ${(st.fill * 100).toFixed(1)}% · height ${st.usedHeight}\n` + Object.entries(st.byPrefix).map(([k2, v]) => `${k2}: ${(v * 100).toFixed(1)}%`).join('\n');
}

const v = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  // shadow box follows the orbit target
  const t = controls.target;
  const dist = camera.position.distanceTo(t);
  const s = THREE.MathUtils.clamp(dist * 0.9, 60, 400);
  sun.position.set(t.x + 180, 260, t.z + 120);
  sun.target.position.copy(t);
  const sc = sun.shadow.camera;
  if (sc.right !== s) {
    sc.left = sc.bottom = -s;
    sc.right = sc.top = s;
    sc.near = 10;
    sc.far = 900;
    sc.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  // labels
  for (let i = 0; i < items.length; i++) {
    const el = labelEls[i];
    if (!el) continue;
    const it = items[i];
    v.set(it.x, it.model.height + 3, it.z).project(camera);
    const d = camera.position.distanceTo(new THREE.Vector3(it.x, 0, it.z));
    const vis = showLabels && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && d < 420;
    el.style.display = vis ? 'block' : 'none';
    if (vis) {
      el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    }
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
addEventListener('keydown', (e) => {
  if (e.key === 'n') {
    night = !night;
    applyNight();
  }
  if (e.key === 'l') {
    showLabels = !showLabels;
    refreshHud();
  }
});

main();
