// Road cross-section check (docs/ART_DIRECTION.md, graphics handoff item 1). On the
// reference block it measures the road *geometry* by casting rays down onto the
// road meshes, so the same script runs against the old code and the new:
//
//   walk reveal   how far the sidewalk stands above the asphalt beside it (a real
//                 curb is a 12 to 17 cm step; the old road had a flush walk and a
//                 thin ridge, reveal 0)
//   verge slope   the steepest fall, rise over run in 10 cm steps, from the walk's
//                 back edge out to the graded ground (the old black skirt was a
//                 sheer face: 4+; a bank is under 1.2)
//   driveways     the curb's height where a driveway crosses it, against the curb
//                 elsewhere on the same block (the ramp: 3 cm or less at the middle)
//
// usage: BASE_URL=http://127.0.0.1:5175 node scripts/roadsection.mjs [quality]
// Exits nonzero on failure (the old code fails the first two).
import { chromium } from 'playwright-core';
import { ARGS, EXE, openBlock } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'low';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs } = await openBlock(browser, { base, quality });
const m = await page.evaluate(async () => {
  const g = window.__game;
  const { segDriveways, RoadRenderer } = await import('/src/roads/roadMesh.ts');
  const { ROAD_TYPES, carriageHalf } = await import('/src/roads/roadTypes.ts');
  const Ray = g.rts.ray.constructor, V3 = g.camera.position.constructor;
  const roads = g.roads;
  // where a block's plain section starts and ends (the rest is junction): the drawn trims when the code has them
  let trimOf = (s, id) => (id === s.a ? s.trimA : s.trimB);
  try { const RJ = await import('/src/roads/roadJunction.ts'); trimOf = (s, id) => Math.max(id === s.a ? s.trimA : s.trimB, RJ.visualTrim(g.net, s, id)); } catch { /* the old code: network trims */ }
  const meshes = [...roads.typeMeshes.values(), roads.junctionMesh, roads.concMesh];
  for (const o of meshes) o.updateMatrixWorld(true);
  const ray = new Ray();
  const top = (x, z) => {
    ray.set(new V3(x, 400, z), new V3(0, -1, 0));
    ray.far = 900;
    let y = -Infinity;
    for (const o of meshes) { const h = ray.intersectObject(o, false); if (h.length) y = Math.max(y, 400 - h[0].distance); }
    return Math.max(y, g.terrain.h(x, z));
  };
  const reveal = [], slope = [], drive = [], bads = [];
  const dist = (x, z, c) => Math.hypot(x - c.x, z - c.z);
  const c = g.startView();
  for (const s of g.net.segs.values()) {
    const t = ROAD_TYPES[s.type];
    if (t.sidewalk <= 0 || s.length < 45 || s.over || dist(s.samp.pts[0].x, s.samp.pts[0].z, c) > 520) continue;
    const drives = segDriveways(g.net, s);
    const ch = carriageHalf(t), hw = t.width / 2, co = ch + 0.3;
    for (const f of [0.35, 0.5, 0.65]) {
      const d = s.length * f;
      if (d < trimOf(s, s.a) + 4 || d > s.length - trimOf(s, s.b) - 4) continue;
      const F = RoadRenderer.frame(s, d);
      if (F.y - F.ground > 2.6) continue;
      const r = { x: -F.t.z, z: F.t.x };
      for (const side of [-1, 1]) {
        if (drives.some((dr) => dr.side === side && Math.abs(dr.d - d) < 6)) continue;
        const at = (off) => top(F.p.x + r.x * side * off, F.p.z + r.z * side * off);
        reveal.push(at(hw - t.sidewalk * 0.5) - at(ch - 1.0));
        let worst = 0, prev = at(hw - 0.4), wo = 0;
        for (let off = hw - 0.3; off <= hw + 1.4; off += 0.1) { const y = at(off); if ((prev - y) / 0.1 > worst) { worst = (prev - y) / 0.1; wo = off; } prev = y; }
        slope.push(worst);
        if (worst > 1.2) bads.push({ seg: s.id, type: s.type, f, side, x: +(F.p.x + r.x * side * wo).toFixed(1), z: +(F.p.z + r.z * side * wo).toFixed(1), off: +(wo - hw).toFixed(2), worst: +worst.toFixed(2), ys: [-0.4, 0, 0.4, 0.8, 1.2].map((k) => +(at(hw + k) - F.y).toFixed(2)), ground: +(g.terrain.h(F.p.x + r.x * side * (hw + 0.8), F.p.z + r.z * side * (hw + 0.8)) - F.y).toFixed(2) });
      }
    }
    for (const dr of drives) {
      const F = RoadRenderer.frame(s, dr.d), r = { x: -F.t.z, z: F.t.x };
      const at = (dd, off) => { const G = RoadRenderer.frame(s, dd), q = { x: -G.t.z, z: G.t.x }; return top(G.p.x + q.x * dr.side * off, G.p.z + q.z * dr.side * off); };
      const road = at(dr.d, ch - 1.0);
      const lip = (dd) => at(dd, co + 0.06) - road;
      void r;
      drive.push({ centre: lip(dr.d), away: lip(Math.max(1, dr.d - 9)) });
    }
  }
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
  return {
    n: reveal.length,
    reveal: { median: med(reveal), min: Math.min(...reveal) },
    slope: { median: med(slope), max: Math.max(...slope) },
    drives: drive.length, bads: bads.slice(0, 12), nBad: bads.length,
    lipCentre: med(drive.map((d) => d.centre)), lipAway: med(drive.map((d) => d.away)),
  };
});
console.log(JSON.stringify(m));
check(`the sidewalk stands above the road: reveal median ${m.reveal.median.toFixed(3)} m, lowest ${m.reveal.min.toFixed(3)} (target 0.09 to 0.20)`, m.reveal.median >= 0.09 && m.reveal.median <= 0.2 && m.reveal.min >= 0.06, m.reveal);
check(`the walk's edge falls to the ground as a bank: steepest ${m.slope.max.toFixed(2)} rise per run (target <= 1.2; a sheer skirt reads 4+)`, m.slope.max <= 1.2, m.slope);
check(`driveway curbs ramp to the road: lip ${m.lipCentre.toFixed(3)} m at the middle, ${m.lipAway.toFixed(3)} m along the block (${m.drives} driveways; target <= 0.03 against >= 0.09)`, m.drives > 3 && m.lipCentre <= 0.03 && m.lipAway >= 0.09, m);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
