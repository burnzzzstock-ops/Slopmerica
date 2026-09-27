import { Model, THREE, variation } from './kit.mjs';

const PI = Math.PI;
const TAU = THREE.MathUtils.degToRad(360);
const segs = (lod, hi = 16) => lod === 0 ? hi : lod === 1 ? Math.max(8, hi >> 1) : 6;
const box = (m, name, size, pos, material, rotation) =>
  m.box(name, size, pos, material, { bevel: 0.025, ...(rotation ? { rotation } : {}) });
const cyl = (m, name, rt, rb, h, pos, material, lod, rotation) =>
  m.cylinder(name, rt, rb, h, pos, material, { segments: segs(lod), ...(rotation ? { rotation } : {}) });
const sphere = (m, name, size, pos, material) => m.sphere(name, size, pos, material);
const torus = (m, name, radius, tube, pos, material, lod, rotation, arc = TAU) =>
  m.torus(name, radius, tube, pos, material, { segments: segs(lod), rotation, arc });
const sign = (m, name, size, pos, rotation) => m.sign(name, size, pos, rotation ? { rotation } : {});

function siteVariation(m, v, w, d, lod, industrial = false) {
  const sx = (v.layout - 1.5) * w * 0.13;
  const z = d * 0.5 + 0.22;
  box(m, 'site-pad', [w * 1.04, 0.12, d * 1.04], [0, 0.06, 0], industrial ? 'asphalt' : 'concrete');
  box(m, 'variant-apron', [Math.max(1.2, w * (0.22 + v.size * 0.025)), 0.08, 0.8 + v.layout * 0.18], [sx, 0.13, z], 'asphalt');
  const n = lod === 2 ? 1 : 1 + v.size;
  for (let i = 0; i < n; i++) {
    const x = -w * 0.38 + i * (w * 0.76 / Math.max(1, n - 1));
    cyl(m, `bollard-${i}`, 0.07, 0.08, 0.62 + v.layout * 0.04, [x, 0.43, z + 0.12], v.state ? 'paint-orange' : 'paint-yellow', lod);
  }
  const cabinetH = 0.75 + v.size * 0.06;
  box(m, 'layout-cabinet', [0.45 + v.layout * 0.12, cabinetH, 0.32], [v.side * (w * 0.5 + 0.2), cabinetH / 2 + 0.12, (v.layout - 1.5) * d * 0.15], 'metal-galvanized');
  if (v.state) {
    box(m, 'deferred-maintenance-skip', [1.15 + v.size * 0.12, 0.75, 0.65], [-v.side * w * 0.34, 0.5, -d * 0.44], 'paint-orange');
    if (lod < 2) box(m, 'skip-rubble', [0.72, 0.2, 0.5], [-v.side * w * 0.34, 0.98, -d * 0.44], 'concrete', [0, 0.2 * v.layout, 0]);
  }
}

function civicShell(m, v, lod, o = {}) {
  const w = (o.w ?? 9) * v.scale, d = (o.d ?? 6) * v.scale, h = (o.h ?? 4) * (0.94 + v.size * 0.035);
  siteVariation(m, v, w, d, lod);
  box(m, 'civic-shell', [w, h, d], [0, h / 2 + 0.12, 0], o.wall ?? 'brick-cream');
  box(m, 'flat-budget-roof', [w + 0.3, 0.25, d + 0.3], [0, h + 0.25, 0], o.roof ?? 'roof-metal');
  const entranceX = (v.layout - 1.5) * w * 0.16;
  box(m, 'entrance-recess', [2.0 + v.size * 0.12, 2.6, 0.24], [entranceX, 1.42, d / 2 + 0.13], 'metal-dark');
  box(m, 'glass-doors', [1.5, 2.15, 0.12], [entranceX, 1.3, d / 2 + 0.28], 'glass-blue');
  if (lod < 2) {
    const windows = 2 + v.size;
    for (let i = 0; i < windows; i++) {
      const x = -w * 0.38 + i * (w * 0.76 / Math.max(1, windows - 1));
      if (Math.abs(x - entranceX) > 1.15) box(m, `window-${i}`, [0.85, 1.15, 0.1], [x, h * 0.58, d / 2 + 0.15], 'glass-blue');
    }
  }
  if (o.columns) for (let i = 0; i < (lod === 2 ? 2 : 2 + v.layout); i++) {
    const x = -w * 0.34 + i * (w * 0.68 / Math.max(1, 1 + v.layout));
    cyl(m, `column-${i}`, 0.16, 0.19, 2.9, [x, 1.57, d / 2 + 0.62], 'limestone', lod);
  }
  sign(m, 'civic-sign', [Math.min(w * 0.62, 6.2), 0.9], [0, h - 0.72, d / 2 + 0.18]);
  return { w, d, h, entranceX };
}

function shed(m, v, lod, o = {}) {
  const w = (o.w ?? 14) * v.scale, d = (o.d ?? 9) * v.scale, h = (o.h ?? 5) * (0.96 + v.size * 0.025);
  siteVariation(m, v, w, d, lod, true);
  box(m, 'industrial-shell', [w, h, d], [0, h / 2 + 0.12, 0], o.wall ?? 'metal-galvanized');
  box(m, 'industrial-roof', [w + 0.35, 0.28, d + 0.35], [0, h + 0.27, 0], o.roof ?? 'roof-metal');
  const bays = lod === 2 ? Math.min(2, v.bays) : v.bays;
  for (let i = 0; i < bays; i++) {
    const x = -w * 0.38 + i * (w * 0.76 / Math.max(1, bays - 1));
    box(m, `loading-bay-${i}`, [Math.min(2.2, w / (bays + 1)), 2.5, 0.16], [x, 1.38, d / 2 + 0.12], 'metal-dark');
    if (lod < 2) box(m, `dock-${i}`, [1.8, 0.45, 1.0], [x, 0.35, d / 2 + 0.58], 'concrete');
  }
  return { w, d, h };
}

function permitPalace(m, v, lod) {
  const q = civicShell(m, v, lod, { w: 10, d: 7, h: 4.5, wall: 'limestone', columns: true });
  const lanes = lod === 2 ? 1 : 2 + v.layout;
  for (let i = 0; i < lanes; i++) box(m, `queue-rail-${i}`, [0.06, 0.8, 2 + v.size * 0.35], [-1.6 + i * 0.8, 0.52, q.d / 2 + 1.5], 'metal-dark');
  box(m, 'approval-stamp-cupola', [1.6 + v.size * 0.12, 0.8, 1.6], [0, q.h + 0.78, 0], 'brick-red');
}

function dmvAnnex(m, v, lod) {
  const q = civicShell(m, v, lod, { w: 12, d: 6, h: 3.7, wall: 'stucco-ivory' });
  const n = lod === 2 ? 2 : 3 + v.size;
  for (let i = 0; i < n; i++) box(m, `test-lane-${i}`, [1.3, 0.05, 4 + v.layout], [-q.w * 0.38 + i * (q.w * 0.76 / Math.max(1, n - 1)), 0.19, -q.d / 2 - 2.1], 'paint-white');
  box(m, 'number-board', [1.2, 0.75, 0.14], [v.side * 2.2, 2.25, q.d / 2 + 0.18], 'paint-red');
}

