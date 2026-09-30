// Street sound inside the real game (the unit test, scripts/streetaudio.mjs, renders the voices offline and
// measures them; this checks the wiring): the frame loop feeds traffic.cars to AudioEngine.street(), voices
// go to real cars near the camera, the pool honours the preset's cap, mute / pause / zooming out to the map
// put every voice back to sleep, and the old random honks and pass-bys are switched off once cars are fed.
// Drives the game with g.frame() (no rendering) on the reference block. Exits nonzero on failure.
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5182 node scripts/streetaudio-game.mjs
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: [...ARGS, '--autoplay-policy=no-user-gesture-required'] });
const { page, errs } = await openBlock(browser, { base, quality: process.env.QUALITY || 'low' });
const r = await page.evaluate(async () => {
  const g = window.__game, tr = g.traffic, au = g.audio;
  const out = { quality: g.q.name, hasStreet: typeof au.street === 'function' };
  if (!out.hasStreet) return out;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  for (let i = 0; i < 1200; i++) tr.update(1 / 20, 1, 8, g.sim.population, g.sim.jobsFilled, g.rts.target);
  au.unlock();
  await sleep(300);
  out.ctxState = au.ctx.state;
  const st = () => au.streetVoices;
  out.poolBuilt = !!st();
  // aim at moving cars
  const moving = tr.cars.filter((c) => c.v > 6 && !c.junction && c.crashed === 0);
  const target = moving[0] || tr.cars[0];
  window.__dbg.view(target.x, target.z, 60, target.ryaw + 0.9, 0.5);
  g.rts.target.set(target.x, target.y, target.z); g.rts.distance = 60;
  const frames = async (n, dt = 1 / 20, step = true) => { for (let i = 0; i < n; i++) { if (step) tr.update(dt, 1, 8, g.sim.population, g.sim.jobsFilled, g.rts.target); g.frame(dt, false); await sleep(30); } };
  await frames(40);
  out.randomTrafficOff = au.amb.randomTraffic === false;
  out.near = { cars: tr.cars.length, voices: st().stats.voices, cap: st().stats.cap, dbg: st().debug().slice(0, 4).map((d) => ({ kind: d.kind, dist: +d.dist.toFixed(1), gain: +d.gain.toFixed(4), pan: +d.pan.toFixed(2), ratio: +d.ratio.toFixed(3) })) };
  // zoom out to the map: the cars fade out and every voice is put to sleep
  g.rts.distance = 1800;
  await frames(40, 1 / 20, false);
  out.zoomedOut = { voices: st().stats.voices, awake: st().awake };
  g.rts.distance = 60;
  await frames(30, 1 / 20, false);
  out.back = { voices: st().stats.voices, awake: st().awake };
  // pause
  const speed = g.sim.speed;
  g.sim.speed = 0;
  await frames(120, 1 / 20, false); // 6 s of frames with the game paused
  out.paused = { voices: st().stats.voices, awake: st().awake };
  g.sim.speed = speed || 1;
  await frames(30, 1 / 20, false);
  out.resumed = { voices: st().stats.voices, awake: st().awake };
  // mute
  au.setMuted(true);
  await frames(10, 1 / 20, false);
  out.muted = { voices: st().stats.voices, awake: st().awake };
  au.setMuted(false);
  await frames(30, 1 / 20, false);
  out.unmuted = { voices: st().stats.voices, awake: st().awake };
  // a real jam: the ten nearest cars stopped nose to tail on their own lane (the traffic model is not stepped)
  const seg = target.path[target.pi];
  const queue = tr.cars.filter((c) => !c.junction && c.crashed === 0).slice(0, 10);
  const saved = queue.map((c) => ({ c, v: c.v }));
  let z = 0;
  const jam = queue.map((c, i) => ({ id: c.id, kind: c.kind, x: g.rts.target.x + 8, y: c.y, z: g.rts.target.z - 30 + (z += 7.5), v: 0, yaw: 0, crashed: 0, acc: 0, len: c.len }));
  const before = st().stats.honks;
  for (let i = 0; i < 600; i++) au.street(0.1, jam, g.rts, 0, 1); // 60 s of street time
  out.jam = { cars: jam.length, honks: st().stats.honks - before, jamCars: st().stats.jamCars, jams: st().stats.jams };
  void seg; void saved;
  const before2 = st().stats.honks;
  const flow = tr.cars.filter((c) => c.v > 5).slice(0, 12).map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, z: c.z, v: 10, yaw: c.yaw, crashed: 0, acc: 0, len: c.len }));
  for (let i = 0; i < 600; i++) au.street(0.1, flow, g.rts, 0, 1);
  out.flow = { cars: flow.length, honks: st().stats.honks - before2 };
  return out;
});
console.log(JSON.stringify(r));
check('the audio engine has street() (new code)', r.hasStreet, r);
if (r.hasStreet) {
  check('the audio context runs after the unlock', r.ctxState === 'running', r);
  check('the voice pool exists after unlock', r.poolBuilt);
  check(`near cars get voices (${r.near.voices} live of ${r.near.cars} cars, cap ${r.near.cap} on ${r.quality})`, r.near.voices > 0 && r.near.voices <= r.near.cap, r.near);
  check('the old random honks and pass-bys are off once cars are fed', r.randomTrafficOff);
  check(`zoomed out to the map: no voices, asleep (${JSON.stringify(r.zoomedOut)})`, r.zoomedOut.voices === 0 && !r.zoomedOut.awake, r.zoomedOut);
  check(`zoomed back in: voices return (${r.back.voices})`, r.back.voices > 0 && r.back.awake, r.back);
  check(`paused: voices asleep (${JSON.stringify(r.paused)})`, r.paused.voices === 0 && !r.paused.awake, r.paused);
  check(`resumed: voices return (${r.resumed.voices})`, r.resumed.voices > 0, r.resumed);
  check(`muted: voices asleep (${JSON.stringify(r.muted)})`, r.muted.voices === 0 && !r.muted.awake, r.muted);
  check(`unmuted: voices return (${r.unmuted.voices})`, r.unmuted.voices > 0, r.unmuted);
  check(`a 10-car queue honks in the game (${r.jam.honks} honks, ${r.jam.jamCars} cars in ${r.jam.jams} jam)`, r.jam.honks > 0 && r.jam.jamCars >= 8, r.jam);
  check(`12 free-flowing cars do not (${r.flow.honks} honks)`, r.flow.honks === 0, r.flow);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
