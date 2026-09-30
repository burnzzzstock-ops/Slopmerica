// What the people cost one frame in the reference block (docs/HANDOFF_CARS_LOOK.md item 5: "the people group on Low must stay within 5% of the
// old code"): opens the saved block (scripts/refblock.mjs), fills the street with citizens (the pedestrian update, as the game does it), then
// draws the same frames with the people group shown and hidden and reports the difference: draw calls, triangles and wall time per frame, plus how many
// people are on the near and far figure. Run it once against the old code and once against the new one and compare.
//
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5181/new node scripts/peoplecost.mjs [low|high] [phone]
//   env: PEOPLE=100 (how many to ask for), ROUNDS=6 (alternations of hidden / shown), FRAMES=6 (frames per measurement)
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'low';
const phone = process.argv[3] === 'phone' || quality === 'low';
const want = +(process.env.PEOPLE || 100), rounds = +(process.env.ROUNDS || 6), frames = +(process.env.FRAMES || 6);
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, center, errs } = await openBlock(browser, { base, quality, phone, width: phone ? 390 : 1280, height: phone ? 844 : 720 });
const r = await page.evaluate(async ({ center, want, rounds, frames }) => {
  const g = window.__game;
  g.sim.day = 120; g.weather.force('clear', 30); g.weather.settle(); g.env.hour = 12.5; g.hour = 12.5;
  window.__dbg.view(center.x, center.z, 140, 0.7, 0.55);
  g.peds.population = 6000;
  g.peds.outdoorMul = 1.2;
  // let them out of their doors: 0.2 s of pedestrian time is a couple of spawns
  for (let i = 0; i < 400 && g.peds.peds.length < want; i++) g.peds.update(0.2, 1, g.rts.target, g.rts.distance, g.time);
  for (let i = 0; i < 40; i++) g.peds.update(0.1, 1, g.rts.target, g.rts.distance, g.time);
  for (let i = 0; i < 6; i++) g.frame(0.016);
  const group = g.scene.getObjectByName('people-aa') ?? g.scene.getObjectByName('people');
  const info = g.renderer.info;
  const cam = g.camera.position;
  let near = 0, far = 0;
  for (const p of g.peds.peds) { const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z); if (d <= 64) near++; else far++; }
  const measure = (show) => {
    group.visible = show;
    const ms = [];
    let calls = 0, tris = 0;
    for (let k = 0; k < frames; k++) { const t0 = performance.now(); g.frame(0.016); ms.push(performance.now() - t0); calls = info.render.calls; tris = info.render.triangles; }
    ms.sort((a, b) => a - b);
    return { ms: ms[ms.length >> 1], calls, tris };
  };
  const on = [], off = [];
  for (let k = 0; k < rounds; k++) { off.push(measure(false)); on.push(measure(true)); }
  group.visible = true;
  const med = (a, key) => a.map((x) => x[key]).sort((x, y) => x - y)[a.length >> 1];
  // the people group alone: draw calls and triangles by mesh
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push({ name: o.name, count: o.count, tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, shadow: o.castShadow }); });
  return { peds: g.peds.peds.length, near, far, hiddenMs: med(off, 'ms'), shownMs: med(on, 'ms'), deltaMs: med(on, 'ms') - med(off, 'ms'), callsHidden: med(off, 'calls'), callsShown: med(on, 'calls'), trisHidden: med(off, 'tris'), trisShown: med(on, 'tris'), meshes, quality: g.q.name, group: group.name };
}, { center, want, rounds, frames });
// pictures: the busiest few metres of street, from near and from the usual gameplay height (SHOT=prefix writes prefix-near.jpg / prefix-street.jpg)
if (process.env.SHOT) {
  const at = await page.evaluate(() => {
    const g = window.__game;
    let best = null, bn = -1;
    for (const p of g.peds.peds) { let n = 0; for (const q of g.peds.peds) if (Math.hypot(p.x - q.x, p.z - q.z) < 22) n++; if (n > bn) { bn = n; best = p; } }
    return best ? { x: best.x, z: best.z, n: bn } : null;
  });
  if (at) for (const [name, dist, pitch] of [['near', 30, 0.32], ['street', 70, 0.5]]) {
    await page.evaluate(({ at, dist, pitch }) => { const g = window.__game; window.__dbg.view(at.x, at.z, dist, 0.9, pitch); for (let i = 0; i < 6; i++) g.frame(0.016); }, { at, dist, pitch });
    await page.screenshot({ path: `${process.env.SHOT}-${name}.jpg`, type: 'jpeg', quality: 85, timeout: 240000 });
  }
}
console.log(JSON.stringify(r));
console.log(`${base} ${quality}${phone ? ' phone' : ''}: ${r.peds} people (${r.near} near, ${r.far} far); people group ${r.callsShown - r.callsHidden} draw calls, ${r.trisShown - r.trisHidden} triangles, ${r.deltaMs.toFixed(1)} ms of ${r.shownMs.toFixed(0)} ms per frame (${(100 * r.deltaMs / r.shownMs).toFixed(1)}%); errors ${JSON.stringify(errs.slice(0, 3))}`);
await browser.close();
