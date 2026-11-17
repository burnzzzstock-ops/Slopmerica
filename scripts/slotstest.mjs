// Saves you can trust: the slots. Plays a little, puts the city in a slot from Settings, and checks on the title screen that
// Saved cities lists it with its people and day; that Start paving asks before a new city takes the place of the one to
// resume, and keeping it makes a second slot; that a slot loads as the same city (the same county fingerprint it was saved
// with); that Delete asks twice; and that a stored city this build cannot read is said so and left where it is. On a phone
// the list's buttons are a finger tall. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/slotstest.mjs
import { launch } from './lib/browser.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const KEY = 'slopmerica.save.v1';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
const inGame = () => page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
const slots = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('slopmerica', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('slots')) r.result.createObjectStore('slots', { keyPath: 'name' }); }; r.onerror = () => res([]); r.onsuccess = () => { const q = r.result.transaction('slots').objectStore('slots').getAll(); q.onsuccess = () => { r.result.close(); res(q.result.map(({ text, ...x }) => ({ ...x, chars: text.length })).sort((a, b) => a.savedAt - b.savedAt)); }; q.onerror = () => res([]); }; }));
const title = async () => { await page.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 }); await page.waitForSelector('.title #new', { timeout: 300000 }); await page.waitForTimeout(400); };

