// SOURCE_ROOT selects frozen source; IDENTITY_BASE compares labels, RNG and budgets.
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(process.env.SOURCE_ROOT || '.');
const out = process.env.OUT || 'shots/look/skyline/identity-unit';
await mkdir(out, { recursive: true });
const server = await createServer({ root, cacheDir: path.resolve(out, '.vite'), configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let failures = 0;
const check = (label, ok, value) => { console.log(ok ? 'OK' : 'FAIL', label, value ?? ''); if (!ok) failures++; };
const hash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
try {
  const { generateBuilding } = await server.ssrLoadModule('/src/buildings/generator.ts');
  const rows = [];
  for (const [zone, level] of [['office', 4], ['office', 5], ['comHigh', 4], ['comHigh', 5], ['resHigh', 4]]) {
    for (const [w, d] of [[1, 1], [2, 2], [3, 3], [4, 4]]) for (const seed of [48074, 1776, 7919, 12345]) {
      const spec = { zone, level, widthCells: w, depthCells: d, seed };
      const plain = generateBuilding(spec), models = [];
      for (const brand of ['aiSlopFarm', 'dalesLanes']) {
        // Warm the canonical cache so this counts only the public returned copy.
        generateBuilding({ ...spec, brand }).geometry.dispose();
        let draws = 0;
        const random = Math.random;
        Math.random = () => { draws++; return .5; };
        let model;
        try { model = generateBuilding({ ...spec, brand }); } finally { Math.random = random; }
        const position = model.geometry.getAttribute('position'), p = plain.geometry.getAttribute('position');
        const normal = model.geometry.getAttribute('normal');
        const groundKept = Array.from({ length: p.count }, (_, i) => i).every(i => p.getY(i) > 12 ||
          [0, 1, 2].every(k => p.getComponent(i, k) === position.getComponent(i, k)));
        const attributesKept = ['uv', 'color', 'ambientVisibility'].every(name => {
          const a = model.geometry.getAttribute(name), b = plain.geometry.getAttribute(name);
          return !a && !b || a && b && hash(a.array) === hash(b.array);
        });
        const metadataKept = model.label === plain.label && model.brand === plain.brand && JSON.stringify(model.spots) === JSON.stringify(plain.spots);
        const normalsValid = Array.from({ length: normal.count }, (_, i) => Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).every(n => Math.abs(n - 1) < 1e-5);
        rows.push({ id: `${zone}/${level}/${w}x${d}/${seed}/${brand}`, height: model.height, label: model.label, brand: model.brand,
          vertices: position.count, draws, groundKept, attributesKept, metadataKept, normalsValid, positionHash: hash(position.array),
          baseHeight: plain.height, changed: hash(position.array) !== hash(p.array) });
        models.push(model);
      }
      const [a, b] = models;
      check(`${zone}/${level}/${w}x${d}/${seed} retired brands have distinct crowns`, plain.height <= 35 || a.height !== b.height);
      models.forEach(m => m.geometry.dispose()); plain.geometry.dispose();
    }
  }
  check('street wall, atlas, content and parking stay exact', rows.every(r => r.groundKept && r.attributesKept && r.metadataKept));
  check('transformed normals remain unit length', rows.every(r => r.normalsValid));
  check('height change is bounded to eight percent above podium', rows.every(r => r.baseHeight <= 35 || Math.abs((r.height - 12) / (r.baseHeight - 12) - 1) <= .080001));
  const supported = { zone: 'office', level: 4, widthCells: 2, depthCells: 2, seed: 48074, brand: 'blackrack' };
  const first = generateBuilding(supported), again = generateBuilding(supported);
  const supportedHash = hash(first.geometry.getAttribute('position').array);
  check('supported brand and canonical cache stay reproducible', supportedHash === hash(again.geometry.getAttribute('position').array));
  first.geometry.dispose(); again.geometry.dispose();
  if (process.env.IDENTITY_BASE) {
    const before = JSON.parse(await readFile(process.env.IDENTITY_BASE, 'utf8'));
    const byId = new Map(before.rows.map(r => [r.id, r]));
    if (before.supportedHash) check('supported brand geometry is unchanged', supportedHash === before.supportedHash);
    check('original counts, random draws and labels preserved', rows.every(r => {
      const b = byId.get(r.id);
      return b && b.vertices === r.vertices && b.draws === r.draws && b.label === r.label && b.brand === r.brand;
    }));
  }
  await writeFile(out + '/result.json', JSON.stringify({ root, rows, supportedHash, failures }, null, 2));
  console.log(JSON.stringify({ models: rows.length, failures }));
} finally { await server.close(); }
process.exitCode = failures ? 1 : 0;
