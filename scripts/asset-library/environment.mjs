import { Model, THREE } from './kit.mjs';

const PI = Math.PI;
function build(lod, fn) {
  const m = new Model(lod);
  fn(m, Math.max(0, Math.min(2, lod | 0)));
  return m.group;
}

function asset(id, label, category, description, create, sockets) {
  return { id, label, category, description, ...(sockets ? { sockets } : {}), create };
}

function foliagePoint(theta, phi, radii, phase, target) {
  const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
  const latitudeFade = Math.pow(Math.max(0, sinTheta), 0.72);
  const broad = 0.095 * Math.cos(phi * 2 + phase) * Math.sin(theta * 2.35 + phase * 0.31);
  const middle = 0.052 * Math.sin(phi * 5 - theta * 3.1 + phase * 1.7);
  const fine = 0.024 * Math.cos(phi * 9 + theta * 7.0 - phase * 2.3);
  const radius = 1 + latitudeFade * (broad + middle) + latitudeFade * latitudeFade * fine;
  return target.set(
    -Math.cos(phi) * sinTheta * radii[0] * radius,
    cosTheta * radii[1] * radius,
    Math.sin(phi) * sinTheta * radii[2] * radius,
  );
}

function foliageLobe(m, name, radii, position, lod, phase) {
  const widthSegments = [28, 16, 8][lod], heightSegments = [18, 10, 6][lod];
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uvs = geometry.getAttribute('uv');
  const point = new THREE.Vector3(), thetaA = new THREE.Vector3(), thetaB = new THREE.Vector3();
  const phiA = new THREE.Vector3(), phiB = new THREE.Vector3(), normal = new THREE.Vector3();
  const averageRadius = (radii[0] + radii[1] + radii[2]) / 3;
  const epsilon = 0.001;
  for (let i = 0; i < positions.count; i++) {
    const theta = (1 - uvs.getY(i)) * PI;
    const phi = uvs.getX(i) * PI * 2;
    foliagePoint(theta, phi, radii, phase, point);
    positions.setXYZ(i, point.x, point.y, point.z);
    if (theta <= epsilon) normal.set(0, 1, 0);
    else if (theta >= PI - epsilon) normal.set(0, -1, 0);
    else {
      foliagePoint(theta + epsilon, phi, radii, phase, thetaA);
      foliagePoint(theta - epsilon, phi, radii, phase, thetaB);
      foliagePoint(theta, phi + epsilon, radii, phase, phiA);
      foliagePoint(theta, phi - epsilon, radii, phase, phiB);
      normal.copy(thetaA).sub(thetaB).cross(phiA.sub(phiB)).normalize();
    }
    normals.setXYZ(i, normal.x, normal.y, normal.z);
    // Metre-space UVs let the build pipeline apply the foliage material's physical tile size.
    uvs.setXY(i, phi * averageRadius, theta * averageRadius);
  }
  positions.needsUpdate = normals.needsUpdate = uvs.needsUpdate = true;
  geometry.userData.metreUV = true;
  const mesh = new THREE.Mesh(geometry, m.material('foliage'));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  m.add(mesh);
  return mesh;
}

function canopy(m, lobes, lod, material = 'foliage') {
  for (let i = 0; i < lobes.length; i++) {
    const [x, y, z, rx, ry, rz = rx] = lobes[i];
    if (material === 'foliage') foliageLobe(m, `canopy-${i}`, [rx, ry, rz], [x, y, z], lod, i * 1.731 + x * 0.37 + z * 0.19);
    else m.sphere(`canopy-${i}`, [rx, ry, rz], [x, y, z], material);
    if (lod === 0 && material === 'foliage' && Math.max(rx, ry, rz) >= 0.82) {
      const directions = [[0.78, 0.22, 0.34], [-0.48, 0.34, 0.72], [0.26, 0.48, -0.76]];
      for (let j = 0; j < 2; j++) {
        const [dx, dy, dz] = directions[(i + j) % directions.length];
        const scale = 0.3 + j * 0.045;
        foliageLobe(
          m,
          `canopy-${i}-edge-${j}`,
          [rx * scale, ry * scale * 0.86, rz * scale],
          [x + dx * rx * 0.78, y + dy * ry * 0.72, z + dz * rz * 0.78],
          lod,
          10.7 + i * 2.13 + j * 4.07,
        );
      }
    }
  }
}

function branch(m, name, points, radius, lod) {
  if (lod < 2) m.pipe(name, points, radius, 'bark');
}

function railRun(m, name, z, length, height, lod, x = 0) {
  m.cylinder(`${name}-top`, 0.035, 0.035, length, [x, height, z], 'metal-galvanized', {
    segments: lod === 0 ? 10 : 7,
    rotation: [0, 0, PI / 2],
  });
  if (lod < 2) {
    const posts = lod === 0 ? [-length / 2, -length / 6, length / 6, length / 2] : [-length / 2, 0, length / 2];
    for (const px of posts) m.cylinder(`${name}-post-${px}`, 0.035, 0.035, height, [x + px, height / 2, z], 'metal-galvanized', { segments: 8 });
  }
}

function panel(m, name, pos, size, rotation, lod) {
  m.box(name, size, pos, 'glass-blue', { bevel: 0.018, rotation });
  if (lod === 0) {
    const [x, y, z] = pos;
    const width = size[0];
    for (const dx of [-width / 4, 0, width / 4]) {
      m.box(`${name}-cell-${dx}`, [0.018, size[1] * 0.96, size[2] * 1.03], [x + dx, y, z], 'metal-dark', { bevel: 0.005, rotation });
    }
  }
}

function lathe(m, name, profile, material, segments, position = [0, 0, 0]) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const maxRadius = Math.max(...profile.map(([r]) => r));
  const ys = profile.map(([, y]) => y), height = Math.max(...ys) - Math.min(...ys);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * PI * 2 * maxRadius, uv.getY(i) * height);
  uv.needsUpdate = true;
  geometry.userData.metreUV = true;
  const mesh = new THREE.Mesh(geometry, m.material(material));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  m.add(mesh);
  return mesh;
}

