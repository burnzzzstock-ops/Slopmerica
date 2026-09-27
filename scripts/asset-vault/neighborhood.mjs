import { Model, THREE, variation } from './kit.mjs';

const PI = Math.PI;
const rotY = (n) => [0, n, 0];

function plan(variant) {
  const c = variation(variant);
  return { ...c, variant, wide: 0.88 + c.size * 0.08 };
}

function slab(m, c, w, d, x = 0, z = 0) {
  m.box('surveyed lot', [w * c.wide, 0.12, d * c.wide], [x, 0.06, z], 'concrete', { bevel: 0.04 });
}

function gable(m, name, w, eaveY, z, mat, direction = 1, depth = 2.9, infillMat = null) {
  const pitch = 0.46;
  const halfRun = w / 2;
  const rise = halfRun * Math.tan(pitch);
  const rafter = halfRun / Math.cos(pitch);
  const centerY = eaveY + rise / 2;
  // Mirroring swaps the named halves only. It never changes the two opposing
  // pitches: both roof planes always rise from their eave to the shared ridge.
  const leftName = direction < 0 ? 'right' : 'left';
  const rightName = direction < 0 ? 'left' : 'right';
  m.box(`${name} ${leftName}`, [rafter, 0.16, depth], [-w / 4, centerY, z], mat, { bevel: 0.04, rotation: [0, 0, pitch] });
  m.box(`${name} ${rightName}`, [rafter, 0.16, depth], [w / 4, centerY, z], mat, { bevel: 0.04, rotation: [0, 0, -pitch] });
  if (infillMat) {
    const hz = depth / 2 - 0.015;
    const positions = new Float32Array([
      -halfRun, 0, hz, halfRun, 0, hz, 0, rise, hz,
      -halfRun, 0, -hz, 0, rise, -hz, halfRun, 0, -hz,
    ]);
    const normals = new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1,
    ]);
    const uvs = new Float32Array([
      0, 0, w, 0, halfRun, rise,
      0, 0, halfRun, rise, w, 0,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.userData.metreUV = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    m.mesh(`${name} end infill`, geometry, [0, eaveY, z], infillMat);
  }
}

function windowRow(m, count, y, z, spread, mat = 'glass-blue') {
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * spread;
    m.box(`window ${y} ${i}`, [0.7, 0.75, 0.09], [x, y, z], mat, { bevel: 0.05 });
  }
}

function posts(m, count, x0, z0, dx, dz, h, mat = 'wood-painted') {
  for (let i = 0; i < count; i++) m.box(`post ${x0} ${i}`, [0.16, h, 0.16], [x0 + dx * i, h / 2, z0 + dz * i], mat, { bevel: 0.025 });
}

function tree(m, name, x, z, h, sparse = false) {
  const trunk = h * 0.48;
  m.cylinder(`${name} trunk`, 0.13, 0.2, trunk, [x, trunk / 2, z], 'bark', { segments: 7 });
  if (sparse) {
    m.pipe(`${name} branch a`, [[x, trunk * 0.65, z], [x - h * 0.2, trunk + h * 0.14, z]], 0.055, 'bark');
    m.pipe(`${name} branch b`, [[x, trunk * 0.72, z], [x + h * 0.17, trunk + h * 0.23, z + h * 0.08]], 0.05, 'bark');
  }
  m.sphere(`${name} crown a`, [h * 0.28, h * 0.3, h * 0.24], [x - h * 0.1, trunk + h * 0.18, z], 'foliage');
  m.sphere(`${name} crown b`, [h * 0.24, h * 0.25, h * 0.22], [x + h * 0.14, trunk + h * 0.25, z + h * 0.05], 'foliage');
}

function car(m, name, x, z, angle = 0, wreck = false) {
  const y = wreck ? 0.45 : 0.35;
  m.box(`${name} body`, [1.8, 0.45, 3.6], [x, y, z], wreck ? 'metal-copper' : 'paint-red', { bevel: 0.14, rotation: rotY(angle) });
  m.box(`${name} cab`, [1.45, 0.55, 1.65], [x, y + 0.45, z - 0.15], 'glass-blue', { bevel: 0.18, rotation: rotY(angle) });
}

function bench(m, name, x, z, hostile = false, angle = 0) {
  m.box(`${name} seat`, [2.4, 0.16, 0.55], [x, 0.62, z], 'wood-oak', { bevel: 0.06, rotation: rotY(angle) });
  m.box(`${name} back`, [2.4, 0.75, 0.13], [x, 1.02, z - 0.25], 'wood-oak', { bevel: 0.04, rotation: rotY(angle) });
  posts(m, 2, x - 0.85, z, 1.7, 0, 0.62, 'metal-dark');
  if (hostile) for (const i of [-1, 1]) m.torus(`${name} divider ${i}`, 0.27, 0.045, [x + i * 0.55, 0.84, z], 'metal-dark', { rotation: [PI / 2, 0, 0], arc: PI });
}

function trailerShell(m, c, doubleWide = false) {
  const w = (doubleWide ? 7.6 : 4.2) * c.wide;
  const d = (doubleWide ? 10.5 : 11.8) * c.wide;
  slab(m, c, w + 1.5, d + 1.7);
  m.box('vinyl trailer', [w, 2.75, d], [0, 1.55, 0], 'paint-white', { bevel: 0.1 });
  m.box('shallow roof', [w + 0.3, 0.28, d + 0.35], [0, 3.04, 0], 'roof-metal', { bevel: 0.08, rotation: [0, 0, c.side * 0.035] });
  m.box('front door', [0.95, 2.05, 0.12], [c.side * w * 0.25, 1.25, d / 2 + 0.07], 'paint-teal', { bevel: 0.04 });
  windowRow(m, Math.min(c.bays, 5), 1.8, d / 2 + 0.075, w / Math.max(c.bays, 3));
  if (m.lod < 2) {
    posts(m, 3 + c.layout, -w / 2 + 0.3, d / 2 + 1, w / (2 + c.layout), 0, 1.35, 'wood-painted');
    m.box('front steps', [1.7, 0.32 + c.size * 0.06, 1.05], [c.side * w * 0.25, 0.16 + c.size * 0.03, d / 2 + 0.7], 'wood-oak', { bevel: 0.04 });
    if (c.state) m.box('blue tarp', [w * 0.46, 0.08, d * 0.38], [-c.side * w * 0.18, 3.23, -d * 0.12], 'paint-blue', { rotation: [0, 0, -c.side * 0.08] });
  }
}

function singleWide(variant, lod) {
  const m = new Model(lod), c = plan(variant); trailerShell(m, c, false);
  if (lod < 2) {
    m.cylinder('satellite dish', 0.62, 0.12, 0.16, [-c.side * 1.15, 3.45, -2.4], 'metal-galvanized', { segments: 12, rotation: [PI / 3, 0, 0] });
    if (c.layout > 1) m.box('lean-to awning', [3.2, 0.14, 2.2 + c.size * 0.2], [-2.7, 2.2, 1.2], 'roof-metal', { rotation: [0, 0, -0.08] });
  }
  return m.group;
}

function doubleWide(variant, lod) {
  const m = new Model(lod), c = plan(variant); trailerShell(m, c, true);
  m.box('marriage seam', [0.08, 2.4, 10 * c.wide], [0, 1.55, 0], 'metal-galvanized');
  if (lod < 2) {
    m.box('screen porch floor', [4.8, 0.18, 2.5], [c.side * 1.2, 0.45, 6.2], 'wood-oak');
    posts(m, 4, c.side * -0.8, 6.2, c.side * 1.3, 0, 2.35, 'wood-painted');
    if (c.state) m.box('skirting gap', [1.5 + c.size * 0.2, 0.55, 0.08], [-c.side * 2.2, 0.35, 5.3], 'metal-dark');
  }
  return m.group;
}

