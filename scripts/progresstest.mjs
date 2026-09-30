// Progression is findable and never in the way. Milestones (as in Cities:
// Skylines) unlock services, zones, roads and landmarks in batches at real
// populations, each with a state grant: a new county can't build every
// service on day one. A milestone says what it unlocked and where, its Open
// button goes there with the new thing selected, the card is marked NEW
// until used, locked cards name the milestone and population they need, the
// top bar names the town's milestone, and a celebration during placement is
// a small notice, not a banner over the map. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
const settle = () => page.evaluate(() => { const g = window.__game; g.frame(0.05, false); g.ui.update(0.05); });

// locked cards say how many people they need
await page.click('button.tbtn[data-t="zones"]');
const locked = await page.evaluate(() => [...document.querySelectorAll('.card.zone:disabled small')].map((e) => e.textContent));
check(`locked zones name the milestone and population they need (${locked.join(', ')})`, locked.length > 0 && locked.every((t) => /🔒 .+ · [\d,]+/.test(t)), locked);
await page.keyboard.press('Escape');

// a new county: the basics only (no landfill, fire station, sheriff or school yet)
const start = await page.evaluate(() => {
  const g = window.__game, SV = window.__services, S = g.startView();
  const why = (id) => SV.findSpot(g, id, S.x + 60, S.z + 60).reason ?? 'ok';
  return { money: Math.round(g.sim.money), well: why('wellTower'), landfill: why('landfill'), fire: why('fireStation'), school: why('school'), top: document.querySelector('#tb-date')?.textContent ?? '' };
});
console.log(JSON.stringify(start));
check(`a new county starts with $${start.money.toLocaleString()} and the utilities, not every service (landfill: "${start.landfill}")`, start.money <= 70000 && !/Unlocks/.test(start.well) && /Unlocks at 150 people \(Wide Spot in the Road\)/.test(start.landfill) && /Unlocks at 350 people/.test(start.fire) && /Unlocks at 650 people/.test(start.school), start);

// reaching 1,150 people: the sim's own milestone path, four milestones at once
const m0 = await page.evaluate(() => Math.round(window.__game.sim.money));
await page.evaluate(() => { const s = window.__game.sim; s.population = 1150; s.checkMilestones(); });
await settle();
const cards = await page.evaluate(() => [...document.querySelectorAll('.toast.unlock')].map((t) => t.textContent));
const note = cards[cards.length - 1] ?? null;
const m1 = await page.evaluate(() => Math.round(window.__game.sim.money));
check(`the milestone says what it unlocked and where ("${note}")`, !!note && /🏅 Boomburb/.test(note) && /1,100 people/.test(note) && /Unlocked: .*Luxury Slop/.test(note) && /Next: Exurb at 1,800 people/.test(note), cards);
check(`each milestone passed pays its state grant (+$${(m1 - m0).toLocaleString()} for four)`, m1 - m0 === 5000 + 10000 + 15000 + 20000, { m0, m1 });
const bigBanner = await page.evaluate(() => [...document.querySelectorAll('.banner')].some((b) => /Unlocked|Boomburb/.test(b.textContent)));
check('and no banner covers the middle of the map for it', !bigBanner);
const hud = await page.evaluate(() => { const g = window.__game; g.ui.nextStepT = -1e9; g.ui.refreshNow?.(); return { top: document.querySelector('#tb-date')?.textContent ?? '', chip: document.querySelector('.next-bar .nb-unlock')?.textContent ?? '', log: g.sim.alerts.map((a) => a.text).filter((t) => /Milestone/.test(t)).length }; });
check(`the top bar names the milestone ("${hud.top}") and the next one is in view ("${hud.chip}")`, /🏅 Boomburb/.test(hud.top) && (!hud.chip || /1,800: Exurb/.test(hud.chip)) && hud.log === 4, hud);
await page.evaluate(() => { const b = [...document.querySelectorAll('.toast.unlock button')].pop(); b?.click(); });
await settle();
const opened = await page.evaluate(() => {
  const g = window.__game;
  return { tool: g.tools.active, zone: g.tools.zoneType, title: document.querySelector('.subpanel .sp-title')?.textContent ?? '', newCards: [...document.querySelectorAll('.card.new')].map((c) => c.dataset.zone ?? c.dataset.road) };
});
check(`Open goes to Zoning with the new zone in hand (${opened.zone})`, opened.tool === 'zone' && opened.zone === 'resHigh' && /Zoning/.test(opened.title), opened);
check('its card is marked NEW until used', opened.newCards.includes('resHigh'), opened.newCards);
await page.click('[data-zone="resHigh"]');
const cleared = await page.evaluate(() => [...document.querySelectorAll('.card.new')].map((c) => c.dataset.zone ?? c.dataset.road));
check(`using it clears its NEW mark (still new: ${cleared.join(', ') || 'none'})`, !cleared.includes('resHigh'), cleared);
await page.keyboard.press('Escape');

