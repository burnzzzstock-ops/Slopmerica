// The garbage board's rows take the camera to the site they name (the Services drawer, Garbage). It goes over the site at the
// height the camera has, 420 m at most. While the camera rides with a car, the height it has is the few metres to that car:
// asked from a ride, Show put the camera in the site's yard, under the 25 m the camera otherwise never goes below. (The same
// fault the interface session found in the emergency card's Show; scripts/camseams.mjs has that one.)
// With a landfill built and a car to ride: from 300 m up, a row keeps 300 m and lands over the site; from a ride it ends
// 420 m up over the site, no longer riding, with the site selected. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/boardshow.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
const made = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, SV = window.__services, S = g.startView();
  cancelAnimationFrame(g.raf);
  g.sim.speed = 1;
  d.unlockAll();
  let site = null;
  for (let r = 60; r < 900 && !site; r += 40) for (let k = 0; k < 16 && !site; k++) { const sp = SV.findSpot(g, 'landfill', S.x + Math.cos(k * 0.39) * r, S.z + Math.sin(k * 0.39) * r); if (!sp.reason) site = SV.place(g, 'landfill', sp.x, sp.z, sp.yaw); }
  if (site) { site.state = 'active'; site.progress = 1; }
  const seg = [...g.net.segs.values()].sort((a, b) => b.length - a.length)[0];
  const car = g.traffic.launch({ seg, s: seg.length * 0.05 }, { seg, s: seg.length * 0.95 }, null, null, 'sedan', 'board test', 'the far end', true, 12, true);
  for (let i = 0; i < 20; i++) { g.frame(1 / 60); g.ui.update(1 / 60); }
  return { site: site ? { id: site.id, x: site.x, z: site.z, label: site.label } : null, car: car ? car.id : null };
});
check(`a landfill to show (${made.site?.label}) and a car to ride with`, !!made.site && made.car !== null, made);
if (made.site && made.car !== null) {
  const frames = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { g.frame(1 / 60); g.ui.update(1 / 60); } }, n);
  await page.click('button.tbtn[data-t="ext:services"]');
  await page.click('[data-cat="garbage"]');
  await frames(3);
  const row = `.svc-board [data-goto="${made.site.id}"]`;
  check(`the garbage board lists it (${await page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').slice(0, 60) ?? 'no row', row)})`, await page.evaluate((s) => !!document.querySelector(s), row));
  const state = () => page.evaluate((site) => { const g = window.__game; return { distance: g.rts.distance, following: !!g.rts.following, off: Math.hypot(g.rts.target.x - site.x, g.rts.target.z - site.z), selected: g.selection?.kind === 'building' ? g.selection.b.id : null }; }, made.site);
  // from 300 m up, looking somewhere else
  await page.evaluate(() => { const g = window.__game, S = g.startView(); g.rts.setView(S.x + 500, S.z + 500, 300, 0.6, 0.85, true); g.select(null); });
  await frames(3);
  await page.click(row);
  await frames(180);
  const free = await state();
  check(`from 300 m up, its row takes the camera over the site at that height (${free.distance.toFixed(0)} m up, ${free.off.toFixed(0)} m from it) and selects it`, Math.abs(free.distance - 300) < 15 && free.off < 40 && free.selected === made.site.id, free);
  // from a ride
  await page.evaluate((id) => { const g = window.__game, c = g.traffic.cars.find((x) => x.id === id); g.select(null); g.rts.setView(c.x, c.z, 120, 0.6, 0.85, true); for (let i = 0; i < 3; i++) g.frame(1 / 60); g.rts.follow({ kind: 'car', id }); }, made.car);
  await frames(60);
  const riding = await state();
  await page.click(row);
  await frames(180);
  const after = await state();
  check(`from a ride (the camera ${riding.distance.toFixed(0)} m from the car), its row ends above the site, not in its yard (${after.distance.toFixed(0)} m up, ${after.off.toFixed(0)} m from it), no longer riding, the site selected`,
    riding.following && riding.distance < 60 && !after.following && after.distance > 300 && after.distance <= 425 && after.off < 40 && after.selected === made.site.id, { riding, after });
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
