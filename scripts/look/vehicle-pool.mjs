// BASE_URL is read by measure.openScene. Run on accepted HEAD and on the isolated presentation diff.
import { launch } from '../lib/browser.mjs';
import { openScene, identifyRenderer, fixtureHash, saveReport, percentile } from './measure.mjs';
import { timePasses } from './pass-times.mjs';
const mode = process.env.POOL_MODE ?? 'after', quality = process.env.QUALITY ?? 'low';
if (!['before', 'after'].includes(mode)) throw Error('POOL_MODE must be before or after');
const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const { page, errs, town } = await openScene(browser, { scene: 'reference', quality, width: quality === 'low' ? 390 : 1920, height: quality === 'low' ? 844 : 1080, phone: quality === 'low' });
  const renderer = await page.evaluate(identifyRenderer, true);
  const result = await page.evaluate(async mode => {
    const g = window.__game, tr = g.traffic, r = tr.renderer;
    const { VEHICLE_SPECS } = await import('/src/agents/vehicles.ts');
    const { snapshot } = await import('/src/sim/save.ts');
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const kinds = Object.keys(VEHICLE_SPECS);
    const originalHandles = tr.cars.map(c => [c.id, c.h]);
    // Fill the real allocation pool far outside the camera, then dispatch an ordinary trip.
    let added = 0;
    for (let j = 0; j < g.q.maxCars * 2; j++) {
      const h = r.add(kinds[j % kinds.length], 0xf2f2f2);
      if (h >= 0) { added++; r.set(h, 8000 + j, 0, 8000, 0); r.setParked(h, true); }
    }
    let target;
    for (const b of g.buildings.list.values()) {
      if (b.state !== 'active' || b.offNet) continue;
      target = tr.dispatch('liftedTruck', 'edge', b, 'visiting town', b.label, 12.5, { sober: true });
      if (target) break;
    }
    if (!target) throw Error('Actual dispatcher found no route');
    tr.update(.1, 1, 12.5, g.sim.population, g.sim.jobsFilled, g.rts.target); tr.draw(1, 0);
    if (!target.posed) throw Error('Dispatched car has not completed its first fixed step');
    g.rts.setView(target.x, target.z, 42, target.yaw + 0.8, .42, true);
    // Normal frame entry establishes the observer/camera wiring.
    g.sim.speed = 0; g.frame(.016, false);
    const serial = () => { const s = snapshot(g); delete s.savedAt; return JSON.stringify(s); };
    const before = serial(), active = r.stats().active;
    const rng = r.rngState;
    // Freeze simulation; move the camera and draw already calculated poses repeatedly.
    for (let i = 0; i < 90; i++) {
      if (mode === 'after') r.observeTraffic(tr.cars, g.camera, 1, g.q.name === 'low' ? 'low' : 'high');
      tr.draw(1, 0);
    }
    const after = serial();
    const targetDrawn = mode === 'after' ? r.isCarDrawn(target.id) : target.h >= 0;
    g.scene.updateMatrixWorld(true);
    const Vec3 = g.camera.position.constructor;
    const ray = new g.ray.constructor(new Vec3(target.shown[0], target.shown[1] + 30, target.shown[2]), new Vec3(0, -1, 0));
    const pickId = r.pickCarId?.(ray) ?? null;
    g.audio.unlock(); await sleep(150);
    for (let i = 0; i < 30; i++) { g.audio.street(.025, tr.cars, g.rts, 0, 1); await sleep(25); }
    const voices = g.audio.streetVoices.debug();
    const audioIds = voices.map(v => v.id), targetVoice = voices.find(v => v.id === target.id);
    const presentation = r.presentationStats?.() ?? null;
    let eviction;
    if (mode === 'after') {
      g.rts.setView(target.x + 2500, target.z, 42, target.yaw, .5, true); g.frame(.016, false);
      for (let i = 0; i < 15; i++) { g.audio.street(.025, tr.cars, g.rts, 0, 1); await sleep(25); }
      eviction = { drawn: r.isCarDrawn(target.id), voice: g.audio.streetVoices.debug().some(v => v.id === target.id) };
      g.rts.setView(target.x, target.z, 42, target.yaw + .8, .42, true); g.frame(.016, false);
    }
    g.audio.setMuted(true); g.hour = 17.5; g.weather.force('clear', 30); g.weather.settle();
    for (let i = 0; i < 30; i++) g.frame(.016);
    const frameTimes = [];
    for (let i = 0; i < 180; i++) { const start = performance.now(); g.frame(1 / 60); frameTimes.push(performance.now() - start); }
    const count = r.object.children.filter(x => x.isInstancedMesh && !x.name.endsWith('-pick') && x.name !== 'vehicle-fx').reduce((sum,x) => sum + x.count, 0);
    return { added, active, cap: g.q.maxCars, target: { id: target.id, h: target.h, kind: target.kind, x: target.x, z: target.z, speed: target.v },
      targetDrawn, pickId, stateEqual: before === after, rendererRngEqual: rng === r.rngState, originalHandlesEqual: originalHandles.every(([id,h]) => tr.cars.find(c => c.id === id)?.h === h),
      targetVoice, audioIds, selectedAudioOnly: mode === 'before' || audioIds.every(id => r.isCarDrawn(id)), presentation, eviction, count, frameTimes,
      render: { calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles } };
  }, mode);
  result.frame = { median: percentile(result.frameTimes, .5), p95: percentile(result.frameTimes, .95), worst: Math.max(...result.frameTimes) }; delete result.frameTimes;
  const passes = await page.evaluate(timePasses, 12);
  result.gpu = { median: percentile(passes.map(p => Object.values(p).reduce((sum, x) => sum + x, 0)), .5), passes };
  result.renderer = renderer; result.browser = browser.version(); result.mode = mode; result.quality = quality; result.town = town; result.fixtureHash = fixtureHash(); result.errors = errs;
  result.passed = result.target.h === -1 && result.active === result.cap && result.stateEqual && result.rendererRngEqual && result.originalHandlesEqual && !errs.length &&
    (mode === 'before' ? !result.targetDrawn && !result.targetVoice : result.targetDrawn && result.pickId === result.target.id && !!result.targetVoice && result.selectedAudioOnly && !result.eviction.drawn && !result.eviction.voice);
  const stem = `shots/vehicle-pool/${quality}-${mode}`;
  saveReport(`${stem}.json`, result); await page.screenshot({ path: `${stem}.png` });
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally { await browser.close(); }
