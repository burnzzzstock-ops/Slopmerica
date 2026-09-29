// Long blank walls (docs/GRAPHICS_HANDOFF.md, item 3). Generates the commercial buildings (comLow, comHigh) across sizes,
// levels and variants and measures, on every side of each, the LARGEST UNBROKEN WALL PLANE: the biggest rectangle of wall
// (metres squared) that is one plain wall material on one plane, with nothing standing proud of it (no pilaster, plinth,
// band, sign, awning, decal) and no opening (storefront, door, window) in it. Walls are found from the generated
// triangles themselves, so the same script runs on the old generators and the new:
//
//   * a wall triangle is near-vertical, facing +z/-z/+x/-x, and painted with a plain wall tile (stucco, tilt-up, brick,
//     cinder, concrete, metal panel, ...);
//   * per side the wall is looked at square-on in 0.25 m cells; a cell is blank when its outermost wall triangle has
//     nothing in front of it (a pilaster, a sign, an awning, a car) and no non-wall triangle on the same plane;
//   * the plane is a 0.1 m depth bin (a stepped-out anchor store is another plane), and the figure for a building is
//     its worst side.
//
// (BW_DETAIL=mall prints the per-side figures of a group.)
// Targets: for strip malls and big commercial boxes (the walls the brief names) the median worst plane is at most 45% of
// the old, and no size class gets worse. The script also prints how many triangles the buildings cost.
//
// usage: BASE_URL=http://127.0.0.1:5175 BW_OUT=shots/gfx/bw-old.json node scripts/blankwalls.mjs
//        BASE_URL=http://127.0.0.1:5185 BW_BASE=shots/gfx/bw-old.json node scripts/blankwalls.mjs
// (a light page: it loads the generators as modules, not the game). Exits nonzero on failure with BW_BASE.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { ARGS, EXE } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); }); // (a favicon 404 is not an error)
// (a module URL is a text document that can still import(): no game boots)
await page.goto(`${base}/src/buildings/blocks.ts`, { waitUntil: 'load', timeout: 180000 });
const res = await page.evaluate(async () => {
  const G = await import('/src/buildings/generator.ts');
  const A = await import('/src/art/index.ts');
  await G.loadArt();
  const tiles = A.tileNames().map((n) => A.T(n));
  const tileAt = (u, v) => { for (const t of tiles) if (u >= t.u0 - 1e-4 && u <= t.u1 + 1e-4 && v >= t.v0 - 1e-4 && v <= t.v1 + 1e-4) return t.name; return ''; };
  const WALLS = new Set(['concrete', 'brick', 'brickTan', 'brickDark', 'stucco', 'cinder', 'tiltup', 'metalPanel', 'corrugated', 'corrugatedRust', 'dcWall']);
  const CELL = 0.25, BIN = 0.1;

  // the biggest all-true rectangle of a W x H grid, in cells
  const maxRect = (g, W, H) => {
    const h = new Int32Array(W); let best = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) h[x] = g[y * W + x] ? h[x] + 1 : 0;
      const st = [];
      for (let x = 0; x <= W; x++) {
        const cur = x === W ? 0 : h[x];
        while (st.length && h[st[st.length - 1]] >= cur) { const hh = h[st.pop()]; const l = st.length ? st[st.length - 1] + 1 : 0; best = Math.max(best, hh * (x - l)); }
        st.push(x);
      }
    }
    return best;
  };

  const measure = (geo) => {
    const P = geo.getAttribute('position').array, N = geo.getAttribute('normal').array, UV = geo.getAttribute('uv').array;
    const nt = P.length / 9;
    // per triangle: axis side (0 +z, 1 -z, 2 +x, 3 -x, -1 none), plane depth, u, y extents, tile
    const tris = [];
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const nx = N[o], ny = N[o + 1], nz = N[o + 2];
      let side = -1;
      if (Math.abs(ny) < 0.2) { if (nz > 0.9) side = 0; else if (nz < -0.9) side = 1; else if (nx > 0.9) side = 2; else if (nx < -0.9) side = 3; }
      const tile = tileAt((UV[t * 6] + UV[t * 6 + 2] + UV[t * 6 + 4]) / 3, (UV[t * 6 + 1] + UV[t * 6 + 3] + UV[t * 6 + 5]) / 3);
      tris.push({ o, side, tile, wall: side >= 0 && WALLS.has(tile) });
    }
    const out = { worst: 0, share: 0, wallArea: 0, blankArea: 0, sides: [] };
    let totalWall = 0, totalBlank = 0;
    for (let side = 0; side < 4; side++) {
      const cand = tris.filter((q) => q.wall && q.side === side);
      if (!cand.length) continue;
      // project: u along the wall (left to right seen from outside), d = how far out
      const proj = (o) => {
        const pts = [];
        for (let k = 0; k < 3; k++) {
          const x = P[o + k * 3], y = P[o + k * 3 + 1], z = P[o + k * 3 + 2];
          pts.push(side === 0 ? [x, y, z] : side === 1 ? [-x, y, -z] : side === 2 ? [-z, y, x] : [z, y, -x]);
        }
        return pts;
      };
      let u0 = Infinity, u1 = -Infinity, ytop = 0;
      const cp = cand.map((q) => { const pts = proj(q.o); for (const p of pts) { u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); ytop = Math.max(ytop, p[1]); } return pts; });
      const W = Math.max(1, Math.ceil((u1 - u0) / CELL)), H = Math.max(1, Math.ceil(ytop / CELL));
      if (W * H > 400000) continue;
      // outermost wall triangle per cell
      const depth = new Float32Array(W * H).fill(-1e9);
      const raster = (pts, fn) => {
        const xs = pts.map((p) => (p[0] - u0) / CELL), ys = pts.map((p) => p[1] / CELL);
        const ax = Math.max(0, Math.floor(Math.min(...xs))), bx = Math.min(W - 1, Math.ceil(Math.max(...xs)));
        const ay = Math.max(0, Math.floor(Math.min(...ys))), by = Math.min(H - 1, Math.ceil(Math.max(...ys)));
        for (let j = ay; j <= by; j++) for (let i = ax; i <= bx; i++) {
          const cx = i + 0.5, cy = j + 0.5;
          const s = (xs[1] - xs[0]) * (cy - ys[0]) - (ys[1] - ys[0]) * (cx - xs[0]);
          const t2 = (xs[2] - xs[1]) * (cy - ys[1]) - (ys[2] - ys[1]) * (cx - xs[1]);
          const t3 = (xs[0] - xs[2]) * (cy - ys[2]) - (ys[0] - ys[2]) * (cx - xs[2]);
          if ((s >= 0 && t2 >= 0 && t3 >= 0) || (s <= 0 && t2 <= 0 && t3 <= 0)) fn(j * W + i);
        }
      };
      cp.forEach((pts) => { const d = pts[0][2]; raster(pts, (c) => { if (d > depth[c]) depth[c] = d; }); });
      // anything standing proud of, or opening in, the cell's plane
      const broken = new Uint8Array(W * H);
      const wallSet = new Set(cand.map((q) => q.o));
      for (const q of tris) {
        if (wallSet.has(q.o) && q.wall && q.side === side) continue;
        const pts = proj(q.o);
        const dmin = Math.min(pts[0][2], pts[1][2], pts[2][2]), dmax = Math.max(pts[0][2], pts[1][2], pts[2][2]);
        if (dmin > 400) continue;
        const nonWall = !(q.wall && q.side === side);
        raster(pts, (c) => {
          const d = depth[c];
          if (d < -1e8 || broken[c]) return;
          // (proud of the plane and within reach of it; or on the plane and not a wall material)
          if (dmax > d + 0.03) broken[c] = 1; // (anything in front of the wall, near or far, covers it: a wall behind an atrium is not a plane you see)
          else if (nonWall && !WALLS.has(q.tile) && dmax >= d - 0.02) broken[c] = 1;
        });
      }
      // blank cells by depth bin, the biggest rectangle in any bin
      const bins = new Map();
      let wallCells = 0, blankCells = 0;
      for (let c = 0; c < W * H; c++) {
        if (depth[c] < -1e8) continue;
        wallCells++;
        if (broken[c]) continue;
        blankCells++;
        const b = Math.round(depth[c] / BIN);
        if (!bins.has(b)) bins.set(b, new Uint8Array(W * H));
        bins.get(b)[c] = 1;
      }
      let best = 0;
      for (const g of bins.values()) best = Math.max(best, maxRect(g, W, H));
      const area = best * CELL * CELL;
      out.sides.push(+area.toFixed(1));
      out.worst = Math.max(out.worst, area);
      totalWall += wallCells * CELL * CELL; totalBlank += blankCells * CELL * CELL;
    }
    out.wallArea = totalWall; out.blankArea = totalBlank; out.share = totalWall ? totalBlank / totalWall : 0;
    out.tris = nt;
    return out;
  };

  const rows = [];
  const sizes = [[2, 2], [3, 2], [3, 3], [4, 3]];
  for (const zone of ['comLow', 'comHigh']) for (let level = 1; level <= 5; level++) for (const [w, d] of sizes) {
    const seen = new Set();
    for (let seed = 0; seed < 90 && seen.size < 16; seed++) {
      const m = G.generateBuilding({ zone, level, widthCells: w, depthCells: d, seed, style: 'blankwalls' });
      const key = m.label + '|' + m.height.toFixed(2) + '|' + m.geometry.getAttribute('position').count;
      if (seen.has(key)) { m.geometry.dispose(); continue; }
      seen.add(key);
      const r = measure(m.geometry);
      rows.push({ zone, level, w, d, label: m.label, height: +m.height.toFixed(1), worst: +r.worst.toFixed(1), sides: r.sides, wall: +r.wallArea.toFixed(0), tris: r.tris });
      m.geometry.dispose();
    }
  }
  return rows;
});
const group = (r) => {
  if (r.zone === 'comLow' && /\(\d+ units/.test(r.label)) return 'strip';
  if (r.zone === 'comHigh' && /Galleria/.test(r.label)) return 'mall';
  if (r.zone === 'comHigh' && r.height <= 16 && !/hotel|inn|suites|tower/i.test(r.label)) return 'commercial box (comHigh, low)';
  if (r.zone === 'comLow') return 'other comLow (shops, gas, food)';
  return 'other comHigh';
};
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const stats = {};
for (const r of res) { const k = group(r); (stats[k] ??= []).push(r); }
const summary = {};
for (const [k, list] of Object.entries(stats)) {
  summary[k] = { n: list.length, worst: med(list.map((r) => r.worst)), tris: med(list.map((r) => r.tris)), big: list.filter((r) => r.worst > 60).length };
  console.log(k.padEnd(34), JSON.stringify(summary[k]));
}
if (process.env.BW_DETAIL) for (const r of res.filter((r) => group(r) === process.env.BW_DETAIL).slice(0, 12)) console.log('   ', r.label.slice(0, 40).padEnd(40), r.level, `${r.w}x${r.d}`, 'h', r.height, 'sides +z,-z,+x,-x order:', JSON.stringify(r.sides));
if (process.env.BW_OUT) writeFileSync(process.env.BW_OUT, JSON.stringify({ rows: res, summary }));
if (process.env.BW_BASE) {
  const o = JSON.parse(readFileSync(process.env.BW_BASE, 'utf8')).summary;
  for (const k of ['strip', 'mall', 'commercial box (comHigh, low)']) {
    if (!o[k] || !summary[k]) { check(`${k}: measured`, false, { old: o[k], now: summary[k] }); continue; }
    check(`${k}: largest unbroken plane ${o[k].worst} -> ${summary[k].worst} m2 (median of ${summary[k].n}; target: at most 45% of the old)`, summary[k].worst <= o[k].worst * 0.45, { old: o[k], now: summary[k] });
  }
  for (const k of Object.keys(summary)) if (o[k]) check(`${k}: not worse (${o[k].worst} -> ${summary[k].worst} m2)`, summary[k].worst <= o[k].worst * 1.02, { old: o[k], now: summary[k] });
  for (const k of Object.keys(summary)) if (o[k]) console.log(`    ${k}: triangles per building ${o[k].tris} -> ${summary[k].tris} (${((summary[k].tris / o[k].tris - 1) * 100).toFixed(1)}%)`);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
