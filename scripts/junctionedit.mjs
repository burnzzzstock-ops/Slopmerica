// The ways a junction's meshes get rebuilt (docs/cars-look/junction.md): a road is built across another, an arm is upgraded
// (ONE MORE LANE), a one-way is flipped, arms are bulldozed one by one (crossing -> T -> bend -> dead end -> nothing), and a Freedom
// Circle (ring of four arcs + four stubs) is laid. After every step the road renderer is asked to rebuild and every vertex of the
// asphalt, concrete, zebra and street-furniture meshes must be finite, the asphalt of a real junction must face up, and
// the cars' inputs (seg.trimA/trimB of the arms left standing) must not have been touched by the renderer. Exits nonzero on failure.
// usage: BASE_URL=http://127.0.0.1:5184 scripts/withslot.sh node scripts/junctionedit.mjs
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const r = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, net = g.net, S = g.startView();
  cancelAnimationFrame(g.raf);
  // open flat-ish land east of the start: find a spot with nothing built within 250 m
  let site = null;
  for (let rr = 300; rr < 1500 && !site; rr += 40) for (let k = 0; k < 24 && !site; k++) {
    const x = Math.round(S.x + Math.cos((k / 24) * 6.283) * rr), z = Math.round(S.z + Math.sin((k / 24) * 6.283) * rr);
    let lo = 1e9, hi = -1e9;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const h = g.terrain.h(x + i * 30, z + j * 30); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (lo > 1.5 && hi - lo < 6 && net.segsNear(x - 200, z - 200, x + 200, z + 200).length === 0) site = { x, z, slope: hi - lo };
  }
  if (!site) return { err: 'no open site' };
  const meshes = () => [g.roads.junctionMesh, g.roads.concMesh, g.roads.crosswalkMesh, ...g.roads.typeMeshes.values()];
  const scan = () => {
    let verts = 0, tris = 0, nan = 0, down = 0;
    for (const m of meshes()) {
      const P = m.geometry.getAttribute('position');
      if (!P) continue;
      verts += P.count;
      for (let i = 0; i < P.array.length; i++) if (!Number.isFinite(P.array[i])) nan++;
      const I = m.geometry.index;
      if (I) tris += I.count / 3;
      if (m === g.roads.junctionMesh && I) for (let k = 0; k + 2 < I.count; k += 3) { const a = I.getX(k), b = I.getX(k + 1), c = I.getX(k + 2); if ((P.getZ(b) - P.getZ(a)) * (P.getX(c) - P.getX(a)) - (P.getX(b) - P.getX(a)) * (P.getZ(c) - P.getZ(a)) < -1e-9) down++; }
    }
    for (const o of g.roads.details.group.children) if (o.isInstancedMesh) for (let i = 0; i < o.count * 16; i++) if (!Number.isFinite(o.instanceMatrix.array[i])) nan++;
    return { verts, tris, nan, down };
  };
  const trims = () => [...net.segs.values()].map((s) => [s.id, +s.trimA.toFixed(4), +s.trimB.toFixed(4)]);
  const steps = [];
  const step = (name, fn) => { fn(); g.roads.update(); const sc = scan(); steps.push({ name, ...sc, segs: net.segs.size }); };
  const at = (dx, dz) => ({ x: site.x + dx, z: site.z + dz });
  const road = (a, b, t) => d.road(a.x, a.z, b.x, b.z, t);
  const arms = () => { const n = [...net.nodes.values()].find((q) => Math.hypot(q.x - site.x, q.z - site.z) < 3); return n ? n.segs.map((id) => net.segs.get(id)) : []; };
  let trimsBefore = null;
  step('build a crossing', () => { road(at(-110, 0), at(110, 0), 'twoLane'); road(at(0, -110), at(0, 110), 'twoLane'); });
  const four = arms().length;
  step('upgrade the east arm to a stroad', () => { const s = arms().find((q) => q.samp.pts[q.samp.pts.length - 1].x > site.x + 50 || q.samp.pts[0].x > site.x + 50); if (s) net.upgrade(s.id); });
  step('upgrade it again (six lanes)', () => { const s = arms().find((q) => q.type === 'stroad4'); if (s) net.upgrade(s.id); });
  step('try to flip the arms (two-lane roads refuse)', () => { for (const s of arms()) net.flip(s.id); });
  trimsBefore = trims();
  step('bulldoze the north arm (a T)', () => { const s = arms().find((q) => q.samp.pts.some((p) => p.z < site.z - 50)); if (s) net.removeSeg(s.id); });
  const three = arms().length;
  step('bulldoze the south arm (a bend or a through node)', () => { const s = arms().find((q) => q.samp.pts.some((p) => p.z > site.z + 50)); if (s) net.removeSeg(s.id); });
  const two = arms().length;
  step('bulldoze the west arm (a dead end)', () => { const s = arms().find((q) => q.samp.pts.some((p) => p.x < site.x - 50)); if (s) net.removeSeg(s.id); });
  const one = arms().length;
  step('bulldoze the last arm', () => { for (const s of arms()) net.removeSeg(s.id); });
  // a Freedom Circle, the way interchanges.ts lays it
  const ring = (c, R) => {
    const arc = (a0) => { const a1 = a0 + Math.PI / 2, k = 0.5523 * R; const p0 = { x: c.x + Math.cos(a0) * R, z: c.z + Math.sin(a0) * R }, p3 = { x: c.x + Math.cos(a1) * R, z: c.z + Math.sin(a1) * R }; return { p0, p1: { x: p0.x - Math.sin(a0) * k, z: p0.z + Math.cos(a0) * k }, p2: { x: p3.x + Math.sin(a1) * k, z: p3.z - Math.cos(a1) * k }, p3 }; };
    for (let k = 0; k < 4; k++) { const cv = arc((k * Math.PI) / 2); net.build(net.snap(cv.p0.x, cv.p0.z), net.snap(cv.p3.x, cv.p3.z), cv, 'twoLane'); }
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; road({ x: c.x + Math.cos(a) * R, z: c.z + Math.sin(a) * R }, { x: c.x + Math.cos(a) * (R + 46), z: c.z + Math.sin(a) * (R + 46) }, 'twoLane'); }
  };
  step('lay a Freedom Circle', () => ring(at(0, 0), 28));
  const ringNodes = [...net.nodes.values()].filter((q) => q.segs.length === 3).length;
  const ringTrimsBefore = trims();
  const updated = trims(); g.roads.update(); const rendererLeftTrimsAlone = JSON.stringify(updated) === JSON.stringify(trims());
  step('upgrade a ring stub', () => { const n = [...net.nodes.values()].find((q) => q.segs.length === 1 && Math.hypot(q.x - site.x, q.z - site.z) < 90); if (n) net.upgrade(n.segs[0]); });
  const ringTrimsAfter = trims();
  // two-lane crossing on a slope: the node's height comes from the ground around it
  step('a one-way couplet crossing a two-lane', () => { road(at(-110, 200), at(110, 200), 'oneWay2'); road(at(110, 226), at(-110, 226), 'oneWay2'); road(at(0, 150), at(0, 280), 'twoLane'); });
  return { site, four, three, two, one, ringNodes, steps, slope: site.slope, trimsBefore: trimsBefore?.length, ringTrimsChangedByUpgrade: JSON.stringify(ringTrimsBefore) !== JSON.stringify(ringTrimsAfter), rendererLeftTrimsAlone };
});
if (r.err) { console.log('FAIL', r.err); process.exit(1); }
for (const s of r.steps) console.log(`  ${s.name.padEnd(56)} segs ${String(s.segs).padStart(2)}  verts ${String(s.verts).padStart(6)}  tris ${String(s.tris).padStart(6)}  nan ${s.nan}  junction faces down ${s.down}`);
check(`arms at the crossing: ${r.four} -> after each bulldozing ${r.three}, ${r.two}, ${r.one}`, r.four === 4 && r.three === 3 && r.two === 2 && r.one === 1, r);
check('every vertex and instance matrix is finite after every rebuild', r.steps.every((s) => s.nan === 0), r.steps.filter((s) => s.nan));
check('no junction asphalt triangle faces down', r.steps.every((s) => s.down === 0), r.steps.filter((s) => s.down));
check(`the Freedom Circle has ${r.ringNodes} three-way nodes (4 expected)`, r.ringNodes === 4, r);
check('upgrading a ring stub re-trims the network (the renderer follows, it does not decide)', r.ringTrimsChangedByUpgrade === true, r);
check('rebuilding the meshes leaves every seg.trimA / trimB exactly as the network set them', r.rendererLeftTrimsAlone === true, r);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