function whisperingPines(variant, lod) {
  const m = new Model(lod), c = plan(variant), rows = lod === 2 ? 2 : 2 + c.layout % 2, units = lod === 0 ? 3 + c.size : 3;
  slab(m, c, 20 + c.size * 2, 18 + c.layout * 2);
  for (let r = 0; r < rows; r++) for (let i = 0; i < units; i++) {
    const x = (i - (units - 1) / 2) * 3.15;
    const z = (r - (rows - 1) / 2) * 6.3;
    m.box(`home ${r}-${i}`, [2.5, 1.75, 5], [x, 1, z], r % 2 ? 'paint-teal' : 'paint-white', { bevel: 0.07 });
    m.box(`roof ${r}-${i}`, [2.7, 0.18, 5.2], [x, 1.95, z], 'roof-metal', { rotation: [0, 0, (i % 2 ? 1 : -1) * 0.035] });
  }
  m.box('entry beam', [8.5 + c.size, 0.45, 0.45], [0, 4.1, 10], 'wood-painted', { bevel: 0.08 });
  posts(m, 2, -4, 10, 8, 0, 4, 'wood-painted');
  m.sign('whispering pines sign', [5.5, 1.4], [0, 3.15, 10.28], {});
  m.box('community leasing cottage', [3.2 + c.layout * 0.55, 2.15, 3 + c.layout * 0.3], [c.side * (6.4 + c.layout * 0.35), 1.2, -6 + c.layout * 0.55], 'brick-cream', { bevel: 0.1 });
  m.box('leasing cottage roof', [3.6 + c.layout * 0.55, 0.24, 3.4 + c.layout * 0.3], [c.side * (6.4 + c.layout * 0.35), 2.4, -6 + c.layout * 0.55], 'roof-shingle', { bevel: 0.08 });
  if (lod < 2 && !c.state) tree(m, 'the one included pine', c.side * 7, 7, 4.5, true);
  if (lod < 2 && c.state) m.box('vacant pad', [4.5, 0.08, 6], [c.side * 6.5, 0.14, -5], 'asphalt');
  return m.group;
}

function hollerCabin(variant, lod) {
  const m = new Model(lod), c = plan(variant), w = 6.2 * c.wide, d = 6.8 * c.wide;
  slab(m, c, 16, 13);
  m.box('log cabin', [w, 2.8, d], [0, 1.55, 0], 'wood-oak', { bevel: 0.1 });
  gable(m, 'rusted gable', w + 0.55, 3, 0, 'roof-metal', c.side, d + 0.6, 'wood-oak');
  m.box('porch', [w + 1, 0.18, 2.3], [0, 0.48, d / 2 + 0.9], 'wood-oak');
  posts(m, 3 + c.layout, -w / 2, d / 2 + 1, w / (2 + c.layout), 0, 2.8, 'wood-oak');
  if (lod < 2) {
    const junk = 1 + c.size + (c.state ? 2 : 0);
    for (let i = 0; i < junk; i++) car(m, `junk car ${i}`, -6 + i * 2.8, -4.8 + (i % 2) * 2.2, i * 0.23, true);
    m.torus('trampoline rim', 1.7 + c.size * 0.1, 0.08, [5.3 * c.side, 0.8, 3], 'metal-dark', { rotation: [PI / 2, 0, 0] });
    m.cylinder('burn barrel', 0.42, 0.42, 0.9, [-5 * c.side, 0.5, 3.8], 'metal-copper', { segments: 10 });
  }
  return m.group;
}

function tractHouse(variant, lod, style) {
  const m = new Model(lod), c = plan(variant), cfg = [
    { w: 8.2, d: 7.2, h: 2.8, wing: 3.0, mat: 'brick-cream' },
    { w: 7.2, d: 8.7, h: 3.5, wing: 4.1, mat: 'stucco-ivory' },
    { w: 9.4, d: 6.8, h: 5.4, wing: 2.7, mat: 'brick-red' },
  ][style];
  const w = cfg.w * c.wide, d = cfg.d * c.wide;
  slab(m, c, w + 5.4, d + 6.5);
  m.box('main house', [w, cfg.h, d], [0, cfg.h / 2 + 0.18, 0], cfg.mat, { bevel: 0.1 });
  if (style === 0) {
    gable(m, 'broad ranch roof', w + 0.6, 3, 0, 'roof-shingle', 1, d + 0.5, 'brick-cream');
    m.box('garage snout', [cfg.wing + c.size * 0.25, 2.6, 3.5 + c.layout], [c.side * (w / 2 - 1.2), 1.48, d / 2 + 1.5], 'brick-cream', { bevel: 0.08 });
  } else if (style === 1) {
    m.box('hip roof slab', [w + 0.7, 0.55, d + 0.7], [0, cfg.h + 0.42, 0], 'roof-shingle', { bevel: 0.2, rotation: [0, 0, c.side * 0.035] });
    m.cylinder('entry column left', 0.18, 0.22, 3.1, [-1.25, 1.72, d / 2 + 0.8], 'limestone', { segments: 10 });
    m.cylinder('entry column right', 0.18, 0.22, 3.1, [1.25, 1.72, d / 2 + 0.8], 'limestone', { segments: 10 });
    m.box('sunroom upgrade', [2.6 + c.layout * 0.48, 2.35, 3 + c.layout * 0.32], [c.side * (w / 2 + 1.05 + c.layout * 0.18), 1.35, -1 + c.layout * 0.42], 'glass-blue', { bevel: 0.12 });
    m.box('sunroom cap', [3 + c.layout * 0.48, 0.22, 3.4 + c.layout * 0.32], [c.side * (w / 2 + 1.05 + c.layout * 0.18), 2.65, -1 + c.layout * 0.42], 'roof-metal', { bevel: 0.08 });
  } else {
    gable(m, 'two story roof', w + 0.5, 5.6, 0, 'roof-shingle', -c.side, d + 0.5, 'brick-red');
    m.box('bay window', [2.4 + c.size * 0.2, 2.6, 1.0], [-c.side * 2.2, 1.6, d / 2 + 0.5], 'stucco-ivory', { bevel: 0.12 });
    if (lod < 2) windowRow(m, 3 + c.layout, 4.2, d / 2 + 0.08, 1.7);
  }
  m.box('garage door', [cfg.wing, 2.05, 0.12], [c.side * (w / 2 - 1.4), 1.3, d / 2 + (style === 0 ? 3.28 : 0.08)], 'wood-painted', { bevel: 0.05 });
  if (lod < 2) {
    windowRow(m, 2 + c.size % 3, 1.8, d / 2 + 0.08, 1.35);
    if (c.state) m.box('hoa violation grass', [w + 4, 0.38 + c.layout * 0.08, 2.5], [0, 0.19 + c.layout * 0.04, d / 2 + 3.4], 'foliage', { bevel: 0.1 });
  }
  return m.group;
}

const ashford = (v, l) => tractHouse(v, l, 0);
const beaumont = (v, l) => tractHouse(v, l, 1);
const carrington = (v, l) => tractHouse(v, l, 2);