const vegetation = [
  asset('tree-maple-street', 'Street Maple', 'vegetation', 'Mature broadleaf street tree with a raised crown and visible scaffold branches.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('trunk', 0.24, 0.34, 4.2, [0, 2.1, 0], 'bark', { segments: l === 0 ? 14 : 9 });
    branch(m, 'branch-left', [[0, 3.2, 0], [-0.75, 4.15, 0.15], [-1.25, 4.65, 0.05]], 0.13, l);
    branch(m, 'branch-right', [[0.05, 3.35, 0], [0.8, 4.25, 0.35], [1.25, 4.65, 0.5]], 0.12, l);
    branch(m, 'branch-back', [[0, 3.45, -0.05], [0.15, 4.35, -0.95]], 0.1, l);
    canopy(m, [[0, 5.35, 0, 1.65, 1.25, 1.5], [-1.25, 5.0, 0.1, 1.2, 1.0, 1.1], [1.2, 5.15, 0.45, 1.2, 1.0, 1.15], [0.2, 5.1, -1.0, 1.15, 0.95, 1.0], [-0.35, 6.15, 0.05, 1.15, 0.9, 1.05]], l);
  })),

  asset('tree-american-elm', 'American Elm', 'vegetation', 'Tall vase-form elm with a split trunk and arching upper canopy.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('trunk', 0.23, 0.38, 4.0, [0, 2, 0], 'bark', { segments: l === 0 ? 14 : 9 });
    branch(m, 'leader-a', [[0, 3.1, 0], [-0.45, 4.7, 0], [-1.25, 6.2, 0.25]], 0.15, l);
    branch(m, 'leader-b', [[0.05, 3.0, 0], [0.55, 4.8, 0.1], [1.35, 6.1, -0.15]], 0.15, l);
    branch(m, 'leader-c', [[0, 3.5, 0], [0, 5.2, -0.65]], 0.11, l);
    canopy(m, [[-1.35, 6.35, 0.2, 1.25, 1.35, 1.15], [1.35, 6.25, -0.15, 1.3, 1.4, 1.15], [0, 6.9, -0.4, 1.5, 1.25, 1.2], [-0.75, 7.25, 0.25, 1.2, 1.05, 1.1], [0.8, 7.2, 0.25, 1.1, 1.0, 1.0]], l);
  })),

  asset('tree-live-oak', 'Live Oak', 'vegetation', 'Low, spreading shade tree with a heavy trunk and horizontal branch structure.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('trunk', 0.34, 0.5, 3.0, [0, 1.5, 0], 'bark', { segments: l === 0 ? 16 : 10 });
    branch(m, 'limb-left', [[0, 2.15, 0], [-1.3, 3.05, 0.15], [-2.45, 3.25, 0.2]], 0.2, l);
    branch(m, 'limb-right', [[0.05, 2.25, 0], [1.3, 2.9, -0.2], [2.5, 3.3, -0.45]], 0.19, l);
    branch(m, 'limb-back', [[0, 2.45, 0], [-0.1, 3.2, -1.6]], 0.15, l);
    canopy(m, [[0, 4.1, 0, 2.0, 1.2, 1.65], [-2.0, 3.8, 0.2, 1.65, 1.0, 1.35], [2.05, 3.85, -0.4, 1.7, 1.0, 1.35], [0.1, 3.7, -1.45, 1.55, 0.95, 1.2], [-0.75, 4.8, 0.15, 1.45, 0.9, 1.2], [1.2, 4.65, 0, 1.25, 0.8, 1.0]], l);
  })),

  asset('tree-river-birch-clump', 'River Birch Clump', 'vegetation', 'Three-stem ornamental birch clump suited to parks and drainage edges.', (lod = 0) => build(lod, (m, l) => {
    const stems = l === 2 ? [[0, 0]] : [[-0.28, 0.08], [0.26, 0.12], [0.02, -0.25]];
    for (let i = 0; i < stems.length; i++) {
      const [x, z] = stems[i];
      m.cylinder(`stem-${i}`, 0.11, 0.19, 4.6 + i * 0.25, [x, 2.32 + i * 0.125, z], 'bark', { segments: l === 0 ? 11 : 7, rotation: [0, 0, (x * 0.14)] });
    }
    canopy(m, [[-0.6, 4.8, 0.1, 1.0, 1.15, 0.85], [0.6, 5.0, 0.1, 1.0, 1.25, 0.85], [0, 5.55, -0.35, 1.1, 1.2, 0.9], [-0.2, 4.65, -0.75, 0.85, 1.0, 0.75]], l);
  })),

  asset('tree-northern-pine', 'Northern Pine', 'vegetation', 'Layered conifer with a visible trunk, tapered crown, and branch whorls.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('trunk', 0.17, 0.32, 6.8, [0, 3.4, 0], 'bark', { segments: l === 0 ? 12 : 8 });
    const levels = l === 0 ? [[2.0, 1.65], [3.0, 1.45], [4.0, 1.2], [5.0, 0.92], [5.85, 0.62]] : l === 1 ? [[2.2, 1.55], [3.5, 1.25], [4.75, 0.9], [5.75, 0.58]] : [[2.4, 1.5], [4.1, 1.05], [5.55, 0.65]];
    for (let i = 0; i < levels.length; i++) {
      const [y, r] = levels[i];
      m.cylinder(`crown-${i}`, 0.05, r, 2.1, [0, y + 0.85, 0], 'foliage', { segments: l === 0 ? 18 : 10 });
    }
  })),

  asset('tree-flowering-ornamental', 'Flowering Ornamental', 'vegetation', 'Compact multi-stem flowering tree for plazas, entries, and medians.', (lod = 0) => build(lod, (m, l) => {
    const stems = l === 2 ? [[0, 0]] : [[-0.16, 0], [0.13, 0.1], [0, -0.16]];
    stems.forEach(([x, z], i) => m.cylinder(`stem-${i}`, 0.075, 0.13, 2.45, [x, 1.27, z], 'bark', { segments: 8, rotation: [0, 0, x * 0.22] }));
    canopy(m, [[0, 3.05, 0, 1.15, 0.8, 1.05], [-0.85, 2.85, 0.15, 0.75, 0.65, 0.7], [0.8, 2.9, 0.2, 0.75, 0.65, 0.7], [0, 2.9, -0.72, 0.8, 0.65, 0.65], [0, 3.65, 0.05, 0.75, 0.55, 0.7]], l);
  })),

  asset('shrub-boxwood-hedge', 'Boxwood Hedge', 'vegetation', 'Clipped modular hedge with softly rounded, overlapping plant masses.', (lod = 0) => build(lod, (m, l) => {
    const lobes = l === 0 ? [-1.65, -1.1, -0.55, 0, 0.55, 1.1, 1.65] : l === 1 ? [-1.5, -0.5, 0.5, 1.5] : [-1.15, 0, 1.15];
    for (const x of lobes) m.sphere(`hedge-${x}`, [0.62, 0.65, 0.58], [x, 0.65, 0], 'foliage');
  })),

  asset('shrub-native-cluster', 'Native Shrub Cluster', 'vegetation', 'Loose drought-tolerant shrub grouping with varied heights and natural spacing.', (lod = 0) => build(lod, (m, l) => {
    canopy(m, [[-0.85, 0.72, 0.25, 0.82, 0.72, 0.78], [0.05, 0.85, -0.1, 0.95, 0.85, 0.85], [0.9, 0.62, 0.2, 0.72, 0.62, 0.65], [-0.2, 0.58, 0.7, 0.72, 0.58, 0.62], [0.55, 0.58, -0.75, 0.68, 0.58, 0.62]], l);
    if (l === 0) for (const x of [-0.9, -0.35, 0.25, 0.82]) m.cylinder(`twig-${x}`, 0.025, 0.04, 0.65, [x, 0.33, 0], 'bark', { segments: 6 });
  })),

  asset('planter-street-tree', 'Street Tree Planter', 'vegetation', 'Large tapered concrete planter with soil, a young tree, and protective rim.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('planter', 0.78, 0.9, 0.72, [0, 0.36, 0], 'concrete', { segments: l === 0 ? 18 : 10 });
    m.cylinder('soil', 0.7, 0.7, 0.04, [0, 0.73, 0], 'soil', { segments: l === 0 ? 18 : 10 });
    if (l < 2) m.torus('rim', 0.79, 0.07, [0, 0.72, 0], 'limestone', { rotation: [PI / 2, 0, 0] });
    m.cylinder('trunk', 0.12, 0.17, 2.45, [0, 1.94, 0], 'bark', { segments: 9 });
    canopy(m, [[0, 3.4, 0, 0.92, 0.72, 0.85], [-0.62, 3.25, 0.12, 0.62, 0.55, 0.58], [0.6, 3.22, -0.05, 0.62, 0.55, 0.58], [0, 3.75, -0.25, 0.6, 0.5, 0.55]], l);
  })),

  asset('planter-raised-urban', 'Raised Urban Planter', 'vegetation', 'Rectangular masonry planter with layered ornamental grasses and shrubs.', (lod = 0) => build(lod, (m, l) => {
    m.box('planter-base', [3.2, 0.62, 1.15], [0, 0.31, 0], 'brick-cream', { bevel: 0.07 });
    m.box('soil', [2.92, 0.05, 0.88], [0, 0.65, 0], 'soil', { bevel: 0.01 });
    const plants = l === 0 ? [-1.15, -0.72, -0.25, 0.22, 0.68, 1.12] : l === 1 ? [-1.05, -0.35, 0.35, 1.05] : [-0.7, 0, 0.7];
    for (let i = 0; i < plants.length; i++) {
      const x = plants[i];
      m.sphere(`plant-${i}`, [0.38, 0.48 + (i % 2) * 0.14, 0.34], [x, 0.93 + (i % 2) * 0.07, (i % 3 - 1) * 0.18], 'foliage');
    }
  })),

  asset('wetland-reed-bed', 'Wetland Reed Bed', 'vegetation', 'Dense patch of tall reeds for bioswales, ponds, and drainage channels.', (lod = 0) => build(lod, (m, l) => {
    const count = l === 0 ? 18 : l === 1 ? 10 : 6;
    for (let i = 0; i < count; i++) {
      const x = ((i * 37) % 17) / 5 - 1.6;
      const z = ((i * 19) % 13) / 5 - 1.2;
      const h = 1.2 + ((i * 7) % 6) * 0.11;
      m.cylinder(`reed-${i}`, 0.018, 0.025, h, [x, h / 2, z], 'foliage', { segments: 5 });
      if (l === 0 && i % 2 === 0) m.cylinder(`seed-${i}`, 0.045, 0.035, 0.24, [x, h - 0.12, z], 'bark', { segments: 7 });
    }
  })),

  asset('median-ornamental-grass', 'Median Ornamental Grass', 'vegetation', 'Rhythmic clumps of arching ornamental grass for roadway medians.', (lod = 0) => build(lod, (m, l) => {
    const clumps = l === 2 ? [-1.05, 0, 1.05] : [-1.45, -0.72, 0, 0.72, 1.45];
    clumps.forEach((x, i) => {
      m.sphere(`grass-clump-${i}`, [0.48, 0.62, 0.42], [x, 0.62, 0], 'foliage');
      if (l === 0) for (const dz of [-0.2, 0, 0.2]) m.pipe(`blade-${i}-${dz}`, [[x, 0.18, dz], [x + dz * 0.8, 0.78, dz], [x + dz * 1.6, 1.1, dz * 1.25]], 0.014, 'foliage');
    });
  })),
];

