// A tap on a building that sits where the inspector sheet's close button will appear must select it, not select it and close it again (round 8, fov probe).
// On a phone the sheet opens under the finger the moment the tap lifts, and the browser's emulated click is then delivered to what is under the finger now:
// the sheet's x button. Seen with a real tap at 110 degrees: Game.inspect selected the building and 21 ms later the close button's handler selected nothing.
// This puts a building exactly under where the x will be (the camera is moved until the building's middle projects onto it), taps it with a real touch,
// and checks the building is still selected a second later; then that the x still closes the sheet when it is pressed on purpose.
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5173 node scripts/ghosttap.mjs      exits 1 on failure
import { chromium } from 'playwright-core';
import { ARGS, EXE } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 420000 });
await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const sel = () => page.evaluate(() => { const s = window.__game.selection; return s ? (s.kind === 'building' ? s.b.id : s.kind) : null; });

// a little town, and one building to tap
const b = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, s = g.startView();
  d.road(s.x - 200, s.z, s.x + 200, s.z, 'twoLane'); d.road(s.x, s.z - 160, s.x, s.z + 160, 'twoLane');
  d.zone(s.x - 90, s.z + 45, 50, 'resLow'); d.zone(s.x + 90, s.z + 45, 50, 'resLow'); d.zone(s.x - 60, s.z - 55, 45, 'comLow');
  d.run(24);
  const act = [...g.buildings.list.values()].filter((x) => x.state === 'active').sort((a, c) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(c.x - s.x, c.z - s.z));
  const t = act[0];
  return t ? { id: t.id, x: t.x, z: t.z, h: t.model?.height ?? 6 } : null;
});
check('there is a building to tap', !!b, b);
if (!b) { await browser.close(); process.exit(1); }

// where will the sheet's x be? open the sheet once for this building and measure it
const x = await page.evaluate(({ id }) => {
  const g = window.__game, bl = g.buildings.list.get(id);
  window.__dbg.view(bl.x, bl.z, 90, 0.6, 0.8);
  g.select({ kind: 'building', b: bl });
  for (let i = 0; i < 4; i++) { g.ui.update(0.5); g.frame(0.05, true); }
  const r = document.querySelector('#in-close')?.getBoundingClientRect();
  const out = r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) } : null;
  g.select(null);
  return out;
}, b);
check('the sheet has a close button, on screen', !!x && x.x > 0 && x.x < 390, x);
if (!x) { await browser.close(); process.exit(1); }
await page.waitForFunction(() => { const i = document.querySelector('.inspector'); return !i || i.hidden || i.offsetParent === null; }, null, { timeout: 60000 }).catch(() => {});

// move the camera until the building's middle is exactly where that button is (Newton steps on the ground plane)
const aim = await page.evaluate(({ b, x }) => {
  const g = window.__game, V = g.camera.position.constructor, cv = g.renderer.domElement.getBoundingClientRect();
  const at = (tx, tz) => { window.__dbg.view(tx, tz, 90, 0.6, 0.8); const v = new V(b.x, g.terrain.h(b.x, b.z) + 0.5 * b.h, b.z).project(g.camera); return [cv.left + ((v.x + 1) / 2) * cv.width, cv.top + ((1 - v.y) / 2) * cv.height]; };
  let tx = b.x, tz = b.z, p = at(tx, tz);
  for (let k = 0; k < 8; k++) {
    const e = [x.x - p[0], x.y - p[1]];
    if (Math.hypot(e[0], e[1]) < 1.5) break;
    const a = at(tx + 6, tz), c = at(tx, tz + 6);
    const J = [[(a[0] - p[0]) / 6, (c[0] - p[0]) / 6], [(a[1] - p[1]) / 6, (c[1] - p[1]) / 6]];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (Math.abs(det) < 1e-9) break;
    tx += (e[0] * J[1][1] - e[1] * J[0][1]) / det; tz += (-e[0] * J[1][0] + e[1] * J[0][0]) / det;
    p = at(tx, tz);
  }
  at(tx, tz);
  for (let i = 0; i < 3; i++) g.frame(0.016);
  const q = at(tx, tz);
  const top = document.elementFromPoint(q[0], q[1]);
  return { x: Math.round(q[0]), y: Math.round(q[1]), onCanvas: !!top && top.tagName === 'CANVAS' };
}, { b, x });
check(`the building's middle is under where the x will be (${aim.x},${aim.y} for ${x.x},${x.y})`, Math.abs(aim.x - x.x) <= 4 && Math.abs(aim.y - x.y) <= 4 && aim.onCanvas, { aim, x });

// a real tap there
await touch('touchStart', aim.x, aim.y); await page.waitForTimeout(60); await touch('touchEnd', 0, 0);
await page.waitForTimeout(1200);
const after = await sel();
check('a tap where the sheet\'s x will appear selects the building and the sheet stays', after === b.id, { after });

// the x still closes the sheet when it is meant
if (after === b.id) {
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const e = document.querySelector('#in-close')?.getBoundingClientRect(); return e ? { x: Math.round(e.left + e.width / 2), y: Math.round(e.top + e.height / 2) } : null; });
  if (r) { await touch('touchStart', r.x, r.y); await page.waitForTimeout(60); await touch('touchEnd', 0, 0); await page.waitForTimeout(900); }
  check('pressing the x on purpose, a moment later, still closes it', (await sel()) === null, { sel: await sel() });
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
