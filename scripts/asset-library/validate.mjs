#!/usr/bin/env node
/** Dependency-free integrity validator for the generated Civic Foundry library. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const argRoot = process.argv.indexOf('--root');
const root = path.resolve(argRoot >= 0 ? process.argv[argRoot + 1] : path.join(repoRoot, 'public/asset-library'));
const errors = [];
const warnings = [];
const stats = { assets: 0, models: 0, materials: 0, triangles: [0, 0, 0], binaryBytes: 0, vertexCount: 0, pngs: 0 };

const EXPECTED_CATEGORIES = ['windows', 'doors', 'storefronts', 'roofs', 'facades', 'vegetation', 'services', 'streets'];
const EXPECTED_MATERIALS = [
  'brick-red', 'brick-cream', 'stucco-ivory', 'concrete', 'limestone', 'asphalt',
  'roof-shingle', 'roof-metal', 'wood-oak', 'wood-painted', 'metal-dark',
  'metal-galvanized', 'metal-copper', 'glass-blue', 'foliage', 'bark', 'soil', 'rubber',
];
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(scope, message) { errors.push(`${scope}: ${message}`); }
function warn(scope, message) { warnings.push(`${scope}: ${message}`); }
function finiteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
function approx(a, b, epsilon = 1e-4) { return Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b)); }

async function readJson(filename, scope) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { fail(scope, `cannot read valid JSON at ${path.relative(root, filename) || filename}: ${error.message}`); return null; }
}

/** Resolve a local URI and prove it stays under the library root. */
function localUri(baseDir, uri, scope) {
  if (typeof uri !== 'string' || !uri) { fail(scope, 'missing file URI'); return null; }
  let decoded;
  try { decoded = decodeURIComponent(uri.split(/[?#]/, 1)[0]); }
  catch { fail(scope, `malformed URI ${JSON.stringify(uri)}`); return null; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || path.isAbsolute(decoded) || decoded.startsWith('\\\\')) {
    fail(scope, `non-local URI is forbidden: ${uri}`); return null;
  }
  const target = path.resolve(baseDir, decoded);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(scope, `URI escapes library root: ${uri}`); return null;
  }
  return target;
}

async function regularFile(filename, scope) {
  if (!filename) return null;
  try {
    const result = await fs.stat(filename);
    if (!result.isFile()) fail(scope, `${path.relative(root, filename)} is not a regular file`);
    return result;
  } catch (error) {
    fail(scope, `missing ${path.relative(root, filename)} (${error.code ?? error.message})`);
    return null;
  }
}

async function pngInfo(filename, scope) {
  const stat = await regularFile(filename, scope);
  if (!stat) return null;
  if (stat.size < 33) { fail(scope, 'PNG is truncated'); return null; }
  const handle = await fs.open(filename, 'r');
  try {
    const header = Buffer.alloc(33);
    await handle.read(header, 0, header.length, 0);
    if (!header.subarray(0, 8).equals(PNG_SIGNATURE) || header.toString('ascii', 12, 16) !== 'IHDR') {
      fail(scope, 'file is not a PNG with an IHDR header'); return null;
    }
    const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
    if (!width || !height) fail(scope, `invalid PNG dimensions ${width}x${height}`);
    stats.pngs++;
    return { width, height, bitDepth: header[24], colorType: header[25] };
  } finally { await handle.close(); }
}

function uniqueValues(items, key, scope) {
  const seen = new Set();
  for (const item of items) {
    const value = item?.[key];
    if (typeof value !== 'string' || !value) fail(scope, `entry has invalid ${key}`);
    else if (seen.has(value)) fail(scope, `duplicate ${key} ${value}`);
    else seen.add(value);
  }
  return seen;
}

function readComponent(view, offset, componentType) {
  switch (componentType) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: return NaN;
  }
}

function accessorValues(doc, buffers, index, scope) {
  const accessor = doc.accessors?.[index];
  if (!accessor) { fail(scope, `accessor ${index} does not exist`); return null; }
  const components = TYPE_SIZE[accessor.type], bytes = COMPONENT_SIZE[accessor.componentType];
  if (!components || !bytes) { fail(scope, `accessor ${index} has unsupported type/componentType`); return null; }
  if (!Number.isInteger(accessor.count) || accessor.count < 0) { fail(scope, `accessor ${index} has invalid count`); return null; }
  if (accessor.sparse) { fail(scope, `sparse accessor ${index} is unsupported by this library contract`); return null; }
  const bufferView = doc.bufferViews?.[accessor.bufferView];
  if (!bufferView) { fail(scope, `accessor ${index} references missing bufferView`); return null; }
  const buffer = buffers[bufferView.buffer];
  if (!buffer) { fail(scope, `accessor ${index} references unavailable buffer`); return null; }
  const packed = components * bytes, stride = bufferView.byteStride ?? packed;
  if (!Number.isInteger(stride) || stride < packed) { fail(scope, `accessor ${index} has invalid byteStride ${stride}`); return null; }
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = accessor.count ? start + (accessor.count - 1) * stride + packed : start;
  const viewEnd = (bufferView.byteOffset ?? 0) + bufferView.byteLength;
  if (start < 0 || end > viewEnd || end > buffer.length) {
    fail(scope, `accessor ${index} range ${start}..${end} exceeds its buffer view or buffer`); return null;
  }
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const values = new Float64Array(accessor.count * components);
  for (let row = 0; row < accessor.count; row++) for (let component = 0; component < components; component++) {
    values[row * components + component] = readComponent(dataView, start + row * stride + component * bytes, accessor.componentType);
  }
  return { accessor, components, values };
}

function boundsOf(values, components) {
  const min = Array(components).fill(Infinity), max = Array(components).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const c = i % components;
    min[c] = Math.min(min[c], values[i]); max[c] = Math.max(max[c], values[i]);
  }
  return { min, max };
}

function compareVector(actual, expected, scope, label, epsilon = 1e-4) {
  if (!Array.isArray(expected) || expected.length !== actual.length || !expected.every(finiteNumber)) {
    fail(scope, `${label} is missing or malformed`); return;
  }
  actual.forEach((value, i) => { if (!approx(value, expected[i], epsilon)) fail(scope, `${label}[${i}] ${expected[i]} does not match actual ${value}`); });
}

async function validateGltf(asset, lod, materialIds) {
  const scope = `${asset.id} LOD${lod.level}`;
  const gltfPath = localUri(root, lod.url, scope);
  if (!await regularFile(gltfPath, scope)) return null;
  const doc = await readJson(gltfPath, scope);
  if (!doc) return null;
  stats.models++;
  if (doc.asset?.version !== '2.0') fail(scope, `expected glTF 2.0, found ${doc.asset?.version}`);
  if (doc.extras?.lod !== lod.level) fail(scope, `glTF extras.lod ${doc.extras?.lod} does not match manifest`);

  const buffers = [];
  for (let i = 0; i < (doc.buffers?.length ?? 0); i++) {
    const entry = doc.buffers[i], bufferPath = localUri(path.dirname(gltfPath), entry.uri, `${scope} buffer ${i}`);
    const stat = await regularFile(bufferPath, `${scope} buffer ${i}`);
    if (!stat) continue;
    const data = await fs.readFile(bufferPath); buffers[i] = data; stats.binaryBytes += data.length;
    if (!Number.isInteger(entry.byteLength) || entry.byteLength !== data.length) fail(scope, `buffer ${i} declares ${entry.byteLength} bytes, file has ${data.length}`);
    if (i === 0 && lod.bufferBytes !== data.length) fail(scope, `manifest bufferBytes ${lod.bufferBytes} does not match ${data.length}`);
    if (i === 0 && typeof lod.sha256 === 'string') {
      const hash = createHash('sha256').update(data).digest('hex');
      if (hash !== lod.sha256) fail(scope, `binary sha256 mismatch: expected ${lod.sha256}, got ${hash}`);
    } else if (i === 0) fail(scope, 'manifest is missing binary sha256');
  }
  if (!doc.buffers?.length) fail(scope, 'glTF has no buffers');
  for (let i = 0; i < (doc.bufferViews?.length ?? 0); i++) {
    const view = doc.bufferViews[i], data = buffers[view.buffer];
    if (!data) { fail(scope, `bufferView ${i} references unavailable buffer ${view.buffer}`); continue; }
    const start = view.byteOffset ?? 0, end = start + view.byteLength;
    if (!Number.isInteger(start) || !Number.isInteger(view.byteLength) || start < 0 || end > data.length) fail(scope, `bufferView ${i} range is outside buffer`);
  }

  const actualBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let triangleCount = 0;
  for (const [meshIndex, mesh] of (doc.meshes ?? []).entries()) for (const [primitiveIndex, primitive] of (mesh.primitives ?? []).entries()) {
    const primitiveScope = `${scope} mesh ${meshIndex} primitive ${primitiveIndex}`;
    if ((primitive.mode ?? 4) !== 4) { fail(primitiveScope, `mode ${primitive.mode} is not TRIANGLES`); continue; }
    const position = accessorValues(doc, buffers, primitive.attributes?.POSITION, primitiveScope);
    const normal = accessorValues(doc, buffers, primitive.attributes?.NORMAL, primitiveScope);
    const uv = accessorValues(doc, buffers, primitive.attributes?.TEXCOORD_0, primitiveScope);
    if (!position || !normal || !uv) continue;
    if (position.components !== 3 || normal.components !== 3 || uv.components !== 2) fail(primitiveScope, 'POSITION/NORMAL/TEXCOORD_0 types must be VEC3/VEC3/VEC2');
    if (position.accessor.componentType !== 5126 || normal.accessor.componentType !== 5126 || uv.accessor.componentType !== 5126) fail(primitiveScope, 'vertex attributes must use float32 components');
    if (normal.accessor.count !== position.accessor.count || uv.accessor.count !== position.accessor.count) fail(primitiveScope, `attribute counts differ (${position.accessor.count}/${normal.accessor.count}/${uv.accessor.count})`);
    stats.vertexCount += position.accessor.count;
    for (const [name, values] of [['POSITION', position.values], ['NORMAL', normal.values], ['TEXCOORD_0', uv.values]]) {
      for (const value of values) if (!Number.isFinite(value)) { fail(primitiveScope, `${name} contains non-finite data`); break; }
    }
    for (let i = 0; i < normal.values.length; i += 3) {
      const length = Math.hypot(normal.values[i], normal.values[i + 1], normal.values[i + 2]);
      if (length < 0.985 || length > 1.015) { fail(primitiveScope, `normal ${i / 3} length ${length} is not approximately unit`); break; }
    }
    const positionBounds = boundsOf(position.values, 3);
    compareVector(positionBounds.min, position.accessor.min, primitiveScope, 'POSITION accessor min');
    compareVector(positionBounds.max, position.accessor.max, primitiveScope, 'POSITION accessor max');
    for (let c = 0; c < 3; c++) {
      actualBounds.min[c] = Math.min(actualBounds.min[c], positionBounds.min[c]);
      actualBounds.max[c] = Math.max(actualBounds.max[c], positionBounds.max[c]);
    }
    const count = primitive.indices == null ? position.accessor.count : accessorValues(doc, buffers, primitive.indices, primitiveScope)?.accessor.count;
    if (!Number.isInteger(count) || count % 3 !== 0) fail(primitiveScope, `triangle element count ${count} is not divisible by 3`);
    else triangleCount += count / 3;
    if (!Number.isInteger(primitive.material) || !doc.materials?.[primitive.material]) fail(primitiveScope, 'invalid material index');
    else if (!materialIds.has(doc.materials[primitive.material].name)) fail(primitiveScope, `material ${doc.materials[primitive.material].name} is absent from manifest`);
  }
  if (!doc.meshes?.length) fail(scope, 'glTF has no meshes');
  if (!Number.isInteger(lod.triangles) || triangleCount !== lod.triangles) fail(scope, `manifest triangle count ${lod.triangles} does not match actual ${triangleCount}`);
  stats.triangles[lod.level] += triangleCount;

  for (const [i, image] of (doc.images ?? []).entries()) {
    const imagePath = localUri(path.dirname(gltfPath), image.uri, `${scope} image ${i}`);
    await regularFile(imagePath, `${scope} image ${i}`);
  }
  for (const [i, texture] of (doc.textures ?? []).entries()) if (!doc.images?.[texture.source]) fail(scope, `texture ${i} references missing image ${texture.source}`);
  for (const [i, material] of (doc.materials ?? []).entries()) {
    const indices = [material.pbrMetallicRoughness?.baseColorTexture?.index, material.pbrMetallicRoughness?.metallicRoughnessTexture?.index, material.normalTexture?.index, material.occlusionTexture?.index];
    if (indices.some(index => !Number.isInteger(index) || !doc.textures?.[index])) fail(scope, `material ${i} has a missing/invalid PBR texture reference`);
  }
  return { triangleCount, bounds: actualBounds };
}

async function validateMaterials(materials) {
  const scope = 'manifest materials';
  if (!Array.isArray(materials)) { fail(scope, 'materials must be an array'); return new Set(); }
  stats.materials = materials.length;
  const ids = uniqueValues(materials, 'id', scope);
  if (materials.length !== EXPECTED_MATERIALS.length) fail(scope, `expected ${EXPECTED_MATERIALS.length} materials, found ${materials.length}`);
  for (const id of EXPECTED_MATERIALS) if (!ids.has(id)) fail(scope, `missing required material ${id}`);
  for (const item of materials) {
    const dimensions = [];
    for (const map of ['albedo', 'normal', 'orm']) {
      const mapScope = `material ${item.id} ${map}`;
      const filename = localUri(root, item[map], mapScope);
      const info = await pngInfo(filename, mapScope);
      if (info) {
        dimensions.push(`${info.width}x${info.height}`);
        if (!((info.width === 512 || info.width === 1024) && info.width === info.height)) fail(mapScope, `expected square 512 or 1024 map, found ${info.width}x${info.height}`);
        if (info.bitDepth !== 8 || ![2, 6].includes(info.colorType)) fail(mapScope, `expected 8-bit RGB/RGBA PNG, found bitDepth=${info.bitDepth} colorType=${info.colorType}`);
      }
    }
    if (new Set(dimensions).size > 1) fail(`material ${item.id}`, `map dimensions disagree: ${dimensions.join(', ')}`);
    const tileValid = finiteNumber(item.tileMeters)
      ? item.tileMeters > 0
      : Array.isArray(item.tileMeters) && item.tileMeters.length === 2 && item.tileMeters.every(value => finiteNumber(value) && value > 0);
    if (!tileValid) fail(`material ${item.id}`, 'tileMeters must be a positive scalar or [u, v] pair');
    for (const field of ['roughness', 'metalness', 'normalScale']) if (!finiteNumber(item[field])) fail(`material ${item.id}`, `${field} must be finite`);
  }
  return ids;
}

async function validateMaterialManifestSync(materials) {
  const source = await readJson(path.join(root, 'textures/materials.json'), 'texture manifest');
  if (!Array.isArray(source)) return;
  const byId = new Map(materials.map(item => [item.id, item]));
  const fields = ['label', 'tileMeters', 'roughness', 'metalness', 'normalScale', 'description'];
  for (const authored of source) {
    const embedded = byId.get(authored.id);
    if (!embedded) { fail('library manifest', `omits texture manifest material ${authored.id}`); continue; }
    for (const field of fields) if (JSON.stringify(embedded[field]) !== JSON.stringify(authored[field])) {
      fail(`material ${authored.id}`, `manifest ${field} is stale; rerun build.mjs`);
    }
    for (const map of ['albedo', 'normal', 'orm']) {
      const expected = `textures/${authored[map]}`.replaceAll('\\', '/');
      if (embedded[map] !== expected) fail(`material ${authored.id}`, `manifest ${map} should be ${expected}, found ${embedded[map]}`);
    }
  }
}

async function main() {
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = await readJson(manifestPath, 'library manifest');
  if (!manifest) {
    // The standalone texture manifest still gives useful diagnostics before build.mjs runs.
    const textureManifest = await readJson(path.join(root, 'textures/materials.json'), 'texture manifest');
    if (textureManifest) await validateMaterials(textureManifest.map(item => ({ ...item, albedo: `textures/${item.albedo}`, normal: `textures/${item.normal}`, orm: `textures/${item.orm}` })));
    fail('library manifest', 'run `node scripts/asset-library/build.mjs` before full validation');
  } else {
    if (manifest.schemaVersion !== 1) fail('library manifest', `unsupported schemaVersion ${manifest.schemaVersion}`);
    if (manifest.units !== 'metres' || manifest.upAxis !== '+Y' || manifest.frontAxis !== '+Z') fail('library manifest', 'coordinate convention must be metres, +Y up, +Z front');
    const materialIds = await validateMaterials(manifest.materials);
    await validateMaterialManifestSync(manifest.materials);
    const assets = manifest.assets;
    if (!Array.isArray(assets)) fail('library manifest', 'assets must be an array');
    else {
      stats.assets = assets.length;
      if (assets.length < 75) fail('library manifest', `expected at least 75 assets, found ${assets.length}`);
      uniqueValues(assets, 'id', 'assets');
      const categories = new Set(assets.map(asset => asset.category));
      for (const category of EXPECTED_CATEGORIES) if (!categories.has(category)) fail('assets', `missing required category ${category}`);
      for (const asset of assets) {
        const scope = `asset ${asset.id}`;
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(asset.id ?? '')) fail(scope, 'ID is not a lowercase kebab-case slug');
        if (!EXPECTED_CATEGORIES.includes(asset.category)) warn(scope, `unexpected category ${asset.category}`);
        if (!Array.isArray(asset.materials) || !asset.materials.length) fail(scope, 'materials must be a non-empty array');
        else for (const id of asset.materials) if (!materialIds.has(id)) fail(scope, `references missing material ${id}`);
        if (!Array.isArray(asset.lods)) { fail(scope, 'lods must be an array'); continue; }
        const levels = asset.lods.map(lod => lod.level);
        if (levels.length !== 3 || new Set(levels).size !== 3 || ![0, 1, 2].every(level => levels.includes(level))) fail(scope, `expected exactly LOD levels 0,1,2; found ${levels.join(',')}`);
        const ordered = [...asset.lods].sort((a, b) => a.level - b.level);
        for (let i = 1; i < ordered.length; i++) if (ordered[i].triangles > ordered[i - 1].triangles) fail(scope, `LOD${ordered[i].level} triangles ${ordered[i].triangles} exceed previous LOD ${ordered[i - 1].triangles}`);
        const results = new Map();
        for (const lod of ordered) {
          if (![0, 1, 2].includes(lod.level)) { fail(scope, `invalid LOD level ${lod.level}`); continue; }
          results.set(lod.level, await validateGltf(asset, lod, materialIds));
        }
        const lod0 = results.get(0);
        if (lod0) {
          compareVector(lod0.bounds.min, asset.bounds?.min, scope, 'manifest bounds.min');
          compareVector(lod0.bounds.max, asset.bounds?.max, scope, 'manifest bounds.max');
          const dimensions = lod0.bounds.max.map((value, i) => value - lod0.bounds.min[i]);
          compareVector(dimensions, asset.dimensions, scope, 'manifest dimensions', 2e-4);
        }
      }
    }
  }

  console.log(`Civic Foundry validation: ${errors.length ? 'FAILED' : 'PASSED'}`);
  console.log(`  ${stats.assets} assets, ${stats.models} glTFs, ${stats.materials} materials, ${stats.pngs} PNG maps`);
  console.log(`  triangles LOD0/1/2: ${stats.triangles.map(n => n.toLocaleString()).join(' / ')}`);
  console.log(`  ${(stats.binaryBytes / 1024 / 1024).toFixed(2)} MiB geometry, ${stats.vertexCount.toLocaleString()} validated vertices`);
  if (warnings.length) { console.log(`Warnings (${warnings.length}):`); warnings.forEach(message => console.log(`  - ${message}`)); }
  if (errors.length) { console.error(`Errors (${errors.length}):`); errors.slice(0, 100).forEach(message => console.error(`  - ${message}`)); if (errors.length > 100) console.error(`  - ...and ${errors.length - 100} more`); process.exitCode = 1; }
}

await main();
