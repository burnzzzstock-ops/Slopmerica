// Grid roads (Skylines II style): in the road panel, ▦ Grid lays out a whole
// street grid from three clicks (corner, first side, width). The preview says
// what it costs, the grid goes down as real junctions with lots to zone, a
// street already there is kept, streets that can't be built are left out and
// reported, one-ways alternate, one Undo takes the whole grid back (and not a
// road that was there first), and the touch flow plans it for the Build
// button. SHOTS=prefix saves pictures. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
// all the land is ours (this is about the tool, not the land office), and money to spend
await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); g.sim.earn(2e6 - g.sim.money, 'other', 'Test funds'); g.net.allowed = null; g.zones.allowed = null; });
const settle = () => page.evaluate(() => { const g = window.__game; for (let i = 0; i < 2; i++) g.frame(0.05, false); g.ui.refreshNow?.(); g.ui.update?.(0.05); });

// a dry, level, empty square near the town site (360 m: room for 4×3 medium blocks)
const spot = await page.evaluate(() => {
  const g = window.__game, T = g.terrain, S = g.startView();
  const clear = (x, z) => {
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const px = x + i * 30, pz = z + j * 30;
      if (T.h(px, pz) < 1.5 || T.slope(px, pz) > 0.1 || g.net.pickSeg(px, pz, 20)) return false;
    }
    return !g.communes.list.some((c) => Math.hypot(c.x - x - 180, c.z - z - 180) < 420);
  };
  for (let r = 150; r < 2200; r += 50) for (let a = 0; a < 32; a++) {
    const x = Math.round(S.x + Math.cos(a * 0.196) * r), z = Math.round(S.z + Math.sin(a * 0.196) * r);
    if (clear(x, z)) return { x, z };
  }
  return null;
});
check('found an empty level square to lay a grid on', !!spot, spot);

// the camera over it, and screen positions for world points
const view = async (x, z, dist) => page.evaluate(({ x, z, dist }) => { const g = window.__game; g.rts.setView(x, z, dist, 0, 1.2, true); for (let i = 0; i < 3; i++) g.frame(0.05, false); }, { x, z, dist });
const screen = (pts) => page.evaluate((pts) => {
  const g = window.__game, rc = g.renderer.domElement.getBoundingClientRect();
  return pts.map(([x, z]) => { const p = new (g.camera.position.constructor)(x, g.terrain.h(x, z), z).project(g.camera); return { x: rc.left + ((p.x + 1) / 2) * rc.width, y: rc.top + ((1 - p.y) / 2) * rc.height }; });
}, pts);
const net = () => page.evaluate(() => { const g = window.__game; return { segs: g.net.segs.size, nodes: g.net.nodes.size, money: Math.round(g.sim.money), undo: g.undoLabel }; });

// ---- the panel: ▦ Grid and the block sizes
await page.click('button.tbtn[data-t="roads"]');
await page.click('[data-road="twoLane"]');
await page.click('[data-mode="grid"]');
await settle();
const ui = await page.evaluate(() => ({ mode: window.__game.tools.roadMode, active: window.__game.tools.active, blocks: [...document.querySelectorAll('[data-block]')].map((b) => b.textContent), on: document.querySelector('[data-block].on')?.dataset.block }));
check(`the road panel has ▦ Grid, with block sizes (${ui.blocks.join(', ')})`, ui.mode === 'grid' && ui.active === 'road' && ui.blocks.length === 3 && ui.on === 'M', ui);
await page.click('[data-block="L"]');
const large = await page.evaluate(() => window.__game.tools.gridBlock);
await page.click('[data-block="M"]');
check('picking a block size sets it', large === 'L' && (await page.evaluate(() => window.__game.tools.gridBlock)) === 'M', large);

