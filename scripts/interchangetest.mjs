// Prebuilt interchanges (Roads → Interchanges): the roundabout is a connected
// ring; the diamond's cross street bridges the highway on a real overpass
// (the highway isn't split under it, the deck is raised, roads pass under it
// and can't join it mid-span, nothing zones along it, it survives a save),
// its ramps join the two, it lines up with an existing highway, and undo
// refunds it. Exits nonzero on failure. `--shots` saves views to /tmp.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__ext, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
// the drawer offers them
await page.click('button.tbtn[data-t="roads"]');
const cards = await page.evaluate(() => [...document.querySelectorAll('[data-layout]')].map((b) => b.dataset.layout));
check(`the Roads drawer offers interchanges (${cards.join(', ')})`, cards.includes('roundabout') && cards.includes('diamond'), cards);
await page.click('[data-layout="roundabout"]');
const tool = await page.evaluate(() => ({ active: window.__game.tools.active, ext: window.__game.tools.extTool, badge: window.__game.tools.placingLabel }));
check(`picking one arms the placement tool (${tool.badge})`, tool.active === 'ext' && tool.ext === 'interchange', tool);
await page.keyboard.press('Escape');
const r = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  const m = await import('/src/roads/interchanges.ts');
  const node = (x, z, r = 3) => [...g.net.nodes.values()].filter((n) => Math.hypot(n.x - x, n.z - z) < r);
  // flat open ground: the flattest spot around the centre where a layout fits
  const flat = (from, R, avoid) => {
    let best = null, bs = Infinity;
    for (let rad = 250; rad < 1600; rad += 60) for (let a = 0; a < 6.28; a += 0.26) {
      const x = S.x + Math.cos(a) * rad, z = S.z + Math.sin(a) * rad;
      if (!g.terrain.inBounds(x, z, R + 50) || avoid.some((q) => Math.hypot(q.x - x, q.z - z) < R * 2 + 80)) continue;
      if (g.communes.list.some((c) => c.state !== 'gone' && Math.hypot(c.x - x, c.z - z) < c.r + R + 60)) continue;
      if (g.net.segsNear(x - R - 30, z - R - 30, x + R + 30, z + R + 30).length) continue;
      let lo = Infinity, hi = -Infinity, wet = false;
      for (let dx = -R; dx <= R; dx += R / 4) for (let dz = -R; dz <= R; dz += R / 4) { const h = g.terrain.h(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); if (h < 0.5) wet = true; }
      if (!wet && hi - lo < bs) { bs = hi - lo; best = { x, z }; }
    }
    return best;
  };
  // roundabout 300 m east of the centre
  const money0 = g.sim.money;
  const ra = flat(S, 80, []);
  const rb = m.placeLayout(g, 'roundabout', ra, 0);
  const again = m.checkLayout(g, 'roundabout', ra, 0);
  const ring = [0, 1, 2, 3].map((k) => node(ra.x + Math.cos(k * Math.PI / 2) * 28, ra.z + Math.sin(k * Math.PI / 2) * 28).map((n) => n.segs.length));
  // diamond on open ground: brings its own highway
  const dc = flat(S, 250, [ra]);
  const why = m.checkLayout(g, 'diamond', dc, 0);
  const dm = m.placeLayout(g, 'diamond', dc, 0);
  const over = [...g.net.segs.values()].filter((s) => s.over);
  const o = over[0];
  let lift = 0; if (o) for (let i = 0; i < o.hs.length; i++) lift = Math.max(lift, o.hs[i] - o.ground[i]);
  const underJunction = node(dc.x, dc.z, 6).length;
  const hwAt = g.net.pickSeg(dc.x, dc.z, 3)?.seg.type;
  // ramps: the cross street's ends and the highway are joined
  const rampEnds = [[150, 0], [-150, 0]].map(([x, z]) => node(dc.x + x, dc.z + z, 9).map((n) => n.segs.length));
  const crossEnds = [[0, 100], [0, -100]].map(([x, z]) => node(dc.x + x, dc.z + z, 4).map((n) => n.segs.length));
  // a street under the overpass, across it: passes under, no junction
  const under = d.road(dc.x - 40, dc.z - 40, dc.x - 40, dc.z + 40, 'twoLane');
  const junctionsOnOverpass = o ? o.a !== undefined && [o.a, o.b].map((id) => g.net.nodes.get(id)?.segs.length) : null;
  const overStill = o ? g.net.segs.has(o.id) : false;
  // joining the overpass mid-span is refused
  const join = d.road(dc.x + 60, dc.z + 10, dc.x + 2, dc.z + 10, 'twoLane');
  // nothing zones along it
  g.zones.update();
  const cells = o ? [...g.zones.cells.values()].filter((c) => c.seg === o.id).length : -1;
  // it survives a save
  const rows = g.net.serialize().segs.filter((row) => row[8] === 7.5).length;
  // on an existing highway: uses it
  const hx = flat(S, 300, [ra, dc]);
  d.road(hx.x - 320, hx.z, hx.x + 320, hx.z, "highway");
  const hwBefore = [...g.net.segs.values()].filter((s) => s.type === 'highway').length;
  const why2 = m.checkLayout(g, 'diamond', { x: hx.x + 5, z: hx.z + 6 }, 1.0);
  const dm2 = m.placeLayout(g, 'diamond', { x: hx.x + 5, z: hx.z + 6 }, 1.0);
  const newHw = dm2 ? dm2.filter((s) => s.type === 'highway').length : -1;
  const over2 = [...g.net.segs.values()].filter((s) => s.over && s !== o)[0];
  const ang = over2 ? Math.abs(Math.atan2(over2.curve.p3.z - over2.curve.p0.z, over2.curve.p3.x - over2.curve.p0.x)) : -1;
  // undo refunds the last one
  const before = g.sim.money;
  const undoLabel = g.undoLabel;
  g.undo();
  const refunded = g.sim.money - before;
  const over2Gone = over2 ? !g.net.segs.has(over2.id) : false;
  return { again, why, why2, hx, rb: !!rb, ring, dm: !!dm, overs: over.length, lift: +lift.toFixed(1), underJunction, hwAt, rampEnds, crossEnds, under, junctionsOnOverpass, overStill, join, cells, rows, newHw, ang: +ang.toFixed(2), refunded, undoLabel, over2Gone, spent: money0 === Infinity ? 'sandbox' : money0 - g.sim.money, dc, ra };
});
check(`the roundabout is a connected ring (${JSON.stringify(r.ring)} roads at each ring node)`, r.rb && r.ring.every((x) => x.length === 1 && x[0] === 3), r);
check(`a second one on top of the first is refused ("${r.again.reason}")`, !r.again.ok && /in the way/.test(r.again.reason ?? ''), r.again);
check(`the diamond raises an overpass (${r.overs} overpass, ${r.lift} m above the ground)`, r.dm && r.overs === 1 && r.lift >= 6, r);
check(`the highway runs under it without a junction (${r.underJunction} nodes at the crossing, road there: ${r.hwAt})`, r.underJunction === 0 && r.hwAt === 'highway', r);
check(`ramps join the highway (${JSON.stringify(r.rampEnds)}) and the cross street (${JSON.stringify(r.crossEnds)})`, r.rampEnds.every((x) => x.length === 1 && x[0] >= 4) && r.crossEnds.every((x) => x.length === 1 && x[0] >= 4), r);
check(`a street drawn across it passes under (${r.under}; overpass still whole: ${r.overStill}, ends ${JSON.stringify(r.junctionsOnOverpass)})`, typeof r.under === 'number' && r.overStill, r);
check(`joining it mid-span is refused ("${r.join}")`, typeof r.join === 'string' && /overpass/.test(r.join), r);
check(`nothing zones along the overpass (${r.cells} lots)`, r.cells === 0, r);
check(`the overpass survives a save (${r.rows} rows carry it)`, r.rows >= 1, r);
check(`on an existing highway it uses it (${r.newHw} new highway pieces) and lines up with it (cross street at ${r.ang} rad)`, r.newHw === 0 && Math.abs(r.ang - Math.PI / 2) < 0.15, r);
check(`undo takes it back and refunds it (${r.undoLabel}: +$${r.refunded})`, r.over2Gone && /Diamond/.test(r.undoLabel ?? '') , r);
if (shots) {
  for (const [name, c, dist, pitch] of [['diamond', r.dc, 360, 0.95], ['diamond-low', r.dc, 170, 0.55], ['roundabout', r.ra, 170, 1.0]]) {
    await page.evaluate(([c, dist, pitch]) => { const g = window.__game; document.querySelector('.hud').style.visibility = 'hidden'; g.hour = 11; g.rts.setView(c.x, c.z, dist, 0.6, pitch, true); for (let i = 0; i < 4; i++) g.frame(0.05, false); g.frame(0.016, true); }, [c, dist, pitch]);
    await page.screenshot({ path: `/tmp/ix-${name}.png` });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