function zoningHall(m, v, lod) {
  const q = civicShell(m, v, lod, { w: 11, d: 8, h: 5, wall: 'brick-red', columns: true });
  box(m, 'public-comment-dais', [3.3 + v.size * 0.25, 0.8, 1.2], [0, 0.55, q.d / 2 + 1.0], 'wood-oak');
  const n = lod === 2 ? 2 : 4 + v.layout;
  for (let i = 0; i < n; i++) box(m, `hearing-chair-${i}`, [0.45, 0.75, 0.45], [(-n / 2 + i) * 0.72, 0.52, q.d / 2 + 2.1], 'wood-painted');
}

function assessorBunker(m, v, lod) {
  const q = civicShell(m, v, lod, { w: 9, d: 8, h: 3.6, wall: 'concrete', roof: 'concrete' });
  const vaultH = 2.5 + v.size * 0.15;
  box(m, 'records-vault', [q.w * 0.38, vaultH, q.d * 0.38], [v.side * q.w * 0.25, vaultH / 2 + 0.12, -q.d * 0.2], 'metal-dark');
  const slits = lod === 2 ? 1 : 2 + v.layout;
  for (let i = 0; i < slits; i++) box(m, `window-slit-${i}`, [0.65, 0.25, 0.12], [-1.2 + i * 0.8, 2.7, q.d / 2 + 0.19], 'glass-blue');
}

function publicWorks(m, v, lod) {
  const q = shed(m, v, lod, { w: 14, d: 9, h: 5, wall: 'brick-cream' });
  const bins = lod === 2 ? 2 : 3 + v.size;
  const binH = 1.1 + 0.12 * v.layout;
  for (let i = 0; i < bins; i++) box(m, `material-bin-${i}`, [1.6, binH, 1.7], [-q.w * 0.38 + i * 1.9, binH / 2 + 0.12, -q.d / 2 - 1.0], i % 2 ? 'soil' : 'concrete');
  const saltH = 4.8 + v.layout * 0.35;
  cyl(m, 'salt-silo', 1.35 + v.size * 0.08, 1.15, saltH, [q.w * 0.34, saltH / 2 + 0.12, -q.d * 0.22], 'metal-galvanized', lod);
}

function firehouse(m, v, lod) {
  const q = civicShell(m, v, lod, { w: 11, d: 8, h: 5.2, wall: 'brick-red' });
  const bays = lod === 2 ? 2 : Math.min(4, 2 + v.size);
  for (let i = 0; i < bays; i++) box(m, `engine-door-${i}`, [1.8, 3.0, 0.18], [-q.w * 0.32 + i * (q.w * 0.64 / Math.max(1, bays - 1)), 1.65, q.d / 2 + 0.22], 'paint-red');
  cyl(m, 'hose-drying-tower', 1.0, 1.05, 5 + v.layout * 0.65, [v.side * q.w * 0.34, q.h + 1.9, -q.d * 0.18], 'brick-red', lod);
  box(m, 'tower-cap', [2.35, 0.28, 2.35], [v.side * q.w * 0.34, q.h + 4.48 + v.layout * 0.65, -q.d * 0.18], 'roof-metal');
}

function sheriff(m, v, lod) {
  const q = civicShell(m, v, lod, { w: 10, d: 7, h: 4.4, wall: 'brick-cream' });
  box(m, 'sally-port', [3.6 + v.size * 0.2, 3.0, 4], [v.side * (q.w / 2 + 1.7), 1.62, -0.7], 'concrete');
  box(m, 'sally-door', [2.6, 2.25, 0.15], [v.side * (q.w / 2 + 1.7), 1.35, 1.36], 'metal-dark');
  cyl(m, 'radio-mast', 0.08, 0.11, 4 + v.layout, [-v.side * q.w * 0.34, q.h + 2.2, 0], 'metal-dark', lod);
  if (lod < 2) torus(m, 'mast-loop', 0.55, 0.05, [-v.side * q.w * 0.34, q.h + 3.8 + v.layout, 0], 'metal-dark', lod, [PI / 2, 0, 0]);
}

function transitKiosk(m, v, lod) {
  const w = 3.4 * v.scale, d = 2.6 * v.scale;
  siteVariation(m, v, w, d, lod);
  const kioskH = 2.8 + v.size * 0.08;
  box(m, 'kiosk', [w, kioskH, d], [0, kioskH / 2 + 0.12, 0], 'paint-teal');
  box(m, 'awning', [w + 0.45 + v.layout * 0.15, 0.18, 1.15], [v.side * 0.15, 2.55, d / 2 + 0.45], 'roof-metal');
  box(m, 'ticket-window', [1.25, 1.1, 0.1], [0, 1.45, d / 2 + 0.12], 'glass-blue');
  const machines = lod === 2 ? 1 : 1 + v.size;
  for (let i = 0; i < machines; i++) box(m, `fare-machine-${i}`, [0.38, 1.15, 0.32], [(-machines / 2 + i + 0.5) * 0.5, 0.72, d / 2 + 0.42], 'metal-dark');
  sign(m, 'token-sign', [2.4, 0.72], [0, 2.35, d / 2 + 0.18]);
}

function busDepot(m, v, lod) {
  const q = shed(m, v, lod, { w: 16, d: 10, h: 5.8, wall: 'metal-galvanized' });
  const canopies = lod === 2 ? 1 : 2 + v.layout;
  for (let i = 0; i < canopies; i++) {
    const x = (-canopies / 2 + i + 0.5) * 2.8;
    box(m, `bus-canopy-${i}`, [2.4, 0.18, 6 + v.size * 0.45], [x, 3.3, q.d / 2 + 3], 'roof-metal');
    box(m, `canopy-post-${i}`, [0.16, 3.1, 0.16], [x, 1.65, q.d / 2 + 3], 'metal-dark');
  }
  sign(m, 'depot-sign', [5.5, 1], [0, q.h - 0.8, q.d / 2 + 0.18]);
}

function tollPlaza(m, v, lod) {
  const lanes = lod === 2 ? 2 : 3 + v.size;
  const w = lanes * 3.1, d = 7 + v.layout;
  siteVariation(m, v, w, d, lod, true);
  box(m, 'toll-canopy', [w + 1, 0.45, 4.2 + v.layout * 0.35], [0, 4.2, 0], 'roof-metal');
  for (let i = 0; i < lanes; i++) {
    const x = (-lanes / 2 + i + 0.5) * 3.1;
    box(m, `toll-island-${i}`, [0.55, 0.32, d], [x, 0.28, 0], 'concrete');
    box(m, `toll-booth-${i}`, [1.05, 2.25, 1.45], [x, 1.5, v.side * 0.55], i === v.layout % lanes ? 'paint-yellow' : 'paint-blue');
    if (lod < 2) box(m, `barrier-${i}`, [2.2, 0.08, 0.12], [x + 1.15, 1.0, -v.side * 1.5], 'paint-red', [0, 0, (i % 2 ? -1 : 1) * 0.16]);
  }
  sign(m, 'toll-sign', [Math.min(7, w * 0.5), 0.95], [0, 4.34, 0.4]);
}

