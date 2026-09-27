// Pack the Civic Foundry assets the game places (street furniture, service
// equipment, street trees and planters) into one binary the game streams in:
// public/civic/pack.json + pack.bin, plus the material maps they use in
// public/civic/textures. LOD1 and LOD2 only (LOD0 is for the catalog).
// Per vertex: position float32 x3, normal int8 x4 (normalised), uv float32 x2.
// node scripts/civic-pack.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const LIB = 'public/asset-library';
const OUT = 'public/civic';
const IDS = [
  // street furniture
  'street-bench-slat', 'street-bike-rack', 'street-bollard-row', 'street-bus-shelter', 'street-newspaper-boxes',
  'street-utility-cabinet', 'street-tree-grate', 'planter-raised-urban', 'planter-street-tree',
  // service equipment
  'service-backup-generator', 'service-battery-cabinet', 'service-cooling-tower', 'service-gas-regulator', 'service-pad-transformer',
  'service-pump-skid', 'service-rolloff-container', 'service-rooftop-hvac', 'service-solar-array', 'service-substation-bay',
  'service-telecom-cabinet', 'service-valve-manifold', 'service-water-tank-ground', 'service-industrial-stack', 'service-pipe-elbow',
  // trees and planting
  'tree-maple-street', 'tree-american-elm', 'tree-flowering-ornamental', 'tree-live-oak', 'shrub-boxwood-hedge', 'shrub-native-cluster',
  'median-ornamental-grass',
];
const LODS = [1, 2];

const manifest = JSON.parse(readFileSync(join(LIB, 'manifest.json'), 'utf8'));
const byId = new Map(manifest.assets.map((a) => [a.id, a]));
const chunks = [];
let offset = 0;
const push = (buf) => {
  // 4-byte aligned
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  chunks.push(buf);
  const at = offset;
  offset += buf.length;
  return at;
};
const usedMats = new Set();
const assets = {};
let tris = 0;
for (const id of IDS) {
  const a = byId.get(id);
  if (!a) throw new Error(`no asset ${id}`);
  const out = { label: a.label, category: a.category, bounds: a.bounds, dims: a.dimensions, lods: [] };
  for (const level of LODS) {
    const lod = a.lods.find((l) => l.level === level);
    if (!lod) continue;
    const gpath = join(LIB, lod.url);
    const gltf = JSON.parse(readFileSync(gpath, 'utf8'));
    const bin = readFileSync(join(dirname(gpath), gltf.buffers[0].uri));
    const acc = (i) => {
      const A = gltf.accessors[i], bv = gltf.bufferViews[A.bufferView];
      const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[A.type];
      if (A.componentType !== 5126) throw new Error(`${id}: accessor ${i} is not float`);
      const start = (bv.byteOffset ?? 0) + (A.byteOffset ?? 0);
      return new Float32Array(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + A.count * n * 4));
    };
    const prims = [];
    for (const mesh of gltf.meshes) for (const p of mesh.primitives) {
      if (p.indices !== undefined) throw new Error(`${id}: indexed primitive`);
      const mat = gltf.materials[p.material].name;
      usedMats.add(mat);
      const pos = acc(p.attributes.POSITION), nrm = acc(p.attributes.NORMAL), uv = acc(p.attributes.TEXCOORD_0);
      const count = pos.length / 3;
      const n8 = new Int8Array(count * 4);
      for (let k = 0; k < count; k++) for (let c = 0; c < 3; c++) n8[k * 4 + c] = Math.max(-127, Math.min(127, Math.round(nrm[k * 3 + c] * 127)));
      prims.push({ mat, count, pos: push(Buffer.from(pos.buffer)), nrm: push(Buffer.from(n8.buffer)), uv: push(Buffer.from(uv.buffer)) });
      tris += count / 3;
    }
    out.lods.push({ level, prims });
  }
  assets[id] = out;
}
mkdirSync(join(OUT, 'textures'), { recursive: true });
const materials = manifest.materials.filter((m) => usedMats.has(m.id)).map((m) => {
  for (const k of ['albedo', 'normal', 'orm']) {
    const src = join(LIB, m[k]);
    if (!existsSync(src)) throw new Error(`missing ${src}`);
    copyFileSync(src, join(OUT, m[k]));
  }
  return { id: m.id, albedo: m.albedo, normal: m.normal, orm: m.orm, roughness: m.roughness, metalness: m.metalness, normalScale: m.normalScale };
});
const bin = Buffer.concat(chunks);
writeFileSync(join(OUT, 'pack.bin'), bin);
writeFileSync(join(OUT, 'pack.json'), JSON.stringify({ version: 1, source: `${manifest.name} ${manifest.version}`, bytes: bin.length, materials, assets }));
console.log(`packed ${IDS.length} assets, ${materials.length} materials, ${Math.round(tris)} triangles (LOD1+2), ${(bin.length / 2 ** 20).toFixed(2)} MiB`);
