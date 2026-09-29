// Road wear check (docs/ART_DIRECTION.md, graphics handoff item 1). Reads the road textures the renderer built
// (roads.typeMats[*].map.image, and the junction's asphalt tile) and measures them, so the same script runs against
// the old code and the new:
//
//   patchiness   standard deviation of the 1.5 m block means of luminance over the carriageway, paint left out
//                (a block holding any paint is skipped), with each column's own mean taken out so that a stripe down the
//                whole road counts for nothing: variation ALONG the road, which is what breaks up a flat slab. Flat
//                asphalt reads well under 1 (per-pixel noise averages out); worn asphalt reads several levels. Mean
//                over the paved road types. (The raw block std, stripes included, is printed too.)
//   mean tone    mean luminance of every unpainted carriageway pixel (2 px clear of paint). Wear must not move it (target within 2
//                levels of the old code): the night targets in docs/ART_DIRECTION.md are set on that tone.
//   edge grime   unpainted pixels in the 0.25 m beside the gutter, minus the unpainted middle of the outer lane
//                (1.45 to 1.85 m in). The old asphalt ran to the gutter unchanged (about 0).
//   linear tone  mean linear-light luminance (what the lighting averages) of the unpainted carriageway (within 4%) and of
//                the walks with their gutter pans (within 2.5%) of the build the wear was added to. The gutter pans on their
//                own read darker (dirt in the pans): the walks are lifted to hold the pair's tone
//   junction     the same patchiness for the junction's 8 m asphalt tile.
//
// usage: BASE_URL=http://127.0.0.1:5175 WEAR_OUT=shots/gfx/wear-old.json node scripts/roadwear.mjs [quality]
//        BASE_URL=http://127.0.0.1:5178 WEAR_BASE=shots/gfx/wear-old.json node scripts/roadwear.mjs [quality]
// With WEAR_BASE it also checks the targets against that run; `node scripts/roadwear.mjs --compare old.json new.json`
// [tone-base.json] checks two saved runs without a browser (the optional third file is the build the tone is held against:
// the one just before the wear went in). Exits nonzero on failure.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'low';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };

const compare = (o, now, base = o) => {
  const ids = Object.keys(now.types), { std, mean, edge } = now, m = now;
  check(`patchiness along the road ${o.std.toFixed(2)} -> ${std.toFixed(2)} (target: at least 2, and at least 3x the old)`, std >= 2 && std >= o.std * 3, { old: o.std, now: std });
  check(`mean tone ${o.mean.toFixed(2)} -> ${mean.toFixed(2)} (target: within 2 levels)`, Math.abs(mean - o.mean) <= 2, { old: o.mean, now: mean });
  for (const id of ids) if (o.types[id]) check(`${id}: mean tone ${o.types[id].mean.toFixed(1)} -> ${m.types[id].mean.toFixed(1)}`, Math.abs(m.types[id].mean - o.types[id].mean) <= 2.5, { old: o.types[id], now: m.types[id] });
  // Tone is compared with `base`: the build the wear was added to (the sidewalks and gutter pans were repainted lighter, as concrete,
  // in the curb-section commit; the wear must not move them from where THAT left them). Carriageway pixels next to paint are left
  // out of the measurement, and the edge grime lives beside the paint, so that figure carries a few percent of bias: 4% allowed.
  for (const id of ids) if (base.types[id] && base.types[id].lin !== undefined) {
    const rel = (a, b) => (b - a) / a * 100, ot = base.types[id], nt = m.types[id];
    check(`${id}: linear-light tone carriageway ${(rel(ot.lin, nt.lin)).toFixed(1)}%${Number.isFinite(ot.walkLin) ? `, walk with gutter ${rel(ot.walkLin, nt.walkLin).toFixed(1)}%` : ''} (targets: carriageway within 4%, walk with its gutter within 2.5%)`,
      Math.abs(rel(ot.lin, nt.lin)) <= 4 && (!Number.isFinite(ot.walkLin) || (Math.abs(rel(ot.walkLin, nt.walkLin)) <= 2.5)), { base: ot, now: nt });
  }
  check(`edge grime ${o.edge.toFixed(2)} -> ${edge.toFixed(2)} over the ${Object.keys(m.types).filter((id) => Number.isFinite(m.types[id].edgeMinusMid)).length} road types with a clean strip (target: at least 4 levels darker than the lane centre)`, edge < o.edge - 4, { old: o.edge, now: edge });
  check(`junction patchiness ${o.junction.std.toFixed(2)} -> ${m.junction.std.toFixed(2)}, mean ${o.junction.mean.toFixed(1)} -> ${m.junction.mean.toFixed(1)}`, m.junction.std >= 2 && m.junction.std >= o.junction.std * 3 && Math.abs(m.junction.mean - o.junction.mean) <= 2 && (base.junction.lin === undefined || Math.abs((m.junction.lin - base.junction.lin) / base.junction.lin) <= 0.025), { old: o.junction, now: m.junction });
};
// offline: node scripts/roadwear.mjs --compare old.json new.json
if (process.argv[2] === '--compare') {
  const o = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  compare(o, JSON.parse(readFileSync(process.argv[4], 'utf8')), process.argv[5] ? JSON.parse(readFileSync(process.argv[5], 'utf8')) : o);
  process.exit(bad ? 1 : 0);
}

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, quality });
const m = await page.evaluate(async () => {
  const g = window.__game;
  const { ROAD_TYPES } = await import('/src/roads/roadTypes.ts');
  const GUTTER = 0.3; // (the gutter pan's width, roads/roadSection.ts; a literal here so the script also runs against code from before that file existed)
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const painted = (d, i) => lum(d, i) > 150 || d[i] - d[i + 2] > 32; // white and yellow paint
  // Blocks are 1.5 m square in the road's own metres (`ppmX` px per metre across, `ppmY` along), the scale of the
  // patchiness you see from the gameplay camera. A block is skipped if paint lies inside it or within 2 px of it
  // (anti-aliased edges never count); `skipX` is the raised median's columns.
  const blocks = (img, x0, x1, ppmX, ppmY, skipX, M = 1.5) => {
    const ctx = img.getContext('2d'), W = img.width, H = img.height, d = ctx.getImageData(0, 0, W, H).data;
    const BX = Math.max(4, Math.round(M * ppmX)), BY = Math.max(4, Math.round(M * ppmY));
    const means = [], cols = new Map();
    let ps = 0, pn = 0;
    for (let by = 0; by + BY <= H; by += BY) for (let bx = Math.ceil(x0 / BX) * BX; bx + BX <= x1; bx += BX) {
      if (skipX && bx + BX > skipX[0] && bx < skipX[1]) continue;
      let s = 0, skip = false;
      for (let y = Math.max(0, by - 2); y < Math.min(H, by + BY + 2) && !skip; y++) for (let x = Math.max(0, bx - 2); x < Math.min(W, bx + BX + 2); x++) {
        if (painted(d, (y * W + x) * 4)) { skip = true; break; }
        if (y >= by && y < by + BY && x >= bx && x < bx + BX) s += lum(d, (y * W + x) * 4);
      }
      if (!skip) { means.push(s / (BX * BY)); (cols.get(bx) || cols.set(bx, []).get(bx)).push(s / (BX * BY)); }
    }
    // mean tone over every unpainted carriageway pixel (2 px clear of paint), not just the whole blocks: this is the figure the night targets depend on
    const paintNear = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (painted(d, (y * W + x) * 4)) for (let v = Math.max(0, y - 2); v <= Math.min(H - 1, y + 2); v++) for (let u = Math.max(0, x - 2); u <= Math.min(W - 1, x + 2); u++) paintNear[v * W + u] = 1;
    for (let y = 0; y < H; y++) for (let x = Math.ceil(x0); x < Math.floor(x1); x++) { if (skipX && x > skipX[0] && x < skipX[1]) continue; if (!paintNear[y * W + x]) { ps += lum(d, (y * W + x) * 4); pn++; } }
    const n = means.length, mean = n ? means.reduce((a, v) => a + v, 0) / n : NaN;
    // along-the-road patchiness: the same block means with each column's own mean taken out, so a stripe that runs the
    // length of the road (the old flat oil bands) counts for nothing and only variation ALONG the road does
    // (columns of fewer than 4 blocks are left out; n/(n-1) undoes the variance the column mean absorbs)
    let ss = 0, sn = 0;
    for (const col of cols.values()) if (col.length >= 4) { const cm = col.reduce((a, v) => a + v, 0) / col.length; for (const v of col) ss += ((v - cm) ** 2) * (col.length / (col.length - 1)); sn += col.length; }
    return { blockMean: mean, mean: pn ? ps / pn : NaN, std: n ? Math.sqrt(means.reduce((a, v) => a + (v - mean) ** 2, 0) / n) : NaN, along: sn ? Math.sqrt(ss / sn) : NaN, blocks: n };
  };
  // unpainted pixels of a column range, 2 px clear of any paint (anti-aliased edges included)
  const strip = (img, xa, xb) => {
    const ctx = img.getContext('2d'), W = img.width, H = img.height, d = ctx.getImageData(0, 0, W, H).data;
    const near = (x, y) => { for (let v = Math.max(0, y - 2); v <= Math.min(H - 1, y + 2); v++) for (let u = Math.max(0, x - 2); u <= Math.min(W - 1, x + 2); u++) if (painted(d, (v * W + u) * 4)) return true; return false; };
    let s = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = Math.round(xa); x < Math.round(xb); x++) if (!near(x, y)) { s += lum(d, (y * W + x) * 4); n++; }
    return n ? s / n : NaN;
  };
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  // mean LINEAR-light luminance (what lighting and the eye average) of the unpainted pixels in column ranges
  // (`all`: every pixel of the ranges. The paint filter is for the carriageway: the pale sidewalk concrete is itself brighter
  // than the 'paint' threshold, so filtering it kept only its darker joints and edges and measured the wrong thing.)
  const linTone = (img, ranges, skipX, all = false) => {
    const ctx = img.getContext('2d'), W = img.width, H = img.height, d = ctx.getImageData(0, 0, W, H).data;
    let s = 0, n = 0;
    for (let y = 0; y < H; y++) for (const [xa, xb] of ranges) for (let x = Math.ceil(xa); x < Math.floor(xb); x++) {
      if (skipX && x > skipX[0] && x < skipX[1]) continue;
      let near = false;
      if (!all) for (let v = Math.max(0, y - 2); v <= Math.min(H - 1, y + 2) && !near; v++) for (let u = Math.max(0, x - 2); u <= Math.min(W - 1, x + 2); u++) if (painted(d, (v * W + u) * 4)) { near = true; break; }
      if (near) continue;
      const i = (y * W + x) * 4;
      s += lin(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); n++;
    }
    return n ? s / n : NaN;
  };
  const out = { types: {}, junction: null };
  for (const [id, mat] of g.roads.typeMats) {
    const t = ROAD_TYPES[id];
    if (id === 'gravel' || !mat.map) continue;
    const img = mat.map.image, W = img.width, px = (mtr) => (mtr / t.width) * W;
    const x0 = px(t.sidewalk) + (t.sidewalk > 0 ? px(GUTTER) : 0), x1 = W - x0;
    const half = px(t.median / 2), b = blocks(img, x0, x1, W / t.width, img.height / 12, t.median > 0 ? [W / 2 - half - 3, W / 2 + half + 3] : null);
    const edge = strip(img, x0, x0 + px(0.25)), mid = strip(img, x0 + px(1.45), x0 + px(1.85)); // (the lane's centre, clear of the wheel paths)
    const skipX = t.median > 0 ? [W / 2 - half - 3, W / 2 + half + 3] : null, gp = px(GUTTER), sp = px(t.sidewalk);
    out.types[id] = {
      mean: b.mean, blockMean: b.blockMean, std: b.std, along: b.along, blocks: b.blocks, edgeMinusMid: edge - mid,
      lin: linTone(img, [[x0, x1]], skipX), walkLin: t.sidewalk > 0 ? linTone(img, [[0, sp + gp], [W - sp - gp, W]], null, true) : NaN, gutLin: t.sidewalk > 0 ? linTone(img, [[sp, sp + gp], [W - sp - gp, W - sp]], null, true) : NaN,
    };
  }
  const jimg = g.roads.junctionMesh.material.map.image;
  out.junction = { ...blocks(jimg, 0, jimg.width, jimg.width / 8, jimg.height / 8, null), lin: linTone(jimg, [[0, jimg.width]], null) };
  return out;
});
console.log(JSON.stringify(m));
const ids = Object.keys(m.types);
const avg = (f) => ids.reduce((a, id) => a + f(m.types[id]), 0) / ids.length;
const finite = ids.filter((id) => Number.isFinite(m.types[id].edgeMinusMid));
const std = avg((t) => t.along), rawStd = avg((t) => t.std), mean = avg((t) => t.mean), edge = finite.length ? finite.reduce((a, id) => a + m.types[id].edgeMinusMid, 0) / finite.length : NaN; // (a wide road's edge is all paint: no clean pixels to measure, so those types are left out)
console.log(`patchiness (along the road) ${std.toFixed(2)}  raw block std ${rawStd.toFixed(2)}  mean tone ${mean.toFixed(2)}  edge grime ${edge.toFixed(2)}  junction std ${m.junction.std.toFixed(2)} mean ${m.junction.mean.toFixed(2)}  (${ids.length} road types)`);
if (process.env.WEAR_OUT) writeFileSync(process.env.WEAR_OUT, JSON.stringify({ std, rawStd, mean, edge, junction: m.junction, types: m.types }));
if (process.env.WEAR_BASE) compare(JSON.parse(readFileSync(process.env.WEAR_BASE, 'utf8')), { std, mean, edge, junction: m.junction, types: m.types });
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