function mcmansion(variant, lod) {
  const m = new Model(lod), c = plan(variant), w = 10 + c.size;
  slab(m, c, 17, 16);
  m.box('oversized core', [w, 6.4, 8.2], [0, 3.3, -0.5], 'brick-cream', { bevel: 0.12 });
  m.box('front-only stone veneer', [w + 0.12, 2.3, 0.16], [0, 1.25, 3.68], 'limestone', { bevel: 0.04 });
  const garageW = 5.4 + c.size * 0.45;
  m.box('three car garage snout', [garageW, 3.2, 5.1 + c.layout], [c.side * 3.4, 1.72, 5.1], 'stucco-ivory', { bevel: 0.1 });
  m.box('garage doors', [garageW - 0.5, 2.35, 0.12], [c.side * 3.4, 1.45, 7.7 + c.layout / 2], 'wood-painted', { bevel: 0.06 });
  m.cylinder('one turret', 1.55 + c.size * 0.08, 1.75, 7.4, [-c.side * 4.25, 3.8, 3], 'stucco-ivory', { segments: lod === 2 ? 8 : 14 });
  m.cylinder('turret hat', 0.08, 2.05, 2.1, [-c.side * 4.25, 8.55, 3], 'roof-shingle', { segments: lod === 2 ? 8 : 14 });
  const roofs = lod === 0 ? 7 : lod === 1 ? 4 : 2;
  for (let i = 0; i < roofs; i++) gable(m, `roofline ${i + 1}`, 3.2 + (i % 3) + c.size * 0.08, 6.5 + (i % 2) * 0.18, -2.6 + i * 0.85, 'roof-shingle', i % 2 ? 1 : -1);
  if (lod < 2) windowRow(m, 4 + c.layout, 4.6, 3.68, 1.55);
  if (c.state) m.box('foreclosure plywood', [1.1, 1.2, 0.1], [0.8 * c.side, 1.8, 3.8], 'wood-oak');
  return m.group;
}

function farmhouse(variant, lod) {
  const m = new Model(lod), c = plan(variant), w = 8.5 + c.size * 0.8, d = 8 + c.layout * 0.5;
  slab(m, c, 15, 14);
  m.box('white board and batten', [w, 5.6, d], [0, 2.9, 0], 'paint-white', { bevel: 0.08 });
  gable(m, 'black metal gable', w + 0.6, 5.72, 0, 'metal-dark', c.side, d + 0.5, 'paint-white');
  m.box('wrap porch', [w + 2.2, 0.2, 2.4], [0, 0.45, d / 2 + 0.9], 'wood-painted');
  posts(m, 4 + c.layout, -w / 2, d / 2 + 1, w / (3 + c.layout), 0, 3.15, 'wood-painted');
  if (lod < 2) {
    windowRow(m, 3 + c.size % 2, 3.7, d / 2 + 0.08, 1.7, 'metal-dark');
    m.sign('gather sign', [2.7, 0.8], [0, 2.1, d / 2 + 0.12], {});
  }
  if (c.state) m.box('package mountain', [1.1 + c.size * 0.15, 0.9, 0.9], [c.side * 2.4, 0.95, d / 2 + 1.5], 'brick-cream');
  return m.group;
}

function barndominium(variant, lod) {
  const m = new Model(lod), c = plan(variant), w = 10 + c.size, d = 12 + c.layout;
  slab(m, c, w + 5, d + 4);
  m.box('metal barn home', [w, 4.8, d], [0, 2.5, 0], 'metal-galvanized', { bevel: 0.08 });
  gable(m, 'barn roof', w + 0.8, 4.92, 0, 'roof-metal', c.side, d + 0.5, 'metal-galvanized');
  m.box('airplane hangar door', [w * 0.55, 3.55, 0.15], [0, 2, d / 2 + 0.08], 'metal-dark', { bevel: 0.06 });
  m.box('tiny human door', [0.9, 2.15, 0.18], [c.side * w * 0.4, 1.3, d / 2 + 0.1], 'paint-red');
  if (lod < 2) {
    const win = 2 + c.size;
    for (let i = 0; i < win; i++) m.box(`domestic window ${i}`, [0.65, 0.75, 0.1], [-w / 2 + 1 + i * 1.2, 3.6, d / 2 + 0.11], 'glass-blue');
    m.cylinder('decorative grain bin', 2 + c.size * 0.12, 2, 4.1, [-c.side * (w / 2 + 2.8), 2.1, -2], 'metal-galvanized', { segments: 12 });
  }
  if (c.state) m.box('unfinished addition', [3.5, 2.8, 5], [c.side * (w / 2 + 1.7), 1.5, 1.8], 'wood-oak');
  return m.group;
}

function gatedGolf(variant, lod) {
  const m = new Model(lod), c = plan(variant), gap = 4.5 + c.size * 0.4;
  slab(m, c, 22, 9);
  m.box('left stone monument', [4.5 + c.layout, 4.4, 2.4], [-gap, 2.25, 0], 'limestone', { bevel: 0.18 });
  m.box('right stone monument', [4.5 + c.layout, 4.4, 2.4], [gap, 2.25, 0], 'limestone', { bevel: 0.18 });
  m.box('estate arch', [gap * 2, 0.8, 1.2], [0, 6.1 + c.size * 0.15, 0], 'limestone', { bevel: 0.22 });
  m.box('left wrought gate', [gap - 0.4, 2.5, 0.18], [-gap / 2, 1.45, 0], 'metal-dark', { rotation: rotY(c.state ? 0.75 : 0) });
  m.box('right wrought gate', [gap - 0.4, 2.5, 0.18], [gap / 2, 1.45, 0], 'metal-dark', { rotation: rotY(c.state ? -0.75 : 0) });
  m.sign('golf estate crest', [6, 1.5], [0, 6.08, 0.65], {});
  if (lod < 2) {
    for (let i = 0; i < 3 + c.layout; i++) m.sphere(`topiary ${i}`, [0.65, 0.85 + i * 0.04, 0.65], [-8 + i * 3.2, 0.85 + i * 0.04, 2.5], 'foliage');
    m.box('guard hut', [2.5, 2.8, 2.4], [c.side * 1.8, 1.48, -2.3], 'stucco-ivory', { bevel: 0.1 });
  }
  return m.group;
}

function blackrackRentals(variant, lod) {
  const m = new Model(lod), c = plan(variant), units = lod === 2 ? 3 : 4 + c.size;
  slab(m, c, 21 + c.size, 18 + c.layout);
  for (let i = 0; i < units; i++) {
    const row = c.layout % 2 && i >= Math.ceil(units / 2) ? 1 : 0;
    const col = row ? i - Math.ceil(units / 2) : i;
    const x = (col - (units - 1) / 2) * 4.2;
    const z = row ? -5.5 : 1;
    m.box(`rental shell ${i}`, [3.6, 3.2, 5.4], [x, 1.7, z], 'stucco-ivory', { bevel: 0.08 });
    gable(m, `rental roof ${i}`, 3.9, 3.32, z, 'roof-shingle', i % 2 ? 1 : -1, 5.7, 'stucco-ivory');
  }
  m.box('leasing wall', [7.6, 3.4, 2], [0, 1.8, 7.2], 'paint-teal', { bevel: 0.12 });
  m.sign('blackrack sign', [5.8, 1.5], [0, 2.2, 8.23], {});
  if (lod < 2) for (let i = 0; i < 4 + c.layout; i++) m.box(`identical bin ${i}`, [0.65, 0.85, 0.65], [-7 + i * 2.2, 0.5, 4.5], 'metal-dark', { bevel: 0.08 });
  if (c.state) m.box('rent increase banner', [6.6 + c.size * 0.2, 0.9, 0.08], [0, 3.05, 8.25], 'paint-red');
  return m.group;
}

