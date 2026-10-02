// The trash cliff (docs/PLAYTEST_6.md, "The trash cliff"): when a town's landfill
// filled, its buildings piled up trash, emptied, and 45 days later came down with
// no warning: Appalachia lost a third of its buildings before the bot (or a
// person) could act. Now an abandoned building stands 90 days, and the game says
// how many come down and when, 30 days and again 7 days before the first of
// them, with what brings their people back (services.ts DEMOLISH_DAYS,
// DEMOLISH_WARN). On the reference block, seeded (no landfill: the county contract
// hauls 3.5 t a day, not the block's trash, and buildings stand abandoned already;
// any landfill or incinerator is bulldozed), day by day until the first abandoned
// buildings come down:
//  - the first to come down stood at least 85 days abandoned (its own count);
//  - an alert named the day it came down, a week ahead at least;
//  - the inspector's word on an abandoned building says when it comes down.
// usage: node scripts/trashcliff.mjs   (BASE_URL, default http://127.0.0.1:5173; SEED=n replays a run;
// DAYS, default 200). Exits 1 on failure.
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
const DAYS = Number(process.env.DAYS || 200);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, seed: SEED, quality: 'low' });
const r = await page.evaluate(async ({ DAYS }) => {
  const g = window.__game, d = window.__dbg, SV = window.__services;
  const gone = [...g.buildings.list.values()].filter((b) => b.zone === 'service' && (b.kind === 'landfill' || b.kind === 'incinerator'));
  for (const b of gone) g.buildings.demolish(b, 'bulldozed');
  const day0 = Math.floor(g.sim.day), alerts0 = g.sim.alerts.length;
  const days = new Map(); // abandoned building id -> its count of days abandoned, as last seen
  const cameDown = new Map(); // building id -> the day it came down
  let firstDown = null, text = null;
  for (let k = 0; k < DAYS; k++) {
    d.run(1);
    const day = Math.floor(g.sim.day) - day0;
    for (const [id, n] of days) if (!cameDown.has(id) && !g.buildings.list.has(id)) { cameDown.set(id, day); if (firstDown === null) firstDown = { day, stood: n + 1 }; }
    for (const b of g.buildings.list.values()) if (b.abandoned !== undefined) days.set(b.id, b.abandoned);
    // the inspector's word on one of them, half way
    if (text === null) for (const b of g.buildings.list.values()) if (b.abandoned !== undefined && b.abandoned >= 20) { text = SV.problemText?.(g, b.id) ?? null; break; }
    if (firstDown && day > firstDown.day + 3) break;
  }
  const warns = g.sim.alerts.slice(alerts0).filter((a) => /abandoned building/.test(a.text)).map((a) => ({ day: a.day - day0, level: a.level, text: a.text }));
  return { bulldozed: gone.length, emptied: days.size, cameDown: cameDown.size, firstDown, warns, text, exposed: typeof SV.problemText === 'function' };
}, { DAYS });
console.log(`  ${r.bulldozed} garbage sites bulldozed; ${r.emptied} buildings stood abandoned; ${r.cameDown} came down${r.firstDown ? ` (the first on day ${r.firstDown.day}, after standing ${r.firstDown.stood} days abandoned)` : ''}`);
for (const w of r.warns) console.log(`  day ${w.day} ${w.level}: ${w.text}`);
if (r.text) console.log(`  the inspector: ${r.text}`);
check(`buildings empty with nobody collecting their trash (${r.emptied})`, r.emptied > 0);
check(`the first to come down stood at least 85 days abandoned (${r.firstDown ? `${r.firstDown.stood} days` : 'none came down'})`, !!r.firstDown && r.firstDown.stood >= 85);
// (an alert that named that day: "come down in N days" on day D, D + N within two days of it, N a week at least)
const named = r.firstDown && r.warns.find((w) => { const m = w.text.match(/come(?:s)? down in (\d+) days/); return m && Number(m[1]) >= 7 && Math.abs(w.day + Number(m[1]) - r.firstDown.day) <= 2; });
check(`an alert said how many come down and when, a week ahead at least (${r.warns.length} alerts)`, !!named, r.warns.slice(0, 3));
check(`the inspector says when an abandoned building comes down ("${(r.text ?? 'none').slice(0, 120)}")`, /comes down in \d+ days/.test(r.text ?? ''), r.exposed ? undefined : 'problemText not exposed');
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
