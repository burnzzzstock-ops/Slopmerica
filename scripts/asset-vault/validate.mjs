import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'vault-public/asset-vault');
const MAX_DETAILS = 80;
const EPS = 1e-4;
const SHA_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const component = new Map([
  [5120, { bytes: 1, getter: 'getInt8' }],
  [5121, { bytes: 1, getter: 'getUint8' }],
  [5122, { bytes: 2, getter: 'getInt16' }],
  [5123, { bytes: 2, getter: 'getUint16' }],
  [5125, { bytes: 4, getter: 'getUint32' }],
  [5126, { bytes: 4, getter: 'getFloat32' }],
]);
const typeSize = new Map([['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4], ['MAT2', 4], ['MAT3', 9], ['MAT4', 16]]);

class Findings {
  constructor() { this.total = 0; this.details = []; }
  add(scope, message) {
    this.total++;
    if (this.details.length < MAX_DETAILS) this.details.push(`${scope}: ${message}`);
  }
  check(value, scope, message) { if (!value) this.add(scope, message); return !!value; }
  printAndExit() {
    if (!this.total) return;
    console.error(`Asset vault validation failed with ${this.total} finding${this.total === 1 ? '' : 's'}:`);
    for (const detail of this.details) console.error(`  - ${detail}`);
    if (this.total > this.details.length) console.error(`  ... ${this.total - this.details.length} additional findings suppressed`);
    process.exitCode = 1;
  }
}

const findings = new Findings();
const sha256 = data => createHash('sha256').update(data).digest('hex');
const finiteArray = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const close = (a, b, tolerance = EPS) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const closeArray = (a, b, tolerance = EPS) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((n, i) => close(n, b[i], tolerance));
const inRangeInteger = (value, length) => Number.isInteger(value) && value >= 0 && value < length;

function contained(relative, base, scope) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || /^[a-z][a-z+.-]*:/i.test(relative)) {
    findings.add(scope, `unsafe path ${JSON.stringify(relative)}`);
    return null;
  }
  let decoded;
  try { decoded = decodeURIComponent(relative); } catch { findings.add(scope, `invalid URI encoding in ${relative}`); return null; }
  const resolved = path.resolve(base, decoded);
  const rel = path.relative(out, resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    findings.add(scope, `path escapes asset vault: ${relative}`);
    return null;
  }
  return resolved;
}

async function readJson(file, scope) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { findings.add(scope, `cannot read JSON (${error.message})`); return null; }
}

async function isFile(file, scope) {
  try { const stat = await fs.stat(file); findings.check(stat.isFile(), scope, 'expected a regular file'); return stat.isFile(); }
  catch (error) { findings.add(scope, `missing file (${error.code || error.message})`); return false; }
}

function expectedVariant(variant) {
  return {
    size: variant % 5,
    layout: Math.floor(variant / 5) % 4,
    state: Math.floor(variant / 20),
    scale: 0.88 + (variant % 5) * 0.08,
    bays: 2 + variant % 5,
    side: Math.floor(variant / 5) % 2 ? 1 : -1,
  };
}

async function validatePng(file, width, height, scope) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const header = Buffer.alloc(33);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!findings.check(bytesRead === header.length, scope, 'truncated PNG header')) return;
    findings.check(header.subarray(0, 8).equals(PNG_SIGNATURE), scope, 'bad PNG signature');
    findings.check(header.readUInt32BE(8) === 13 && header.toString('ascii', 12, 16) === 'IHDR', scope, 'missing canonical IHDR');
    findings.check(header.readUInt32BE(16) === width && header.readUInt32BE(20) === height, scope,
      `expected ${width}x${height}, found ${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`);
    findings.check(header[24] === 8, scope, `expected 8-bit PNG, found ${header[24]}-bit`);
    findings.check([2, 6].includes(header[25]), scope, `unsupported PNG color type ${header[25]}`);
    findings.check(header[26] === 0 && header[27] === 0 && header[28] === 0, scope, 'unsupported PNG compression/filter/interlace');
  } catch (error) { findings.add(scope, `cannot inspect PNG (${error.code || error.message})`); }
  finally { await handle?.close(); }
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

