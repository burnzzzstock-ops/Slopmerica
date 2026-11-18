// Where a simulation step's time goes, on a saved town. Opens the save, steps the simulation with nothing drawn, and times
// each part of Game.step() by wrapping it: the sim, the weather, communes, the zoning sync, traffic, people and every
// extension system. Prints milliseconds a step per part, the slowest single steps (a daily or weekly tick shows up there),
// and how many game days a second one core can run. A measurement, not a pass/fail test: its numbers go in
// docs/aaa/PERF_SIM.md with the town and the machine they were taken on.
//
//   BASE_URL=http://127.0.0.1:5173 TOWN=shots/towns/florida-10k.json node scripts/simperf.mjs
//   TOWN=ref          the reference town (scripts/fixtures), 969 people: the one the look lane's frame timings are taken on
//   STEPS=640 (20 game days)   CHOICES=1 runs with every trip taking the first place that comes to mind, to compare
//   THROTTLE=4        the browser's CPU slowed four times (Chrome's own throttle): a phone, near enough
//   PROFILE=1         Chrome's sampling profiler over the run: the functions the time is spent in themselves, in ms a step,
//                     and the whole profile in shots/simperf.cpuprofile (open it in Chrome's Performance panel)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { REFBLOCK, readSave } from './lib/fixtures.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const TOWN = process.env.TOWN === 'ref' ? REFBLOCK : process.env.TOWN || 'shots/towns/florida-10k.json';
const STEPS = Number(process.env.STEPS || 640), CHOICES = process.env.CHOICES ? Number(process.env.CHOICES) : null;
const THROTTLE = Number(process.env.THROTTLE || 1), PROFILE = process.env.PROFILE === '1';
if (!existsSync(TOWN)) { console.error(`simperf: no town at ${TOWN} (TOWN=path to a save; the 10,000-person one is grown by the scripted player and is not in the repo)`); process.exit(2); }
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((save) => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.packFrom', String(1e12)); localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, readSave(TOWN));
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 });
await page.waitForSelector('#continue', { timeout: 300000 });
await page.click('#continue');
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 600000 });
const cdp = THROTTLE > 1 || PROFILE ? await page.context().newCDPSession(page) : null;
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
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
  const ends = [];   // per step: '' in the middle of a day, 'day' or 'week' when it ended one (a saved town starts mid-day)
  for (let i = 0; i < STEPS; i++) {
    for (const k of Object.keys(now)) delete now[k];
    const d0 = Math.floor(g.sim.day + 1e-9);
    const a = performance.now(); g.step(); each.push(performance.now() - a);
    const d1 = Math.floor(g.sim.day + 1e-9);
    ends.push(d1 === d0 ? '' : Math.floor(d1 / 7) !== Math.floor(d0 / 7) ? 'week' : 'day');
    const top = Object.entries(now).sort((x, y) => y[1] - x[1])[0];
    most.push(top ? `${top[0].split(' (')[0]} ${top[1].toFixed(1)} ms` : '');
    if (i % 64 === 63) await new Promise((res) => setTimeout(res, 0));
  }
  const wall = performance.now() - t0;
  const sorted = [...each].sort((a, b) => a - b), total = each.reduce((n, v) => n + v, 0);
  return { parts: Object.entries(t).map(([k, ms]) => [k, ms / STEPS]).sort((a, b) => b[1] - a[1]), mean: total / STEPS, p50: sorted[Math.floor(STEPS * 0.5)], p99: sorted[Math.floor(STEPS * 0.99)], max: sorted[STEPS - 1],
    slow: each.map((ms, i) => [i, ms]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([i, ms]) => `step ${i} (${ends[i] === 'week' ? 'ends a week' : ends[i] === 'day' ? 'ends a day' : 'mid-day'}): ${ms.toFixed(1)} ms, of which ${most[i]}`),
    dayEnds: (() => { const xs = each.filter((_, i) => ends[i]).sort((a, b) => a - b), ys = each.filter((_, i) => !ends[i]).sort((a, b) => a - b); const mean = (v) => (v.length ? v.reduce((n, x) => n + x, 0) / v.length : 0); return { n: xs.length, mean: mean(xs), max: xs[xs.length - 1] ?? 0, midMean: mean(ys), midP99: ys[Math.floor(ys.length * 0.99)] ?? 0, midMax: ys[ys.length - 1] ?? 0 }; })(),
    days: g.sim.day - day0, wall, people: g.sim.population, buildings: g.buildings.list.size, roads: g.net.segs.size, cars: g.traffic.cars.length, walkers: g.peds.peds.length, errands: g.traffic.errands ? { ...g.traffic.errands } : null };
}, { STEPS, CHOICES });
// the profile: time each function spent in itself (not in what it called), most first
let hot = null;
if (PROFILE) {
  const { profile } = await cdp.send('Profiler.stop');
  mkdirSync('shots', { recursive: true });
  writeFileSync('shots/simperf.cpuprofile', JSON.stringify(profile));
  const self = new Map(profile.nodes.map((n) => [n.id, 0]));
  profile.samples.forEach((id, i) => self.set(id, self.get(id) + (profile.timeDeltas[i] ?? 0) / 1000));
  const by = new Map();
  let all = 0;
  for (const n of profile.nodes) {
    const ms = self.get(n.id), f = n.callFrame;
    if (!ms || f.functionName === '(idle)' || f.functionName === '(program)') continue;
    const file = f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '');
    const key = `${f.functionName || '(anonymous)'}  ${file}:${f.lineNumber + 1}`;
    by.set(key, (by.get(key) ?? 0) + ms);
    all += ms;
  }
  hot = { all, top: [...by].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP || 28)) };
}
console.log(`${TOWN}: ${r.people.toLocaleString()} people, ${r.buildings} buildings, ${r.roads} road pieces, ${r.cars} cars, ${r.walkers} people on foot${CHOICES !== null ? `; trips weigh ${CHOICES} place${CHOICES === 1 ? '' : 's'}` : ''}`);
console.log(`${STEPS} steps (${r.days.toFixed(1)} game days): ${r.mean.toFixed(2)} ms a step on average, median ${r.p50.toFixed(2)}, 99th percentile ${r.p99.toFixed(1)}, slowest ${r.max.toFixed(1)}`);
console.log(`  top speed needs 128 steps a second: ${(r.mean * 128).toFixed(0)} ms of every second (${((r.mean * 128) / 10).toFixed(0)}% of one core)`);
for (const [k, ms] of r.parts) console.log(`  ${ms.toFixed(3).padStart(8)} ms  ${((ms / r.mean) * 100).toFixed(0).padStart(3)}%  ${k}`);
const rest = r.mean - r.parts.reduce((n, [, ms]) => n + ms, 0);
console.log(`  ${rest.toFixed(3).padStart(8)} ms  ${((rest / r.mean) * 100).toFixed(0).padStart(3)}%  the rest of the step (hooks, applying weather)`);
console.log(`  the ${r.dayEnds.n} steps that end a day: ${r.dayEnds.mean.toFixed(1)} ms on average, ${r.dayEnds.max.toFixed(1)} at most; the others: ${r.dayEnds.midMean.toFixed(2)} ms on average, 99th percentile ${r.dayEnds.midP99.toFixed(1)}, ${r.dayEnds.midMax.toFixed(1)} at most`);
console.log(`  slowest steps: ${r.slow.join('; ')}`);
if (THROTTLE > 1) console.log(`  (the CPU slowed ${THROTTLE} times)`);
if (hot) {
  console.log(`  where the time goes inside (each function's own time, ms a step, of ${(hot.all / (STEPS + 32)).toFixed(2)} ms a step sampled; line numbers are the served file's):`);
  for (const [k, ms] of hot.top) console.log(`  ${(ms / (STEPS + 32)).toFixed(3).padStart(8)} ms  ${((ms / hot.all) * 100).toFixed(1).padStart(5)}%  ${k}`);
  console.log('  the whole profile: shots/simperf.cpuprofile');
}
if (r.errands) console.log(`  trips that weighed more than one place: ${r.errands.weighed} (${r.errands.swayed} swayed)`);
if (errs.length) console.log(`  page errors: ${errs.slice(0, 3).join(' | ')}`);
await browser.close();
