// ONE MORE LANE keeps the street's buildings (slid back off the wider road),
// nothing ends up on pavement or overlapping, a service survives a nearby
// road being bulldozed, and a road split by a new junction keeps its buildings.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch {} });
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:5173') + '/#skip&map=florida&mode=sandbox', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.tools; cancelAnimationFrame(g.raf);
  const S = g.startView(), cx = S.x, cz = S.z + 260;
  d.road(cx - 200, cz, cx + 200, cz, 'twoLane');
  d.zone(cx, cz + 30, 120, 'resLow'); d.zone(cx, cz - 30, 120, 'resLow');
  d.run(60);
  const count = () => [...g.buildings.list.values()].filter((b) => b.zone !== 'service').length;
  const out = { before: count(), pop0: g.sim.population };
  const pick = g.net.pickSeg(cx, cz, 10);
  t.set('upgrade'); t.upgradeAt(g.rts.target.clone().set(cx, 0, cz), true); t.set('inspect');
  out.type0 = pick.seg.type;
  d.run(0.3);
  out.afterUpgrade = count(); out.type = g.net.segs.get(pick.seg.id)?.type; out.pop1 = g.sim.population;
  // no building may sit on pavement or on another building
  const B = g.buildings; let onRoad = 0, overlap = 0;
  for (const b of B.list.values()) {
    const r = b.hw + b.hd + 40;
    if (B.roadOn && B.roadOn(b)) onRoad++;
    for (const o of B.near(b.x, b.z, b.hw + b.hd + 30)) if (o !== b && o.id > b.id && (B.corners(b).some((p) => B.contains(o, p.x, p.z, -0.3)) || B.contains(o, b.x, b.z))) overlap++;
  }
  out.onRoad = onRoad; out.overlap = overlap;
  d.view(cx, cz, 170, 0.6, 0.9);
  // a service next to the road, then bulldoze a crossing street near it
  const SV = window.__services;
  d.road(cx + 120, cz - 150, cx + 120, cz + 150, 'twoLane');
  let svc = null;
  for (let r = 40; r < 200 && !svc; r += 8) for (const [x, z] of [[cx + 120 + r, cz + 60], [cx + 120 - r, cz + 60], [cx + 120 + r, cz - 60]]) if (!svc && SV.canPlace(g, 'fireStation', x, z).ok) svc = SV.place(g, 'fireStation', x, z);
  out.svcPlaced = !!svc;
  const before2 = g.buildings.list.has(svc?.id);
  const cross = g.net.pickSeg(cx + 120, cz + 100, 10);
  if (cross) g.net.removeSeg(cross.seg.id);
  out.svcSurvivesNearbyRoadRemoval = before2 && g.buildings.list.has(svc.id);
  // a side street teeing into the middle splits the road: its buildings stay
  const zoned = () => [...g.buildings.list.values()].filter((b) => b.zone !== 'service' && b.zone !== 'landmark').length;
  const bz = zoned();
  d.road(cx - 60, cz + 150, cx - 60, cz, 'twoLane');
  d.run(0.3);
  out.beforeSplit = bz; out.afterSplit = zoned();
  out.danglingSeg = [...g.buildings.list.values()].filter((b) => b.zone !== 'service' && b.zone !== 'landmark' && !g.net.segs.has(b.seg)).length;
  return out;
});
console.log(JSON.stringify(r));
const ok = r.afterUpgrade >= r.before - Math.ceil(r.before * 0.2) && r.onRoad === 0 && r.overlap === 0 && r.svcSurvivesNearbyRoadRemoval
  && r.afterSplit >= r.beforeSplit - 2 && r.danglingSeg === 0; // at most the lots the new street actually crosses
console.log(ok ? 'OK' : 'FAIL');
await page.screenshot({ path: 'shots/widen.png' });
await browser.close();
