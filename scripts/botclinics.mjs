// The late-game bot builds where an overloaded service needs it (scripts/lib/latePlayer.mjs overloadFix; docs/AUDIT_ROUND8_SIM.md
// #9). It used to build every relief clinic, school, station at the town's middle: each building is served by its nearest
// station, so a clinic far from the overloaded one took none of its load, and Florida ended with 83 clinics while the same one
// stayed overloaded. Grows a county from nothing with the bot, seeded, to POP people (or DAYS days), then counts the stations
// of each kind, how many are overloaded, and how many the bot built to relieve an overload.
// usage: node scripts/botclinics.mjs   (BASE_URL, default http://127.0.0.1:5173; MAP, default florida; POP, default 2800;
// DAYS, default 900; SEED, default 1). Exits 1 if the bot built more clinics than one per 1,200 people and two more, if its
// clinics were overloaded more than half the clinic-days from the first overload to the end (10 days on, when what the bot
// started has opened), or the page throws. (The bot builds a hospital beside an overloaded clinic once it can afford one,
// and before that a clinic on the lot that takes most of its load and of the nearly full ones'.)
import { chromium } from 'playwright-core';
import { ARGS, EXE, seededInit, seededRandom } from './refblock.mjs';
import { installLatePlayer } from './lib/latePlayer.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const MAP = process.env.MAP || 'florida', POP = Number(process.env.POP || 2800), DAYS = Number(process.env.DAYS || 900), SEED = Number(process.env.SEED || 1);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.addInitScript(seededInit, { seed: SEED, rng: seededRandom.toString() });
await page.goto(`${base}/#skip&map=${MAP}&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 300000 });
await page.evaluate(installLatePlayer, {});
let r = { pop: 0, day: 0 };
// (each 10 days: how many clinics are overloaded, and how far, from the first overload on)
let firstOver = null, overDays = 0, worst = 0;
while (r.pop < POP && r.day < DAYS) {
  r = await page.evaluate(() => {
    const st = window.__player.step(10), o = window.__services.overloadedServices(window.__game).filter((x) => x.cat === 'health');
    return { pop: st.pop, day: st.day, sick: o.length, worst: Math.max(0, ...o.map((x) => x.load / x.capacity)) };
  });
  if (r.sick) { firstOver ??= r.day; overDays += r.sick * 10; worst = Math.max(worst, r.worst); }
}
// (what the bot started opens before the count: a clinic takes 6 days to build, and the bot can't act meanwhile)
await page.evaluate(() => window.__dbg.run(10));
const out = await page.evaluate(() => {
  const g = window.__game, SV = window.__services, P = window.__player;
  const over = SV.overloadedServices(g).map((o) => ({ cat: o.cat, name: o.name, load: o.load, capacity: o.capacity }));
  return { pop: g.sim.population, day: Math.round(g.sim.day), built: P.built, over, relief: P.notes.filter((x) => / overloaded \d+\/\d+/.test(x)).length };
});
const clinics = (out.built.clinic ?? 0) + (out.built.hospital ?? 0), sick = out.over.filter((o) => o.cat === 'health');
console.log(`${MAP}, seed ${SEED}: ${out.pop.toLocaleString()} people on day ${out.day}; the bot built ${JSON.stringify(out.built)}; ${out.relief} of its last notes were relief for an overload`);
console.log(`  overloaded at the end: ${out.over.map((o) => `${o.name} ${o.load}/${o.capacity}`).join(', ') || 'none'}`);
const span = firstOver === null ? 0 : r.day - firstOver + 10;
console.log(`  clinics overloaded: ${overDays} clinic-days of the ${span} days from the first overload (${span ? Math.round((100 * overDays) / span) : 0}%), the worst at ${Math.round(worst * 100)}% of capacity`);
// (a clinic serves about 1,200: a town of POP people needs POP / 1,200 of them, and a couple more for the corners)
const need = Math.ceil(out.pop / 1200) + 2;
check(`the bot builds no more clinics than the town needs (${clinics} built for ${out.pop.toLocaleString()} people, ${need} at most)`, clinics <= need);
// (it relieves an overloaded one where that takes its load: the clinics overloaded half the time at most, from the first
// overload to the end; the town grows faster than a reactive bot can build, so one may be over at the end)
check(`and where they relieve the overloaded one (${overDays} clinic-days overloaded of the ${span}, half at most; ${sick.length} still overloaded at the end)`, span > 0 ? overDays <= span / 2 : true);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
