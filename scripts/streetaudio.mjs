// Street sound test: traffic audio must follow the real cars (audit #10, HANDOFF_CARS_LOOK item 7).
//
// Renders src/audio/streetAudio.ts OFFLINE (OfflineAudioContext in headless Chromium, no game page, no sound
// card) with scripted cars and measures the result with an FFT:
//   - Doppler: an approaching car is higher than a receding one, by the physical amount (v = 30 m/s: +/-8%)
//   - engines differ by kind: semi, motorcycle, cyberslop, lifted truck, golf cart, garbage truck; idle is quiet
//   - honks come from cars waiting in a queue and never from free-flowing ones; the rate rises with the queue
//   - a siren follows its vehicle (pan and level change with position), stops with it, tow trucks have none
//   - tyres hiss on wet roads, scaled by speed, and only for near cars
//   - the mix never clips, the voice pool never exceeds its cap and never allocates audio nodes while running
//   - the CPU cost of update() with 1,900 cars
// On the OLD code (no streetAudio.ts; the ambience takes only aggregate SoundMix) the same checks fail: run it
// with BASE_URL=http://127.0.0.1:5175. Exits nonzero on failure. usage:
//   scripts/withslot.sh env BASE_URL=http://127.0.0.1:5182 node scripts/streetaudio.mjs [--json out.json]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { installLab } from './lib/streetlab.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon') && !r.url().includes('/src/audio/street')) errs.push(`${r.status()} ${r.url()}`); });
// any file the dev server serves will do: the test needs an origin to import the modules from, not the game
await page.goto(`${base}/package.json`, { waitUntil: 'load' });

let bad = 0;
const R = {}; // every measurement, for the report
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const num = (x, d = 3) => (typeof x === 'number' && isFinite(x) ? +x.toFixed(d) : x);

// ----------------------------------------------------------------------------- the lab, in the page
const mode = await page.evaluate(installLab);
console.log(`street audio: ${mode === 'new' ? 'src/audio/streetAudio.ts present' : 'OLD code: no src/audio/streetAudio.ts (ambience takes only an aggregate SoundMix)'}`);

const evalIn = (fn, arg) => page.evaluate(fn, arg);
const roadCar = (id, kind, o = {}) => ({ id, kind, x: 10, z: -13, yaw: 0, vs: [[0, 13]], ...o });
const only = (s, bus) => ({ ...s, only: bus });

