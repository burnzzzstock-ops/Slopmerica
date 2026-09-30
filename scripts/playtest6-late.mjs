// Late-game pacing: a scripted commissioner (scripts/lib/latePlayer.mjs) grows
// a Ponzi county from nothing toward Capital of Slop (10,000 people) the way a
// person would: streets, zones by the demand bars, services when the game says
// something is failing. It prints when each milestone was reached (game days,
// treasury, buildings), what the guide said was in the way, and every error the
// page threw. Not a pass/fail gate by default; CHECK=1 exits nonzero when a
// milestone is never reached, the page throws, or a number goes NaN.
//
//   BASE_URL=http://127.0.0.1:5175 MAP=appalachia DAYS=3000 node scripts/playtest6-late.mjs
//   OPTS='{"upgrades":true,"loans":true}'  bot options; OUT=file.json dumps the trace; SAVE=file.json the grown town
//   (at the end, or with SAVEAT=6000 the first time it has that many people)
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { installLatePlayer } from './lib/latePlayer.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const MAXDAYS = Number(process.env.DAYS || 3000), STEP = Number(process.env.STEP || 10), TARGET = Number(process.env.TARGET || 10000);
const OPTS = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=${process.env.MAP || 'appalachia'}&mode=${process.env.MODE || 'ponzi'}`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 300000 });
await page.evaluate(installLatePlayer, OPTS);

const PROBES = (process.env.PROBE || '').split(',').filter(Boolean).map(Number), probed = [];
const probe = () => page.evaluate(() => { const s = window.__game.sim, f = s.forecastWeek(); return { day: Math.round(s.day), pop: s.population, income: f.income, expense: f.expense, net: f.net, lines: f.lines.map((l) => `${l.label} ${l.amount}`), growth: Math.round(s.growthWeek()), demand: Object.fromEntries(Object.entries(s.demandParts).map(([k, a]) => [k, a.map((p) => p.text)])) }; });
const trace = [];
let savedAt = 0;
async function saveTown() {
  const json = await page.evaluate(() => { window.__dbg.save(); return localStorage.getItem('slopmerica.save.v1'); });
  if (json) { writeFileSync(process.env.SAVE, json); console.log(`saved the town to ${process.env.SAVE} (${json.length.toLocaleString()} characters)`); }
}
let bad = 0, best = 0, sinceBest = 0;
for (let day = 0; day < MAXDAYS; day += STEP) {
  const r = await page.evaluate((n) => window.__player.step(n), STEP);
  trace.push(r);
  if (!Number.isFinite(r.pop) || (r.money !== null && !Number.isFinite(r.money) && process.env.MODE !== 'sandbox')) { console.log('NaN in', JSON.stringify(r)); bad++; break; }
  if (r.pop > best) { best = r.pop; sinceBest = 0; } else sinceBest += STEP;
  if (trace.length % Math.max(1, Math.round(100 / STEP)) === 0) console.log(`d${r.day} pop ${r.pop} $${r.money} net ${r.net} dem ${r.dem} bld ${r.bld} em ${r.em} ring ${r.ring} | ${r.next ?? ''}`);
  for (const p of PROBES) if (!probed.includes(p) && r.pop >= p) { probed.push(p); const q = await probe(); console.log(`\nPROBE pop>=${p}:`, JSON.stringify(q)); }
  if (process.env.SAVE && process.env.SAVEAT && !savedAt && r.pop >= Number(process.env.SAVEAT)) { savedAt = r.day; await saveTown(); }
  if (best >= TARGET && sinceBest >= 60) break;
  if (errs.length > 20) break;
}
const P = await page.evaluate(() => ({ marks: window.__player.marks, built: window.__player.built, blockers: window.__player.blockers, upgrades: window.__player.upgrades || 0, bankruptcies: window.__player.bankruptcies || 0, taxMoves: window.__player.taxMoves || 0, spent: Math.round(window.__player.spent), notes: window.__player.notes.slice(-30) }));
const day = await page.evaluate(() => Math.round(window.__game.sim.day));
console.log('\nmilestones (game day, treasury, buildings):');
for (const m of [150, 350, 650, 1100, 1800, 2800, 4200, 6500, 10000]) console.log(' ', String(m).padStart(6), P.marks[m] ? `day ${P.marks[m].day}  $${P.marks[m].money}  ${P.marks[m].blds} buildings  (top-ups so far $${P.marks[m].injected})` : 'never reached');
for (const m of [150, 350, 650, 1100, 1800, 2800, 4200, 6500, 10000]) if (P.marks[m] && process.env.MSGS) console.log(`  @${m}: next=${JSON.stringify(P.marks[m].next)}\n     ${P.marks[m].msgs.join('\n     ')}`);
console.log('peak population', best, 'at day', day);
console.log('built', JSON.stringify(P.built), 'ONE MORE LANE', P.upgrades, 'bankruptcies', P.bankruptcies, 'tax moves', P.taxMoves);
const top = Object.entries(P.blockers).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('what got in the way (times seen):'); for (const [k, v] of top) console.log(' ', String(v).padStart(4), k);
console.log('page errors', JSON.stringify(errs.slice(0, 5)));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ trace, P, errs }, null, 1));
// SAVE=file.json: write the grown town's save, to reopen it elsewhere (traffic at scale, screenshots)
if (process.env.SAVE && !savedAt) await saveTown();
// SAVETEST=1: save the grown city, reload the page, Continue, and compare; then keep playing
const saves = [];
if (process.env.SAVETEST) {
  const SNAP = () => { const g = window.__game; return { segs: g.net.segs.size, bld: g.buildings.list.size, pop: g.sim.population, money: Math.round(g.sim.money), day: Math.round(g.sim.day), loans: g.sim.loans.length, unlocked: [...(g.sim.unlocked || [])].length }; };
  const size = await page.evaluate(() => { const ok = window.__dbg.save(); const k = 'slopmerica.save.v1'; return { ok, chars: localStorage.getItem(k)?.length ?? 0, checkpoint: localStorage.getItem(k + '.checkpoint')?.length ?? 0 }; });
  const before = await page.evaluate(SNAP);
  const t0 = Date.now();
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 600000 });
  await page.waitForSelector('#continue', { timeout: 600000 });
  await page.click('#continue');
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 900000 });
  const loadMs = Date.now() - t0;
  const after = await page.evaluate(SNAP);
  const more = await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); const r = window.__dbg.run(60); return { pop: g.sim.population, money: Math.round(g.sim.money), finite: Number.isFinite(g.sim.money) && Number.isFinite(g.sim.population) }; });
  console.log(`\nSAVE: ${size.chars.toLocaleString()} characters (${(size.chars / 5242880 * 100).toFixed(0)}% of a 5 MB localStorage), checkpoint ${size.checkpoint.toLocaleString()}, saved ok ${size.ok}`);
  console.log('SAVE before', JSON.stringify(before)); console.log('SAVE after ', JSON.stringify(after), `load ${Math.round(loadMs / 1000)} s`); console.log('SAVE +60 days', JSON.stringify(more), 'page errors', JSON.stringify(errs.slice(0, 3)));
  saves.push({ size, before, after, loadMs, more });
}
await browser.close();
if (process.env.CHECK) {
  const fails = [];
  if (!P.marks[TARGET]) fails.push(`Capital of Slop (${TARGET}) never reached in ${day} days (peak ${best})`);
  if (errs.length) fails.push(`${errs.length} page errors`);
  if (bad) fails.push('NaN');
  if (fails.length) { console.log('FAIL', fails.join('; ')); process.exit(1); }
  console.log('OK');
}
