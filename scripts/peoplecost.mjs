// What the people cost one frame in the reference block (docs/HANDOFF_CARS_LOOK.md item 5: "the people group on Low must stay within 5% of the
// frame time of the old code"): opens the saved block (scripts/refblock.mjs), fills the street with citizens (the pedestrian update, as the game does it),
// then draws the same frames with the people group shown and hidden and reports the difference: draw calls, triangles and wall time per frame (the GL
// queue is drained with finish() after every frame, so the time is the software GPU's too), plus how many people are on the near and far figure.
// Views of the busiest few metres of street: close (24 m), street (60 m, the usual play height) and overview (140 m; VIEWS=close,street,overview). Run it once against the
// old code and once against the new one and compare the "people group" lines.
//
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5181/new node scripts/peoplecost.mjs [low|high] [phone]
//   env: PEOPLE=160 (how many to ask for), ROUNDS=4 (alternations of hidden / shown), FRAMES=4 (frames per measurement), VIEWS=close,street (or add overview),
//        SHOT=prefix writes prefix-close.jpg and prefix-street.jpg
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'low';
const phone = process.argv[3] === 'phone' || quality === 'low';
const want = +(process.env.PEOPLE || 160), rounds = +(process.env.ROUNDS || 4), frames = +(process.env.FRAMES || 4);
const viewNames = (process.env.VIEWS || 'close,street').split(',');
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, center, errs } = await openBlock(browser, { base, quality, phone, width: phone ? 390 : 1280, height: phone ? 844 : 720 });
const r = await page.evaluate(async ({ center, want, rounds, frames, viewNames }) => {
  const g = window.__game;
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
  // the busiest 22 m of pavement
  let best = null, bn = -1;
  for (const p of g.peds.peds) { let n = 0; for (const q of g.peds.peds) if (Math.hypot(p.x - q.x, p.z - q.z) < 22) n++; if (n > bn) { bn = n; best = p; } }
  const at = { x: best.x, z: best.z, n: bn };
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const measure = (show) => {
    group.visible = show;
    const ms = [];
    let calls = 0, tris = 0;
    for (let k = 0; k < frames; k++) { const t0 = performance.now(); g.frame(0.016); gl.finish(); ms.push(performance.now() - t0); calls = info.render.calls; tris = info.render.triangles; }
    return { ms: med(ms), calls, tris };
  };
  const out = [];
  for (const [name, dist, pitch] of [['close', 24, 0.35], ['street', 60, 0.5], ['overview', 140, 0.7]].filter((v) => viewNames.includes(v[0]))) {
    window.__dbg.view(at.x, at.z, dist, 0.9, pitch);
    for (let i = 0; i < 4; i++) g.frame(0.016);
    let near = 0, far = 0, seen = 0;
    for (const p of g.peds.peds) { const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z); if (d <= 64) near++; else far++; if (d < 400) seen++; }
    const off = [], on = [], delta = [];
    measure(true); measure(false);
    for (let k = 0; k < rounds; k++) { const a = measure(false), b = measure(true); off.push(a); on.push(b); delta.push(b.ms - a.ms); }
    group.visible = true;
    const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.floor(f * (a.length - 1))];
    out.push({
      view: name, near, far, hiddenMs: med(off.map((x) => x.ms)), shownMs: med(on.map((x) => x.ms)), deltaMs: med(delta), deltaLo: q(delta, 0.25), deltaHi: q(delta, 0.75),
      calls: med(on.map((x) => x.calls)) - med(off.map((x) => x.calls)), tris: med(on.map((x) => x.tris)) - med(off.map((x) => x.tris)),
    });
  }
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push({ name: o.name, count: o.count, tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, shadow: o.castShadow }); });
  return { peds: g.peds.peds.length, cluster: at, views: out, meshes, quality: g.q.name, group: group.name };
}, { center, want, rounds, frames, viewNames });
// pictures: the busiest few metres of street, from near and from the usual gameplay height
if (process.env.SHOT) {
  for (const [name, dist, pitch] of [['close', 24, 0.35], ['street', 60, 0.5]]) {
    await page.evaluate(({ at, dist, pitch }) => { const g = window.__game; window.__dbg.view(at.x, at.z, dist, 0.9, pitch); for (let i = 0; i < 6; i++) g.frame(0.016); }, { at: r.cluster, dist, pitch });
    await page.screenshot({ path: `${process.env.SHOT}-${name}.jpg`, type: 'jpeg', quality: 85, timeout: 240000 });
  }
}
console.log(JSON.stringify(r));
for (const v of r.views) {
  console.log(`${base} ${quality}${phone ? ' phone' : ''} ${v.view.padEnd(8)}: ${r.peds} people (${v.near} on the near figure, ${v.far} on the far one); people group ${v.calls} draw calls, ${v.tris} triangles, ${v.deltaMs.toFixed(2)} ms (quartiles ${v.deltaLo.toFixed(2)} .. ${v.deltaHi.toFixed(2)}) of ${v.shownMs.toFixed(1)} ms per frame (${(100 * v.deltaMs / v.shownMs).toFixed(1)}%)`);
}
console.log('errors', JSON.stringify(errs.filter((e) => !/WebSocket|\[vite\]|Vite server|status of 404/.test(e)).slice(0, 3)));
await browser.close();
