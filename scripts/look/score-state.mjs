// BASE_URL serves the game. Exercise the normal frame and event entry points
// for adaptive Music, including concurrent disaster phases and settings.
import { launch } from '../lib/browser.mjs';
import { openScene, saveReport } from './measure.mjs';
const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const { page, errs } = await openScene(browser, { quality: 'low', scene: 'reference', width: 390, height: 844, phone: true });
  const report = await page.evaluate(async () => {
    const g = window.__game;
    g.audio.unlock();
    if (g.audio.ctx?.state !== 'running') throw Error('Audio context must be running');
    const day = g.sim.day, money = g.sim.money, flow = g.traffic.flowEma, trafficUpdate = g.traffic.update;
    const sound = g.audio.soundOn, music = g.audio.musicOn;
    const frame = () => { g.waterT = 0; g.frame(1 / 60, false); };
    try {
      g.traffic.update = () => {};
      g.sim.money = -10000; g.traffic.flowEma = 0.1;
      frame();
      const mix = { population: g.soundMix.population, moneyTrouble: g.soundMix.moneyTrouble, flowEma: g.soundMix.flowEma };
      const weights = { ...g.audio.debugState().score };
      const event = { phase: 'hit', x: 0, z: 0, radius: 40, intensity: 0.8 };
      g.sim.events.emit('disaster', { ...event, kind: 'wildfire' }); frame();
      const wildfire = g.audio.debugState().disaster;
      g.sim.events.emit('disaster', { ...event, kind: 'hurricane', intensity: 0.4 });
      g.sim.events.emit('disaster', { ...event, kind: 'wildfire', phase: 'end' }); frame();
      const otherSurvives = g.audio.debugState().disaster;
      g.sim.events.emit('disaster', { ...event, kind: 'hurricane', phase: 'end' }); frame();
      const ended = g.audio.debugState().disaster;
      g.audio.soundOn = false; g.audio.musicOn = true; frame();
      await new Promise(resolve => setTimeout(resolve, 1800));
      const musicWithSoundOff = g.audio.score.bus.gain.value;
      g.audio.musicOn = false; frame();
      await new Promise(resolve => setTimeout(resolve, 4000));
      const mutedScore = g.audio.score.bus.gain.value;
      return { mix, actualPopulation: g.sim.population, weights, wildfire, otherSurvives, ended, musicWithSoundOff, mutedScore, dayUnchanged: day === g.sim.day };
    } finally {
      g.sim.money = money; g.traffic.flowEma = flow; g.traffic.update = trafficUpdate;
      g.audio.soundOn = sound; g.audio.musicOn = music;
    }
  });
  report.errors = errs;
  report.passed = report.mix.population === report.actualPopulation && report.mix.moneyTrouble === 1 && report.mix.flowEma === 0.1 &&
    report.weights.tension === 0.6 && report.wildfire === 0.8 && report.otherSurvives === 0.4 && report.ended === 0 &&
    report.musicWithSoundOff > 0.1 && report.mutedScore < 0.001 && report.dayUnchanged && !errs.length;
  console.log(JSON.stringify(report));
  saveReport('shots/audio/score/state.json', report);
  if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