const manifest = await readJson(path.join(out, 'manifest.json'), 'manifest.json');
if (!manifest) {
  findings.printAndExit();
  if (!process.exitCode) process.exitCode = 1;
} else {
  await validate(manifest);
  findings.printAndExit();
}

async function validate(manifest) {
  findings.check(manifest.schemaVersion === 1, 'manifest', `unsupported schemaVersion ${manifest.schemaVersion}`);
  findings.check(manifest.units === 'metres' && manifest.upAxis === '+Y' && manifest.frontAxis === '+Z', 'manifest', 'coordinate convention mismatch');
  findings.check(manifest.variantScheme?.sizes === 5 && manifest.variantScheme?.layouts === 4 && manifest.variantScheme?.states === 2,
    'manifest', 'variant scheme must be 5 sizes × 4 layouts × 2 states');
  findings.check(Array.isArray(manifest.families) && manifest.families.length === 100, 'manifest', `expected 100 families, found ${manifest.families?.length}`);
  findings.check(Array.isArray(manifest.assets) && manifest.assets.length === 4000, 'manifest', `expected 4000 assets, found ${manifest.assets?.length}`);
  findings.check(Array.isArray(manifest.materials) && manifest.materials.length === 18, 'manifest', `expected 18 materials, found ${manifest.materials?.length}`);
  if (!Array.isArray(manifest.families) || !Array.isArray(manifest.assets) || !Array.isArray(manifest.materials)) return;

  const familyIds = new Set();
  for (const family of manifest.families) {
    const scope = `family ${family?.id ?? '?'}`;
    findings.check(typeof family?.id === 'string' && ID_RE.test(family.id), scope, 'invalid family ID');
    findings.check(!familyIds.has(family.id), scope, 'duplicate family ID');
    familyIds.add(family.id);
    findings.check(family.count === 40, scope, `count is ${family.count}, expected 40`);
    findings.check(typeof family.label === 'string' && family.label.length > 0, scope, 'missing label');
    findings.check(typeof family.category === 'string' && family.category.length > 0, scope, 'missing category');
    findings.check(typeof family.description === 'string' && family.description.length > 0, scope, 'missing description');
    findings.check(typeof family.satire === 'string' && family.satire.length > 0, scope, 'missing satire');
    findings.check(Array.isArray(family.signLines) && family.signLines.length === 2 && family.signLines.every(x => typeof x === 'string' && x.length), scope, 'signLines must contain two strings');
    findings.check(Array.isArray(family.tags), scope, 'tags must be an array');
  }

  const familiesFile = await readJson(path.join(out, 'families.json'), 'families.json');
  if (familiesFile) findings.check(JSON.stringify(familiesFile) === JSON.stringify(manifest.families), 'families.json', 'does not exactly match manifest families');

  const binMeta = manifest.sharedGeometry;
  const binUrl = binMeta?.url;
  const binFile = contained(binUrl, out, 'shared geometry');
  let bin = null;
  if (binFile && await isFile(binFile, 'shared geometry')) {
    bin = await fs.readFile(binFile);
    findings.check(binMeta.bytes === bin.byteLength, 'shared geometry', `byte count ${bin.byteLength} does not match ${binMeta.bytes}`);
    findings.check(SHA_RE.test(binMeta.sha256 || '') && sha256(bin) === binMeta.sha256, 'shared geometry', 'SHA-256 mismatch');
    findings.check(bin.byteLength < 95 * 1024 * 1024, 'shared geometry', `safety budget exceeded (${bin.byteLength} bytes)`);
  }
  if (!bin) return;

  const materialPaths = new Set();
  for (const material of manifest.materials) {
    const scope = `material ${material?.id ?? '?'}`;
    findings.check(typeof material.id === 'string' && ID_RE.test(material.id), scope, 'invalid material ID');
    for (const key of ['albedo', 'normal', 'orm']) {
      const file = contained(material[key], out, `${scope} ${key}`);
      if (file) { materialPaths.add(path.resolve(file)); await validatePng(file, 512, 512, `${scope} ${key}`); }
    }
  }
  findings.check(materialPaths.size === 54, 'textures', `expected 54 distinct material maps, found ${materialPaths.size}`);

  const signPaths = new Set();
  await mapLimit([...familyIds], 12, async id => {
    const file = path.join(out, 'signs', `${id}.png`);
    signPaths.add(path.resolve(file));
    await validatePng(file, 2048, 2048, `sign ${id}`);
  });
  findings.check(signPaths.size === 100, 'signs', `expected 100 sign atlases, found ${signPaths.size}`);
  await checkDirectorySet(path.join(out, 'signs'), new Set([...signPaths].map(p => path.basename(p))), 'signs', '.png');
  await checkDirectorySet(path.join(out, 'textures'), new Set([...materialPaths].map(p => path.basename(p))), 'textures', '.png', new Set(['contact-sheet.png']));

  const assetsById = new Map();
  const familyVariants = new Map([...familyIds].map(id => [id, new Set()]));
  const expectedModelNames = new Set();
  const signatures = new Map();
  for (const asset of manifest.assets) {
    const scope = `asset ${asset?.id ?? '?'}`;
    findings.check(typeof asset.id === 'string' && ID_RE.test(asset.id), scope, 'invalid asset ID');
    findings.check(!assetsById.has(asset.id), scope, 'duplicate asset ID');
    assetsById.set(asset.id, asset);
    findings.check(familyIds.has(asset.family), scope, `unknown family ${asset.family}`);
    findings.check(Number.isInteger(asset.variant) && asset.variant >= 0 && asset.variant < 40, scope, `bad variant ${asset.variant}`);
    familyVariants.get(asset.family)?.add(asset.variant);
    const expectedId = `vlt-${asset.family}-${String(asset.variant + 1).padStart(2, '0')}`;
    findings.check(asset.id === expectedId, scope, `expected ID ${expectedId}`);
    findings.check(asset.url === `models/${asset.id}.gltf`, scope, `unexpected model URL ${asset.url}`);
    expectedModelNames.add(`${asset.id}.gltf`);
    findings.check(SHA_RE.test(asset.sha256 || ''), scope, 'invalid file SHA-256');
    findings.check(SHA_RE.test(asset.geometrySignature || ''), scope, 'invalid geometry signature');
    if (signatures.has(asset.geometrySignature)) findings.add(scope, `geometry signature duplicates ${signatures.get(asset.geometrySignature)}`);
    else signatures.set(asset.geometrySignature, asset.id);
    const ev = expectedVariant(asset.variant);
    findings.check(JSON.stringify(asset.parameters) === JSON.stringify(ev), scope, 'variant parameters mismatch');
    const expectedPlan = `${'ABCD'[ev.layout]}${ev.size + 1}-${ev.state + 1}`;
    findings.check(asset.plan === expectedPlan, scope, `expected plan ${expectedPlan}, found ${asset.plan}`);
    findings.check(Array.isArray(asset.lods) && asset.lods.length === 3, scope, 'expected three LOD records');
    findings.check(finiteArray(asset.dimensions, 3) && asset.dimensions.every(n => n > 0), scope, 'invalid dimensions');
    findings.check(finiteArray(asset.bounds?.min, 3) && finiteArray(asset.bounds?.max, 3), scope, 'invalid asset bounds');
  }
  findings.check(assetsById.size === 4000, 'manifest', `expected 4000 unique asset IDs, found ${assetsById.size}`);
  findings.check(signatures.size === 4000, 'manifest', `expected 4000 unique geometry signatures, found ${signatures.size}`);
  for (const [id, variants] of familyVariants) {
    findings.check(variants.size === 40 && Array.from({ length: 40 }, (_, i) => i).every(i => variants.has(i)), `family ${id}`, `expected variants 0–39, found ${variants.size}`);
  }
  await checkDirectorySet(path.join(out, 'models'), expectedModelNames, 'models', '.gltf');

  const viewHashes = new Map();
  const hashRanges = new Map();
  const accessorCache = new Map();
  const referencedImages = new Set();
  let checked = 0;
  await mapLimit(manifest.assets, 16, async asset => {
    try { await validateAsset(asset, bin, binMeta, viewHashes, hashRanges, accessorCache, referencedImages); }
    catch (error) { findings.add(asset.id, `validator exception (${error.stack?.split('\n')[0] || error.message})`); }
    checked++;
    if (checked % 500 === 0) console.log(`validated ${checked} / 4000 models`);
  });

  findings.check(viewHashes.size === binMeta.uniqueAttributeBlocks, 'shared geometry',
    `manifest reports ${binMeta.uniqueAttributeBlocks} unique attribute blocks; ${viewHashes.size} ranges are referenced`);
  const ranges = [...viewHashes.keys()].map(key => key.split(':').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (let i = 1; i < ranges.length; i++) {
    const previousEnd = ranges[i - 1][0] + ranges[i - 1][1];
    findings.check(ranges[i][0] >= previousEnd, 'shared geometry', `partially overlapping buffer views at ${ranges[i - 1][0]} and ${ranges[i][0]}`);
  }
  const allowedImages = new Set([...materialPaths, ...signPaths].map(file => path.resolve(file)));
  for (const file of referencedImages) findings.check(allowedImages.has(file), 'images', `glTF references unexpected image: ${path.relative(out, file)}`);

  const csvFile = path.join(out, 'catalog.csv');
  if (await isFile(csvFile, 'catalog.csv')) {
    const csv = await fs.readFile(csvFile, 'utf8');
    findings.check(csv.split('\n').filter(Boolean).length === 4001, 'catalog.csv', 'expected one header plus 4000 data rows');
  }

  if (!findings.total) {
    console.log(JSON.stringify({
      ok: true,
      families: familyIds.size,
      assets: assetsById.size,
      scenes: assetsById.size * 3,
      geometrySignatures: signatures.size,
      sharedGeometryBytes: bin.byteLength,
      sharedAttributeBlocks: viewHashes.size,
      materialMaps: materialPaths.size,
      signAtlases: signPaths.size,
    }, null, 2));
  }
}

async function checkDirectorySet(directory, expected, scope, extension, allowedExtras = new Set()) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const actual = new Set(entries.filter(e => e.isFile() && e.name.endsWith(extension)).map(e => e.name));
    for (const name of expected) findings.check(actual.has(name), scope, `missing ${name}`);
    for (const name of actual) findings.check(expected.has(name) || allowedExtras.has(name), scope, `unexpected ${name}`);
  } catch (error) { findings.add(scope, `cannot list directory (${error.code || error.message})`); }
}

