// Tree variety and placement (docs/GRAPHICS_HANDOFF.md, item 5). Reads the trees of one map (arrays the Trees class keeps)
// and prints, for the set drawn at High (weight <= 1):
//
//   sim     a hash of the simulation's reference set (the trees it counts: position, species, weight, in order), the counts
//           and countIn() at a fixed set of spots. Item 5 is graphics: these must be identical before and after.
//   twins   the share of trees that have an identical-looking neighbour: one of the 5 nearest within 40 m with the same
//           species, model, size (8% bins), hue (0.12 bins), crown width (0.05), lean (0.05) and stand tone (0.4). Lower is
//           more varied. (Fine bins: trees drawn from continuous ranges are rarely twins at that grain, in old or new.)
//   twins2  the same at the grain an eye has: size 25% bins, hue 0.35, crown width 0.1, lean 0.1, stand tone 1.0
//   nn cv   the spread of nearest-neighbour distances (std / mean): a jittered grid is regular (about 0.3), a random scatter is
//           0.52, real woods are clumped (higher). Reported, not a target: the extra trees are at most 12% of the map's own
//           and the map's own positions are the simulation's, so this barely moves.
//   crowd   the share of trees with 3 or more neighbours within 10 m (a grove) and with none within 10 m (a loner)
//   water   the share of trees within 30 m of water (the riparian bands)
//
// usage: BASE_URL=http://127.0.0.1:5175 MAP=appalachia TV_OUT=shots/gfx/tv-old.json node scripts/treevariety.mjs
//        TV_NEW=shots/gfx/tv-new.json TV_BASE=shots/gfx/tv-old.json node scripts/treevariety.mjs   (compare two saved runs)
//        BASE_URL=http://127.0.0.1:5191 MAP=appalachia TV_BASE=shots/gfx/tv-old.json node scripts/treevariety.mjs
// Exits nonzero on failure (with TV_BASE).
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { ARGS, EXE } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const MAP = process.env.MAP || 'appalachia';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };

// TV_NEW=<json> compares a saved run against TV_BASE without loading the game
const fromFile = process.env.TV_NEW;
const browser = fromFile ? null : await chromium.launch({ executablePath: EXE, args: ARGS });
const page = fromFile ? null : await browser.newPage({ viewport: { width: 900, height: 500 } });
const errs = [];
if (page) {
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=${MAP}&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game, null, { timeout: 300000 });
}
const res = fromFile ? JSON.parse(readFileSync(fromFile, 'utf8')) : await page.evaluate(() => {
  const g = window.__game, T = g.trees;
  cancelAnimationFrame(g.raf);
  const n = T.n, X = T.X, Z = T.Z, W = T.W, K = T.K, Vr = T.Vr, S = T.S, H = T.Hue;
  const Ex = T.Ex, Tone = T.Tone, Asp = T.Asp, LX = T.LeanX, LZ = T.LeanZ;
  // the reference set: FNV-1a over position, species and weight, in order
  let hash = 2166136261 >>> 0, ref = 0;
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const mixIn = (v) => { f32[0] = v; hash = Math.imul(hash ^ u32[0], 16777619) >>> 0; };
  for (let i = 0; i < n; i++) {
    if (!(W[i] <= 1) || (Ex && Ex[i])) continue;
    ref++;
    mixIn(X[i]); mixIn(Z[i]); mixIn(W[i]); mixIn(K[i]);
  }
  const spots = [[0, 0], [400, 300], [-600, 200], [900, -700], [-1200, 1100], [2000, 500]];
  const countIn = spots.map(([x, z]) => T.countIn(x, z, 150));
  // the drawn set at High
  const idx = [];
  for (let i = 0; i < n; i++) if (W[i] <= 1) idx.push(i);
  const CELL = 40, cells = new Map();
  for (const i of idx) { const k = Math.floor(X[i] / CELL) + ',' + Math.floor(Z[i] / CELL); let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i); }
  const near = (i, r) => {
    const out = [], cx = Math.floor(X[i] / CELL), cz = Math.floor(Z[i] / CELL), rr = Math.ceil(r / CELL);
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) for (const j of cells.get(cx + a + ',' + (cz + b)) ?? []) {
      if (j === i) continue;
      const d = Math.hypot(X[j] - X[i], Z[j] - Z[i]);
      if (d <= r) out.push([d, j]);
    }
    return out.sort((p, q) => p[0] - q[0]);
  };
  const q = (v, b) => Math.round(v / b);
  const desc = (i) => `${K[i]}|${Vr[i]}|${q(Math.log(S[i]), 0.08)}|${q(H[i], 0.12)}|${Asp ? q(Asp[i], 0.05) : 0}|${LX ? q(LX[i], 0.05) : 0}|${LZ ? q(LZ[i], 0.05) : 0}|${Tone ? q(Tone[i], 0.4) : 0}`;
  const desc2 = (i) => `${K[i]}|${Vr[i]}|${q(Math.log(S[i]), 0.25)}|${q(H[i], 0.35)}|${Asp ? q(Asp[i], 0.1) : 0}|${LX ? q(LX[i], 0.1) : 0}|${LZ ? q(LZ[i], 0.1) : 0}|${Tone ? q(Tone[i], 1.0) : 0}`;
  let twins2 = 0, twins = 0, sn = 0, sn2 = 0, nnN = 0, crowd = 0, lone = 0, sample = 0;
  const STEP = Math.max(1, Math.floor(idx.length / 40000)); // (a sample of up to 40000 trees)
  for (let p = 0; p < idx.length; p += STEP) {
    const i = idx[p];
    const nb = near(i, 40);
    sample++;
    const d0 = desc(i);
    if (nb.slice(0, 5).some(([, j]) => desc(j) === d0)) twins++;
    const e0 = desc2(i);
    if (nb.slice(0, 5).some(([, j]) => desc2(j) === e0)) twins2++;
    if (nb.length) { sn += nb[0][0]; sn2 += nb[0][0] ** 2; nnN++; }
    const c10 = nb.filter(([d]) => d <= 10).length;
    if (c10 >= 3) crowd++;
    if (c10 === 0) lone++;
  }
  const mean = sn / nnN, cv = Math.sqrt(Math.max(0, sn2 / nnN - mean * mean)) / mean;
  // near water: sample the ground at 12 bearings x 3 radii round the tree
  let wet = 0, wsample = 0;
  for (let p = 0; p < idx.length; p += Math.max(1, Math.floor(idx.length / 15000))) {
    const i = idx[p];
    wsample++;
    let hit = false;
    for (let a = 0; a < 12 && !hit; a++) for (const r of [10, 20, 30]) if (g.terrain.h(X[i] + Math.cos(a * 0.5236) * r, Z[i] + Math.sin(a * 0.5236) * r) < 0) { hit = true; break; }
    if (hit) wet++;
  }
  const extra = { total: 0, byKind: {} };
  if (Ex) for (let i = 0; i < n; i++) if (Ex[i] && W[i] <= 1) { extra.total++; extra.byKind[K[i]] = (extra.byKind[K[i]] ?? 0) + 1; }
  return { n, drawn: idx.length, ref, total: T.total, alive: T.alive, hash, countIn, twins: twins / sample, twins2: twins2 / sample, nnMean: mean, nnCv: cv, crowd: crowd / sample, lone: lone / sample, water: wet / wsample, extra };
});
if (!fromFile) console.log(JSON.stringify(res));
if (process.env.TV_OUT && !fromFile) writeFileSync(process.env.TV_OUT, JSON.stringify(res));
if (process.env.TV_BASE) {
  const o = JSON.parse(readFileSync(process.env.TV_BASE, 'utf8'));
  check(`the simulation's tree set is untouched (hash ${o.hash} -> ${res.hash}, ${o.ref} -> ${res.ref} trees, total ${o.total} -> ${res.total})`, o.hash === res.hash && o.ref === res.ref && o.total === res.total && o.alive === res.alive, { old: o, now: res });
  check(`countIn() at six spots is unchanged (${o.countIn} -> ${res.countIn})`, JSON.stringify(o.countIn) === JSON.stringify(res.countIn), { old: o.countIn, now: res.countIn });
  check(`identical-looking neighbours (fine bins): ${(o.twins * 100).toFixed(1)}% -> ${(res.twins * 100).toFixed(1)}% of trees`, res.twins <= o.twins, { old: o.twins, now: res.twins });
  check(`identical-looking neighbours (the grain of an eye): ${(o.twins2 * 100).toFixed(1)}% -> ${(res.twins2 * 100).toFixed(1)}% of trees (target: at most 60% of the old)`, res.twins2 <= o.twins2 * 0.6, { old: o.twins2, now: res.twins2 });
  console.log(`     nearest-neighbour spread cv ${o.nnCv.toFixed(2)} -> ${res.nnCv.toFixed(2)}; groves (3+ neighbours within 10 m) ${(o.crowd * 100).toFixed(1)}% -> ${(res.crowd * 100).toFixed(1)}%; loners ${(o.lone * 100).toFixed(1)}% -> ${(res.lone * 100).toFixed(1)}%`);
  check(`groves are commoner: ${(o.crowd * 100).toFixed(1)}% -> ${(res.crowd * 100).toFixed(1)}% of trees`, res.crowd > o.crowd, { old: o.crowd, now: res.crowd });
  check(`trees within 30 m of water: ${(o.water * 100).toFixed(1)}% -> ${(res.water * 100).toFixed(1)}% (target: at least 1.5x)`, res.water >= o.water * 1.5, { old: o.water, now: res.water });
  check(`drawn trees: ${o.drawn} -> ${res.drawn} (${(((res.drawn / o.drawn) - 1) * 100).toFixed(1)}%; target: at most +12%)`, res.drawn <= o.drawn * 1.12, { old: o.drawn, now: res.drawn });
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser?.close();
process.exit(bad ? 1 : 0);
