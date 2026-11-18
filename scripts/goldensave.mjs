// Golden saves: four committed saves, from both save versions the game has had, each load to the county that was recorded
// for it. A change that makes an old save load as a different town (a migration dropped, a default changed, a field read
// under a new name) fails here, with the name of the system that differs.
//   scripts/fixtures/saves/v1-norcal-block.json       version 1, 781 people, sandbox
//   scripts/fixtures/needs-town.json                  version 1, a town with every kind of need
//   scripts/fixtures/saves/v2-drivethru-jam.json.gz   version 2 (exact state), a jam at a drive-through
//   scripts/fixtures/refblock-town.json.gz            version 2, the reference town
// For each: it opens with no error and no notice that it could not be read; its counts (people, buildings, road pieces, zoned
// lots, cars, people on foot, the day, the money) and the fingerprint of every system are the ones in
// scripts/fixtures/saves/golden.json, read before the town has taken a step; and it then plays three days with no error and
// keeps its people. What a save does not settle (a version 1 save holds no cars: they are sent out afresh) is not in the
// record: --update loads each save twice and keeps what both loads agree on.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/goldensave.mjs
//   ... node scripts/goldensave.mjs --update     writes golden.json from this build: its own commit, saying what changed and why
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { REFBLOCK, fixture, readSave } from './lib/fixtures.mjs';
import { seededInit, seededRandom } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const UPDATE = process.argv.includes('--update');
const GOLDEN = fixture('saves/golden.json');
const SAVES = [
  ['v1-norcal-block', fixture('saves/v1-norcal-block.json')],
  ['needs-town', fixture('needs-town.json')],
  ['v2-drivethru-jam', fixture('saves/v2-drivethru-jam.json.gz')],
  ['refblock-town', REFBLOCK],
];
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); if (!ok) bad++; };

const browser = await launch();
/** Open a save and read the county before it has taken a step; then, if asked, play it for some days. */
async function load(file, days = 0) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // (the town stands still from the moment it is made: a loaded game runs live, and frames before this script takes over
  // would be a different number of steps each time)
  await page.addInitScript(() => { let game; Object.defineProperty(window, '__game', { configurable: true, get: () => game, set: (g) => { game = g; try { g.sim.speed = 0; } catch { /* */ } } }); });
  await page.addInitScript(seededInit, { seed: 1, rng: seededRandom.toString() });
  await page.addInitScript((save) => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); localStorage.setItem('slopmerica.packFrom', String(1e12)); localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, readSave(file));
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 });
  let notice = null;
  try { await page.waitForSelector('#continue', { timeout: 120000 }); } catch { notice = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200); }
  if (notice) { await page.close(); return { errs, notice }; }
  await page.click('#continue');
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 600000 });
  const out = await page.evaluate(async (days) => {
    const g = window.__game, d = window.__dbg;
    cancelAnimationFrame(g.raf);
    const fp = d.fingerprint();
    const counts = { version: null, city: g.cityName, mode: g.mode ?? g.sim.mode ?? null, day: g.sim.day, people: g.sim.population, money: g.sim.money === Infinity ? 'endless' : Math.round(g.sim.money),
      buildings: g.buildings.list.size, roads: g.net.segs.size, zoned: [...g.zones.cells.values()].filter((c) => c.zone).length, cars: g.traffic.cars.length, walkers: g.peds.peds.length };
    let played = null;
    if (days > 0) { const pop0 = g.sim.population; for (let i = 0; i < days; i++) { d.run(1); await new Promise((r) => setTimeout(r, 0)); } played = { days, from: pop0, to: g.sim.population, buildings: g.buildings.list.size, ended: g.sim.ended ?? null }; }
    return { fp, counts, played, bootFailure: !!document.querySelector('.boot-failure, .bootfail') };
  }, days);
  await page.close();
  return { ...out, errs, notice: null };
}

if (UPDATE) {
  const golden = {};
  for (const [name, file] of SAVES) {
    const a = await load(file), b = await load(file);
    if (a.notice || b.notice || a.errs.length || b.errs.length) { console.error(`${name}: did not load (${a.notice ?? a.errs[0] ?? b.notice ?? b.errs[0]})`); process.exitCode = 1; continue; }
    const fp = {}, counts = {}, unsettled = [];
    for (const k of Object.keys(a.fp)) { if (JSON.stringify(a.fp[k]) === JSON.stringify(b.fp[k])) fp[k] = a.fp[k]; else unsettled.push(k); }
    for (const k of Object.keys(a.counts)) { if (JSON.stringify(a.counts[k]) === JSON.stringify(b.counts[k])) counts[k] = a.counts[k]; else unsettled.push(k); }
    counts.version = JSON.parse(readSave(file)).v;
    golden[name] = { counts, fp, unsettled };
    console.log(`${name}: version ${counts.version}, ${counts.people} people, ${counts.buildings} buildings, ${counts.roads} road pieces; ${Object.keys(fp).length} fingerprints recorded${unsettled.length ? `; not settled by the save, so not recorded: ${unsettled.join(', ')}` : ''}`);
  }
  writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n');
  console.log(`wrote ${GOLDEN}`);
  await browser.close();
  process.exit(process.exitCode ?? 0);
}

if (!existsSync(GOLDEN)) { console.error(`goldensave: no record at ${GOLDEN} (node scripts/goldensave.mjs --update, once, in its own commit)`); process.exit(2); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
for (const [name, file] of SAVES) {
  const want = golden[name];
  if (!want) { check(`${name} has a record in golden.json`, false); continue; }
  const got = await load(file, 3);
  check(`${name} (version ${want.counts.version}) opens: no error, no notice that it could not be read`, !got.notice && !got.bootFailure && got.errs.length === 0, { notice: got.notice, errs: got.errs?.slice(0, 2) });
  if (got.notice) continue;
  const countsOff = Object.keys(want.counts).filter((k) => k !== 'version' && JSON.stringify(got.counts[k]) !== JSON.stringify(want.counts[k]));
  check(`  it is the county recorded: ${want.counts.people} people, ${want.counts.buildings} buildings, ${want.counts.roads} road pieces, ${want.counts.zoned} zoned lots, day ${Number(want.counts.day).toFixed(2)}${countsOff.length ? ` (differs: ${countsOff.map((k) => `${k} ${JSON.stringify(got.counts[k])}, recorded ${JSON.stringify(want.counts[k])}`).join('; ')})` : ''}`, countsOff.length === 0);
  const fpOff = Object.keys(want.fp).filter((k) => JSON.stringify(got.fp[k]) !== JSON.stringify(want.fp[k]));
  check(`  every system loads as recorded (${Object.keys(want.fp).length - fpOff.length} of ${Object.keys(want.fp).length} fingerprints${fpOff.length ? `; differ: ${fpOff.join(', ')}` : ''})`, fpOff.length === 0, Object.fromEntries(fpOff.slice(0, 6).map((k) => [k, [got.fp[k], want.fp[k]]])));
  const P = got.played;
  check(`  and it plays: three days on, ${P?.to} people (${P?.from} at the load), ${P?.buildings} buildings, no error`, !!P && got.errs.length === 0 && P.to >= P.from * 0.8 && P.buildings >= want.counts.buildings * 0.9, P);
}
await browser.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
