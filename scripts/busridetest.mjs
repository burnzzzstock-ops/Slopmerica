// Follow on a bus's card rides the bus, not the car of one leg. A new car drives each leg of a line, so Follow on the
// car let go at the first stop. On the desktop and on a phone, with a depot and one bus on a line of three stops
// (the street grid of scripts/busfollow.mjs): the card of the bus on the road is headed by its line; Follow binds
// the camera to the bus (game.fields.busOf, a target of kind 'bus'); the pill names the line and says where on it
// the bus is ("next stop 1 of 3", then "at stop 1 of 3", then "next stop 2 of 3"); the camera is still with the bus
// when the next leg's car has set off, on every frame in between; on the desktop the open card has moved to that
// car; a tap on the pill lets go. Exits nonzero on failure.
import { launch } from './lib/browser.mjs';
import { seededInit, seededRandom, testSeed } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const browser = await launch();
for (const kind of ['desk', 'phone']) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(seededInit, { seed: SEED, rng: seededRandom.toString() });
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=florida&mode=sandbox&seed=${SEED}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game?.transit && window.__dbg, null, { timeout: 180000 });
  const line = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, t = g.transit;
    cancelAnimationFrame(g.raf);
    for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
    g.syncBlockers();
    const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z);
    for (let k = -3; k <= 3; k++) { d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'); d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane'); }
    t.placeDepot(cx + 330, cz + 25);
    const depot = [...g.buildings.list.values()].find((b) => b.kind === 'busDepot');
    if (depot) { depot.state = 'active'; depot.progress = 1; }
    for (const [x, z] of [[cx - 240, cz], [cx - 60, cz], [cx + 120, cz]]) t.addDraftPoint(x, z);
    t.finishDraft();
    const line = [...t.lines.values()][0];
    if (line) line.buses = 1;
    g.sim.speed = 1;
    g.rts.setView(cx, cz, 300, 0.6, 0.9, true);
    return line ? line.name : null;
  });
  // frames at 30 a second with the HUD kept up to date, until the bus is where the test wants it; on the way, the frames
  // on which the camera was not with the bus it was given
  const ride = (frames, until) => page.evaluate(async ({ frames, until }) => {
    const g = window.__game, f = g.fields, R = (window.__r ??= { letGo: 0, n: 0 });
    for (let i = 0; i < frames; i++) {
      g.frame(1 / 30, false); g.ui.update(1 / 30);
      const bus = f.buses()[0] ?? null;
      if (window.__bus !== undefined) { R.n++; const who = g.rts.following; if (!who || who.kind !== 'bus' || who.id !== window.__bus) R.letGo++; }
      if (until === 'onRoad' && bus && bus.carId !== null) break;
      if (until === 'atStop' && bus && bus.atStop !== null) break;
      if (until === 'nextLeg' && bus && bus.carId !== null && bus.carId !== window.__car) break;
      if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
    }
    return R;
  }, { frames, until });
  const state = () => page.evaluate(() => {
    const g = window.__game, pill = document.querySelector('.follow-pill'), i = document.querySelector('.inspector'), bus = g.fields.buses()[0] ?? null;
    const span = pill?.querySelector('span');
    return { following: g.rts.following ? `${g.rts.following.kind}:${g.rts.following.id}` : null, pill: pill && !pill.hidden ? span.textContent.replace(/\s+/g, ' ').trim() : null, cut: !!span && !pill.hidden && (span.scrollWidth > span.clientWidth + 1 || [...span.querySelectorAll('.fp-where')].some((w) => w.scrollWidth > w.clientWidth + 1)), pillW: pill && !pill.hidden ? Math.round(pill.getBoundingClientRect().width) : 0, widths: span && !pill.hidden ? [span.scrollWidth, span.clientWidth, ...[...span.querySelectorAll('.fp-where')].flatMap((w) => [w.scrollWidth, w.clientWidth])] : null,
      card: i.hidden ? null : { head: i.querySelector('h3')?.textContent, button: i.querySelector('#in-follow')?.textContent.trim() ?? null }, selected: g.selection?.kind === 'car' ? g.selection.c.id : g.selection?.kind ?? null, bus };
  });

  await ride(1800, 'onRoad');
  const first = await page.evaluate(() => { const g = window.__game, bus = g.fields.buses()[0]; if (!bus || bus.carId === null) return null; const c = g.traffic.cars.find((x) => x.id === bus.carId); g.tools.set('inspect'); g.select({ kind: 'car', c }); window.__car = bus.carId; return { bus: bus.id, car: bus.carId }; });
  check(`${kind}: a bus of "${line}" is on the road`, !!line && !!first, first);
  if (!first) { await ctx.close(); continue; }
  await ride(4, 'none');
  let s = await state();
  check(`${kind}: its card is headed by the line and offers Follow ("${s.card?.head}", "${s.card?.button}")`, s.card?.head === line && /Follow$/.test(s.card?.button ?? ''), s);
  if (phone) await page.waitForTimeout(450);
  await (phone ? page.tap('#in-follow') : page.click('#in-follow'));
  await page.evaluate((id) => { window.__bus = id; }, first.bus);
  await ride(6, 'none');
  s = await state();
  check(`${kind}: Follow rides the bus, not this leg's car (following ${s.following})`, s.following === `bus:${first.bus}`, s);
  check(`${kind}: the pill names the line and where the bus is on it ("${s.pill}"), none of it cut off (${s.pillW} px wide)`, (s.pill ?? '').includes(`Following ${line}`) && /next stop 1 of 3/.test(s.pill ?? '') && !s.cut && s.pillW <= (phone ? 390 : 1000), s);
  if (phone) check(`${kind}: the card has stepped aside for the ride`, s.card === null, s);
  else check(`${kind}: the card stays, its button now Stop following`, /Stop following/.test(s.card?.button ?? ''), s);

  await ride(4000, 'atStop');
  s = await state();
  check(`${kind}: at the first stop the camera is still with the bus and the pill says so ("${s.pill}")`, s.following === `bus:${first.bus}` && s.bus?.atStop === 1 && /at stop 1 of 3/.test(s.pill ?? ''), s);
  const r = await ride(4000, 'nextLeg');
  await ride(4, 'none');
  s = await state();
  check(`${kind}: another car has taken the bus on (car ${s.bus?.carId}, it was ${first.car}) and the camera never let go (${r.letGo} of ${r.n} frames without it)`, s.bus?.carId !== null && s.bus?.carId !== first.car && r.letGo === 0 && s.following === `bus:${first.bus}`, { ...s, r });
  check(`${kind}: the pill has moved on ("${s.pill}")`, /next stop 2 of 3/.test(s.pill ?? ''), s);
  if (!phone) check(`${kind}: the open card has moved to the car driving the bus now (card of car ${s.selected}, "${s.card?.head}")`, s.selected === s.bus?.carId && s.card?.head === line && /Stop following/.test(s.card?.button ?? ''), s);
  await (phone ? page.tap('.follow-pill') : page.click('.follow-pill'));
  await ride(4, 'none');
  s = await state();
  check(`${kind}: a tap on the pill lets go`, s.following === null && s.pill === null, s);
  check(`${kind}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