// ---- a small town, saved, and put in a slot from Settings
await page.goto(`${base}/#skip&map=appalachia&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await inGame();
const town = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  g.sim.earn(200000, 'other', 'Test funds');
  d.road(S.x - 160, S.z + 70, S.x + 160, S.z + 70, 'twoLane');
  d.zone(S.x - 60, S.z + 100, 80, 'resLow'); d.zone(S.x + 80, S.z + 100, 50, 'comLow');
  d.run(40);
  d.save();
  return { city: g.cityName, pop: g.sim.population, day: Math.floor(g.sim.day), buildings: g.buildings.list.size, steps: g.steps, print: JSON.stringify(d.fingerprint()) };
});
await page.click('.tbtn[data-t="help"]');
await page.click('#save-slot');
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Saved as/.test(t.textContent)), null, { timeout: 15000 }).catch(() => {});
const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
// two days on from the moment it went into the slot: what the county must look like when the slot's copy gets there too
// (a loaded city is running by the time it can be looked at, so the two are compared at the same step, not at the load)
const later = await page.evaluate(() => { const g = window.__game; g.runSteps(64); return { steps: g.steps, print: JSON.stringify(window.__dbg.fingerprint()) }; });
let list = await slots();
check(`Settings, Save to a slot, puts the city away ("${toast.slice(0, 70)}")`, /Saved as/.test(toast) && list.length === 1 && list[0].city === town.city && list[0].pop === town.pop && list[0].day === town.day, { toast, list, town });

// ---- the title screen lists it
await title();
let t = await page.evaluate(() => ({ resume: !!document.querySelector('#continue'), link: document.querySelector('#slots-open')?.textContent ?? '', hidden: document.querySelector('#slots-open')?.hidden }));
check(`the title screen has Saved cities ("${t.link}")`, t.resume && t.hidden === false && /Saved cities \(1\)/.test(t.link), t);
await page.click('#slots-open');
const row = await page.evaluate(() => document.querySelector('.aaa-slot')?.textContent.replace(/\s+/g, ' ').trim() ?? '');
check(`with its people and its day ("${row.slice(0, 90)}")`, row.includes(town.city) && row.includes(`${town.pop.toLocaleString()} people`) && row.includes(`day ${town.day}`), row);

// ---- a new city asks first
await page.click('#new');
await page.click('#go');
let keep = await page.evaluate(() => ({ shown: document.querySelector('#keep')?.hidden === false, text: document.querySelector('#keep p')?.textContent ?? '', inGame: !!window.__game }));
check(`Start paving asks before it takes the place of the city to resume ("${keep.text.slice(0, 80)}")`, keep.shown && keep.text.includes(town.city) && !keep.inGame, keep);
await page.click('#keep-cancel');
keep = await page.evaluate(() => ({ shown: document.querySelector('#keep')?.hidden === false, inGame: !!window.__game }));
check('Not yet puts the question away and starts nothing', !keep.shown && !keep.inGame, keep);
await page.click('#go');
await page.click('#keep-yes');
await inGame();
list = await slots();
check(`Keep it, then start: the old city is a second slot (${list.length}) and a new city is running`, list.length === 2 && list[1].city === town.city && list[1].pop === town.pop, list);

// ---- a slot loads as the city it was
await title();
await page.click('#slots-open');
await page.click('[data-slot-load="1"]');   // (newest first: 1 is the one saved from Settings)
await inGame();
const back = await page.evaluate((later) => { const g = window.__game, d = window.__dbg; cancelAnimationFrame(g.raf); const at = g.steps, o = { city: g.cityName, pop: g.sim.population, day: Math.floor(g.sim.day), buildings: g.buildings.list.size, loadedAt: at }; if (later.steps >= at) g.runSteps(later.steps - at); return { ...o, steps: g.steps, print: JSON.stringify(d.fingerprint()) }; }, later).catch((e) => ({ err: String(e) }));
if (back.print !== later.print) { const a = JSON.parse(later.print), b = JSON.parse(back.print ?? '{}'); console.log(`  saved at step ${town.steps}, loaded and looked at from step ${back.loadedAt}, compared at ${later.steps} and ${back.steps}; fingerprints that differ: ${Object.keys(a).filter((k) => a[k] !== b[k]).join(', ')}`); }
check(`a slot loads as the city it was (${back.city}, ${back.pop} people, day ${back.day}, ${back.buildings} buildings), and two days on it is the same county as the one that went in (step ${back.steps}, every fingerprint)`, back.city === town.city && back.pop === town.pop && back.day === town.day && back.buildings === town.buildings && back.steps === later.steps && back.print === later.print, { back: { ...back, print: (back.print ?? '').length }, town: { ...town, print: town.print.length }, later: later.steps });

// ---- delete asks twice
await title();
await page.click('#slots-open');
await page.click('[data-slot-del="0"]');
const asked = await page.evaluate(() => document.querySelector('[data-slot-del="0"]')?.textContent ?? '');
list = await slots();
check(`Delete asks first ("${asked}") and has deleted nothing yet (${list.length})`, /for good/.test(asked) && list.length === 2, { asked, n: list.length });
await page.click('[data-slot-del="0"]');
await page.waitForFunction(() => /Saved cities \(1\)/.test(document.querySelector('#slots-open')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
list = await slots();
check(`the second tap deletes that one (${list.length} left)`, list.length === 1, list);

// ---- a stored city this build cannot read
await page.evaluate((KEY) => { localStorage.setItem(KEY, JSON.stringify({ v: 99, city: 'From The Future', map: 'norcal' })); localStorage.removeItem(`${KEY}.checkpoint`); }, KEY);
await title();
const un = await page.evaluate((KEY) => ({ resume: !!document.querySelector('#continue'), text: document.querySelector('.aaa-unreadable')?.textContent ?? '', kept: (localStorage.getItem(KEY) ?? '').includes('From The Future') }), KEY);
check(`a stored city that cannot be read is said so and left where it is ("${un.text.slice(0, 90)}")`, !un.resume && /could not be read \(made by a newer version of the game\)/.test(un.text) && /Nothing has been deleted/.test(un.text) && un.kept, un);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await ctx.close();

// ---- a phone: the list's buttons are a finger tall and the rows fit
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const phone = await pctx.newPage();
await phone.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await phone.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 300000 });
await phone.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
await phone.evaluate(async () => { const S = await import('/src/sim/slots.ts'); const g = window.__game; cancelAnimationFrame(g.raf); await S.writeSlot('A county with a rather long name, day 3', window.__dbg.snapshot()); });
await phone.goto(`${base}/`, { waitUntil: 'load', timeout: 300000 });
await phone.waitForSelector('.title #new', { timeout: 300000 });
await phone.waitForFunction(() => document.querySelector('#slots-open')?.hidden === false, null, { timeout: 10000 }).catch(() => {});
await phone.tap('#slots-open');
const sizes = await phone.evaluate(() => { const r = document.querySelector('.aaa-slot')?.getBoundingClientRect(); return { row: r ? { left: Math.round(r.left), right: Math.round(r.right) } : null, buttons: [...document.querySelectorAll('.aaa-slot .aaa-link')].map((b) => Math.round(b.getBoundingClientRect().height)) }; });
check(`phone: the list fits the screen and its buttons are a finger tall (${sizes.buttons.join(', ')} px)`, !!sizes.row && sizes.row.left >= 0 && sizes.row.right <= 390 && sizes.buttons.length === 2 && sizes.buttons.every((h) => h >= 44), sizes);
await pctx.close();
await browser.close();
process.exit(bad ? 1 : 0);
