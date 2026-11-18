// Where the HUD meets the camera and photo mode (both found by the review of the look lane's work, docs/aaa/REVIEW_ASTRA.md).
//
// 1. With a car's card open and the camera within 200 m, the HUD keeps the view with the car. It did so with a setView on
//    every frame, and the camera's setView ends a zoom in progress, so the wheel did next to nothing. Here one wheel notch
//    is turned with nothing selected and again with a car's card open: the camera must move as far both times, and the view
//    must still travel with the car.
// 2. Photo mode's keys are not read while an input has the keyboard, and a slider that has been dragged keeps it: Esc did
//    not leave photo mode after the Hour slider was touched. Here the slider is dragged with the mouse and Esc pressed
//    (photo mode ends); and a slider reached with the keyboard still answers the arrow keys, and Esc from it leaves too.
// 3. An emergency card's Show flies to the worst neighbourhood at the height the camera has, 460 m at most. While the camera
//    rides with a car that height is the few metres to the car, so Show put the camera in the street. Here Show is asked
//    for while following: the camera must end well above the neighbourhood, and at the height it had when not following.
// 4. The Services drawer's garbage board does the same with a site picked from its list: from a ride it ended in the street
//    beside the landfill. Here a landfill is placed, the board opened while riding with a car, and its row pressed.
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

// ---- 1. the wheel with a car's card open ----
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