function expressGantry(m, v, lod) {
  const w = (14 + v.size * 2.8) * v.scale;
  siteVariation(m, v, w, 3.2, lod, true);
  box(m, 'left-pier', [0.55, 6 + v.layout * 0.35, 0.55], [-w / 2, 3.1 + v.layout * 0.175, 0], 'metal-galvanized');
  box(m, 'right-pier', [0.55, 6 + v.layout * 0.35, 0.55], [w / 2, 3.1 + v.layout * 0.175, 0], 'metal-galvanized');
  box(m, 'gantry-truss', [w + 0.55, 0.48, 0.55], [0, 5.8 + v.layout * 0.35, 0], 'metal-galvanized');
  const boards = lod === 2 ? 2 : 2 + v.size;
  for (let i = 0; i < boards; i++) sign(m, `lane-rate-${i}`, [1.7, 1.2], [(-boards / 2 + i + 0.5) * (w * 0.72 / boards), 5.05 + v.layout * 0.35, 0.36]);
  if (lod < 2) for (let i = 0; i < 2 + v.layout; i++) cyl(m, `camera-${i}`, 0.16, 0.12, 0.35, [(-1.5 + i) * 1.4, 6.18 + v.layout * 0.35, 0], 'metal-dark', lod, [PI / 2, 0, 0]);
}

function parkingGarage(m, v, lod) {
  const floors = lod === 2 ? 2 : 3 + v.size;
  const w = 15 * v.scale, d = (9 + v.layout) * v.scale, floorH = 2.25;
  siteVariation(m, v, w, d, lod, true);
  for (let f = 0; f < floors; f++) {
    box(m, `deck-${f}`, [w, 0.28, d], [0, 0.32 + f * floorH, 0], 'concrete');
    const posts = lod === 0 ? 5 : lod === 1 ? 3 : 2;
    for (let i = 0; i < posts; i++) for (const z of [-d * 0.4, d * 0.4]) box(m, `post-${f}-${i}-${z}`, [0.32, floorH, 0.32], [-w * 0.42 + i * (w * 0.84 / Math.max(1, posts - 1)), 1.3 + f * floorH, z], 'concrete');
  }
  box(m, 'ramp', [w * 0.6, 0.24, 2.0], [v.side * w * 0.08, floors * floorH * 0.48, -d * 0.25], 'concrete', [0, 0, v.side * 0.17]);
  sign(m, 'parking-sign', [2.3, 1.7], [v.side * w * 0.36, floors * floorH - 0.8, d / 2 + 0.2]);
}

function surfaceParking(m, v, lod) {
  const w = (17 + v.size * 3) * v.scale, d = (12 + v.layout * 2) * v.scale;
  siteVariation(m, v, w, d, lod, true);
  box(m, 'parking-field', [w, 0.12, d], [0, 0.2, 0], 'asphalt');
  const rows = lod === 2 ? 2 : 3 + v.layout;
  const stalls = lod === 0 ? 5 + v.size : 3;
  for (let r = 0; r < rows; r++) for (let i = 0; i < stalls; i++) {
    const x = -w * 0.4 + i * (w * 0.8 / Math.max(1, stalls - 1));
    const z = -d * 0.36 + r * (d * 0.72 / Math.max(1, rows - 1));
    box(m, `stripe-${r}-${i}`, [0.07, 0.025, 2.7], [x, 0.275, z], 'paint-white', [0, v.layout % 2 ? 0.1 : 0, 0]);
  }
  const lights = lod === 2 ? 1 : 1 + v.size;
  for (let i = 0; i < lights; i++) {
    const x = -w * 0.35 + i * w * 0.7 / Math.max(1, lights - 1);
    const poleH = 5 + v.layout * 0.3;
    cyl(m, `light-pole-${i}`, 0.07, 0.12, poleH, [x, poleH / 2 + 0.12, 0], 'metal-dark', lod);
    box(m, `light-head-${i}`, [1.0, 0.18, 0.28], [x, 5.35 + v.layout * 0.3, 0], 'paint-white');
  }
  sign(m, 'minimum-sign', [3.8, 1.0], [v.side * w * 0.28, 2.0, d / 2 + 0.2]);
}

function busStop(m, v, lod) {
  const w = (3.6 + v.size * 0.45) * v.scale, d = 1.8 + v.layout * 0.25;
  siteVariation(m, v, w, d, lod);
  box(m, 'shelter-roof', [w, 0.18, d], [0, 2.65, 0], 'roof-metal');
  box(m, 'back-glass', [w, 2.35, 0.1], [0, 1.38, -d / 2], 'glass-blue');
  for (const x of [-w / 2, w / 2]) box(m, `shelter-post-${x}`, [0.12, 2.6, 0.12], [x, 1.4, 0], 'metal-dark');
  box(m, 'bench', [w * 0.62, 0.18, 0.45], [v.side * w * 0.08, 0.72, -d * 0.25], 'wood-painted');
  box(m, 'bench-leg', [0.16, 0.65, 0.16], [v.side * w * 0.08, 0.4, -d * 0.25], 'metal-dark');
  const routeH = 3.3 + v.size * 0.12;
  cyl(m, 'route-pole', 0.055, 0.07, routeH, [v.side * (w / 2 + 0.55), routeH / 2 + 0.12, v.layout * 0.12], 'metal-dark', lod);
  sign(m, 'route-sign', [0.65 + v.layout * 0.08, 0.85], [v.side * (w / 2 + 0.55), 3.05 + v.size * 0.12, 0.07]);
}

function pedestrianOverpass(m, v, lod) {
  const span = (12 + v.size * 2.2) * v.scale, h = 5.4 + v.layout * 0.45;
  siteVariation(m, v, span, 3.0, lod, true);
  box(m, 'walkway', [span, 0.35, 2.0], [0, h, 0], 'concrete');
  for (const x of [-span / 2, span / 2]) box(m, `tower-${x}`, [2.0, h, 2.0], [x, h / 2, 0], 'metal-galvanized');
  const rails = lod === 2 ? 2 : 3 + v.size;
  for (let i = 0; i < rails; i++) {
    const x = -span * 0.38 + i * span * 0.76 / Math.max(1, rails - 1);
    box(m, `cage-rib-${i}`, [0.08, 1.9, 2.15], [x, h + 1.05, 0], 'metal-dark');
  }
  box(m, 'stair-a', [span * 0.22, 0.35, 1.5], [-span * 0.42, h * 0.48, v.side * 1.2], 'concrete', [0, 0, 0.36]);
  box(m, 'stair-b', [span * 0.22, 0.35, 1.5], [span * 0.42, h * 0.48, -v.side * 1.2], 'concrete', [0, 0, -0.36]);
  sign(m, 'crossing-sign', [3.8, 0.8], [0, h + 1.55, 1.15]);
}

function retentionPond(m, v, lod) {
  const w = (11 + v.size * 2) * v.scale, d = (8 + v.layout) * v.scale;
  siteVariation(m, v, w, d, lod);
  box(m, 'berm', [w, 0.7, d], [0, 0.45, 0], 'soil');
  box(m, 'pond-water', [w * 0.82, 0.08, d * 0.75], [v.side * w * 0.04, 0.84, 0], 'glass-blue');
  const pipes = lod === 2 ? 1 : 1 + v.size;
  for (let i = 0; i < pipes; i++) cyl(m, `inlet-${i}`, 0.32, 0.32, 2.2 + v.layout * 0.2, [-w * 0.3 + i * 1.0, 1.15, -d * 0.42], 'concrete', lod, [PI / 2, 0, 0]);
  box(m, 'control-box', [1.4, 1.1 + v.size * 0.12, 1.2], [w * 0.32, 1.38, d * 0.25], 'metal-galvanized');
  sign(m, 'serenity-sign', [3.1, 0.85], [0, 2.0, d / 2 + 0.3]);
}

