// BASE_URL is read by measure.openScene for the frozen game under test.
import { launch, preflight, openScene, seed } from './measure.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.OUT || 'shots/look/forest-floor';
mkdirSync(out, { recursive: true });
async function capture(page, path) {
  const data = await page.evaluate(() => {
    const g = window.__game;
    g.frame(0, true);
    return g.renderer.domElement.toDataURL('image/jpeg', .9).split(',')[1];
  });
  writeFileSync(path, Buffer.from(data, 'base64'));
}
const browser = await launch();
try {
  const hardware = await preflight(browser, true);
  const results = [];
  for (const [scene, quality] of [['appalachia', 'low'], ['appalachia', 'high'], ['norcal', 'high'], ['florida', 'high']]) {
    const phone = quality === 'low';
    const { page, errs } = await openScene(browser, { scene, quality, width: phone ? 390 : 1280, height: phone ? 844 : 720, phone });
    const setup = await page.evaluate(scene => {
      const g = window.__game, trees = g.trees, floor = g.terrain.forestFloor;
      const wanted = { appalachia: [140, 380], norcal: [1540, -220], florida: [900, -860] }[scene];
      let center, best = Infinity;
      for (let i = 0; i < trees.X.length; i += 31) {
        if (!trees.A[i]) continue;
        const x = trees.X[i], z = trees.Z[i], distance = Math.hypot(x - wanted[0], z - wanted[1]);
        if (distance >= best || g.terrain.h(x, z) < 3 || g.terrain.slope(x, z) > .3 || floor.densityAt(x, z) < .65) continue;
        if (g.terrain.paintAt(x, z) !== 0 || g.net.pickSeg(x, z, 100)) continue;
        center = { x, z }; best = distance;
      }
      if (!center) throw Error('No real unbuilt forest stand for clear-cut acceptance');
      const state = () => JSON.stringify({ day: g.sim.day, money: g.sim.money, population: g.sim.population, buildings: g.buildings.serialize(), alive: trees.alive });
      const settle = () => {
        const timings = [];
        g.groundDetail.markDirty();
        for (let i = 0; i < 2000; i++) {
          g.frame(0, false);
          timings.push(g.groundDetail.lastRefillMs);
          if (!g.groundDetail.refill) return timings;
        }
        throw Error('Ground detail did not finish its bounded refill');
      };
      g.sim.speed = 0; g.hour = 12.5;
      g.rts.setView(center.x, center.z, 135, .7, .65, true);
      window.__forestCheck = { center, state, settle, beforeState: state(), pixels: floor.texture.image.data.slice(), cutPixels: floor.clearedTexture.image.data.slice() };
      settle(); g.frame(0, true); g.frame(0, true);
      const wood = g.groundDetail.group.children.find(object => object.name === 'clear-cut stump and slash');
      return { center, originalTrees: trees.alive, wood: wood?.count ?? 0, instances: g.groundDetail.visibleInstances, capacity: g.groundDetail.maxInstances, calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles };
    }, scene);
    await capture(page, `${out}/${scene}-${quality}-before.jpg`);
    const cut = await page.evaluate(() => {
      const g = window.__game, check = window.__forestCheck, { x, z } = check.center, radius = 55;
      const floor = g.terrain.forestFloor;
      g.trees.recordCuts();
      const count = g.trees.cut(x - radius, z - radius, x + radius, z + radius, (px, pz) => (px - x) ** 2 + (pz - z) ** 2 < radius * radius);
      check.cuts = g.trees.takeCuts();
      const timings = check.settle();
      g.frame(0, true); g.frame(0, true);
      const wood = g.groundDetail.group.children.find(object => object.name === 'clear-cut stump and slash');
      const edges = [];
      for (let i = 0; i < wood.count; i++) {
        const matrix = wood.instanceMatrix.array, px = matrix[i * 16 + 12], pz = matrix[i * 16 + 14];
        edges.push(floor.clearedAt(px, pz));
      }
      return { count, cuts: check.cuts.length, alive: g.trees.alive, wood: wood.count, woodCapacity: wood.instanceMatrix.count,
        edges, instances: g.groundDetail.visibleInstances, capacity: g.groundDetail.maxInstances,
        refillMaxMs: Math.max(...timings), refillTotalMs: g.groundDetail.lastRefillTotalMs,
        calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles,
        densityChanged: check.pixels.some((value, i) => value !== floor.texture.image.data[i]),
        clearedChanged: check.cutPixels.some((value, i) => value !== floor.clearedTexture.image.data[i]) };
    });
    await capture(page, `${out}/${scene}-${quality}-cut.jpg`);
    const undo = await page.evaluate(() => {
      const g = window.__game, check = window.__forestCheck, floor = g.terrain.forestFloor;
      g.trees.replant(check.cuts);
      check.settle(); g.frame(0, true); g.frame(0, true);
      const wood = g.groundDetail.group.children.find(object => object.name === 'clear-cut stump and slash');
      return { stateKept: check.state() === check.beforeState,
        densityKept: check.pixels.every((value, i) => value === floor.texture.image.data[i]),
        clearedKept: check.cutPixels.every((value, i) => value === floor.clearedTexture.image.data[i]),
        wood: wood.count, instances: g.groundDetail.visibleInstances,
        bytes: floor.texture.image.data.byteLength + floor.clearedTexture.image.data.byteLength };
    });
    const pass = !errs.length && cut.count > 0 && cut.wood > setup.wood && cut.wood <= cut.woodCapacity
      && cut.instances <= cut.capacity && cut.alive === setup.originalTrees - cut.count
      && cut.densityChanged && cut.clearedChanged && cut.edges.every(value => value > .039 && value < 1)
      && undo.stateKept && undo.densityKept && undo.clearedKept && undo.wood === setup.wood && undo.instances === setup.instances
      && undo.bytes === 512 * 1024 && cut.calls <= (phone ? 250 : 600);
    results.push({ scene, quality, setup, cut, undo, errors: errs, pass });
    const { edges, ...cutSummary } = cut;
    console.log(pass ? 'OK' : 'FAIL', scene, quality, JSON.stringify({ setup, cut: { ...cutSummary, edgeRange: [Math.min(...edges), Math.max(...edges)] }, undo }));
    await page.close();
  }
  const pass = results.every(result => result.pass);
  writeFileSync(out + '/result.json', JSON.stringify({ hardware, seed, results, pass }, null, 2));
  if (!pass) process.exitCode = 1;
} finally {
  await browser.close();
}
