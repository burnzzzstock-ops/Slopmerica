// Special buildings sit on the street: a service, a landmark and a bus depot
// placed near a road on a hillside end up square to the road and facing it,
// a short apron back from the curb, on a level pad cut to the road's grade
// with an embankment around it, exactly where the ghost showed them; trees
// on the regraded ground follow it instead of floating or being buried.
// From playtest notes: "special buildings don't snap to roads, seems kind of
// janky. They're also not cutting the earth around them properly."
// SHOTS=dir saves close-ups. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'medium'); localStorage.setItem('slopmerica.onboarded', '1'); });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// a straight street across a hillside near the start
const site = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView(), T = g.terrain;
  cancelAnimationFrame(g.raf);
  let best = null;
  for (let dz = -600; dz <= 600; dz += 40) for (let dx = -600; dx <= 600; dx += 80) {
    const x = S.x + dx, z = S.z + dz;
    let ok = true, cross = 0;
    for (let u = -160; u <= 160 && ok; u += 20) {
      const a = T.h(x + u, z - 50), b = T.h(x + u, z + 50), m = T.h(x + u, z);
      if (Math.min(a, b, m) < 6 || !T.inBounds(x + u, z, 80) || g.communes.at(x + u, z + 45) || g.communes.at(x + u, z - 45)) ok = false;
      cross += Math.abs(a - b);
    }
    cross /= 17;
    if (ok && g.net.segsNear(x - 200, z - 90, x + 200, z + 90).length === 0 && cross > 5 && cross < 12 && (!best || Math.abs(cross - 8) < Math.abs(best.cross - 8))) best = { x, z, cross };
  }
  if (!best) return null;
  d.road(best.x - 170, best.z, best.x + 170, best.z, 'twoLane');
  for (let i = 0; i < 6; i++) g.frame(0.05, false);
  return best;
});
check(`found a hillside street (${site ? `${site.cross.toFixed(1)} m across 100 m` : 'none'})`, !!site, site);
if (!site) { await browser.close(); process.exit(1); }

// the fire station through the Services tool, as a player places it
await page.click('button.tbtn[data-t="ext:services"]');
await page.click('[data-cat="fire"]');
await page.click('[data-svc="fireStation"]');
const svc = await page.evaluate(async ({ x, z }) => {
  const g = window.__game, { EXT } = await import('/src/ext/registry.ts');
  const tool = EXT.tools.get('svcPlace'), V = g.camera.position.constructor;
  const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now(), type });
  // the cursor 24 m up the slope from the street, off-square
  const P = new V(x + 7, g.terrain.h(x + 7, z + 24), z + 24);
  tool.move(g, P, ev('pointermove'), false);
  const gh = g.scene.getObjectByName('svc-ghost');
  const m = gh?.children[0];
  const ghost = gh?.visible && m ? { x: m.position.x, y: m.position.y, z: m.position.z, yaw: m.rotation.y, tris: m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3 } : null;
  const tip = tool.tip(g)?.text ?? '';
  const before = new Set(g.buildings.list.keys());
  tool.up(g, P, ev('pointerup'), false);
  const b = [...g.buildings.list.values()].find((q) => !before.has(q.id));
  return { ghost, tip, b: b ? { id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw, hw: b.hw, hd: b.hd, label: b.label } : null };
}, site);
await page.keyboard.press('Escape');

// a landmark through the Landmarks tool, on the downhill side
const lm = await page.evaluate(({ x, z }) => {
  const g = window.__game, t = g.tools, V = g.camera.position.constructor;
  t.landmark = 'megachurch'; t.set('landmark');
  const P = new V(x - 70, g.terrain.h(x - 70, z - 30), z - 30);
  t.hover = P; t.update();
  const gh = g.scene.getObjectByName('landmark-ghost');
  const m = gh?.children[0];
  const ghost = gh?.visible && m ? { x: m.position.x, y: m.position.y, z: m.position.z, yaw: m.rotation.y } : null;
  const tip = t.tip?.text ?? '';
  const before = new Set(g.buildings.list.keys());
  g.placeLandmark('megachurch', P);
  t.set('inspect');
  const b = [...g.buildings.list.values()].find((q) => !before.has(q.id));
  return { ghost, tip, b: b ? { id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw, hw: b.hw, hd: b.hd, label: b.label } : null };
}, site);