function culvertGateway(m, v, lod) {
  const w = (8 + v.size) * v.scale, d = 5 + v.layout * 0.65;
  siteVariation(m, v, w, d, lod, true);
  box(m, 'road-slab', [w, 0.7, d], [0, 2.0, 0], 'concrete');
  const barrels = lod === 2 ? 1 : 1 + Math.floor(v.size / 2) + (v.layout === 3 ? 1 : 0);
  for (let i = 0; i < barrels; i++) {
    const x = (-barrels / 2 + i + 0.5) * 2.3;
    cyl(m, `culvert-${i}`, 0.9, 0.9, d + 0.5, [x, 1.0, 0], 'metal-galvanized', lod, [PI / 2, 0, 0]);
    torus(m, `culvert-rim-${i}`, 0.9, 0.1, [x, 1.0, d / 2 + 0.28], 'metal-dark', lod, [PI / 2, 0, 0]);
  }
  box(m, 'left-headwall', [0.6, 3.2, d + 0.5], [-w / 2, 1.65, 0], 'concrete');
  box(m, 'right-headwall', [0.6, 3.2, d + 0.5], [w / 2, 1.65, 0], 'concrete');
  sign(m, 'culvert-sign', [2.9, 0.8], [0, 2.55, d / 2 + 0.38]);
}

function waterTower(m, v, lod) {
  const r = (2.2 + v.size * 0.25) * v.scale, h = 11 + v.layout * 1.2;
  siteVariation(m, v, r * 4, r * 4, lod);
  const legs = lod === 2 ? 3 : 4 + (v.size % 2);
  for (let i = 0; i < legs; i++) {
    const a = i / legs * TAU;
    cyl(m, `tower-leg-${i}`, 0.12, 0.22, h, [Math.cos(a) * r * 0.8, h / 2 + 0.12, Math.sin(a) * r * 0.8], 'metal-galvanized', lod, [0, 0, Math.cos(a) * 0.05]);
  }
  cyl(m, 'water-tank', r, r * 0.82, r * 2.0, [0, h + r * 0.4, 0], 'paint-white', lod);
  sphere(m, 'tank-dome', [r, r * 0.52, r], [0, h + r * 1.38, 0], 'paint-white');
  cyl(m, 'tank-stem', 0.48, 0.62, h * 0.5, [0, h * 0.75, 0], 'metal-galvanized', lod);
  sign(m, 'county-name', [r * 1.45, r * 0.48], [0, h + r * 0.55, r + 0.05]);
}

function pumpStation(m, v, lod) {
  const q = civicShell(m, v, lod, { w: 7, d: 6, h: 3.2, wall: 'brick-cream' });
  const pumps = lod === 2 ? 1 : 2 + v.size;
  for (let i = 0; i < pumps; i++) {
    const x = -q.w * 0.34 + i * q.w * 0.68 / Math.max(1, pumps - 1);
    cyl(m, `pump-${i}`, 0.42, 0.48, 1.3 + v.layout * 0.12, [x, 0.88, -q.d / 2 - 0.75], 'paint-blue', lod);
    if (lod < 2) torus(m, `pump-elbow-${i}`, 0.46, 0.1, [x, 1.5, -q.d / 2 - 0.75], 'metal-copper', lod, [PI / 2, 0, 0], PI);
  }
  box(m, 'intake-screen', [2.4 + v.size * 0.25, 1.5, 0.25], [v.side * 1.5, 0.9, q.d / 2 + 0.25], 'metal-dark');
}

function wastewater(m, v, lod) {
  const w = (15 + v.size * 1.8) * v.scale, d = (11 + v.layout) * v.scale;
  siteVariation(m, v, w, d, lod, true);
  const basins = lod === 2 ? 2 : 3 + v.size;
  for (let i = 0; i < basins; i++) {
    const x = (-basins / 2 + i + 0.5) * (w * 0.76 / basins);
    cyl(m, `clarifier-${i}`, 1.5 + v.layout * 0.12, 1.5 + v.layout * 0.12, 0.8, [x, 0.62, 0], 'concrete', lod);
    cyl(m, `clarifier-water-${i}`, 1.28 + v.layout * 0.12, 1.28 + v.layout * 0.12, 0.06, [x, 1.05, 0], 'glass-blue', lod);
    if (lod < 2) box(m, `sweep-arm-${i}`, [2.4, 0.08, 0.12], [x, 1.15, 0], 'metal-dark', [0, (i + v.layout) * 0.6, 0]);
  }
  box(m, 'control-building', [5.0, 3.2, 4.0], [v.side * w * 0.28, 1.72, -d * 0.32], 'brick-cream');
  sign(m, 'treatment-sign', [4.0, 0.85], [v.side * w * 0.28, 2.55, -d * 0.32 + 2.05]);
}

function sewageOutfall(m, v, lod) {
  const w = (7 + v.size) * v.scale, d = 7 + v.layout;
  siteVariation(m, v, w, d, lod, true);
  box(m, 'outfall-headwall', [w, 3.6, 1.0], [0, 1.9, -d * 0.28], 'concrete');
  const pipes = lod === 2 ? 1 : 1 + Math.floor(v.size / 2) + (v.layout > 1 ? 1 : 0);
  for (let i = 0; i < pipes; i++) {
    const x = (-pipes / 2 + i + 0.5) * 2.0;
    cyl(m, `outfall-pipe-${i}`, 0.72, 0.72, d * 0.65, [x, 1.15, 0.2], 'metal-dark', lod, [PI / 2, 0, 0]);
    torus(m, `outfall-rim-${i}`, 0.72, 0.12, [x, 1.15, d * 0.52], 'metal-galvanized', lod, [PI / 2, 0, 0]);
  }
  box(m, 'discharge-channel', [w * 0.72, 0.18, d * 0.7], [v.side * 0.25, 0.35, d * 0.43], 'glass-blue');
  sign(m, 'outfall-sign', [3.2, 0.8], [0, 3.05, -d * 0.28 + 0.56]);
}