// ---- three clicks: corner, first side (3 blocks east), width (2 blocks)
// street spacing for medium blocks: the road, then four 8 m lot rows each side
const S = await page.evaluate(() => window.__game.net.type('twoLane').width + 0.8 + 64);
const A = [spot.x + 20, spot.z + 20], B = [A[0] + 3 * S + 6, A[1] + 4], C = [A[0] + 40, A[1] + 2 * S - 5];
await view(A[0] + 1.5 * S, A[1] + S, 620);
const [pa, pb, pc] = await screen([A, B, C]);
const before = await net();
await page.mouse.move(pa.x, pa.y);
await settle();
const tip0 = await page.evaluate(() => window.__game.tools.tip?.text ?? '');
await page.mouse.click(pa.x, pa.y);
await page.mouse.move(pb.x - 5, pb.y);
await page.mouse.move(pb.x, pb.y);
await settle();
const tip1 = await page.evaluate(() => window.__game.tools.tip?.text ?? '');
await page.mouse.click(pb.x, pb.y);
await page.mouse.move(pc.x - 5, pc.y);
await page.mouse.move(pc.x, pc.y);
await settle();
const pre = await page.evaluate(() => { const t = window.__game.tools; return { tip: t.tip?.text ?? '', bad: !!t.tip?.bad, preview: t.preview.visible && t.gridCache?.plan && { ok: t.gridCache.plan.ok, bad: t.gridCache.plan.bad, cost: Math.round(t.gridCache.plan.cost - t.gridCache.plan.grant), nu: t.gridCache.shape.nu, nv: t.gridCache.shape.nv } }; });
console.log(JSON.stringify({ tip0, tip1, pre }));
check(`the first click asks for a corner (${tip0.slice(0, 70)}…)`, /grid .*corner/i.test(tip0), tip0);
check(`pulling out the first side counts whole blocks (${tip1.slice(0, 60)}…)`, /^3 blocks along/.test(tip1), tip1);
check(`the preview is the whole 3×2 grid with its price (${pre.tip.slice(0, 90)}…)`, pre.preview && pre.preview.nu === 3 && pre.preview.nv === 2 && pre.preview.ok === 7 && pre.preview.bad === 0 && /3×2 blocks · 7 streets .*\$[\d,]+.*upkeep.*click to build/.test(pre.tip), pre);
if (process.env.SHOTS) { await page.evaluate(() => window.__game.frame(0.016, true)); await page.screenshot({ path: `${process.env.SHOTS}-preview.png` }); }
await page.mouse.click(pc.x, pc.y);
await settle();
const after = await net();
const grid = await page.evaluate(({ A, S }) => {
  const g = window.__game, N = g.net;
  // the grid's junctions: 2 crossroads inside, T's along the edges
  const inBox = (n) => { const u = n.x - A[0], v = n.z - A[1]; return u > -3 && u < 3 * S + 3 && v > -3 && v < 2 * S + 3; };
  const deg = {};
  for (const n of N.nodes.values()) if (inBox(n)) deg[n.segs.length] = (deg[n.segs.length] ?? 0) + 1;
  // every piece runs east-west or north-south
  let square = 0, all = 0;
  const ids = g.undoStack.at(-1)?.segIds ?? [];
  for (const id of ids) { const s = N.segs.get(id); if (!s) continue; const P = s.samp.pts, dx = P.at(-1).x - P[0].x, dz = P.at(-1).z - P[0].z; all++; if (Math.min(Math.abs(dx), Math.abs(dz)) < 0.5) square++; }
  // lots to zone along its streets, two full rows back to back in each block
  let cells = 0, valid = 0, deep = 0;
  for (const id of ids) for (const side of g.zones.bySeg.get(id) ?? []) for (const col of side) for (const c of col) { cells++; if (c.valid) { valid++; if (c.row === 3) deep++; } }
  return { deg, ids: ids.length, square, all, cells, valid, deep, toast: document.querySelector('.toast:last-child, #toasts > :last-child')?.textContent ?? '' };
}, { A, S });
console.log(JSON.stringify({ before, after, grid }));
const spent = before.money - after.money;
check(`the third click builds it: ${after.segs - before.segs} more road pieces, $${spent.toLocaleString()} spent (the preview said $${pre.preview.cost.toLocaleString()})`, after.segs - before.segs >= 17 && spent > 0 && Math.abs(spent - pre.preview.cost) <= Math.max(200, pre.preview.cost * 0.1), { before, after, pre });
check(`it's real junctions: ${grid.deg[4] ?? 0} crossroads, ${grid.deg[3] ?? 0} T's, ${grid.deg[2] ?? 0} corners`, grid.deg[4] === 2 && grid.deg[3] === 6 && grid.deg[2] === 4, grid.deg);
check(`every street runs square (${grid.square}/${grid.all})`, grid.all >= 17 && grid.square === grid.all, grid);
check(`its blocks have lots to zone, two rows back to back (${grid.valid}/${grid.cells} lots, ${grid.deep} at the back)`, grid.valid > 150 && grid.deep > 30, grid);
check(`one undo entry for the whole grid (${after.undo})`, /Two-Lane Road grid/.test(after.undo ?? ''), after.undo);
await page.evaluate(() => window.__game.undo());
await settle();
const undone = await net();
check(`Undo takes the whole grid back and refunds it (${undone.segs} pieces, $${undone.money.toLocaleString()})`, undone.segs === before.segs && undone.nodes === before.nodes && Math.abs(undone.money - before.money) <= 2, { before, undone });