const services = [
  asset('service-water-tank-ground', 'Ground Water Tank', 'services', 'Bolted municipal water tank with domed roof, access hatch, and ladder.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('tank-shell', 2.45, 2.45, 4.6, [0, 2.3, 0], 'metal-galvanized', { segments: l === 0 ? 28 : 14 });
    m.sphere('tank-roof', [2.48, 0.65, 2.48], [0, 4.55, 0], 'roof-metal');
    m.cylinder('roof-vent', 0.22, 0.28, 0.45, [0, 5.2, 0], 'metal-dark', { segments: 10 });
    if (l < 2) {
      m.box('ladder-left', [0.055, 4.1, 0.055], [-0.22, 2.2, 2.49], 'metal-dark');
      m.box('ladder-right', [0.055, 4.1, 0.055], [0.22, 2.2, 2.49], 'metal-dark');
      const rungs = l === 0 ? 11 : 6;
      for (let i = 0; i < rungs; i++) m.box(`rung-${i}`, [0.5, 0.045, 0.06], [0, 0.45 + i * 0.34, 2.52], 'metal-dark');
    }
  }), [{ name: 'inlet', position: [-2.55, 0.55, 0] }, { name: 'outlet', position: [2.55, 0.55, 0] }]),

  asset('service-water-tower-elevated', 'Elevated Water Tower', 'services', 'Classic municipal pedestal water tower with bowl tank and maintenance railing.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('pedestal', 0.58, 1.05, 7.0, [0, 3.5, 0], 'concrete', { segments: l === 0 ? 18 : 10 });
    lathe(m, 'tank-bowl', [
      [0, 0], [0.7, 0.06], [1.3, 0.18], [1.7, 0.45], [2.02, 0.85], [2.2, 1.3], [2.26, 1.85],
      [2.22, 2.35], [2.05, 2.75], [1.72, 3.03], [1.25, 3.23], [0.65, 3.37], [0, 3.45],
    ], 'metal-galvanized', l === 0 ? 48 : l === 1 ? 24 : 12, [0, 6.6, 0]);
    m.cylinder('cap', 0.14, 0.2, 0.52, [0, 10.3, 0], 'metal-dark', { segments: 8 });
    if (l === 0) {
      m.torus('catwalk', 2.22, 0.06, [0, 8.85, 0], 'metal-dark', { rotation: [PI / 2, 0, 0] });
      for (let i = 0; i < 12; i++) {
        const a = i * PI / 6;
        m.cylinder(`rail-${i}`, 0.025, 0.025, 0.7, [Math.cos(a) * 2.22, 9.18, Math.sin(a) * 2.22], 'metal-dark', { segments: 6 });
      }
    }
  }), [{ name: 'supply', position: [0, 0.1, 0] }]),

  asset('service-cooling-tower', 'Cooling Tower', 'services', 'Compact hyperbolic cooling tower with intake base, rim, and vapor outlet.', (lod = 0) => build(lod, (m, l) => {
    lathe(m, 'hyperbolic-shell', [
      [0, 0], [2.3, 0], [2.4, 0.45], [2.28, 1.0], [2.08, 1.7], [1.82, 2.6], [1.58, 3.6],
      [1.45, 4.5], [1.47, 5.15], [1.58, 5.85], [1.7, 6.35], [1.75, 6.6],
    ], 'concrete', l === 0 ? 40 : l === 1 ? 20 : 12);
    m.torus('top-rim', 1.73, 0.11, [0, 6.55, 0], 'metal-dark', { rotation: [PI / 2, 0, 0] });
    if (l === 0) for (let i = 0; i < 10; i++) {
      const a = i * PI / 5;
      m.box(`intake-${i}`, [0.62, 0.72, 0.12], [Math.cos(a) * 2.18, 0.52, Math.sin(a) * 2.18], 'metal-dark', { rotation: [0, -a, 0] });
    }
  }), [{ name: 'water-in', position: [-2.4, 0.5, 0] }, { name: 'water-out', position: [2.4, 0.5, 0] }]),

  asset('service-industrial-stack', 'Industrial Stack', 'services', 'Tapered steel exhaust stack with base plinth, safety bands, and service ladder.', (lod = 0) => build(lod, (m, l) => {
    m.box('foundation', [2.1, 0.38, 2.1], [0, 0.19, 0], 'concrete', { bevel: 0.08 });
    m.cylinder('stack', 0.55, 0.92, 9.5, [0, 5.1, 0], 'brick-red', { segments: l === 0 ? 20 : 12 });
    m.torus('base-ring', 0.9, 0.11, [0, 0.58, 0], 'metal-dark', { rotation: [PI / 2, 0, 0] });
    m.torus('top-ring', 0.55, 0.08, [0, 9.84, 0], 'metal-dark', { rotation: [PI / 2, 0, 0] });
    if (l < 2) {
      m.box('ladder', [0.42, 8.3, 0.06], [0, 5.15, 0.76], 'metal-dark', { bevel: 0.015 });
      if (l === 0) for (let y = 1.2; y < 9.2; y += 0.55) m.box(`rung-${y}`, [0.55, 0.035, 0.06], [0, y, 0.8], 'metal-galvanized');
    }
  }), [{ name: 'flue', position: [0, 0.65, -0.92] }]),

  asset('service-rooftop-hvac', 'Rooftop HVAC Unit', 'services', 'Packaged commercial air handler with fan shrouds, access panels, and curb base.', (lod = 0) => build(lod, (m, l) => {
    m.box('curb', [3.6, 0.28, 2.55], [0, 0.14, 0], 'metal-dark', { bevel: 0.035 });
    m.box('cabinet', [3.35, 1.55, 2.35], [0, 1.0, 0], 'metal-galvanized', { bevel: 0.08 });
    const fans = l === 2 ? [0] : [-0.85, 0.85];
    fans.forEach((x, i) => {
      m.cylinder(`fan-shroud-${i}`, 0.58, 0.58, 0.16, [x, 1.84, 0.25], 'metal-dark', { segments: l === 0 ? 20 : 10 });
      if (l === 0) {
        m.cylinder(`fan-hub-${i}`, 0.11, 0.11, 0.19, [x, 1.95, 0.25], 'metal-galvanized', { segments: 8 });
        for (let a = 0; a < 4; a++) m.box(`fan-blade-${i}-${a}`, [0.42, 0.025, 0.1], [x, 1.95, 0.25], 'metal-galvanized', { rotation: [0, a * PI / 2, 0] });
      }
    });
    if (l < 2) for (const x of [-1.1, 0, 1.1]) m.box(`panel-${x}`, [0.04, 1.05, 0.82], [x, 1.0, 1.19], 'metal-dark', { bevel: 0.01 });
  }), [{ name: 'supply', position: [-1.2, 0, 0] }, { name: 'return', position: [1.2, 0, 0] }]),

  asset('service-pad-transformer', 'Pad Transformer', 'services', 'Neighborhood electrical transformer with vented cabinet and concrete pad.', (lod = 0) => build(lod, (m, l) => {
    m.box('pad', [2.05, 0.18, 1.65], [0, 0.09, 0], 'concrete', { bevel: 0.035 });
    m.box('cabinet', [1.65, 1.45, 1.2], [0, 0.9, 0], 'metal-dark', { bevel: 0.11 });
    m.box('roof-lip', [1.76, 0.1, 1.3], [0, 1.65, 0], 'metal-galvanized', { bevel: 0.025 });
    if (l < 2) {
      m.box('door-seam', [0.035, 1.05, 0.04], [0, 0.93, 0.62], 'metal-galvanized');
      const vents = l === 0 ? 6 : 3;
      for (let i = 0; i < vents; i++) m.box(`vent-${i}`, [0.48, 0.035, 0.035], [-0.48 + (i % 2) * 0.96, 0.58 + Math.floor(i / 2) * 0.18, 0.64], 'metal-galvanized');
    }
  }), [{ name: 'conduit-left', position: [-0.55, 0.1, 0] }, { name: 'conduit-right', position: [0.55, 0.1, 0] }]),

  asset('service-pump-skid', 'Pump Skid', 'services', 'Twin centrifugal pump assembly on a steel skid with headers and drive housings.', (lod = 0) => build(lod, (m, l) => {
    m.box('skid', [4.2, 0.24, 2.0], [0, 0.12, 0], 'metal-dark', { bevel: 0.035 });
    const pumps = l === 2 ? [0] : [-1.05, 1.05];
    pumps.forEach((x, i) => {
      m.cylinder(`motor-${i}`, 0.42, 0.42, 1.35, [x, 0.78, -0.35], 'metal-galvanized', { segments: l === 0 ? 16 : 9, rotation: [0, 0, PI / 2] });
      m.sphere(`volute-${i}`, [0.48, 0.48, 0.35], [x, 0.72, 0.55], 'metal-dark');
      m.pipe(`outlet-${i}`, [[x, 0.85, 0.65], [x, 1.45, 0.65], [x, 1.45, 1.05]], 0.12, 'metal-copper');
    });
    m.pipe('suction-header', [[-2.35, 0.58, 0.58], [2.35, 0.58, 0.58]], 0.16, 'metal-galvanized');
  }), [{ name: 'inlet', position: [-2.35, 0.58, 0.58] }, { name: 'outlet', position: [2.35, 0.58, 0.58] }]),

  asset('service-solar-array', 'Solar Array', 'services', 'Four-panel fixed-tilt photovoltaic rack with galvanized support frame.', (lod = 0) => build(lod, (m, l) => {
    const xs = l === 2 ? [-1.2, 1.2] : [-1.8, -0.6, 0.6, 1.8];
    for (let i = 0; i < xs.length; i++) panel(m, `panel-${i}`, [xs[i], 1.55, 0], [1.08, 0.08, 2.05], [-0.42, 0, 0], l);
    for (const x of l === 0 ? [-1.8, -0.6, 0.6, 1.8] : [-1.2, 1.2]) {
      m.cylinder(`post-${x}`, 0.055, 0.065, 1.45, [x, 0.73, 0], 'metal-galvanized', { segments: 8 });
      if (l < 2) m.box(`foot-${x}`, [0.42, 0.12, 0.42], [x, 0.07, 0], 'concrete', { bevel: 0.03 });
    }
  }), [{ name: 'electrical', position: [0, 0.1, -1.05] }]),

  asset('service-rolloff-container', 'Rolloff Container', 'services', 'Open-top industrial waste container with sloped ends and reinforced side ribs.', (lod = 0) => build(lod, (m, l) => {
    m.box('floor', [4.8, 0.18, 2.1], [0, 0.35, 0], 'metal-dark', { bevel: 0.03 });
    m.box('left-wall', [4.8, 1.45, 0.12], [0, 1.0, -1.0], 'brick-red', { bevel: 0.025 });
    m.box('right-wall', [4.8, 1.45, 0.12], [0, 1.0, 1.0], 'brick-red', { bevel: 0.025 });
    m.box('front-wall', [0.14, 1.5, 2.05], [2.35, 1.0, 0], 'brick-red', { bevel: 0.025 });
    m.box('rear-wall', [0.14, 1.15, 2.05], [-2.35, 0.82, 0], 'brick-red', { bevel: 0.025 });
    if (l < 2) {
      const ribs = l === 0 ? [-1.8, -0.9, 0, 0.9, 1.8] : [-1.4, 0, 1.4];
      ribs.forEach((x) => {
        m.box(`rib-a-${x}`, [0.09, 1.35, 0.1], [x, 1.0, -1.08], 'metal-dark');
        m.box(`rib-b-${x}`, [0.09, 1.35, 0.1], [x, 1.0, 1.08], 'metal-dark');
      });
    }
    m.cylinder('roller-a', 0.16, 0.16, 0.28, [-2.15, 0.2, -0.9], 'metal-dark', { segments: 10, rotation: [PI / 2, 0, 0] });
    m.cylinder('roller-b', 0.16, 0.16, 0.28, [-2.15, 0.2, 0.9], 'metal-dark', { segments: 10, rotation: [PI / 2, 0, 0] });
  })),

  asset('service-backup-generator', 'Backup Generator', 'services', 'Weatherproof standby generator with radiator grille, exhaust, and fuel base.', (lod = 0) => build(lod, (m, l) => {
    m.box('fuel-base', [3.7, 0.42, 1.72], [0, 0.21, 0], 'metal-dark', { bevel: 0.07 });
    m.box('enclosure', [3.45, 1.65, 1.55], [0, 1.18, 0], 'metal-galvanized', { bevel: 0.11 });
    m.box('radiator', [0.08, 1.18, 1.15], [1.76, 1.2, 0], 'metal-dark', { bevel: 0.02 });
    m.pipe('exhaust', [[-1.1, 1.95, -0.35], [-1.1, 2.6, -0.35], [-0.72, 2.6, -0.35]], 0.09, 'metal-dark');
    if (l < 2) {
      const slats = l === 0 ? 8 : 4;
      for (let i = 0; i < slats; i++) m.box(`grille-${i}`, [0.04, 0.07, 1.0], [1.81, 0.82 + i * (0.82 / slats), 0], 'metal-galvanized');
      m.box('access-door', [1.15, 1.05, 0.035], [-0.4, 1.2, 0.79], 'metal-dark', { bevel: 0.015 });
    }
  }), [{ name: 'electrical', position: [-1.75, 0.35, 0] }]),

  asset('service-pipe-elbow', 'Large Pipe Elbow', 'services', 'Freestanding ninety-degree process pipe with concrete shoes and coupling bands.', (lod = 0) => build(lod, (m, l) => {
    m.box('foot-a', [0.9, 0.22, 0.9], [-1.55, 0.11, 0], 'concrete', { bevel: 0.05 });
    m.box('foot-b', [0.9, 0.22, 0.9], [1.55, 0.11, 0], 'concrete', { bevel: 0.05 });
    m.pipe('main-pipe', [[-2.15, 0.62, 0], [-1.0, 0.62, 0], [0.45, 0.72, 0], [1.45, 1.5, 0], [1.55, 2.8, 0]], 0.26, 'metal-galvanized');
    for (const x of l === 0 ? [-1.75, -0.55, 0.65] : [-1.6, 0.55]) m.torus(`band-${x}`, 0.29, 0.045, [x, 0.63 + (x > 0 ? 0.22 : 0), 0], 'metal-dark', { rotation: [0, PI / 2, 0] });
    m.torus('vertical-flange', 0.37, 0.09, [1.55, 2.82, 0], 'metal-dark', { rotation: [PI / 2, 0, 0] });
  }), [{ name: 'inlet', position: [-2.15, 0.62, 0] }, { name: 'outlet', position: [1.55, 2.82, 0] }]),

  asset('service-valve-manifold', 'Valve Manifold', 'services', 'Three-branch utility manifold with flanges, handwheels, and isolation valves.', (lod = 0) => build(lod, (m, l) => {
    m.pipe('header', [[-2.5, 0.75, 0], [2.5, 0.75, 0]], 0.18, 'metal-galvanized');
    const branches = l === 2 ? [0] : [-1.15, 0, 1.15];
    branches.forEach((x, i) => {
      m.pipe(`branch-${i}`, [[x, 0.75, 0], [x, 1.85, 0], [x, 1.85, 0.85]], 0.14, 'metal-copper');
      m.sphere(`valve-body-${i}`, [0.29, 0.25, 0.25], [x, 1.25, 0], 'metal-dark');
      if (l < 2) {
        m.cylinder(`stem-${i}`, 0.035, 0.035, 0.48, [x, 1.66, 0], 'metal-dark', { segments: 7 });
        m.torus(`wheel-${i}`, 0.28, 0.035, [x, 1.9, 0], 'brick-red', { rotation: [PI / 2, 0, 0] });
      }
    });
    m.box('support', [4.2, 0.18, 0.8], [0, 0.09, 0], 'concrete', { bevel: 0.035 });
  }), [{ name: 'inlet', position: [-2.5, 0.75, 0] }, { name: 'outlet', position: [2.5, 0.75, 0] }]),

  asset('service-industrial-catwalk', 'Industrial Catwalk', 'services', 'Modular elevated steel walkway with guardrails, braced legs, and stair access.', (lod = 0) => build(lod, (m, l) => {
    m.box('deck', [5.2, 0.18, 1.15], [0, 2.25, 0], 'metal-galvanized', { bevel: 0.025 });
    for (const x of [-2.25, 2.25]) {
      m.box(`leg-a-${x}`, [0.14, 2.25, 0.14], [x, 1.13, -0.42], 'metal-dark', { bevel: 0.015 });
      m.box(`leg-b-${x}`, [0.14, 2.25, 0.14], [x, 1.13, 0.42], 'metal-dark', { bevel: 0.015 });
    }
    railRun(m, 'rail-front', 0.54, 5.1, 3.25, l);
    railRun(m, 'rail-back', -0.54, 5.1, 3.25, l);
    m.box('stair-stringer-a', [3.05, 0.11, 0.1], [-3.72, 1.15, -0.42], 'metal-dark', { rotation: [0, 0, -0.65] });
    m.box('stair-stringer-b', [3.05, 0.11, 0.1], [-3.72, 1.15, 0.42], 'metal-dark', { rotation: [0, 0, -0.65] });
    if (l === 0) for (let i = 0; i < 7; i++) m.box(`step-${i}`, [0.55, 0.08, 1.0], [-5.0 + i * 0.42, 0.18 + i * 0.32, 0], 'metal-galvanized', { bevel: 0.01 });
  }), [{ name: 'deck-left', position: [-2.6, 2.35, 0] }, { name: 'deck-right', position: [2.6, 2.35, 0] }]),

  asset('service-battery-cabinet', 'Battery Cabinet Bank', 'services', 'Three outdoor energy-storage cabinets on a shared equipment pad.', (lod = 0) => build(lod, (m, l) => {
    m.box('pad', [4.4, 0.2, 1.65], [0, 0.1, 0], 'concrete', { bevel: 0.045 });
    const cabinets = l === 2 ? [0] : [-1.35, 0, 1.35];
    cabinets.forEach((x, i) => {
      m.box(`cabinet-${i}`, [1.08, 2.15, 1.18], [x, 1.28, 0], 'metal-galvanized', { bevel: 0.07 });
      m.box(`plinth-${i}`, [1.15, 0.18, 1.25], [x, 0.29, 0], 'metal-dark', { bevel: 0.025 });
      if (l < 2) {
        for (let j = 0; j < (l === 0 ? 5 : 3); j++) m.box(`vent-${i}-${j}`, [0.62, 0.035, 0.035], [x, 0.82 + j * 0.17, 0.61], 'metal-dark');
        m.box(`handle-${i}`, [0.045, 0.35, 0.045], [x + 0.36, 1.45, 0.63], 'metal-dark');
      }
    });
  }), [{ name: 'electrical', position: [0, 0.15, -0.82] }]),

  asset('service-substation-bay', 'Substation Bay', 'services', 'Compact distribution bay with insulators, bus bars, disconnects, and perimeter frame.', (lod = 0) => build(lod, (m, l) => {
    m.box('pad', [5.0, 0.18, 3.5], [0, 0.09, 0], 'concrete', { bevel: 0.035 });
    for (const x of [-2.1, 2.1]) for (const z of [-1.35, 1.35]) m.box(`frame-${x}-${z}`, [0.12, 3.2, 0.12], [x, 1.68, z], 'metal-dark', { bevel: 0.015 });
    m.box('top-front', [4.35, 0.12, 0.12], [0, 3.25, 1.35], 'metal-dark');
    m.box('top-back', [4.35, 0.12, 0.12], [0, 3.25, -1.35], 'metal-dark');
    const phases = l === 2 ? [0] : [-1.15, 0, 1.15];
    phases.forEach((x, i) => {
      m.cylinder(`insulator-${i}`, 0.13, 0.18, 1.55, [x, 1.05, 0], 'brick-cream', { segments: l === 0 ? 12 : 8 });
      if (l === 0) for (const y of [0.62, 0.9, 1.18, 1.46]) m.torus(`shed-${i}-${y}`, 0.23, 0.035, [x, y, 0], 'brick-cream', { rotation: [PI / 2, 0, 0] });
      m.box(`blade-${i}`, [0.08, 1.15, 0.08], [x, 2.1, 0], 'metal-copper', { rotation: [0, 0, -0.42] });
    });
    m.cylinder('bus', 0.06, 0.06, 4.25, [0, 2.82, 0], 'metal-copper', { segments: 8, rotation: [0, 0, PI / 2] });
  }), [{ name: 'line-left', position: [-2.5, 2.82, 0] }, { name: 'line-right', position: [2.5, 2.82, 0] }]),

  asset('service-fire-hydrant', 'Fire Hydrant', 'services', 'Municipal dry-barrel hydrant with side outlets, bonnet, and breakaway flange.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('barrel', 0.24, 0.29, 0.92, [0, 0.52, 0], 'brick-red', { segments: l === 0 ? 16 : 9 });
    m.torus('base-flange', 0.32, 0.075, [0, 0.13, 0], 'metal-dark', { rotation: [PI / 2, 0, 0] });
    m.sphere('bonnet', [0.34, 0.24, 0.34], [0, 1.05, 0], 'brick-red');
    m.cylinder('bonnet-nut', 0.09, 0.11, 0.13, [0, 1.26, 0], 'metal-dark', { segments: 6 });
    const sides = l === 2 ? [[0.28, 0]] : [[0.3, 0], [-0.3, 0]];
    sides.forEach(([x], i) => {
      m.cylinder(`outlet-${i}`, 0.16, 0.2, 0.34, [x, 0.73, 0], 'brick-red', { segments: 10, rotation: [0, 0, PI / 2] });
      m.cylinder(`cap-${i}`, 0.17, 0.17, 0.06, [x + Math.sign(x) * 0.18, 0.73, 0], 'metal-dark', { segments: 10, rotation: [0, 0, PI / 2] });
    });
  }), [{ name: 'water', position: [0, 0, 0] }]),

  asset('service-telecom-cabinet', 'Telecom Cabinet', 'services', 'Curbside communications cabinet with sun hood, vents, and cable pedestal.', (lod = 0) => build(lod, (m, l) => {
    m.box('pad', [1.65, 0.16, 1.2], [0, 0.08, 0], 'concrete', { bevel: 0.035 });
    m.box('cabinet', [1.28, 1.75, 0.82], [0, 1.03, 0], 'metal-galvanized', { bevel: 0.075 });
    m.box('hood', [1.38, 0.11, 0.95], [0, 1.94, -0.02], 'roof-metal', { bevel: 0.03 });
    if (l < 2) {
      m.box('door-seam', [0.035, 1.28, 0.035], [0, 1.05, 0.43], 'metal-dark');
      m.box('handle', [0.05, 0.28, 0.05], [0.42, 1.15, 0.45], 'metal-dark');
      for (let i = 0; i < (l === 0 ? 6 : 3); i++) m.box(`vent-${i}`, [0.55, 0.035, 0.035], [-0.32, 0.55 + i * 0.14, 0.44], 'metal-dark');
    }
    m.cylinder('cable-pedestal', 0.16, 0.2, 0.62, [-0.9, 0.31, 0], 'metal-dark', { segments: 10 });
  }), [{ name: 'conduit', position: [0, 0.08, 0] }]),

  asset('service-gas-regulator', 'Gas Regulator Station', 'services', 'Fenced-scale pressure regulator train with twin runs, gauges, and bypass piping.', (lod = 0) => build(lod, (m, l) => {
    m.box('pad', [4.5, 0.16, 2.2], [0, 0.08, 0], 'concrete', { bevel: 0.035 });
    const zs = l === 2 ? [0] : [-0.48, 0.48];
    zs.forEach((z, i) => {
      m.pipe(`run-${i}`, [[-2.25, 0.72, z], [-0.8, 0.72, z], [0, 1.05, z], [0.8, 0.72, z], [2.25, 0.72, z]], 0.12, 'metal-copper');
      m.sphere(`regulator-${i}`, [0.42, 0.34, 0.34], [0, 1.06, z], 'metal-dark');
      if (l < 2) {
        m.cylinder(`gauge-stem-${i}`, 0.025, 0.025, 0.32, [0.35, 1.45, z], 'metal-dark', { segments: 6 });
        m.cylinder(`gauge-${i}`, 0.13, 0.13, 0.06, [0.35, 1.62, z], 'brick-cream', { segments: 12, rotation: [PI / 2, 0, 0] });
      }
    });
  }), [{ name: 'inlet', position: [-2.25, 0.72, 0] }, { name: 'outlet', position: [2.25, 0.72, 0] }]),
];