function substation(m, v, lod) {
  const w = (12 + v.size * 1.5) * v.scale, d = (9 + v.layout) * v.scale;
  siteVariation(m, v, w, d, lod, true);
  const rows = lod === 2 ? 1 : 2 + (v.layout % 2);
  const units = lod === 2 ? 2 : 3 + v.size;
  for (let r = 0; r < rows; r++) for (let i = 0; i < units; i++) {
    const x = -w * 0.34 + i * w * 0.68 / Math.max(1, units - 1), z = -d * 0.22 + r * d * 0.44;
    const transformerH = 1.6 + v.layout * 0.12;
    box(m, `transformer-${r}-${i}`, [1.15, transformerH, 0.9], [x, transformerH / 2 + 0.12, z], 'metal-galvanized');
    cyl(m, `insulator-${r}-${i}`, 0.12, 0.12, 1.1, [x, 2.25 + v.layout * 0.12, z], 'metal-copper', lod);
  }
  for (const x of [-w * 0.44, w * 0.44]) {
    const busPoleH = 4.5 + v.size * 0.15;
    box(m, `bus-pole-${x}`, [0.2, busPoleH, 0.2], [x, busPoleH / 2 + 0.12, 0], 'metal-dark');
    box(m, `busbar-${x}`, [w * 0.85, 0.12, 0.12], [0, 4.25 + v.size * 0.15, x > 0 ? d * 0.23 : -d * 0.23], 'metal-copper');
  }
  sign(m, 'grid-sign', [3.0, 0.8], [0, 2.0, d / 2 + 0.2]);
}

function peakerPlant(m, v, lod) {
  const q = shed(m, v, lod, { w: 13, d: 9, h: 5.4, wall: 'metal-dark' });
  const turbines = lod === 2 ? 1 : 2 + v.size;
  for (let i = 0; i < turbines; i++) {
    const x = -q.w * 0.35 + i * q.w * 0.7 / Math.max(1, turbines - 1);
    cyl(m, `turbine-${i}`, 0.65, 0.78, 3.4 + v.layout * 0.2, [x, 1.9, -q.d / 2 - 1.0], 'paint-blue', lod, [PI / 2, 0, 0]);
    cyl(m, `exhaust-${i}`, 0.23, 0.34, 4.5 + v.layout * 0.5, [x, q.h + 2.2, -q.d * 0.15], 'metal-galvanized', lod);
  }
  sign(m, 'peaker-sign', [4.2, 0.9], [0, q.h - 0.8, q.d / 2 + 0.18]);
}

function coalPlant(m, v, lod) {
  const q = shed(m, v, lod, { w: 18, d: 13, h: 8, wall: 'brick-red' });
  const stacks = lod === 2 ? 1 : 2 + (v.size > 2 ? 1 : 0);
  for (let i = 0; i < stacks; i++) {
    const x = (-stacks / 2 + i + 0.5) * 3.4;
    cyl(m, `smokestack-${i}`, 0.72, 1.05, 12 + v.layout * 1.2, [x, q.h + 5.8, -q.d * 0.22], 'concrete', lod);
    cyl(m, `stack-band-${i}`, 0.77, 0.77, 0.7, [x, q.h + 9 + v.layout * 1.2, -q.d * 0.22], 'paint-white', lod);
  }
  box(m, 'coal-conveyor', [q.w * 0.75, 0.65, 1.0], [v.side * q.w * 0.22, 5.0 + v.layout * 0.2, -q.d * 0.62], 'metal-dark', [0, 0, v.side * 0.28]);
  cyl(m, 'coal-pile', 2.6 + v.size * 0.25, 4.0 + v.size * 0.3, 3.2, [-v.side * q.w * 0.25, 1.75, -q.d * 0.7], 'soil', lod);
  sign(m, 'coal-sign', [5.2, 1.0], [0, q.h - 1.0, q.d / 2 + 0.2]);
}

function solarFarm(m, v, lod) {
  const cols = lod === 2 ? 3 : 4 + v.size, rows = lod === 2 ? 2 : 2 + v.layout;
  const w = cols * 2.6, d = rows * 3.0;
  siteVariation(m, v, w, d, lod, true);
  for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
    const x = (-cols / 2 + i + 0.5) * 2.6, z = (-rows / 2 + r + 0.5) * 3;
    box(m, `panel-${r}-${i}`, [2.2, 0.12, 1.6], [x, 1.12 + r * 0.08, z], 'glass-blue', [0.25 + v.layout * 0.045, v.side * 0.08, 0]);
    box(m, `panel-post-${r}-${i}`, [0.12, 1.0, 0.12], [x, 0.62, z], 'metal-galvanized');
  }
  box(m, 'inverter', [1.8 + v.size * 0.12, 1.6, 1.1], [v.side * w * 0.38, 0.95, d * 0.4], 'paint-white');
  sign(m, 'solar-sign', [3.5, 0.8], [0, 1.8, d / 2 + 0.25]);
}

function windService(m, v, lod) {
  const q = shed(m, v, lod, { w: 13, d: 9, h: 5, wall: 'paint-white' });
  const blades = lod === 2 ? 1 : 2 + v.size;
  for (let i = 0; i < blades; i++) {
    const x = -q.w * 0.35 + i * q.w * 0.7 / Math.max(1, blades - 1);
    box(m, `stored-blade-${i}`, [0.32, 0.55, 7 + v.layout], [x, 0.55, -q.d / 2 - 2.4], 'paint-white', [0, v.side * 0.08 * i, 0]);
  }
  cyl(m, 'demo-tower', 0.22, 0.55, 8 + v.size * 0.55, [v.side * q.w * 0.35, q.h + 3, 0], 'paint-white', lod);
  sphere(m, 'demo-hub', [0.42, 0.42, 0.55], [v.side * q.w * 0.35, q.h + 7 + v.size * 0.55, 0.45], 'metal-dark');
  const bladeCount = lod === 2 ? 2 : 3;
  for (let i = 0; i < bladeCount; i++) box(m, `demo-blade-${i}`, [0.16, 3.0 + v.layout * 0.2, 0.25], [v.side * q.w * 0.35 + Math.cos(i * TAU / bladeCount) * 1.35, q.h + 7 + v.size * 0.55 + Math.sin(i * TAU / bladeCount) * 1.35, 0.5], 'paint-white', [0, 0, -i * TAU / bladeCount]);
  sign(m, 'wind-sign', [4.3, 0.9], [0, q.h - 0.8, q.d / 2 + 0.18]);
}

function fiberHut(m, v, lod) {
  const w = (5 + v.size * 0.4) * v.scale, d = (4 + v.layout * 0.35) * v.scale;
  siteVariation(m, v, w, d, lod);
  const hutH = 3.1 + v.size * 0.08;
  box(m, 'fiber-hut', [w, hutH, d], [0, hutH / 2 + 0.12, 0], 'concrete');
  box(m, 'fiber-roof', [w + 0.25, 0.22, d + 0.25], [0, 3.32 + v.size * 0.08, 0], 'roof-metal');
  const cabinets = lod === 2 ? 1 : 2 + v.size;
  for (let i = 0; i < cabinets; i++) box(m, `fiber-cabinet-${i}`, [0.75, 1.45 + v.layout * 0.08, 0.45], [-w * 0.35 + i * w * 0.7 / Math.max(1, cabinets - 1), 0.92, d / 2 + 0.28], 'paint-teal');
  cyl(m, 'backup-vent', 0.38, 0.42, 1.1 + v.layout * 0.18, [v.side * w * 0.28, 3.9, 0], 'metal-galvanized', lod);
  if (lod < 2) for (let i = 0; i < 2 + v.layout; i++) torus(m, `fiber-loop-${i}`, 0.36 + i * 0.08, 0.045, [v.side * (w / 2 + 0.12), 0.8 + i * 0.4, 0], 'paint-orange', lod, [0, PI / 2, 0]);
  sign(m, 'fiber-sign', [2.7, 0.72], [0, 2.45, d / 2 + 0.18]);
}