function golfCartVillage(variant, lod) {
  const m = new Model(lod), c = plan(variant), homes = lod === 2 ? 3 : 4 + c.size;
  slab(m, c, 20, 16 + c.layout);
  for (let i = 0; i < homes; i++) {
    const a = (i / homes) * PI * (c.layout > 1 ? 1.5 : 1);
    const x = Math.cos(a) * 7, z = Math.sin(a) * 5 - 1;
    m.box(`villa ${i}`, [3.4, 2.3, 4], [x, 1.25, z], 'stucco-ivory', { bevel: 0.12, rotation: rotY(-a) });
    m.box(`pastel roof ${i}`, [3.7, 0.35, 4.3], [x, 2.55, z], i % 2 ? 'paint-teal' : 'roof-shingle', { bevel: 0.15, rotation: rotY(-a) });
  }
  if (lod < 2) for (let i = 0; i < 2 + c.layout; i++) {
    const x = -3 + i * 3;
    m.box(`golf cart ${i}`, [1.3, 0.6, 2], [x, 0.45, 5.4], 'paint-white', { bevel: 0.14 });
    posts(m, 2, x - 0.48, 5.4, 0.96, 0, 1.25, 'metal-dark');
    m.box(`cart roof ${i}`, [1.45, 0.12, 2.1], [x, 1.35, 5.4], 'paint-teal', { bevel: 0.05 });
  }
  m.sign('active adult sign', [4.8, 1.2], [0, 1.7, 7.4], {});
  if (c.state) m.box('ambulance access cone', [0.45, 0.8 + c.size * 0.07, 0.45], [c.side * 5, 0.4 + c.size * 0.035, 5.8], 'paint-orange', { bevel: 0.08 });
  return m.group;
}

function ranchette(variant, lod) {
  const m = new Model(lod), c = plan(variant);
  slab(m, c, 20 + c.size * 2, 18 + c.layout * 2, 0, 0);
  m.box('five acre ranch house', [7 + c.size * 0.5, 2.8, 6.2], [-4 * c.side, 1.55, -3], 'brick-red', { bevel: 0.1 });
  gable(m, 'ranch roof', 7.7 + c.size * 0.5, 2.97, -3, 'roof-metal', c.side, 6.8, 'brick-red');
  const rails = lod === 2 ? 2 : 3 + c.layout;
  for (let r = 0; r < rails; r++) m.box(`white fence rail ${r}`, [18 + c.size, 0.11, 0.11], [0, 0.55 + r * 0.42, 5.8], 'paint-white');
  posts(m, 6 + (lod === 0 ? c.size : 0), -9, 5.8, 18 / (5 + (lod === 0 ? c.size : 0)), 0, 1.8, 'paint-white');
  if (lod < 2) {
    m.box('one horse body', [1.1, 1.1, 2.2], [4 * c.side, 1.2, -1], 'bark', { bevel: 0.2 });
    m.cylinder('one horse neck', 0.28, 0.4, 1.25, [4 * c.side, 2, 0.7], 'bark', { segments: 7, rotation: [PI / 5, 0, 0] });
    m.box('riding mower', [1.3, 0.65, 1.8], [c.side * 1.8, 0.5, 3.2], c.state ? 'metal-copper' : 'paint-yellow', { bevel: 0.12 });
  }
  if (c.state) {
    m.box('abandoned stable', [3.8 + c.layout * 0.45, 2.5 + c.size * 0.14, 4.3], [-c.side * 6, 1.25 + c.size * 0.07, -5], 'wood-oak', { bevel: 0.06, rotation: [0, 0, c.side * 0.07] });
    m.box('stable roof', [4.3 + c.layout * 0.45, 0.2, 4.8], [-c.side * 6, 2.62 + c.size * 0.14, -5], 'roof-metal', { rotation: [0, 0, c.side * 0.12] });
  } else {
    m.box('working hay shelter', [2.8 + c.layout * 0.35, 2.1 + c.size * 0.12, 3.6], [-c.side * 6, 1.05 + c.size * 0.06, -5], 'wood-painted', { bevel: 0.06 });
    m.box('hay shelter roof', [3.4 + c.layout * 0.35, 0.18, 4.2], [-c.side * 6, 2.18 + c.size * 0.12, -5], 'roof-metal', { rotation: [0, 0, -c.side * 0.04] });
  }
  return m.group;
}

function prepperCompound(variant, lod) {
  const m = new Model(lod), c = plan(variant), r = 7 + c.size * 0.55;
  slab(m, c, 20, 19 + c.layout);
  m.box('reinforced cabin', [7.2, 3.4, 6.8], [0, 1.85, 0], 'concrete', { bevel: 0.08 });
  m.box('blast roof', [8, 0.55, 7.6], [0, 3.75, 0], 'metal-dark', { bevel: 0.12 });
  const fenceN = lod === 2 ? 8 : 12 + c.layout * 2;
  for (let i = 0; i < fenceN; i++) {
    const a = (i / fenceN) * PI * 2;
    m.box(`palisade ${i}`, [0.22, 3.1 + (i % 3) * 0.15, 0.22], [Math.cos(a) * r, 1.55 + (i % 3) * 0.075, Math.sin(a) * r], 'metal-galvanized', { rotation: rotY(-a) });
  }
  if (lod < 2) {
    m.cylinder('buried bunker hatch', 1.05, 1.05, 0.35, [c.side * 4.3, 0.25, -3.5], 'metal-dark', { segments: 12 });
    for (let i = 0; i < 2 + c.size; i++) m.box(`water tote ${i}`, [1.2, 1.2, 1.2], [-3 + i * 1.4, 0.7, 3.9], 'glass-blue', { bevel: 0.08 });
  }
  if (c.state) m.pipe('very busy antenna', [[0, 4, 0], [0, 7.5 + c.layout, 0], [c.side * 2.2, 8.2 + c.layout, 0]], 0.09, 'metal-dark');
  return m.group;
}

function retentionPond(variant, lod) {
  const m = new Model(lod), c = plan(variant), rx = 7 + c.size * 0.8, rz = 4.5 + c.layout * 0.7;
  slab(m, c, rx * 2 + 5, rz * 2 + 5);
  m.sphere('detention basin', [rx, 0.32 + c.size * 0.025, rz], [0, 0.32 + c.size * 0.025, 0], c.state ? 'soil' : 'glass-blue');
  m.torus('concrete lip', (rx + rz) / 2, 0.25, [0, 0.3, 0], 'concrete', { rotation: [PI / 2, 0, 0] });
  m.box('lakefront billboard posts', [0.2, 2.8, 0.2], [-2.2, 1.45, rz + 1.8], 'wood-oak');
  m.box('lakefront billboard posts 2', [0.2, 2.8, 0.2], [2.2, 1.45, rz + 1.8], 'wood-oak');
  m.sign('lake serenity advertisement', [6.3, 2.2], [0, 2.85, rz + 1.8], {});
  if (lod < 2) {
    const pipesN = 1 + c.layout;
    for (let i = 0; i < pipesN; i++) m.cylinder(`storm drain ${i}`, 0.42, 0.42, 1.1 + c.size * 0.1, [-rx + 1 + i * 1.1, 0.45, 0], 'concrete', { segments: 10, rotation: [PI / 2, 0, 0] });
    if (c.state) for (let i = 0; i < 3 + c.size; i++) m.sphere(`algae ${i}`, [0.7 + i * 0.08, 0.08, 0.45], [-2.5 + i * 1.1, 0.43, -0.8 + (i % 2)], 'foliage');
  }
  return m.group;
}

