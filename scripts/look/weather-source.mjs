// BASE_URL is read by measure.openScene and the Atmosphere Lab navigation below.
// Exercise the actual owner callbacks, saved climate and normal frame entry.
import { launch } from '../lib/browser.mjs';
import { identifyRenderer, openScene, saveReport } from './measure.mjs';

const browser = await launch();
const errors = [];
const out = process.env.OUT || 'shots/weather-source/live.json';
try {
  const { page, errs } = await openScene(browser, {
    scene: 'appalachia', quality: 'low', width: 800, height: 600,
  });
  const renderer = await page.evaluate(identifyRenderer, process.env.GPU === '1');
  const game = await page.evaluate(async () => {
    const { DAY_SECONDS } = await import('/src/sim/sim.ts');
    const g = window.__game;
    g.stop();
    g.sim.speed = 0;
    g.frame(0, false);
    const source = g.climate;
    const view = g.weather;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const copied = () => ['kind', 'intensity', 'wet', 'snowCover', 'temperature', 'season']
      .every(key => view[key] === source[key])
      && view.wind.x === source.wind.x && view.wind.y === source.wind.y;
    let calls = 0;
    let notifications = 0;
    const force = source.force;
    const onChange = view.onChange;
    source.force = function (...args) {
      calls++;
      return force.apply(this, args);
    };
    view.onChange = (...args) => {
      notifications++;
      onChange?.(...args);
    };
    const rows = [];
    try {
      for (const kind of ['rain', 'snow', 'storm', 'fog', 'heatwave', 'hurricane', 'wildfireSmoke', 'clear']) {
        const before = source.save();
        const beforeFingerprint = window.__dbg.fingerprint();
        const callStart = calls;
        const notifyStart = notifications;
        view.force(kind, 3);
        view.settle();
        const forced = source.save();
        const forcedFingerprint = window.__dbg.fingerprint();
        const changedSystems = Object.keys(beforeFingerprint)
          .filter(key => beforeFingerprint[key] !== forcedFingerprint[key]);
        const immediateCopy = copied();
        for (let i = 0; i < 40; i++) g.frame(1 / 60, false);
        const after = source.save();
        rows.push({
          kind, calls: calls - callStart, notifications: notifications - notifyStart,
          changedSystems, immediateCopy, copied: copied(),
          pausedExact: same(forced, after) && same(forcedFingerprint, window.__dbg.fingerprint()),
          noRandomness: before.rng === forced.rng && before.windAngle === forced.windAngle,
          retainedSurface: before.wet === forced.wet && before.snowCover === forced.snowCover,
          duration: forced.end - g.sim.day,
          expectedDuration: 3 * 360 / DAY_SECONDS,
          fullIntensity: Math.abs(forced.intensity - 1) < 1e-8,
        });
      }
    } finally {
      source.force = force;
      view.onChange = onChange;
    }

    // Load a valid saved surface state through the source API. The renderer
    // must read it, and must not accumulate wetness or snow while paused.
    source.load({ ...source.save(), wet: .65, snowCover: .23 });
    const restored = source.save();
    const restoreFingerprint = window.__dbg.fingerprint();
    view.settle();
    for (let i = 0; i < 300; i++) g.frame(1 / 60, false);
    const loadedSurface = {
      copied: copied(), wet: view.wet, snow: view.snowCover,
      pausedExact: same(restored, source.save()) && same(restoreFingerprint, window.__dbg.fingerprint()),
      noRendererEffects: typeof view.effects === 'undefined',
    };

    // Normal fixed steps own the change in the ground state.
    view.force('rain', 3);
    const wetBefore = source.wet;
    const dayBefore = g.sim.day;
    window.__dbg.run(1);
    g.frame(0, false);
    const progression = {
      dayBefore, dayAfter: g.sim.day, wetBefore, wetAfter: source.wet,
      copied: copied(),
    };
    return { rows, loadedSurface, progression, finalFingerprint: window.__dbg.fingerprint() };
  });
  errors.push(...errs);
  await page.close();

  const labPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
  labPage.on('pageerror', error => errors.push(error.message));
  const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
  await labPage.goto(`${base}/dev/atmosphere.html#q=low&map=appalachia&seed=1776&ui=0`, { timeout: 180000 });
  await labPage.waitForFunction(() => window.__atmo, null, { timeout: 180000 });
  const lab = await labPage.evaluate(() => {
    const lab = window.__atmo;
    lab.paused = true;
    if (!lab.climate) return { missingClimate: true };
    lab.go({ day: 300, hour: 13, weather: 'snow', play: false }, 1);
    const before = lab.climate.save();
    lab.step(30);
    const after = lab.climate.save();
    return {
      kind: lab.weather.kind, season: lab.weather.season,
      sourceKind: lab.climate.kind, sourceSeason: lab.climate.season,
      intensity: lab.weather.intensity, temperature: lab.weather.temperature,
      sourceTemperature: lab.climate.temperature,
      pausedExact: JSON.stringify(before) === JSON.stringify(after),
      wet: lab.weather.wet, sourceWet: lab.climate.wet,
      snow: lab.weather.snowCover, sourceSnow: lab.climate.snowCover,
      effects: lab.climate.effects(),
    };
  });
  const rowsPass = game.rows.every(row => row.calls === 1 && row.notifications === 1
    && row.changedSystems.length === 1 && row.changedSystems[0] === 'weather'
    && row.immediateCopy && row.copied && row.pausedExact && row.noRandomness
    && row.retainedSurface && row.fullIntensity && row.duration === row.expectedDuration);
  const passed = rowsPass && game.loadedSurface.copied && game.loadedSurface.pausedExact
    && game.loadedSurface.noRendererEffects && game.progression.copied
    && game.progression.dayAfter > game.progression.dayBefore
    && game.progression.wetAfter > game.progression.wetBefore
    && lab.kind === 'snow' && lab.kind === lab.sourceKind && lab.season === lab.sourceSeason
    && lab.intensity > .999 && lab.temperature === lab.sourceTemperature
    && lab.wet === lab.sourceWet && lab.snow === lab.sourceSnow && lab.pausedExact
    && errors.length === 0;
  saveReport(out, { passed, renderer, game, lab, errors });
  console.log(JSON.stringify({ passed, renderer, game, lab, errors }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
