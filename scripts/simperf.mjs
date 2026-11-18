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
//   PROFILE=1         Chrome's sampling profiler over the run: the functions the time is spent in themselves, as a share of the
//                     samples, and the whole profile in shots/simperf.cpuprofile (open it in Chrome's Performance panel)
//   RUNS=5            for a machine that is busy with something else: the same town opened five times and the same steps run each
//                     time (the simulation is the same every time), and each step is taken from the run it was fastest in. A pause
//                     the machine or the garbage collector puts into a step lands on a different step each run, so what is left is
//                     what the step itself costs. Not with THROTTLE: Chrome's throttle works by pausing the thread, so a step's
//                     fastest run is one the throttle missed, and the result is the unthrottled time.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { REFBLOCK, readSave } from './lib/fixtures.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const TOWN = process.env.TOWN === 'ref' ? REFBLOCK : process.env.TOWN || 'shots/towns/florida-10k.json';
const STEPS = Number(process.env.STEPS || 640), CHOICES = process.env.CHOICES ? Number(process.env.CHOICES) : null;
const THROTTLE = Number(process.env.THROTTLE || 1), PROFILE = process.env.PROFILE === '1', RUNS = Math.max(1, Number(process.env.RUNS || 1));
if (RUNS > 1 && THROTTLE > 1) { console.error('simperf: RUNS and THROTTLE do not go together (the fastest run of a step is one the throttle did not pause): take RUNS unthrottled and multiply'); process.exit(2); }
if (!existsSync(TOWN)) { console.error(`simperf: no town at ${TOWN} (TOWN=path to a save; the 10,000-person one is grown by the scripted player and is not in the repo)`); process.exit(2); }
const browser = await launch();
const errs = [];
const save = readSave(TOWN);
const runs = [];
let hot = null;
for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.on('pageerror', (e) => errs.push(e.message));
  // (the town stands still from the moment it is made until the measured steps: a loaded game runs live, and the frames between
  // the load and this script taking over would be a different number of steps each time)
  await page.addInitScript(() => { let game; Object.defineProperty(window, '__game', { configurable: true, get: () => game, set: (g) => { game = g; try { g.sim.speed = 0; } catch { /* */ } } }); });
  await page.addInitScript((save) => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.packFrom', String(1e12)); localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, save);
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForSelector('#continue', { timeout: 300000 });
  await page.click('#continue');
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 600000 });
  const profiled = PROFILE && run === 0;
  const cdp = THROTTLE > 1 || profiled ? await page.context().newCDPSession(page) : null;
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  if (profiled) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
  runs.push(await page.evaluate(async ({ STEPS, CHOICES }) => {
    const g = window.__game;
    cancelAnimationFrame(g.raf);
    if (CHOICES !== null) { const { TUNING } = await import('/src/sim/tuning.ts'); TUNING.whereTo.choices = CHOICES; }
    const { EXT } = await import('/src/ext/registry.ts');
    g.sim.speed = 3;
    let now = {};
    const wrap = (obj, fn, key) => { const f = obj[fn].bind(obj); obj[fn] = (...a) => { const t0 = performance.now(); const out = f(...a); now[key] = (now[key] ?? 0) + performance.now() - t0; return out; }; };
    wrap(g.sim, 'step', 'sim (demand, growth, money, daily and weekly ticks)');
    wrap(g.climate, 'step', 'weather');
    wrap(g.communes, 'step', 'communes');
    wrap(g.zones, 'sync', 'zoning sync');
    wrap(g.traffic, 'step', 'traffic');
    wrap(g.peds, 'step', 'people on foot');
    for (const s of EXT.systems) if (s.step) wrap(s, 'step', `ext: ${s.id}`);
    // a warm-up, then the measured steps one at a time (so the slow ones can be named)
    g.runSteps(32);
    const each = [];    // per step: the whole step, ms
    const parts = [];   // per step: each part's ms
    const ends = [];    // per step: '' in the middle of a day, 'day' or 'week' when it ended one (a saved town starts mid-day)
    const day0 = g.sim.day;
    for (let i = 0; i < STEPS; i++) {
      now = {};
      const d0 = Math.floor(g.sim.day + 1e-9);
      const a = performance.now(); g.step(); each.push(performance.now() - a);
      const d1 = Math.floor(g.sim.day + 1e-9);
      ends.push(d1 === d0 ? '' : Math.floor(d1 / 7) !== Math.floor(d0 / 7) ? 'week' : 'day');
      parts.push(now);
      if (i % 64 === 63) await new Promise((res) => setTimeout(res, 0));
    }
    return { each, parts, ends, days: g.sim.day - day0, day: g.sim.day, people: g.sim.population, buildings: g.buildings.list.size, roads: g.net.segs.size, cars: g.traffic.cars.length, walkers: g.peds.peds.length,
      money: g.sim.money === Infinity ? null : Math.round(g.sim.money), errands: g.traffic.errands ? { ...g.traffic.errands } : null };
  }, { STEPS, CHOICES }));
  // the profile: where the samples fell, by the function the thread was in itself (not in what it called), most first. Counted
  // in samples, not in the time between them: on a busy machine one long gap between two samples would be charged to whichever
  // function the second one happened to land in.
  if (profiled) {
    const { profile } = await cdp.send('Profiler.stop');
    mkdirSync('shots', { recursive: true });
    writeFileSync('shots/simperf.cpuprofile', JSON.stringify(profile));
    const by = new Map();
    let all = 0;
    for (const n of profile.nodes) {
      const hits = n.hitCount ?? 0, f = n.callFrame;
      if (!hits || f.functionName === '(idle)' || f.functionName === '(program)') continue;
      const file = f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '');
      const key = `${f.functionName || '(anonymous)'}  ${file}:${f.lineNumber + 1}`;
      by.set(key, (by.get(key) ?? 0) + hits);
      all += hits;
    }
    hot = { all, top: [...by].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP || 28)) };
  }
  await page.close();
}
await browser.close();

