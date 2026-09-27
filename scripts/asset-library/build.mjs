import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { THREE } from './kit.mjs';
import { assets as architecture } from './architecture.mjs';
import { assets as environment } from './environment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'public/asset-library');
const materialList = JSON.parse(await fs.readFile(path.join(out, 'textures/materials.json'), 'utf8'));
const materialMap = new Map(materialList.map(m => [m.id, m]));
const defs = [...architecture, ...environment].sort((a, b) => a.id.localeCompare(b.id));
if (new Set(defs.map(a => a.id)).size !== defs.length) throw new Error('Duplicate asset IDs');
await fs.mkdir(path.join(out, 'models'), { recursive: true });

function compile(group) {
  group.updateMatrixWorld(true);
  const batches = new Map();
  group.traverse(obj => {
    if (!obj.isMesh) return;
    if (Array.isArray(obj.material)) throw new Error(`Material array unsupported: ${obj.name}`);
    const id = obj.material.name;
    if (!materialMap.has(id)) throw new Error(`Missing material ${id}`);
    let geo = obj.geometry.clone();
    if (geo.index) { const old = geo; geo = geo.toNonIndexed(); old.dispose(); }
    geo.applyMatrix4(obj.matrixWorld);
    for (const key of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(key)) geo.deleteAttribute(key);
    if (!geo.attributes.normal || !geo.attributes.uv) throw new Error(`${obj.name} needs normal and uv`);
    if (obj.geometry.userData.metreUV) {
      const scale = materialMap.get(id).tileMeters ?? 1;
      const [u, v] = Array.isArray(scale) ? scale : [scale, scale];
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / u, uv.getY(i) / v);
    }
    if (!batches.has(id)) batches.set(id, []);
    batches.get(id).push(geo);
  });
  const merged = [];
  for (const [id, geos] of batches) {
    const geo = mergeGeometries(geos, false);
    if (!geo) throw new Error(`Cannot merge ${id}`);
    geos.forEach(g => g.dispose());
    merged.push({ id, geo });
  }
  return merged;
}

function exportGLTF(id, lod, batches) {
  const doc = {
    asset: { version: '2.0', generator: 'SLOPMERICA Civic Foundry 1.0' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: id, mesh: 0 }],
    meshes: [{ name: id, primitives: [] }], materials: [], textures: [], images: [],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    buffers: [{ uri: `${id}.lod${lod}.bin`, byteLength: 0 }], bufferViews: [], accessors: [],
    extras: { library: 'Civic Foundry', units: 'metres', up: '+Y', front: '+Z', lod },
  };
  let offset = 0;
  const chunks = [], box = new THREE.Box3();
  let triangles = 0;
  function imageTexture(filename) {
    const source = doc.images.push({ uri: `../textures/${filename}` }) - 1;
    return doc.textures.push({ sampler: 0, source }) - 1;
  }
  function attribute(attr, type, bounds = false) {
    // All geometry data is little-endian IEEE float32. No browser shim required.
    const values = new Float32Array(attr.count * attr.itemSize);
    const min = Array(attr.itemSize).fill(Infinity), max = min.map(() => -Infinity);
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) {
      const v = attr.array[i * attr.itemSize + c];
      if (!Number.isFinite(v)) throw new Error(`${id}: non-finite geometry`);
      values[i * attr.itemSize + c] = v;
      min[c] = Math.min(min[c], v); max[c] = Math.max(max[c], v);
    }
    const data = Buffer.from(values.buffer);
    const bufferView = doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target: 34962 }) - 1;
    chunks.push(data); offset += data.length;
    return doc.accessors.push({ bufferView, componentType: 5126, count: attr.count, type, ...(bounds ? { min, max } : {}) }) - 1;
  }
  for (const { id: materialId, geo } of batches) {
    const m = materialMap.get(materialId);
    const color = imageTexture(m.albedo), normal = imageTexture(m.normal), orm = imageTexture(m.orm);
    const material = doc.materials.push({
      name: materialId,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: color }, metallicRoughnessTexture: { index: orm }, roughnessFactor: 1, metallicFactor: 1 },
      normalTexture: { index: normal, scale: m.normalScale ?? .45 },
      occlusionTexture: { index: orm, texCoord: 0, strength: .45 },
      doubleSided: false,
      extras: { surface: m.description, tileMeters: m.tileMeters },
    }) - 1;
    const p = geo.attributes.position;
    triangles += p.count / 3;
    geo.computeBoundingBox(); box.union(geo.boundingBox);
    const attributes = {
      POSITION: attribute(p, 'VEC3', true),
      NORMAL: attribute(geo.attributes.normal, 'VEC3'),
      TEXCOORD_0: attribute(geo.attributes.uv, 'VEC2'),
    };
    doc.meshes[0].primitives.push({ attributes, material, mode: 4 });
  }
  const bin = Buffer.concat(chunks); doc.buffers[0].byteLength = bin.length;
  return { doc, bin, triangles, drawCalls: batches.length, bounds: { min: box.min.toArray(), max: box.max.toArray() } };
}

const assets = [];
for (const def of defs) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(def.id)) throw new Error(`Invalid ID ${def.id}`);
  const lods = [];
  let bounds, materials;
  for (let lod = 0; lod < 3; lod++) {
    const model = def.create(lod);
    const batches = compile(model);
    const result = exportGLTF(def.id, lod, batches);
    const filename = `${def.id}.lod${lod}`;
    await fs.writeFile(path.join(out, 'models', `${filename}.gltf`), JSON.stringify(result.doc));
    await fs.writeFile(path.join(out, 'models', `${filename}.bin`), result.bin);
    lods.push({ level: lod, url: `models/${filename}.gltf`, triangles: result.triangles, drawCalls: result.drawCalls, bufferBytes: result.bin.length, sha256: createHash('sha256').update(result.bin).digest('hex') });
    if (!lod) { bounds = result.bounds; materials = batches.map(b => b.id); }
    batches.forEach(b => b.geo.dispose());
    model.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
  assets.push({ id: def.id, label: def.label, category: def.category, description: def.description, style: def.style ?? 'American civic / contemporary vernacular', bounds, dimensions: bounds.max.map((n, i) => +(n - bounds.min[i]).toFixed(4)), materials, sockets: def.sockets ?? [], lods });
}
const manifest = {
  schemaVersion: 1, name: 'Civic Foundry', version: '1.0.0',
  description: 'Original modular architecture, streetscape, service structures and vegetation for SLOPMERICA.',
  units: 'metres', upAxis: '+Y', frontAxis: '+Z', anchor: 'bottom-centre; wall modules mount at their documented depth',
  textureConvention: 'albedo sRGB; normal OpenGL +Y; ORM linear R=occlusion G=roughness B=metalness',
  provenance: 'Original procedural models and textures authored for this repository. No third-party art or downloaded models.',
  materials: materialList.map(m => ({ ...m, albedo: `textures/${m.albedo}`, normal: `textures/${m.normal}`, orm: `textures/${m.orm}` })),
  assets,
};
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Civic Foundry: ${assets.length} assets, ${assets.length * 3} glTF models, ${materialList.length} PBR materials.`);
console.log(`LOD0 triangles: ${assets.reduce((n,a) => n + a.lods[0].triangles, 0).toLocaleString()}; geometry ${(assets.reduce((n,a) => n + a.lods.reduce((s,l) => s + l.bufferBytes, 0), 0)/1024/1024).toFixed(1)} MiB.`);
