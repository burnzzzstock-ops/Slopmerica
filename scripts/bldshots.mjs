// Neighbourhood-zoom shots of every kind of building, for judging the look
// of homes, shops, factories, apartments and offices by day and night (the
// zoom players judge the city at). Builds the same town every time, so tags
// compare. Also prints triangles and draw calls for the neighbourhood view.
//   node scripts/bldshots.mjs [tag]    (Q=ultra|high|medium|low, W=, H=)
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const tag = process.argv[2] || 'now';
const Q = process.env.Q || 'high';
const W = Number(process.env.W || 1268), H = Number(process.env.H || 595);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript((q) => { try { localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } }, Q);
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const town = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  // a flat patch near the start
  let best = null;
  for (let k = 0; k < 400; k++) {
    const x = S.x + ((k % 20) - 10) * 60, z = S.z + (Math.floor(k / 20) - 10) * 60;
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let u = -260; u <= 260 && ok; u += 65) for (let v = -200; v <= 200; v += 50) { const h = g.terrain.h(x + u, z + v); lo = Math.min(lo, h); hi = Math.max(hi, h); if (h < 3) ok = false; }
    if (ok && (!best || hi - lo < best.r)) best = { x, z, r: hi - lo };
  }
  const C = best ?? S;
  for (const c of g.communes.list) { if (Math.hypot(c.x - C.x, c.z - C.z) < 500) { c.state = 'gone'; c.group.removeFromParent(); } }
  g.syncBlockers?.();
  g.trees.cut(C.x - 300, C.z - 240, C.x + 300, C.z + 240, () => true);
  // three east-west streets, four cross streets
  for (const z of [-120, 0, 120]) d.road(C.x - 260, C.z + z, C.x + 260, C.z + z, z === 0 ? 'stroad4' : 'twoLane');
  for (const x of [-240, -80, 80, 240]) d.road(C.x + x, C.z - 200, C.x + x, C.z + 200, 'twoLane');
  // homes north, shops on the stroad, apartments and offices east, factories south-west
  for (const x of [-160, 0]) { d.zone(C.x + x, C.z - 150, 60, 'resLow'); d.zone(C.x + x, C.z - 90, 40, 'resLow'); }
  d.zone(C.x - 160, C.z - 25, 45, 'comLow'); d.zone(C.x, C.z - 25, 45, 'comLow'); d.zone(C.x - 160, C.z + 25, 45, 'comLow');
  d.zone(C.x + 160, C.z - 150, 55, 'resHigh'); d.zone(C.x + 160, C.z - 30, 40, 'comHigh');
  d.zone(C.x + 160, C.z + 60, 45, 'office'); d.zone(C.x + 160, C.z + 150, 50, 'resHigh');
  d.zone(C.x - 160, C.z + 150, 60, 'industry'); d.zone(C.x, C.z + 150, 45, 'industry'); d.zone(C.x, C.z + 60, 40, 'comLow');
  for (let i = 0; i < 90; i++) { g.sim.demand.res = g.sim.demand.com = g.sim.demand.ind = g.sim.demand.off = 90; d.run(1); }
  const lv = {};
  for (const b of g.buildings.list.values()) lv[b.zone] = (lv[b.zone] ?? []).concat(b.level);
  return { C, pop: g.sim.population, bld: g.buildings.list.size, levels: Object.fromEntries(Object.entries(lv).map(([k, v]) => [k, v.length])) };
});
console.log('town', JSON.stringify(town));
const views = {
  homes: [-80, -150, 170, 0.5, 0.78],
  shops: [-80, 0, 170, 2.6, 0.72],
  apartments: [160, -90, 190, 0.9, 0.75],
  offices: [160, 90, 190, 2.3, 0.75],
  factories: [-80, 150, 190, 3.5, 0.78],
  overview: [0, 0, 420, 0.6, 0.85],
  ...(process.env.CLOSE ? { homesClose: [-120, -150, 70, 0.5, 0.6], shopsClose: [-120, -25, 70, 2.8, 0.55] } : {}),
};
const measure = {};
for (const hour of [11, 21.5]) {
  for (const [name, [dx, dz, dist, yaw, pitch]] of Object.entries(views)) {
    if (hour > 20 && !['homes', 'shops', 'overview', 'homesClose'].includes(name)) continue;
    const info = await page.evaluate(([C, dx, dz, dist, yaw, pitch, hour]) => {
      const g = window.__game;
      document.querySelector('.hud').style.visibility = 'hidden';
      // need icons would crowd the view (this town has no utilities); judge the buildings
      g.scene.traverse((o) => { if (/problem|icon/i.test(o.name)) o.visible = false; });
      g.hour = hour;
      g.rts.setView(C.x + dx, C.z + dz, dist, yaw, pitch, true);
      for (let i = 0; i < 12; i++) g.frame(0.05, false);
      g.hour = hour;
      g.renderer.info.autoReset = false; g.renderer.info.reset();
      g.frame(0.016, true);
      const r = { tris: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls };
      g.renderer.info.autoReset = true;
      return r;
    }, [town.C, dx, dz, dist, yaw, pitch, hour]);
    const n = `${name}${hour > 20 ? '-night' : ''}`;
    measure[n] = info;
    await page.screenshot({ path: `shots/bld/${tag}-${n}.png` });
  }
}
console.log('render', JSON.stringify(measure));
console.log('errors', JSON.stringify(errs.slice(0, 3)));
await browser.close();