function hoaGate(variant, lod) {
  const m = new Model(lod), c = plan(variant), span = 11 + c.size;
  slab(m, c, span + 7, 8);
  m.box('left faux stone pier', [2.4 + c.layout * 0.25, 4.4, 2.4], [-span / 2, 2.25, 0], 'limestone', { bevel: 0.16 });
  m.box('right faux stone pier', [2.4 + c.layout * 0.25, 4.4, 2.4], [span / 2, 2.25, 0], 'limestone', { bevel: 0.16 });
  m.box('ornamental header', [span, 0.55, 0.55], [0, 5.4 + c.size * 0.12, 0], 'wood-painted', { bevel: 0.1 });
  m.sign('mandatory hoa sign', [5.8, 1.45], [0, 4.55, 0.33], {});
  const angle = c.state ? 0.2 + c.layout * 0.15 : 0;
  m.box('left gate', [span / 2 - 0.3, 2.15, 0.16], [-span / 4, 1.3, 0], 'metal-dark', { rotation: rotY(angle) });
  m.box('right gate', [span / 2 - 0.3, 2.15, 0.16], [span / 4, 1.3, 0], 'metal-dark', { rotation: rotY(-angle) });
  if (lod < 2) for (let i = 0; i < 4 + c.size; i++) m.sphere(`perfect hedge ${i}`, [0.72, 0.72, 0.72], [-7 + i * 2.2, 0.78, 2.2], 'foliage');
  return m.group;
}

function pocketPark(variant, lod) {
  const m = new Model(lod), c = plan(variant), w = 8 + c.size, d = 5 + c.layout;
  slab(m, c, w, d);
  bench(m, 'sole bench', 0, 0.6, false, c.side * 0.08);
  m.box('six lane view', [w + 1.5, 0.1, 2.8], [0, 0.14, d / 2 + 1.5], 'asphalt');
  for (let i = -2; i <= 2; i++) m.box(`lane stripe ${i}`, [0.12, 0.03, 2.8], [i * 1.55, 0.21, d / 2 + 1.5], 'paint-yellow');
  if (lod < 2) {
    m.box('tiny trash can', [0.65, 0.9, 0.65], [2.1 * c.side, 0.5, 0.4], 'metal-dark', { bevel: 0.08 });
    if (!c.state) tree(m, 'municipal sapling', -2.6 * c.side, -0.8, 2.7 + c.size * 0.15, true);
    else m.box('stump', [0.65 + c.size * 0.08, 0.42, 0.65], [-2.6 * c.side, 0.28, -0.8], 'bark', { bevel: 0.12 });
  }
  m.sign('pocket park plaque', [2.7, 0.8], [0, 0.95, -d / 2], {});
  return m.group;
}

function hostileBenchPlaza(variant, lod) {
  const m = new Model(lod), c = plan(variant), n = lod === 2 ? 2 : 3 + c.size;
  slab(m, c, 13 + c.size, 10 + c.layout);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + c.layout * 0.2;
    bench(m, `anti-rest bench ${i}`, Math.cos(a) * 4, Math.sin(a) * 3, true, -a + PI / 2);
  }
  m.cylinder('privately owned planter', 1.6 + c.size * 0.08, 1.8, 0.8, [0, 0.45, 0], 'concrete', { segments: 12 });
  if (lod < 2 && !c.state) tree(m, 'approved ornamental', 0, 0, 3.5, true);
  if (c.state) m.cylinder('removed tree cap', 0.45, 0.45, 0.09 + c.size * 0.02, [0, 0.9, 0], 'metal-dark', { segments: 12 });
  m.sign('no loitering rules', [2.2, 1.5], [5.2, 1.55, -3.2], { rotation: [0, -0.25, 0] });
  return m.group;
}

function sidewalkNowhere(variant, lod) {
  const m = new Model(lod), c = plan(variant), length = 8 + c.size * 1.6;
  slab(m, c, 18, 10 + c.layout);
  m.box('lonely sidewalk', [2.1, 0.16, length], [c.side * (1 + c.layout), 0.18, 0], 'concrete', { bevel: 0.04 });
  m.box('abrupt end curb', [2.35, 0.52 + c.size * 0.04, 0.28], [c.side * (1 + c.layout), 0.26 + c.size * 0.02, -length / 2], 'concrete', { bevel: 0.04 });
  m.box('development fence', [12, 1.6, 0.12], [0, 0.85, -length / 2 - 1], 'metal-galvanized');
  posts(m, lod === 2 ? 4 : 6 + c.size, -6, -length / 2 - 1, 12 / (5 + c.size), 0, 1.7, 'metal-galvanized');
  if (lod < 2) {
    for (let i = 0; i < 2 + c.layout; i++) m.sphere(`desire path weed ${i}`, [0.45, 0.35 + i * 0.04, 0.5], [-3 + i * 2.1, 0.35 + i * 0.04, -length / 2 - 2.4], 'foliage');
    if (c.state) m.box('coming soon plywood', [4.6, 2.4, 0.12], [-3 * c.side, 1.4, -length / 2 - 1.1], 'wood-oak');
  }
  return m.group;
}

function countyFair(variant, lod) {
  const m = new Model(lod), c = plan(variant), r = 4.4 + c.size * 0.35;
  slab(m, c, 18 + c.size, 16 + c.layout);
  m.torus('ferris wheel rim', r, 0.18, [0, r + 0.8, -1], 'metal-dark', { rotation: [0, PI / 2, 0] });
  const spokes = lod === 2 ? 4 : 8 + c.layout * 2;
  for (let i = 0; i < spokes; i++) {
    const a = i * PI * 2 / spokes;
    m.pipe(`wheel spoke ${i}`, [[0, r + 0.8, -1], [0, r + 0.8 + Math.sin(a) * r, -1 + Math.cos(a) * r]], 0.055, 'metal-galvanized');
    if (lod < 2 && i % 2 === 0) m.box(`gondola ${i}`, [0.75, 0.65, 0.55], [0, r + 0.8 + Math.sin(a) * r, -1 + Math.cos(a) * r], i % 4 ? 'paint-yellow' : 'paint-red', { bevel: 0.1 });
  }
  m.pipe('left wheel leg', [[0, r + 0.8, -1], [-3.4, 0.2, -1]], 0.2, 'metal-dark');
  m.pipe('right wheel leg', [[0, r + 0.8, -1], [3.4, 0.2, -1]], 0.2, 'metal-dark');
  if (lod < 2) for (let i = 0; i < 2 + c.size; i++) m.box(`midway booth ${i}`, [2.1, 1.8, 2], [-6 + i * 2.7, 1, 6], i % 2 ? 'paint-red' : 'paint-yellow', { bevel: 0.08 });
  if (c.state) m.box('closed tarp', [4.2 + c.size * 0.25, 0.12, 3.2], [c.side * 5.2, 0.25, 2.8], 'paint-blue');
  return m.group;
}

function splashPad(variant, lod) {
  const m = new Model(lod), c = plan(variant), r = 5 + c.size * 0.4;
  m.cylinder('patriotic splash pad', r, r, 0.2 + c.size * 0.02, [0, 0.1 + c.size * 0.01, 0], 'paint-blue', { segments: lod === 2 ? 12 : 24 });
  const jets = lod === 2 ? 4 : 6 + c.size;
  for (let i = 0; i < jets; i++) {
    const a = i * PI * 2 / jets + c.layout * 0.16;
    const jetH = c.state ? 0.18 : 1.1 + (i % 3) * 0.35;
    m.cylinder(`jet ${i}`, 0.08, 0.13, jetH, [Math.cos(a) * r * 0.62, jetH / 2 + 0.2, Math.sin(a) * r * 0.62], c.state ? 'metal-copper' : 'glass-blue', { segments: 7 });
  }
  m.box('flag pole', [0.15, 7 + c.layout, 0.15], [0, 3.5 + c.layout / 2, 0], 'metal-galvanized');
  m.box('flag', [2.4 + c.size * 0.1, 1.3, 0.07], [1.25, 6.3 + c.layout, 0], 'paint-red', { bevel: 0.03 });
  if (lod < 2) m.sign('splash pad rules', [2.6, 1.4], [r + 1.3, 1.5, 0], { rotation: [0, PI / 2, 0] });
  return m.group;
}