// each step from the run it was fastest in (one run: as it came)
const r0 = runs[0];
const same = runs.every((r) => r.day === r0.day && r.people === r0.people && r.cars === r0.cars && r.money === r0.money && r.ends.join() === r0.ends.join());
const best = r0.each.map((_, i) => runs.reduce((b, r) => (r.each[i] < b.each[i] ? r : b)));
const each = best.map((r, i) => r.each[i]), parts = best.map((r, i) => r.parts[i]), ends = r0.ends;
const stat = (v) => { const a = [...v].sort((x, y) => x - y), q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0; return { n: a.length, mean: a.length ? a.reduce((n, x) => n + x, 0) / a.length : 0, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: a.at(-1) ?? 0 }; };
const A = stat(each), E = stat(each.filter((_, i) => ends[i])), M = stat(each.filter((_, i) => !ends[i]));
const sums = {};
for (const p of parts) for (const [k, ms] of Object.entries(p)) sums[k] = (sums[k] ?? 0) + ms;
const partMeans = Object.entries(sums).map(([k, ms]) => [k, ms / STEPS]).sort((a, b) => b[1] - a[1]);
const most = (i) => { const top = Object.entries(parts[i]).sort((x, y) => y[1] - x[1])[0]; return top ? `${top[0].split(' (')[0]} ${top[1].toFixed(1)} ms` : ''; };
const slow = each.map((ms, i) => [i, ms]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([i, ms]) => `step ${i} (${ends[i] === 'week' ? 'ends a week' : ends[i] === 'day' ? 'ends a day' : 'mid-day'}): ${ms.toFixed(1)} ms, of which ${most(i)}`);

console.log(`${TOWN}: ${r0.people.toLocaleString()} people, ${r0.buildings} buildings, ${r0.roads} road pieces, ${r0.cars} cars, ${r0.walkers} people on foot${CHOICES !== null ? `; trips weigh ${CHOICES} place${CHOICES === 1 ? '' : 's'}` : ''}`);
if (RUNS > 1) {
  const one = stat(r0.each);
  console.log(`${RUNS} runs of the same steps, each step taken from the run it was fastest in${same ? '' : `  (THE RUNS DID NOT END IN THE SAME TOWN: the steps are not the same steps, and these figures mean little. Days ${runs.map((r) => r.day.toFixed(3)).join(', ')}; cars ${runs.map((r) => r.cars).join(', ')}; money ${runs.map((r) => r.money).join(', ')})`}`);
  console.log(`  (the first run as it came: ${one.mean.toFixed(2)} ms a step on average, 99th percentile ${one.p99.toFixed(1)}, slowest ${one.max.toFixed(1)}; the difference is the machine)`);
}
console.log(`${STEPS} steps (${r0.days.toFixed(1)} game days): ${A.mean.toFixed(2)} ms a step on average, median ${A.p50.toFixed(2)}, 95th percentile ${A.p95.toFixed(1)}, 99th ${A.p99.toFixed(1)}, slowest ${A.max.toFixed(1)}`);
console.log(`  top speed needs 128 steps a second: ${(A.mean * 128).toFixed(0)} ms of every second (${((A.mean * 128) / 10).toFixed(0)}% of one core)`);
for (const [k, ms] of partMeans) console.log(`  ${ms.toFixed(3).padStart(8)} ms  ${((ms / A.mean) * 100).toFixed(0).padStart(3)}%  ${k}`);
const rest = A.mean - partMeans.reduce((n, [, ms]) => n + ms, 0);
console.log(`  ${rest.toFixed(3).padStart(8)} ms  ${((rest / A.mean) * 100).toFixed(0).padStart(3)}%  the rest of the step (hooks, applying weather)`);
console.log(`  the ${E.n} steps that end a day: ${E.mean.toFixed(1)} ms on average, ${E.max.toFixed(1)} at most; the others: ${M.mean.toFixed(2)} ms on average, 99th percentile ${M.p99.toFixed(1)}, ${M.max.toFixed(1)} at most`);
const T = stat(parts.map((p) => p.traffic ?? 0));
console.log(`  traffic alone: median ${T.p50.toFixed(2)} ms, 95th percentile ${T.p95.toFixed(2)}, 99th ${T.p99.toFixed(2)}, slowest ${T.max.toFixed(2)}`);
console.log(`  slowest steps: ${slow.join('; ')}`);
if (THROTTLE > 1) console.log(`  (the CPU slowed ${THROTTLE} times)`);
if (hot) {
  console.log(`  where the time goes inside${RUNS > 1 ? ' (the first run)' : ''}: each function's own share of ${hot.all} samples, and about that share of a ${stat(r0.each).mean.toFixed(2)} ms step (line numbers are the served file's)`);
  for (const [k, hits] of hot.top) console.log(`  ${((hits / hot.all) * stat(r0.each).mean).toFixed(3).padStart(8)} ms  ${((hits / hot.all) * 100).toFixed(1).padStart(5)}%  ${k}`);
  console.log('  the whole profile: shots/simperf.cpuprofile');
}
if (r0.errands) console.log(`  trips that weighed more than one place: ${r0.errands.weighed} (${r0.errands.swayed} swayed)`);
if (errs.length) console.log(`  page errors: ${errs.slice(0, 3).join(' | ')}`);
