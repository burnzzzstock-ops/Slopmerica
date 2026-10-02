// What the people cost one frame in the reference block (docs/HANDOFF_CARS_LOOK.md item 5: "the people group on Low must stay within 5% of the
// frame time of the old code"): opens the saved block (scripts/refblock.mjs), fills the street with citizens (the pedestrian update, as the game does it),
// then draws the same frames with the people group shown and hidden and reports the difference: draw calls, triangles and wall time per frame (the GL
// queue is drained with finish() and a one-pixel readback after every frame, so the time is the software GPU's too), plus how many people are on the near and far figure.
// Views of the busiest few metres of street: close (24 m), street (60 m, the usual play height) and overview (140 m; VIEWS=close,street,overview).
//
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5181 node scripts/peoplecost.mjs [low|medium|high|ultra] [phone|desktop]
//   (low defaults to the phone context, 390x844 at 3x with touch; the others to a 1280x720 desktop; the second word overrides)
//   BASES=old=http://127.0.0.1:5231,base=http://127.0.0.1:5210,new=http://127.0.0.1:5234 runs several builds in ONE browser, one game page each, loaded one
//   after the other, and measures them alternately (round by round, build by build): a shared machine's load changes from minute to minute, and a ratio
//   between two runs made at different times measures the load. The last columns say what the group costs relative to the first build.
//   env: PEOPLE=160 (how many to ask for), ROUNDS=4 (alternations of hidden / shown), FRAMES=4 (frames per measurement), VIEWS=close,street (or add overview),
//        SHOT=prefix writes prefix-<build>-close.jpg and -street.jpg (the canvas itself), SEED=7 seeds the pedestrian spawner of the first build, JSON=file
// "Hidden" also switches the pose pass off (the new model works the poses out in one extra draw per frame, outside the group), so the difference
// is everything the people cost the GPU: the group's draws in the view and in the shadow map, plus the pose pass. The old model has no pose pass.
// Every build is shown the first build's people (position, archetype, action, set by hand from then on, legs walking), from the same camera.
// `near` and `far` are what the renderer drew (the near figure's instance count and the far one's), `pose` is one pose pass on its own.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock } from './refblock.mjs';
const bases = process.env.BASES
  ? process.env.BASES.split(',').map((s) => { const i = s.indexOf('='); return { label: s.slice(0, i), url: s.slice(i + 1) }; })
  : [{ label: 'build', url: process.env.BASE_URL || 'http://127.0.0.1:5173' }];
const quality = process.argv[2] || 'low';
const phone = process.argv[3] ? process.argv[3] === 'phone' : quality === 'low';
const want = +(process.env.PEOPLE || 160), rounds = +(process.env.ROUNDS || 4), frames = +(process.env.FRAMES || 4);
const viewNames = (process.env.VIEWS || 'close,street').split(',');
const VIEWS = { close: [24, 0.35], street: [60, 0.5], overview: [140, 0.7] };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });

