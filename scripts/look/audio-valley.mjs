// BASE_URL serves the current game. Build the second state through the game's
// road, zoning, service and simulation paths. Both mixes use one pinned camera.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, openScene, saveReport } from './measure.mjs';
const browser = await launch();
try {
  const { page, errs } = await openScene(browser, { quality: 'low', scene: 'appalachia', width: 960, height: 540 });
  const first = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, start = g.startView();
    const center = { x: Math.round(start.x), z: Math.round(start.z) };
    d.unlockAll();
    g.sim.day = 120; g.sim.lastWhole = 120; g.hour = 12;
    g.weather.force('clear', 10000); g.weather.settle();
    g.rts.setView(center.x + 70, center.z - 60, 160, 1.1, 0.65, true);
    for (let i = 0; i < 12; i++) g.frame(1 / 60, false);
    g.rts.update = () => {};
    window.__audioValleyCenter = center;
    window.__audioValleyCapture = () => {
      g.sim.day = 120; g.sim.lastWhole = 120; g.hour = 12; g.sim.speed = 1;
      g.weather.force('clear', 10000); g.weather.settle();
      g.waterT = 0; g.frame(1 / 60);
      const state = {
        camera: { position: g.camera.position.toArray(), quaternion: g.camera.quaternion.toArray(), target: g.rts.target.toArray(), distance: g.rts.distance },
        mix: JSON.parse(JSON.stringify(g.soundMix)),
        counts: { population: g.sim.population, buildings: g.buildings.list.size, roads: g.net.segs.size, cars: g.traffic.cars.length,
          trees: g.trees.alive, localTrees: g.trees.countIn(g.rts.target.x, g.rts.target.z, 200) },
      };
      g.sim.speed = 0;
      return state;
    };
    return { center, ...window.__audioValleyCapture() };
  });
  mkdirSync('shots/audio/game', { recursive: true });
  await page.screenshot({ path: 'shots/audio/game/pristine.png' });
  console.log('pristine', JSON.stringify(first));
  const construction = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, SV = window.__services;
    const { x: cx, z: cz } = window.__audioValleyCenter;
    const roads = [];
    roads.push(d.road(cx, cz - 320, cx, cz + 320, 'stroad4'));
    for (const k of [-3, -2, -1, 1, 2, 3]) roads.push(d.road(cx - 260, cz + k * 90, cx + 260, cz + k * 90, 'twoLane'));
    for (const x of [-180, -90, 90, 180]) roads.push(d.road(cx + x, cz - 270, cx + x, cz + 270, 'twoLane'));
    for (const [x, z] of [[-135, -225], [-135, -135], [-135, 135], [-135, 225], [135, 135], [135, 225], [-45, 225], [45, 135]]) d.zone(cx + x, cz + z, 38, 'resLow');
    for (const [x, z] of [[-30, -45], [30, 45], [-30, 45]]) d.zone(cx + x, cz + z, 28, 'comLow');
    for (const [x, z] of [[135, -135], [225, -45], [-225, -45]]) d.zone(cx + x, cz + z, 40, 'industry');
    const services = [];
    for (const id of ['coalPlant', 'wellTower', 'wellTower', 'treatmentPlant', 'landfill', 'school', 'clinic', 'fireStation']) {
      let placed = false;
      for (const radius of [150, 230, 350, 500]) {
        for (let i = 0; i < 32 && !placed; i++) {
          const x = cx + Math.cos(i / 32 * Math.PI * 2) * radius, z = cz + Math.sin(i / 32 * Math.PI * 2) * radius;
          if (SV.canPlace(g, id, x, z).ok && SV.place(g, id, x, z)) placed = true;
        }
        if (placed) break;
      }
      services.push({ id, placed });
    }
    const cut = g.trees.cut(cx - 900, cz - 900, cx + 900, cz + 900, () => true);
    g.sim.growthMul = 3;
    return { roads, services, cut };
  });
  console.log('construction', JSON.stringify(construction));
  let grown;
  for (let batch = 0; batch < 12; batch++) {
    grown = await page.evaluate(() => window.__dbg.run(20));
    console.log('growth', JSON.stringify(grown));
    if (grown.pop >= 350 && grown.cars >= 35) break;
  }
  const second = await page.evaluate(() => window.__audioValleyCapture());
  await page.screenshot({ path: 'shots/audio/game/paved.png' });
  const report = { map: 'appalachia', seed: Number(process.env.SEED ?? 271828), center: first.center, construction, grown, errors: errs,
    cases: [{ name: 'pristine', ...first }, { name: 'paved', ...second }] };
  report.passed = JSON.stringify(first.camera) === JSON.stringify(second.camera) && second.counts.buildings > first.counts.buildings &&
    second.counts.cars > 0 && second.mix.traffic > first.mix.traffic && second.mix.nature < first.mix.nature && second.mix.pollution >= first.mix.pollution && !errs.length;
  saveReport('shots/audio/game/mixes.json', report);
  console.log('paved', JSON.stringify(second));
  console.log('game-derived acceptance', report.passed);
  if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
