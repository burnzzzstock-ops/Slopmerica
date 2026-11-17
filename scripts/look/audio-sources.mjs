// BASE_URL serves the current game. Exercises the real draw eligibility and
// Game.frame soundscape sampling while the simulation clock is paused.
import { launch, openScene, saveReport } from './measure.mjs';
const browser = await launch();
try {
  const { page } = await openScene(browser, { quality: 'low', scene: 'reference', width: 390, height: 844, phone: true });
  const report = await page.evaluate(async () => {
    const T = await import('/@id/three');
    const g = window.__game, a = g.ambientLife;
    const camera = new T.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 5, 20); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    a.showcaseOn = true; a.active.fill(0); a.locked.fill(1);
    const fixtures = [
      ['seagull', 0, 3, 0], ['seaLion', 4, 0, 0], ['alligator', -4, 0, 0], ['bassBoat', 0, 0, -4],
      ['seagull', 0, 3, 40], ['seaLion', 0, 0, -500], ['crow', 0, 3, 2],
    ];
    for (let i = 0; i < fixtures.length; i++) {
      const [kind, x, y, z] = fixtures[i];
      a.active[i] = 1; a.kind[i] = a.models.findIndex(m => m.kind === kind);
      a.x[i] = x; a.y[i] = y; a.z[i] = z; a.scale[i] = 1; a.speed[i] = 2;
    }
    a.locked[6] = 0;
    a.update(0, camera, 1, 'clear');
    const sources = a.soundSources(camera), identities = sources.slice();
    const eligible = sources.filter(s => s.level > 0).map(s => ({ ...s }));
    const samePool = a.soundSources(camera) === sources && sources.every((s, i) => s === identities[i]);
    a.object.visible = false;
    const hidden = a.soundSources(camera).filter(s => s.level > 0).length;
    a.object.visible = true;
    for (let i = 0; i < 16; i++) {
      a.active[i] = 1; a.locked[i] = 1; a.kind[i] = a.models.findIndex(m => m.kind === 'seaLion');
      a.x[i] = (i % 4 - 1.5); a.y[i] = 0; a.z[i] = -Math.floor(i / 4); a.scale[i] = 1;
    }
    a.update(0, camera, 0, 'clear');
    const cap = a.soundSources(camera).filter(s => s.level > 0).length;
    const state = g.traffic.cars.map(c => [c.x, c.z, c.crashed]);
    const nature = g.fields.naturePct, pollution = g.fields.pollutionAt, audioUpdate = g.audio.update, trafficUpdate = g.traffic.update, countTrees = g.trees.countIn;
    const simDay = g.sim.day;
    let mix;
    g.fields.naturePct = () => 0.61;
    g.fields.pollutionAt = () => 0.37;
    g.audio.update = (dt, m) => { mix = { ...m }; };
    g.traffic.update = () => {};
    let treeCount = 10;
    g.trees.countIn = () => treeCount;
    g.soundTreeSample.x = NaN;
    try {
      const car = g.traffic.cars.find(c => c.h >= 0 && c.crashed === 0);
      if (!car) throw Error('Reference town needs one allocated car');
      for (const c of g.traffic.cars) { c.x = 20000; c.z = 20000; }
      car.x = g.rts.target.x + 5; car.z = g.rts.target.z + 5;
      g.waterT = 0; g.frame(1 / 60, false);
      const near = { nature: mix.nature, habitat: mix.habitat, pollution: mix.pollution, traffic: mix.traffic, speed: mix.speed };
      car.x = 20000; car.z = 20000;
      treeCount = 4;
      g.waterT = 0; g.frame(1 / 60, false);
      return { eligible, hidden, samePool, cap, near, farTraffic: mix.traffic, clearing: mix.clearing, dayUnchanged: simDay === g.sim.day };
    } finally {
      g.fields.naturePct = nature; g.fields.pollutionAt = pollution; g.audio.update = audioUpdate; g.traffic.update = trafficUpdate;
      g.trees.countIn = countTrees;
      g.traffic.cars.forEach((c, i) => { [c.x, c.z, c.crashed] = state[i]; });
    }
  });
  console.log(JSON.stringify(report));
  saveReport('shots/audio/source-eligibility.json', report);
  const kinds = report.eligible.map(s => s.kind).sort().join(',');
  if (kinds !== ['alligator', 'bassBoat', 'seaLion', 'seagull'].sort().join(',') || report.hidden || !report.samePool || report.cap !== 8 ||
      report.near.nature !== 0.61 || report.near.habitat !== 10 / 160 || report.near.pollution !== 0.37 || report.near.traffic <= 0 || report.farTraffic !== 0 || report.clearing !== 0.5 || !report.dayUnchanged) process.exitCode = 1;
} finally { await browser.close(); }
