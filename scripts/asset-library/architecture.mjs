import { Model, THREE } from './kit.mjs';

// SLOPMERICA modular architecture kit. Dimensions are metres; Y is up and the
// street-facing side is +Z. Wall-mounted pieces sit at y=0 on the host floor.

const MAT = {
  brick: 'brick-red', cream: 'brick-cream', stucco: 'stucco-ivory',
  concrete: 'concrete', stone: 'limestone', asphalt: 'asphalt',
  shingle: 'roof-shingle', roof: 'roof-metal', wood: 'wood-oak',
  paint: 'wood-painted', dark: 'metal-dark', galvanized: 'metal-galvanized',
  copper: 'metal-copper', glass: 'glass-blue', rubber: 'rubber',
};

const clampLod = (lod) => Math.max(0, Math.min(2, Number.isFinite(lod) ? Math.floor(lod) : 0));
const model = (lod) => new Model(clampLod(lod));
const addBox = (m, name, size, pos, mat, bevel = 0.018, rotation) =>
  m.box(name, size, pos, mat, { bevel, ...(rotation ? { rotation } : {}) });
const addCylinder = (m, name, rt, rb, h, pos, mat, segments, rotation) =>
  m.cylinder(name, rt, rb, h, pos, mat, { segments, ...(rotation ? { rotation } : {}) });

function addFrame(m, prefix, w, h, y0, z, frame, mat = MAT.paint, ox = 0) {
  addBox(m, `${prefix}-head`, [w + frame * 2, frame, 0.12], [ox, y0 + h + frame / 2, z], mat);
  addBox(m, `${prefix}-sill-frame`, [w + frame * 2, frame, 0.12], [ox, y0 - frame / 2, z], mat);
  addBox(m, `${prefix}-left-jamb`, [frame, h, 0.12], [ox - w / 2 - frame / 2, y0 + h / 2, z], mat);
  addBox(m, `${prefix}-right-jamb`, [frame, h, 0.12], [ox + w / 2 + frame / 2, y0 + h / 2, z], mat);
}

function addMuntins(m, prefix, w, h, y0, z, cols, rows, mat = MAT.paint, ox = 0) {
  const bar = Math.min(0.045, w / 30);
  for (let i = 1; i < cols; i++) addBox(m, `${prefix}-vertical-${i}`, [bar, h, 0.045], [ox - w / 2 + w * i / cols, y0 + h / 2, z], mat, 0.006);
  for (let i = 1; i < rows; i++) addBox(m, `${prefix}-horizontal-${i}`, [w, bar, 0.045], [ox, y0 + h * i / rows, z], mat, 0.006);
}

function addWindowUnit(m, spec, lod, ox = 0, oy = 0, scale = 1) {
  const w = spec.w * scale, h = spec.h * scale, sill = (spec.sill ?? 0.75) + oy;
  const projection = spec.projection ?? 0;
  const glassZ = 0.035 + projection;
  addBox(m, `${spec.name}-recess`, [w + 0.24, h + 0.24, 0.1], [ox, sill + h / 2, -0.035 + projection], spec.surround ?? MAT.stone, 0.012);
  addBox(m, `${spec.name}-glass`, [w, h, 0.045], [ox, sill + h / 2, glassZ], MAT.glass, 0.008);
  if (lod < 2) {
    addFrame(m, spec.name, w, h, sill, glassZ + 0.065, spec.frame ?? 0.075, spec.frameMat ?? MAT.paint, ox);
    addBox(m, `${spec.name}-sill`, [w + 0.32, 0.09, 0.26], [ox, sill - 0.12, projection + 0.105], spec.sillMat ?? MAT.stone, 0.018);
    if (spec.lintel) addBox(m, `${spec.name}-lintel`, [w + 0.38, 0.13, 0.2], [ox, sill + h + 0.16, projection + 0.07], spec.lintel, 0.02);
  }
  if (lod === 0) {
    addMuntins(m, spec.name, w, h, sill, glassZ + 0.13, spec.cols ?? 2, spec.rows ?? 2, spec.frameMat ?? MAT.paint, ox);
    if (spec.transom) {
      const ty = sill + h * 0.73;
      addBox(m, `${spec.name}-transom-rail`, [w, 0.07, 0.06], [ox, ty, glassZ + 0.15], spec.frameMat ?? MAT.paint, 0.008);
    }
  }
}