async function validateAsset(asset, bin, binMeta, viewHashes, hashRanges, accessorCache, referencedImages) {
  const scope = asset.id;
  const file = contained(asset.url, out, scope);
  if (!file) return;
  let raw;
  try { raw = await fs.readFile(file); }
  catch (error) { findings.add(scope, `cannot read glTF (${error.code || error.message})`); return; }
  findings.check(raw.byteLength === asset.fileBytes, scope, `file size ${raw.byteLength} does not match ${asset.fileBytes}`);
  findings.check(sha256(raw) === asset.sha256, scope, 'glTF SHA-256 mismatch');
  let doc;
  try { doc = JSON.parse(raw.toString('utf8')); }
  catch (error) { findings.add(scope, `invalid glTF JSON (${error.message})`); return; }

  findings.check(doc.asset?.version === '2.0', scope, 'glTF asset.version must be 2.0');
  findings.check(doc.scene === 0, scope, `default scene is ${doc.scene}, expected 0`);
  findings.check(Array.isArray(doc.scenes) && doc.scenes.length === 3, scope, `expected 3 scenes, found ${doc.scenes?.length}`);
  findings.check(Array.isArray(doc.nodes) && doc.nodes.length > 0, scope, 'nodes missing');
  findings.check(Array.isArray(doc.meshes) && doc.meshes.length > 0, scope, 'meshes missing');
  findings.check(Array.isArray(doc.bufferViews) && Array.isArray(doc.accessors), scope, 'bufferViews/accessors missing');
  findings.check(Array.isArray(doc.buffers) && doc.buffers.length === 1, scope, 'expected exactly one buffer');
  if (!Array.isArray(doc.scenes) || !Array.isArray(doc.nodes) || !Array.isArray(doc.meshes) || !Array.isArray(doc.bufferViews) || !Array.isArray(doc.accessors)) return;
  findings.check(doc.buffers?.[0]?.uri === '../shared/geometry.bin', scope, `unexpected buffer URI ${doc.buffers?.[0]?.uri}`);
  findings.check(doc.buffers?.[0]?.byteLength === bin.byteLength && doc.buffers?.[0]?.byteLength === binMeta.bytes, scope, 'buffer byteLength mismatch');
  findings.check(doc.extras?.id === asset.id && doc.extras?.family === asset.family && doc.extras?.variant === asset.variant && doc.extras?.plan === asset.plan, scope, 'glTF extras mismatch');
  findings.check(doc.extras?.units === 'metres' && doc.extras?.up === '+Y' && doc.extras?.front === '+Z', scope, 'glTF coordinate extras mismatch');
  findings.check(JSON.stringify(doc.extras?.lodScenes) === '[0,1,2]', scope, 'lodScenes must be [0,1,2]');

  validateImages(doc, file, scope, referencedImages);
  validateTextureGraph(doc, scope);
  validateBufferViews(doc, bin, scope, viewHashes, hashRanges);
  validateAccessors(doc, bin, scope, accessorCache);

  const computedLods = [];
  for (let lod = 0; lod < 3; lod++) computedLods.push(validateScene(doc, lod, bin, scope, accessorCache));
  for (let lod = 0; lod < 3; lod++) {
    const expected = asset.lods?.[lod];
    const actual = computedLods[lod];
    if (!expected || !actual) continue;
    findings.check(expected.level === lod && expected.scene === lod, scope, `LOD ${lod} metadata indices mismatch`);
    findings.check(expected.triangles === actual.triangles, scope, `LOD ${lod} triangle count ${actual.triangles} does not match ${expected.triangles}`);
    findings.check(expected.drawCalls === actual.drawCalls, scope, `LOD ${lod} draw calls ${actual.drawCalls} do not match ${expected.drawCalls}`);
    findings.check(closeArray(expected.bounds?.min, actual.bounds.min) && closeArray(expected.bounds?.max, actual.bounds.max), scope, `LOD ${lod} bounds mismatch`);
  }
  if (computedLods.every(Boolean)) {
    findings.check(computedLods[1].triangles <= computedLods[0].triangles, scope, 'LOD1 has more triangles than LOD0');
    findings.check(computedLods[2].triangles <= computedLods[1].triangles, scope, 'LOD2 has more triangles than LOD1');
    findings.check(closeArray(asset.bounds?.min, computedLods[0].bounds.min) && closeArray(asset.bounds?.max, computedLods[0].bounds.max), scope, 'asset bounds do not match LOD0');
    const dimensions = computedLods[0].bounds.max.map((n, i) => n - computedLods[0].bounds.min[i]);
    findings.check(closeArray(asset.dimensions, dimensions), scope, 'asset dimensions do not match LOD0 bounds');
  }
  const computedSignature = geometrySignature(doc, bin, accessorCache, scope);
  if (computedSignature) findings.check(computedSignature === asset.geometrySignature, scope, 'geometrySignature does not match serialized LOD0 geometry');
}

