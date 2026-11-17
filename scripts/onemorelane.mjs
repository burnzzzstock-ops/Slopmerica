// ONE MORE LANE is remembered, and the traffic comes back. On the reference town: finds the fullest stretch of the main
// stroad, widens it through the game's own path (g.upgradeRoads), and checks that the grant is stamped on the screen, that the
// widening is written down with how full the road was before, that the road's inspector shows it with the button in its
// hazard tape, and that the record survives a save. Then runs the 78 weeks the design gives a new lane and prints the weekly
// readings: how full the road is against how full it was. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/onemorelane.mjs   (WEEKS=78; SEED=n)
import { launch } from './lib/browser.mjs';
import { openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed(), WEEKS = Number(process.env.WEEKS || 78);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await launch();
const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low' });
await page.evaluate(() => { for (const e of document.querySelectorAll('.hud')) e.style.display = ''; });

// one turn of the day-and-night clock first (144 days), so every road has had its rush hours in this run; then the stroad
// piece that got fullest at its busiest and can take a lane
const pick = await page.evaluate(async () => {
  const { ROAD_TYPES } = await import('/src/roads/roadTypes.ts');
  const g = window.__game, d = window.__dbg;
  for (let i = 0; i < 8; i++) { d.run(18); await new Promise((r) => setTimeout(r, 0)); }
  const segs = [...g.net.segs.values()].filter((s) => s.type === 'stroad4' && ROAD_TYPES[s.type].next && s.length > 40).sort((a, b) => window.__widening.busiest(b.id) - window.__widening.busiest(a.id) || a.id - b.id);
  const s = segs[0];
  if (!s) return null;
  const q = g.quoteUpgrade([s], ROAD_TYPES[s.type].next);
  return { id: s.id, name: s.name, before: Math.max(window.__widening.busiest(s.id), s.vc), len: Math.round(s.length), next: ROAD_TYPES[s.type].next, share: ROAD_TYPES[ROAD_TYPES[s.type].next].fedGrant, cost: q.cost, grant: q.grant, day: g.sim.day };
});
if (!pick) { check('the town has a stroad to widen', false); await browser.close(); process.exit(1); }
console.log(`  ${pick.name} (piece ${pick.id}, ${pick.len} m) gets ${Math.round(pick.before * 100)}% full at its busiest; one more lane costs $${pick.cost}, of which the grant pays $${pick.grant}`);

const after = await page.evaluate(async (id) => {
  const g = window.__game, s = g.net.segs.get(id);
  const r = g.upgradeRoads([s]);
  g.select({ kind: 'road', s });
  for (let i = 0; i < 4; i++) g.frame(1 / 30, false);
  g.ui.refreshNow?.();
  const w = window.__widening.of(id), stamp = document.querySelector('.grant-stamp'), btn = document.querySelector('#in-lane'), box = document.querySelector('.in-widen');
  return { ok: r.ok, type: s.type, busiest: window.__widening.busiest(id), w: w ? { ...w } : null, stamp: stamp && !stamp.hidden ? stamp.textContent : null, button: btn ? { cls: btn.className, text: btn.textContent.replace(/\s+/g, ' ').trim() } : null, box: box ? box.textContent.replace(/\s+/g, ' ').trim() : null };
}, pick.id);
check(`the lane goes in (${after.type})`, after.ok && after.type === pick.next, after);
check(`the grant is stamped on the screen ("${after.stamp}")`, after.stamp === `🏛️ ${Math.round(pick.share * 100)}% FEDERAL HIGHWAY GRANT APPROVED`, after.stamp);
check(`the widening is written down with how full the road got (${after.w ? Math.round(after.w.before * 100) : '?'}% before, ${after.w?.lanes} lanes now, grant ${after.w ? Math.round(after.w.grant * 100) : '?'}%)`, !!after.w && Math.abs(after.w.before - pick.before) < 1e-9 && after.w.lanes === 6 && after.w.grant === pick.share && after.w.weeks.length === 0 && after.w.back === null, after.w);
check(`the same cars are two thirds as crowded in six lanes as in four (busiest ${Math.round(after.busiest * 100)}% from ${Math.round(pick.before * 100)}%)`, Math.abs(after.busiest - pick.before * (2 / 3)) < 1e-6, { busiest: after.busiest, before: pick.before });
check(`the road's inspector shows it ("${(after.box ?? '').slice(0, 90)}")`, /ONE MORE LANE/.test(after.box ?? '') && /full before the lane/.test(after.box ?? '') && /At its busiest/.test(after.box ?? ''), after.box);
check(`and its button wears the hazard tape, or says MAX LANES ("${after.button?.text ?? 'MAX LANES'}")`, !after.button || /one-more-lane/.test(after.button.cls), after.button);

// the weeks after
const run = await page.evaluate(async ({ id, WEEKS }) => {
  const g = window.__game, d = window.__dbg, rows = [];
  const feed0 = g.feed.posts?.length ?? 0;
  for (let k = 0; k < WEEKS; k++) {
    d.run(7);
    const s = g.net.segs.get(id), w = window.__widening.of(id);
    if (!s || !w) { rows.push(null); break; }
    rows.push({ wk: k + 1, vc: window.__widening.busiest(id), now: s.vc, n: w.weeks.length, back: w.back, cars: g.traffic.cars.length, pop: g.sim.population });
    if (k % 13 === 12) await new Promise((r) => setTimeout(r, 0));
  }
  const w = window.__widening.of(id);
  // the record through a save and back
  const sys = (await import('/src/ext/registry.ts')).EXT.systems.find((x) => x.id === 'widening');
  const saved = JSON.stringify(sys.saveExact(g));
  sys.loadExact(g, JSON.parse(saved));
  const again = JSON.stringify(sys.saveExact(g));
  const posts = (g.feed.posts ?? []).slice(0, Math.max(0, (g.feed.posts?.length ?? 0) - feed0)).map((p) => p.text ?? '').filter((t) => /Widening Complete/.test(t));
  return { rows, w: w ? { ...w } : null, roundTrip: saved === again && saved.length > 20, posts, feedKnown: Array.isArray(g.feed.posts) };
}, { id: pick.id, WEEKS });
const rows = run.rows.filter(Boolean);
for (const r of rows.filter((r) => r.wk === 1 || r.wk % 6 === 0 || r.wk === rows.length)) console.log(`  week ${String(r.wk).padStart(2)}: ${String(Math.round(r.vc * 100)).padStart(3)}% full at its busiest (it was ${Math.round(pick.before * 100)}%), ${String(Math.round(r.now * 100)).padStart(3)}% right now, ${r.cars} cars in the county, ${r.pop} people`);
const peak = rows.reduce((m, r) => Math.max(m, r.vc), 0);
console.log(`  fullest in the ${rows.length} weeks: ${Math.round(peak * 100)}%; back to what it was: ${run.w?.back !== null && run.w ? `yes, after ${Math.round((run.w.back - run.w.day) / 7)} weeks` : 'no'}`);
check(`a reading is kept for each of the ${WEEKS} weeks (${run.w?.weeks.length})`, run.w?.weeks.length === Math.min(WEEKS, 78) && rows.length === WEEKS, { weeks: run.w?.weeks.length, rows: rows.length });
check('the record is the same after a save and a load', run.roundTrip);
if (run.w?.back !== null && run.feedKnown) check(`the paper says so when the traffic is back ("${run.posts[0] ?? ''}")`, run.posts.length === 1 && /Traffic Back to Normal Within \d+ Months, Experts Stunned/.test(run.posts[0]), run.posts);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
