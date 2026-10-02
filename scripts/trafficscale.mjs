// Traffic at scale (traffic pass, handoff step 7: "time traffic.update at 250,
// 500 and 1,000 cars; target under 4 ms a step at 1,000"). A big town (a grid
// of neighbourhoods on the Redwood Coast, some 4,000 people, grown once in
// sandbox and saved to shots/scale/town.json; delete it to grow a fresh one,
// or TOWN=save.json to use another), its trips raised until the roads carry
// each count of cars (real trips between its buildings and the highway), then
// 300 steps timed at each: the median, mean and 95th percentile of one
// traffic.update (a 20th of a second of game time, cars drawn), and the share
// of cars moving. Then the people: with 3,000 out, peds.update timed the same
// way (reported, not checked). Seeded, so every run carries the same trips, and it prints a
// fingerprint of every car's state at the end of each count: a faster version of
// the traffic that moves the cars the same way prints the same one. Timing on
// this machine's software GPU and shared CPU: compare runs, not machines.
// usage: node scripts/trafficscale.mjs [250,500,1000]   (BASE_URL, default http://127.0.0.1:5173; SEED, default 1)
// Exits 1 if a step at the largest count takes over 4 ms (median), the roads
// can't hold the cars, or the page throws.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { ARGS, EXE, seededInit, seededRandom } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const counts = (process.argv[2] || '250,500,1000').split(',').map(Number);
const SEED = Number(process.env.SEED || 1);
const TOWN = process.env.TOWN || 'shots/scale/town.json';
const LIMIT = 4;
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const boot = async (page, url) => {
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
};

if (!existsSync(TOWN)) {
  console.log(`growing a big town (once; saved to ${TOWN})`);
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await boot(page, `${base}/#skip&map=norcal&mode=sandbox`);
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 300000 });
  const pop = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, SV = window.__services;
    cancelAnimationFrame(g.raf);
    d.unlockAll();
    const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z);
    // arterials every 400 m, side streets every 100 m, over 1.2 km
    for (let k = -6; k <= 6; k++) {
      const type = k % 4 === 0 ? 'stroad4' : 'twoLane';
      d.road(cx - 600, cz + k * 100, cx + 600, cz + k * 100, type);
      d.road(cx + k * 100, cz - 600, cx + k * 100, cz + 600, type);
    }
    const kinds = ['resLow', 'resLow', 'resHigh', 'comLow', 'resLow', 'office', 'comHigh', 'resLow', 'industry'];
    let n = 0;
    for (let i = -5; i <= 5; i += 2) for (let j = -5; j <= 5; j += 2) d.zone(cx + i * 100, cz + j * 100, 95, kinds[n++ % kinds.length]);
    const place = (id, R) => { for (const r of R) for (let a = 0; a < 48; a++) { const x = cx + Math.cos((a / 48) * 6.283) * r, z = cz + Math.sin((a / 48) * 6.283) * r; if (SV.canPlace(g, id, x, z).ok && SV.place(g, id, x, z)) return true; } return false; };
    for (const id of ['school', 'school', 'clinic', 'clinic', 'fireStation', 'fireStation', 'sheriff', 'sheriff', 'park', 'park']) place(id, [150, 300, 450]);
    for (const id of ['coalPlant', 'coalPlant', 'wellTower', 'wellTower', 'wellTower', 'wellTower', 'wellTower', 'treatmentPlant', 'treatmentPlant', 'landfill', 'landfill']) { if (place(id, [700, 800, 900])) continue; for (const r of [700, 900, 1100]) { const s = SV.findSpot?.(g, id, cx + r, cz); if (s && !s.reason && SV.place(g, id, s.x, s.z)) break; } }
    g.sim.growthMul = 3;
    for (let i = 0; i < 30; i++) d.run(20);
    return g.sim.population;
  });
  const save = await page.evaluate(() => { window.__dbg.save(); return localStorage.getItem('slopmerica.save.v1'); });
  await page.close();
  mkdirSync(TOWN.replace(/\/[^/]*$/, ''), { recursive: true });
  writeFileSync(TOWN, save);
  console.log(`  grown: ${pop.toLocaleString()} people`);
}