function validateImages(doc, gltfFile, scope, referencedImages) {
  const images = Array.isArray(doc.images) ? doc.images : [];
  for (let i = 0; i < images.length; i++) {
    const file = contained(images[i]?.uri, path.dirname(gltfFile), `${scope} image ${i}`);
    if (file) referencedImages.add(path.resolve(file));
  }
}

function validateTextureGraph(doc, scope) {
  const images = Array.isArray(doc.images) ? doc.images : [];
  const textures = Array.isArray(doc.textures) ? doc.textures : [];
  const samplers = Array.isArray(doc.samplers) ? doc.samplers : [];
  const materials = Array.isArray(doc.materials) ? doc.materials : [];
  findings.check(samplers.length === 1, scope, `expected one sampler, found ${samplers.length}`);
  for (let i = 0; i < textures.length; i++) {
    findings.check(inRangeInteger(textures[i]?.source, images.length), scope, `texture ${i} has invalid image source`);
    findings.check(inRangeInteger(textures[i]?.sampler, samplers.length), scope, `texture ${i} has invalid sampler`);
  }
  const textureRefs = [];
  for (let i = 0; i < materials.length; i++) {
    const material = materials[i] || {};
    for (const ref of [material.pbrMetallicRoughness?.baseColorTexture, material.pbrMetallicRoughness?.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture]) {
      if (ref) textureRefs.push([i, ref.index]);
    }
  }
  for (const [material, index] of textureRefs) findings.check(inRangeInteger(index, textures.length), scope, `material ${material} has invalid texture ${index}`);
}

