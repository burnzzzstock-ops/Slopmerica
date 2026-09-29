// Draw calls and triangles for the same picture on old and new code (docs/GRAPHICS_HANDOFF.md, item 8: "nothing you add
// should cost a new draw call per building or per tree"). perfTown.mjs grows a different town every run (the building count
// moves from 39 to 42), so its call counts cannot be compared exactly; this opens the saved reference block
// (scripts/refblock.mjs), the same town every time, shoots the four lookbook cameras at noon and reads the renderer's
// counters for that frame: draw calls, triangles, geometries and textures alive, plus the number of visible meshes.
//
// usage: BASE_URL=http://127.0.0.1:5201 node scripts/drawcalls.mjs [presets, default high,low]  (prints JSON lines and a table)
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const presets = (process.argv[2] || 'high,low').split(',');
const VIEWS = { overview: [0, 0, 320, 0.7, 0.6], street: [-40, -30, 110, 2.4, 0.38], houses: [-170, -130, 120, 4.0, 0.42], shore: null };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const rows = [];
for (const q of presets) {
  const { page, center } = await openBlock(browser, { base, quality: q });
  // the street furniture and street trees (civic/layer.ts) stream in on a game-time debounce the stopped loop never spends:
  // without this one run catches them and the next does not (399 or 451 visible meshes on the same street)
  await page.waitForFunction(() => window.__game.civic.status !== 'loading', null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; g.civic.update(2); g.civic.update(2); });
  VIEWS.shore ??= await page.evaluate(({ x, z }) => {
    const T = window.__game.terrain;
    for (let r = 60; r < 1500; r += 20) for (let a = 0; a < 64; a++) {
      const px = x + Math.cos((a / 64) * 6.283) * r, pz = z + Math.sin((a / 64) * 6.283) * r;
      if (T.h(px, pz) < -0.5) return [px - x, pz - z, 90, (a / 64) * 6.283 + 1.2, 0.42];
    }
    return [0, 0, 320, 0.7, 0.6];
  }, center);
  for (const [v, view] of Object.entries(VIEWS)) {
    await shoot(page, center, { hour: 12.5, moon: 0.5, view });
    // eight frames, the counters of each (some passes run on alternate frames, the mirror and the shadow update among them,
    // so one frame's call count is good to about 5%): the median and the largest
    const m = await page.evaluate(() => {
      const g = window.__game;
      const calls = [], tris = [];
      for (let k = 0; k < 8; k++) { g.frame(0.016); calls.push(g.renderer.info.render.calls); tris.push(g.renderer.info.render.triangles); }
      const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
      const i = g.renderer.info;
      let meshes = 0, inst = 0;
      g.scene.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine) { meshes++; if (o.isInstancedMesh) inst++; } });
      const s = g.trees?.shore;
      // what the shore's two meshes add to a pass: one call each while there is anything to draw, and their triangles (27 per reed clump, 80 per stone)
      const shore = s ? { calls: (s.drawn.reeds > 0 ? 1 : 0) + (s.drawn.rocks > 0 ? 1 : 0), triangles: s.drawn.reeds * 27 + s.drawn.rocks * 80, drawn: s.drawn } : null;
      // triangles and submissions by the scene's top-level groups (name, else type), to see which part of the town grew
      const groups = {}, groupCalls = {};
      for (const ch of g.scene.children) {
        if (!ch.visible) continue;
        let t = 0, c = 0;
        ch.traverseVisible((o) => {
          if (!o.isMesh || !o.geometry) return;
          // (one submission per mesh, or per material slot of a multi-material one; the renderer's own frustum test is not applied)
          c += Array.isArray(o.material) ? o.material.length : 1;
          const n = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position?.count ?? 0) / 3;
          const dr = o.geometry.drawRange;
          t += Math.min(n, dr.count === Infinity ? n : dr.count / 3) * (o.isInstancedMesh ? o.count : 1);
        });
        const key = ch.name || ch.type + (ch.children.length ? `(${ch.children.length})` : '');
        groups[key] = (groups[key] || 0) + Math.round(t);
        groupCalls[key] = (groupCalls[key] || 0) + c;
      }
      // each renderer.render() of one frame (the shadow maps are drawn inside the first), as the renderer counts them
      const passes = [];
      const inf = g.renderer.info, render = g.renderer.render.bind(g.renderer), keepReset = inf.autoReset;
      inf.autoReset = false;
      g.renderer.render = (sc, cam) => {
        const c0 = inf.render.calls, t0 = inf.render.triangles;
        render(sc, cam);
        passes.push({ calls: inf.render.calls - c0, tris: inf.render.triangles - t0, target: g.renderer.getRenderTarget() ? 'rt' : 'screen' });
      };
      // (two frames, in case a pass runs only on alternate ones)
      for (let k = 0; k < 2; k++) { inf.reset(); passes.push('|'); g.frame(0.016); }
      // what each top-level group costs the whole frame (its own passes and its shadow casting): hide it, draw two frames, subtract the
      // second one's counters (the game resets the renderer's counters at the start of every frame, so they hold one frame)
      const two = () => { inf.reset(); g.frame(0.016); g.frame(0.016); return [inf.render.calls, inf.render.triangles]; };
      g.renderer.render = render;
      const [c2, t2] = two();
      const cost = {};
      for (const ch of g.scene.children) {
        if (!ch.visible) continue;
        const key = ch.name || ch.type + (ch.children.length ? `(${ch.children.length})` : '');
        ch.visible = false;
        const [c3, t3] = two();
        ch.visible = true;
        const o = (cost[key] ||= [0, 0]);
        o[0] += c2 - c3; o[1] += t2 - t3;
      }
      inf.autoReset = keepReset;
      return { groups, groupCalls, passes, cost, twoFrames: [c2, t2], calls: med(calls), callsMax: Math.max(...calls), triangles: med(tris), geometries: i.memory.geometries, textures: i.memory.textures, visibleMeshes: meshes, instanced: inst, shore };
    });
    rows.push({ q, v, ...m });
    console.log(JSON.stringify({ q, v, ...m }));
  }
  await page.close();
}
await browser.close();
console.log('preset view      calls(median,max)   triangles  geometries textures visibleMeshes instanced  shore per pass (calls, tris)');
for (const r of rows) console.log(`${r.q.padEnd(6)} ${r.v.padEnd(9)} ${String(r.calls).padStart(5)},${String(r.callsMax).padEnd(5)} ${String(r.triangles).padStart(11)} ${String(r.geometries).padStart(10)} ${String(r.textures).padStart(8)} ${String(r.visibleMeshes).padStart(12)} ${String(r.instanced).padStart(9)}  ${r.shore ? r.shore.calls + ', ' + r.shore.triangles : '-'}`);

