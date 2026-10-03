// The field of view slider in Settings runs from 35 to 110 degrees (docs/HANDOFF_ROUND8_SONNET.md, item 2). At each of 35, 50, 75 and 110 this
// checks, on the phone (390x844, touch) or the desktop (1280x720): the slider sets the camera and its label says what the number is (it is the
// camera's vertical angle, so the label also says how many degrees that is across this screen); the Settings panel still fits and its sliders
// are usable; tapping a building where it is on screen selects that building (the picking ray follows the field of view); and, on the desktop,
// a mouse at the screen edge still scrolls the map. It also saves a picture of the town at each angle (shots/r8/fov/) and prints the draw
// calls, so the price of a wide view is on record.
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5173 node scripts/fovtest.mjs [phone|desk]      exits 1 on failure
//   env: ANGLES=35,50,75,110   MAP=appalachia   QUALITY=low|medium|high|ultra (desktop; the phone is always the touch default)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { ARGS, EXE } from './refblock.mjs';

const kind = process.argv[2] || 'phone';
const phone = kind === 'phone';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const angles = (process.env.ANGLES || '35,50,75,110').split(',').map(Number);
const map = process.env.MAP || 'appalachia';
mkdirSync('shots/r8/fov', { recursive: true });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const info = (s) => console.log('info', s);
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const ctx = await browser.newContext(phone
  ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((q) => { try { if (q) localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.removeItem('slopmerica.fov'); } catch { /* */ } }, phone ? null : process.env.QUALITY || 'high');
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const sleep = (ms) => page.waitForTimeout(ms);
const press = async (x, y) => { if (phone) { await touch('touchStart', x, y); await sleep(60); await touch('touchEnd', 0, 0); } else await page.mouse.click(x, y); await sleep(500); };
const centre = async (sel) => { const el = await page.waitForSelector(sel, { state: 'attached', timeout: 120000 }); await el.scrollIntoViewIfNeeded().catch(() => {}); const b = await el.boundingBox(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; };
const tapSel = async (sel) => { const c = await centre(sel); await press(c.x, c.y); };

await page.goto(`${base}/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 420000 });
await sleep(1500);
if (await page.$('#ob-go')) await tapSel('#ob-go');
// a little town to look at
const S = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, s = g.startView();
  d.road(s.x - 200, s.z, s.x + 200, s.z, 'twoLane'); d.road(s.x, s.z - 160, s.x, s.z + 160, 'twoLane');
  d.zone(s.x - 90, s.z + 45, 50, 'resLow'); d.zone(s.x + 90, s.z + 45, 50, 'resLow'); d.zone(s.x - 60, s.z - 55, 45, 'comLow'); d.zone(s.x + 100, s.z - 55, 40, 'resLow');
  d.run(24);
  return { x: s.x, z: s.z, buildings: g.buildings.list.size };
});
info(`${kind}: ${S.buildings} buildings to pick from`);

// Settings is a toolbar button on the desktop and an item under More on the phone
const openSettings = async () => {
  if (await page.isVisible('#fov-range')) return;
  if (phone) { if (!(await page.$('button.more-btn[data-more="help"]'))) await tapSel('button.tbtn[data-t="more"]'); await tapSel('button.more-btn[data-more="help"]'); }
  else await tapSel('button.tbtn[data-t="help"]');
  await sleep(700);
};
const closeSettings = async () => { if (await page.isVisible('#fov-range')) { await tapSel('button.tbtn[data-t="inspect"]'); await sleep(400); } };

for (const fov of angles) {
  await openSettings();
  // ---- the slider, its label, the panel
  await page.fill('#fov-range', String(fov));
  await sleep(500);
  const s = await page.evaluate(() => {
    const W = innerWidth, g = window.__game, out = { fov: Math.round(g.camera.fov), aspect: +g.camera.aspect.toFixed(3), label: document.querySelector('#fov-v')?.textContent ?? '', labelBox: document.querySelector('.fov-ctl[for="fov-range"]')?.textContent?.replace(/\s+/g, ' ') ?? '', spill: [], small: [] };
    for (const sel of ['#fov-range', '#music-range', '#sound-range']) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect(), box = (el.closest('label') ?? el).getBoundingClientRect();
      if (r.left < -1 || r.right > W + 1 || box.right > W + 1) out.spill.push(`${sel} ${Math.round(box.left)}..${Math.round(box.right)} of ${W}`);
      if (Math.max(r.height, box.height) < 44) out.small.push(`${sel} ${Math.round(r.width)}x${Math.round(Math.max(r.height, box.height))}`);
    }
    const sp = document.querySelector('.subpanel'); out.panelOver = sp ? sp.scrollWidth - sp.clientWidth : 0;
    return out;
  });
  const across = Math.round((2 * Math.atan(Math.tan((fov * Math.PI) / 360) * s.aspect) * 180) / Math.PI);
  check(`${fov}: the slider sets the camera (${s.fov})`, s.fov === fov);
  check(`${fov}: the label says what the number is (${s.labelBox})`, new RegExp(`${fov}°`).test(s.labelBox) && /tall|up.?down|vertical/i.test(s.labelBox) && new RegExp(`${across}°`).test(s.labelBox), { label: s.labelBox, across });
  if (phone) {
    check(`${fov}: Settings fits at 390 px (no control past the sides, panel does not scroll sideways)`, s.spill.length === 0 && s.panelOver <= 1, s);
    check(`${fov}: the sliders are at least 44 px tall to put a finger on`, s.small.length === 0, s.small);
  }
  if (fov === angles[0] || fov === angles[angles.length - 1]) await page.screenshot({ path: `shots/r8/fov/${kind}-${fov}-settings.png`, timeout: 420000 });
  await closeSettings();

  // ---- the world at this angle: pictures, draw calls, picking
  // Targets: the nearest few buildings with the camera pulled back until they fit (a narrow angle needs more room), and one building pushed out to
  // either side of the screen (70% of the way to the edge: that is where a wrong field of view in the picking would show). Each target is a camera
  // (view) and a building; the page works out where on the screen that building's middle is, just before the tap.
  const picks = await page.evaluate(({ x, z }) => {
    const g = window.__game, V = g.camera.position.constructor;
    g.select(null);
    const act = [...g.buildings.list.values()].filter((b) => b.state === 'active').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    const set = act.slice(0, 4);
    if (!set.length) return { calls: 0, targets: [], n: 0 };
    const cv = g.renderer.domElement.getBoundingClientRect();
    const where = (b) => {
      // (the middle of the building's body, not its foot: cars and people at the foot are picked before a building)
      const v = new V(b.x, g.terrain.h(b.x, b.z) + 0.5 * (b.model?.height ?? 6), b.z).project(g.camera);
      const sx = cv.left + ((v.x + 1) / 2) * cv.width, sy = cv.top + ((1 - v.y) / 2) * cv.height;
      const top = document.elementFromPoint(sx, sy);
      const ok = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.7 && !!top && top.tagName === 'CANVAS';   // (under the HUD is not a fair target)
      return { ok, x: Math.round(sx), y: Math.round(sy), edge: +Math.max(Math.abs(v.x), Math.abs(v.y)).toFixed(2), ndcX: v.x };
    };
    const look = (vx, vz, dist) => { window.__dbg.view(vx, vz, dist, 0.6, 0.8); for (let i = 0; i < 3; i++) g.frame(0.016); };
    const cx = set.reduce((t, b) => t + b.x, 0) / set.length, cz = set.reduce((t, b) => t + b.z, 0) / set.length;
    const targets = [];
    let calls = 0;
    for (let dist = 70; dist <= 1500; dist *= 1.4) {
      look(cx, cz, dist);
      calls = g.renderer.info.render.calls;
      const here = set.map((b) => ({ b, w: where(b) })).filter((t) => t.w.ok);
      if (here.length >= Math.min(set.length, 3)) { for (const t of here.slice(0, 3)) targets.push({ id: t.b.id, label: t.b.label ?? t.b.zone, view: [cx, cz, dist] }); break; }
    }
    const b0 = set[0];
    for (const side of [0.7, -0.7]) {
      look(b0.x, b0.z, 60);
      const right = new V(1, 0, 0).applyQuaternion(g.camera.quaternion);
      const d = g.camera.position.distanceTo(new V(b0.x, g.terrain.h(b0.x, b0.z), b0.z));
      const halfW = d * Math.tan((g.camera.fov * Math.PI) / 360) * g.camera.aspect;
      const vx = b0.x - right.x * side * halfW, vz = b0.z - right.z * side * halfW;
      look(vx, vz, 60);
      if (where(b0).ok) targets.push({ id: b0.id, label: b0.label ?? b0.zone, view: [vx, vz, 60] });
    }
    look(cx, cz, targets[0]?.view[2] ?? 200);
    return { calls, targets, n: set.length };
  }, S);
  info(`${fov}: ${picks.calls} draw calls at the town view, ${picks.targets.length} targets to tap (${picks.n} nearest buildings)`);
  // the need bubbles (src/sim/serviceIcons.ts) are sized in the world: 3% of their distance, so their size on the screen is 0.03 x H / (2 tan(fov/2)) CSS px.
  // That shrinks with the angle: at 110 a bubble is a third of what it is at 50. (A fix belongs in that file, which the simulation session owns:
  // scale the size by tan(fov/2) / tan(25 degrees) in the shader and in pick(). STRICT_ICONS=1 makes the check below count.)
  const H = page.viewportSize().height, bubblePx = (f) => 0.03 * H / (2 * Math.tan((f * Math.PI) / 360));
  const ratio = bubblePx(fov) / bubblePx(50);
  info(`${fov}: a need bubble is ${bubblePx(fov).toFixed(1)} CSS px across on this screen (${(ratio * 100).toFixed(0)}% of its size at 50)`);
  if (process.env.STRICT_ICONS) check(`${fov}: a need bubble is about as big on the screen as at 50 degrees (${(ratio * 100).toFixed(0)}%)`, ratio > 0.8 && ratio < 1.25, { ratio });
  await sleep(600);
  await page.screenshot({ path: `shots/r8/fov/${kind}-${fov}-world.png`, timeout: 420000 });
  let hit = 0, tried = 0, farthest = 0;
  const got = [];
  for (const t of picks.targets) {
    await page.evaluate(() => window.__game.select(null));
    // the inspector sheet of the last tap is on its way out (the HUD redraws a few times a second); a tap landing on it is not a tap on the map
    await page.waitForFunction(() => { const i = document.querySelector('.inspector'); return !i || i.hidden || i.offsetParent === null; }, null, { timeout: 30000 }).catch(() => {});
    const at = await page.evaluate(({ id, view }) => {
      const g = window.__game, V = g.camera.position.constructor, b = g.buildings.list.get(id);
      window.__dbg.view(view[0], view[1], view[2], 0.6, 0.8);
      for (let i = 0; i < 3; i++) g.frame(0.016);
      const cv = g.renderer.domElement.getBoundingClientRect();
      const v = new V(b.x, g.terrain.h(b.x, b.z) + 0.5 * (b.model?.height ?? 6), b.z).project(g.camera);
      return { x: Math.round(cv.left + ((v.x + 1) / 2) * cv.width), y: Math.round(cv.top + ((1 - v.y) / 2) * cv.height), edge: +Math.max(Math.abs(v.x), Math.abs(v.y)).toFixed(2) };
    }, t);
    await press(at.x, at.y);
    const sel = await page.evaluate(() => { const s = window.__game.selection; return s ? (s.kind === 'building' ? s.b.id : s.kind) : null; });
    tried++; farthest = Math.max(farthest, at.edge);
    if (sel === t.id) hit++; else got.push({ wanted: t.id, got: sel, at: [at.x, at.y], edge: at.edge });
    await page.evaluate(() => window.__game.select(null));
  }
  if (got.length) info(`${fov}: missed ${JSON.stringify(got)}`);
  check(`${fov}: tapping a building where it is on screen selects it (${hit} of ${tried}, out to ${farthest} of the way to the screen's edge)`, tried > 0 && hit >= Math.ceil(tried * 0.75), { hit, tried, missed: got });

  // ---- edge scrolling (a mouse: desktop only)
  if (!phone) {
    const t0 = await page.evaluate(() => ({ x: window.__game.rts.target.x, z: window.__game.rts.target.z, edge: window.__game.rts.edgeScroll }));
    await page.mouse.move(1278, 360); await sleep(300);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__game.frame(0.1, false)); }
    await page.mouse.move(640, 360);
    const t1 = await page.evaluate(() => ({ x: window.__game.rts.target.x, z: window.__game.rts.target.z }));
    check(`${fov}: a mouse against the right edge scrolls the map (${Math.round(Math.hypot(t1.x - t0.x, t1.z - t0.z))} m)`, !t0.edge || Math.hypot(t1.x - t0.x, t1.z - t0.z) > 1, { t0, t1 });
  }
}
// leave it at the default
await openSettings(); await page.fill('#fov-range', '50'); await closeSettings();
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