function validateBufferViews(doc, bin, scope, viewHashes, hashRanges) {
  for (let i = 0; i < doc.bufferViews.length; i++) {
    const view = doc.bufferViews[i] || {};
    const offset = view.byteOffset ?? 0;
    const length = view.byteLength;
    const key = `${offset}:${length}`;
    findings.check(view.buffer === 0, scope, `bufferView ${i} references buffer ${view.buffer}`);
    findings.check(Number.isInteger(offset) && offset >= 0 && offset % 4 === 0, scope, `bufferView ${i} has invalid/alignment byteOffset ${offset}`);
    findings.check(Number.isInteger(length) && length > 0 && offset + length <= bin.byteLength, scope, `bufferView ${i} range is outside shared buffer`);
    findings.check([34962, 34963].includes(view.target), scope, `bufferView ${i} has unsupported target ${view.target}`);
    findings.check(view.byteStride === undefined, scope, `bufferView ${i} unexpectedly uses byteStride`);
    if (Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length > 0 && offset + length <= bin.byteLength) {
      let hash = viewHashes.get(key);
      if (!hash) { hash = sha256(bin.subarray(offset, offset + length)); viewHashes.set(key, hash); }
      const prior = hashRanges.get(hash);
      if (prior && prior !== key) findings.add(scope, `identical buffer hash appears at two ranges (${prior}, ${key})`);
      else hashRanges.set(hash, key);
    }
  }
}

