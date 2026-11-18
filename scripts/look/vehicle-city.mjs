// Explicit large-town acceptance artifact. BASE_URL serves an isolated before/after build.
import { createHash } from 'node:crypto';
import { readSave } from '../lib/fixtures.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';
import { launch } from '../lib/browser.mjs';
import { identifyRenderer, saveReport, percentile } from './measure.mjs';
import { timePasses } from './pass-times.mjs';
const fixture = process.env.POOL_CITY;
if (!fixture) throw Error('POOL_CITY must name an actual grown town save with at least5,000 residents');
const text = readSave(fixture), fixtureHash = createHash('sha256').update(text).digest('hex');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173', quality = process.env.QUALITY ?? 'low', mode = process.env.POOL_MODE ?? 'after';
const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage(quality === 'low' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(seededInit, { seed: 271828, rng: seededRandom.toString() });
  await page.goto(`${base}/package.json`);
  await page.evaluate(async ({ text, quality }) => {
    const { packString } = await import('/src/core/lz.ts');
    localStorage.setItem('slopmerica.save.v1', text.startsWith('{') ? packString(text) : text);
    localStorage.setItem('slopmerica.quality', quality); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1');
  }, { text, quality });
  await page.goto(base, { waitUntil: 'load', timeout: 180000 });
  await page.locator('#continue').click({ timeout: 240000 });
  await page.waitForFunction(() => window.__game && window.__game.civic.status !== 'loading', null, { timeout: 300000 });
  const result = await page.evaluate(async ({ mode, targetId }) => {
    const g = window.__game, tr = g.traffic, r = tr.renderer;
    if (g.sim.population < 5000) throw Error(`Town has only${g.sim.population} residents`);
    if (window.__vault.status() !== 'ready' || g.civic.status === 'failed') throw Error('Missing city asset pack');
    const population = g.sim.population;
    for (const element of document.querySelectorAll('.hud, .xfeed, .toast, .next-bar, .side-cards')) element.style.display = 'none';
    g.sim.speed = 0; g.frame(.016, false);
    const atLoad = { population, cars: tr.cars.length, allocated: r.stats().active, unallocated: tr.cars.filter(c => c.h < 0 && c.crashed === 0).length };
    // Let the existing traffic model reach its ordinary trip demand if the saved town was still quiet.
    let warmedSeconds = 0;
    for (let i = 0; i < 600 && !tr.cars.some(c => c.h < 0 && c.crashed === 0 && c.posed); i++) {
      tr.update(.1, 1, g.hour, population, g.sim.jobsFilled, g.rts.target); warmedSeconds += .1;
    }
    const candidates = tr.cars.filter(c => c.crashed === 0 && c.posed && !c.parked);
    candidates.sort((a,b) => a.id-b.id);
    const target = candidates.find(c => c.id === targetId) ?? candidates.find(c => c.h < 0) ?? candidates[0];
    if (!target) throw Error('Grown town has no live traffic');
    g.rts.setView(target.x, target.z, 55, target.yaw + .8, .5, true); g.frame(.016, false);
    const { snapshot } = await import('/src/sim/save.ts');
    const state = () => { const save = snapshot(g); delete save.savedAt; return JSON.stringify(save); };
    const before = state(), rng = r.rngState;
    const handles = tr.cars.map(c => [c.id,c.h]);
    for (let i = 0; i < 80; i++) { r.observeTraffic?.(tr.cars, g.camera, 1, g.q.name === 'low' ? 'low' : 'high'); tr.draw(1, 0); }
    const stateEqual = state() === before;
    g.scene.updateMatrixWorld(true);
    const Vec3 = g.camera.position.constructor;
    const ray = new g.ray.constructor(new Vec3(target.shown[0], target.shown[1] + 30, target.shown[2]), new Vec3(0,-1,0));
    const drawn = r.isCarDrawn?.(target.id) ?? target.h >= 0, picked = r.pickCarId?.(ray) ?? (tr.pick(ray)?.id ?? null);
    g.audio.unlock(); await new Promise(resolve => setTimeout(resolve, 150));
    for (let i = 0; i < 40; i++) { g.audio.street(.025, tr.cars, g.rts, 0, 1); await new Promise(resolve => setTimeout(resolve, 25)); }
    const audio = g.audio.streetVoices.debug(), selectedAudioOnly = audio.every(v => r.isCarDrawn?.(v.id) ?? tr.cars.find(c => c.id === v.id)?.h >= 0);
    g.audio.setMuted(true); g.hour = 17.5; g.weather.force('clear', 30); g.weather.settle();
    for (let i = 0; i < 30; i++) g.frame(.016);
    const work = [];
    for (let i = 0; i < 180; i++) { const now = performance.now(); g.frame(1 / 60); work.push(performance.now() - now); }
    return { atLoad, population: g.sim.population, buildings: g.buildings.list.size, cars: tr.cars.length, cap: g.q.maxCars, allocated: r.stats().active, warmedSeconds,
      target: { id: target.id, handle: target.h, x: target.x, z: target.z }, drawn, picked, stateEqual, rendererRngEqual: rng === r.rngState,
      handlesEqual: handles.every(([id,h]) => tr.cars.find(c => c.id === id)?.h === h), selectedAudioOnly, audio, presentation: r.presentationStats?.(), work };
  }, { mode, targetId: Number(process.env.CAR_ID ?? 0) });
  const timings = await page.evaluate(timePasses, 12);
  result.cpu = { median: percentile(result.work,.5), p95: percentile(result.work,.95), worst: Math.max(...result.work) }; delete result.work;
  result.gpu = { median: percentile(timings.map(p => Object.values(p).reduce((a,b)=>a+b,0)),.5), passes: timings };
  result.renderer = await page.evaluate(identifyRenderer, true); result.browser = browser.version();
  result.mode = mode; result.quality = quality; result.fixture = fixture; result.fixtureHash = fixtureHash; result.errors = errors;
  result.passed = result.population >= 5000 && result.stateEqual && result.rendererRngEqual && result.handlesEqual && result.selectedAudioOnly && !errors.length &&
    (mode === 'before' ? result.target.handle >= 0 || !result.drawn : result.drawn && result.picked === result.target.id);
  const stem = `shots/vehicle-pool/city-${quality}-${mode}`;
  saveReport(`${stem}.json`, result); await page.screenshot({ path: `${stem}.png` });
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally { await browser.close(); }
