// Every regional emergency, start to finish, and through a save: Hurricane
// (Florida), Wildfire (NorCal), Landslide (Appalachia), Florida Man (Florida).
// Each one warns, responds, ends; what it charges is what it says (or says
// what it charged); the roads it closed reopen; and a save taken in the
// warning or in the response comes back as the same emergency, charged once.
//   playtest 6: three of the four charged a recovery bill the player was never
//   told the amount of.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/disasterloop.mjs
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const CASES = [['florida', 'hurricane'], ['florida', 'floridaMan'], ['norcal', 'wildfire'], ['appalachia', 'landslide']];
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });

const fails = [];
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  ✗  ', msg); if (!ok) fails.push(msg); };
const ready = async () => { await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 }); await page.evaluate(() => { cancelAnimationFrame(window.__game.raf); const g = window.__game; if (!window.__toasts) { window.__toasts = []; const t = g.toast.bind(g); g.toast = (m, ...r) => { window.__toasts.push(String(m)); return t(m, ...r); }; } }); };
const boot = async (map) => { await page.goto(`${base}/#skip&map=${map}&mode=ponzi`, { waitUntil: 'load', timeout: 300000 }); await ready(); };
const town = () => page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  d.road(S.x - 60, S.z + 110, S.x - 60, S.z - 110, 'twoLane');
  d.zone(S.x - 60, S.z, 60, 'resLow');
  d.run(30);
  return { segs: g.net.segs.size, blds: g.buildings.list.size };
});
// the emergency's state, the treasury, roads still closed
const state = () => page.evaluate(async (mod) => {
  const { disasterState } = await (0, eval)(mod);
  const g = window.__game, e = disasterState().event;
  return { kind: e?.kind ?? null, phase: e?.phase ?? null, cost: e?.cost ?? 0, money: Math.round(g.sim.money), closed: [...g.net.segs.values()].filter((s) => s.blocked > 0).length, toasts: window.__toasts.slice(), blds: g.buildings.list.size };
}, MOD);
const step = (kind, days) => page.evaluate(async ({ kind, days, mod }) => {
  const { triggerDisaster } = await (0, eval)(mod);
  const g = window.__game, sys = window.__ext.systems.find((s) => s.id === 'disasters');
  if (kind) triggerDisaster(g, kind);
  else if (days) sys.daily(g, Math.floor(g.sim.day) + days);
  return true;
}, { kind, days, mod: MOD });
const dayNow = () => page.evaluate(() => Math.floor(window.__game.sim.day));
const advance = (to) => page.evaluate(async (to) => { const g = window.__game, sys = window.__ext.systems.find((s) => s.id === 'disasters'); sys.daily(g, to); return true; }, to);
const save = () => page.evaluate(() => { window.__dbg.save(); return true; });
const resume = async () => { await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 }); await page.waitForSelector('#continue', { timeout: 300000 }); await page.click('#continue'); await ready(); };
// the game's own copy of the module (after an edit, Vite serves it as /src/sim/disasters.ts?t=...; a bare import would be a second copy with its own state)
const MOD = `(async () => { const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\\/src\\/sim\\/disasters\\.ts/.test(n)); return import(u ? new URL(u).pathname + new URL(u).search : '/src/sim/disasters.ts'); })()`;
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

for (const [map, kind] of CASES) {
  console.log(`\n${kind} on ${map}`);
  await boot(map);
  const t = await town();
  check(t.segs > 0 && t.blds > 0, `a test town stands (${t.segs} road pieces, ${t.blds} buildings)`);

  // ---- straight through
  let day = await dayNow();
  await step(kind);
  let s = await state();
  check(s.phase === 'warning' && s.toasts.some((m) => /watch|incoming/i.test(m)), `it warns first (${s.phase}; "${(s.toasts.at(-1) || '').slice(0, 60)}…")`);
  await advance(day + 1);
  s = await state();
  check(s.phase === 'response', `the next day it hits (${s.phase})`);
  const cost = s.cost, before = s.money;
  await advance(day + 6);
  const e = await state();
  check(e.kind === null, 'it ends on its own');
  check(e.closed === 0, `every road it closed is open again (${e.closed} still closed)`);
  check(before - e.money === cost, `the bill is what the event recorded: charged ${usd(before - e.money)}, recorded ${usd(cost)}`);
  const said = e.toasts.filter((m) => m.includes(usd(cost))).length;
  check(cost === 0 || said > 0, `the player is told the amount (${usd(cost)}) in a message ("${(e.toasts.at(-1) || '').slice(0, 80)}")`);

  // ---- saved mid-warning and mid-response
  for (const phase of ['warning', 'response']) {
    day = await dayNow();
    await step(kind);
    if (phase === 'response') await advance(day + 1);
    const b = await state();
    await save();
    await resume();
    const a = await state();
    check(a.kind === kind && a.phase === phase, `saved in the ${phase}: comes back as the same ${a.kind} (${a.phase})`);
    if (phase === 'response') check(a.closed === b.closed, `roads still closed after the reload: ${a.closed} (was ${b.closed})`);
    const m0 = a.money;
    if (phase === 'warning') await advance((await dayNow()) + 1); // the next day it hits
    await advance((await dayNow()) + 6);
    const z = await state();
    check(z.kind === null && z.closed === 0, `it still ends after the reload (${z.kind ?? 'over'}, ${z.closed} closed)`);
    const paid = m0 - z.money;
    check(paid >= 0 && paid <= 40000, `charged once, a plausible amount (${usd(paid)})`);
  }
}

await browser.close();
if (errs.length) { console.log('\npage errors:', JSON.stringify(errs.slice(0, 3))); fails.push('page errors'); }
if (fails.length) { console.log(`\nFAIL: ${fails.length} problems`); process.exit(1); }
console.log('\nOK: every regional emergency warns, hits, bills what it says and ends, through a save');