function accessorInfo(doc, index, bin, scope, cache) {
  if (!inRangeInteger(index, doc.accessors.length)) { findings.add(scope, `invalid accessor ${index}`); return null; }
  const accessor = doc.accessors[index] || {};
  const viewIndex = accessor.bufferView;
  if (!inRangeInteger(viewIndex, doc.bufferViews.length)) { findings.add(scope, `accessor ${index} has invalid bufferView ${viewIndex}`); return null; }
  const view = doc.bufferViews[viewIndex] || {};
  const info = component.get(accessor.componentType);
  const width = typeSize.get(accessor.type);
  if (!info || !width || !Number.isInteger(accessor.count) || accessor.count <= 0) { findings.add(scope, `accessor ${index} has invalid type/count`); return null; }
  const localOffset = accessor.byteOffset ?? 0;
  const bytes = accessor.count * width * info.bytes;
  if (!Number.isInteger(localOffset) || localOffset < 0 || localOffset + bytes > view.byteLength) { findings.add(scope, `accessor ${index} exceeds its bufferView`); return null; }
  const absolute = (view.byteOffset ?? 0) + localOffset;
  if (absolute + bytes > bin.byteLength) { findings.add(scope, `accessor ${index} exceeds shared buffer`); return null; }
  const key = `${absolute}:${bytes}:${accessor.componentType}:${accessor.type}:${accessor.count}`;
  if (cache.has(key)) return cache.get(key);
  const dataView = new DataView(bin.buffer, bin.byteOffset + absolute, bytes);
  const values = new Array(accessor.count * width);
  for (let i = 0; i < values.length; i++) values[i] = dataView[info.getter](i * info.bytes, true);
  const result = { accessor, view, values, width, bytes, absolute, hash: sha256(bin.subarray(absolute, absolute + bytes)) };
  cache.set(key, result);
  return result;
}