// ---- starting on a road: the grid runs along it, keeps it, and Undo leaves it
const along = await page.evaluate(({ A, S }) => {
  const g = window.__game, t = g.tools, d = window.__dbg, V = g.camera.position.constructor;
  d.road(A[0] - 40, A[1], A[0] + 3 * S + 60, A[1] + 9, 'twoLane');
  const len = () => Math.round([...g.net.segs.values()].reduce((a, s) => a + s.length, 0));
  const len0 = len();
  const ev = { pointerType: 'mouse', button: 0, timeStamp: 0 };
  let ts = 1000;
  const click = (x, z) => { t.hover = new V(x, g.terrain.h(x, z), z); t.up(t.hover, { ...ev, timeStamp: (ts += 2000) }, false); t.update(); };
  const at = (x, z) => { t.hover = new V(x, g.terrain.h(x, z), z); t.update(); };
  const segsBefore = g.net.segs.size;
  click(A[0] + 2, A[1] + 1);
  click(A[0] + 2 * S + 30, A[1] + 30); // aimed 9° off the road: it follows the road
  at(A[0] + 2 * S + 30, A[1] - 2 * S);
  const plan = t.gridCache.plan, shape = t.gridCache.shape;
  click(A[0] + 2 * S + 30, A[1] - 2 * S);
  const built = g.net.segs.size - segsBefore;
  g.undo();
  return { plan: { ok: plan.ok, have: plan.have, bad: plan.bad }, u: [shape.u.x, shape.u.z].map((v) => +v.toFixed(3)), nu: shape.nu, built, len0, len1: len() };
}, { A, S });
console.log(JSON.stringify(along));
check(`starting on a road, the first side runs along it (direction ${along.u}) and that street counts as already there (${along.plan.have})`, Math.abs(along.u[1] - 9 / Math.hypot(3 * S + 100, 9)) < 0.01 && along.plan.have === 1 && along.plan.bad === 0, along);
check(`Undo takes the grid back (${along.built} pieces) but leaves the road it joined (${along.len1} m of road, ${along.len0} m before)`, along.built >= 6 && Math.abs(along.len1 - along.len0) <= 2, along);

// ---- one-ways alternate, so every block can be driven around
const ow = await page.evaluate(({ spot, S }) => {
  const g = window.__game, t = g.tools, V = g.camera.position.constructor;
  for (const id of [...g.net.segs.keys()]) g.net.removeSeg(id);
  t.roadType = 'oneWay1'; t.cancel();
  const ev = { pointerType: 'mouse', button: 0, timeStamp: 0 };
  let ts = 50000;
  const click = (x, z) => { t.hover = new V(x, g.terrain.h(x, z), z); t.update(); t.up(t.hover, { ...ev, timeStamp: (ts += 2000) }, false); t.update(); };
  const s = g.net.type('oneWay1').width + 0.8 + 64;
  const a = [spot.x + 20, spot.z + 20];
  click(a[0], a[1]); click(a[0] + 3 * s, a[1]); click(a[0] + 10, a[1] + 2 * s);
  // direction of each east-west street
  const rows = new Map();
  for (const seg of g.net.segs.values()) {
    const P = seg.samp.pts, dx = P.at(-1).x - P[0].x, dz = P.at(-1).z - P[0].z;
    if (Math.abs(dz) > 1) continue;
    rows.set(Math.round((P[0].z - a[1]) / s), Math.sign(dx));
  }
  return { rows: [...rows].sort((x, y) => x[0] - y[0]), n: g.net.segs.size };
}, { spot, S });
console.log(JSON.stringify(ow));
check(`one-way streets alternate direction (${ow.rows.map(([r, d]) => `row ${r}: ${d > 0 ? 'east' : 'west'}`).join(', ')})`, ow.rows.length === 3 && ow.rows[0][1] !== ow.rows[1][1] && ow.rows[1][1] !== ow.rows[2][1], ow);

