// The edge of the money: the treasury goes under, stays under, the city goes
// bankrupt, the player takes the bailout. Every step is explained once, the
// countdown matches the weekly closes, and nothing piles up or sticks.
//   playtest 6: keep pressing 3 with the bankruptcy card up and each weekly
//   close stacked another full-screen card (five clicks to dig out), reposted
//   the news line, and un-paused the game under the card.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/moneyedge.mjs
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Ledger out of balance/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));

const fails = [];
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  ✗  ', msg); if (!ok) fails.push(msg); };
const S = () => page.evaluate(() => { const s = window.__game.sim; return { money: Math.round(s.money), weeks: s.bankruptWeeks, speed: s.speed, cards: document.querySelectorAll('.ending').length, news: window.__game.feed.list?.filter?.((p) => p.kind === 'bankrupt').length ?? null }; });
const key = (k) => page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k })), k);

// the treasury sits under the line (recorded as a spend so the ledger balances)
await page.evaluate(() => { const s = window.__game.sim; s.spend(s.money + 20000, 'test: spend into debt', 'other'); });
let s = await S();
check(s.money === -20000, `treasury at −$20,000 (spent into the credit line): ${s.money}`);

// the countdown counts weekly closes below −$15,000, and says so
await page.evaluate(() => window.__dbg.run(21));
s = await S();
check(s.weeks === 3 && s.cards === 0, `after 3 weekly closes below the line: countdown 3, no card yet (weeks ${s.weeks}, cards ${s.cards})`);
const text = await page.evaluate(() => { window.__game.ui.onTool?.('budget'); const el = document.querySelector('.budget-live, .bg-rules, .crisis'); return document.body.innerText; });
check(/3\/6/.test(text), 'the budget or the in-the-red card shows the countdown (3/6)');

await page.evaluate(() => window.__dbg.run(21));
s = await S();
check(s.weeks === 6 && s.cards === 1, `six closes: one bankruptcy card (weeks ${s.weeks}, cards ${s.cards})`);
// (__dbg.run puts the clock back when it returns; in play the card leaves it paused)
await page.evaluate(() => { window.__game.sim.speed = 1; window.__game.sim.events.emit('bankrupt', window.__game.sim.money); });
s = await S();
check(s.speed === 0 && s.cards === 1, `the next bankruptcy event pauses the game and does not stack a card (speed ${s.speed}, cards ${s.cards})`);

// the player presses speed keys with the card up: it stays up, the game stays paused
for (const k of ['3', '2', ' ', '1']) await key(k);
s = await S();
check(s.speed === 0, `speed keys are ignored while the card is up (speed ${s.speed})`);
// and even if time moves (a slow tab catching up), the weekly close doesn't stack cards
await page.evaluate(() => { window.__game.sim.speed = 3; window.__dbg.run(21); });
s = await S();
check(s.cards === 1, `three more weekly closes: still one card (cards ${s.cards})`);

// the way out: one click
await page.evaluate(() => document.querySelector('#end-go').click());
s = await S();
check(s.cards === 0 && s.money === 50000 && s.weeks === 0 && s.speed === 1, `one click on the bailout: no cards, $50,000, countdown 0, running (cards ${s.cards}, $${s.money}, weeks ${s.weeks}, speed ${s.speed})`);
await page.evaluate(() => window.__dbg.run(14));
s = await S();
check(s.cards === 0, `two more weeks in the black: no card comes back (cards ${s.cards})`);

// recovery on its own: back above the line resets the countdown
await page.evaluate(() => { const s = window.__game.sim; s.spend(s.money + 20000, 'test: spend into debt', 'other'); window.__dbg.run(21); });
s = await S();
const was = s.weeks;
await page.evaluate(() => { const s = window.__game.sim; s.earn(20000, 'other', 'test: windfall'); window.__dbg.run(7); });
s = await S();
check(was === 3 && s.weeks === 0 && s.cards === 0, `three closes under, then a windfall: countdown back to 0 (was ${was}, now ${s.weeks})`);

await browser.close();
if (errs.length) { console.log('page errors:', JSON.stringify(errs.slice(0, 3))); fails.push('page errors'); }
if (fails.length) { console.log(`FAIL: ${fails.length} problems`); process.exit(1); }
console.log('OK: bankruptcy is announced once, the countdown is honest, and one click gets out');