function makeWindow(spec, lod) {
  lod = clampLod(lod); const m = model(lod);
  if (spec.kind === 'bay') {
    addBox(m, 'bay-apron', [spec.w + 0.34, spec.sill, spec.depth], [0, spec.sill / 2, spec.depth / 2], spec.apron ?? MAT.cream, 0.025);
    addWindowUnit(m, { ...spec, name: 'bay-center', projection: spec.depth, w: spec.w * 0.62 }, lod);
    const sideW = spec.w * 0.25;
    for (const side of [-1, 1]) {
      const x = side * spec.w * 0.405;
      addBox(m, `bay-side-glass-${side}`, [sideW, spec.h, 0.045], [x, spec.sill + spec.h / 2, spec.depth * 0.62], MAT.glass, 0.008, [0, side * 0.48, 0]);
    }
    addBox(m, 'bay-canopy', [spec.w + 0.44, 0.14, spec.depth + 0.22], [0, spec.sill + spec.h + 0.18, spec.depth / 2], spec.canopy ?? MAT.copper, 0.035);
  } else if (spec.kind === 'arched') {
    addWindowUnit(m, { ...spec, name: 'arched-window', h: spec.h * 0.82 }, lod);
    addBox(m, 'arched-head-glass', [spec.w, spec.h * 0.18, 0.05], [0, spec.sill + spec.h * 0.91, 0.04], MAT.glass, 0.02);
    if (lod < 2) {
      const torus = m.torus('arched-stone-hood', spec.w / 2, 0.075, [0, spec.sill + spec.h * 0.82, 0.13], spec.surround ?? MAT.stone, { rotation: [Math.PI / 2, 0, 0], arc: Math.PI });
      torus.rotation.z = Math.PI;
    }
  } else if (spec.kind === 'ribbon') {
    const n = spec.units;
    for (let i = 0; i < n; i++) addWindowUnit(m, { ...spec, name: `ribbon-${i + 1}`, w: spec.w / n - 0.11 }, lod, -spec.w / 2 + spec.w * (i + 0.5) / n);
  } else {
    addWindowUnit(m, { ...spec, name: 'window' }, lod);
    if (spec.pediment && lod < 2) {
      addBox(m, 'pediment-crown', [spec.w + 0.5, 0.12, 0.22], [0, spec.sill + spec.h + 0.28, 0.11], MAT.stone, 0.025);
      addBox(m, 'pediment-cap', [spec.w + 0.25, 0.16, 0.18], [0, spec.sill + spec.h + 0.38, 0.09], MAT.stone, 0.025, [0, 0, 0]);
    }
    if (spec.shutters && lod < 2) for (const side of [-1, 1]) {
      const sw = 0.28;
      addBox(m, `shutter-${side}`, [sw, spec.h, 0.08], [side * (spec.w / 2 + sw / 2 + 0.09), spec.sill + spec.h / 2, 0.1], MAT.paint, 0.018);
      if (lod === 0) for (let j = 0; j < 4; j++) addBox(m, `shutter-${side}-slat-${j}`, [sw * 0.74, 0.035, 0.04], [side * (spec.w / 2 + sw / 2 + 0.09), spec.sill + spec.h * (j + 1) / 5, 0.15], MAT.dark, 0.004);
    }
  }
  return m.group;
}

function addDoorLeaf(m, spec, lod, x = 0, name = 'door') {
  const z = spec.z ?? 0.09;
  addBox(m, `${name}-reveal`, [spec.w + 0.24, spec.h + 0.14, 0.12], [x, spec.h / 2, z - 0.12], spec.surround ?? MAT.stone, 0.015);
  addBox(m, `${name}-leaf`, [spec.w, spec.h, 0.1], [x, spec.h / 2, z], spec.glazed ? MAT.dark : (spec.leaf ?? MAT.paint), 0.025);
  if (spec.glazed) addBox(m, `${name}-glass`, [spec.w - 0.2, spec.h * 0.58, 0.035], [x, spec.h * 0.64, z + 0.07], MAT.glass, 0.012);
  if (lod < 2) {
    addFrame(m, `${name}-frame`, spec.w, spec.h - 0.075, 0.075, z + 0.08, 0.075, spec.frameMat ?? MAT.paint, x);
    addBox(m, `${name}-threshold`, [spec.w + 0.28, 0.07, 0.32], [x, 0.035, z + 0.04], MAT.concrete, 0.012);
  }
  if (lod === 0) {
    addCylinder(m, `${name}-pull`, 0.035, 0.035, 0.09, [x + spec.w * 0.34, spec.h * 0.48, z + 0.13], spec.hardware ?? MAT.dark, 10, [Math.PI / 2, 0, 0]);
    if (!spec.glazed) for (let row = 0; row < (spec.panels ?? 4); row++) addBox(m, `${name}-panel-${row}`, [spec.w * 0.68, spec.h * 0.13, 0.025], [x, spec.h * (0.18 + row * 0.18), z + 0.065], spec.panelMat ?? MAT.wood, 0.012);
  }
  if (spec.loading) {
    if (lod < 2) for (let y = 0.28; y < spec.h; y += 0.34) addBox(m, `${name}-rollup-slat-${y.toFixed(2)}`, [spec.w - 0.12, 0.035, 0.035], [x, y, 0.17], MAT.dark, 0.004);
    addBox(m, `${name}-bumper-left`, [0.18, 0.48, 0.3], [x - spec.w / 2 + 0.18, 0.24, 0.28], MAT.rubber, 0.025);
    addBox(m, `${name}-bumper-right`, [0.18, 0.48, 0.3], [x + spec.w / 2 - 0.18, 0.24, 0.28], MAT.rubber, 0.025);
  }
}

function makeDoor(spec, lod) {
  lod = clampLod(lod); const m = model(lod);
  if (spec.kind === 'double') {
    addDoorLeaf(m, { ...spec, w: spec.w / 2 - 0.035 }, lod, -spec.w / 4 - 0.02, 'left-door');
    addDoorLeaf(m, { ...spec, w: spec.w / 2 - 0.035 }, lod, spec.w / 4 + 0.02, 'right-door');
  } else addDoorLeaf(m, spec, lod);
  if (spec.transom) {
    addBox(m, 'transom-glass', [spec.w, spec.transom, 0.05], [0, spec.h + spec.transom / 2 + 0.1, 0.06], MAT.glass, 0.012);
    if (lod < 2) addFrame(m, 'transom', spec.w, spec.transom, spec.h + 0.1, 0.13, 0.065, spec.frameMat ?? MAT.paint);
  }
  if (spec.canopy) {
    addBox(m, 'door-canopy', [spec.w + 0.7, 0.13, 0.72], [0, spec.h + (spec.transom ?? 0) + 0.34, 0.32], spec.canopy, 0.035, [-0.07, 0, 0]);
    if (lod === 0) for (const x of [-spec.w / 2, spec.w / 2]) m.pipe(`canopy-brace-${x}`, [[x, spec.h + 0.05, 0.05], [x, spec.h + 0.25, 0.58]], 0.025, MAT.dark);
  }
  if (spec.sidelights) for (const side of [-1, 1]) {
    addBox(m, `sidelight-${side}`, [0.34, spec.h, 0.05], [side * (spec.w / 2 + 0.25), spec.h / 2, 0.06], MAT.glass, 0.012);
    if (lod < 2) addFrame(m, `sidelight-${side}`, 0.34, spec.h, 0, 0.13, 0.055, spec.frameMat ?? MAT.paint);
  }
  return m.group;
}

