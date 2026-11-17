// Standalone real-generator audit; no WebGL, downloaded kit or simulation needed.
// First save frozen code: SOURCE_ROOT=... OUT=... node scripts/look/skyline-models.mjs
// Then compare: SKYLINE_BASE=path/to/result.json OUT=... node scripts/look/skyline-models.mjs
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.SOURCE_ROOT || '.');
const out = process.env.OUT || 'shots/look/skyline/models';
await mkdir(out, { recursive: true });
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
let bad = 0;
const check = (label, ok, detail) => { console.log(ok ? 'OK  ' : 'FAIL', label, detail ?? ''); if (!ok) bad++; };
try {
  const [{ MB }, { Rng }, office, com, res] = await Promise.all([
    server.ssrLoadModule('/src/buildings/mesh.ts'), server.ssrLoadModule('/src/core/rng.ts'),
    server.ssrLoadModule('/src/buildings/office.ts'), server.ssrLoadModule('/src/buildings/comHigh.ts'), server.ssrLoadModule('/src/buildings/resHigh.ts'),
  ]);
  const families = [
    ['office', 4, 'blackrack', office.genOffice], ['office', 5, 'slopHQ', office.genOffice],
    ['comHigh', 4, 'timesSlop', com.genComHigh], ['comHigh', 5, 'timesSlop', com.genComHigh],
    ['resHigh', 4, undefined, res.genResHigh],
  ];
  // Intersect actual triangles with horizontal planes. Profile signatures use
  // quantised widths AND offsets, so asymmetric shoulders survive normalization.
  const section = (p, y) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < p.length; k += 9) {
      for (const [a, b] of [[k, k + 3], [k + 3, k + 6], [k + 6, k]]) {
        const ya = p[a + 1], yb = p[b + 1];
        if (Math.abs(ya - yb) < 1e-5 || y < Math.min(ya, yb) || y > Math.max(ya, yb)) continue;
        const t = (y - ya) / (yb - ya), x = p[a] + t * (p[b] - p[a]), z = p[a + 2] + t * (p[b + 2] - p[a + 2]);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
    }
    return Number.isFinite(x0) ? [x0, x1, z0, z1] : [0, 0, 0, 0];
  };
  const rows = [];
  for (const [zone, level, brand, gen] of families) for (const [w, d] of [[1, 1], [1, 4], [4, 1], [2, 2], [2, 3], [3, 2], [3, 3], [4, 4]]) for (let i = 0; i < 16; i++) {
    const seed = 1776 + i * 7919, W = w * 8, D = d * 8;
    const make = () => {
      const g = { mb: new MB(), rng: new Rng(seed), spec: { zone, level, widthCells: w, depthCells: d, seed, brand }, W, D, em: [], label: '' };
      gen(g); const geo = g.mb.build();
      return { g, geo, p: geo.getAttribute('position').array };
    };
    const started = performance.now(), { g, geo, p } = make();
    const ms = performance.now() - started, height = g.mb.maxY();
    let bodyH = height;
    for (; bodyH > 4; bodyH -= 0.25) {
      const b = section(p, bodyH - 0.01);
      if ((b[1] - b[0]) > W * 0.22 && (b[3] - b[2]) > D * 0.22) break;
    }
    const profile = Array.from({ length: 15 }, (_, j) => section(p, bodyH * (0.15 + j * 0.055)));
    const signature = profile.flatMap((b) => b.map((v, k) => Math.round(v / (k < 2 ? W : D) * 20))).join(',');
    const again = make();
    const same = p.length === again.p.length && p.every((v, k) => v === again.p[k]);
    const bounds = [Infinity, -Infinity, Infinity, -Infinity];
    for (let k = 0; k < p.length; k += 3) { bounds[0] = Math.min(bounds[0], p[k]); bounds[1] = Math.max(bounds[1], p[k]); bounds[2] = Math.min(bounds[2], p[k + 2]); bounds[3] = Math.max(bounds[3], p[k + 2]); }
    rows.push({ id: `${zone}/${level}/${w}x${d}/${seed}`, zone, level, w, d, seed, label: g.label, state: g.rng.state, tris: p.length / 9, ms, height, bodyH, profile, signature, bounds, finite: p.every(Number.isFinite), same });
    geo.dispose(); again.geo.dispose();
  }
  const groups = families.map(([zone, level]) => {
    const r = rows.filter((r) => r.zone === zone && r.level === level && r.w === 3 && r.d === 3);
    return { id: `${zone}/${level}`, count: r.length, silhouettes: new Set(r.map((r) => r.signature)).size,
      identicalNeighbors: r.slice(1).filter((v, i) => v.signature === r[i].signature).length,
      tris: r.reduce((n, r) => n + r.tris, 0) };
  });
  const sum = rows.reduce((n, r) => n + r.tris, 0), result = { root, models: rows.length, triangles: sum, groups, rows };
  check('all 640 tower models finite and reproducible', rows.length === 640 && rows.every((r) => r.finite && r.same));
  check('each tower family has at least six bounding profiles on equal lots', groups.every((g) => g.silhouettes >= 6), groups);
  check('neighboring sample towers have different profiles', groups.every((g) => g.identicalNeighbors === 0));
  // Frozen pre-change ceilings, retained even when no comparison file is supplied.
  const caps = { 'office/4': 1020, 'office/5': 1466, 'comHigh/4': 974, 'comHigh/5': 1310, 'resHigh/4': 2064 };
  check('original triangle ceilings hold', sum <= 469238 && rows.every(r => r.tris <= caps[r.zone + '/' + r.level]), { triangles: sum, cap: 469238 });
  if (process.env.SKYLINE_BASE) {
    const before = JSON.parse(await readFile(process.env.SKYLINE_BASE, 'utf8'));
    const map = new Map(before.rows.map((r) => [r.id, r]));
    check('generator random endpoints and labels unchanged', rows.every((r) => r.state === map.get(r.id)?.state && r.label === map.get(r.id)?.label));
    check('total geometry does not grow', sum <= before.triangles, { before: before.triangles, after: sum });
    check('each family stays within its original worst-model triangle count', families.every(([z, l]) => Math.max(...rows.filter((r) => r.zone === z && r.level === l).map((r) => r.tris)) <= Math.max(...before.rows.filter((r) => r.zone === z && r.level === l).map((r) => r.tris))));
    check('no lot expands beyond its previous bounding rectangle', rows.every((r) => r.bounds.every((v, k) => k % 2 ? v <= map.get(r.id).bounds[k] + 0.01 : v >= map.get(r.id).bounds[k] - 0.01)));
    result.before = { triangles: before.triangles, groups: before.groups };
  }
  result.failures = bad;
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ models: rows.length, triangles: sum, groups, failures: bad }));
} finally { await server.close(); }
process.exitCode = bad ? 1 : 0;