// measure both against the street and the ground
const m = await page.evaluate(({ x, z, ids }) => {
  const g = window.__game, T = g.terrain, net = g.net, tr = g.trees;
  const out = {};
  for (const id of ids) {
    const b = g.buildings.list.get(id);
    if (!b) continue;
    const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    // the road in front: nearest centreline point to the front edge's middle
    const fx = b.x + s * b.hd, fz = b.z + c * b.hd;
    const pick = net.pickSeg(fx, fz, 30);
    let facing = 0, gap = null, roadY = null;
    if (pick) {
      const pts = pick.seg.samp.pts;
      let best = null;
      for (const p of pts) { const d = Math.hypot(p.x - fx, p.z - fz); if (!best || d < best.d) best = { p, d }; }
      const tx = pts[pts.length - 1].x - pts[0].x, tz = pts[pts.length - 1].z - pts[0].z, tl = Math.hypot(tx, tz);
      // square to the road: the building's front direction is perpendicular to the road
      facing = Math.abs(s * (tz / tl) * -1 + c * (tx / tl)) ; // |front · normal|
      // toward it: the road is in front, not behind
      const toward = (best.p.x - b.x) * s + (best.p.z - b.z) * c > 0;
      if (!toward) facing = -facing;
      gap = best.d - net.type(pick.seg.type).width / 2;
      roadY = pick.seg.hs[Math.round((pick.s / pick.seg.length) * (pick.seg.hs.length - 1))];
    }
    // the pad: ground inside the footprint (4 m in from the edges, the heightmap step)
    let worst = 0;
    for (let u = -1; u <= 1; u += 0.25) for (let v = -1; v <= 1; v += 0.25) {
      const lx = u * Math.max(0, b.hw - 4), lz = v * Math.max(0, b.hd - 4);
      worst = Math.max(worst, Math.abs(T.h(b.x + lx * c + lz * s, b.z - lx * s + lz * c) - b.y));
    }
    out[id] = { facing: +facing.toFixed(3), gap: gap === null ? null : +gap.toFixed(2), padErr: +worst.toFixed(2), aboveRoad: roadY === null ? null : +(b.y - roadY).toFixed(2) };
  }
  // trees on graded ground: standing on it (planted 0.25 m in), not floating or buried
  let n = 0, off = 0, worstTree = 0;
  const X = tr.X, Y = tr.Y, Z = tr.Z, A = tr.A;
  for (let i = 0; i < X.length; i++) {
    if (!A[i] || Math.abs(X[i] - x) > 260 || Math.abs(Z[i] - z) > 120) continue;
    n++;
    const e = Math.abs(Y[i] - (T.h(X[i], Z[i]) - 0.25));
    worstTree = Math.max(worstTree, e);
    if (e > 0.3) off++;
  }
  out.trees = { n, off, worst: +worstTree.toFixed(2) };
  return out;
}, { ...site, ids: [svc.b?.id, lm.b?.id].filter((v) => v !== undefined) });
console.log(JSON.stringify({ svc, lm, m }));

for (const [name, r] of [['fire station', svc], ['landmark', lm]]) {
  const q = r.b && m[r.b.id];
  check(`${name} placed (${r.b?.label ?? 'nothing'}; tip "${r.tip}")`, !!r.b, r);
  if (!q) continue;
  check(`${name} is square to the street and faces it (|front·normal| ${q.facing})`, q.facing > 0.99, q);
  check(`${name} front sits a short apron back from the curb (${q.gap} m from the road edge to its front)`, q.gap !== null && q.gap > 1.5 && q.gap < 4, q);
  check(`${name} pad is level (ground inside within ${q.padErr} m of the floor)`, q.padErr < 0.12, q);
  check(`${name} entrance is at street level (${q.aboveRoad} m vs the road surface)`, q.aboveRoad !== null && Math.abs(q.aboveRoad + 0.35) < 0.1, q);
  check(`${name} is built exactly where the ghost showed it`, !!r.ghost && Math.hypot(r.ghost.x - r.b.x, r.ghost.z - r.b.z) < 0.01 && Math.abs(r.ghost.y - r.b.y) < 0.01 && Math.abs(r.ghost.yaw - r.b.yaw) < 1e-4, { ghost: r.ghost, b: r.b });
}
check(`the service ghost is the building's model, not a box (${svc.ghost?.tris ?? 0} triangles)`, (svc.ghost?.tris ?? 0) > 50, svc.ghost);
check(`the tip names the street it fronts ("${svc.tip}")`, /fronts /.test(svc.tip), svc.tip);
check(`trees on the regraded ground stand on it (${m.trees.off} of ${m.trees.n} off by >0.3 m; worst ${m.trees.worst} m)`, m.trees.off === 0, m.trees);

if (process.env.SHOTS) {
  for (const [name, r] of [['svc', svc], ['lm', lm]]) {
    if (!r.b) continue;
    await page.evaluate((b) => {
      const g = window.__game;
      g.rts.setView(b.x, b.z, 150, b.yaw + Math.PI * 0.8, 0.55, true);
      for (let i = 0; i < 30; i++) g.frame(0.05, false);
      g.frame(0.016, true);
    }, r.b);
    await page.screenshot({ path: `${process.env.SHOTS}/place_${name}.png` });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