// ---- 2. Esc after a photo slider has been touched ----
{
  const photo = () => page.evaluate(() => ({ on: window.__game.photo.active, bar: !document.querySelector('.photo-bar').hidden, focus: document.activeElement?.dataset?.pbr ?? document.activeElement?.tagName ?? null, hour: window.__game.photo.hour }));
  await page.evaluate(() => window.__game.photo.enter());
  await page.waitForTimeout(200);
  await frames(3);
  await page.click('.photo-bar [data-pb="adjust"]');
  const box = await page.evaluate(() => { const r = document.querySelector('[data-pbr="hour"]').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  const h0 = (await photo()).hour;
  await page.mouse.move(box.x + box.w * 0.3, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.7, box.y, { steps: 6 });
  await page.mouse.up();
  let p = await photo();
  check(`dragging the Hour slider sets the hour (${h0} to ${p.hour}) and gives the keyboard back (focus: ${p.focus})`, p.on && p.hour !== h0 && p.focus !== 'hour', p);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await frames(3);
  p = await photo();
  check(`Esc after the slider was dragged leaves photo mode (photo mode ${p.on ? 'on' : 'off'})`, !p.on && !p.bar, p);

  // a slider reached with the keyboard keeps it for the arrows, and Esc from it leaves
  await page.evaluate(() => window.__game.photo.enter());
  await page.waitForTimeout(200);
  await frames(3);
  await page.click('.photo-bar [data-pb="adjust"]');
  await page.evaluate(() => document.querySelector('[data-pbr="hour"]').focus());
  const h1 = (await photo()).hour;
  await page.keyboard.press('ArrowRight');
  p = await photo();
  check(`a slider that has the keyboard answers the arrow keys (hour ${h1} to ${p.hour}) and keeps it (focus: ${p.focus})`, p.on && p.hour > h1 && p.focus === 'hour', p);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await frames(3);
  p = await photo();
  check(`and Esc from it leaves photo mode (photo mode ${p.on ? 'on' : 'off'})`, !p.on && !p.bar, p);
  const menu = await page.evaluate(() => !!document.querySelector('.pause'));
  check('that Esc did not also open the pause menu', !menu);
}

// ---- 3. Show, from an emergency card, while riding with a car ----
{
  const r = await page.evaluate(async () => {
    const g = window.__game, c = g.traffic.cars.find((x) => !x.parked && x.posed) ?? null, S = g.startView();
    const run = (n) => { for (let i = 0; i < n; i++) { g.frame(1 / 60); g.ui.update(1 / 60); } };
    const e = { hot: [{ x: S.x + 300, z: S.z + 200 }], needs: [] };
    g.sim.speed = 1;
    // not following, at 300 m: Show keeps that height
    g.rts.setView(S.x, S.z, 300, 0.6, 0.85, true); run(3);
    g.ui.showWorst(e); run(180);
    const free = g.rts.distance;
    if (!c) return { free, err: 'no car to ride with' };
    g.rts.setView(c.x, c.z, 120, 0.6, 0.85, true); run(3);
    g.rts.follow({ kind: 'car', id: c.id }); run(60);
    const riding = { following: !!g.rts.following, distance: g.rts.distance };
    g.ui.showWorst(e); run(180);
    return { free, riding, after: g.rts.distance, stillFollowing: !!g.rts.following, at: Math.hypot(g.rts.target.x - e.hot[0].x, g.rts.target.z - e.hot[0].z) };
  });
  check(`Show with the camera at 300 m keeps that height (${r.free?.toFixed(0)} m)`, Math.abs(r.free - 300) < 15, r);
  if (r.err) console.log(`(${r.err}: the rest of this check is skipped)`);
  else check(`Show while riding with a car (the camera ${r.riding.distance.toFixed(0)} m from it) ends above the neighbourhood, not in its street (${r.after.toFixed(0)} m up, ${r.at.toFixed(0)} m from the spot)`, r.riding.following && r.riding.distance < 60 && !r.stillFollowing && r.after > 300 && r.at < 40, r);
}

// ---- 4. a site picked from the garbage board, while riding with a car ----
{
  const made = await page.evaluate(() => {
    const g = window.__game, SV = window.__services, S = g.startView();
    let b = null;
    for (const r of [300, 420, 560, 700]) { for (let a = 0; a < 8 && !b; a++) { const sp = SV.findSpot(g, 'landfill', S.x + Math.cos(a * 0.785) * r, S.z + Math.sin(a * 0.785) * r); if (sp?.ok !== false) b = SV.place(g, 'landfill', sp.x, sp.z, sp.yaw); } if (b) break; }
    if (!b) return { err: 'no landfill could be placed' };
    // a car of its own for the ride (the first part's has arrived by now)
    const seg = [...g.net.segs.values()].sort((p, q) => q.length - p.length)[0];
    const c = g.traffic.launch({ seg, s: seg.length * 0.05 }, { seg, s: seg.length * 0.95 }, null, null, 'sedan', 'seam test', 'the far end', true, 12, true);
    if (!c) return { err: 'no car to ride with' };
    g.sim.speed = 1;
    for (let i = 0; i < 20; i++) { g.frame(1 / 60); g.ui.update(1 / 60); }
    g.rts.setView(c.x, c.z, 120, 0.6, 0.85, true);
    g.rts.follow({ kind: 'car', id: c.id });
    for (let i = 0; i < 60; i++) { g.frame(1 / 60); g.ui.update(1 / 60); }
    const riding = { following: !!g.rts.following, distance: g.rts.distance };
    window.__ext.panels.find((p) => p.id === 'services')?.focus?.(g, 'garbage');
    g.ui.openPanel('ext:services');
    g.ui.update(0.3);
    return { id: b.id, x: b.x, z: b.z, riding, stillRiding: !!g.rts.following, row: !!document.querySelector(`.svc-board [data-goto="${b.id}"]`) };
  });
  if (made.err) check(`a landfill on the garbage board and a car to ride with (${made.err})`, false, made);
  else {
    check(`the garbage board lists the landfill while the camera rides with a car (${made.riding.distance.toFixed(0)} m from it)`, made.row && made.stillRiding && made.riding.distance < 60, made);
    await page.click(`.svc-board [data-goto="${made.id}"]`);
    const r = await page.evaluate(({ x, z }) => { const g = window.__game; for (let i = 0; i < 200; i++) { g.frame(1 / 60); g.ui.update(1 / 60); } return { d: g.rts.distance, off: Math.hypot(g.rts.target.x - x, g.rts.target.z - z), following: !!g.rts.following, card: !document.querySelector('.inspector').hidden }; }, made);
    check(`its row takes the camera above the site, not into the street beside it (${r.d.toFixed(0)} m up, ${r.off.toFixed(0)} m from it), and opens its card`, !r.following && r.d > 300 && r.off < 40 && r.card, r);
  }
}

check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
