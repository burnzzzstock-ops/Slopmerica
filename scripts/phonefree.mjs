// A phone's map stays in view. On a 390 x 844 touch screen, in a new county with the first-steps guide still showing, measures
// the share of the screen where a finger lands on the map and nothing else (elementFromPoint on a 10 px grid), in the states a
// player is in during the first minutes: idle, a tool drawer open, a finger drawing a road. The tutorial card, an open drawer
// and the toolbar used to stack up: 55% free with Roads open, 44% with Services, 71% under a drawing finger with a five-line
// cost readout across the top. The step card changes shape the moment a drawer opens or closes or a tool is picked up, not
// at its next refresh. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/phonefree.mjs
import { launch } from './lib/browser.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await launch();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
// a first visit, past the welcome card: the first-steps guide is on
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));

const settle = () => page.evaluate(async () => {
  const g = window.__game;
  // (the HUD's slower parts refresh four times a second of frame time: six tenths of a second covers two of them)
  for (let i = 0; i < 6; i++) { g.frame(0.1, false); await new Promise((r) => setTimeout(r, 30)); }
});
const measure = async () => {
  await settle();
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight, canvas = window.__game.renderer.domElement;
    let free = 0, n = 0;
    for (let y = 5; y < vh; y += 10) for (let x = 5; x < vw; x += 10) { n++; if (document.elementFromPoint(x, y) === canvas) free++; }
    const box = (sel) => { const el = document.querySelector(sel); if (!el || el.hidden) return null; const cs = getComputedStyle(el); if (cs.display === 'none') return null; const r = el.getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top) }; };
    return { free: Math.round((free / n) * 1000) / 10, step: box('.next-bar'), drawer: box('.subpanel'), tip: box('#ta-tip'), badge: box('.tool-actions'), stepText: document.querySelector('.next-bar .nb-step')?.textContent ?? '' };
  });
};
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });

const idle = await measure();
check(`idle, with the first step showing: ${idle.free}% of the screen is map (80% or more)`, idle.free >= 80 && /Step 1\/5/.test(idle.stepText), idle);

await page.tap('button.tbtn[data-t="roads"]');
const roads = await measure();
check(`Roads open: ${roads.free}% is map (60% or more)`, roads.free >= 60, roads);
check(`and the step is one line beside the drawer (${roads.step?.h} px tall, 50 or less)`, !!roads.step && roads.step.h <= 50, roads);
// a tap on the step's words opens it in full
const words = await page.evaluate(() => { const r = document.querySelector('.next-bar .nb-step').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
await page.touchscreen.tap(words.x, words.y);
const opened = await measure();
check(`a tap on the step opens it in full (${opened.step?.h} px tall, taller than ${roads.step?.h})`, !!opened.step && !!roads.step && opened.step.h > roads.step.h, opened);

// a finger draws a road
await touch('touchStart', 120, 330);
await page.waitForTimeout(80);
for (let i = 1; i <= 8; i++) { await touch('touchMove', 120 + i * 18, 330 + i * 6); await page.waitForTimeout(40); }
const drawing = await measure();
check(`a finger drawing a road: ${drawing.free}% is map (80% or more)`, drawing.free >= 80, drawing);
check('the step card is out of the way while it draws', drawing.step === null, drawing);
check(`and the cost readout is two lines (${drawing.tip?.h} px tall, 36 or less)`, !!drawing.tip && drawing.tip.h > 0 && drawing.tip.h <= 36, drawing);
await touch('touchEnd', 264, 378);
const lifted = await measure();
check(`the finger lifted: the readout is whole again (${lifted.tip?.h} px) and the step is back`, !!lifted.tip && !!drawing.tip && lifted.tip.h >= drawing.tip.h && lifted.step !== null, lifted);
// whole, it has the badge's width to itself and the buttons under it: beside them it was a column 214 px tall
const readout = await page.evaluate(() => { const t = document.querySelector('#ta-tip'); return { clipped: t.scrollHeight > t.clientHeight + 1, chars: t.textContent.length, w: Math.round(t.getBoundingClientRect().width) }; });
check(`and the badge with it is ${lifted.badge?.h} px tall (120 or less), the ${readout.chars} characters of the readout ${readout.w} px wide and none cut off; ${lifted.free}% is map (65% or more)`, !!lifted.badge && lifted.badge.h <= 120 && !readout.clipped && readout.w >= 300 && lifted.free >= 65, { ...lifted, readout });

await page.tap('button.tbtn[data-t="zones"]');
const zones = await measure();
check(`Zoning open: ${zones.free}% is map (60% or more)`, zones.free >= 60, zones);

await page.tap('button.tbtn[data-t="ext:services"]');
const services = await measure();
check(`Services open: ${services.free}% is map (47% or more)`, services.free >= 47, services);
// its nine categories are one row that scrolls sideways
const cats = await page.evaluate(() => { const row = document.querySelector('.svc-cats'); const tops = new Set([...row.children].map((c) => Math.round(c.getBoundingClientRect().top))); return { rows: tops.size, n: row.children.length, scrolls: row.scrollWidth > row.clientWidth }; });
check(`the ${cats.n} service categories are one row that scrolls (${cats.rows} row)`, cats.rows === 1 && cats.scrolls, cats);

// ---- the card changes shape with the drawer, at once: no frame goes by between the tap and the look
await page.keyboard.press('Escape');
const card = () => page.evaluate(() => { const b = document.querySelector('.next-bar'); return b && !b.hidden && getComputedStyle(b).display !== 'none' ? { compact: b.classList.contains('compact'), h: Math.round(b.getBoundingClientRect().height) } : null; });
const whole = (await measure()).step, w0 = await card();
check(`with every drawer closed the step is whole again (${whole?.h} px)`, !!w0 && !w0.compact, w0);
await page.tap('button.tbtn[data-t="views"]');
const atOnce = await card();
check(`Views tapped open: the step is one line before the next frame (${atOnce?.h} px, 50 or less)`, !!atOnce && atOnce.compact && atOnce.h <= 50, atOnce);
await page.tap('button.tbtn[data-t="views"]');
const closedAtOnce = await card();
check(`and whole the moment it is tapped shut (${closedAtOnce?.h} px)`, !!closedAtOnce && !closedAtOnce.compact && closedAtOnce.h === w0?.h, closedAtOnce);
await page.tap('button.tbtn[data-t="bulldoze"]');
const inHand = await card();
check(`a tool picked up with no drawer (Bulldoze): one line before the next frame too (${inHand?.h} px)`, !!inHand && inHand.compact && inHand.h <= 50, inHand);
await page.tap('button.tbtn[data-t="inspect"]');
const putDown = await card();
check('and whole when it is put down', !!putDown && !putDown.compact, putDown);

check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