// per page: fill the street, find the busiest cluster, and leave the helpers on window.__pc
const setup = ({ center, want, frames, seed }) => {
  const g = window.__game;
  // SEED=n: the same people on every build (the pedestrian spawner draws from Math.random), so before and after pictures show the same crowd
  if (seed) { let a = seed >>> 0; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  g.sim.day = 120; g.weather.force('clear', 30); g.weather.settle(); g.env.hour = 12.5; g.hour = 12.5;
  window.__dbg.view(center.x, center.z, 140, 0.7, 0.55);
  g.peds.population = 8000;
  g.peds.outdoorMul = 3;
  // let them out of their doors: 0.2 s of pedestrian time is a couple of spawns
  for (let i = 0; i < 1500 && g.peds.peds.length < want; i++) g.peds.update(0.2, 1, g.rts.target, g.rts.distance, g.time);
  for (let i = 0; i < 40; i++) g.peds.update(0.1, 1, g.rts.target, g.rts.distance, g.time);
  for (let i = 0; i < 6; i++) g.frame(0.016);
  const group = g.scene.getObjectByName('people-aa') ?? g.scene.getObjectByName('people');
  const info = g.renderer.info;
  const gl = g.renderer.getContext();
  const cam = g.camera.position;
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  // (finish() alone returns while the software GPU still has the frame queued: reading one pixel back is what waits for it)
  const px = new Uint8Array(4);
  const rend = g.peds.renderer;
  const hasPose = 'poseOn' in rend, poseWas = rend.poseOn;
  const nearMesh = group.getObjectByName('people-near');
  // the crowd every build is shown: the first build's people (where they stand, which archetype, what they do), set by hand from then on,
  // so the builds draw exactly the same people from exactly the same camera; their legs keep walking
  const state = { at: null, crowd: [] };
  const frame = () => {
    for (const m of state.crowd) { m.t += m.walk ? (0.016 * 1.4) / 1.42 : 0.016; rend.set(m.h, m.x, m.y, m.z, m.yaw, m.action, m.t); }
    g.frame(0.016);
  };
  const exported = g.peds.peds.map((p) => ({ arch: p.arch, x: p.x, y: p.y, z: p.z, yaw: p.ryaw ?? p.yaw ?? 0, action: p.go ? 'walk' : p.action, phase: p.phase }));
  window.__pc = {
    crowd: exported,
    quality: g.q.name,
    adopt(crowd, at) {
      for (const p of g.peds.peds) rend.remove(p.h);
      g.peds.peds.length = 0;
      g.peds.spawnT = 1e12; // nobody else comes out of a door
      state.crowd = crowd.map((c, i) => ({ ...c, h: rend.add(c.arch, i * 7919 + 13), t: c.phase, walk: c.action === 'walk' || c.action === 'run' }));
      state.at = at;
      for (let i = 0; i < 3; i++) frame();
      return state.crowd.length;
    },
    view(dist, pitch) {
      const at = state.at;
      window.__dbg.view(at.x, at.z, dist, at.yaw, pitch);
      for (let i = 0; i < 4; i++) frame();
      let near = 0, far = 0;
      for (const p of state.crowd) { const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z); if (d <= 64) near++; else far++; }
      let lists = null;
      if (nearMesh && rend.listCounts) { if (hasPose) rend.poseOn = poseWas; frame(); near = nearMesh.count; far = state.crowd.length - near; lists = rend.listCounts?.() ?? null; } // what the renderer drew
      return { near, far, lists };
    },
    measure(show) {
      group.visible = show;
      if (hasPose) rend.poseOn = show && poseWas;
      const ms = [];
      let calls = 0, tris = 0;
      for (let k = 0; k < frames; k++) { const t0 = performance.now(); frame(); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t0); calls = info.render.calls; tris = info.render.triangles; }
      return { ms: med(ms), calls, tris };
    },
    restore() { group.visible = true; if (hasPose) rend.poseOn = poseWas; },
    poseMs() {
      if (!hasPose || !poseWas) return 0;
      const ps = [];
      for (let k = 0; k < 6; k++) { const t0 = performance.now(); rend.pose.update(rend.gl, rend.poseCount ?? rend.used); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ps.push(performance.now() - t0); }
      return med(ps);
    },
    meshes() {
      const m = [];
      group.traverse((o) => { if (o.isMesh) m.push({ name: o.name, count: o.count, tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, shadow: o.castShadow }); });
      return m;
    },
    shot(dist, pitch) {
      const at = state.at;
      window.__dbg.view(at.x, at.z, dist, at.yaw, pitch);
      for (let i = 0; i < 5; i++) frame();
      frame();
      return g.renderer.domElement.toDataURL('image/jpeg', 0.85); // (the canvas itself, read in the task that drew it: 585 x 1266 on the phone, not a screenshot's 3x stretch of it)
    },
  };
  return { peds: g.peds.peds.length, crowd: exported };
};