const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errs = [], vault = [];
page.on('pageerror', (e) => errs.push(e.message));
// (the asset pack gives up after 15 s on a busy machine, and the town is then built from other models: other lots, other trips)
page.on('console', (m) => { if (m.text().startsWith('[vault]')) vault.push(m.text()); });
const save = readFileSync(TOWN, 'utf8');
await page.addInitScript((save) => { try { localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, save);
// Math.random seeded before the game's code runs, and its own loop never started (refblock.mjs seededInit): the same
// town, trips and cars every run
await page.addInitScript(seededInit, { seed: SEED, rng: seededRandom.toString() });
await boot(page, `${base}/`);
await page.waitForSelector('#continue', { timeout: 300000 });
await page.click('#continue');
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
const town = await page.evaluate((SEED) => {
  const g = window.__game;
  cancelAnimationFrame(g.raf);
  g.traffic.crosswalkWalkers = undefined; // cars only (the people's own cost is theirs)
  // seeded: the same trips every run, so two versions of the traffic can be timed on the same cars
  window.__reseed(SEED);
  // what the town was built from (refblock.mjs openBlock): two runs replay each other only on the same one
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  for (const b of g.buildings.list.values()) {
    mix(b.id); mix(b.model.geometry?.attributes?.position?.count ?? 0); mix(b.model.spots?.length ?? 0);
    for (let i = 0; i < b.label.length; i++) mix(b.label.charCodeAt(i));
  }
  return { pop: g.sim.population, blds: g.buildings.list.size, roads: g.net.segs.size, hash: h.toString(16) };
}, SEED);
console.log(`  town: ${town.pop.toLocaleString()} people, ${town.blds} buildings, ${town.roads} roads (town ${town.hash}${vault.length ? `; ${vault.join('; ')}: not the usual town` : ''}; seed ${SEED})`);
const rows = [];
for (const want of counts) {
  const r = await page.evaluate((want) => {
    const g = window.__game, tr = g.traffic;
    const step = () => tr.update(1 / 20, 1, 8, g.sim.population, g.sim.jobsFilled, g.rts.target);
    // raise the trips until the roads carry `want` cars (the morning peak, real trips)
    // (the target falls as the roads fill and flow drops: keep raising it until the cars are there)
    for (let i = 0; i < 4000 && tr.cars.length < want * 0.97; i++) {
      if (i % 20 === 0) tr.policyTripMul *= Math.min(1.5, want / Math.max(1, tr.targetCars));
      step();
    }
    for (let k = 0; k < 200; k++) step();
    const ms = [];
    let n = 0;
    for (let k = 0; k < 300; k++) {
      const t0 = performance.now();
      step();
      ms.push(performance.now() - t0);
      n += tr.cars.length;
    }
    ms.sort((a, b) => a - b);
    // every car's state at the end, hashed: two versions of the traffic that time the same steps move the same cars
    let h = 2166136261;
    for (const c of tr.cars) for (const v of [c.id, Math.round(c.s * 1000), Math.round(c.v * 1000), c.lane, c.pi, c.junction ? Math.round(c.junction.t * 1000) : -1]) h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
    return { fp: h.toString(16), cars: Math.round(n / 300), median: +ms[150].toFixed(2), mean: +(ms.reduce((a, b) => a + b, 0) / 300).toFixed(2), p95: +ms[285].toFixed(2), moving: tr.cars.filter((c) => c.v > 0.5).length / Math.max(1, tr.cars.length) };
  }, want);
  rows.push({ want, ...r });
  console.log(`  ${String(want).padStart(5)} cars wanted: ${r.cars} on the roads, ${Math.round(r.moving * 100)}% moving; a step ${r.median} ms (mean ${r.mean}, 95th percentile ${r.p95}); the cars' state at the end ${r.fp}`);
}
// people: the town's walkers stepped with the cars at a town of 3,000 people out (as crosswalktest), peds.update timed alone
const ppl = await page.evaluate(() => {
  const g = window.__game, tr = g.traffic, P = g.peds;
  tr.crosswalkWalkers = (n, s) => P.crosswalkWalkers(n, s);
  let time = 0;
  const step = (timed) => {
    time += 1 / 20;
    tr.update(1 / 20, 1, 12.5, g.sim.population, g.sim.jobsFilled, g.rts.target);
    P.population = 3000;
    const t0 = performance.now();
    P.update(1 / 20, 1, g.rts.target, g.rts.distance, time);
    return performance.now() - t0;
  };
  for (let k = 0; k < 600; k++) step();
  const ms = [];
  let n = 0;
  for (let k = 0; k < 300; k++) { ms.push(step()); n += P.peds.length; }
  ms.sort((a, b) => a - b);
  return { walkers: Math.round(n / 300), median: +ms[150].toFixed(2), mean: +(ms.reduce((a, b) => a + b, 0) / 300).toFixed(2), p95: +ms[285].toFixed(2) };
});
console.log(`  people, with 3,000 out: ${ppl.walkers} on the streets; peds.update ${ppl.median} ms (mean ${ppl.mean}, 95th percentile ${ppl.p95})`);
const top = rows[rows.length - 1];
check(`the roads hold the cars (${top.cars} of ${top.want})`, top.cars >= top.want * 0.9);
check(`a step at ${top.cars} cars takes under ${LIMIT} ms (median ${top.median} ms)`, top.median < LIMIT);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