function validateAccessors(doc, bin, scope, cache) {
  for (let i = 0; i < doc.accessors.length; i++) {
    const info = accessorInfo(doc, i, bin, scope, cache);
    if (!info) continue;
    findings.check(info.bytes === info.view.byteLength, scope, `accessor ${i} does not occupy its complete bufferView`);
    findings.check(info.values.every(Number.isFinite), scope, `accessor ${i} contains non-finite values`);
    findings.check(info.accessor.sparse === undefined, scope, `accessor ${i} unexpectedly uses sparse storage`);
    findings.check(info.accessor.normalized === undefined || info.accessor.normalized === false, scope, `accessor ${i} unexpectedly uses normalized values`);
    if (Array.isArray(info.accessor.min) || Array.isArray(info.accessor.max)) {
      const min = Array(info.width).fill(Infinity), max = Array(info.width).fill(-Infinity);
      for (let n = 0; n < info.values.length; n++) { const k = n % info.width; min[k] = Math.min(min[k], info.values[n]); max[k] = Math.max(max[k], info.values[n]); }
      findings.check(closeArray(info.accessor.min, min, 1e-5) && closeArray(info.accessor.max, max, 1e-5), scope, `accessor ${i} declared min/max mismatch`);
    }
  }
}

function validateScene(doc, lod, bin, scope, cache) {
  const scene = doc.scenes[lod];
  if (!scene || !Array.isArray(scene.nodes) || scene.nodes.length === 0) { findings.add(scope, `LOD ${lod} scene is empty`); return null; }
  findings.check(scene.extras?.level === lod, scope, `scene ${lod} level metadata mismatch`);
  findings.check(scene.name === `LOD ${lod}`, scope, `scene ${lod} name mismatch`);
  const bounds = new THREE.Box3();
  let triangles = 0, drawCalls = 0;
  const active = new Set(), visited = new Set();
  const walk = (nodeIndex, parentMatrix) => {
    if (!inRangeInteger(nodeIndex, doc.nodes.length)) { findings.add(scope, `scene ${lod} has invalid node ${nodeIndex}`); return; }
    if (active.has(nodeIndex)) { findings.add(scope, `node cycle at ${nodeIndex}`); return; }
    const node = doc.nodes[nodeIndex] || {};
    const translation = node.translation ?? [0, 0, 0], rotation = node.rotation ?? [0, 0, 0, 1], scale = node.scale ?? [1, 1, 1];
    if (!finiteArray(translation, 3) || !finiteArray(rotation, 4) || !finiteArray(scale, 3) || scale.some(n => n <= 0)) { findings.add(scope, `node ${nodeIndex} has invalid transform`); return; }
    findings.check(Math.abs(Math.hypot(...rotation) - 1) <= 1e-4, scope, `node ${nodeIndex} quaternion is not normalized`);
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...translation), new THREE.Quaternion(...rotation), new THREE.Vector3(...scale));
    const world = parentMatrix.clone().multiply(local);
    active.add(nodeIndex); visited.add(nodeIndex);
    if (node.mesh !== undefined) {
      if (!inRangeInteger(node.mesh, doc.meshes.length)) findings.add(scope, `node ${nodeIndex} has invalid mesh ${node.mesh}`);
      else {
        const mesh = doc.meshes[node.mesh];
        if (!Array.isArray(mesh?.primitives) || mesh.primitives.length === 0) findings.add(scope, `mesh ${node.mesh} is empty`);
        else for (const primitive of mesh.primitives) {
          drawCalls++;
          const positionIndex = primitive.attributes?.POSITION, normalIndex = primitive.attributes?.NORMAL, uvIndex = primitive.attributes?.TEXCOORD_0;
          const position = accessorInfo(doc, positionIndex, bin, scope, cache);
          const normal = accessorInfo(doc, normalIndex, bin, scope, cache);
          const uv = accessorInfo(doc, uvIndex, bin, scope, cache);
          findings.check((primitive.mode ?? 4) === 4, scope, `mesh ${node.mesh} is not TRIANGLES`);
          findings.check(position?.accessor.componentType === 5126 && position?.accessor.type === 'VEC3', scope, `mesh ${node.mesh} POSITION must be float VEC3`);
          findings.check(normal?.accessor.componentType === 5126 && normal?.accessor.type === 'VEC3', scope, `mesh ${node.mesh} NORMAL must be float VEC3`);
          findings.check(uv?.accessor.componentType === 5126 && uv?.accessor.type === 'VEC2', scope, `mesh ${node.mesh} TEXCOORD_0 must be float VEC2`);
          if (position && normal) findings.check(position.accessor.count === normal.accessor.count, scope, `mesh ${node.mesh} normal count mismatch`);
          if (position && uv) findings.check(position.accessor.count === uv.accessor.count, scope, `mesh ${node.mesh} UV count mismatch`);
          if (normal) for (let i = 0; i < normal.values.length; i += 3) {
            const length = Math.hypot(normal.values[i], normal.values[i + 1], normal.values[i + 2]);
            if (!close(length, 1, 2e-3)) { findings.add(scope, `mesh ${node.mesh} has non-unit normal (${length})`); break; }
          }
          let triangleElements = position?.accessor.count ?? 0;
          if (primitive.indices !== undefined) {
            const indices = accessorInfo(doc, primitive.indices, bin, scope, cache);
            findings.check(indices?.accessor.type === 'SCALAR' && [5123, 5125].includes(indices?.accessor.componentType), scope, `mesh ${node.mesh} indices must be unsigned SCALAR`);
            if (indices && position) {
              triangleElements = indices.accessor.count;
              let max = -1;
              for (const index of indices.values) max = Math.max(max, index);
              findings.check(max < position.accessor.count, scope, `mesh ${node.mesh} index ${max} exceeds ${position.accessor.count} vertices`);
            }
          }
          findings.check(triangleElements % 3 === 0, scope, `mesh ${node.mesh} triangle element count is not divisible by 3`);
          triangles += triangleElements / 3;
          if (position) {
            const localBounds = new THREE.Box3(
              new THREE.Vector3(...position.accessor.min),
              new THREE.Vector3(...position.accessor.max),
            ).applyMatrix4(world);
            bounds.union(localBounds);
          }
          findings.check(inRangeInteger(primitive.material, doc.materials?.length ?? 0), scope, `mesh ${node.mesh} has invalid material ${primitive.material}`);
        }
      }
    }
    if (Array.isArray(node.children)) for (const child of node.children) walk(child, world);
    active.delete(nodeIndex);
  };
  for (const node of scene.nodes) walk(node, new THREE.Matrix4());
  findings.check(visited.size === scene.nodes.length, scope, `LOD ${lod} expected flat scene nodes (${scene.nodes.length}), visited ${visited.size}`);
  findings.check(Number.isFinite(bounds.min.x) && Number.isFinite(bounds.max.x), scope, `LOD ${lod} has invalid bounds`);
  return { triangles, drawCalls, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
}