// ============================================================================= NEW CODE
if (mode === 'new') {
  // ------------------------------------------------------------------ 1. Doppler
  {
    const spec = { dur: 6, rate: 22050, seed: 3, only: 'engine', cars: [{ id: 1, kind: 'cyberslop', x: 10, z: -90, yaw: 0, vs: [[0, 30]] }], probeAt: [0.9, 5.1] };
    const r = await evalIn(async (spec) => {
      const o = await __lab.render(spec);
      const A = __lab.A, rate = o.rate;
      const w = (t0, t1) => A.psd(A.seg('M', t0, t1));
      const app = A.peakHz(w(0.4, 1.4), rate, 1500, 4500), rec = A.peakHz(w(4.6, 5.6), rate, 1200, 4000);
      // the exact geometry at the middle of each window
      const vrAt = (t) => { const z = -90 + 30 * t, dx = 10, dy = 0.9 - 2, d = Math.sqrt(dx * dx + z * z + dy * dy); return (z / d) * 30; };
      return { app, rec, vrApp: vrAt(0.9), vrRec: vrAt(5.1), dbg: o.probes.map((p) => p.dbg.map((d) => ({ ratio: d.ratio, freq: d.freq }))), rms: A.rms(A.seg('M', 0, 6)) };
    }, spec);
    const c = 343, whine = 700 + 2900 * (30 / 44);
    const expApp = whine * c / (c + r.vrApp), expRec = whine * c / (c + r.vrRec);
    R.doppler = { whineHz: num(whine, 1), approachHz: num(r.app, 1), recedeHz: num(r.rec, 1), expectedApproach: num(expApp, 1), expectedRecede: num(expRec, 1), measuredRatio: num(r.app / r.rec), expectedRatio: num(expApp / expRec), vrApproach: num(r.vrApp, 1), vrRecede: num(r.vrRec, 1) };
    console.log('doppler', JSON.stringify(R.doppler));
    check(`Doppler: approaching car is higher than the same car receding (${R.doppler.approachHz} Hz vs ${R.doppler.recedeHz} Hz)`, r.app > r.rec * 1.1, R.doppler);
    check(`Doppler size at 30 m/s: ratio ${R.doppler.measuredRatio} vs physical ${R.doppler.expectedRatio} (within 2%)`, Math.abs(r.app / r.rec / (expApp / expRec) - 1) < 0.02, R.doppler);
    check(`Doppler: approaching pitch within 1.5% of the physical value (${R.doppler.approachHz} vs ${R.doppler.expectedApproach} Hz)`, Math.abs(r.app / expApp - 1) < 0.015, R.doppler);
  }

  // ------------------------------------------------------------------ 2. engines differ by kind
  {
    const kinds = ['sedan', 'hatchback', 'suv', 'pickup', 'liftedTruck', 'cyberslop', 'semi', 'motorcycle', 'golfCart', 'cityBus', 'garbageTruck', 'police', 'vwBus'];
    const res = {};
    for (const kind of kinds) {
      const v = kind === 'golfCart' ? 7 : 13;
      const spec = { dur: 2.2, rate: 44100, seed: 5, only: 'engine', cars: [{ id: 1, kind, x: 15, z: -v * 1.1, yaw: 0, vs: [[0, v]] }] };
      res[kind] = await evalIn(async ({ spec }) => {
        await __lab.render(spec);
        const A = __lab.A, x = A.seg('M', 0.1, 2.1), P = A.psd(x, 8192), rate = 44100;
        return { rms: A.rms(x), centroid: A.centroid(P, rate, 20, 10000), sub75: A.lowShare(P, rate, 75), low250: A.lowShare(P, rate, 250), share: A.peakShare(P, rate, 600, 5000, 30), peak: A.peakHz(P, rate, 600, 5000) };
      }, { spec });
    }
    // idle and cruising, same car
    for (const [name, vs] of [['sedanIdle', [[0, 0]]], ['sedanCruise', [[0, 13]]]]) {
      const spec = { dur: 2.2, rate: 44100, seed: 5, only: 'engine', cars: [{ id: 1, kind: 'sedan', x: 15, z: name === 'sedanIdle' ? 0 : -14, yaw: 0, vs }] };
      res[name] = await evalIn(async ({ spec }) => { await __lab.render(spec); return { rms: __lab.A.rms(__lab.A.seg('M', 0.1, 2.1)) }; }, { spec });
    }
    // engine brake: the semi lifting off (jake) vs cruising
    for (const [name, vs] of [['semiCruise', [[0, 13]]], ['semiJake', [[0, 16], [3, 7]]]]) {
      const spec = { dur: 3, rate: 44100, seed: 5, only: 'engine', cars: [{ id: 1, kind: 'semi', x: 15, z: -20, yaw: 0, vs }] };
      res[name] = await evalIn(async ({ spec }) => { await __lab.render(spec); const x = __lab.A.seg('M', 1.0, 2.6); return { rms: __lab.A.rms(x), mod: __lab.A.modDepth(x, 44100, 18, 25), modLope: __lab.A.modDepth(x, 44100, 3, 8) }; }, { spec });
    }
    // the garbage truck's hydraulic whine when it stands still
    for (const [name, vs, z] of [['garbageStopped', [[0, 0]], 0], ['garbageMoving', [[0, 13]], -14]]) {
      const spec = { dur: 2.2, rate: 44100, seed: 5, only: 'engine', cars: [{ id: 1, kind: 'garbageTruck', x: 15, z, yaw: 0, vs }] };
      res[name] = await evalIn(async ({ spec }) => { await __lab.render(spec); const A = __lab.A, P = A.psd(A.seg('M', 0.1, 2.1)); return { share: A.peakShare(P, 44100, 450, 900, 40), peak: A.peakHz(P, 44100, 450, 900) }; }, { spec });
    }
    R.kinds = res;
    console.log('kinds', JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, num(b, 3)]))]))));
    const k = res;
    check(`semi (${num(k.semi.centroid, 0)} Hz centroid) is much lower than a motorcycle (${num(k.motorcycle.centroid, 0)} Hz)`, k.motorcycle.centroid > 1.8 * k.semi.centroid, { semi: k.semi.centroid, moto: k.motorcycle.centroid });
    check(`semi has most of its power under 250 Hz (${num(k.semi.low250, 2)}) and the motorcycle does not (${num(k.motorcycle.low250, 2)})`, k.semi.low250 > 0.5 && k.motorcycle.low250 < 0.35, { semi: k.semi.low250, moto: k.motorcycle.low250 });
    check(`cyberslop is one line of whine (${num(100 * k.cyberslop.share, 0)}% of the 0.6-5 kHz power within 30 Hz of its peak, ${num(k.cyberslop.peak, 0)} Hz) where the semi (${num(100 * k.semi.share, 0)}%) and a sedan (${num(100 * k.sedan.share, 0)}%) are broadband engines`, k.cyberslop.share > 0.3 && k.cyberslop.share > 2 * k.semi.share && k.cyberslop.share > 2 * k.sedan.share, { cyber: k.cyberslop.share, semi: k.semi.share, sedan: k.sedan.share });
    check(`semi is louder than a sedan at the same distance (${num(k.semi.rms / k.sedan.rms, 2)}x)`, k.semi.rms > 1.8 * k.sedan.rms, { semi: k.semi.rms, sedan: k.sedan.rms });
    check(`lifted truck is the loudest non-diesel (${num(k.liftedTruck.rms / k.sedan.rms, 2)}x a sedan) and deeper (${num(100 * k.liftedTruck.sub75, 0)}% of its power is under 75 Hz, a sedan's ${num(100 * k.sedan.sub75, 0)}%)`, k.liftedTruck.rms > 1.8 * k.sedan.rms && k.liftedTruck.sub75 > 0.2 && k.liftedTruck.sub75 > 4 * k.sedan.sub75, { lifted: k.liftedTruck, sedan: k.sedan });
    check(`golf cart is quiet (${num(k.sedan.rms / k.golfCart.rms, 1)}x quieter than a sedan)`, k.golfCart.rms * 1.4 < k.sedan.rms, { cart: k.golfCart.rms, sedan: k.sedan.rms });
    check(`a car idling in a queue is quiet (${num(k.sedanCruise.rms / k.sedanIdle.rms, 1)}x quieter than cruising)`, k.sedanIdle.rms * 3 < k.sedanCruise.rms, { idle: k.sedanIdle.rms, cruise: k.sedanCruise.rms });
    check(`semi engine brake buzzes: ${num(k.semiJake.mod, 2)} modulation at 18-25 Hz vs ${num(k.semiCruise.mod, 2)} cruising`, k.semiJake.mod > 0.2 && k.semiJake.mod > 2.5 * k.semiCruise.mod, { jake: k.semiJake.mod, cruise: k.semiCruise.mod });
    check(`garbage truck whines when stopped (${num(100 * k.garbageStopped.share, 0)}% of 450-900 Hz in one line at ${num(k.garbageStopped.peak, 0)} Hz) and not when moving (${num(100 * k.garbageMoving.share, 0)}%)`, k.garbageStopped.share > 0.35 && k.garbageStopped.share > 2 * k.garbageMoving.share && Math.abs(k.garbageStopped.peak - 620) < 40, { stopped: k.garbageStopped, moving: k.garbageMoving });
    const six = ['sedan', 'semi', 'motorcycle', 'cyberslop', 'liftedTruck', 'golfCart'];
    const dist = (a, b) => Math.hypot(Math.log(k[a].centroid / k[b].centroid), 3 * (k[a].share - k[b].share));
    let closest = ['', '', 9];
    for (let i = 0; i < six.length; i++) for (let j = i + 1; j < six.length; j++) { const d = dist(six[i], six[j]); if (d < closest[2]) closest = [six[i], six[j], d]; }
    R.kinds.closestPair = { a: closest[0], b: closest[1], distance: num(closest[2], 3) };
    check(`kinds sound different: the two closest of sedan/semi/motorcycle/cyberslop/liftedTruck/golfCart (${closest[0]} and ${closest[1]}) differ by ${num(closest[2], 2)} in log-centroid + whine-share (need > 0.2)`, closest[2] > 0.2, R.kinds.closestPair);
  }

  // ------------------------------------------------------------------ 3. honks come from jams
  {
    const jamKinds = ['sedan', 'suv', 'pickup', 'semi', 'sedan', 'minivan', 'hatchback', 'liftedTruck', 'sedan', 'cityBus', 'sedan', 'suv'];
    const jam = (n, x = 10, z0 = -40, id0 = 100) => {
      const cars = []; let z = z0;
      for (let i = 0; i < n; i++) {
        const kind = jamKinds[i % jamKinds.length], len = { semi: 16, cityBus: 12, pickup: 5.8, liftedTruck: 6, minivan: 5.1, suv: 4.9, sedan: 4.6, hatchback: 4 }[kind];
        if (i) z += 0.5 * (cars[i - 1].len + len) + 2;
        cars.push({ id: id0 + i, kind, x, z, yaw: 0, vs: [[0, 0]], len });
      }
      return cars;
    };
    const free = (n, x = -10) => Array.from({ length: n }, (_, i) => ({ id: 1 + i, kind: ['sedan', 'suv', 'pickup', 'hatchback', 'semi', 'motorcycle'][i % 6], x: i % 2 ? x : -x, z: -190 + (380 / n) * i, yaw: i % 2 ? 0 : Math.PI, vs: [[0, 13]], wrap: [-200, 200] }));
    const run = (cars, seed, dur = 60, only = 'horn') => evalIn(async ({ spec }) => {
      const o = await __lab.render(spec); const A = __lab.A;
      return { honks: o.honks, n: o.stats.honks, jamCars: o.stats.jamCars, jams: o.stats.jams, rms: A.rms(A.seg('M', 0, spec.dur)), peak: A.peakAbs(A.seg('L', 0, spec.dur)), maxHorns: o.max.horns };
    }, { spec: { dur, rate: 22050, seed, only, cars } });
    const flow = await run(free(14), 7);
    const wait = await run([...jam(10), ...free(6)], 7);
    R.honks = { freeFlow: { honks: flow.n, hornRms: flow.rms, jamCars: flow.jamCars }, jam10: { honks: wait.n, fromIds: [...new Set(wait.honks.map((h) => h.id))], hornRms: num(wait.rms, 5), maxHorns: wait.maxHorns } };
    console.log('honks', JSON.stringify({ flow: { n: flow.n, rms: flow.rms }, wait: { n: wait.n, rms: wait.rms, first: wait.honks.slice(0, 6) } }));
    check(`free-flowing traffic (14 cars at 13 m/s, 60 s) never honks: ${flow.n} honks, horn-bus level ${flow.rms}`, flow.n === 0 && flow.rms === 0 && flow.jamCars === 0, flow);
    check(`a 10-car queue honks (${wait.n} honks in 60 s, first at ${wait.honks[0]?.t ?? '-'} s)`, wait.n >= 4 && wait.rms > 0.001, { n: wait.n, rms: wait.rms });
    check('every honk comes from a waiting car in the queue, none from the 6 free-flowing ones', wait.honks.length > 0 && wait.honks.every((h) => h.id >= 100 && h.id < 110 && h.size >= 3), wait.honks.filter((h) => h.id < 100 || h.id >= 110).slice(0, 4));
    check('nobody honks in the first 6 s of waiting', wait.honks.every((h) => h.t >= 6), wait.honks.filter((h) => h.t < 6));
    // rate rises with the jam: 2 (a light), 4, 8, 14 cars; three seeds each, 60 s
    const by = {};
    for (const n of [2, 4, 8, 14]) { by[n] = 0; for (const seed of [11, 12, 13]) by[n] += (await run(jam(n), seed, 60)).n; by[n] /= 3; }
    R.honks.bySize = by;
    console.log('honks per 60 s by queue size', JSON.stringify(by));
    check(`two cars at a light never honk (${by[2]})`, by[2] === 0, by);
    check(`honk rate rises with the size of the jam: ${by[4]} < ${by[8]} < ${by[14]} honks per minute (4, 8, 14 cars)`, by[4] < by[8] && by[8] < by[14] && by[4] > 0, by);
    // different tones by kind: the sedan's, a semi's air horn and the motorcycle's beep
    const tones = await evalIn(async () => {
      const { HORNS } = __lab.prof; const out = {};
      for (const k of ['sedan', 'semi', 'motorcycle', 'liftedTruck', 'cyberslop', 'golfCart']) out[k] = HORNS[k].f.join('+');
      return out;
    });
    R.honks.tones = tones;
    check(`horns differ by kind (${JSON.stringify(tones)})`, new Set(Object.values(tones)).size === Object.keys(tones).length, tones);
    // a honk is heard at a horn's own pitch: render one and find the peak
    const horn = await evalIn(async () => {
      const cars = Array.from({ length: 6 }, (_, i) => ({ id: 300 + i, kind: 'sedan', x: 10, z: -10 + i * 6.6, yaw: 0, vs: [[0, 0]], len: 4.6 }));
      const o = await __lab.render({ dur: 40, rate: 22050, seed: 21, only: 'horn', cars });
      const A = __lab.A, h = o.honks[0]; if (!h) return null;
      const seg = A.seg('M', h.t, h.t + 0.5), P = A.psd(seg, 4096);
      return { hz: A.peakHz(P, 22050, 300, 700, 4096), t: h.t, id: h.id };
    });
    console.log('horn peak', JSON.stringify(horn));
    check(`a sedan honk is a horn, near 415/523 Hz (measured ${horn ? num(horn.hz, 0) : '-'} Hz)`, !!horn && (Math.abs(horn.hz - 415) < 45 || Math.abs(horn.hz - 523) < 55), horn);
  }

  // ------------------------------------------------------------------ 4. sirens follow the vehicle
  {
    const spec = { dur: 8.5, rate: 44100, seed: 4, sirenPhase: 0.5, only: 'siren', cars: [{ id: 50, kind: 'ambulance', x: -125, z: 15, yaw: Math.PI / 2, vs: [[0, 30]] }] };
    const r = await evalIn(async ({ spec }) => {
      const o = await __lab.render(spec); const A = __lab.A;
      const win = (t0, t1) => {
        const l = A.seg('L', t0, t1), rr = A.seg('R', t0, t1), m = A.seg('M', t0, t1), P = A.psd(m);
        const el = A.rms(l), er = A.rms(rr);
        return { rms: A.rms(m), pan: (er - el) / (er + el), lo: A.peakHz(P, 44100, 540, 800), hi: A.peakHz(P, 44100, 820, 1150) };
      };
      const xAt = (t) => -125 + 30 * t;
      const vrAt = (t) => { const x = xAt(t), d = Math.sqrt(x * x + 15 * 15 + 1.1 * 1.1 + 0); return (x / d) * 30; };
      return { app: win(0.3, 1.3), mid: win(3.9, 4.6), rec: win(7.0, 8.0), vrApp: vrAt(0.8), vrRec: vrAt(7.5), max: o.max };
    }, { spec });
    const c = 343;
    const eApp = 680 * c / (c + r.vrApp), eRec = 680 * c / (c + r.vrRec);
    R.siren = { ambulance: { approach: r.app, near: r.mid, recede: r.rec, expectedLoApproach: num(eApp, 1), expectedLoRecede: num(eRec, 1), vrApp: num(r.vrApp, 1), vrRec: num(r.vrRec, 1) } };
    console.log('siren', JSON.stringify(R.siren));
    check(`siren pans with the vehicle: left (${num(r.app.pan, 2)}) -> centre (${num(r.mid.pan, 2)}) -> right (${num(r.rec.pan, 2)})`, r.app.pan < -0.3 && r.rec.pan > 0.3 && Math.abs(r.mid.pan) < 0.25, { app: r.app.pan, mid: r.mid.pan, rec: r.rec.pan });
    check(`siren level follows distance: ${num(r.mid.rms / r.app.rms, 1)}x louder at the closest point than 100 m out, ${num(r.mid.rms / r.rec.rms, 1)}x than 100 m away on the far side`, r.mid.rms > 2.5 * r.app.rms && r.mid.rms > 2.5 * r.rec.rms, { app: r.app.rms, mid: r.mid.rms, rec: r.rec.rms });
    check(`siren Doppler: the low hi-lo tone is ${num(r.app.lo, 1)} Hz approaching (physical ${num(eApp, 1)}) and ${num(r.rec.lo, 1)} Hz receding (physical ${num(eRec, 1)})`, Math.abs(r.app.lo / eApp - 1) < 0.02 && Math.abs(r.rec.lo / eRec - 1) < 0.02 && r.app.lo > r.rec.lo * 1.1, R.siren);
    check(`one siren voice used for one vehicle (max ${r.max.sirens})`, r.max.sirens === 1, r.max);

    // stops with the vehicle, and silent when wrecked / for the tow truck
    const stop = await evalIn(async () => {
      const spec = { dur: 14, rate: 22050, seed: 4, only: 'siren', cars: [{ id: 60, kind: 'firetruck', x: 10, z: -40, yaw: 0, vs: [[0, 15], [3, 15], [5, 0], [14, 0]] }] };
      const o = await __lab.render(spec), A = __lab.A;
      return { moving: A.rms(A.seg('M', 0.5, 3)), stopped: A.rms(A.seg('M', 8, 13)), sirensAfter: o.probes.length };
    });
    R.siren.stopsWithVehicle = { moving: num(stop.moving, 5), stopped: num(stop.stopped, 8), dB: num(20 * Math.log10(stop.stopped / stop.moving + 1e-12), 1) };
    check(`siren stops with the vehicle: ${R.siren.stopsWithVehicle.dB} dB once the fire truck has been stopped for 3 s`, stop.stopped < stop.moving * 0.01, stop);
    const quiet = await evalIn(async () => {
      const mk = (kind, extra = {}) => ({ dur: 6, rate: 22050, seed: 4, only: 'siren', cars: [{ id: 70, kind, x: 10, z: -30, yaw: 0, vs: [[0, 15]], ...extra }] });
      const out = {};
      for (const [name, spec] of [['towTruck', mk('towTruck')], ['policeWrecked', mk('police', { crashAt: 0 })], ['policeMoving', mk('police')], ['sedan', mk('sedan')]]) {
        const o = await __lab.render(spec); out[name] = { rms: __lab.A.rms(__lab.A.seg('M', 0.5, 5.5)), maxSirens: o.max.sirens };
      }
      return out;
    });
    R.siren.silence = quiet;
    check(`tow truck (amber beacon only), a sedan, and a wrecked police car sound no siren; a moving police car does (${JSON.stringify(Object.fromEntries(Object.entries(quiet).map(([k, v]) => [k, num(v.rms, 5)])))})`, quiet.towTruck.rms === 0 && quiet.sedan.rms === 0 && quiet.policeWrecked.rms === 0 && quiet.policeMoving.rms > 0.003 && quiet.towTruck.maxSirens === 0, quiet);
    const kindsSir = await evalIn(async () => {
      const out = {};
      for (const kind of ['police', 'ambulance', 'firetruck']) {
        const o = await __lab.render({ dur: 12, rate: 22050, seed: 4, sirenPhase: 0, only: 'siren', cars: [{ id: 80, kind, x: 10, z: 0, yaw: 0, vs: [[0, 2]] }] });
        const A = __lab.A, x = A.seg('M', 1, 11), P = A.psd(x);
        out[kind] = { centroid: A.centroid(P, 22050, 200, 5000), sweep: A.modDepth(x, 22050, 0.1, 0.6), rms: A.rms(x) };
      }
      return out;
    });
    R.siren.kinds = kindsSir;
    console.log('siren kinds', JSON.stringify(kindsSir));
    check('police, ambulance and fire truck have different siren spectra', (() => { const c = Object.values(kindsSir).map((k) => k.centroid); return Math.abs(Math.log(c[0] / c[2])) > 0.08 || Math.abs(Math.log(c[1] / c[2])) > 0.08; })(), kindsSir);
    // four emergency vehicles, three siren voices
    const cap = await evalIn(async () => {
      const cars = ['police', 'ambulance', 'firetruck', 'police', 'ambulance'].map((kind, i) => ({ id: 90 + i, kind, x: 20 + i * 6, z: -30 + i * 10, yaw: 0, vs: [[0, 18]], wrap: [-200, 200] }));
      const o = await __lab.render({ dur: 5, rate: 22050, seed: 4, only: 'siren', cars });
      return o.max;
    });
    check(`5 emergency vehicles in view: ${cap.sirens} siren voices (cap 3)`, cap.sirens === 3, cap);
  }

  // ------------------------------------------------------------------ 5. rain hiss
  {
    const run = (name, env, v, x = 12, kind = 'sedan') => evalIn(async ({ env, v, x, kind }) => {
      const cars = [{ id: 1, kind, x, z: -v * 1.1, yaw: 0, vs: [[0, v]] }];
      const o = await __lab.render({ dur: 2.2, rate: 44100, seed: 8, only: 'engine', env, cars });
      const A = __lab.A, P = A.psd(A.seg('M', 0.1, 2.1));
      return { hiss: A.bandDb(P, 44100, 3500, 9000), voices: o.max.voices, rms: A.rms(A.seg('M', 0.1, 2.1)) };
    }, { env, v, x, kind });
    const dry = await run('dry', { wet: 0, rain: 0 }, 13);
    const damp = await run('damp', { wet: 1, rain: 0 }, 13);
    const rain = await run('rain', { wet: 1, rain: 1 }, 13);
    const parked = await run('parkedWet', { wet: 1, rain: 1 }, 0);
    const parkedDry = await run('parkedDry', { wet: 0, rain: 0 }, 0);
    const slow = await run('slow', { wet: 1, rain: 1 }, 5);
    const fast = await run('fast', { wet: 1, rain: 1 }, 25);
    const far = await run('far', { wet: 1, rain: 1 }, 13, 300);
    R.rain = { dry: num(dry.hiss, 1), wetRoadNoRain: num(damp.hiss, 1), rain: num(rain.hiss, 1), parkedWet: num(parked.hiss, 1), parkedDry: num(parkedDry.hiss, 1), slow5: num(slow.hiss, 1), fast25: num(fast.hiss, 1), farVoices: far.voices, unit: 'dB in 3.5-9 kHz, sedan 12 m off the road' };
    console.log('rain', JSON.stringify(R.rain));
    check(`rain adds hiss: 3.5-9 kHz is ${num(rain.hiss - dry.hiss, 1)} dB louder on a wet road in rain than dry`, rain.hiss - dry.hiss >= 8, R.rain);
    check(`wet road without rain still hisses, less (${num(damp.hiss - dry.hiss, 1)} dB vs ${num(rain.hiss - dry.hiss, 1)} dB in rain)`, damp.hiss - dry.hiss >= 5 && damp.hiss < rain.hiss, R.rain);
    check(`a parked car in the rain makes no hiss (${num(parked.hiss - parkedDry.hiss, 1)} dB vs dry)`, Math.abs(parked.hiss - parkedDry.hiss) < 3, R.rain);
    check(`hiss scales with speed: ${num(fast.hiss - slow.hiss, 1)} dB more at 25 m/s than at 5 m/s`, fast.hiss - slow.hiss >= 6, R.rain);
    check('only near cars hiss: a car 300 m away gets no voice', far.voices === 0, far);
  }

  // ------------------------------------------------------------------ 6/7. peak, pool cap, no allocation
  {
    const allKinds = ['sedan', 'hatchback', 'suv', 'minivan', 'pickup', 'liftedTruck', 'cyberslop', 'semi', 'boxTruck', 'police', 'ambulance', 'firetruck', 'golfCart', 'vwBus', 'slopVan', 'motorcycle', 'towTruck', 'cityBus', 'garbageTruck'];
    const crowd = await evalIn(async ({ allKinds }) => {
      const rnd = __lab.mulberry32(99), cars = [];
      for (let i = 0; i < 40; i++) cars.push({ id: 500 + i, kind: allKinds[i % allKinds.length], x: (rnd() - 0.5) * 60, z: (rnd() - 0.5) * 60, yaw: rnd() * 6.28, vs: [[0, 8 + rnd() * 24], [10, 8 + rnd() * 24], [20, 8 + rnd() * 24]], acc: (rnd() - 0.5) * 6, wrap: [-30, 30] });
      let z = -30; for (let i = 0; i < 12; i++) { const len = 4.6; z += len + 2.2; cars.push({ id: 700 + i, kind: i % 4 === 0 ? 'semi' : 'sedan', x: 25, z, yaw: 0, vs: [[0, 0]], len: i % 4 === 0 ? 16 : 4.6 }); }
      const out = {};
      // a busy street as the game will really have it: 10 cars at town speeds within 60 m, a 6-car queue, one ambulance passing
      const street = Array.from({ length: 10 }, (_, i) => ({ id: 900 + i, kind: ['sedan', 'suv', 'pickup', 'semi', 'motorcycle', 'hatchback', 'cyberslop', 'liftedTruck', 'minivan', 'cityBus'][i], x: i % 2 ? 9 : -9, z: -60 + i * 12, yaw: i % 2 ? 0 : Math.PI, vs: [[0, 12]], wrap: [-60, 60] }));
      let zq = -20; for (let i = 0; i < 6; i++) { zq += 6.8; street.push({ id: 950 + i, kind: 'sedan', x: 24, z: zq, yaw: 0, vs: [[0, 0]], len: 4.6 }); }
      street.push({ id: 960, kind: 'ambulance', x: -130, z: 14, yaw: Math.PI / 2, vs: [[0, 26]] });
      for (const [name, opts] of [['raw', { softClip: false }], ['soft', {}], ['low', { limit: 'low', softClip: false }], ['busy', { softClip: false, cars: street, dur: 20 }]]) {
        const o = await __lab.render({ dur: 32, rate: 22050, seed: 5, cars, env: { wet: 1, rain: 0.6 }, ...opts });
        const A = __lab.A;
        out[name] = { peak: Math.max(A.peakAbs(A.seg('L', 0, 32)), A.peakAbs(A.seg('R', 0, 32))), rms: A.rms(A.seg('M', 3, 32)), max: o.max, honks: o.stats.honks, nodesBuilt: o.nodesBuilt, nodesAfter: o.nodesAfter, poolSize: o.poolSize, cap: o.stats.cap, hornCap: o.stats.hornCap, sirenCap: o.stats.sirenCap };
      }
      return out;
    }, { allKinds });
    R.crowd = crowd;
    console.log('crowd', JSON.stringify(crowd));
    check(`the mix never clips: worst case (40 cars, 12 in a queue, all 19 kinds, rain, everything within 30 m) peaks at ${num(crowd.raw.peak, 2)} before the limiter and ${num(crowd.soft.peak, 2)} after it`, crowd.soft.peak < 0.95 && crowd.raw.peak < 1.4, { raw: crowd.raw.peak, soft: crowd.soft.peak });
    check(`a busy street (10 cars, a queue, an ambulance) peaks at ${num(crowd.busy.peak, 2)} with the limiter off, so the limiter stays out of the way`, crowd.busy.peak < 0.6, crowd.busy);
    check(`voice pool cap respected: at most ${crowd.raw.max.voices} car voices (cap 8), ${crowd.raw.max.sirens} sirens (3), ${crowd.raw.max.horns} horns (4)`, crowd.raw.max.voices <= 8 && crowd.raw.max.sirens <= 3 && crowd.raw.max.horns <= 4 && crowd.raw.max.voices >= 6, crowd.raw.max);
    check(`Low preset: at most ${crowd.low.max.voices} car voices (cap 4), ${crowd.low.max.sirens} sirens (2), ${crowd.low.max.horns} horns (2)`, crowd.low.max.voices <= 4 && crowd.low.max.sirens <= 2 && crowd.low.max.horns <= 2 && crowd.low.max.voices >= 3, crowd.low.max);
    check(`no audio nodes are created while running (${crowd.raw.nodesBuilt} built up front, ${crowd.raw.nodesAfter} after 32 s with ${crowd.raw.honks} honks)`, crowd.raw.nodesAfter === crowd.raw.nodesBuilt, crowd.raw);
    check(`the crowd is audible but not deafening (rms ${num(crowd.raw.rms, 3)})`, crowd.raw.rms > 0.01 && crowd.raw.rms < 0.3, crowd.raw);
  }

  // ------------------------------------------------------------------ 7b. paused / muted / zoomed out: asleep
  {
    const r = await evalIn(async () => {
      const cars = Array.from({ length: 6 }, (_, i) => ({ id: 1 + i, kind: ['sedan', 'semi', 'pickup', 'police', 'suv', 'motorcycle'][i], x: 12, z: -30 + i * 9, yaw: 0, vs: [[0, 12]], wrap: [-40, 40] }));
      const o = await __lab.render({ dur: 14, rate: 22050, seed: 3, cars, probeAt: [3, 7.5, 13], envAt: [[4, { speed: 0 }], [9, { speed: 1 }]] });
      const A = __lab.A, sec = (t0, t1) => A.rms(A.seg('M', t0, t1));
      const playing = sec(1, 3.8), paused = sec(6.5, 8.5), resumed = sec(11, 13.5);
      // and zoomed out to the map (camera 1,800 m up)
      const z = await __lab.render({ dur: 8, rate: 22050, seed: 3, cars, view: { dist: 1800 }, probeAt: [7] });
      return { playing, paused, resumed, probes: o.probes.map((p) => ({ t: p.t, awake: p.awake, voices: p.stats.voices })), zoomedOut: { rms: A.rms(A.seg('M', 2, 8)), awake: z.probes[0].awake, voices: z.probes[0].stats.voices } };
    });
    R.sleep = r;
    console.log('sleep', JSON.stringify(r));
    const [p3, p75, p13] = r.probes;
    check(`paused game: the street fades out (${num(20 * Math.log10(r.paused / r.playing + 1e-12), 0)} dB) and every voice is released and disconnected (awake ${p75.awake}, ${p75.voices} voices)`, r.paused < r.playing * 0.01 && !p75.awake && p75.voices === 0, r);
    check(`unpaused: the voices come back (${p13.voices} voices, ${num(20 * Math.log10(r.resumed / r.playing), 1)} dB vs before)`, p13.awake && p13.voices > 0 && r.resumed > r.playing * 0.4, r);
    check(`zoomed out to the map (1,800 m): the cars are gone, the street is asleep (${r.zoomedOut.voices} voices, rms ${num(r.zoomedOut.rms, 6)})`, r.zoomedOut.voices === 0 && !r.zoomedOut.awake && r.zoomedOut.rms < 1e-4, r.zoomedOut);
  }

  // ------------------------------------------------------------------ 8. CPU
  {
    const perf = await evalIn(async () => {
      const ctx = new OfflineAudioContext(2, 22050, 22050);
      const synth = new __lab.Synth(ctx), out = ctx.createGain(); out.connect(ctx.destination);
      const st = new __lab.street.StreetAudio(synth, out, { rng: __lab.mulberry32(1) });
      const rnd = __lab.mulberry32(2), kinds = Object.keys(__lab.LEN), cars = [];
      for (let i = 0; i < 1900; i++) cars.push({ id: i, kind: kinds[i % kinds.length], x: (rnd() - 0.5) * 600, y: 0, z: (rnd() - 0.5) * 600, v: rnd() < 0.4 ? 0 : 8 + rnd() * 20, yaw: rnd() * 6.28, crashed: 0, acc: 0, len: 5 });
      const view = { x: 0, y: 20, z: 0, rx: 1, rz: 0, dist: 60 }, env = { rain: 0, wet: 0, hush: 0, speed: 1 };
      for (let i = 0; i < 240; i++) st.update(1 / 60, cars, view, env); // warm up
      const n = 3000, all = [], scans = []; let s0 = st.stats.scans;
      for (let i = 0; i < n; i++) { const a = performance.now(); st.update(1 / 60, cars, view, env); const d = performance.now() - a; all.push(d); if (st.stats.scans !== s0) { scans.push(d); s0 = st.stats.scans; } }
      all.sort((a, b) => a - b); scans.sort((a, b) => a - b);
      const mean = all.reduce((a, b) => a + b, 0) / n;
      return { perFrameMs: mean, p99: all[Math.floor(n * 0.99)], scanMedian: scans[scans.length >> 1], scanP90: scans[Math.floor(scans.length * 0.9)], worstMs: all[n - 1], scans: scans.length, voices: st.stats.voices, jamCars: st.stats.jamCars };
    });
    R.cpu = { cars: 1900, note: 'all within 300 m of the ears, 40% stopped (the dense worst case)', meanFrameMs: num(perf.perFrameMs, 4), p99FrameMs: num(perf.p99, 3), scanFrameMedianMs: num(perf.scanMedian, 3), scanFrameP90Ms: num(perf.scanP90, 3), worstFrameMs: num(perf.worstMs, 2), voices: perf.voices, slowCarsScanned: perf.jamCars };
    console.log('cpu', JSON.stringify(R.cpu));
    check(`update() with 1,900 cars: ${R.cpu.meanFrameMs} ms a frame on average, the 4 Hz scan frame ${R.cpu.scanFrameMedianMs} ms median / ${R.cpu.scanFrameP90Ms} ms p90 (worst frame ${R.cpu.worstFrameMs} ms)`, perf.perFrameMs < 0.5 && perf.scanP90 < 3, R.cpu);
  }
}

