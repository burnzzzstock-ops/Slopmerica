// A capture must update the mirror for its moved camera and export aspect
// before drawing water, including when capture is called outside photo mode.
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.OUT || 'shots/look/photo-reflection';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(seededInit, { seed: 1776, rng: seededRandom.toString() });
  await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.resolution', 'full'); localStorage.setItem('slopmerica.onboarded', '1'); });
  await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5195') + '/#skip&map=appalachia&mode=sandbox', { timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const result = await page.evaluate(async () => {
    const g = window.__game, p = g.photo, mirror = g.water.reflection, renderer = g.renderer;
    const center = mirror.waterBounds.map(box => box.getCenter(g.camera.position.clone())).sort((a, b) => a.lengthSq() - b.lengthSq())[0];
    g.rts.setView(center.x, center.z, 180, 0.6, 0.55, true); g.hour = 18.5;
    for (let i = 0; i < 60; i++) g.frame(0, false);
    g.frame(0, true);
    if (!mirror.shouldRender(g.camera)) throw Error('Camera must see nearby water');
    const rows = [], draw = g.post.render, reflect = mirror.render;
    let draws = [], refreshes = 0;
    mirror.render = function (...args) { const done = reflect.apply(this, args); if (done) refreshes++; return done; };
    g.post.render = function (night, distance, camera = g.camera) {
      draws.push({ buffer: [renderer.domElement.width, renderer.domElement.height], fresh: mirror.lastEye.distanceTo(camera.position) < 1e-7 && mirror.lastProjection.equals(camera.projectionMatrix),
        reflected: refreshes, enabled: g.water.mat.uniforms.uReflOn.value, aspect: camera.aspect, target: [mirror.rt.width, mirror.rt.height] });
      return draw.call(this, night, distance, camera);
    };
    const state = () => [g.time, g.sim.day, g.sim.money, g.hour, g.weather.kind];
    const initialState = state();
    for (const active of [true, false]) {
      if (active) p.enter(); else p.exit();
      for (const size of [undefined, { width: 3840, height: 1600 }]) {
        const oldMatrix = mirror.texMat.clone();
        if (active) { p.move(17, 5, 9); p.fov += 7; }
        else { g.camera.position.x += 17; g.camera.position.y += 5; g.camera.position.z += 9; g.camera.fov += 7; g.camera.lookAt(center); g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true); }
        const before = state(); draws = []; refreshes = 0;
        const bitmap = await createImageBitmap(await p.capture(false, size));
        const dims = [bitmap.width, bitmap.height]; bitmap.close();
        rows.push({ active, size: size || null, dims, draws, refreshes, matrixChanged: !oldMatrix.equals(mirror.texMat), simulationUnchanged: JSON.stringify(before) === JSON.stringify(state()),
          restored: [renderer.domElement.width, renderer.domElement.height, g.post.sceneRT.width, g.post.sceneRT.height, mirror.rt.width, mirror.rt.height] });
      }
    }
    g.post.render = draw; mirror.render = reflect;
    return { rows, initialState, finalState: state() };
  });
  const pass = errors.length === 0 && result.rows.every(r => r.matrixChanged && r.simulationUnchanged && r.draws.every(d => d.fresh && d.enabled === 1 && d.reflected > 0)
    && r.draws.length === (r.size ? 2 : 1) && r.refreshes === r.draws.length && r.restored.join() === '1280,720,1280,720,640,360'
    && r.dims.join() === (r.size ? '3840,1600' : '1280,720') && r.draws[0].target.join() === (r.size ? '1400,583' : '640,360'));
  writeFileSync(out + '/result.json', JSON.stringify({ ...result, errors, pass }, null, 2));
  console.log(pass ? 'OK' : 'FAIL', JSON.stringify(result));
  if (!pass) process.exitCode = 1;
} finally { await browser.close(); }
