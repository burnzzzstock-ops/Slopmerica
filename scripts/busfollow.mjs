// A bus can be followed across its stops. A new car drives each leg of a bus line (the one before it ends at the stop), so a
// camera on the car lets go at the first stop. A follow target of kind 'bus' (game.fields.busOf, bus, buses; poseOf) lasts for
// as long as the bus is in service. On a small street grid with a depot and one bus on a line of three stops: ride the bus
// round its loop and check that the camera never lets go, the bus is never lost and never jumps, its card says which stop it
// waits at, and that the camera does let go once the line is deleted and the bus is home. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/busfollow.mjs      (SEED=n for another county's dice)
import { launch } from './lib/browser.mjs';
import { seededInit, seededRandom, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEED = testSeed();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(seededInit, { seed: SEED, rng: seededRandom.toString() });
// (a test town with no services has service emergencies; they must not slow the clock the buses run on)
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=sandbox&seed=${SEED}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.transit && window.__dbg, null, { timeout: 180000 });

const built = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.transit;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z);
  for (let k = -3; k <= 3; k++) {
    d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane');
    d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane');
  }
  const depotPlaced = t.placeDepot(cx + 330, cz + 25);
  const depot = [...g.buildings.list.values()].find((b) => b.kind === 'busDepot');
  if (depot) { depot.state = 'active'; depot.progress = 1; }
  const stops = [[cx - 240, cz], [cx - 60, cz], [cx + 120, cz]].map(([x, z]) => t.addDraftPoint(x, z));
  const finished = t.finishDraft();
  const line = [...t.lines.values()][0];
  if (line) line.buses = 1;
  g.sim.speed = 1;
  g.rts.setView(cx, cz, 300, 0.6, 0.9, true);
  return { depotPlaced, stops, finished, line: line ? { id: line.id, name: line.name, stops: line.stopIds.length } : null };
});
check(`a depot and a line of three stops with one bus ("${built.line?.name}")`, !!built.depotPlaced && built.stops.every(Boolean) && !!built.finished && built.line?.stops === 3, built);

// frames at 30 a second, the simulation at normal speed, nothing drawn; after each, what the camera and the bus are doing
const ride = (frames, until) => page.evaluate(async ({ frames, until }) => {
  const g = window.__game, f = g.fields;
  const R = window.__ride ??= { cars: [], waits: [], jump: 0, jumpAt: null, away: 0, lost: 0, letGo: 0, frames: 0, last: null };
  for (let i = 0; i < frames; i++) {
    g.frame(1 / 30, false);
    R.frames++;
    const who = g.rts.following, bus = f.buses()[0] ?? null;
    if (window.__busId !== undefined) {
      if (!who || who.kind !== 'bus' || who.id !== window.__busId) R.letGo++;
      const pose = f.poseOf({ kind: 'bus', id: window.__busId }), info = f.bus(window.__busId);
      if (!pose || !info) R.lost++;
      else {
        if (R.last) { const j = Math.hypot(pose.x - R.last.x, pose.z - R.last.z); if (j > R.jump) { R.jump = j; R.jumpAt = { frame: R.frames, car: info.carId, atStop: info.atStop }; } }
        R.last = { x: pose.x, z: pose.z };
        // (the camera takes a second to swing in behind a bus it has just been given)
        if (R.frames - window.__since > 60) R.away = Math.max(R.away, Math.hypot(g.rts.target.x - pose.x, g.rts.target.z - pose.z));
        if (info.carId !== null && R.cars[R.cars.length - 1] !== info.carId) R.cars.push(info.carId);
        if (info.atStop !== null && R.waits[R.waits.length - 1] !== info.atStop) R.waits.push(info.atStop);
      }
    }
    if (until === 'onRoad' && bus && bus.carId !== null) break;
    if (until === 'fourLegs' && R.cars.length >= 5) break;
    if (until === 'home' && window.__busId !== undefined && f.bus(window.__busId) === null) break;
    if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
  }
  return { ...R, jump: Math.round(R.jump * 10) / 10, away: Math.round(R.away * 10) / 10 };
}, { frames, until });

await ride(1800, 'onRoad');
const start = await page.evaluate(() => {
  const g = window.__game, f = g.fields, bus = f.buses()[0] ?? null;
  if (!bus || bus.carId === null) return { bus };
  const car = g.traffic.cars.find((c) => c.id === bus.carId), other = g.traffic.cars.find((c) => c.kind !== 'cityBus');
  const id = f.busOf(bus.carId);
  window.__busId = id; window.__since = window.__ride.frames;
  return { bus, id, kind: car?.kind, purpose: car?.purpose, otherIsBus: other ? f.busOf(other.id) : 'no other car', missing: f.bus(987654), followed: g.rts.follow({ kind: 'bus', id }), following: g.rts.following };
});
check(`the bus is on the road, and the car driving it names it (bus ${start.id}, "${start.bus?.line}", heading for stop ${start.bus?.nextStop} of ${start.bus?.stops})`,
  start.id !== undefined && start.id !== null && start.bus.id === start.id && start.kind === 'cityBus' && start.bus.line === built.line?.name && start.bus.nextStop === 1 && start.bus.stops === 3 && start.bus.atStop === null && !start.bus.returning, start);
check('a number that is no bus gives nothing', start.missing === null && (start.otherIsBus === null || start.otherIsBus === 'no other car'), start);
check(`the camera takes the bus as something to follow (following ${start.following ? `${start.following.kind}:${start.following.id}` : null})`, start.followed === true && start.following?.kind === 'bus' && start.following?.id === start.id, start);

// round the loop: four more cars take over the bus (three stops and the first again)
const loop = await ride(9000, 'fourLegs');
check(`the bus went on from stop to stop: five cars drove it in ${loop.frames} frames (${loop.cars.join(', ')})`, loop.cars.length >= 5 && new Set(loop.cars).size === loop.cars.length, loop);
check(`and waited at each stop in turn (${loop.waits.join(', ')})`, loop.waits.slice(0, 4).join() === '1,2,3,1', loop);
check(`the camera never let go of it (${loop.letGo} frames without it)`, loop.letGo === 0, loop);
check(`and it was never lost (${loop.lost} frames with no place for it)`, loop.lost === 0, loop);
// (a bus at its top speed covers 0.93 m in a frame; the car that takes it on from a stop starts from the stop's own kerb, a few
//  metres from where the last one pulled in)
check(`it never jumped: ${loop.jump} m at most between two frames (25 m allowed)`, loop.jump <= 25, loop.jumpAt);
check(`and the camera's aim stayed with it (${loop.away} m away at most; 40 m allowed)`, loop.away <= 40, loop);

// take the bus off its line: it drives home, leaves service, and the camera lets go
const gone = await page.evaluate((lineId) => { const g = window.__game; g.transit.deleteLine(lineId); const b = g.fields.bus(window.__busId); return { returning: b?.returning, nextStop: b?.nextStop }; }, built.line?.id);
check('with its line deleted the bus says it is going back for good', gone.returning === true && gone.nextStop === null, gone);
const home = await ride(9000, 'home');
const end = await page.evaluate(() => { const g = window.__game; g.frame(1 / 30, false); return { bus: g.fields.bus(window.__busId), buses: g.fields.buses().length, following: g.rts.following, pose: g.fields.poseOf({ kind: 'bus', id: window.__busId }) }; });
check(`home at the depot it is out of service, and the camera lets go (after ${home.frames - loop.frames} frames)`, end.bus === null && end.buses === 0 && end.following === null && end.pose === null, end);
check(`no errors on the page (${errs.length})`, errs.length === 0, errs.slice(0, 3));

await browser.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