// ============================================================================= OLD CODE
if (mode === 'old') {
  // The old street audio: Ambience.update(dt, SoundMix) with an aggregate traffic level. Count what it does with the same scenes.
  const old = await page.evaluate(async () => {
    const { Synth } = __lab, { Ambience } = __lab;
    const measure = async (seed, kindLabel) => {
      const rate = 22050, secs = 60;
      const ctx = new OfflineAudioContext(1, rate * secs, rate);
      // count horn oscillators (two sawtooths near 415/523 Hz per honk)
      const horns = [];
      const co = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => { const o = co(); const sf = o.frequency.setValueAtTime.bind(o.frequency); o.frequency.setValueAtTime = (f, t) => { if (o.type === 'sawtooth' && f > 330 && f < 650) horns.push(t); return sf(f, t); }; return o; };
      const s = new Synth(ctx), bus = ctx.createGain(); bus.connect(ctx.destination);
      const amb = new Ambience(s, bus, bus);
      const mix = { zoom: 0.1, nature: 0, water: 0, traffic: 0.6, construction: 0, people: 0, night: 0, weather: 'clear', weatherIntensity: 0, season: 'summer' };
      for (let t = 0; t < secs; t += 0.05) amb.update(0.05, mix);
      const buf = await ctx.startRendering();
      const x = buf.getChannelData(0);
      const A = { P: null };
      return { honks: Math.round(horns.length / 2), rms: Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length) };
    };
    // free flow and a ten-car jam look the same to the old code: it only sees SoundMix.traffic
    return { freeFlow: await measure(1, 'free'), jam: await measure(2, 'jam') };
  });
  R.old = old;
  console.log('old', JSON.stringify(old));
  check('Doppler: an approaching car is higher than a receding one', false, { why: 'no per-car voices exist; the pass-by is a random noise sweep (ambience.ts passby)' });
  check('engines differ by kind (semi vs motorcycle vs cyberslop spectra)', false, { why: 'Ambience.update(dt, mix) takes no vehicle kind; one brown-noise bed scaled by the car count' });
  check(`free-flowing traffic never honks (old: ${old.freeFlow.honks} random honks in 60 s of a free-flowing scene)`, old.freeFlow.honks === 0, old.freeFlow);
  check(`a jam honks more than free flow (old: ${old.jam.honks} vs ${old.freeFlow.honks}: honks are random, the same either way)`, old.jam.honks > 2 * old.freeFlow.honks + 3, old);
  check('a siren follows its vehicle', false, { why: 'the old siren is an SFX one-shot for the city alert (hud.ts), not attached to any car' });
  check('rain adds tyre hiss on wet roads for near cars', false, { why: 'rain is a bed scaled by weather, not by cars or their speed' });
}

check('no page errors', errs.length === 0, errs.slice(0, 3));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(R, null, 1));
await browser.close();
console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
