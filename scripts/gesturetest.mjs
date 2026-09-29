// Phone gestures against a pending plan. On a phone, a road (or a service) is
// planned with taps and built with the Build button, and to look at the plan
// you pinch, twist or pan with two fingers. playtest 6: the second finger
// landing cancelled the tool, so zooming in on a planned road wiped it (and
// left the "finger down" flag stuck). Real touch events (CDP), iPhone size.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/gesturetest.mjs
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
await page.evaluate(() => cancelAnimationFrame(window.__game.raf)); // handlers run on events, not frames
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })) });
const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await page.waitForTimeout(120); };
const pinch = async (cx, cy, r0, r1) => { await touch('touchStart', [[cx - r0, cy], [cx + r0, cy]]); for (let i = 1; i <= 8; i++) { const r = r0 + (r1 - r0) * i / 8; await touch('touchMove', [[cx - r, cy], [cx + r, cy]]); await page.waitForTimeout(20); } await touch('touchEnd', []); await page.waitForTimeout(150); };
const pan2 = async (x1, y1, x2, y2) => { await touch('touchStart', [[x1 - 30, y1], [x1 + 30, y1]]); for (let i = 1; i <= 8; i++) { const x = x1 + (x2 - x1) * i / 8, y = y1 + (y2 - y1) * i / 8; await touch('touchMove', [[x - 30, y], [x + 30, y]]); await page.waitForTimeout(20); } await touch('touchEnd', []); await page.waitForTimeout(150); };
const S = () => page.evaluate(() => { const g = window.__game, t = g.tools, c = g.rts; const p = t.pending, st = t.start && [Math.round(t.start.x), Math.round(t.start.z)]; return { pending: p, cost: t.pendingCost, start: st, down: t.touchDown, dist: Math.round(c.goal.distance), tx: Math.round(c.goal.target.x), tz: Math.round(c.goal.target.z), active: t.active, ext: t.extTool }; });
const fails = [];
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  ✗  ', msg); if (!ok) fails.push(msg); };

console.log('road: plan, then look at it');
await page.evaluate(() => { const g = window.__game; g.tools.set('road'); g.tools.roadType = 'twoLane'; });
await tap(150, 340); await tap(290, 260);
const planned = await S();
check(planned.pending && planned.start, `a road is planned by two taps (start ${JSON.stringify(planned.start)})`);
await pinch(195, 300, 40, 110);
let s = await S();
check(s.dist < planned.dist, `pinch out zooms in (${planned.dist} → ${s.dist})`);
check(s.pending && JSON.stringify(s.start) === JSON.stringify(planned.start), `the planned road is still there after the pinch (pending ${s.pending}, start ${JSON.stringify(s.start)})`);
check(s.down === false, `and no finger is left "down" (touchDown ${s.down})`);
await pan2(195, 350, 195, 260);
s = await S();
check(s.pending && s.tz !== planned.tz, `two-finger pan moves the map and keeps the plan (target z ${planned.tz} → ${s.tz}, pending ${s.pending})`);
await pinch(195, 300, 110, 40);
s = await S();
check(s.pending, `pinch back out: still planned (pending ${s.pending})`);

console.log('road: a stroke that turns into a pinch');
await page.evaluate(() => window.__game.tools.cancel());
await touch('touchStart', [[120, 330]]); await touch('touchMove', [[135, 315]]);
await touch('touchStart', [[120, 330], [270, 330]]); // the second finger lands mid-stroke
await touch('touchMove', [[100, 330], [290, 330]]); await touch('touchEnd', []);
await page.waitForTimeout(150);
s = await S();
check(s.pending === false && s.down === false, `a stroke that becomes a pinch plans nothing and lets go (pending ${s.pending}, touchDown ${s.down})`);

console.log('road: draw with one finger, then look');
await page.evaluate(() => window.__game.tools.cancel());
await touch('touchStart', [[100, 370]]); for (let i = 1; i <= 8; i++) { await touch('touchMove', [[100 + i * 20, 370 - i * 12]]); await page.waitForTimeout(20); } await touch('touchEnd', []);
await page.waitForTimeout(200);
s = await S();
check(s.pending, `one finger drags a road out (pending ${s.pending})`);

console.log('a service: plan it, then look');
await page.evaluate(() => { const g = window.__game; g.tools.set('inspect'); window.__dbg.unlockAll(); });
await page.evaluate(() => window.__game.ui.openServices('fire'));
await page.waitForTimeout(300);
await page.evaluate(() => { const b = document.querySelector('.subpanel [data-svc="fireStation"], .subpanel button.card[data-svc]'); b?.click(); });
await page.waitForTimeout(300);
const svc = await S();
check(svc.active === 'ext' && svc.ext === 'svcPlace', `a service is in hand (${svc.active}/${svc.ext})`);
await tap(200, 300);
const planSvc = await page.evaluate(async () => { const e = window.__ext.tools.get('svcPlace'); return e?.pending?.() ?? null; });
check(!!planSvc, `a tap plans the service, waiting for Build (${JSON.stringify(planSvc)})`);
await pinch(195, 300, 40, 100);
const afterSvc = await page.evaluate(async () => { const e = window.__ext.tools.get('svcPlace'); return e?.pending?.() ?? null; });
check(!!afterSvc, `the planned service survives a pinch (${JSON.stringify(afterSvc)})`);

console.log('no tool: one finger pans, two fingers zoom');
await page.evaluate(() => window.__game.tools.set('inspect'));
const p0 = await S();
await touch('touchStart', [[195, 360]]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [[195, 360 - i * 20]]); await page.waitForTimeout(20); } await touch('touchEnd', []);
await page.waitForTimeout(150);
const p1 = await S();
check(p1.tz !== p0.tz || p1.tx !== p0.tx, `a one-finger drag pans the map (${p0.tx},${p0.tz} → ${p1.tx},${p1.tz})`);
check(p1.dist === p0.dist, `and doesn't zoom (${p0.dist} → ${p1.dist})`);

await browser.close();
if (errs.length) { console.log('page errors:', JSON.stringify(errs.slice(0, 3))); fails.push('page errors'); }
if (fails.length) { console.log(`FAIL: ${fails.length} problems`); process.exit(1); }
console.log('OK: pinching and panning keep a phone player\'s plan');
