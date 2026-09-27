// Pack the Asset Vault (PR #7) for the game: every one of the 4,000 models'
// street-scale scene (LOD 1) as a shared shape library plus one compact
// record per part, so the game can build any of them as a real building with
// its own atlas (see src/vault/). Ground pads (site pads, surveyed lots) are
// left out: the game paints its own lot. Also writes src/vault/families.ts,
// the family metadata the game bundles (names, sign lines, sign colours
// sampled from each family's sign atlas, and where each family grows).
//
// public/vault/pack.json + pack.bin:
//   prims  [posByteOffset, vertexCount, indexByteOffset, indexCount] (float32 xyz, uint16 indices)
//   parts  per part: u16 prim, u8 material, u8 flags (1 rotation, 2 scale, 4 float),
//          translation (int16 cm | float32), rotation (int16 x4 / 32767 | float32 x4), scale (uint16 mm | float32 x3)
//   assets per asset (manifest order), 18 bytes: u32 partOffset, u16 partCount, u8 family, u8 variant,
//          int16 cm minX minZ maxX maxZ (kept parts), uint16 cm maxY
// node scripts/vault-pack.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const LIB = 'vault-public/asset-vault';
const OUT = 'public/vault';
const manifest = JSON.parse(readFileSync(join(LIB, 'manifest.json'), 'utf8'));
const families = JSON.parse(readFileSync(join(LIB, 'families.json'), 'utf8'));
const geo = readFileSync(join(LIB, manifest.sharedGeometry.url));
const LOD = 1;
/** full-lot ground pads: the game paints its own lot */
const DROP = /^(site-pad|surveyed lot)/;

// ------------------------------------------------------------------ where each family grows
// zones: which zoned lots it can grow on; lv: the levels it suits there.
// 'park': a roadside attraction in Services > Parks. Families that stand in
// for a city service or a piece of road (the coal plant, the water tower,
// the toll plaza) are packed but not grown on lots.
const R = (zones, lv = [1, 5]) => ({ zones, lv });
const ROLE = {
  // commerce: shop lots; the big boxes also take early high-density lots
  ...Object.fromEntries(families.filter((f) => f.category === 'commerce').map((f) => [f.id, R(['comLow'])])),
  'boxzilla-bargains': R(['comLow', 'comHigh']), 'bulkhead-club': R(['comLow', 'comHigh']), 'buy-now-cry-later': R(['comLow', 'comHigh']),
  'forever-box-storage': R(['comLow', 'comHigh', 'industry']), 'lease-eagle-motors': R(['comLow', 'comHigh']), 'mattress-mitosis': R(['comLow', 'comHigh']),
  'parcel-panic': R(['comLow', 'comHigh', 'industry']), 'repo-ranch': R(['comLow', 'comHigh']), 'return-to-sender-outlet': R(['comLow', 'comHigh']),
  'strip-mall-of-duty': R(['comLow', 'comHigh']), 'tractor-therapy': R(['comLow', 'comHigh']), 'rent-a-life': R(['comLow', 'comHigh']),
  'appetite-dispatch': R(['comLow', 'comHigh']), 'loyalty-lab': R(['comLow', 'comHigh']), 'convenience-congress': R(['comLow', 'comHigh']),
  'wallet-er': R(['comLow', 'office']), 'premium-denied': R(['comLow', 'office']), 'smile-finance': R(['comLow', 'office']),
  'payday-patriot': R(['comLow', 'office']), 'copay-castle': R(['comLow', 'office']),
  // infrastructure that works as industry or offices
  'abatement-warehouse': R(['industry']), 'aggregate-loader': R(['industry']), 'concrete-batch-plant': R(['industry']),
  'fulfillment-center': R(['industry']), 'public-works-yard': R(['industry']), 'recycling-transfer-station': R(['industry']),
  'road-construction-yard': R(['industry']), 'self-storage-complex': R(['industry', 'comLow']), 'wind-service-yard': R(['industry']),
  'dmv-queue-annex': R(['office']), 'permit-palace': R(['office']), 'tax-assessor-bunker': R(['office']), 'zoning-hearing-hall': R(['office']),
  'parking-minimums-garage': R(['office', 'comHigh']), 'surface-parking-empire': R(['office', 'comLow']),
  // homes, cheapest first
  'single-wide': R(['resLow'], [1, 2]), 'double-wide': R(['resLow'], [1, 2]), 'holler-cabin': R(['resLow'], [1, 2]),
  'prepper-compound': R(['resLow'], [1, 3]), 'tract-ashford': R(['resLow'], [1, 3]), 'tract-beaumont': R(['resLow'], [2, 3]),
  'tract-carrington': R(['resLow'], [2, 4]), 'gather-farmhouse': R(['resLow'], [2, 5]), 'liberty-barndominium': R(['resLow'], [2, 5]),
  'five-acre-ranchette': R(['resLow'], [2, 5]), 'seven-gables-mcmansion': R(['resLow'], [3, 5]),
  'blackrack-rentals': R(['resHigh'], [1, 2]), 'golf-cart-village': R(['resHigh'], [1, 2]), 'whispering-pines': R(['resHigh'], [1, 2]),
  // roadside attractions
  ...Object.fromEntries(['worlds-largest-fork', 'miracle-twine-ball', 'liberty-muffler-man', 'roadside-cross', 'frankenpine-memorial', 'last-hellbender-memorial',
    'freedom-splash-pad', 'hostile-bench-plaza', 'pocket-park', 'sidewalk-to-nowhere', 'lake-serenity-pond', 'mount-trashmore', 'county-fair-midway',
    'suburban-history-museum', 'mandatory-hoa-gate', 'gated-golf-estate'].map((id) => [id, R(['park'])])),
};

