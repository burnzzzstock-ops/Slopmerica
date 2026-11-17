// Idle water still animates every frame. Count only full mirrored scene
// renders. GPU timers report the cost of all refreshes and skips together.
import { launch, openScene, preflight, saveReport, seed } from './measure.mjs';
import { timePasses } from './pass-times.mjs';
const source = process.env.BASE_URL || 'http://127.0.0.1:5173';

const browser = await launch();
try {
  const renderer = await preflight(browser, true);
  const { page, errs } = await openScene(browser, { scene: 'appalachia', quality: 'high', width: 1920, height: 1080 });
  const samples = await page.evaluate(() => {
    const g = window.__game, r = g.water.reflection;
    g.sim.speed = 0;
    const center = r.waterBounds.map(box => box.getCenter(g.camera.position.clone()))
      .sort((a,b) => a.lengthSq() - b.lengthSq())[0];
    const place = dx => g.rts.setView(center.x + dx, center.z, 180, 0.6, 0.55, true);
    place(0);
    // A view targeted at a river bed eases up to the surface after setView.
    // Let it settle before measuring a stationary camera.
    for (let i = 0; i < 120; i++) g.frame(1 / 60, false);
    for (let i = 0; i < 12; i++) g.frame(1 / 60);
    if (!r.shouldRender(g.camera)) throw Error('Test camera misses water');
    const render = r.render;
    let draws = 0;
    r.render = function (...args) {
      const refreshed = render.apply(this, args);
      if (refreshed) draws++;
      return refreshed;
    };
    for (let i = 0; i < 60; i++) g.frame(1 / 60);
    const stationary = draws;
    draws = 0;
    for (let i = 0; i < 16; i++) { place(i + 1); g.frame(1/60); }
    const moving = draws;
    const beforeFov = draws;
    g.camera.fov += 4; g.camera.updateProjectionMatrix();
    g.frame(1/60);
    const fovRefresh = draws === beforeFov + 1;
    r.render = render;
    const renderer = g.renderer, draw = renderer.render;
    const target = renderer.getRenderTarget(), shadow = renderer.shadowMap.autoUpdate;
    const visible = g.water.mesh.visible;
    let caught = false;
    renderer.render = () => { throw Error('Injected mirror failure'); };
    try { r.render(renderer, g.scene, g.camera, [g.water.mesh]); }
    catch (error) { caught = error.message === 'Injected mirror failure'; }
    finally { renderer.render = draw; }
    const restored = renderer.getRenderTarget() === target && renderer.shadowMap.autoUpdate === shadow && g.water.mesh.visible === visible;
    const retried = r.render(renderer, g.scene, g.camera, [g.water.mesh], g.time);
    return { camera: center.toArray(), stationary, moving, fovRefresh, recovery: caught && restored && retried };
  });
  // Compare in one GPU context, interleaved, so a different asset upload,
  // clock state or another browser's load cannot define an entire A/B arm.
  const passes = [];
  for (const cache of [true, false, false, true, false, true, true, false]) {
    await page.evaluate(cache => {
      const r = window.__game.water.reflection;
      window.__cadenceRender ??= r.render.bind(r);
      r.render = cache ? window.__cadenceRender : (renderer, scene, cam, hide) => window.__cadenceRender(renderer, scene, cam, hide);
      for (let i = 0; i < 4; i++) window.__game.frame(1/60);
    }, cache);
    const timings = await page.evaluate(timePasses, 16);
    const mirror = timings.map(f => f['water mirror'] || 0);
    const total = timings.map(f => Object.values(f).reduce((a,b) => a+b,0));
    const mean = values => values.reduce((a,b) => a+b,0) / values.length;
    passes.push({ cache, mirrorMeanMs: mean(mirror), totalGpuMeanMs: mean(total) });
  }
  const result = { source, renderer, chrome: browser.version(), seed, ...samples,
    passes };
  saveReport(process.env.REPORT || 'shots/perf/reflect-cadence.json', result);
  console.log(JSON.stringify(result));
  if (errs.length || samples.stationary !== 30 || samples.moving !== 16 || !samples.fovRefresh || !samples.recovery) process.exitCode = 1;
} finally { await browser.close(); }