function frankenpine(m, v, lod) {
  const h = 14 + v.size * 1.8 + v.layout * 0.8;
  siteVariation(m, v, 7, 7, lod);
  cyl(m, 'cell-trunk', 0.22, 0.55, h, [0, h / 2, 0], 'bark', lod);
  const whorls = lod === 2 ? 3 : 5 + v.size;
  for (let r = 0; r < whorls; r++) {
    const y = h * (0.48 + r * 0.46 / Math.max(1, whorls - 1));
    const arms = lod === 0 ? 5 : 3;
    for (let i = 0; i < arms; i++) {
      const a = i * TAU / arms + r * 0.35;
      box(m, `fake-branch-${r}-${i}`, [0.14, 0.14, 3.0 + v.layout * 0.16], [Math.sin(a) * 1.1, y, Math.cos(a) * 1.1], 'foliage', [0, a, (i % 2 ? 1 : -1) * 0.15]);
    }
  }
  const panels = lod === 2 ? 3 : 3 + v.layout;
  for (let i = 0; i < panels; i++) {
    const a = i * TAU / panels;
    box(m, `antenna-${i}`, [0.28, 1.35, 0.16], [Math.sin(a) * 0.75, h * 0.88, Math.cos(a) * 0.75], 'paint-white', [0, a, 0]);
  }
  box(m, 'cell-cabinet', [2.2 + v.size * 0.15, 1.8, 1.5], [v.side * 2.0, 1.0, 0], 'metal-galvanized');
  sign(m, 'pine-plaque', [2.5, 0.7], [0, 1.25, 1.2]);
}

function warehouse(m, v, lod) {
  const q = shed(m, v, lod, { w: 22, d: 14, h: 7, wall: 'stucco-ivory' });
  const offices = 2 + v.layout;
  box(m, 'abatement-office', [4 + v.size * 0.3, 3.8, 4.0], [v.side * (q.w / 2 + 1.8), 2.02, q.d * 0.2], 'brick-cream');
  if (lod < 2) for (let i = 0; i < offices; i++) box(m, `clerestory-${i}`, [1.6, 0.8, 0.12], [(-offices / 2 + i + 0.5) * 2.1, q.h - 1.2, q.d / 2 + 0.18], 'glass-blue');
  const vents = lod === 2 ? 1 : 2 + v.size;
  for (let i = 0; i < vents; i++) cyl(m, `roof-vent-${i}`, 0.35, 0.42, 0.85, [-q.w * 0.35 + i * q.w * 0.7 / Math.max(1, vents - 1), q.h + 0.8, 0], 'metal-galvanized', lod);
  sign(m, 'warehouse-sign', [6.3, 1.2], [0, q.h - 1.0, q.d / 2 + 0.2]);
}

function fulfillment(m, v, lod) {
  const q = shed(m, v, lod, { w: 28, d: 18, h: 8, wall: 'paint-blue' });
  const conveyors = lod === 2 ? 1 : 2 + v.layout;
  for (let i = 0; i < conveyors; i++) box(m, `conveyor-${i}`, [q.w * 0.34, 0.55, 1.1], [v.side * q.w * 0.36, 3.0 + i * 1.0, -q.d * 0.25 + i * 1.8], 'metal-dark', [0, v.side * 0.22, 0.08]);
  const hvac = lod === 2 ? 2 : 3 + v.size;
  for (let i = 0; i < hvac; i++) box(m, `roof-hvac-${i}`, [2.0, 1.2 + v.layout * 0.08, 1.7], [-q.w * 0.36 + i * q.w * 0.72 / Math.max(1, hvac - 1), q.h + 0.87, 0], 'metal-galvanized');
  sign(m, 'fulfillment-sign', [7.2, 1.35], [0, q.h - 1.2, q.d / 2 + 0.2]);
}

function selfStorage(m, v, lod) {
  const rows = lod === 2 ? 2 : 3 + v.layout, units = lod === 2 ? 3 : 4 + v.size;
  const w = units * 2.25, d = rows * 3.5;
  siteVariation(m, v, w, d, lod, true);
  for (let r = 0; r < rows; r++) {
    const z = (-rows / 2 + r + 0.5) * 3.5;
    const rowH = 2.8 + v.size * 0.08;
    box(m, `storage-row-${r}`, [w, rowH, 2.4], [0, rowH / 2 + 0.12, z], r % 2 ? 'metal-galvanized' : 'stucco-ivory');
    for (let i = 0; i < units; i++) box(m, `rollup-${r}-${i}`, [1.65, 2.15, 0.12], [(-units / 2 + i + 0.5) * 2.25, 1.28, z + v.side * 1.23], i % 3 === v.layout % 3 ? 'paint-orange' : 'paint-teal');
  }
  box(m, 'manager-box', [3.8, 3.4, 3.2], [v.side * (w / 2 + 1.6), 1.82, -d * 0.35], 'brick-cream');
  sign(m, 'storage-sign', [4.5, 1.0], [v.side * (w / 2 + 1.6), 3.0, -d * 0.35 + 1.65]);
}

function batchPlant(m, v, lod) {
  const w = (15 + v.size * 1.5) * v.scale, d = (11 + v.layout) * v.scale;
  siteVariation(m, v, w, d, lod, true);
  const silos = lod === 2 ? 2 : 2 + v.size;
  for (let i = 0; i < silos; i++) {
    const x = -w * 0.34 + i * w * 0.68 / Math.max(1, silos - 1);
    const siloH = 7 + v.layout * 0.45;
    cyl(m, `cement-silo-${i}`, 1.2, 1.2, siloH, [x, siloH / 2 + 0.12, -d * 0.2], 'metal-galvanized', lod);
    cyl(m, `silo-cone-${i}`, 0.3, 1.2, 1.4, [x, 8.3 + v.layout * 0.45, -d * 0.2], 'metal-galvanized', lod);
  }
  const towerH = 7 + v.size * 0.35;
  box(m, 'batch-tower', [3.7, towerH, 3.7], [v.side * w * 0.3, towerH / 2 + 0.12, d * 0.25], 'metal-dark');
  box(m, 'aggregate-conveyor', [w * 0.65, 0.6, 0.9], [0, 3.1 + v.layout * 0.2, d * 0.32], 'metal-dark', [0, 0, v.side * 0.18]);
  sign(m, 'batch-sign', [4.2, 0.9], [v.side * w * 0.3, 5.8, d * 0.25 + 1.9]);
}

function aggregateLoader(m, v, lod) {
  const w = (16 + v.size * 1.5) * v.scale, d = 12 + v.layout;
  siteVariation(m, v, w, d, lod, true);
  const hoppers = lod === 2 ? 2 : 3 + v.size;
  for (let i = 0; i < hoppers; i++) {
    const x = -w * 0.36 + i * w * 0.72 / Math.max(1, hoppers - 1);
    cyl(m, `hopper-${i}`, 0.42, 1.4, 2.4 + v.layout * 0.15, [x, 3.0, 0], 'metal-galvanized', lod);
    for (const dx of [-0.8, 0.8]) box(m, `hopper-leg-${i}-${dx}`, [0.16, 2.1, 0.16], [x + dx, 1.25, 0], 'metal-dark');
  }
  box(m, 'feed-conveyor', [w * 0.8, 0.55, 1.1], [v.side * w * 0.05, 5.2 + v.layout * 0.12, -d * 0.18], 'metal-dark', [0, 0, v.side * 0.2]);
  const piles = lod === 2 ? 1 : 2 + v.layout;
  for (let i = 0; i < piles; i++) cyl(m, `aggregate-pile-${i}`, 0.2, 2.2 + v.size * 0.12, 2.2, [(-piles / 2 + i + 0.5) * 4.4, 1.2, d * 0.35], i % 2 ? 'soil' : 'concrete', lod);
  sign(m, 'aggregate-sign', [4.6, 0.9], [0, 2.4, d / 2 + 0.2]);
}

