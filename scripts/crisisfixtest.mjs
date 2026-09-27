// Review fixes on the crisis HUD (PR #5's Codex review): an info view shows
// every building with that view's problem, even when another problem ranks
// higher (no power and trash piling up still shows in Garbage), and hovering
// it explains that problem; utility outages merge into one line only when the
// same buildings are cut off, not when the counts happen to match; a closed
// warning comes back when it gets materially worse (a landfill a stage
// closer to full, twice the buildings at risk). Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// ---- info views
const v = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, S = SV.S;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  d.road(cx - 150, cz, cx + 150, cz, 'twoLane');
  g.zones.update();
  d.zone(cx, cz + 30, 60, 'resLow');
  const cand = [];
  for (let k = 0; k < 60; k++) { g.zones.candidates('resLow', cand); if (cand.length) g.buildings.tryGrow('resLow', cand); }
  for (const b of g.buildings.list.values()) { b.state = 'active'; b.progress = 1; }
  d.run(2);
  g.sim.speed = 0;
  const homes = [...g.buildings.list.values()].filter((b) => b.zone === 'resLow' && b.state === 'active' && S.b.get(b.id));
  if (homes.length < 2) return { err: `homes ${homes.length}` };
  const [a, b2] = homes;
  // a: no power AND trash piling up; b2: trash piling up only (this lonely street has no plant, so say who has what)
  Object.assign(S.b.get(a.id), { pw: false, wa: true, se: true, garbage: 1e4, burning: 0, sick: 0, crime: 8 });
  Object.assign(S.b.get(b2.id), { pw: true, wa: true, se: true, garbage: 1e4, burning: 0, sick: 0, crime: 8 });
  g.rts.setView(cx, cz + 30, 220, 0.6, 0.8, true);
  const icons = () => { S.iconT = 0; g.frame(0.016, false); return [...S.icons.shown].filter((i) => i.id === a.id || i.id === b2.id).map((i) => `${i.id === a.id ? 'a' : 'b'}:${i.p}`).sort(); };
  const all = icons();
  S.view = 'garbage';
  const garbage = icons();
  const tipGarbage = SV.problemText(g, a.id);
  S.view = 'power';
  const power = icons();
  S.view = null;
  const tipAll = SV.problemText(g, a.id);
  return { homes: homes.length, all, garbage, power, tipGarbage, tipAll };
});
console.log(JSON.stringify(v));
check(`with no view a home shows its worst problem (${v.all})`, !v.err && v.all?.join() === 'a:power,b:garbage', v);
check(`the Garbage view shows every home piling up trash, even one with no power too (${v.garbage})`, v.garbage?.join() === 'a:garbage,b:garbage', v);
check(`the Power view shows only the one with no power (${v.power})`, v.power?.join() === 'a:power', v);
check('hovering it in the Garbage view explains the trash, not the power', /Trash piling up/.test(v.tipGarbage ?? '') && /No electricity/.test(v.tipAll ?? ''), v);

// ---- utility outages merge only for the same buildings
const m = await page.evaluate(() => {
  const SV = window.__services;
  const need = (n, icon, why) => ({ need: n, cat: n, icon, label: n[0].toUpperCase() + n.slice(1), failing: `without ${n}`, buildings: 10, residents: 40, eta: [3, 9], why });
  const lines = (arr) => arr.map((x) => `${x.label}:${x.failing}`);
  const same = SV.mergeUtilities([need('power', '⚡', 'on roads with no plant and no route to the highway'), need('water', '🚰', 'on roads with no pump and no route to the highway'), need('sewage', '🚽', 'on roads with no outfall and no route to the highway')],
    new Map([['power', [1, 2, 3]], ['water', [1, 2, 3]], ['sewage', [1, 2, 3]]]));
  const diff = SV.mergeUtilities([need('power', '⚡', 'x'), need('sewage', '🚽', 'y')], new Map([['power', [1, 2, 3]], ['sewage', [4, 5, 6]]]));
  const part = SV.mergeUtilities([need('power', '⚡', 'x'), need('water', '🚰', 'y'), need('sewage', '🚽', 'z')], new Map([['power', [1, 2]], ['water', [1, 2]], ['sewage', [7, 8]]]));
  return { same: lines(same), sameWhy: same[0]?.why, diff: lines(diff), part: lines(part) };
});
console.log(JSON.stringify(m));
check(`the same buildings cut off from all three are one line (${m.same})`, m.same.length === 1 && m.same[0] === 'Utilities:without power, water and sewage' && /no plant, pump or outfall/.test(m.sameWhy), m);
check(`different buildings with equal counts stay two lines (${m.diff})`, m.diff.length === 2 && !m.diff.some((x) => x.startsWith('Utilities')), m);
check(`two that match merge and the third stays apart (${m.part})`, m.part.length === 2 && m.part.includes('Utilities:without power and water') && m.part.includes('Sewage:without sewage'), m);

// ---- a closed warning comes back when it gets worse
const w = await page.evaluate(() => {
  const g = window.__game;
  const crisis = { since: 0, cause: '', peakAtRisk: 0, peakTrash: 0, lowPop: 0, popAtStart: 0, endedAt: 0 };
  const need = (n) => ({ need: 'garbage', cat: 'garbage', icon: '🗑️', label: 'Garbage', failing: 'piling up trash', buildings: n, residents: n * 3, eta: [20, 40], why: 'trucks at their limit' });
  let view = null;
  const real = g.emergency;
  g.emergency = () => view;
  const shown = () => { g.ui.refreshNow(); const el = document.querySelector('.emergency'); return !!el && !el.hidden; };
  const set = (atRisk, days) => { view = { level: 'warn', needs: atRisk ? [need(atRisk)] : [], atRisk, residents: atRisk * 3, hot: [], forecast: days === null ? null : `🗑️ Landfills full in about ${days} days`, forecastDays: days, crisis, trash: atRisk, abandoned: 0, day: 5 }; };
  const out = {};
  set(0, 59); out.first = shown();
  document.querySelector('.emergency [data-em="close"]')?.click();
  out.closed = !shown();
  set(0, 45); out.sameStage = !shown();
  set(0, 20); out.month = shown();
  document.querySelector('.emergency [data-em="close"]')?.click();
  set(0, 0); out.full = shown();
  document.querySelector('.emergency [data-em="close"]')?.click();
  set(4, 0); out.newNeed = shown();
  document.querySelector('.emergency [data-em="close"]')?.click();
  set(7, 0); out.fewMore = !shown();
  set(12, 0); out.doubled = shown();
  g.emergency = real;
  return out;
});
console.log(JSON.stringify(w));
check('a landfill warning shows, and ✕ closes it', w.first && w.closed, w);
check('it stays closed while the estimate moves within the same stage (59 → 45 days)', w.sameStage, w);
check('it comes back when it gets closer (under a month), and when the landfill is full', w.month && w.full, w);
check('a new failing need brings it back; a few more buildings don\'t, twice as many do', w.newNeed && w.fewMore && w.doubled, w);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