// ---- streets that can't be built are red, left out and reported: a grid
// running past the county line
const edge = await page.evaluate(() => {
  const g = window.__game, t = g.tools, T = g.terrain, V = g.camera.position.constructor;
  for (const id of [...g.net.segs.keys()]) g.net.removeSeg(id);
  t.roadType = 'twoLane'; t.cancel();
  let half = 1000;
  while (T.inBounds(half + 10, 0, 6)) half += 10;
  // dry level land just inside the east line
  let at = null;
  for (let z = -half + 400; z < half - 400 && !at; z += 40) {
    let ok = true;
    for (let i = 0; i <= 6 && ok; i++) for (let j = 0; j <= 6 && ok; j++) { const x = half - 200 + i * 30, zz = z + j * 26; if (x < half - 8 && (T.h(x, zz) < 1.5 || T.slope(x, zz) > 0.1)) ok = false; }
    if (ok) at = [half - 200, z];
  }
  if (!at) return null;
  const ev = { pointerType: 'mouse', button: 0, timeStamp: 0 };
  let ts = 90000;
  const click = (x, z) => { t.hover = new V(x, T.h(x, z), z); t.update(); t.up(t.hover, { ...ev, timeStamp: (ts += 2000) }, false); t.update(); };
  const s = g.net.type('twoLane').width + 0.8 + 64;
  click(at[0], at[1]); click(at[0] + 4 * s, at[1]);
  t.hover = new V(at[0], 0, at[1] + 2 * s); t.update();
  const plan = t.gridCache.plan, tip = t.tip;
  const n0 = g.net.segs.size;
  const toasts = [];
  const orig = g.toast.bind(g); g.toast = (m, b) => { toasts.push(m); return orig(m, b); };
  click(at[0], at[1] + 2 * s);
  g.toast = orig;
  return { half, at, plan: { ok: plan.ok, bad: plan.bad, reasons: [...plan.reasons] }, tip: tip?.text, bad: tip?.bad, built: g.net.segs.size - n0, toasts };
});
console.log(JSON.stringify(edge));
check(`past the county line, the streets that can't go are red and named in the tip (${edge?.plan.bad} of ${edge ? edge.plan.ok + edge.plan.bad : 0}: ${edge?.tip?.match(/⚠️[^·]*left out[^·]*/)?.[0] ?? ''})`, !!edge && edge.plan.bad > 0 && edge.plan.ok > 0 && edge.bad && /left out: Outside the county line/.test(edge.tip), edge);
check(`the rest still goes down, and the toast says what was left out (${edge?.toasts?.[0] ?? ''})`, !!edge && edge.built > 0 && edge.toasts.some((m) => /Built a .*grid.*left out: Outside the county line/.test(m)), edge);

// ---- touch: drag the corner and first side, drag the width, then Build
await page.evaluate(() => { const g = window.__game; for (const id of [...g.net.segs.keys()]) g.net.removeSeg(id); g.tools.cancel(); });
await view(A[0] + 1.5 * S, A[1] + S, 620);
const [ta, tb, tc] = await screen([A, B, C]);
const touch = await page.evaluate(({ ta, tb, tc, A, B, C }) => {
  const g = window.__game, t = g.tools, T = g.terrain, V = g.camera.position.constructor;
  const P = ([x, z]) => new V(x, T.h(x, z), z);
  const ev = (s, ts) => ({ pointerType: 'touch', button: 0, clientX: s.x, clientY: s.y, timeStamp: ts });
  t.down(P(A), ev(ta, 200000)); t.hover = P(B); t.move(P(B), ev(tb, 200100), true); t.up(P(B), ev(tb, 200200), true); t.update();
  t.down(P(B), ev(tb, 203000)); t.hover = P(C); t.move(P(C), ev(tc, 203100), true); t.up(P(C), ev(tc, 203200), true); t.update();
  const waiting = { pending: t.pending, cost: t.pendingCost, tip: t.tip?.text ?? '', segs: g.net.segs.size };
  t.buildPending(); t.update();
  return { waiting, segs: g.net.segs.size, pending: t.pending };
}, { ta, tb, tc, A, B, C });
console.log(JSON.stringify(touch));
check(`touch: dragging plans the grid and waits for Build ($${touch.waiting.cost?.toLocaleString()}, ${touch.waiting.tip.slice(-30)})`, touch.waiting.pending && touch.waiting.cost > 0 && touch.waiting.segs === 0 && /tap Build/.test(touch.waiting.tip), touch);
check(`touch: Build lays it (${touch.segs} pieces)`, touch.segs >= 17 && !touch.pending, touch);
if (process.env.SHOTS) {
  await page.evaluate(({ A, S }) => { const g = window.__game, d = window.__dbg; d.zone(A[0] + 1.5 * S, A[1] + S, 200, 'resLow'); d.run(12); g.tools.set('inspect'); g.rts.setView(A[0] + 1.5 * S, A[1] + S, 520, 0.6, 1.0, true); for (let i = 0; i < 6; i++) g.frame(0.05, false); g.frame(0.016, true); }, { A, S });
  await page.screenshot({ path: `${process.env.SHOTS}-built.png` });
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