function recycling(m, v, lod) {
  const q = shed(m, v, lod, { w: 17, d: 12, h: 6.2, wall: 'metal-galvanized' });
  const bunkers = lod === 2 ? 2 : 3 + v.size;
  for (let i = 0; i < bunkers; i++) {
    const x = -q.w * 0.38 + i * q.w * 0.76 / Math.max(1, bunkers - 1);
    const bunkerH = 1.8 + v.layout * 0.1;
    box(m, `sorting-bunker-${i}`, [2.1, bunkerH, 2.3], [x, bunkerH / 2 + 0.12, -q.d / 2 - 1.2], i % 2 ? 'paint-blue' : 'paint-yellow');
  }
  box(m, 'sorting-conveyor', [q.w * 0.78, 0.75, 1.3], [0, 3.0 + v.layout * 0.18, 0], 'metal-dark', [0, 0, v.side * 0.12]);
  const vents = lod === 2 ? 1 : 2 + v.layout;
  for (let i = 0; i < vents; i++) cyl(m, `cyclone-${i}`, 0.38, 0.78, 2.1, [v.side * q.w * 0.32, q.h + 1.25, -1.4 + i * 1.4], 'metal-galvanized', lod);
  sign(m, 'recycling-sign', [5.1, 1.0], [0, q.h - 0.9, q.d / 2 + 0.2]);
}

function constructionYard(m, v, lod) {
  const w = (16 + v.size * 1.6) * v.scale, d = (11 + v.layout) * v.scale;
  siteVariation(m, v, w, d, lod, true);
  box(m, 'site-office', [5.2, 3.0, 3.6], [v.side * w * 0.3, 1.62, -d * 0.3], 'paint-white');
  box(m, 'office-roof', [5.5, 0.2, 3.9], [v.side * w * 0.3, 3.2, -d * 0.3], 'roof-metal');
  const barriers = lod === 2 ? 2 : 3 + v.size;
  for (let i = 0; i < barriers; i++) box(m, `jersey-barrier-${i}`, [2.0, 0.8, 0.55], [-w * 0.36 + i * w * 0.72 / Math.max(1, barriers - 1), 0.52, d * 0.38], 'concrete', [0, v.side * v.layout * 0.06, 0]);
  const pipes = lod === 2 ? 1 : 2 + v.layout;
  for (let i = 0; i < pipes; i++) cyl(m, `stored-pipe-${i}`, 0.48, 0.48, 5 + v.size * 0.3, [-v.side * w * 0.25, 0.65 + i * 0.72, 0], 'metal-galvanized', lod, [0, 0, PI / 2]);
  const mastH = 7 + v.size * 0.5;
  cyl(m, 'crane-mast', 0.16, 0.28, mastH, [0, mastH / 2 + 0.12, -d * 0.1], 'paint-yellow', lod);
  box(m, 'crane-jib', [6 + v.layout, 0.25, 0.25], [v.side * 2.3, 7 + v.size * 0.5, -d * 0.1], 'paint-yellow');
  sign(m, 'yard-sign', [4.2, 0.9], [v.side * w * 0.3, 2.55, -d * 0.3 + 1.86]);
}