const runs = [];
for (const b of bases) {
  const { page, center, errs } = await openBlock(browser, { base: b.url, quality, phone, width: phone ? 390 : 1280, height: phone ? 844 : 720 });
  const info = await page.evaluate(setup, { center, want, frames, seed: +(process.env.SEED || 0) });
  runs.push({ ...b, page, errs, info });
  console.log(`${b.label}: ${b.url} ${quality}${phone ? ' phone' : ''} loaded, ${info.peds} people came out of their doors`);
}
// every build draws the first build's people: the busiest 22 m of pavement, seen along the street (the way the person in the middle of the cluster
// is walking or facing: people keep to the pavements, and a camera on that line sees down the street instead of at the wall beside it)
const crowd = runs[0].info.crowd;
let best = null, bn = -1;
for (const p of crowd) { let n = 0; for (const q of crowd) if (Math.hypot(p.x - q.x, p.z - q.z) < 22) n++; if (n > bn) { bn = n; best = p; } }
const at = { x: best.x, z: best.z, n: bn, yaw: best.yaw };
for (const r of runs) r.info.peds = await r.page.evaluate(([c, a]) => window.__pc.adopt(c, a), [crowd, at]);
console.log(`the crowd: ${crowd.length} people, the busiest 22 m holds ${bn}, camera over ${at.x.toFixed(0)}, ${at.z.toFixed(0)} looking along ${at.yaw.toFixed(2)} rad`);

const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.floor(f * (a.length - 1))];
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const results = [];
for (const view of viewNames) {
  const [dist, pitch] = VIEWS[view];
  for (const r of runs) r.v = await r.page.evaluate(([d, p]) => window.__pc.view(d, p), [dist, pitch]);
  for (const r of runs) { await r.page.evaluate(() => window.__pc.measure(true)); await r.page.evaluate(() => window.__pc.measure(false)); r.off = []; r.on = []; r.delta = []; }
  for (let k = 0; k < rounds; k++) {
    for (const r of runs) {
      const a = await r.page.evaluate(() => window.__pc.measure(false));
      const b = await r.page.evaluate(() => window.__pc.measure(true));
      r.off.push(a); r.on.push(b); r.delta.push(b.ms - a.ms);
    }
  }
  for (const r of runs) {
    await r.page.evaluate(() => window.__pc.restore());
    r.poseMs = await r.page.evaluate(() => window.__pc.poseMs());
    r.res = {
      build: r.label, view, peds: r.info.peds, near: r.v.near, far: r.v.far, lists: r.v.lists, poseMs: r.poseMs,
      hiddenMs: med(r.off.map((x) => x.ms)), shownMs: med(r.on.map((x) => x.ms)), deltaMs: med(r.delta), deltaLo: q(r.delta, 0.25), deltaHi: q(r.delta, 0.75),
      calls: med(r.on.map((x) => x.calls)) - med(r.off.map((x) => x.calls)), tris: med(r.on.map((x) => x.tris)) - med(r.off.map((x) => x.tris)),
    };
    results.push(r.res);
  }
  const first = runs[0].res;
  for (const r of runs) {
    const v = r.res;
    console.log(`${view.padEnd(8)} ${v.build.padEnd(6)} ${quality}${phone ? ' phone' : ''}: ${v.peds} people (${v.near} near, ${v.far} far${v.lists ? `; lists: far ${v.lists.far}, shadow ${v.lists.shadow}, pose ${v.lists.pose}` : ''}); people ${v.calls} draw calls (+1 pose pass), ${v.tris} triangles, ${v.deltaMs.toFixed(0)} ms (quartiles ${v.deltaLo.toFixed(0)} .. ${v.deltaHi.toFixed(0)}; pose pass alone ${v.poseMs.toFixed(0)} ms) of ${v.shownMs.toFixed(0)} ms per frame; ${first.deltaMs > 100 ? `${(100 * v.deltaMs / first.deltaMs).toFixed(0)}% of ${first.build}'s time, ` : ''}${(100 * v.tris / Math.max(1, first.tris)).toFixed(0)}% of ${first.build}'s triangles`);
  }
}
// pictures: the busiest few metres of street, from near and from the usual gameplay height
if (process.env.SHOT) {
  for (const r of runs) {
    for (const [name, [dist, pitch]] of [['close', VIEWS.close], ['street', VIEWS.street]]) {
      const url = await r.page.evaluate(([d, p]) => window.__pc.shot(d, p), [dist, pitch]);
      writeFileSync(`${process.env.SHOT}-${r.label}-${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    }
  }
}
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(results, null, 1));
for (const r of runs) console.log(r.label, 'meshes', JSON.stringify(await r.page.evaluate(() => window.__pc.meshes())), 'errors', JSON.stringify(r.errs.filter((e) => !/WebSocket|\[vite\]|Vite server|status of 404/.test(e)).slice(0, 3)));
await browser.close();