function trashmore(variant, lod) {
  const m = new Model(lod), c = plan(variant), r = 6 + c.size * 0.65;
  slab(m, c, 18, 17 + c.layout);
  m.cylinder('capped landfill lower', r, r * 0.72, 2.2, [0, 1.2, 0], 'foliage', { segments: lod === 2 ? 10 : 18 });
  m.cylinder('capped landfill upper', r * 0.72, r * 0.28, 2.8 + c.layout * 0.25, [0, 3.5, 0], 'foliage', { segments: lod === 2 ? 10 : 18 });
  m.pipe('scenic switchback', [[-r, 0.35, 0], [-r * 0.4, 1.7, 2], [r * 0.45, 2.5, -1], [0, 5.1 + c.layout * 0.25, 0]], 0.34, 'soil');
  m.sign('mount trashmore sign', [4.8, 1.35], [0, 1.55, r + 1], {});
  if (lod < 2) {
    const vents = 2 + c.size;
    for (let i = 0; i < vents; i++) m.pipe(`methane vent ${i}`, [[-3 + i * 1.3, 2.2 + i * 0.25, 0], [-3 + i * 1.3, 3.6 + i * 0.25, 0]], 0.1, 'metal-galvanized');
    if (c.state) for (let i = 0; i < 3 + c.layout; i++) m.box(`exposed trash ${i}`, [0.6 + i * 0.1, 0.28, 0.7], [-2 + i, 2.1 + i * 0.22, 2.1], 'paint-orange', { bevel: 0.08 });
  }
  return m.group;
}

function hellbenderMemorial(variant, lod) {
  const m = new Model(lod), c = plan(variant), w = 10 + c.size;
  slab(m, c, w + 5, 11 + c.layout);
  m.box('commemorative parking lot', [w, 0.14 + c.size * 0.01, 7.5], [0, 0.07 + c.size * 0.005, 0], 'asphalt');
  const spaces = lod === 2 ? 4 : 6 + c.size;
  for (let i = 0; i < spaces; i++) m.box(`empty stripe ${i}`, [0.09, 0.035, 5.2], [-w / 2 + 0.8 + i * (w - 1.6) / Math.max(spaces - 1, 1), 0.24, 0.2], 'paint-white');
  m.box('granite plinth', [3.8, 1.1, 2.1], [0, 0.75, -4.6], 'limestone', { bevel: 0.14 });
  m.pipe('bronze salamander', [[-1.2, 1.35, -4.6], [-0.45, 1.72, -4.6], [0.4, 1.45, -4.6], [1.2 + c.size * 0.1, 1.75, -4.6]], 0.22, 'metal-copper');
  m.box('memorial story wall', [2.8 + c.layout * 0.65, 1.4 + c.layout * 0.18, 0.28], [-3.5 + c.layout * 0.35, 0.78 + c.layout * 0.09, -3.6 - c.layout * 0.22], 'limestone', { bevel: 0.08, rotation: rotY(-0.12 * c.layout) });
  m.sign('hellbender plaque', [3.1, 0.72], [0, 0.9, -3.51], { rotation: [-PI / 2.8, 0, 0] });
  if (lod < 2 && c.state) car(m, 'memorial suv', c.side * 2.5, 0.5, PI, false);
  return m.group;
}

function giantFork(variant, lod) {
  const m = new Model(lod), c = plan(variant), h = 11 + c.size * 0.8;
  slab(m, c, 10 + c.layout, 9);
  m.box('fork handle', [1.15 + c.size * 0.035, h * 0.72, 0.5], [0, h * 0.36 + 0.5, 0], 'metal-galvanized', { bevel: 0.18, rotation: [0, 0, c.state ? 0.1 * c.side : 0] });
  for (let i = 0; i < 4; i++) m.box(`fork tine ${i}`, [0.32, h * 0.3 + c.layout * 0.15, 0.42], [-1.05 + i * 0.7, h * 0.84, 0], 'metal-galvanized', { bevel: 0.1, rotation: [0, 0, c.state ? 0.1 * c.side : 0] });
  m.box('fork shoulder', [3.2, 0.7, 0.52], [0, h * 0.7, 0], 'metal-galvanized', { bevel: 0.15 });
  m.sign('world largest fork sign', [5.4, 1.5], [0, 1.55, 3.4], {});
  if (lod < 2) for (let i = 0; i < 2 + c.layout; i++) m.box(`selfie bollard ${i}`, [0.22, 0.9, 0.22], [-2 + i * 1.4, 0.5, 2], 'paint-yellow', { bevel: 0.04 });
  return m.group;
}

function mufflerMan(variant, lod) {
  const m = new Model(lod), c = plan(variant), h = 9 + c.size * 0.65;
  slab(m, c, 10, 8 + c.layout);
  m.box('fiberglass boots', [2.8, h * 0.34, 1.7], [0, h * 0.17, 0], 'paint-blue', { bevel: 0.32 });
  m.box('fiberglass torso', [3.5, h * 0.38, 2], [0, h * 0.53, 0], 'paint-red', { bevel: 0.45 });
  m.sphere('giant head', [1.15 + c.size * 0.025, 1.3, 1.08], [0, h * 0.82, 0], 'brick-cream');
  m.cylinder('hard hat', 1.22, 1.05, 0.65, [0, h * 0.96, 0], 'paint-yellow', { segments: 12 });
  m.pipe('left giant arm', [[-1.4, h * 0.66, 0], [-3.2, h * 0.52, c.side * 0.5], [-3.7, h * 0.72, c.side]], 0.48, 'brick-cream');
  m.pipe('right giant arm', [[1.4, h * 0.66, 0], [3.1, h * 0.55, -c.side * 0.4], [3.6, h * 0.74, -c.side]], 0.48, 'brick-cream');
  m.cylinder('held muffler', 0.42, 0.42, 4.2 + c.layout * 0.3, [3.8, h * 0.76, -c.side], c.state ? 'metal-copper' : 'metal-galvanized', { segments: 10, rotation: [0, c.state ? c.side * 0.18 : 0, PI / 2 + (c.state ? c.side * 0.08 : 0)] });
  if (lod < 2) m.sign('muffler man plaque', [4, 1.2], [0, 1.3, 3.2], {});
  return m.group;
}

function twineBall(variant, lod) {
  const m = new Model(lod), c = plan(variant), r = 3.1 + c.size * 0.28;
  slab(m, c, 12 + c.layout, 11);
  m.sphere('world famous twine', [r + c.size * 0.03, r, r], [0, r + 0.35, 0], 'wood-oak');
  const wraps = lod === 2 ? 3 : 5 + c.layout;
  for (let i = 0; i < wraps; i++) m.torus(`twine wrap ${i}`, r * (0.75 + i * 0.035), 0.055, [0, r + 0.35 + (i - wraps / 2) * 0.12, 0], i % 2 ? 'brick-cream' : 'wood-oak', { rotation: [PI / 2 + (i - wraps / 2) * 0.04, i * 0.27, 0] });
  posts(m, 4, -4.5, 0, 3, 0, r * 2 + 1, 'wood-painted');
  m.box('souvenir shelter roof', [10.2, 0.3, 8], [0, r * 2 + 1.05, 0], 'roof-metal', { bevel: 0.12 });
  m.sign('twine miracle sign', [5.5, 1.5], [0, 1.65, 5.1], {});
  if (c.state) m.pipe('loose twine tail', [[r * c.side, r, 0], [r * 1.5 * c.side, 1.2, 1], [r * 1.8 * c.side, 0.3, 2 + c.layout * 0.2]], 0.08, 'wood-oak');
  return m.group;
}