function addAwning(m, width, y, depth, mat, lod, name = 'awning') {
  addBox(m, `${name}-valance`, [width, 0.18, 0.13], [0, y - 0.12, depth + 0.02], mat, 0.04);
  addBox(m, `${name}-slope`, [width, 0.09, depth], [0, y, depth / 2], mat, 0.035, [-0.18, 0, 0]);
  if (lod === 0) for (let x = -width / 2 + 0.18; x < width / 2; x += 0.36) addBox(m, `${name}-stripe-${x.toFixed(2)}`, [0.12, 0.02, depth * 0.92], [x, y + 0.055, depth / 2], MAT.stucco, 0.008, [-0.18, 0, 0]);
}

function makeStorefront(spec, lod) {
  lod = clampLod(lod); const m = model(lod);
  const w = spec.w, h = spec.h;
  const bulk = spec.bulk ?? 0.62;
  const glassH = h - bulk - 0.62;
  const glassY = bulk + glassH / 2;
  const innerLeft = -w / 2 + 0.21, innerRight = w / 2 - 0.21;
  if (spec.recessDoor) {
    const doorX = spec.doorX ?? 0, openingW = 1.18;
    const openingH = h - 0.4;
    const backRanges = [[-w / 2, doorX - openingW / 2], [doorX + openingW / 2, w / 2]];
    for (const [index, [left, right]] of backRanges.entries()) if (right - left > 0.08) {
      addBox(m, `storefront-backing-${index}`, [right - left, h, 0.18], [(left + right) / 2, h / 2, -0.08], spec.wall ?? MAT.brick, 0.018);
    }
    addBox(m, 'storefront-backing-head', [openingW, h - openingH, 0.18], [doorX, openingH + (h - openingH) / 2, -0.08], spec.wall ?? MAT.brick, 0.018);
    const ranges = [[innerLeft, doorX - openingW / 2], [doorX + openingW / 2, innerRight]];
    for (const [index, [left, right]] of ranges.entries()) if (right - left > 0.08) {
      const width = right - left, x = (left + right) / 2;
      addBox(m, `bulkhead-${index}`, [width, bulk, 0.18], [x, bulk / 2, 0.08], spec.bulkMat ?? MAT.stone, 0.022);
      addBox(m, `display-glass-${index}`, [width, glassH, 0.055], [x, glassY, 0.08], MAT.glass, 0.012);
    }
  } else {
    addBox(m, 'storefront-backing', [w, h, 0.18], [0, h / 2, -0.08], spec.wall ?? MAT.brick, 0.018);
    addBox(m, 'bulkhead', [w - 0.42, bulk, 0.18], [0, bulk / 2, 0.08], spec.bulkMat ?? MAT.stone, 0.022);
    addBox(m, 'display-glass', [w - 0.42, glassH, 0.055], [0, glassY, 0.08], MAT.glass, 0.012);
  }
  if (lod < 2) {
    addBox(m, 'header', [w + 0.12, 0.28, 0.26], [0, h - 0.14, 0.08], spec.header ?? MAT.stone, 0.026);
    addBox(m, 'left-pier', [0.2, h, 0.26], [-w / 2 + 0.1, h / 2, 0.08], spec.pier ?? MAT.stone, 0.018);
    addBox(m, 'right-pier', [0.2, h, 0.26], [w / 2 - 0.1, h / 2, 0.08], spec.pier ?? MAT.stone, 0.018);
    const bays = spec.bays ?? 3;
    for (let i = 1; i < bays; i++) {
      const x = -w / 2 + w * i / bays;
      if (!spec.recessDoor || Math.abs(x - (spec.doorX ?? 0)) > 0.67) addBox(m, `display-mullion-${i}`, [0.075, glassH, 0.08], [x, glassY, 0.15], MAT.dark, 0.008);
    }
  }
  if (spec.recessDoor) {
    const doorX = spec.doorX ?? 0, doorH = Math.min(2.18, h - 0.66), openingW = 1.18;
    addBox(m, 'entry-shadow', [openingW, doorH + 0.18, 0.05], [doorX, (doorH + 0.18) / 2, -0.23], MAT.dark, 0.006);
    addBox(m, 'entry-left-return', [0.1, doorH + 0.18, 0.42], [doorX - openingW / 2, (doorH + 0.18) / 2, -0.02], spec.pier ?? MAT.stone, 0.012);
    addBox(m, 'entry-right-return', [0.1, doorH + 0.18, 0.42], [doorX + openingW / 2, (doorH + 0.18) / 2, -0.02], spec.pier ?? MAT.stone, 0.012);
    addBox(m, 'entry-head-return', [openingW + 0.1, 0.12, 0.42], [doorX, doorH + 0.12, -0.02], spec.pier ?? MAT.stone, 0.014);
    addDoorLeaf(m, { w: 0.86, h: doorH, glazed: true, z: -0.15, surround: MAT.dark, frameMat: MAT.dark }, lod, doorX, 'shop-door');
    const transomH = Math.max(0.24, h - doorH - 0.64);
    addBox(m, 'entry-transom-glass', [0.86, transomH, 0.04], [doorX, doorH + 0.18 + transomH / 2, -0.08], MAT.glass, 0.008);
    if (lod < 2) addFrame(m, 'entry-transom', 0.86, transomH, doorH + 0.18, -0.025, 0.055, MAT.dark, doorX);
    addBox(m, 'entry-threshold', [openingW + 0.08, 0.08, 0.58], [doorX, 0.04, 0.02], MAT.concrete, 0.014);
  }
  if (spec.awning) addAwning(m, w + 0.08, h - 0.35, spec.awningDepth ?? 0.72, spec.awning, lod);
  if (spec.sign && lod < 2) {
    addBox(m, 'sign-band', [w * 0.72, 0.48, 0.12], [0, h + 0.27, 0.12], spec.sign, 0.04);
    if (lod === 0) for (const x of [-w * 0.27, w * 0.27]) m.pipe(`sign-bracket-${x}`, [[x, h, 0], [x, h + 0.22, 0.18]], 0.024, MAT.dark);
  }
  if (spec.corner && lod < 2) {
    addBox(m, 'corner-return-glass', [1.5, h - 0.8, 0.055], [w / 2 + 0.04, h / 2, -0.72], MAT.glass, 0.012, [0, Math.PI / 2, 0]);
    addBox(m, 'corner-return-header', [1.62, 0.22, 0.2], [w / 2 + 0.04, h - 0.18, -0.72], spec.header ?? MAT.stone, 0.018, [0, Math.PI / 2, 0]);
    addBox(m, 'corner-return-bulkhead', [1.5, bulk, 0.16], [w / 2 + 0.04, bulk / 2, -0.72], spec.bulkMat ?? MAT.stone, 0.018, [0, Math.PI / 2, 0]);
    addBox(m, 'corner-column', [0.2, h, 0.2], [w / 2 + 0.04, h / 2, -1.48], spec.pier ?? MAT.stone, 0.02);
  }
  return m.group;
}

