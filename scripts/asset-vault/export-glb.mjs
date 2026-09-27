#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const vaultRoot = path.join(repoRoot, 'vault-public', 'asset-vault');
const manifestPath = path.join(vaultRoot, 'manifest.json');

function usage() {
  return `Usage: node scripts/asset-vault/export-glb.mjs --id <asset-id> --lod <0|1|2> [--out <file.glb>] [--force]

Exports one asset and one LOD as a self-contained GLB. If --out is omitted,
the file is written to work/<asset-id>-lod<lod>.glb. Existing files are never
overwritten unless --force is supplied.`;
}

function parseArgs(argv) {
  const options = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--force') { options.force = true; continue; }
    if (!['--id', '--lod', '--out'].includes(arg)) throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}\n${usage()}`);
    options[arg.slice(2)] = value;
  }
  if (!options.id) throw new Error(`Missing required --id\n${usage()}`);
  if (options.lod === undefined) throw new Error(`Missing required --lod\n${usage()}`);
  options.lod = Number(options.lod);
  if (!Number.isInteger(options.lod) || options.lod < 0 || options.lod > 2) {
    throw new Error('--lod must be exactly 0, 1, or 2');
  }
  if (options.out && path.extname(options.out).toLowerCase() !== '.glb') {
    throw new Error('--out must name a .glb file');
  }
  return options;
}

const clone = value => structuredClone(value);
const sorted = set => [...set].sort((a, b) => a - b);
function required(array, index, label) {
  if (!Number.isInteger(index) || index < 0 || index >= (array?.length ?? 0)) {
    throw new Error(`Invalid ${label} index ${index}`);
  }
  return array[index];
}

function textureReferences(material) {
  const result = new Set();
  function visit(value, key = '') {
    if (!value || typeof value !== 'object') return;
    if (key.toLowerCase().includes('texture') && Number.isInteger(value.index)) result.add(value.index);
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  }
  visit(material);
  return result;
}

function remapTextureReferences(material, textureMap) {
  function visit(value, key = '') {
    if (!value || typeof value !== 'object') return;
    if (key.toLowerCase().includes('texture') && Number.isInteger(value.index)) {
      if (!textureMap.has(value.index)) throw new Error(`Material references unused texture ${value.index}`);
      value.index = textureMap.get(value.index);
    }
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  }
  visit(material);
}

function extensionsPresent(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (value.extensions && typeof value.extensions === 'object') {
    for (const name of Object.keys(value.extensions)) found.add(name);
  }
  for (const child of Object.values(value)) extensionsPresent(child, found);
  return found;
}

function decodeDataUri(uri) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!match) throw new Error('Malformed data URI');
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return { mimeType: match[1] || 'application/octet-stream', bytes };
}

async function loadUri(uri, baseDir) {
  if (uri.startsWith('data:')) return decodeDataUri(uri);
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) throw new Error(`Remote URI is not supported: ${uri}`);
  const filename = path.resolve(baseDir, decodeURIComponent(uri));
  return { bytes: await fs.readFile(filename), filename };
}

function assertPng(bytes, name) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((byte, i) => bytes[i] !== byte)) {
    throw new Error(`Expected PNG image data for ${name}`);
  }
}

async function makePortableDocument(source, sourcePath, asset, lod) {
  const lodRecord = asset.lods?.find(entry => entry.level === lod);
  const sourceSceneIndex = lodRecord?.scene ?? source.scenes?.findIndex(scene => scene.extras?.level === lod);
  if (!Number.isInteger(sourceSceneIndex) || sourceSceneIndex < 0) throw new Error(`Asset ${asset.id} has no LOD ${lod} scene`);
  const sourceScene = required(source.scenes, sourceSceneIndex, 'scene');

  const usedNodes = new Set(), usedMeshes = new Set(), usedSkins = new Set(), usedCameras = new Set();
  function addNode(index) {
    if (usedNodes.has(index)) return;
    const node = required(source.nodes, index, 'node');
    usedNodes.add(index);
    if (Number.isInteger(node.mesh)) usedMeshes.add(node.mesh);
    if (Number.isInteger(node.skin)) usedSkins.add(node.skin);
    if (Number.isInteger(node.camera)) usedCameras.add(node.camera);
    for (const child of node.children ?? []) addNode(child);
  }
  for (const node of sourceScene.nodes ?? []) addNode(node);
  for (const skinIndex of [...usedSkins]) {
    const skin = required(source.skins, skinIndex, 'skin');
    for (const joint of skin.joints ?? []) addNode(joint);
    if (Number.isInteger(skin.skeleton)) addNode(skin.skeleton);
  }

  const usedAccessors = new Set(), usedMaterials = new Set();
  for (const meshIndex of usedMeshes) {
    const mesh = required(source.meshes, meshIndex, 'mesh');
    for (const primitive of mesh.primitives ?? []) {
      for (const accessor of Object.values(primitive.attributes ?? {})) usedAccessors.add(accessor);
      if (Number.isInteger(primitive.indices)) usedAccessors.add(primitive.indices);
      if (Number.isInteger(primitive.material)) usedMaterials.add(primitive.material);
      for (const target of primitive.targets ?? []) for (const accessor of Object.values(target)) usedAccessors.add(accessor);
    }
  }
  for (const skinIndex of usedSkins) {
    const accessor = source.skins[skinIndex].inverseBindMatrices;
    if (Number.isInteger(accessor)) usedAccessors.add(accessor);
  }

  const usedTextures = new Set();
  for (const materialIndex of usedMaterials) {
    const material = required(source.materials, materialIndex, 'material');
    for (const texture of textureReferences(material)) usedTextures.add(texture);
  }
  const usedImages = new Set(), usedSamplers = new Set();
  for (const textureIndex of usedTextures) {
    const texture = required(source.textures, textureIndex, 'texture');
    if (Number.isInteger(texture.source)) usedImages.add(texture.source);
    if (Number.isInteger(texture.sampler)) usedSamplers.add(texture.sampler);
  }

  const usedBufferViews = new Set();
  for (const accessorIndex of usedAccessors) {
    const accessor = required(source.accessors, accessorIndex, 'accessor');
    if (Number.isInteger(accessor.bufferView)) usedBufferViews.add(accessor.bufferView);
    if (Number.isInteger(accessor.sparse?.indices?.bufferView)) usedBufferViews.add(accessor.sparse.indices.bufferView);
    if (Number.isInteger(accessor.sparse?.values?.bufferView)) usedBufferViews.add(accessor.sparse.values.bufferView);
  }
  const sourceDir = path.dirname(sourcePath);
  const sourceBuffers = new Map();
  async function sourceBuffer(index) {
    if (sourceBuffers.has(index)) return sourceBuffers.get(index);
    const definition = required(source.buffers, index, 'buffer');
    if (!definition.uri) throw new Error(`Source buffer ${index} has no URI`);
    const loaded = await loadUri(definition.uri, sourceDir);
    if (loaded.bytes.length < definition.byteLength) throw new Error(`Source buffer ${index} is shorter than declared`);
    sourceBuffers.set(index, loaded.bytes);
    return loaded.bytes;
  }

  const chunks = [];
  let binaryLength = 0;
  function append(bytes) {
    const pad = (4 - binaryLength % 4) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); binaryLength += pad; }
    const byteOffset = binaryLength;
    chunks.push(bytes);
    binaryLength += bytes.length;
    return byteOffset;
  }

  const bufferViewMap = new Map(), bufferViews = [];
  for (const oldIndex of sorted(usedBufferViews)) {
    const view = required(source.bufferViews, oldIndex, 'bufferView');
    const buffer = await sourceBuffer(view.buffer);
    const begin = view.byteOffset ?? 0, end = begin + view.byteLength;
    if (begin < 0 || end > buffer.length) throw new Error(`Buffer view ${oldIndex} exceeds its source buffer`);
    const newIndex = bufferViews.length;
    bufferViewMap.set(oldIndex, newIndex);
    bufferViews.push({ ...clone(view), buffer: 0, byteOffset: append(buffer.subarray(begin, end)) });
  }

  const accessorMap = new Map();
  const accessors = sorted(usedAccessors).map((oldIndex, newIndex) => {
    accessorMap.set(oldIndex, newIndex);
    const accessor = clone(required(source.accessors, oldIndex, 'accessor'));
    if (Number.isInteger(accessor.bufferView)) accessor.bufferView = bufferViewMap.get(accessor.bufferView);
    if (Number.isInteger(accessor.sparse?.indices?.bufferView)) accessor.sparse.indices.bufferView = bufferViewMap.get(accessor.sparse.indices.bufferView);
    if (Number.isInteger(accessor.sparse?.values?.bufferView)) accessor.sparse.values.bufferView = bufferViewMap.get(accessor.sparse.values.bufferView);
    return accessor;
  });

  const imageMap = new Map(), images = [];
  for (const oldIndex of sorted(usedImages)) {
    const sourceImage = clone(required(source.images, oldIndex, 'image'));
    let bytes;
    if (sourceImage.uri) {
      const loaded = await loadUri(sourceImage.uri, sourceDir);
      bytes = loaded.bytes;
    } else if (Number.isInteger(sourceImage.bufferView)) {
      const oldView = source.bufferViews[sourceImage.bufferView];
      const buffer = await sourceBuffer(oldView.buffer);
      const begin = oldView.byteOffset ?? 0;
      bytes = buffer.subarray(begin, begin + oldView.byteLength);
    } else throw new Error(`Image ${oldIndex} has neither URI nor bufferView`);
    assertPng(bytes, sourceImage.name ?? sourceImage.uri ?? `image ${oldIndex}`);
    const imageView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length });
    delete sourceImage.uri;
    sourceImage.bufferView = imageView;
    sourceImage.mimeType = 'image/png';
    imageMap.set(oldIndex, images.length);
    images.push(sourceImage);
  }

  const samplerMap = new Map();
  const samplers = sorted(usedSamplers).map((oldIndex, newIndex) => {
    samplerMap.set(oldIndex, newIndex);
    return clone(required(source.samplers, oldIndex, 'sampler'));
  });
  const textureMap = new Map();
  const textures = sorted(usedTextures).map((oldIndex, newIndex) => {
    textureMap.set(oldIndex, newIndex);
    const texture = clone(required(source.textures, oldIndex, 'texture'));
    if (Number.isInteger(texture.source)) texture.source = imageMap.get(texture.source);
    if (Number.isInteger(texture.sampler)) texture.sampler = samplerMap.get(texture.sampler);
    return texture;
  });
  const materialMap = new Map();
  const materials = sorted(usedMaterials).map((oldIndex, newIndex) => {
    materialMap.set(oldIndex, newIndex);
    const material = clone(required(source.materials, oldIndex, 'material'));
    remapTextureReferences(material, textureMap);
    return material;
  });

  const meshMap = new Map();
  const meshes = sorted(usedMeshes).map((oldIndex, newIndex) => {
    meshMap.set(oldIndex, newIndex);
    const mesh = clone(required(source.meshes, oldIndex, 'mesh'));
    for (const primitive of mesh.primitives ?? []) {
      for (const semantic of Object.keys(primitive.attributes ?? {})) primitive.attributes[semantic] = accessorMap.get(primitive.attributes[semantic]);
      if (Number.isInteger(primitive.indices)) primitive.indices = accessorMap.get(primitive.indices);
      if (Number.isInteger(primitive.material)) primitive.material = materialMap.get(primitive.material);
      for (const target of primitive.targets ?? []) for (const semantic of Object.keys(target)) target[semantic] = accessorMap.get(target[semantic]);
    }
    return mesh;
  });

  const cameraMap = new Map();
  const cameras = sorted(usedCameras).map((oldIndex, newIndex) => {
    cameraMap.set(oldIndex, newIndex);
    return clone(required(source.cameras, oldIndex, 'camera'));
  });
  const skinMap = new Map();
  sorted(usedSkins).forEach((oldIndex, newIndex) => skinMap.set(oldIndex, newIndex));
  const nodeMap = new Map();
  sorted(usedNodes).forEach((oldIndex, newIndex) => nodeMap.set(oldIndex, newIndex));
  const nodes = sorted(usedNodes).map(oldIndex => {
    const node = clone(required(source.nodes, oldIndex, 'node'));
    if (Number.isInteger(node.mesh)) node.mesh = meshMap.get(node.mesh);
    if (Number.isInteger(node.skin)) node.skin = skinMap.get(node.skin);
    if (Number.isInteger(node.camera)) node.camera = cameraMap.get(node.camera);
    if (node.children) node.children = node.children.map(child => nodeMap.get(child));
    return node;
  });
  const skins = sorted(usedSkins).map(oldIndex => {
    const skin = clone(required(source.skins, oldIndex, 'skin'));
    skin.joints = skin.joints.map(joint => nodeMap.get(joint));
    if (Number.isInteger(skin.skeleton)) skin.skeleton = nodeMap.get(skin.skeleton);
    if (Number.isInteger(skin.inverseBindMatrices)) skin.inverseBindMatrices = accessorMap.get(skin.inverseBindMatrices);
    return skin;
  });

  const scene = clone(sourceScene);
  scene.nodes = (scene.nodes ?? []).map(node => nodeMap.get(node));
  const document = {
    asset: { ...clone(source.asset), generator: `${source.asset?.generator ?? 'SLOPMERICA'}; portable GLB exporter` },
    scene: 0,
    scenes: [scene],
    nodes,
    meshes,
    materials,
    textures,
    images,
    samplers,
    buffers: [{ byteLength: binaryLength }],
    bufferViews,
    accessors,
    extras: { ...clone(source.extras ?? {}), lodScenes: [0], selectedLod: lod, sourceAsset: asset.id },
  };
  if (skins.length) document.skins = skins;
  if (cameras.length) document.cameras = cameras;
  const foundExtensions = extensionsPresent(document);
  const usedExtensionNames = (source.extensionsUsed ?? []).filter(name => foundExtensions.has(name));
  const requiredExtensionNames = (source.extensionsRequired ?? []).filter(name => foundExtensions.has(name));
  if (usedExtensionNames.length) document.extensionsUsed = usedExtensionNames;
  if (requiredExtensionNames.length) document.extensionsRequired = requiredExtensionNames;
  return { document, binary: Buffer.concat(chunks, binaryLength) };
}

function makeGlb(document, binary) {
  const json = Buffer.from(JSON.stringify(document), 'utf8');
  const jsonPadding = (4 - json.length % 4) % 4;
  const binPadding = (4 - binary.length % 4) % 4;
  const jsonChunkLength = json.length + jsonPadding;
  const binChunkLength = binary.length + binPadding;
  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonChunkLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  output.fill(0x20, 20 + json.length, 20 + jsonChunkLength);
  const binHeader = 20 + jsonChunkLength;
  output.writeUInt32LE(binChunkLength, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  binary.copy(output, binHeader + 8);
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const asset = manifest.assets?.find(entry => entry.id === options.id);
  if (!asset) throw new Error(`Unknown asset id: ${options.id}`);
  const sourcePath = path.resolve(vaultRoot, asset.url);
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const { document, binary } = await makePortableDocument(source, sourcePath, asset, options.lod);
  const glb = makeGlb(document, binary);
  const outputPath = path.resolve(options.out ?? path.join(repoRoot, 'work', `${asset.id}-lod${options.lod}.glb`));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await fs.writeFile(outputPath, glb, { flag: options.force ? 'w' : 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Refusing to overwrite existing file without --force: ${outputPath}`);
    throw error;
  }
  console.log(JSON.stringify({ id: asset.id, lod: options.lod, output: outputPath, bytes: glb.length, meshes: document.meshes.length, materials: document.materials.length, images: document.images.length }, null, 2));
}

main().catch(error => {
  console.error(`export-glb: ${error.message}`);
  process.exitCode = 1;
});
