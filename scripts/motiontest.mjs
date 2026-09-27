// Cars and people move like cars and people: headings don't snap at road
// samples or junctions, cars brake before turns, change lanes (for the turn,
// or to pass), blink, and never drive the wrong way down a one-way; walkers'
// legs cycle as fast as they walk and nobody teleports across the street.
// SHOTS=prefix saves a picture of the one-way. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'medium'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  // a grid: a four-lane stroad each way through the middle, a one-way couplet, a one-lane one-way
  for (let k = -2; k <= 2; k++) {
    const tx = k === 0 ? 'stroad4' : k === 1 ? 'oneWay2' : 'twoLane';
    const tz = k === 0 ? 'stroad4' : k === -1 ? 'oneWay1' : 'twoLane';
    d.road(cx - 250, cz + k * 100, cx + 250, cz + k * 100, tx);
    d.road(cx + k * 100, cz - 250, cx + k * 100, cz + 250, tz);
  }
  g.zones.update();
  d.zone(cx - 50, cz - 50, 90, 'resLow'); d.zone(cx + 50, cz + 50, 90, 'comLow'); d.zone(cx + 150, cz - 150, 80, 'resLow'); d.zone(cx - 150, cz + 150, 80, 'comLow');
  const cand = [];
  for (let k = 0; k < 200; k++) for (const z of ['resLow', 'comLow']) { g.zones.candidates(z, cand); if (cand.length) g.buildings.tryGrow(z, cand); }
  for (const b of g.buildings.list.values()) { b.state = 'active'; b.progress = 1; }
  const blds = [...g.buildings.list.values()].filter((b) => b.zone === 'resLow' || b.zone === 'comLow');
  const T = g.traffic;
  const oneWays = new Set([...g.net.segs.values()].filter((s) => s.type === 'oneWay1' || s.type === 'oneWay2').map((s) => s.id));
  g.sim.speed = 1;
  g.rts.setView(cx, cz, 260, 0.6, 0.8, true);
  g.peds.population = 3000;
  const prev = new Map(), laneOf = new Map(), pedPrev = new Map();
  let activeFrames = 0, maxJump = 0, jumpAt = null, samples = 0, laneChanges = 0, wrongWay = 0, blinks = 0, brakedBeforeTurn = 0, turnsSeen = 0, pedSteps = 0, pedTeleports = 0, cadence = [], trips = 0;
  const turnSpeed = new Map();
  for (let f = 0; f < 3600; f++) {
    if (f % 15 === 0 && blds.length > 2) {
      const a = blds[Math.floor(Math.random() * blds.length)], b = blds[Math.floor(Math.random() * blds.length)];
      if (a !== b && T.dispatch('sedan', a, b, 'test', 'test', 12)) trips++;
    }
    g.frame(1 / 60, f % 120 === 0);
    for (const c of T.cars) {
      if (c.crashed !== 0 || c.dep > 0 || c.arr >= 0) { prev.delete(c.id); continue; }
      for (let i = c.pi; i < c.path.length; i++) if (oneWays.has(c.path[i].seg) && c.path[i].dir < 0) wrongWay++;
      const p = prev.get(c.id);
      if (p && c.v > 2) {
        let dy = c.yaw - p.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        samples++;
        if (Math.abs(dy) > maxJump) { maxJump = Math.abs(dy); jumpAt = { v: +c.v.toFixed(1), junction: !!c.junction, pi: c.pi, len: c.path.length, jlen: c.junction ? +c.junction.len.toFixed(2) : null, jt: c.junction ? +c.junction.t.toFixed(2) : null, turn: c.turn }; }
      }
      prev.set(c.id, { yaw: c.yaw });
      const l0 = laneOf.get(c.id);
      if (!c.junction && l0 && l0.pi === c.pi && l0.lane !== c.lane) laneChanges++;
      if (!c.junction) laneOf.set(c.id, { pi: c.pi, lane: c.lane });
      if (c.junction && c.turn !== 0) {
        if (!turnSpeed.has(c.id + ':' + c.pi)) { turnSpeed.set(c.id + ':' + c.pi, c.v); turnsSeen++; if (c.v < 9.5) brakedBeforeTurn++; }
      }
    }
    // blinkers: any lit?
    for (const b of T.renderer.batches.values()) for (let i = 0; i < b.used; i++) if (b.active[i]) { activeFrames++; if (b.turn[i]) blinks++; }
    for (const p of g.peds.peds) {
      const q = pedPrev.get(p.h);
      if (q && p.kind === 'walk' && !p.go && !q.go && q.kind === 'walk') {
        const dist = Math.hypot(p.x - q.x, p.z - q.z);
        pedSteps++;
        if (dist > 0.8) pedTeleports++;
        if (dist > 0.005 && p.action === 'walk') cadence.push((p.phase - q.phase) / dist);
      }
      pedPrev.set(p.h, { x: p.x, z: p.z, phase: p.phase, go: !!p.go, kind: p.kind });
    }
  }
  cadence.sort((a, b) => a - b);
  return {
    trips, samples, maxJump: +maxJump.toFixed(3), jumpAt, laneChanges, wrongWay, blinks, blinkFrac: +(blinks / Math.max(1, activeFrames)).toFixed(3), turnsSeen, brakedBeforeTurn,
    peds: g.peds.peds.length, pedSteps, pedTeleports, cadence: cadence.length ? +cadence[Math.floor(cadence.length / 2)].toFixed(3) : null,
    oneWays: oneWays.size, why: T.sigWhy,
  };
});
console.log(JSON.stringify(r));
check(`traffic ran (${r.trips} trips dispatched, ${r.samples} car-frames)`, r.trips > 100 && r.samples > 5000, r);
check(`headings never snap: biggest turn in one 1/60 s frame ${r.maxJump} rad`, r.maxJump < 0.12, r);
check(`cars change lanes on the multi-lane roads (${r.laneChanges})`, r.laneChanges > 5, r);
check(`nobody drives the wrong way down a one-way (${r.wrongWay} step-frames against the arrows on ${r.oneWays} one-way blocks)`, r.wrongWay === 0 && r.oneWays > 0, r);
check(`cars signal their turns, not all the time (${(r.blinkFrac * 100).toFixed(0)}% of car-frames blinking)`, r.blinks > 100 && r.blinkFrac < 0.5, r);
check(`turns are taken slowly, braked for in advance (${r.brakedBeforeTurn}/${r.turnsSeen} entered under 9.5 m/s)`, r.turnsSeen > 10 && r.brakedBeforeTurn / r.turnsSeen > 0.9, r);
check(`walkers' legs match their pace: ${r.cadence} leg cycles per metre (a 1.4 m stride is 0.70)`, r.cadence !== null && r.cadence > 0.55 && r.cadence < 0.85, r);
check(`nobody on foot teleports (${r.pedTeleports} jumps over 0.8 m in ${r.pedSteps} steps)`, r.pedSteps > 200 && r.pedTeleports === 0, r);
if (process.env.SHOTS) {
  await page.evaluate(() => { const g = window.__game; document.querySelector('.hud').style.visibility = 'hidden'; g.hour = 17; g.rts.setView(60 + 100, 60 - 30, 70, 0.9, 0.5, true); for (let i = 0; i < 30; i++) g.frame(0.05, false); g.frame(0.016, true); });
  await page.screenshot({ path: `${process.env.SHOTS}-oneway.png`, timeout: 240000 });
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
