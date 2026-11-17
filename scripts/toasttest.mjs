// A toast stays up long enough to read. Every toast used to fade after 2.6 s whatever it said; a refusal of twenty-odd
// words (why, and what to do instead) was gone a third of the way through. Its time now comes from its length
// (toastMs in src/ui/copy.ts: 3 s at least, a second and 300 ms a word, 10 s at most), then it fades for 0.6 s.
// In a running game this shows a one-word toast and a 27-word one and looks at 2.5 s, 4.5 s, 8 s and 10.5 s, then checks
// that the same message shown again starts its time over. Exits nonzero on failure.
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); if (!ok) bad++; };
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
// the game's own start-up toasts out of the way first
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

const SHORT = 'Saved.';
const LONG = 'Not enough money for lawyers: the suit costs $40,000. Save up, or take a loan in the Budget, and come back when the treasury can cover it.';
/** each message: is it up, and is it fading */
const look = () => page.evaluate(([a, b]) => { const of = (m) => { const t = [...document.querySelectorAll('.toast')].find((x) => x.textContent === m); return t ? (t.classList.contains('out') ? 'fading' : 'up') : 'gone'; }; return { short: of(a), long: of(b) }; }, [SHORT, LONG]);
const t0 = Date.now();
await page.evaluate(([a, b]) => { const ui = window.__game.ui; ui.toast(a); ui.toast(b, true); }, [SHORT, LONG]);
const at = async (ms) => { await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0))); return look(); };
let s = await at(2500);
check('at 2.5 s both are up', s.short === 'up' && s.long === 'up', s);
s = await at(4500);
check(`at 4.5 s the one word has gone and the 27 words are still up, not fading (${s.long})`, s.short === 'gone' && s.long === 'up', s);
s = await at(8000);
check(`at 8 s they are still up, with 1.1 s of their 9.1 s to go (${s.long})`, s.long === 'up', s);
s = await at(10500);
check(`at 10.5 s they have gone (${s.long})`, s.long === 'gone', s);

// the same message again while it is up: one toast, its time started over
const t1 = Date.now();
await page.evaluate((a) => window.__game.ui.toast(a), SHORT);
await page.waitForTimeout(2000 - (Date.now() - t1));
const twice = await page.evaluate((a) => { window.__game.ui.toast(a); return [...document.querySelectorAll('.toast')].filter((x) => x.textContent === a).length; }, SHORT);
await page.waitForTimeout(4300 - (Date.now() - t1));
s = await look();
check(`shown again at 2 s it is one toast (${twice}), still up at 4.3 s (${s.short})`, twice === 1 && s.short === 'up', { twice, ...s });
await page.waitForTimeout(6100 - (Date.now() - t1));
s = await look();
check(`and gone at 6.1 s (${s.short})`, s.short === 'gone', s);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