function mesh(m, name, vertices, indices, mat) {
  // Duplicate triangle vertices so each face can select its own metre-space UV
  // projection without introducing seams into the normal calculation.
  const positions = [], uvs = [];
  for (let i = 0; i < indices.length; i += 3) {
    const tri = indices.slice(i, i + 3).map(index => vertices[index]);
    const a = new THREE.Vector3(...tri[0]), b = new THREE.Vector3(...tri[1]), c = new THREE.Vector3(...tri[2]);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    for (const [x, y, z] of tri) {
      positions.push(x, y, z);
      if (ay >= ax && ay >= az) uvs.push(x, -z);
      else if (ax >= az) uvs.push(-z * Math.sign(normal.x), y);
      else uvs.push(x * Math.sign(normal.z), y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals(); g.userData.metreUV = true;
  const result = new THREE.Mesh(g, m.material(mat)); result.name = name; m.add(result); return result;
}

function addGableCaps(m, w, rise, depth, mat) {
  const v = [[-w/2,0,-depth/2],[w/2,0,-depth/2],[0,rise,-depth/2],[-w/2,0,depth/2],[w/2,0,depth/2],[0,rise,depth/2]];
  mesh(m, 'gable-end-caps', v, [0,2,1,5,3,4], mat);
}

function makeRoof(spec, lod) {
  lod = clampLod(lod); const m = model(lod);
  const w = spec.w, d = spec.d, rise = spec.rise ?? w * 0.28, thick = spec.thick ?? 0.1;
  const roofMat = spec.mat ?? MAT.shingle;
  if (spec.kind === 'gable') {
    const slope = Math.hypot(w / 2 + spec.overhang, rise);
    const angle = Math.atan2(rise, w / 2 + spec.overhang);
    for (const side of [-1, 1]) addBox(m, `roof-plane-${side}`, [slope, thick, d + spec.overhang * 2], [side * (w / 4 + spec.overhang / 2), rise / 2, 0], roofMat, 0.018, [0, 0, -side * angle]);
    addGableCaps(m, w, rise, d, spec.gableMat ?? MAT.cream);
    if (lod < 2) addCylinder(m, 'ridge-cap', 0.065, 0.065, d + spec.overhang * 2.05, [0, rise + 0.035, 0], spec.capMat ?? roofMat, 10, [Math.PI / 2, 0, 0]);
  } else if (spec.kind === 'shed') {
    const slope = Math.hypot(d + spec.overhang * 2, rise);
    addBox(m, 'shed-plane', [w + spec.overhang * 2, thick, slope], [0, rise / 2, 0], roofMat, 0.018, [Math.atan2(rise, d + spec.overhang * 2), 0, 0]);
    addBox(m, 'high-fascia', [w + spec.overhang * 2, rise, 0.1], [0, rise / 2, -d / 2], spec.gableMat ?? MAT.paint, 0.012);
  } else if (spec.kind === 'flat') {
    addBox(m, 'roof-deck', [w, thick, d], [0, thick / 2, 0], roofMat, 0.018);
    for (const z of [-d/2, d/2]) addBox(m, `parapet-${z}`, [w + 0.28, spec.parapet, 0.22], [0, spec.parapet / 2, z], spec.gableMat ?? MAT.brick, 0.018);
    for (const x of [-w/2, w/2]) addBox(m, `side-parapet-${x}`, [0.22, spec.parapet, d], [x, spec.parapet / 2, 0], spec.gableMat ?? MAT.brick, 0.018);
    if (lod < 2) for (const z of [-d/2, d/2]) addBox(m, `coping-${z}`, [w + 0.4, 0.08, 0.34], [0, spec.parapet + 0.04, z], MAT.stone, 0.015);
  } else if (spec.kind === 'mansard') {
    const topW = w * 0.58, topD = d * 0.58, y = rise;
    addBox(m, 'mansard-top', [topW, thick, topD], [0, y, 0], roofMat, 0.016);
    const sideSlope = Math.hypot((w-topW)/2, rise);
    const a = Math.atan2(rise, (w-topW)/2);
    for (const s of [-1,1]) addBox(m, `mansard-side-${s}`, [sideSlope, thick, d], [s*(w+topW)/4, rise/2, 0], roofMat, 0.018, [0,0,-s*a]);
    const endSlope = Math.hypot((d-topD)/2, rise);
    const b = Math.atan2(rise, (d-topD)/2);
    for (const s of [-1,1]) addBox(m, `mansard-end-${s}`, [topW, thick, endSlope], [0,rise/2,s*(d+topD)/4], roofMat, 0.018, [s*b,0,0]);
  } else if (spec.kind === 'hip') {
    const v = [[-w/2,0,-d/2],[w/2,0,-d/2],[w/2,0,d/2],[-w/2,0,d/2],[-w*.22,rise,0],[w*.22,rise,0]];
    mesh(m, 'hip-roof', v, [0,5,1,0,4,5,3,5,4,3,2,5,0,3,4,1,5,2], roofMat);
  }
  if (spec.seams && lod === 0) {
    if (spec.kind === 'gable') {
      const slope = Math.hypot(w / 2 + spec.overhang, rise);
      const angle = Math.atan2(rise, w / 2 + spec.overhang);
      const count = Math.max(4, Math.floor(d / 0.58));
      for (let i = 0; i <= count; i++) for (const side of [-1, 1]) {
        const z = -d / 2 + d * i / count;
        addBox(m, `standing-seam-${side}-${i}`, [slope, 0.032, 0.028], [side * (w / 4 + spec.overhang / 2), rise / 2 + 0.065, z], spec.capMat ?? MAT.dark, 0.004, [0, 0, -side * angle]);
      }
    } else if (spec.kind === 'shed') {
      const slope = Math.hypot(d + spec.overhang * 2, rise);
      const angle = Math.atan2(rise, d + spec.overhang * 2);
      const count = Math.max(4, Math.floor(w / 0.58));
      for (let i = 0; i <= count; i++) addBox(m, `standing-seam-${i}`, [0.028, 0.032, slope], [-w / 2 + w * i / count, rise / 2 + 0.065, 0], spec.capMat ?? MAT.dark, 0.004, [angle, 0, 0]);
    }
  }
  if (spec.chimney) {
    const [x,z] = spec.chimney;
    addBox(m, 'chimney-stack', [0.58, rise + 0.75, 0.48], [x, (rise + 0.75)/2, z], MAT.brick, 0.025);
    if (lod < 2) addBox(m, 'chimney-cap', [0.72, 0.12, 0.62], [x, rise + 0.78, z], MAT.stone, 0.02);
  }
  if (spec.dormer && lod < 2) {
    const [dx, dz] = spec.dormer;
    const bodyDepth = 1.7, bodyHeight = 1.35, bodyWidth = 1.5;
    const bodyY = 1.25 + bodyHeight / 2, faceX = dx + bodyDepth / 2;
    addBox(m, 'dormer-body', [bodyDepth, bodyHeight, bodyWidth], [dx, bodyY, dz], spec.gableMat ?? MAT.cream, 0.022);
    addBox(m, 'dormer-left-cheek', [bodyDepth + 0.08, bodyHeight + 0.04, 0.12], [dx, bodyY, dz - bodyWidth / 2], spec.gableMat ?? MAT.cream, 0.014);
    addBox(m, 'dormer-right-cheek', [bodyDepth + 0.08, bodyHeight + 0.04, 0.12], [dx, bodyY, dz + bodyWidth / 2], spec.gableMat ?? MAT.cream, 0.014);
    addBox(m, 'dormer-window', [0.045, 0.92, 1.02], [faceX + 0.075, 1.91, dz], MAT.glass, 0.006);
    addBox(m, 'dormer-window-left-jamb', [0.11, 1.08, 0.09], [faceX + 0.12, 1.91, dz - 0.56], MAT.paint, 0.01);
    addBox(m, 'dormer-window-right-jamb', [0.11, 1.08, 0.09], [faceX + 0.12, 1.91, dz + 0.56], MAT.paint, 0.01);
    addBox(m, 'dormer-window-head', [0.11, 0.09, 1.2], [faceX + 0.12, 2.45, dz], MAT.paint, 0.01);
    addBox(m, 'dormer-window-sill', [0.22, 0.1, 1.22], [faceX + 0.16, 1.39, dz], MAT.stone, 0.012);
    if (lod === 0) {
      addBox(m, 'dormer-window-vertical', [0.035, 0.92, 0.045], [faceX + 0.105, 1.91, dz], MAT.paint, 0.004);
      addBox(m, 'dormer-window-horizontal', [0.035, 0.045, 1.02], [faceX + 0.105, 1.92, dz], MAT.paint, 0.004);
    }
    addBox(m, 'dormer-cap', [2.15, 0.12, bodyWidth + 0.28], [dx - 0.02, 2.72, dz], roofMat, 0.018, [0, 0, -0.14]);
    if (lod === 0) for (const z of [dz - 0.48, dz, dz + 0.48]) addBox(m, `dormer-cap-seam-${z.toFixed(2)}`, [2.1, 0.025, 0.025], [dx - 0.02, 2.79, z], spec.capMat ?? MAT.dark, 0.004, [0, 0, -0.14]);
  }
  return m.group;
}

function makeFacade(spec, lod) {
  lod = clampLod(lod); const m = model(lod);
  const w = spec.w, h = spec.h, wall = spec.wall ?? MAT.brick;
  addBox(m, 'facade-wall', [w, h, 0.32], [0, h/2, -0.16], wall, 0.018);
  if (spec.kind === 'pilasters') {
    const count = spec.count ?? 4;
    for (let i=0;i<count;i++) {
      const x=-w/2+w*i/(count-1);
      addBox(m, `pilaster-${i}`, [0.34,h,0.3],[x,h/2,0.08],spec.trim??MAT.stone,0.026);
      if(lod<2){addBox(m,`capital-${i}`,[0.48,0.22,0.38],[x,h-0.16,0.12],spec.trim??MAT.stone,0.025);addBox(m,`base-${i}`,[0.46,0.26,0.4],[x,0.13,0.12],spec.trim??MAT.stone,0.025);}
    }
    addBox(m,'cornice',[w+0.22,0.28,0.48],[0,h-0.1,0.12],spec.trim??MAT.stone,0.03);
  } else if (spec.kind === 'cornice') {
    addBox(m,'frieze',[w,0.5,0.22],[0,h-0.28,0.08],spec.trim??MAT.stone,0.022);
    addBox(m,'cornice-main',[w+0.3,0.2,0.54],[0,h+0.04,0.16],spec.trim??MAT.stone,0.04);
    addBox(m,'cornice-shadow',[w+0.12,0.12,0.38],[0,h-0.12,0.12],MAT.dark,0.018);
    if(lod===0) for(let x=-w/2+0.25;x<w/2;x+=0.5) addBox(m,`dentil-${x.toFixed(2)}`,[0.2,0.16,0.16],[x,h-0.42,0.21],spec.trim??MAT.stone,0.014);
  } else if (spec.kind === 'balcony') {
    addBox(m,'balcony-slab',[spec.balconyW,0.16,spec.depth],[0,spec.y,spec.depth/2],MAT.concrete,0.025);
    if(lod<2){
      for(let x=-spec.balconyW/2;x<=spec.balconyW/2+0.01;x+=0.34) addBox(m,`rail-${x.toFixed(2)}`,[0.035,0.82,0.035],[x,spec.y+0.49,spec.depth-0.09],MAT.dark,0.005);
      addBox(m,'rail-top',[spec.balconyW+0.08,0.055,0.06],[0,spec.y+0.91,spec.depth-0.09],MAT.dark,0.01);
      for(const x of [-spec.balconyW*.38,spec.balconyW*.38]) m.pipe(`balcony-brace-${x}`,[[x,spec.y-0.65,0],[x,spec.y,spec.depth*.72]],0.04,MAT.dark);
    }
    addWindowUnit(m,{name:'balcony-opening',w:1.35,h:2.25,sill:spec.y+0.16,cols:2,rows:3,surround:spec.trim??MAT.stone},lod);
  } else if (spec.kind === 'bay') {
    const bw=spec.bayW, depth=spec.depth;
    addBox(m,'bay-body',[bw,h-0.45,depth],[0,(h-0.45)/2,depth/2],spec.trim??MAT.cream,0.028);
    for(const x of [-bw*.29,0,bw*.29]) addWindowUnit(m,{name:`bay-window-${x}`,w:bw*.22,h:1.35,sill:0.72,cols:1,rows:2,projection:depth,surround:spec.trim??MAT.cream},lod,x);
    addBox(m,'bay-crown',[bw+0.3,0.22,depth+0.24],[0,h-0.28,depth/2],spec.crown??MAT.copper,0.04);
  } else if (spec.kind === 'arcade') {
    const bays=spec.count??3, bw=w/bays;
    for(let i=0;i<bays;i++){
      const x=-w/2+bw*(i+.5);
      addBox(m,`arcade-opening-${i}`,[bw*.68,h*.64,0.12],[x,h*.33,0.08],MAT.dark,0.04);
      if(lod<2){
        const tor=m.torus(`arcade-arch-${i}`,bw*.34,0.11,[x,h*.64,0.19],spec.trim??MAT.stone,{rotation:[Math.PI/2,0,0],arc:Math.PI});tor.rotation.z=Math.PI;
      }
    }
    for(let i=0;i<=bays;i++) addBox(m,`arcade-pier-${i}`,[0.34,h*.7,0.42],[-w/2+bw*i,h*.35,0.1],spec.trim??MAT.stone,0.026);
    addBox(m,'arcade-stringcourse',[w,0.18,0.38],[0,h*.72,0.1],spec.trim??MAT.stone,0.02);
  } else if (spec.kind === 'fire-escape') {
    for(const y of [2.6,5.25]){
      addBox(m,`landing-${y}`,[w*.62,0.1,0.82],[0,y,0.38],MAT.galvanized,0.012);
      if(lod<2){addBox(m,`landing-rail-${y}`,[w*.62,0.06,0.06],[0,y+0.78,0.78],MAT.dark,0.008);for(let x=-w*.3;x<=w*.3;x+=.38)addBox(m,`rail-${y}-${x.toFixed(2)}`,[.035,.78,.035],[x,y+.4,.78],MAT.dark,.004);}
    }
    if(lod<2) for(let i=0;i<9;i++){const x=-w*.26+i*w*.52/8;addBox(m,`stair-tread-${i}`,[w*.2,.045,.62],[x,2.72+i*.28,.4],MAT.galvanized,.006,[0,0,-.58]);}
  } else if (spec.kind === 'loading-bay') {
    addDoorLeaf(m,{w:w*.62,h:h*.72,leaf:MAT.galvanized,surround:spec.trim??MAT.concrete,loading:true},lod,0,'loading-door');
    addBox(m,'dock-platform',[w*.82,.34,1.4],[0,.17,.62],MAT.concrete,.035);
    if(lod<2) addBox(m,'dock-canopy',[w*.82,.16,1.3],[0,h*.82,.58],MAT.roof,.035,[-.08,0,0]);
  }
  if(spec.band) addBox(m,'masonry-band',[w+.08,.16,.3],[0,spec.band,0.05],spec.trim??MAT.stone,.018);
  return m.group;
}

const windowSpecs = [
  ['window-double-hung','Double-hung sash window','Traditional recessed two-over-two sash with limestone sill.',{w:1.18,h:1.72,sill:.165,cols:2,rows:2,lintel:MAT.stone}],
  ['window-paired-sash','Paired commercial sash','Wide paired sash with central mullion and brick lintel.',{w:2.34,h:1.62,sill:.165,cols:4,rows:2,lintel:MAT.brick,surround:MAT.cream}],
  ['window-triple-ribbon','Three-part ribbon window','Three linked modern panes with deep continuous sill.',{kind:'ribbon',w:3.6,h:1.3,sill:.165,units:3,cols:1,rows:1,surround:MAT.concrete,frameMat:MAT.dark}],
  ['window-arched-masonry','Arched masonry window','Round-headed storefront loft window with stone hood.',{kind:'arched',w:1.45,h:2.2,sill:.165,cols:2,rows:3,surround:MAT.stone,frameMat:MAT.dark}],
  ['window-bay-copper','Copper-roof bay window','Projecting three-face residential bay with copper canopy.',{kind:'bay',w:2.7,h:1.65,sill:.68,depth:.72,cols:2,rows:2,apron:MAT.cream,canopy:MAT.copper}],
  ['window-craftsman','Craftsman divided-light window','Broad lower pane with divided upper transom and painted shutters.',{w:1.55,h:1.48,sill:.165,cols:3,rows:2,transom:true,shutters:true,surround:MAT.cream}],
  ['window-civic-pediment','Civic pediment window','Tall formal opening with heavy sill, lintel, and crown.',{w:1.42,h:2.12,sill:.165,cols:2,rows:3,pediment:true,lintel:MAT.stone,surround:MAT.stone}],
  ['window-industrial-steel','Industrial steel window','Large multi-light factory sash in a concrete surround.',{w:2.8,h:2.25,sill:.165,cols:5,rows:4,frame:.045,frameMat:MAT.dark,surround:MAT.concrete,sillMat:MAT.concrete}],
];

const doorSpecs = [
  ['door-residential-panel','Residential panel door','Four-panel painted entry door with masonry reveal.',{w:.94,h:2.12,panels:4,leaf:MAT.paint,surround:MAT.cream}],
  ['door-craftsman-glazed','Craftsman glazed door','Oak entry with a broad glazed upper panel and canopy.',{w:1.02,h:2.18,glazed:true,leaf:MAT.wood,frameMat:MAT.wood,canopy:MAT.copper}],
  ['door-commercial-glass','Commercial glass door','Dark aluminum full-glass shop entrance.',{w:.96,h:2.2,glazed:true,frameMat:MAT.dark,surround:MAT.dark}],
  ['door-double-civic','Civic double doors','Symmetrical paneled double entry with formal transom.',{kind:'double',w:2.06,h:2.35,panels:3,leaf:MAT.wood,transom:.55,surround:MAT.stone,hardware:MAT.copper}],
  ['door-double-storefront','Double storefront doors','Paired aluminum glass doors under a glazed transom.',{kind:'double',w:1.9,h:2.2,glazed:true,transom:.48,frameMat:MAT.dark,surround:MAT.dark}],
  ['door-rowhouse-entry','Rowhouse entry ensemble','Narrow paneled door with two sidelights and a small canopy.',{w:.92,h:2.28,panels:5,sidelights:true,canopy:MAT.roof,surround:MAT.stone}],
  ['door-loading-rollup','Loading roll-up door','Galvanized overhead door with slats and rubber dock bumpers.',{w:3.25,h:3.25,leaf:MAT.galvanized,surround:MAT.concrete,loading:true}],
  ['door-theater-marquee','Theater entrance doors','Wide glazed double entrance beneath a deep marquee.',{kind:'double',w:2.5,h:2.45,glazed:true,transom:.62,canopy:MAT.copper,frameMat:MAT.dark,surround:MAT.stone}],
];

const storefrontSpecs = [
  ['storefront-main-street','Main Street storefront','Three-bay recessed shopfront with stone piers and sign band.',{w:5.8,h:3.25,bays:3,recessDoor:true,doorX:0,sign:MAT.paint,wall:MAT.brick,pier:MAT.stone}],
  ['storefront-corner-shop','Corner shopfront','Wrapped corner glazing with a recessed side entry.',{w:5.2,h:3.15,bays:3,recessDoor:true,doorX:1.45,corner:true,wall:MAT.cream,pier:MAT.dark,header:MAT.dark}],
  ['storefront-striped-awning','Striped awning storefront','Broad display front beneath a rounded striped fabric awning.',{w:5.4,h:3,bays:4,recessDoor:true,doorX:-1.65,awning:MAT.paint,awningDepth:.86,wall:MAT.brick,pier:MAT.stone}],
  ['storefront-cafe','Neighborhood cafe front','Intimate two-bay cafe front with centered door and copper awning.',{w:4.25,h:2.85,bays:2,recessDoor:true,awning:MAT.copper,awningDepth:.7,bulk:.74,bulkMat:MAT.wood,wall:MAT.stucco}],
  ['storefront-department','Department store frontage','Large five-bay glazed frontage with strong limestone framing.',{w:8.2,h:3.7,bays:5,recessDoor:true,doorX:2.65,sign:MAT.stone,wall:MAT.brick,pier:MAT.stone,header:MAT.stone}],
  ['storefront-art-deco','Art Deco storefront','Symmetrical dark-metal shopfront with stepped cream sign band.',{w:5.7,h:3.45,bays:4,recessDoor:true,sign:MAT.cream,wall:MAT.stucco,pier:MAT.dark,header:MAT.cream,bulkMat:MAT.dark}],
  ['storefront-hardware','Hardware store front','Durable wide four-bay front with galvanized canopy.',{w:6.7,h:3.2,bays:4,recessDoor:true,doorX:-2.1,awning:MAT.galvanized,awningDepth:1.0,wall:MAT.brick,pier:MAT.concrete,bulkMat:MAT.brick}],
  ['storefront-pharmacy','Corner pharmacy front','Bright three-bay pharmacy facade with wraparound glazing and awning.',{w:6.1,h:3.35,bays:3,recessDoor:true,doorX:1.8,corner:true,awning:MAT.paint,sign:MAT.dark,wall:MAT.cream,pier:MAT.stone}],
];

const roofSpecs = [
  ['roof-gable-shingle','Shingle gable roof','Medium-pitch shingle roof with ridge cap and finished gable ends.',{kind:'gable',w:7.2,d:9,rise:2.15,overhang:.42,mat:MAT.shingle,gableMat:MAT.cream}],
  ['roof-gable-chimney','Gable roof with chimney','Traditional steep roof with offset brick chimney.',{kind:'gable',w:6.4,d:8.1,rise:2.65,overhang:.38,mat:MAT.shingle,gableMat:MAT.brick,chimney:[1.55,-1.2]}],
  ['roof-standing-seam','Standing-seam gable roof','Low gable in metal with pronounced vertical seams.',{kind:'gable',w:8.4,d:10,rise:1.72,overhang:.5,mat:MAT.roof,gableMat:MAT.cream,capMat:MAT.dark,seams:true}],
  ['roof-dormer-gable','Dormered gable roof','Deep shingle roof with a raised side-facing glazed dormer.',{kind:'gable',w:7.8,d:9.4,rise:2.5,overhang:.45,mat:MAT.shingle,gableMat:MAT.cream,dormer:[2,.8]}],
  ['roof-hip-craftsman','Craftsman hip roof','Broad low-pitch hipped roof for bungalow and civic forms.',{kind:'hip',w:9,d:8,rise:2.15,overhang:.55,mat:MAT.shingle}],
  ['roof-mansard-copper','Copper mansard roof','Compact four-sided mansard with flat upper deck.',{kind:'mansard',w:7.6,d:8.4,rise:2.25,overhang:.25,mat:MAT.copper}],
  ['roof-flat-parapet','Flat parapet roof','Commercial roof deck enclosed by brick parapets and stone coping.',{kind:'flat',w:9,d:10,rise:0,overhang:0,thick:.18,parapet:.76,mat:MAT.asphalt,gableMat:MAT.brick}],
  ['roof-shed-industrial','Industrial shed roof','Single-slope standing-seam roof with high rear fascia.',{kind:'shed',w:9.5,d:7.2,rise:1.55,overhang:.38,mat:MAT.galvanized,gableMat:MAT.concrete,seams:true}],
];

const facadeSpecs = [
  ['facade-brick-pilasters','Brick pilaster facade','Three-bay masonry wall articulated by limestone pilasters.',{kind:'pilasters',w:7.2,h:4.4,count:4,wall:MAT.brick,trim:MAT.stone,band:1.05}],
  ['facade-classical-cornice','Classical commercial cornice','Cream brick facade cap with layered cornice and dentils.',{kind:'cornice',w:8,h:2.1,wall:MAT.cream,trim:MAT.stone}],
  ['facade-iron-balcony','Iron balcony facade','Second-story masonry bay with deep slab and fine iron railing.',{kind:'balcony',w:5.6,h:5.4,wall:MAT.brick,trim:MAT.stone,balconyW:3.3,depth:1.05,y:2.55}],
  ['facade-bay-window','Full-height bay facade','Projecting multi-light bay with copper crown.',{kind:'bay',w:5.2,h:4.3,wall:MAT.brick,trim:MAT.cream,bayW:3.35,depth:.78,crown:MAT.copper}],
  ['facade-civic-arcade','Civic stone arcade','Three-arch ground-floor arcade with substantial piers.',{kind:'arcade',w:8.4,h:4.2,count:3,wall:MAT.cream,trim:MAT.stone,band:3.35}],
  ['facade-fire-escape','Fire escape facade','Two-level galvanized fire escape on a red brick wall.',{kind:'fire-escape',w:5.4,h:7.2,wall:MAT.brick}],
  ['facade-loading-bay','Warehouse loading bay','Concrete-framed roll-up dock with platform and steel canopy.',{kind:'loading-bay',w:6.4,h:4.6,wall:MAT.brick,trim:MAT.concrete}],
  ['facade-stucco-pilasters','Stucco civic pilasters','Formal stucco wall with five shallow stone pilasters and cornice.',{kind:'pilasters',w:9,h:5,count:5,wall:MAT.stucco,trim:MAT.stone,band:1.2}],
];

const asAssets = (category, specs, factory) => specs.map(([id,label,description,spec]) => ({
  id, label, category, description,
  sockets: category === 'roofs' ? [{ name: 'building-seat', position: [0,0,0] }] : [{ name: 'wall-anchor', position: [0,0,0] }],
  create(lod=0) { return factory(spec, lod); },
}));

export const assets = [
  ...asAssets('windows', windowSpecs, makeWindow),
  ...asAssets('doors', doorSpecs, makeDoor),
  ...asAssets('storefronts', storefrontSpecs, makeStorefront),
  ...asAssets('roofs', roofSpecs, makeRoof),
  ...asAssets('facades', facadeSpecs, makeFacade),
];