// a milestone while placing something: a notice, not a banner
await page.evaluate(() => { const g = window.__game; g.tools.landmark = 'waterTower'; g.tools.set('landmark'); g.ui.banner('Population 9,999', 'San Slopcisco'); });
const during = await page.evaluate(() => ({ banners: [...document.querySelectorAll('.banner')].filter((b) => /Population 9,999/.test(b.textContent)).length, toast: [...document.querySelectorAll('.toast')].some((t) => /Population 9,999/.test(t.textContent)) }));
check('a celebration while placing is a small notice', during.banners === 0 && during.toast, during);
// the two meters explain themselves
await page.evaluate(() => window.__game.tools.set('inspect'));
await page.click('#tb-meters');
await settle();
const mp = await page.evaluate(() => { const m = document.querySelector('.meter-pop'); return m && !m.hidden ? m.textContent : null; });
check('clicking the 🌲/🏙️ meters explains both, with live numbers', !!mp && /Nature left\s*\d+%/.test(mp) && /Endless Sprawl\s*\d+%/.test(mp) && /win/.test(mp), mp);
await page.keyboard.press('Escape');
const mClosed = await page.evaluate(() => document.querySelector('.meter-pop')?.hidden);
check('Esc closes it', mClosed === true, mClosed);
// playtest 6: a town sat at 1,181 people for 2,600 days: builders wanted offices (locked
// until 1,800) and nothing else, and the guide said "zone what's in demand meanwhile"
// while taxes at 15% were what held homes back. With only a locked zone wanted, the
// guide names what holds homes back and points at the budget.
const stuck = await page.evaluate(() => {
  const g = window.__game, s = g.sim;
  // (a town short of the office milestone: offices unlock at 1,100 now, and this one is past
  // it, so its office unlock is taken away for the question and given back after)
  const keep = { demand: s.demand, parts: s.demandParts };
  const taken = [...s.unlocked].find((w) => { s.unlocked.delete(w); const gone = !s.isUnlocked({ zone: 'office' }); s.unlocked.add(w); return gone; });
  if (taken) s.unlocked.delete(taken);
  s.demand = { res: -2, com: -45, ind: -20, off: 70 };
  s.demandParts = { ...s.demandParts, res: [{ text: 'new-town appetite', v: 30, base: true }, { text: 'taxes at 15%', v: -27 }, { text: '120 more workers than jobs', v: -5 }] };
  const a = g.ui.nextAction();
  const locked = !s.isUnlocked({ zone: 'office' });
  s.demand = keep.demand; s.demandParts = keep.parts;
  if (taken) s.unlocked.add(taken);
  return { locked, text: a.text, act: a.act ?? null };
});
check(`only offices wanted and they're locked: the guide names what holds homes back ("${stuck.text}")`, stuck.locked && /taxes at 15%/.test(stuck.text) && /1,100/.test(stuck.text) && stuck.act === 'budget', stuck);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
