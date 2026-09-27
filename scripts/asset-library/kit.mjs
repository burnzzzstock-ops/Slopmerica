import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
export { THREE };

// Shared dimensions are metres; Y is up, +Z is the street-facing side.
// Original Civic Foundry kit: neutral architectural materials, no licensed assets.
export const palette = {
  'brick-red': [0x995c48, .86, 0], 'brick-cream': [0xc3b193, .87, 0],
  'stucco-ivory': [0xded8c8, .88, 0], concrete: [0xaaa89f, .88, 0],
  limestone: [0xd6ccb6, .82, 0], asphalt: [0x45474b, .96, 0],
  'roof-shingle': [0x4d565c, .90, 0], 'roof-metal': [0x698184, .44, .75],
  'wood-oak': [0x99754d, .72, 0], 'wood-painted': [0xd3d5c9, .67, 0],
  'metal-dark': [0x303b42, .46, .9], 'metal-galvanized': [0xa7b1b5, .42, 1],
  'metal-copper': [0x749183, .58, .8], 'glass-blue': [0x527381, .16, .15],
  foliage: [0x536b3b, .90, 0], bark: [0x69523c, .92, 0],
  soil: [0x6e5943, .98, 0], rubber: [0x24292a, .97, 0],
};

const materials = new Map();
function getMaterial(id) {
  if (!palette[id]) throw new Error(`Unknown Civic Foundry material: ${id}`);
  if (!materials.has(id)) {
    const [color, roughness, metalness] = palette[id];
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    mat.name = id;
    materials.set(id, mat);
  }
  return materials.get(id);
}

/** Metre-space UVs for box faces: the exporter applies each material's tile size. */
function boxUV(geometry) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(n.getX(i)), y = Math.abs(n.getY(i)), z = Math.abs(n.getZ(i));
    if (y >= x && y >= z) uv.setXY(i, p.getX(i), -p.getZ(i));
    else if (x >= z) uv.setXY(i, -p.getZ(i) * Math.sign(n.getX(i)), p.getY(i));
    else uv.setXY(i, p.getX(i) * Math.sign(n.getZ(i)), p.getY(i));
  }
  geometry.userData.metreUV = true;
  return geometry;
}

export class Model {
  constructor(lod = 0) { this.lod = lod; this.group = new THREE.Group(); }
  material(id) { return getMaterial(id); }
  add(obj) { this.group.add(obj); return obj; }
  mesh(name, geometry, pos, material, options = {}) {
    const obj = new THREE.Mesh(geometry, this.material(material));
    obj.name = name; obj.position.fromArray(pos);
    if (options.rotation) obj.rotation.fromArray(options.rotation);
    obj.castShadow = obj.receiveShadow = true;
    this.group.add(obj); return obj;
  }
  box(name, size, pos, material, options = {}) {
    if (size.some(v => !Number.isFinite(v) || v <= 0)) throw new Error(`Invalid box ${name}`);
    const bevel = this.lod === 0 ? Math.min(options.bevel ?? .025, Math.min(...size) * .24) : 0;
    const geo = bevel > .001 ? new RoundedBoxGeometry(...size, 1, bevel) : new THREE.BoxGeometry(...size);
    return this.mesh(name, boxUV(geo), pos, material, options);
  }
  cylinder(name, top, bottom, height, pos, material, options = {}) {
    const segments = Math.max(6, Math.round((options.segments ?? 32) / [1, 2, 4][this.lod]));
    const geo = new THREE.CylinderGeometry(top, bottom, height, segments, 1, false);
    const uv = geo.getAttribute('uv');
    const circumference = Math.PI * 2 * Math.max(top, bottom);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circumference, uv.getY(i) * height);
    geo.userData.metreUV = true;
    return this.mesh(name, geo, pos, material, options);
  }
  sphere(name, radii, pos, material) {
    const geo = new THREE.SphereGeometry(1, [24, 16, 8][this.lod], [16, 10, 6][this.lod]);
    geo.scale(...radii);
    const uv = geo.getAttribute('uv');
    const width = Math.PI * (radii[0] + radii[2]);
    const height = Math.PI * radii[1];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width, uv.getY(i) * height);
    geo.userData.metreUV = true;
    return this.mesh(name, geo, pos, material);
  }
  torus(name, radius, tube, pos, material, options = {}) {
    return this.mesh(name, new THREE.TorusGeometry(radius, tube, [8, 6, 4][this.lod], [40, 24, 12][this.lod], options.arc ?? Math.PI * 2), pos, material, options);
  }
  pipe(name, points, radius, material) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    return this.mesh(name, new THREE.TubeGeometry(curve, Math.max(4, points.length * [6, 3, 1][this.lod]), radius, [12, 8, 6][this.lod], false), [0, 0, 0], material);
  }
}
