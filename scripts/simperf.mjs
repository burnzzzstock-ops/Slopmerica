// Where a simulation step's time goes, on a saved town. Opens the save, steps the simulation with nothing drawn, and times
// each part of Game.step() by wrapping it: the sim, the weather, communes, the zoning sync, traffic, people and every
// extension system. Prints milliseconds a step per part, the slowest single steps (a daily or weekly tick shows up there),
// and how many game days a second one core can run. A measurement, not a pass/fail test: its numbers go in
// docs/aaa/PERF_SIM.md with the town and the machine they were taken on.
//
//   BASE_URL=http://127.0.0.1:5173 TOWN=shots/towns/florida-10k.json node scripts/simperf.mjs
//   STEPS=640 (20 game days)   CHOICES=1 runs with every trip taking the first place that comes to mind, to compare
import { existsSync, readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const TOWN = process.env.TOWN || 'shots/towns/florida-10k.json';
const STEPS = Number(process.env.STEPS || 640), CHOICES = process.env.CHOICES ? Number(process.env.CHOICES) : null;
if (!existsSync(TOWN)) { console.error(`simperf: no town at ${TOWN} (TOWN=path to a save; the 10,000-person one is grown by the scripted player and is not in the repo)`); process.exit(2); }
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((save) => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.packFrom', String(1e12)); localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, readFileSync(TOWN, 'utf8'));
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 });
await page.waitForSelector('#continue', { timeout: 300000 });
await page.click('#continue');
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 600000 });
const r = await page.evaluate(async ({ STEPS, CHOICES }) => {
  const g = window.__game;
  cancelAnimationFrame(g.raf);
  if (CHOICES !== null) { const { TUNING } = await import('/src/sim/tuning.ts'); TUNING.whereTo.choices = CHOICES; }
  const { EXT } = await import('/src/ext/registry.ts');
  g.sim.speed = 3;
  const t = {}, now = {}, add = (k, ms) => { t[k] = (t[k] ?? 0) + ms; now[k] = (now[k] ?? 0) + ms; };
  const wrap = (obj, fn, key) => { const f = obj[fn].bind(obj); obj[fn] = (...a) => { const t0 = performance.now(); const out = f(...a); add(key, performance.now() - t0); return out; }; };
  wrap(g.sim, 'step', 'sim (demand, growth, money, daily and weekly ticks)');
  wrap(g.climate, 'step', 'weather');
  wrap(g.communes, 'step', 'communes');
  wrap(g.zones, 'sync', 'zoning sync');
  wrap(g.traffic, 'step', 'traffic');
  wrap(g.peds, 'step', 'people on foot');
  for (const s of EXT.systems) if (s.step) wrap(s, 'step', `ext: ${s.id}`);
  // a warm-up, then the measured steps one at a time (so the slow ones can be named)
  g.runSteps(32);
  for (const k of Object.keys(t)) delete t[k];
  const each = [];
  const day0 = g.sim.day, t0 = performance.now();
  const most = [];   // per step: the part that took longest in it
  for (let i = 0; i < STEPS; i++) {
    for (const k of Object.keys(now)) delete now[k];
    const a = performance.now(); g.step(); each.push(performance.now() - a);
    const top = Object.entries(now).sort((x, y) => y[1] - x[1])[0];
    most.push(top ? `${top[0].split(' (')[0]} ${top[1].toFixed(1)} ms` : '');
    if (i % 64 === 63) await new Promise((res) => setTimeout(res, 0));
  }
  const wall = performance.now() - t0;
  const sorted = [...each].sort((a, b) => a - b), total = each.reduce((n, v) => n + v, 0);
  return { parts: Object.entries(t).map(([k, ms]) => [k, ms / STEPS]).sort((a, b) => b[1] - a[1]), mean: total / STEPS, p50: sorted[Math.floor(STEPS * 0.5)], p99: sorted[Math.floor(STEPS * 0.99)], max: sorted[STEPS - 1],
    slow: each.map((ms, i) => [i, ms]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([i, ms]) => `step ${i} (${i % 32 === 31 ? 'ends a day' : 'mid-day'}${Math.floor((i + 1) / 32) % 7 === 0 && i % 32 === 31 ? ', a week' : ''}): ${ms.toFixed(1)} ms, of which ${most[i]}`),
    days: g.sim.day - day0, wall, people: g.sim.population, buildings: g.buildings.list.size, roads: g.net.segs.size, cars: g.traffic.cars.length, walkers: g.peds.peds.length, errands: g.traffic.errands ? { ...g.traffic.errands } : null };
}, { STEPS, CHOICES });
console.log(`${TOWN}: ${r.people.toLocaleString()} people, ${r.buildings} buildings, ${r.roads} road pieces, ${r.cars} cars, ${r.walkers} people on foot${CHOICES !== null ? `; trips weigh ${CHOICES} place${CHOICES === 1 ? '' : 's'}` : ''}`);
console.log(`${STEPS} steps (${r.days.toFixed(1)} game days): ${r.mean.toFixed(2)} ms a step on average, median ${r.p50.toFixed(2)}, 99th percentile ${r.p99.toFixed(1)}, slowest ${r.max.toFixed(1)}`);
console.log(`  top speed needs 128 steps a second: ${(r.mean * 128).toFixed(0)} ms of every second (${((r.mean * 128) / 10).toFixed(0)}% of one core)`);
for (const [k, ms] of r.parts) console.log(`  ${ms.toFixed(3).padStart(8)} ms  ${((ms / r.mean) * 100).toFixed(0).padStart(3)}%  ${k}`);
const rest = r.mean - r.parts.reduce((n, [, ms]) => n + ms, 0);
console.log(`  ${rest.toFixed(3).padStart(8)} ms  ${((rest / r.mean) * 100).toFixed(0).padStart(3)}%  the rest of the step (hooks, applying weather)`);
console.log(`  slowest steps: ${r.slow.join('; ')}`);
if (r.errands) console.log(`  trips that weighed more than one place: ${r.errands.weighed} (${r.errands.swayed} swayed)`);
if (errs.length) console.log(`  page errors: ${errs.slice(0, 3).join(' | ')}`);
await browser.close();
