// Civic silhouettes (docs/GRAPHICS_HANDOFF.md, item 4). Builds every city service model (the classic Kit models and the
// Asset Vault looks the game wears by default) at its real lot size and measures the SKYLINE of each from the two
// elevations a player sees (front, along z; side, along x): the occluding outline, rasterised at 0.25 m from the generated
// triangles (lot slabs, below 0.4 m, ignored).
//
//   steps  how many times the top of the outline jumps by 0.75 m or more going across it (a plain box is 2)
//   fill   the share of its bounding rectangle the model covers (a plain box is 1; legs and gaps lower it)
//
// Both are the mean of the two elevations. Targets for item 4: the buildings the brief names (school, sheriff, and the
// utilities that read as boxes) gain at least 3 steps each, and no service loses any.
//
// usage: BASE_URL=http://127.0.0.1:5175 SIL_OUT=shots/gfx/sil-old.json node scripts/silhouette.mjs
//        BASE_URL=http://127.0.0.1:5190 SIL_BASE=shots/gfx/sil-old.json SIL_NAMED=school,sheriff:vault,waterPump:vault node scripts/silhouette.mjs
// (a light page: it loads the generators as modules, not the game). Exits nonzero on failure with SIL_BASE.
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
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
await page.goto(`${base}/src/buildings/blocks.ts`, { waitUntil: 'load', timeout: 180000 });
const res = await page.evaluate(async () => {
  const G = await import('/src/buildings/generator.ts');
  const S = await import('/src/buildings/serviceModels.ts');
  const V = await import('/src/vault/vault.ts');
  // (the pack first, with the right base: loadArt() would start it from this page's odd base URL)
  const okp = V.loadVault(new URL('/vault/', location.origin), 90000);
  await G.loadArt();
  const ok = await okp;
  // id, w, d (cells), the vault family the game's default look uses (src/sim/services.ts VAULT_LOOK), smoke on its stacks
  const SVC = [
    ['gasPeaker', 4, 3, 'gas-peaker-plant', 'smoke'], ['coalPlant', 6, 6, 'clean-coal-plant', 'smoke'], ['solarFarm', 6, 4, 'solar-farm'], ['nuclearPlant', 7, 7],
    ['waterPump', 2, 2, 'pump-station'], ['wellTower', 2, 2, 'water-tower'], ['sewageOutfall', 2, 2, 'sewage-outfall'], ['treatmentPlant', 5, 4, 'wastewater-plant'],
    ['landfill', 6, 6], ['incinerator', 4, 4], ['fireStation', 3, 3, 'volunteer-firehouse'], ['sheriff', 3, 3, 'sheriff-substation'], ['clinic', 3, 3, 'copay-castle'],
    ['hospital', 5, 4, 'wallet-er'], ['school', 4, 4], ['college', 6, 5], ['park', 2, 2],
  ];
  const CELL = 0.25, JUMP = 3;
  const skyline = (geo) => {
    const P = geo.getAttribute('position').array, idx = geo.index ? geo.index.array : null;
    const tris = idx ? idx.length / 3 : P.length / 9;
    const vert = (t, k) => { const i = idx ? idx[t * 3 + k] : t * 3 + k; return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; };
    // gather the model's triangles once
    const T = [];
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y1 = 0;
    for (let t = 0; t < tris; t++) {
      const a = vert(t, 0), b = vert(t, 1), c = vert(t, 2);
      if (Math.max(a[1], b[1], c[1]) < 0.4) continue; // a lot slab, a road stripe
      T.push([a, b, c]);
      for (const v of [a, b, c]) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); y1 = Math.max(y1, v[1]); }
    }
    const elev = (ax) => {
      const u0 = ax === 0 ? x0 : z0, u1 = ax === 0 ? x1 : z1;
      const W = Math.max(1, Math.ceil((u1 - u0) / CELL)), H = Math.max(1, Math.ceil(y1 / CELL));
      const g = new Uint8Array(W * H);
      for (const tri of T) {
        const p = tri.map((v) => [(v[ax === 0 ? 0 : 2] - u0) / CELL, v[1] / CELL]);
        const minU = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), maxU = Math.min(W - 1, Math.floor(Math.max(p[0][0], p[1][0], p[2][0])));
        const minV = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), maxV = Math.min(H - 1, Math.floor(Math.max(p[0][1], p[1][1], p[2][1])));
        const [A, B, C] = p, den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
        for (let v = minV; v <= maxV; v++) for (let u = minU; u <= maxU; u++) {
          if (g[v * W + u]) continue;
          if (Math.abs(den) < 1e-9) { g[v * W + u] = 1; continue; } // an edge-on face still leaves its outline
          // any part of the cell inside the triangle (sample the corners and the middle)
          let hit = false;
          for (const [du, dv] of [[0.5, 0.5], [0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) {
            const px = u + du, py = v + dv;
            const l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den, l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den;
            if (l1 >= -0.001 && l2 >= -0.001 && 1 - l1 - l2 >= -0.001) { hit = true; break; }
          }
          if (hit) g[v * W + u] = 1;
        }
      }
      // the outline: the tallest occupied row of each column
      const top = new Int32Array(W); let cover = 0;
      for (let u = 0; u < W; u++) for (let v = 0; v < H; v++) if (g[v * W + u]) { cover++; top[u] = v + 1; }
      let steps = 0, at = top[0];
      for (let u = 1; u < W; u++) if (Math.abs(top[u] - at) >= JUMP) { steps++; at = top[u]; }
      return { steps: steps + 2, fill: cover / (W * H) };
    };
    const a = elev(0), b = elev(1);
    return { steps: (a.steps + b.steps) / 2, fill: (a.fill + b.fill) / 2, tris: tris };
  };
  const out = { vaultOk: ok };
  for (const [id, w, d, fam, stacks] of SVC) {
    const cl = S.serviceModel(id, w, d);
    out[id + ':classic'] = { ...skyline(cl.geometry), height: cl.height };
    if (fam) {
      const vm = G.generateVaultService(fam, w, d, stacks);
      if (vm) out[id + ':vault'] = { ...skyline(vm.geometry), height: vm.height };
    }
  }
  return out;
});
console.log('vault pack loaded:', res.vaultOk);
delete res.vaultOk;
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(24), `steps ${v.steps.toFixed(1)}  fill ${v.fill.toFixed(2)}  tris ${v.tris}  height ${v.height}`);
if (process.env.SIL_OUT) writeFileSync(process.env.SIL_OUT, JSON.stringify(res));
if (process.env.SIL_BASE) {
  const o = JSON.parse(readFileSync(process.env.SIL_BASE, 'utf8'));
  const named = (process.env.SIL_NAMED || '').split(',').filter(Boolean);
  for (const k of Object.keys(res)) {
    if (!o[k]) continue;
    const isNamed = named.includes(k.replace(':classic', '')) || named.includes(k);
    const gain = res[k].steps - o[k].steps;
    if (isNamed) check(`${k}: skyline steps ${o[k].steps.toFixed(1)} -> ${res[k].steps.toFixed(1)}, fill ${o[k].fill.toFixed(2)} -> ${res[k].fill.toFixed(2)}, tris ${o[k].tris} -> ${res[k].tris} (target: at least +3 steps)`, gain >= 3, { old: o[k], now: res[k] });
    else check(`${k}: skyline steps ${o[k].steps.toFixed(1)} -> ${res[k].steps.toFixed(1)} (target: not fewer)`, gain >= -0.01, { old: o[k], now: res[k] });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
