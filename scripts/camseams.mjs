// Where the HUD meets the camera (found by the review of the look lane's work, docs/aaa/REVIEW_ASTRA.md).
//
// With a car's card open and the camera within 200 m, the HUD keeps the view with the car. It did so with a setView on
// every frame, and the camera's setView ends a zoom in progress, so the wheel did next to nothing. Here one wheel notch is
// turned with nothing selected and again with a car's card open: the camera must move as far both times, and the view
// must still travel with the car.
// Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/camseams.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
await page.evaluate(() => { cancelAnimationFrame(window.__game.raf); window.__game.sim.speed = 1; });
const frames = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { g.frame(1 / 60); g.ui.update(1 / 60); } }, n);

// ---- the wheel with a car's card open ----
const car = await page.evaluate(() => {
  const g = window.__game, seg = [...g.net.segs.values()].sort((a, b) => b.length - a.length)[0];
  const c = g.traffic.launch({ seg, s: seg.length * 0.05 }, { seg, s: seg.length * 0.95 }, null, null, 'sedan', 'seam test', 'the far end', true, 12, true);
  if (!c) return null;
  for (let i = 0; i < 20; i++) { g.frame(1 / 60); g.ui.update(1 / 60); }
  return { id: c.id, length: Math.round(seg.length) };
});
check(`a car to select, on a street ${car?.length} m long`, !!car, car);
if (car) {
  const notch = async (select) => {
    await page.evaluate(({ id, select }) => {
      const g = window.__game, c = g.traffic.cars.find((x) => x.id === id);
      g.select(null); g.ui.update(0.3);
      g.rts.setView(c.x, c.z, 150, 0.6, 0.85, true);
      for (let i = 0; i < 5; i++) { g.frame(1 / 60); g.ui.update(1 / 60); }
      if (select) g.select({ kind: 'car', c });
    }, { id: car.id, select });
    await frames(10);
    const before = await page.evaluate((id) => { const g = window.__game, c = g.traffic.cars.find((x) => x.id === id); return { d: g.rts.distance, tx: g.rts.target.x, tz: g.rts.target.z, cx: c.x, cz: c.z, card: !document.querySelector('.inspector').hidden }; }, car.id);
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, 120);
    await frames(60);
    const after = await page.evaluate((id) => { const g = window.__game, c = g.traffic.cars.find((x) => x.id === id); return { d: g.rts.distance, tx: g.rts.target.x, tz: g.rts.target.z, cx: c?.x, cz: c?.z }; }, car.id);
    return { before, after, ratio: after.d / before.d, viewMoved: Math.hypot(after.tx - before.tx, after.tz - before.tz), carMoved: Math.hypot(after.cx - before.cx, after.cz - before.cz) };
  };
  const free = await notch(false), held = await notch(true);
  check(`with nothing selected, a wheel notch takes the camera from ${free.before.d.toFixed(0)} m to ${free.after.d.toFixed(0)} m`, Math.abs(free.ratio - 1) > 0.05, free);
  check(`with a car's card open it goes as far (${held.before.d.toFixed(0)} m to ${held.after.d.toFixed(0)} m; ${((held.ratio - 1) * 100).toFixed(1)}% against ${((free.ratio - 1) * 100).toFixed(1)}%)`, held.before.card && Math.abs((held.ratio - 1) / (free.ratio - 1) - 1) < 0.15, held);
  check(`and the view still travels with the car (the car went ${held.carMoved.toFixed(1)} m, the view ${held.viewMoved.toFixed(1)} m)`, held.carMoved > 3 && Math.abs(held.viewMoved - held.carMoved) < Math.max(3, held.carMoved * 0.35), held);
  await page.evaluate(() => { const g = window.__game; g.select(null); g.ui.update(0.3); g.sim.speed = 0; });
}

check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