function geometrySignature(doc, bin, cache, scope) {
  const scene = doc.scenes?.[0];
  if (!scene || !Array.isArray(scene.nodes)) return null;
  const parts = [];
  for (const nodeIndex of scene.nodes) {
    if (!inRangeInteger(nodeIndex, doc.nodes.length)) return null;
    const node = doc.nodes[nodeIndex], mesh = doc.meshes?.[node.mesh];
    if (!mesh || !Array.isArray(mesh.primitives)) return null;
    for (const primitive of mesh.primitives) {
      const material = doc.materials?.[primitive.material];
      if (material?.extensions?.KHR_materials_unlit || /(?:^|[\s-])(?:sign|base|surveyed|foundation|lot|slab)(?:$|[\s-])/i.test(node.name || '')) continue;
      const position = accessorInfo(doc, primitive.attributes?.POSITION, bin, scope, cache);
      const indices = primitive.indices === undefined ? null : accessorInfo(doc, primitive.indices, bin, scope, cache);
      if (!position || (primitive.indices !== undefined && !indices)) return null;
      parts.push([
        position.hash,
        indices?.hash ?? '',
        node.translation ?? [0, 0, 0],
        node.rotation ?? [0, 0, 0, 1],
        node.scale ?? [1, 1, 1],
      ]);
    }
  }
  parts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return sha256(Buffer.from(JSON.stringify(parts)));
}
