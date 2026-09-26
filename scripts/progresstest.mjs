// Progression is findable and never in the way: an unlock says what and
// where, its Open button goes there with the new thing selected, the card
// is marked NEW until used, locked cards give the population they need,
// and a celebration during placement is a small notice, not a banner over
// the map. Exits nonzero on failure.
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
check(`locked zones give the population they need (${locked.join(', ')})`, locked.length > 0 && locked.every((t) => /🔒 Pop [\d,]+/.test(t)), locked);
await page.keyboard.press('Escape');

// reaching 250 people: the sim's own milestone path
await page.evaluate(() => { const s = window.__game.sim; s.population = 260; s.checkMilestones(); });
await settle();
const note = await page.evaluate(() => { const t = document.querySelector('.toast.unlock'); return t ? t.textContent : null; });
check(`the unlock says what and where ("${note}")`, !!note && /Unlocked at 250 people/.test(note) && /Zoning → /.test(note), note);
const bigBanner = await page.evaluate(() => [...document.querySelectorAll('.banner')].some((b) => /Unlocked/.test(b.textContent)));
check('and no banner covers the middle of the map for it', !bigBanner);
await page.click('.toast.unlock button');
await settle();
const opened = await page.evaluate(() => {
  const g = window.__game;
  return { tool: g.tools.active, zone: g.tools.zoneType, title: document.querySelector('.subpanel .sp-title')?.textContent ?? '', newCards: [...document.querySelectorAll('.card.new')].map((c) => c.dataset.zone ?? c.dataset.road) };
});
check(`Open goes to Zoning with the new zone in hand (${opened.zone})`, opened.tool === 'zone' && opened.zone === 'resHigh' && /Zoning/.test(opened.title), opened);
check('its card is marked NEW until used', opened.newCards.includes('resHigh'), opened.newCards);
await page.click('[data-zone="resHigh"]');
const cleared = await page.evaluate(() => [...document.querySelectorAll('.card.new')].length);
check('using it clears the NEW mark', cleared === 0, cleared);
await page.keyboard.press('Escape');

// a milestone while placing something: a notice, not a banner
await page.evaluate(() => { const g = window.__game; g.tools.landmark = 'waterTower'; g.tools.set('landmark'); g.ui.banner('Population 500', 'San Slopcisco'); });
const during = await page.evaluate(() => ({ banners: [...document.querySelectorAll('.banner')].filter((b) => /Population 500/.test(b.textContent)).length, toast: [...document.querySelectorAll('.toast')].some((t) => /Population 500/.test(t.textContent)) }));
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
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
