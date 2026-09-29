// Undo pays for what is still standing, and takes back all of it.
//   playtest 6: (1) build a road, bulldoze it for the salvage, press Undo:
//   the whole price came back too, for a road that wasn't there (build,
//   bulldoze, Undo, repeat was a money printer). (2) build a road, join a
//   street to it mid-piece (the piece splits in two new ids), undo the street,
//   undo the road: two pieces of road were left standing and the whole price
//   came back. (3) the same for ONE MORE LANE on a road that was then split.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/undotest.mjs
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
const fails = [];
const check = (ok, msg) => { console.log(ok ? '  ok ' : '  ✗  ', msg); if (!ok) fails.push(msg); };

const R = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.tools, V = g.camera.position.constructor; cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); } g.syncBlockers();
  d.unlockAll(); g.sim.earn(2e6 - g.sim.money, 'other', 'test funds'); g.net.allowed = null; g.zones.allowed = null;
  window.__toasts = []; const tt = g.toast.bind(g); g.toast = (m, ...r) => { window.__toasts.push(String(m)); return tt(m, ...r); };
  const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z) + 400;
  const ev = { pointerType: 'mouse', button: 0, timeStamp: 0 }; let ts = 1000;
  const click = (x, z) => { t.hover = new V(x, g.terrain.h(x, z), z); t.update(); t.up(t.hover, { ...ev, timeStamp: (ts += 2000) }, false); t.update(); };
  const money = () => Math.round(g.sim.money), segs = () => g.net.segs.size;
  const build = (x0, z0, x1, z1, type) => { t.set('road'); t.roadType = type; t.roadMode = 'straight'; t.cancel(); click(x0, z0); click(x1, z1); t.cancel(); };
  const row = (z) => [...g.net.segs.values()].filter((s) => Math.abs(s.samp.pts[0].z - z) < 3 && Math.abs(s.samp.pts.at(-1).z - z) < 3);
  const out = {};

  // 1. build, bulldoze all of it, Undo
  { const m0 = money(), s0 = segs();
    build(cx - 300, cz, cx + 300, cz, 'highway');
    const paid = m0 - money(); const n = row(cz).length;
    for (const s of row(cz)) g.bulldozeRoad(s);
    const m1 = money();
    const label = g.undoLabel;
    g.undo();
    out.gone = { paid, pieces: n, salvage: m1 - (m0 - paid), undoPaid: money() - m1, segsLeft: segs() - s0, label, toast: window.__toasts.at(-1), canUndo: g.canUndo }; }

  // 2. build part-bulldozed: 2 of the pieces go, Undo pays for the rest
  { g.undoStack.length = 0;
    const m0 = money(), s0 = segs();
    build(cx - 300, cz + 100, cx + 300, cz + 100, 'stroad4');
    const paid = m0 - money(); const pcs = row(cz + 100).sort((a, b) => a.samp.pts[0].x - b.samp.pts[0].x); const n = pcs.length;
    const labelFull = g.undoLabel;
    for (const s of pcs.slice(0, 2)) g.bulldozeRoad(s);
    const labelPart = g.undoLabel;
    const m1 = money(); g.undo();
    out.part = { paid, pieces: n, undoPaid: money() - m1, segsLeft: segs() - s0, labelFull, labelPart, toast: window.__toasts.at(-1) }; }

  // 3. a road, a street joined mid-piece, undo both
  { g.undoStack.length = 0;
    const m0 = money(), s0 = segs();
    build(cx - 300, cz + 200, cx + 300, cz + 200, 'twoLane');
    build(cx + 37, cz + 200, cx + 37, cz + 400, 'twoLane');
    const built = segs() - s0;
    g.undo(); g.undo();
    out.split = { built, segsLeft: segs() - s0, moneyVsStart: money() - m0, canUndo: g.canUndo }; }

  // 4. ONE MORE LANE, then a street joined mid-piece; undo the street, undo the lane
  { g.undoStack.length = 0;
    const m0 = money();
    build(cx - 300, cz + 300, cx + 300, cz + 300, 'twoLane');
    const before = row(cz + 300).map((s) => s.type).join();
    const pcs = row(cz + 300);
    const m1 = money(); g.upgradeRoads(pcs); const lanePaid = m1 - money();
    build(cx + 61, cz + 300, cx + 61, cz + 500, 'twoLane');
    g.undo(); // the street
    g.undo(); // the lane
    const types = [...new Set(row(cz + 300).map((s) => s.type))];
    out.lane = { lanePaid, types, moneyVsAfterLane: money() - (m1 - lanePaid) - lanePaid, segs: row(cz + 300).length, was: pcs.length }; }
  out.nan = window.__toasts.some((m) => /NaN|undefined/.test(m));
  return out;
});
console.log(JSON.stringify(R));
const g1 = R.gone;
check(g1.pieces > 0 && g1.paid > 0, `a road is built (${g1.pieces} pieces, $${g1.paid.toLocaleString()} paid)`);
check(g1.undoPaid === 0, `bulldozed, then Undo: the price does not come back for a road that isn't there ($${g1.undoPaid.toLocaleString()} came back)`);
check(/already gone/.test(g1.toast || ''), `and it says so ("${g1.toast}")`);
check(g1.segsLeft === 0, `nothing is left standing (${g1.segsLeft} pieces)`);
const p = R.part;
const expect = Math.round(p.paid * (p.pieces - 2) / p.pieces);
check(Math.abs(p.undoPaid - expect) <= p.paid * 0.06, `2 of ${p.pieces} pieces bulldozed, then Undo: about the rest of the price comes back ($${p.undoPaid.toLocaleString()} of $${p.paid.toLocaleString()}; ~$${expect.toLocaleString()} expected)`);
check(p.undoPaid < p.paid, 'and less than the whole price');
check(p.labelPart !== p.labelFull && p.labelPart.includes(`$${p.undoPaid.toLocaleString()} back`), `the Undo button names what it will pay (${p.labelFull} → ${p.labelPart})`);
check(/already bulldozed/.test(p.toast || ''), `the message says part of it was already bulldozed ("${(p.toast || '').slice(0, 80)}")`);
check(p.segsLeft === 0, `the rest is taken down (${p.segsLeft} pieces left)`);
const s2 = R.split;
check(s2.built > 6, `a joining street splits a piece (${s2.built} pieces built)`);
check(s2.segsLeft === 0, `undo the street, then the road: no road left behind (${s2.segsLeft} pieces left)`);
check(Math.abs(s2.moneyVsStart) <= 2, `and the treasury is exactly where it started (${s2.moneyVsStart >= 0 ? '+' : ''}${s2.moneyVsStart})`);
const l = R.lane;
check(l.types.length === 1 && l.types[0] === 'twoLane', `undo the street, then the extra lane: every piece, including both halves of the split one, is a two-lane again (${l.types.join()})`);
check(Math.abs(l.moneyVsAfterLane) <= 2, `and the lane's price comes back once (off by ${l.moneyVsAfterLane})`);
check(!R.nan, 'no NaN or undefined in a message');

await browser.close();
if (errs.length) { console.log('page errors:', JSON.stringify(errs.slice(0, 3))); fails.push('page errors'); }
if (fails.length) { console.log(`FAIL: ${fails.length} problems`); process.exit(1); }
console.log('OK: Undo pays for what stands and leaves nothing behind');