// roadside attractions: their menu icon, and the plan they're built from (A3-1, mid-size)
const PARK_ICON = {
  'worlds-largest-fork': '🍴', 'miracle-twine-ball': '🧶', 'liberty-muffler-man': '💪', 'roadside-cross': '✝️', 'frankenpine-memorial': '🌲',
  'last-hellbender-memorial': '🦎', 'freedom-splash-pad': '💦', 'hostile-bench-plaza': '🪑', 'pocket-park': '🛣️', 'sidewalk-to-nowhere': '🚧',
  'lake-serenity-pond': '🦆', 'mount-trashmore': '⛰️', 'county-fair-midway': '🎡', 'suburban-history-museum': '🏛️', 'mandatory-hoa-gate': '🚪', 'gated-golf-estate': '⛳',
};
const PARK_VARIANT = 2;

// ------------------------------------------------------------------ tiny PNG reader (8-bit RGB/RGBA, not interlaced)
function readPng(path, maxRows) {
  const b = readFileSync(path);
  let w = 0, h = 0, ct = 0;
  const idat = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); if (b[o + 16] !== 8 || b[o + 20] !== 0) throw new Error(`${path}: unsupported PNG`); ct = b[o + 17]; }
    else if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`${path}: colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp, rows = Math.min(h, maxRows ?? h);
  const px = Buffer.alloc(stride * rows);
  for (let y = 0; y < rows; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, up = y ? px[dst - stride + x] : 0, ul = y && x >= bpp ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      px[dst + x] = v & 255;
    }
  }
  return { w, rows, bpp, at: (x, y) => { const i = y * stride + x * bpp; return [px[i], px[i + 1], px[i + 2]]; } };
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

// sign colours from each family's first plan region (512 x 200 at the atlas' top left)
const signColors = {};
for (const f of families) {
  const img = readPng(join(LIB, 'signs', `${f.id}.png`), 200);
  const bg = img.at(470, 128);
  let ink = bg, best = -1;
  for (let y = 22; y < 60; y += 1) for (let x = 90; x < 400; x += 2) { const c = img.at(x, y), d = Math.abs(lum(c) - lum(bg)); if (d > best) { best = d; ink = c; } }
  const box = img.at(14, 20);
  signColors[f.id] = { bg: hex(bg), ink: hex(ink), box: hex(box) };
}

// ------------------------------------------------------------------ geometry
const chunks = [];
let offset = 0;
const push = (buf) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  const at = offset;
  chunks.push(buf);
  offset += buf.length;
  return at;
};
const prims = [], primKey = new Map();
const mats = [], matIndex = new Map(), paint = {};
const matOf = (m) => {
  const name = / signage$/.test(m.name) ? 'sign' : m.name;
  if (!matIndex.has(name)) {
    matIndex.set(name, mats.length);
    mats.push(name);
    const f = m.pbrMetallicRoughness?.baseColorFactor;
    if (f && name.startsWith('paint-')) paint[name] = f.slice(0, 3).map((v) => +v.toFixed(4));
  }
  return matIndex.get(name);
};
const accView = (g, i) => {
  const A = g.accessors[i], bv = g.bufferViews[A.bufferView];
  return { A, start: (bv.byteOffset ?? 0) + (A.byteOffset ?? 0) };
};
function primOf(g, p) {
  const P = accView(g, p.attributes.POSITION), I = p.indices === undefined ? null : accView(g, p.indices);
  const key = `${P.start}:${P.A.count}:${I ? `${I.start}:${I.A.count}` : 'seq'}`;
  let id = primKey.get(key);
  if (id !== undefined) return id;
  if (P.A.componentType !== 5126) throw new Error('position not float');
  const pos = Buffer.from(geo.subarray(P.start, P.start + P.A.count * 12));
  // unindexed parts get 0, 1, 2, ...
  const count = I ? I.A.count : P.A.count;
  const idx = new Uint16Array(count);
  const bytes = I ? { 5121: 1, 5123: 2, 5125: 4 }[I.A.componentType] : 0;
  for (let k = 0; k < count; k++) {
    const v = !I ? k : bytes === 1 ? geo[I.start + k] : bytes === 2 ? geo.readUInt16LE(I.start + k * 2) : geo.readUInt32LE(I.start + k * 4);
    if (v > 65535) throw new Error('index over 16 bits');
    idx[k] = v;
  }
  id = prims.length;
  prims.push([push(pos), P.A.count, push(Buffer.from(idx.buffer)), count]);
  primKey.set(key, id);
  return id;
}

// part records, variable length
const partBuf = [];
let partBytes = 0;
const famIndex = new Map(families.map((f, i) => [f.id, i]));
const assetRows = Buffer.alloc(manifest.assets.length * 18);
const cm = (v) => Math.round(v * 100);
const parkPlan = {};
let parts = 0, floatParts = 0, dropped = 0, tris = 0;
function mat4(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0],
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1],
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2],
    t[0], t[1], t[2],
  ];
}
manifest.assets.forEach((a, ai) => {
  const g = JSON.parse(readFileSync(join(LIB, a.url), 'utf8'));
  const scene = g.scenes[LOD];
  const start = partBytes;
  let n = 0, minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = 0;
  const walk = (ni, parent) => {
    const nd = g.nodes[ni];
    if (nd.matrix) throw new Error(`${a.id}: matrix node`);
    if (parent && (nd.translation || nd.rotation || nd.scale)) throw new Error(`${a.id}: nested transform`);
    for (const c of nd.children ?? []) walk(c, nd);
    if (nd.mesh === undefined) return;
    if (DROP.test(nd.name ?? '')) { dropped++; return; }
    for (const p of g.meshes[nd.mesh].primitives) {
      if ((p.mode ?? 4) !== 4) throw new Error(`${a.id}: not triangles`);
      const prim = primOf(g, p), mi = matOf(g.materials[p.material]);
      const t = nd.translation ?? [0, 0, 0], r = nd.rotation, s = nd.scale;
      const big = t.some((v) => Math.abs(v) > 320) || (s && s.some((v) => v < 0 || v > 65));
      const flags = (r ? 1 : 0) | (s ? 2 : 0) | (big ? 4 : 0);
      const rec = Buffer.alloc(4 + (big ? 12 + (r ? 16 : 0) + (s ? 12 : 0) : 6 + (r ? 8 : 0) + (s ? 6 : 0)));
      rec.writeUInt16LE(prim, 0); rec.writeUInt8(mi, 2); rec.writeUInt8(flags, 3);
      let o = 4;
      if (big) {
        for (const v of t) { rec.writeFloatLE(v, o); o += 4; }
        if (r) for (const v of r) { rec.writeFloatLE(v, o); o += 4; }
        if (s) for (const v of s) { rec.writeFloatLE(v, o); o += 4; }
        floatParts++;
      } else {
        for (const v of t) { rec.writeInt16LE(cm(v), o); o += 2; }
        if (r) for (const v of r) { rec.writeInt16LE(Math.round(v * 32767), o); o += 2; }
        if (s) for (const v of s) { rec.writeUInt16LE(Math.round(v * 1000), o); o += 2; }
      }
      partBuf.push(rec);
      partBytes += rec.length;
      n++;
      // bounds of what's kept, from the actual vertices
      const [, nv] = prims[prim];
      const P = accView(g, p.attributes.POSITION);
      const M = mat4(t, r, s);
      for (let k = 0; k < nv; k++) {
        const x = geo.readFloatLE(P.start + k * 12), y = geo.readFloatLE(P.start + k * 12 + 4), z = geo.readFloatLE(P.start + k * 12 + 8);
        const wx = M[0] * x + M[3] * y + M[6] * z + M[9], wy = M[1] * x + M[4] * y + M[7] * z + M[10], wz = M[2] * x + M[5] * y + M[8] * z + M[11];
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx); minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz); maxY = Math.max(maxY, wy);
      }
      tris += prims[prim][3] / 3;
    }
  };
  for (const ni of scene.nodes) walk(ni, null);
  parts += n;
  const fi = famIndex.get(a.family);
  if (fi === undefined) throw new Error(`${a.id}: unknown family`);
  const row = ai * 18;
  assetRows.writeUInt32LE(start, row); assetRows.writeUInt16LE(n, row + 4); assetRows.writeUInt8(fi, row + 6); assetRows.writeUInt8(a.variant, row + 7);
  assetRows.writeInt16LE(cm(minX), row + 8); assetRows.writeInt16LE(cm(minZ), row + 10); assetRows.writeInt16LE(cm(maxX), row + 12); assetRows.writeInt16LE(cm(maxZ), row + 14);
  assetRows.writeUInt16LE(cm(maxY), row + 16);
  if (a.variant === PARK_VARIANT && PARK_ICON[a.family]) parkPlan[a.family] = { w: Math.ceil((maxX - minX + 0.8) / 8), d: Math.ceil((maxZ - minZ + 0.8) / 8), h: +maxY.toFixed(1) };
});
const partsAt = push(Buffer.concat(partBuf));
const assetsAt = push(assetRows);
const bin = Buffer.concat(chunks);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'pack.bin'), bin);
writeFileSync(join(OUT, 'pack.json'), JSON.stringify({
  version: 1, source: `${manifest.name} ${manifest.version}`, lod: LOD, bytes: bin.length, count: manifest.assets.length,
  parts: partsAt, assets: assetsAt, mats, paint, prims,
}));

// ------------------------------------------------------------------ the family metadata the game bundles
const lines = families.map((f) => {
  const role = ROLE[f.id] ?? { zones: [], lv: [1, 5] };
  const c = signColors[f.id];
  const pp = parkPlan[f.id];
  const park = pp ? `{ icon: '${PARK_ICON[f.id]}', variant: ${PARK_VARIANT}, w: ${pp.w}, d: ${pp.d}, h: ${pp.h}, desc: ${JSON.stringify(f.description)} }` : '';
  const mono = f.label.split(/[\s-]+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `  { id: ${JSON.stringify(f.id)}, label: ${JSON.stringify(f.label)}, category: ${JSON.stringify(f.category)}, sign: ${JSON.stringify(f.signLines?.[0] ?? f.label.toUpperCase())}, line: ${JSON.stringify(f.signLines?.[1] ?? '')}, satire: ${JSON.stringify(f.satire)}, mono: ${JSON.stringify(mono)}, bg: '${c.bg}', ink: '${c.ink}', box: '${c.box}', zones: ${JSON.stringify(role.zones)}, lv: [${role.lv.join(', ')}]${park ? `, park: ${park}` : ''} },`;
});
mkdirSync('src/vault', { recursive: true });
writeFileSync('src/vault/families.ts', `// Generated by scripts/vault-pack.mjs from vault-public/asset-vault/families.json: do not edit.
// The Asset Vault's 100 families: sign text and colours, and where each one grows
// ('park' = a roadside attraction in Services > Parks; no zones = packed, not grown).
export type VaultRole = 'comLow' | 'comHigh' | 'resLow' | 'resHigh' | 'industry' | 'office' | 'park';
export interface VaultFamily { id: string; label: string; category: 'commerce' | 'infrastructure' | 'neighborhood'; sign: string; line: string; satire: string; mono: string; bg: string; ink: string; box: string; zones: VaultRole[]; lv: [number, number];
  /** a roadside attraction: its icon, the plan it's built from, its footprint in 8 m cells and height */
  park?: { icon: string; variant: number; w: number; d: number; h: number; desc: string } }
export const VAULT_FAMILIES: VaultFamily[] = [
${lines.join('\n')}
];
`);
const grown = families.filter((f) => (ROLE[f.id]?.zones ?? []).length).length;
console.log(`packed ${manifest.assets.length} assets (${parts} parts, ${floatParts} float, ${dropped} ground pads dropped, ${Math.round(tris)} triangles), ${prims.length} shapes, ${mats.length} materials, ${(bin.length / 2 ** 20).toFixed(2)} MiB; ${grown} of ${families.length} families grow in the game`);