console.log('triangles by top-level scene group (overview / street / houses / shore): every visible mesh of the group, before the renderer\'s frustum test, so a group that is drawn whole (roads, beds, terrain) is exact and a spread-out one is an upper bound:');
for (const q of presets) {
  const names = [...new Set(rows.filter((r) => r.q === q).flatMap((r) => Object.keys(r.groups)))];
  for (const n of names.sort()) {
    const v = ['overview', 'street', 'houses', 'shore'].map((w) => rows.find((r) => r.q === q && r.v === w)?.groups[n] ?? 0);
    if (Math.max(...v) > 2000) console.log(`${q.padEnd(5)} ${n.padEnd(28)} ${v.map((x) => String(x).padStart(9)).join('')}`);
  }
}

console.log('draw submissions by top-level group (a mesh, or a material slot of one; no frustum test) and the renderer\'s calls per render pass of one frame:');
for (const q of presets) {
  const names = [...new Set(rows.filter((r) => r.q === q).flatMap((r) => Object.keys(r.groupCalls || {})))];
  for (const n of names.sort()) {
    const v = ['overview', 'street', 'houses', 'shore'].map((w) => rows.find((r) => r.q === q && r.v === w)?.groupCalls?.[n] ?? 0);
    if (Math.max(...v) > 0) console.log(`${q.padEnd(5)} ${n.padEnd(28)} ${v.map((x) => String(x).padStart(9)).join('')}`);
  }
  for (const w of ['overview', 'street', 'houses', 'shore']) {
    const r = rows.find((x) => x.q === q && x.v === w);
    if (r?.passes) console.log(`${q.padEnd(5)} ${w.padEnd(9)} passes (calls/kTris): ${r.passes.map((p) => p === '|' ? '|' : `${p.calls}/${Math.round(p.tris / 1000)}${p.target === 'rt' ? 'r' : ''}`).join(' ')}`);
  }
}

console.log('what each top-level group costs one frame (calls / kTris; every pass and the shadow casting included; the group hidden, the frame drawn, the difference taken):');
for (const q of presets) {
  const names = [...new Set(rows.filter((r) => r.q === q).flatMap((r) => Object.keys(r.cost || {})))];
  for (const n of names.sort()) {
    const v = ['overview', 'street', 'houses', 'shore'].map((w) => { const c = rows.find((r) => r.q === q && r.v === w)?.cost?.[n]; return c ? `${c[0]}/${Math.round(c[1] / 1000)}` : '-'; });
    console.log(`${q.padEnd(5)} ${n.padEnd(22)} ${v.map((x) => x.padStart(12)).join('')}`);
  }
  console.log(`${q.padEnd(5)} ${'(whole frame)'.padEnd(22)} ${['overview', 'street', 'houses', 'shore'].map((w) => { const r = rows.find((x) => x.q === q && x.v === w); return r ? `${r.twoFrames[0]}/${Math.round(r.twoFrames[1] / 1000)}` : '-'; }).map((x) => x.padStart(12)).join('')}`);
}