const defs = [
  ['permit-palace', 'Permit Palace', 'Approvals have three windows, four forms, and one lunch break.', 'A marble tribute to making small projects wait.', ['PERMIT PALACE', 'Approval pending'], ['civic', 'permits', 'bureaucracy'], permitPalace],
  ['dmv-queue-annex', 'DMV Queue Annex', 'Driver licensing annex with its own test lanes and numbered despair.', 'Mobility begins with taking a number.', ['DMV QUEUE', 'Now serving yesterday'], ['civic', 'dmv', 'office'], dmvAnnex],
  ['zoning-hearing-hall', 'Zoning Hearing Hall', 'Public hearing chamber engineered for long comments and short agendas.', 'Every housing shortage deserves another hearing.', ['ZONING HALL', 'Public comment: 90 sec'], ['civic', 'zoning', 'hearing'], zoningHall],
  ['tax-assessor-bunker', 'Tax Assessor Bunker', 'Window-light civic bunker guarding the county parcel records.', 'The valuation is final; the architecture is defensive.', ['ASSESSOR', 'Value discovered here'], ['civic', 'tax', 'records'], assessorBunker],
  ['public-works-yard', 'Public Works Yard', 'Salt, gravel, cones, trucks, and the county’s most useful shed.', 'Deferred maintenance has excellent storage.', ['PUBLIC WORKS', 'Cone inventory: robust'], ['civic', 'maintenance', 'yard'], publicWorks],
  ['volunteer-firehouse', 'Volunteer Firehouse', 'Engine bays and hose tower funded by pancake breakfast economics.', 'Essential service, optional budget.', ['VOLUNTEER FIRE', 'Fish fry funds hoses'], ['civic', 'fire', 'service'], firehouse],
  ['sheriff-substation', 'Sheriff Substation', 'A patrol office with fortified sally port and ambitious radio mast.', 'Local control arrives through a locked gate.', ['SHERIFF', 'Revenue patrol district'], ['civic', 'police', 'service'], sheriff],
  ['transit-token-kiosk', 'Transit Token Kiosk', 'Tiny fare office for the route the county almost remembers to run.', 'The kiosk is open more often than the bus.', ['COUNTY TRANSIT', 'Exact change, maybe'], ['transit', 'ticket', 'kiosk'], transitKiosk],
  ['one-bus-depot', 'One-Bus Depot', 'Oversized depot sheltering the county’s heroic hourly bus.', 'Transit capacity: one vehicle and a press release.', ['ONE BUS DEPOT', 'Hourly-ish service'], ['transit', 'bus', 'depot'], busDepot],
  ['tollbooth-plaza', 'Tollbooth Plaza', 'Lane-spanning collection canopy with booths, islands, and barriers.', 'A free road becomes self-supporting one quarter at a time.', ['VALUE TOLL', 'Freedom: exact change'], ['roads', 'toll', 'plaza'], tollPlaza],
  ['express-lane-gantry', 'Express Lane Gantry', 'Dynamic-price signs and enforcement cameras over premium pavement.', 'Congestion is a subscription opportunity.', ['EXPRESS VALUE', 'Rates may feel dynamic'], ['roads', 'gantry', 'pricing'], expressGantry],
  ['parking-minimums-garage', 'Parking Minimums Garage', 'Concrete decks built to satisfy the spreadsheet before the tenants arrive.', 'Every destination deserves a larger destination for empty cars.', ['MINIMUMS GARAGE', 'Spaces before places'], ['parking', 'garage', 'policy'], parkingGarage],
  ['surface-parking-empire', 'Surface Parking Empire', 'Striped asphalt, tall lights, and a distant building-shaped sign.', 'The highest and best use has been clearly striped.', ['PARKING EMPIRE', 'Black Friday compliant'], ['parking', 'asphalt', 'policy'], surfaceParking],
  ['bus-stop-nowhere', 'Bus Stop to Nowhere', 'A glass shelter and route pole marooned beside infrastructure.', 'Ridership begins with optimism and sturdy shoes.', ['ROUTE SOMEDAY', 'Hourly, sometimes'], ['transit', 'bus-stop', 'roadside'], busStop],
  ['pedestrian-overpass', 'Pedestrian Overpass', 'Caged concrete crossing with long stair towers over a wide road.', 'Walking is permitted after a modest vertical detour.', ['SAFE CROSSING', 'Only 84 extra steps'], ['roads', 'pedestrian', 'bridge'], pedestrianOverpass],
  ['retention-pond-office', 'Retention Pond Office', 'Berm, inlet pipes, blue water, and a control box beside Lake Serenity.', 'Stormwater detention gains waterfront branding.', ['LAKE SERENITY', 'No swimming or serenity'], ['water', 'stormwater', 'pond'], retentionPond],
  ['culvert-gateway', 'Culvert Gateway', 'Multi-barrel creek crossing held together by headwalls and confidence.', 'The creek has been streamlined for permitting convenience.', ['STREAMLINED CREEK', 'Nature, efficiently'], ['water', 'culvert', 'roads'], culvertGateway],
  ['water-tower', 'County Water Tower', 'Legged municipal tank with a proud county-name panel.', 'Civic identity is best stored under pressure.', ['PROSPERITY COUNTY', 'Pressure builds character'], ['water', 'tower', 'utility'], waterTower],
  ['pump-station', 'Artesian-ish Pump Station', 'Brick pump house with external pump banks and intake screen.', 'The aquifer is renewable on the election calendar.', ['COUNTY WATER', 'Naturally replenished-ish'], ['water', 'pump', 'utility'], pumpStation],
  ['wastewater-plant', 'Poop Palace Treatment', 'Circular clarifiers, sweep arms, and a compact control building.', 'Advanced treatment for yesterday’s growth projections.', ['POOP PALACE', 'Making downstream possible'], ['sewage', 'treatment', 'utility'], wastewater],
  ['sewage-outfall', 'Outfall Opportunity', 'Concrete headwall and large discharge pipes feeding a channel.', 'What leaves the county becomes regional cooperation.', ['OUTFALL 7', 'Dilution is partnership'], ['sewage', 'outfall', 'utility'], sewageOutfall],
  ['grid-substation', 'Independent Grid Substation', 'Transformer rows, copper busbars, and tall switching frames.', 'Independence arrives through several imported transformers.', ['FREEDOM GRID', 'Weather permitting'], ['power', 'substation', 'utility'], substation],
  ['gas-peaker-plant', 'Last-Minute Gas Peaker', 'Compact turbine hall with exhaust stacks for urgent megawatts.', 'Planning reserve delivered at emergency prices.', ['PEAK NOW', 'Fast power, faster bill'], ['power', 'gas', 'industrial'], peakerPlant],
  ['clean-coal-plant', 'Very Clean Coal Plant', 'Brick turbine hall, banded stacks, conveyor, and coal pile.', 'The adjective has completed environmental review.', ['VERY CLEAN COAL', 'Clean in the title'], ['power', 'coal', 'industrial'], coalPlant],
  ['solar-farm', 'Freedom Solar Farm', 'Rows of tilted panels with posts and a site inverter.', 'Energy independence, subject to the sun’s operating hours.', ['FREEDOM SOLAR', 'Day shift only'], ['power', 'solar', 'utility'], solarFarm],
  ['wind-service-yard', 'Breeze Compliance Yard', 'Service shed, stored blades, and a small demonstration turbine.', 'Renewable energy with a generous setback from donors.', ['BREEZE YARD', 'Viewshed paperwork inside'], ['power', 'wind', 'industrial'], windService],
  ['fiber-hut', 'Broadband Promise Hut', 'Concrete network hut ringed by cabinets, vents, and coiled fiber.', 'Gigabit ribbon-cutting; dial-up construction schedule.', ['BROADBAND SOON', 'Loading prosperity…'], ['telecom', 'fiber', 'utility'], fiberHut],
  ['frankenpine-cell-tower', 'Frankenpine Cell Tower', 'A cellular mast wearing increasingly unconvincing fake branches.', 'Preserving the viewshed one plastic needle at a time.', ['NATURAL SIGNAL', 'Five bars, one trunk'], ['telecom', 'cell-tower', 'utility'], frankenpine],
  ['abatement-warehouse', 'Abatement Warehouse', 'Tax-assisted logistics shed with docks, office pod, and rooftop vents.', 'Public investment now accepting private loading appointments.', ['SHOVEL READY', 'Taxes temporarily optional'], ['warehouse', 'abatement', 'industrial'], warehouse],
  ['fulfillment-center', 'Fulfillmore Center', 'Enormous blue distribution box with docks, conveyors, and rooftop HVAC.', 'Two-day delivery, twenty-year road subsidy.', ['FULFILLMORE', 'Your package, our interchange'], ['warehouse', 'logistics', 'industrial'], fulfillment],
  ['self-storage-complex', 'Future Downtown Storage', 'Repeating roll-up rows with a lonely manager office.', 'Land banking with individual locks.', ['FUTURE DOWNTOWN', 'Store today, plan later'], ['storage', 'warehouse', 'industrial'], selfStorage],
  ['concrete-batch-plant', 'Progress Batch Plant', 'Cement silos, batch tower, and aggregate conveyor.', 'Every new lane begins as dust near somebody else.', ['PROGRESS CONCRETE', 'Another lane starts here'], ['concrete', 'construction', 'industrial'], batchPlant],
  ['aggregate-loader', 'Shovel-Ready Aggregate', 'Hopper line, feeder conveyor, and graded material piles.', 'The landscape has entered the value chain.', ['SHOVEL READY', 'Mountains, now sortable'], ['aggregate', 'quarry', 'industrial'], aggregateLoader],
  ['recycling-transfer-station', 'Wishcycling Transfer Station', 'Sorting shed with bright bunkers, conveyor, and cyclone separators.', 'Place hopeful objects in the correct colorful bunker.', ['WISHCYCLING', 'Hope sorted daily'], ['waste', 'recycling', 'industrial'], recycling],
  ['road-construction-yard', 'One More Lane Yard', 'Portable office, barriers, pipe stacks, and a compact crane.', 'The permanent solution begins in a temporary trailer.', ['ONE MORE LANE', 'Congestion cure loading'], ['roads', 'construction', 'industrial'], constructionYard],
];

export const families = defs.map(([id, label, description, satire, signLines, tags, build]) => ({
  id,
  label,
  category: 'infrastructure',
  description,
  satire,
  signLines,
  tags,
  create(variant, lod) {
    const m = new Model(lod);
    build(m, variation(variant), lod);
    return m.group;
  },
}));