const streets = [
  asset('street-bench-slat', 'Slatted Park Bench', 'streets', 'Oak-slat public bench with dark cast-metal end frames and armrests.', (lod = 0) => build(lod, (m, l) => {
    const slats = l === 0 ? [-0.42, -0.14, 0.14, 0.42] : l === 1 ? [-0.3, 0.3] : [0];
    slats.forEach((z, i) => m.box(`seat-slat-${i}`, [2.35, 0.1, 0.22], [0, 0.62, z], 'wood-oak', { bevel: 0.025 }));
    const backs = l === 0 ? [0.88, 1.14, 1.4] : [0.96, 1.34];
    backs.forEach((y, i) => m.box(`back-slat-${i}`, [2.35, 0.18, 0.09], [0, y, -0.5], 'wood-oak', { bevel: 0.025, rotation: [-0.12, 0, 0] }));
    for (const x of [-0.98, 0.98]) {
      m.pipe(`frame-${x}`, [[x, 0.08, 0.35], [x, 0.6, 0.35], [x, 0.72, -0.42], [x, 1.45, -0.5]], 0.055, 'metal-dark');
      if (l < 2) m.pipe(`arm-${x}`, [[x, 0.78, -0.36], [x, 0.92, 0.12], [x, 0.88, 0.42]], 0.045, 'metal-dark');
    }
  })),

  asset('street-bollard-row', 'Bollard Row', 'streets', 'Four removable streetscape bollards with contrasting cap bands.', (lod = 0) => build(lod, (m, l) => {
    const xs = l === 2 ? [-1.2, 1.2] : [-1.8, -0.6, 0.6, 1.8];
    xs.forEach((x, i) => {
      m.cylinder(`post-${i}`, 0.12, 0.15, 0.92, [x, 0.46, 0], 'metal-dark', { segments: l === 0 ? 14 : 8 });
      m.sphere(`cap-${i}`, [0.13, 0.09, 0.13], [x, 0.94, 0], 'metal-galvanized');
      if (l === 0) m.torus(`band-${i}`, 0.13, 0.025, [x, 0.73, 0], 'brick-cream', { rotation: [PI / 2, 0, 0] });
    });
  })),

  asset('street-lamp-cobra', 'Cobrahead Streetlight', 'streets', 'Galvanized roadway light with tapered mast, curved arm, and broad luminaire.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('pole', 0.11, 0.2, 7.1, [0, 3.55, 0], 'metal-galvanized', { segments: l === 0 ? 14 : 8 });
    m.box('base', [0.48, 0.22, 0.48], [0, 0.11, 0], 'concrete', { bevel: 0.045 });
    m.pipe('arm', [[0, 6.75, 0], [0, 7.35, 0.25], [0, 7.55, 1.25], [0, 7.45, 2.0]], 0.075, 'metal-galvanized');
    m.box('luminaire', [0.38, 0.2, 0.88], [0, 7.38, 2.22], 'metal-dark', { bevel: 0.08, rotation: [-0.08, 0, 0] });
    if (l < 2) m.box('lens', [0.3, 0.035, 0.7], [0, 7.27, 2.24], 'glass-blue', { bevel: 0.04, rotation: [-0.08, 0, 0] });
  }), [{ name: 'power', position: [0, 0, 0] }]),

  asset('street-lamp-heritage', 'Heritage Pedestrian Lamp', 'streets', 'Decorative pedestrian lamp with fluted base, crossbar, and twin lanterns.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('base', 0.24, 0.34, 0.75, [0, 0.38, 0], 'metal-dark', { segments: l === 0 ? 16 : 9 });
    m.cylinder('pole', 0.085, 0.13, 3.9, [0, 2.55, 0], 'metal-dark', { segments: 10 });
    m.box('crossbar', [1.75, 0.1, 0.1], [0, 4.3, 0], 'metal-dark', { bevel: 0.025 });
    const xs = l === 2 ? [0] : [-0.72, 0.72];
    xs.forEach((x, i) => {
      m.box(`lantern-${i}`, [0.38, 0.62, 0.38], [x, 3.92, 0], 'glass-blue', { bevel: 0.06 });
      m.cylinder(`cap-${i}`, 0.08, 0.27, 0.24, [x, 4.35, 0], 'metal-dark', { segments: 10 });
      m.cylinder(`finial-${i}`, 0.025, 0.05, 0.15, [x, 4.54, 0], 'metal-dark', { segments: 7 });
    });
  }), [{ name: 'power', position: [0, 0, 0] }]),

  asset('street-fence-picket', 'Steel Picket Fence', 'streets', 'Modular powder-coated picket fence panel with masonry-ready end posts.', (lod = 0) => build(lod, (m, l) => {
    const count = l === 0 ? 13 : l === 1 ? 7 : 4;
    for (let i = 0; i < count; i++) {
      const x = -2.7 + i * (5.4 / (count - 1));
      m.box(`picket-${i}`, [0.065, 1.55, 0.065], [x, 0.78, 0], 'metal-dark', { bevel: 0.01 });
      if (l === 0) m.cylinder(`tip-${i}`, 0, 0.09, 0.2, [x, 1.65, 0], 'metal-dark', { segments: 4 });
    }
    m.box('rail-low', [5.7, 0.08, 0.08], [0, 0.42, 0], 'metal-dark');
    m.box('rail-high', [5.7, 0.08, 0.08], [0, 1.3, 0], 'metal-dark');
    for (const x of [-2.92, 2.92]) m.box(`post-${x}`, [0.16, 1.8, 0.16], [x, 0.9, 0], 'metal-dark', { bevel: 0.018 });
  }), [{ name: 'left', position: [-3, 0, 0] }, { name: 'right', position: [3, 0, 0] }]),

  asset('street-fence-chainlink', 'Chain-Link Fence', 'streets', 'Utility fence panel with tubular posts, top rail, and open mesh suggestion.', (lod = 0) => build(lod, (m, l) => {
    for (const x of [-3, 0, 3]) m.cylinder(`post-${x}`, 0.06, 0.075, 2.15, [x, 1.08, 0], 'metal-galvanized', { segments: 8 });
    m.cylinder('top-rail', 0.045, 0.045, 6, [0, 2.05, 0], 'metal-galvanized', { segments: 8, rotation: [0, 0, PI / 2] });
    if (l < 2) {
      const diagonals = l === 0 ? [-2.7, -1.8, -0.9, 0, 0.9, 1.8, 2.7] : [-2.2, -0.75, 0.75, 2.2];
      diagonals.forEach((x, i) => m.box(`mesh-${i}`, [0.035, 2.25, 0.025], [x, 1.05, 0], 'metal-galvanized', { bevel: 0.005, rotation: [0, 0, i % 2 ? -0.62 : 0.62] }));
    }
  }), [{ name: 'left', position: [-3.1, 0, 0] }, { name: 'right', position: [3.1, 0, 0] }]),

  asset('street-bus-shelter', 'Bus Shelter', 'streets', 'Glass-and-steel transit shelter with roof canopy, bench, and route panel.', (lod = 0) => build(lod, (m, l) => {
    m.box('slab', [4.8, 0.16, 1.75], [0, 0.08, 0], 'concrete', { bevel: 0.035 });
    for (const x of [-2.05, 2.05]) m.box(`post-${x}`, [0.1, 2.65, 0.1], [x, 1.48, -0.55], 'metal-dark', { bevel: 0.015 });
    m.box('roof', [4.55, 0.18, 1.55], [0, 2.82, 0], 'roof-metal', { bevel: 0.07, rotation: [0, 0, -0.035] });
    m.box('rear-glass', [3.95, 2.15, 0.055], [0, 1.45, -0.62], 'glass-blue', { bevel: 0.02 });
    if (l < 2) {
      m.box('side-glass', [0.055, 2.15, 1.25], [-2.06, 1.45, 0], 'glass-blue', { bevel: 0.02 });
      m.box('bench-seat', [2.5, 0.12, 0.5], [0.45, 0.62, -0.22], 'wood-painted', { bevel: 0.035 });
      m.box('bench-leg-a', [0.1, 0.55, 0.1], [-0.45, 0.3, -0.22], 'metal-dark');
      m.box('bench-leg-b', [0.1, 0.55, 0.1], [1.35, 0.3, -0.22], 'metal-dark');
    }
    m.box('route-panel', [0.75, 1.75, 0.08], [1.55, 1.52, -0.56], 'brick-cream', { bevel: 0.025 });
  }), [{ name: 'curb-center', position: [0, 0, 0.95] }]),

  asset('street-curb-ramp', 'Accessible Curb Ramp', 'streets', 'Modular sidewalk corner ramp with flares and tactile warning panel.', (lod = 0) => build(lod, (m, l) => {
    m.box('sidewalk', [4.2, 0.32, 2.4], [0, 0.16, -0.4], 'concrete', { bevel: 0.035 });
    m.box('ramp', [1.65, 0.22, 1.55], [0, 0.175, 0.75], 'concrete', { bevel: 0.025, rotation: [-0.08, 0, 0] });
    m.box('tactile', [1.35, 0.055, 0.58], [0, 0.245, 1.22], 'brick-red', { bevel: 0.018, rotation: [-0.08, 0, 0] });
    if (l === 0) for (let x = -0.52; x <= 0.52; x += 0.26) for (let z = 1.04; z <= 1.38; z += 0.17) m.sphere(`dome-${x}-${z}`, [0.045, 0.022, 0.045], [x, 0.29, z], 'brick-red');
  }), [{ name: 'road-edge', position: [0, 0, 1.55] }]),

  asset('street-utility-cabinet', 'Street Utility Cabinet', 'streets', 'Compact signal and utility cabinet with vented door on a concrete footing.', (lod = 0) => build(lod, (m, l) => {
    m.box('footing', [1.3, 0.22, 0.92], [0, 0.11, 0], 'concrete', { bevel: 0.035 });
    m.box('cabinet', [1.0, 1.55, 0.7], [0, 0.98, 0], 'metal-galvanized', { bevel: 0.065 });
    m.box('rain-cap', [1.1, 0.09, 0.78], [0, 1.78, 0], 'roof-metal', { bevel: 0.025 });
    if (l < 2) {
      m.box('handle', [0.045, 0.28, 0.045], [0.32, 1.12, 0.37], 'metal-dark');
      for (let i = 0; i < (l === 0 ? 5 : 3); i++) m.box(`vent-${i}`, [0.45, 0.03, 0.025], [-0.2, 0.52 + i * 0.13, 0.36], 'metal-dark');
    }
  }), [{ name: 'conduit', position: [0, 0, 0] }]),

  asset('street-bike-rack', 'Inverted-U Bike Rack', 'streets', 'Bank of stainless inverted-U bicycle racks with surface-mount plates.', (lod = 0) => build(lod, (m, l) => {
    const xs = l === 2 ? [-0.8, 0.8] : [-1.5, -0.5, 0.5, 1.5];
    xs.forEach((x, i) => {
      m.torus(`hoop-${i}`, 0.48, 0.055, [x, 0.48, 0], 'metal-galvanized', { rotation: [0, PI / 2, 0], arc: PI });
      m.cylinder(`leg-a-${i}`, 0.055, 0.055, 0.48, [x, 0.24, -0.48], 'metal-galvanized', { segments: 8 });
      m.cylinder(`leg-b-${i}`, 0.055, 0.055, 0.48, [x, 0.24, 0.48], 'metal-galvanized', { segments: 8 });
      if (l === 0) {
        m.box(`plate-a-${i}`, [0.24, 0.035, 0.2], [x, 0.018, -0.48], 'metal-dark', { bevel: 0.015 });
        m.box(`plate-b-${i}`, [0.24, 0.035, 0.2], [x, 0.018, 0.48], 'metal-dark', { bevel: 0.015 });
      }
    });
  })),

  asset('street-signal-mast', 'Traffic Signal Mast Arm', 'streets', 'Urban mast-arm signal with three-section heads, pedestrian signal, and control base.', (lod = 0) => build(lod, (m, l) => {
    m.cylinder('mast', 0.13, 0.24, 6.2, [0, 3.1, 0], 'metal-galvanized', { segments: l === 0 ? 14 : 8 });
    m.box('base', [0.62, 0.28, 0.62], [0, 0.14, 0], 'concrete', { bevel: 0.05 });
    m.cylinder('arm', 0.09, 0.12, 6.0, [0, 5.9, 2.8], 'metal-galvanized', { segments: 9, rotation: [PI / 2, 0, 0] });
    const signals = l === 2 ? [4.8] : [2.5, 5.0];
    signals.forEach((z, i) => {
      m.box(`head-${i}`, [0.42, 1.18, 0.32], [0, 5.05, z], 'metal-dark', { bevel: 0.065 });
      if (l < 2) for (let j = 0; j < 3; j++) m.cylinder(`lens-${i}-${j}`, 0.12, 0.12, 0.035, [0, 5.42 - j * 0.36, z + 0.18], j === 0 ? 'brick-red' : j === 1 ? 'brick-cream' : 'foliage', { segments: 14, rotation: [PI / 2, 0, 0] });
    });
    if (l === 0) m.box('ped-head', [0.44, 0.52, 0.3], [0, 3.2, 0.34], 'metal-dark', { bevel: 0.05 });
  }), [{ name: 'power', position: [0, 0, 0] }, { name: 'road-center', position: [0, 0, 5.8] }]),

  asset('street-tree-grate', 'Tree Grate and Guard', 'streets', 'Square cast-iron tree grate with a protective three-ring trunk guard.', (lod = 0) => build(lod, (m, l) => {
    m.box('grate', [2.05, 0.08, 2.05], [0, 0.05, 0], 'metal-dark', { bevel: 0.035 });
    m.cylinder('trunk', 0.12, 0.17, 2.2, [0, 1.14, 0], 'bark', { segments: 9 });
    if (l < 2) {
      const rings = l === 0 ? [0.45, 0.9, 1.35] : [0.55, 1.2];
      rings.forEach((y, i) => m.torus(`guard-ring-${i}`, 0.5, 0.035, [0, y, 0], 'metal-dark', { rotation: [PI / 2, 0, 0] }));
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2;
        m.cylinder(`guard-post-${i}`, 0.03, 0.03, 1.45, [Math.cos(a) * 0.5, 0.73, Math.sin(a) * 0.5], 'metal-dark', { segments: 7 });
      }
    }
    canopy(m, [[0, 2.85, 0, 0.86, 0.68, 0.8], [-0.58, 2.72, 0.1, 0.58, 0.5, 0.55], [0.55, 2.74, -0.08, 0.58, 0.5, 0.55]], l);
  })),

  asset('street-newspaper-boxes', 'Street Publication Boxes', 'streets', 'Pair of sidewalk publication boxes with glazed fronts and pedestal bases.', (lod = 0) => build(lod, (m, l) => {
    const xs = l === 2 ? [0] : [-0.42, 0.42];
    xs.forEach((x, i) => {
      m.box(`pedestal-${i}`, [0.4, 0.68, 0.42], [x, 0.34, 0], 'metal-dark', { bevel: 0.04 });
      m.box(`box-${i}`, [0.68, 0.92, 0.62], [x, 1.0, 0], i % 2 ? 'brick-cream' : 'brick-red', { bevel: 0.09 });
      if (l < 2) {
        m.box(`window-${i}`, [0.46, 0.48, 0.035], [x, 1.12, 0.325], 'glass-blue', { bevel: 0.025 });
        m.box(`handle-${i}`, [0.26, 0.055, 0.045], [x, 0.75, 0.34], 'metal-dark', { bevel: 0.015 });
      }
    });
  })),
];

export const assets = [...vegetation, ...services, ...streets];