function roadsideCross(variant, lod) {
  const m = new Model(lod), c = plan(variant), h = 14 + c.size * 1.25;
  slab(m, c, 13 + c.layout, 11);
  m.box('towering upright', [1.25 + c.size * 0.025, h, 1.1], [0, h / 2, 0], 'paint-white', { bevel: 0.16 });
  m.box('towering crossbeam', [8 + c.layout, 1.2, 1.1], [0, h * 0.69, 0], 'paint-white', { bevel: 0.16, rotation: [0, 0, c.state ? c.side * 0.035 : 0] });
  m.cylinder('illuminated base', 3.1 + c.size * 0.1, 3.5, 1.2, [0, 0.62, 0], 'limestone', { segments: lod === 2 ? 10 : 18 });
  if (lod < 2) {
    const lights = 5 + c.layout;
    for (let i = 0; i < lights; i++) m.sphere(`uplight ${i}`, [0.18, 0.12, 0.18], [-2 + i * 4 / Math.max(lights - 1, 1), 1.25, 1.5], c.state ? 'metal-dark' : 'paint-yellow');
    m.sign('cross attraction sign', [4.7, 1.3], [0, 1.45, 4.8], {});
  }
  return m.group;
}

function frankenpine(variant, lod) {
  const m = new Model(lod), c = plan(variant), h = 12 + c.size;
  slab(m, c, 10 + c.layout, 9);
  m.cylinder('steel tree trunk', 0.35, 0.58, h, [0, h / 2, 0], 'bark', { segments: 9 });
  const tiers = lod === 2 ? 3 : 5 + c.layout;
  for (let i = 0; i < tiers; i++) {
    const y = h * (0.48 + i * 0.085);
    const len = 3.4 - i * 0.32 + c.size * 0.08;
    m.pipe(`fake branch left ${i}`, [[0, y, 0], [-len, y + 0.55, (i % 2) * 0.5]], 0.12, 'foliage');
    m.pipe(`fake branch right ${i}`, [[0, y + 0.18, 0], [len, y + 0.7, -(i % 2) * 0.5]], 0.12, 'foliage');
  }
  m.box('cell panels', [2.8 + c.size * 0.04, 1.7, 0.28], [0, h * 0.78, 0.65], 'metal-galvanized', { bevel: 0.08, rotation: rotY(c.side * 0.2) });
  m.box('last tree plaque plinth', [3.5, 1, 1.8], [0, 0.6, 3.2], 'limestone', { bevel: 0.12 });
  m.sign('last tree plaque', [2.9, 0.7], [0, 0.75, 4.12], {});
  if (lod < 2 && c.state) m.box('maintenance cabinet', [1.5, 2.2 + c.layout * 0.1, 1.2], [2.8 * c.side, 1.1 + c.layout * 0.05, -1], 'metal-galvanized', { bevel: 0.1 });
  return m.group;
}

function historyMuseum(variant, lod) {
  const m = new Model(lod), c = plan(variant), w = 11 + c.size, d = 8 + c.layout * 0.7;
  slab(m, c, w + 7, d + 8);
  m.box('museum block', [w, 4.8, d], [0, 2.5, 0], 'brick-cream', { bevel: 0.1 });
  m.box('fake historic facade', [w + 0.6, 5.7, 0.65], [0, 2.95, d / 2 + 0.28], 'brick-red', { bevel: 0.08 });
  m.cylinder('cupola drum', 1.3, 1.45, 1.5, [0, 6.15, d / 2], 'paint-white', { segments: 10 });
  m.cylinder('cupola roof', 0.08, 1.7, 1.35, [0, 7.55, d / 2], 'metal-copper', { segments: 10 });
  m.box('glass entry', [3.2, 3.1, 0.22], [0, 1.8, d / 2 + 0.66], 'glass-blue', { bevel: 0.06 });
  m.sign('suburban history museum sign', [6.5, 1.2], [0, 4.25, d / 2 + 0.67], {});
  if (lod < 2) {
    const artifacts = 2 + c.layout;
    for (let i = 0; i < artifacts; i++) m.box(`historic parking meter ${i}`, [0.18, 1.45, 0.18], [-3 + i * 1.8, 0.78, d / 2 + 2.2], 'metal-dark', { bevel: 0.04 });
    m.box('museum parking field', [w + 5, 0.12, 4.5 + c.size * 0.3], [0, 0.14, d / 2 + 5], 'asphalt');
    if (c.state) m.box('future condo banner', [5.2 + c.size * 0.25, 1.05, 0.08], [0, 3.3, d / 2 + 0.7], 'paint-orange');
  }
  return m.group;
}

