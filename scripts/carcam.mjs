// Real-car close-ups on the reference block (docs/HANDOFF_CARS_LOOK.md, "Cars need traffic before you capture them"): opens the saved town
// (scripts/refblock.mjs), steps the traffic model until the morning rush has built, then aims the camera at real cars: one moving, one in a
// queue, one at a busy junction; and takes a picture of each, by day and by night, on the quality preset asked for. Prints the renderer's
// draw calls and triangles for each picture and the kinds of car seen. Run it against the frozen old code and against yours for the same
// pictures before and after.
// usage: BASE_URL=http://127.0.0.1:5175 node scripts/carcam.mjs <tag> [quality=high] [scenes=moving,queue,junction] [times=day,night]
//   OUT=shots/carcam  SEED steps: STEPS=1200  DIST=11  PITCH=0.28  WEATHER=clear|rain  KIND=pickup (prefer this kind)  W=1280 H=720  PHONE=1
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { ARGS, EXE, openBlock } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const [tag = 'run', quality = 'high', scenesArg = 'moving,queue,junction', timesArg = 'day,night'] = process.argv.slice(2);
const scenes = scenesArg.split(','), times = timesArg.split(',');
const out = `${process.env.OUT || 'shots/carcam'}/${tag}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const phone = !!process.env.PHONE;
const { page, errs, center } = await openBlock(browser, phone ? { base, quality, width: 390, height: 780, phone: true } : { base, quality, width: Number(process.env.W || 1280), height: Number(process.env.H || 720) });
const found = await page.evaluate(({ steps, kind }) => {
  const g = window.__game;
  for (let i = 0; i < steps; i++) g.traffic.update(1 / 20, 1, 8, g.sim.population, g.sim.jobsFilled, g.rts.target);
  const cars = g.traffic.cars.filter((c) => c.crashed <= 0 && c.dep <= 0 && c.arr < 0);
  const pick = (f) => { const list = cars.filter(f); return list.find((c) => kind && c.kind === kind) ?? list[0]; };
  const moving = pick((c) => c.v > 8 && !c.junction);
  // a queue: a stopped car with another stopped car right behind it on the same segment
  const queue = pick((c) => c.v < 0.5 && !c.junction && cars.some((d) => d !== c && d.v < 0.5 && !d.junction && d.path[d.pi].seg === c.path[c.pi].seg && Math.abs(d.s - c.s) < 12));
  // the junction with the most cars close to it
  let junction, best = 0;
  for (const c of cars) { const n = cars.filter((d) => Math.hypot(d.x - c.x, d.z - c.z) < 25).length; if (n > best) { best = n; junction = c; } }
  const desc = (c) => c && { id: c.id, kind: c.kind, x: c.x, z: c.z, ryaw: c.ryaw, v: +c.v.toFixed(1) };
  return { moving: desc(moving), queue: desc(queue), junction: desc(junction), total: cars.length, kinds: [...new Set(cars.map((c) => c.kind))] };
}, { steps: Number(process.env.STEPS || 1200), kind: process.env.KIND });
console.log('cars', found.total, 'kinds', found.kinds.join(','));
const dist = Number(process.env.DIST || 11), pitch = Number(process.env.PITCH || 0.28);
for (const time of times) for (const scene of scenes) {
  const car = found[scene] ?? found.moving;
  if (!car) { console.log('no car for', scene); continue; }
  const hour = time === 'night' ? 22 : 12.5;
  const r = await page.evaluate(({ car, hour, dist, pitch, weather, scene }) => {
    const g = window.__game, d = window.__dbg;
    g.env.moonPhaseOverride = 0.25;
    g.weather.force(weather, 30); g.weather.settle(); g.weather.snowCover = 0;
    d.hour(hour);
    const c = g.traffic.cars.find((x) => x.id === car.id) ?? car;
    // a junction scene looks from higher and farther
    d.view(c.x, c.z, scene === 'junction' ? dist * 2.2 : dist, (c.ryaw ?? car.ryaw) + (scene === 'queue' ? 2.6 : 0.9), scene === 'junction' ? 0.6 : pitch);
    for (let i = 0; i < 8; i++) g.frame(0.016);
    return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
  }, { car, hour, dist, pitch, weather: process.env.WEATHER || 'clear', scene });
  const file = `${scene}-${time}.jpg`;
  await page.screenshot({ path: `${out}/${file}`, type: 'jpeg', quality: 88, timeout: 420000 });
  console.log('shot', file, car.kind, `${r.calls} calls ${r.tris} tris`);
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await browser.close();
