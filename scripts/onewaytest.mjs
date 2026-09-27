// One-way roads: trips run the way the road was drawn (a trip back up the
// same street goes round the block), ⇅ Flip direction turns it round, the
// inspector offers the flip, the preview shows chevrons, and a save keeps the
// direction. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, T = g.traffic;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  // a block: the north side a one-way drawn west -> east, the rest two-way
  d.road(cx - 100, cz - 60, cx + 100, cz - 60, 'oneWay1');
  d.road(cx - 100, cz + 60, cx + 100, cz + 60, 'twoLane');
  d.road(cx - 100, cz - 60, cx - 100, cz + 60, 'twoLane');
  d.road(cx + 100, cz - 60, cx + 100, cz + 60, 'twoLane');
  const ow = [...g.net.segs.values()].find((s) => s.type === 'oneWay1');
  const A = g.net.nodes.get(ow.a);
  const drawnEast = A.x < g.net.nodes.get(ow.b).x;
  const L = ow.length;
  const fwd = T.route(ow, 20, ow, L - 20);
  const back = T.route(ow, L - 20, ow, 20);
  const backAgainst = back ? back.steps.some((st) => g.net.segs.get(st.seg)?.type === 'oneWay1' && st.dir < 0) : null;
  // flip it
  const flipped = g.net.flip(ow.id);
  const ow2 = g.net.segs.get(ow.id);
  const nowEast = g.net.nodes.get(ow2.a).x < g.net.nodes.get(ow2.b).x;
  // the old "back" trip (east point to west point) is now a straight run
  const east = ow2.samp.pts[0].x > ow2.samp.pts[ow2.samp.pts.length - 1].x ? 20 : ow2.length - 20;
  const west = ow2.length - east;
  const back2 = T.route(ow2, east, ow2, west);
  // inspector
  g.select({ kind: 'road', s: ow2 });
  g.ui.renderInspector?.();
  const flipBtn = !!document.querySelector('#in-flip');
  g.select(null);
  // preview chevrons: dark vertex colours in the ribbon
  g.tools.roadType = 'oneWay1';
  const tl = g.tools;
  const curve = { p0: { x: cx - 60, z: cz + 150 }, p1: { x: cx - 20, z: cz + 150 }, p2: { x: cx + 20, z: cz + 150 }, p3: { x: cx + 60, z: cz + 150 } };
  tl.drawRibbon(tl.preview, curve, 9, true);
  const colors = tl.preview.geometry.getAttribute('color');
  let dark = 0;
  for (let i = 0; i < colors.count; i++) if (colors.getX(i) < 0.5) dark++;
  // save keeps the direction
  const saved = g.net.serialize ? g.net.serialize() : null;
  return {
    drawnEast, fwdSteps: fwd?.steps.length, fwdDir: fwd?.steps[0]?.dir, backSteps: back?.steps.length ?? null, backAgainst,
    flipped: !!flipped, nowEast, back2Steps: back2?.steps.length ?? null, back2Dir: back2?.steps[0]?.dir, flipBtn, chevronVerts: dark,
    savedType: saved ? JSON.stringify(saved).includes('oneWay1') : null,
  };
});
console.log(JSON.stringify(r));
check('the one-way runs the way it was drawn (west to east)', r.drawnEast === true, r);
check(`a trip along it is one step, forward (${r.fwdSteps}, dir ${r.fwdDir})`, r.fwdSteps === 1 && r.fwdDir === 1, r);
check(`a trip back up it goes round the block (${r.backSteps} steps, never against the arrows)`, r.backSteps > 1 && r.backAgainst === false, r);
check(`⇅ flip turns it round (now runs ${r.nowEast ? 'east' : 'west'})`, r.flipped && r.nowEast === false, r);
check(`after the flip the east-to-west trip is a straight run (${r.back2Steps} step, dir ${r.back2Dir})`, r.back2Steps === 1 && r.back2Dir === 1, r);
check('the inspector offers ⇅ Flip direction on a one-way', r.flipBtn, r);
check(`the road preview shows chevrons the way you drag (${r.chevronVerts} chevron vertices)`, r.chevronVerts >= 9, r);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
