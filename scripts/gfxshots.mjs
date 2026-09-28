// Before/after captures for the graphics pass (docs/GRAPHICS_HANDOFF.md): the
// same cameras on the reference block, at day and at night, for judging one
// change against a snapshot of the old code.
//
// Cameras are found once (an intersection, a driveway apron, the steepest road
// near the block, a school, ...), checked for a clear line of sight, and saved
// to shots/gfx/cams.json; every later run reuses them, so "before" and "after"
// are shot from exactly the same place. Delete a key (or the file) to find it
// again. A view is [dx, dz, distance, yaw, pitch] from the block's centre.
//
// usage: BASE_URL=http://127.0.0.1:5175 node scripts/gfxshots.mjs <outdir> [cams] [conds] [quality]
//   cams   comma list: junction junctop corner driveway slope street overview wide lotedge
//          strip bigbox school sheriff utility treesmid treesfar shore houses
//          ('slope' lays two roads up a hillside first and is always shot last)
//   conds  comma list of day,dusk,night,moon,rain (default day,night)
//   quality low|medium|high|ultra (default high); PHONE=1 shoots a 390x780 @3x touch context
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const outDir = process.argv[2] || 'shots/gfx/out';
const want = (process.argv[3] || 'junction,corner,driveway,slope,street').split(',');
const conds = (process.argv[4] || 'day,night').split(',');
const quality = process.argv[5] || 'high';
const CONDS = { day: [12.5, 0.5, 'clear'], dusk: [19.9, 0.5, 'clear'], night: [23, 0, 'clear'], moon: [23, 0.5, 'clear'], rain: [22.5, 0.25, 'rain'] };
const CAMS = process.env.CAMS || 'shots/gfx/cams.json';
mkdirSync(outDir, { recursive: true });
mkdirSync('shots/gfx', { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const opts = process.env.PHONE ? { base, quality, width: 390, height: 780 } : { base, quality };
const { page, errs, center } = await openBlock(browser, opts);

const cams = existsSync(CAMS) ? JSON.parse(readFileSync(CAMS, 'utf8')) : {};
// an ad-hoc camera by world position: at:X:Z:DIST:PITCH[:YAW]  (not saved)
for (const k of want) if (k.startsWith('at:')) { const [, x, z, d, pitch, yaw] = k.split(':').map(Number); cams[k] = [x - center.x, z - center.z, d, yaw || 0, pitch]; }
const missing = want.filter((k) => !cams[k] && !k.startsWith('at:'));
if (missing.length) {
  const found = await page.evaluate(async ({ c, missing }) => {
    const g = window.__game;
    const { segDriveways, RoadRenderer } = await import('/src/roads/roadMesh.ts');
    const Ray = g.rts.ray.constructor, V3 = g.camera.position.constructor;
    const dist = (x, z) => Math.hypot(x - c.x, z - c.z);
    const solids = [g.buildings.mesh, g.buildings.kitMesh].filter(Boolean);
    // camera for a target: the yaw (nearest the preferred one) whose line of sight to the target, and to
    // points 9 m either side of it, is clear of buildings and terrain
    const pick = (tx, tz, d, pitch, prefer = 0, reach = 0) => {
      const ray = new Ray();
      for (let k = 0; k < 24; k++) {
        const yaw = prefer + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const sx = Math.sin(yaw), sz = Math.cos(yaw);
        const cx = tx + sx * Math.cos(pitch) * d, cz = tz + sz * Math.cos(pitch) * d, cy = g.terrain.h(tx, tz) + Math.sin(pitch) * d;
        if (cy < g.terrain.h(cx, cz) + 4) continue;
        let clear = true;
        for (const side of [0, -9, 9]) {
          const px = tx - sz * side, pz = tz + sx * side, py = g.terrain.h(px, pz) + 2;
          const o = new V3(cx, cy, cz), dir = new V3(px, py, pz).sub(o), len = dir.length();
          ray.set(o, dir.normalize());
          ray.far = len;
          for (const m of solids) { const h = ray.intersectObject(m, false); if (h.length && h[0].distance < len - reach - 3) clear = false; }
        }
        if (clear) return yaw;
      }
      return prefer;
    };
    const view = (tx, tz, d, pitch, prefer, reach) => [tx - c.x, tz - c.z, d, pick(tx, tz, d, pitch, prefer, reach), pitch];
    const out = {};
    const nodes = [...g.net.nodes.values()].filter((n) => n.segs.length >= 3).sort((a, b) => (b.segs.length - a.segs.length) || (dist(a.x, a.z) - dist(b.x, b.z)));
    const near = (arr, f) => arr.filter((b) => dist(b.x, b.z) < 420).sort((a, b) => f(b) - f(a))[0];
    const blds = [...g.buildings.list.values()];
    for (const key of missing) {
      if (key === 'junction' || key === 'corner' || key === 'junctop') {
        const n = nodes[0];
        const leg = g.net.segs.get(n.segs[0]), atA = leg.a === n.id, p1 = leg.samp.pts[atA ? Math.min(3, leg.samp.pts.length - 1) : Math.max(0, leg.samp.pts.length - 4)];
        const ux = p1.x - n.x, uz = p1.z - n.z, along = Math.atan2(ux, uz);
        out.junction ??= view(n.x, n.z, 58, 0.46, along, 0);
        out.junctop ??= [n.x - c.x, n.z - c.z, 64, along, 1.5];
        out.corner ??= view(n.x + 6 * Math.cos(along + 0.8), n.z - 6 * Math.sin(along + 0.8), 24, 0.36, along + 0.8, 0);
      } else if (key === 'driveway') {
        let drv = null;
        for (const s of g.net.segs.values()) {
          const d = segDriveways(g.net, s);
          if (!d.length || ['gravel'].includes(s.type)) continue;
          const F = RoadRenderer.frame(s, d[0].d), sc = dist(F.p.x, F.p.z);
          if (!drv || sc < drv.sc) drv = { s, d: d[0], F, sc };
        }
        const r = { x: -drv.F.t.z, z: drv.F.t.x };
        out.driveway = view(drv.F.p.x + r.x * 4.5 * drv.d.side, drv.F.p.z + r.z * 4.5 * drv.d.side, 15, 0.32, Math.atan2(-r.x * drv.d.side, -r.z * drv.d.side), 0);
      } else if (key === 'slope') {
        // the steepest open hillside 380 to 800 m from the block: a road up the fall line and one across it
        // (built at capture time, after the other views; the camera looks along the cross road from below)
        let best = null;
        for (let r = 380; r <= 800; r += 30) for (let a = 0; a < 48; a++) {
          const ang = (a / 48) * 6.283, x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
          if (g.terrain.h(x, z) < 2) continue;
          const gx = (g.terrain.h(x + 20, z) - g.terrain.h(x - 20, z)) / 40, gz = (g.terrain.h(x, z + 20) - g.terrain.h(x, z - 20)) / 40;
          const sl = Math.hypot(gx, gz);
          if (!best || sl > best.sl) best = { x, z, sl, gx, gz };
        }
        const gl = Math.hypot(best.gx, best.gz), up = { x: best.gx / gl, z: best.gz / gl }, across = { x: -up.z, z: up.x };
        out.slopeRoad = { up: [best.x - up.x * 60, best.z - up.z * 60, best.x + up.x * 60, best.z + up.z * 60], across: [best.x - across.x * 70, best.z - across.z * 70, best.x + across.x * 70, best.z + across.z * 70], grade: best.sl };
        out.slope = [best.x - c.x - across.x * 20 + up.x * 6, best.z - c.z - across.z * 20 + up.z * 6, 34, Math.atan2(-up.x * 1.0 + across.x * 0.5, -up.z * 1.0 + across.z * 0.5), 0.3];
      } else if (key === 'strip' || key === 'bigbox') {
        const b = key === 'strip' ? near(blds.filter((b) => b.zone === 'comLow'), (b) => b.hw + b.hd) : near(blds.filter((b) => b.zone === 'comHigh'), (b) => b.hw * b.hd);
        if (b) out[key] = view(b.x, b.z, 60, 0.24, b.yaw, Math.max(b.hw, b.hd));
      } else if (['school', 'sheriff', 'utility', 'clinic', 'fireStation'].includes(key)) {
        const kinds = { school: ['school'], sheriff: ['sheriff'], utility: ['wellTower', 'treatmentPlant', 'coalPlant', 'gasPeaker'], clinic: ['clinic', 'urgentCare'], fireStation: ['fireStation'] }[key];
        const b = blds.find((b) => b.zone === 'service' && kinds.includes(b.kind));
        if (b) out[key] = view(b.x, b.z, 75, 0.26, b.yaw, Math.max(b.hw, b.hd));
      } else if (key === 'lotedge') {
        const b = near(blds.filter((b) => b.zone === 'resLow'), (b) => -dist(b.x, b.z));
        if (b) out.lotedge = view(b.x, b.z, 34, 0.3, b.yaw, Math.max(b.hw, b.hd));
      } else if (key === 'shore') {
        const T = g.terrain;
        for (let r = 60; r < 1500 && !out.shore; r += 20) for (let a = 0; a < 64; a++) {
          const px = c.x + Math.cos((a / 64) * 6.283) * r, pz = c.z + Math.sin((a / 64) * 6.283) * r;
          if (T.h(px, pz) < -0.5) { out.shore = [px - c.x, pz - c.z, 90, (a / 64) * 6.283 + 1.2, 0.42]; break; }
        }
      } else if (key === 'street') out.street = [-40, -30, 110, 2.4, 0.38];
      else if (key === 'overview') out.overview = [0, 0, 320, 0.7, 0.6];
      else if (key === 'wide') out.wide = [0, 0, 900, 0.7, 0.72];
      else if (key === 'houses') out.houses = [-170, -130, 120, 4.0, 0.42];
    }
    return out;
  }, { c: center, missing });
  for (const k of Object.keys(found)) if (missing.includes(k) || !(k in cams)) cams[k] = found[k]; // never move a camera that already exists
  writeFileSync(CAMS, JSON.stringify(cams, null, 1));
  console.log('cameras found:', JSON.stringify(found));
}

const shootCam = async (cond, cam) => {
  const [hour, moon, weather] = CONDS[cond];
  if (!cams[cam]) { console.log('skip (no camera)', cam); return; }
  await shoot(page, center, { hour, moon, weather, view: cams[cam] });
  await page.screenshot({ path: `${outDir}/${cam.replace(/[:.]/g, '_')}-${cond}.png`, timeout: 180000 });
  console.log('shot', `${outDir}/${cam}-${cond}.png`);
};
for (const cond of conds) for (const cam of want) if (cam !== 'slope') await shootCam(cond, cam);
if (want.includes('slope') && cams.slope) {
  // lay the hillside roads now (they regrade the ground, so nothing else is shot after this)
  const built = await page.evaluate((sr) => {
    const g = window.__game, d = window.__dbg;
    g.zones.update();
    return [d.road(...sr.across, 'twoLane'), d.road(...sr.up, 'twoLane')];
  }, cams.slopeRoad);
  console.log('hillside roads:', JSON.stringify(built), 'grade', cams.slopeRoad.grade.toFixed(2));
  for (const cond of conds) await shootCam(cond, 'slope');
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await browser.close();