const specs = [
  ['single-wide', 'Single-Wide Freedom Home', 'A narrow manufactured home with a porch, dish, and optional tarp.', 'Affordable housing, accessorized one emergency repair at a time.', ['EAGLE CREST HOMES', 'LAND INCLUDED*'], ['home', 'trailer', 'manufactured']],
  ['double-wide', 'Double-Wide Executive', 'A joined manufactured home with a proud screen porch.', 'Twice the width, one shared marriage seam.', ['HOMESTEAD DELUXE', 'LIVE EXTRA WIDE'], ['home', 'trailer', 'porch']],
  ['whispering-pines', 'Whispering Pines Estates', 'A dense mobile-home park behind a grand entry beam.', 'Pines sold separately; one demonstration tree may remain.', ['WHISPERING PINES', 'PINES NOT INCLUDED'], ['community', 'trailer-park', 'gate']],
  ['holler-cabin', 'Holler Cabin Compound', 'A porch cabin with junk cars, trampoline, and burn barrel.', 'The amenities are paid off and most of them once ran.', ['HOLLOW CREEK', 'NO TRESPASSING'], ['home', 'rural', 'clutter']],
  ['tract-ashford', 'The Ashford', 'A low ranch tract house dominated by its garage.', 'An artisanal floor plan repeated 640 times.', ['THE ASHFORD', 'FROM THE LOW $400s'], ['home', 'tract', 'garage-forward']],
  ['tract-beaumont', 'The Beaumont', 'A stucco tract home with ceremonial columns.', 'Classical dignity with a 35-year adjustable mortgage.', ['THE BEAUMONT', 'ELEVATION B PREMIUM'], ['home', 'tract', 'columns']],
  ['tract-carrington', 'The Carrington', 'A two-story tract home with a bay window and HOA lawn.', 'Every window is unique among three approved options.', ['THE CARRINGTON', 'LUXURY IS STANDARD*'], ['home', 'tract', 'two-story']],
  ['seven-gables-mcmansion', 'Seven Gables McMansion', 'A garage-forward mansion with seven rooflines and one turret.', 'Stone veneer ends exactly where the camera does.', ['CHATEAU RIDGE', 'ESTATE LIVING'], ['home', 'mcmansion', 'turret']],
  ['gather-farmhouse', 'GATHER Modern Farmhouse', 'White board-and-batten, black roof, wrap porch, command sign.', 'A farmhouse engineered never to encounter agriculture.', ['GATHER', 'FARMHOUSE COLLECTION'], ['home', 'farmhouse', 'trend']],
  ['liberty-barndominium', 'Liberty Barndominium', 'A metal barn containing a house, hangar door, and decorative grain bin.', 'Rural authenticity sized for an RV and three air fryers.', ['LIBERTY BARNDOMINIUMS', 'COUNTRY. BUT WI-FI.'], ['home', 'barn', 'rural']],
  ['gated-golf-estate', 'Gated Golf Estates', 'Monumental stone gates, topiary, and a tiny guard hut.', 'The gates keep out everyone who maintains the golf course.', ['FAIRWAY PRESERVE', 'PRIVATE BY NATURE'], ['community', 'gate', 'golf']],
  ['blackrack-rentals', 'Blackrack Build-to-Rent', 'Rows of identical rental cottages and a leasing wall.', 'The American dream, billed monthly with a convenience fee.', ['BLACKRACK LIVING', 'OWN THE MOMENT. RENT THE HOUSE.'], ['community', 'rentals', 'corporate']],
  ['golf-cart-village', 'Forever Young Golf-Cart Village', 'Pastel retirement villas arranged around golf-cart parking.', 'Active-adult freedom at a governed 12 miles per hour.', ['FOREVER YOUNG', '55+ · NO GRANDKIDS AFTER 8'], ['community', 'retirement', 'golf-cart']],
  ['five-acre-ranchette', 'Five-Acre Ranchette', 'One ranch house, one horse, one mower, and a great deal of fence.', 'Agricultural heritage expressed as lawn maintenance.', ['LONE HORSE RANCH', '5 ACRES · 1 HORSE'], ['home', 'ranchette', 'horse']],
  ['prepper-compound', 'Prepared Acres Compound', 'A fortified cabin, circular palisade, bunker hatch, and water totes.', 'Off-grid independence with a very online antenna.', ['PREPARED ACRES', 'WE SAW THIS COMING'], ['home', 'compound', 'bunker']],
  ['lake-serenity-pond', 'Lake Serenity Retention Pond', 'A stormwater basin advertised as waterfront living.', 'Municipal drainage acquires a luxury amenity fee.', ['LAKE SERENITY', 'LUXURY WATERFRONT LOTS'], ['landscape', 'retention-pond', 'greenwash']],
  ['mandatory-hoa-gate', 'Mandatory HOA Gate', 'Faux-stone piers and ornamental gates guard approved lawns.', 'Community begins with an access code and ends at the violation notice.', ['PATRIOT OAKS HOA', 'WELCOME, RESIDENTS & DELIVERIES'], ['community', 'hoa', 'gate']],
  ['pocket-park', 'Six-Lane Pocket Park', 'One bench faces a six-lane asphalt view.', 'A recreation amenity measured without crossing the road.', ['CHAD BROKOWSKI PARK', 'OPEN DAWN TO TRAFFIC'], ['park', 'hostile', 'stroad']],
  ['hostile-bench-plaza', 'Civic Comfort Plaza', 'A hard plaza ringed by aggressively divided benches.', 'Public space optimized to prevent the public from resting.', ['CIVIC COMFORT PLAZA', 'NO LYING · NO SITTING LONG'], ['park', 'hostile-design', 'plaza']],
  ['sidewalk-to-nowhere', 'Sidewalk to Nowhere', 'A pristine sidewalk ends at a curb and development fence.', 'Pedestrian infrastructure successfully completes half a thought.', ['FUTURE CONNECTION', 'PHASE 9 SUBJECT TO FUNDING'], ['landscape', 'sidewalk', 'disconnected']],
  ['county-fair-midway', 'Possum County Midway', 'A Ferris wheel and bright portable midway booths.', 'A week of public culture and eleven months of compacted mud.', ['POSSUM COUNTY FAIR', 'RIDES · PIE · PARKING'], ['amusement', 'fair', 'ferris-wheel']],
  ['freedom-splash-pad', 'Freedom Splash Pad', 'A patriotic round splash pad with a towering flag.', 'The pool was too expensive, so children receive timed pavement mist.', ['FREEDOM SPLASH', 'WATER HOURS MAY VARY'], ['park', 'splash-pad', 'flag']],
  ['mount-trashmore', 'Mount Trashmore Regional Park', 'A capped landfill landscaped into a switchback hill.', 'Yesterday’s trash becomes today’s scenic methane overlook.', ['MOUNT TRASHMORE', 'NATURE, RECLAIMED BY SPONSORS'], ['park', 'landfill', 'greenwash']],
  ['last-hellbender-memorial', 'Last Hellbender Memorial Lot', 'A salamander monument centered on commemorative parking.', 'The species lost its creek but gained eight convenient spaces.', ['HELLBENDER MEMORIAL', 'PARKING FOR POSTERITY'], ['monument', 'extinction', 'parking']],
  ['worlds-largest-fork', "World's Largest Fork", 'A monumental stainless fork with selfie bollards.', 'Economic development you can see from the bypass.', ["WORLD'S LARGEST FORK", 'FORK AROUND & FIND OUT'], ['roadside', 'monument', 'fork']],
  ['liberty-muffler-man', 'Liberty Muffler Man', 'A giant fiberglass worker holding a muffler overhead.', 'Heritage, petroleum, and body-shop fiberglass at highway scale.', ['LIBERTY MUFFLER MAN', 'GIANT SAVINGS AHEAD'], ['roadside', 'statue', 'fiberglass']],
  ['miracle-twine-ball', 'Miracle Twine Ball', 'A giant wrapped twine ball sheltered like a sacred relic.', 'A regional identity assembled one hardware-store receipt at a time.', ['MIRACLE TWINE', 'BIGGEST THIS SIDE OF EXIT 47'], ['roadside', 'attraction', 'twine']],
  ['roadside-cross', 'Two-Hundred-Foot Roadside Cross', 'An illuminated cross monument on a highway-scale base.', 'A spiritual landmark engineered for interstate sightlines.', ['THE CROSS AT EXIT 47', 'VISIBLE FOR 12 MILES'], ['roadside', 'monument', 'cross']],
  ['frankenpine-memorial', 'The Last Tree Frankenpine', 'A cellular tower disguised as a pine with a memorial plaque.', 'The final tree returns as premium wireless coverage.', ['THE LAST TREE', 'CONNECTING PARADISE'], ['monument', 'cell-tower', 'greenwash']],
  ['suburban-history-museum', 'Suburban History Museum', 'A new brick box wearing an old-town facade and cupola.', 'Local history preserved beside the parking lot that replaced it.', ['MUSEUM OF SUBURBAN HISTORY', 'REMEMBERING WHAT WAS HERE'], ['museum', 'culture', 'parking']],
];

const builders = [
  singleWide, doubleWide, whisperingPines, hollerCabin, ashford, beaumont, carrington, mcmansion, farmhouse,
  barndominium, gatedGolf, blackrackRentals, golfCartVillage, ranchette, prepperCompound, retentionPond,
  hoaGate, pocketPark, hostileBenchPlaza, sidewalkNowhere, countyFair, splashPad, trashmore,
  hellbenderMemorial, giantFork, mufflerMan, twineBall, roadsideCross, frankenpine, historyMuseum,
];

export const families = specs.map(([id, label, description, satire, signLines, tags], i) => ({
  id,
  label,
  category: 'neighborhood',
  description,
  satire,
  signLines,
  tags,
  create: builders[i],
}));

if (families.length !== 30) throw new Error(`Expected 30 neighborhood families, got ${families.length}`);
