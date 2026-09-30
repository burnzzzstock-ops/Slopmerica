// Close-ups of road junctions for judging the corner radii before and after (docs/cars-look/junction.md).
// Opens the reference block (scripts/refblock.mjs), finds real junction nodes in `__game.net` and builds a few synthetic ones on
// open flat land, then shoots each from a 3/4 camera by day and by night. The same code path runs on the old and the new code, so
// the pairs share one camera.
//
// usage: BASE_URL=http://127.0.0.1:5175 TAG=before node scripts/junctionshots.mjs [quality=high] [scenes] [times]
//   scenes  four,stroad,tee,skew,strT,oneway,zebra,mid   (default: all)   times  day,night (default: both)
//           zebra = a close look at a crosswalk and stop bar of the `four` junction; mid = a plain mid-block join of two stroad pieces
//   ONLY    scene:time,scene:time,...  shoot just these (scenes and times as above); overrides the two lists
//   OUT     file prefix (default docs/screenshots/cars-look/junction) -> <OUT>-<scene>-<time>-<TAG>.jpg (1024x576, q85)
//   W, H    frame size;  FRAMES  frames rendered per shot (default 3)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ARGS, EXE, openBlock } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const tag = process.env.TAG || 'shot';
const quality = process.argv[2] || 'high';
const scenes = process.env.ONLY ? [...new Set(process.env.ONLY.split(',').map((x) => x.split(':')[0]))] : (process.argv[3] || 'four,stroad,tee,skew,strT,oneway,zebra,mid').split(',');
const times = (process.argv[4] || 'day,night').split(',');
const out = process.env.OUT || 'docs/screenshots/cars-look/junction';
const W = +(process.env.W || 1024), H = +(process.env.H || 576), FRAMES = +(process.env.FRAMES || 3);
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, quality, width: W, height: H });

// ---- find or build the junctions
const spots = await page.evaluate(({ center, scenes }) => {
  const g = window.__game, d = window.__dbg, net = g.net;
  const deg = (n) => n.segs.map((id) => net.segs.get(id).type).sort().join(',');
  const nodes = [...net.nodes.values()];
  const near = (a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z);
  const legsOf = (n) => n.segs.map((id) => { const s = net.segs.get(id), p = s.samp.pts, atA = s.a === n.id, q = atA ? p[Math.min(2, p.length - 1)] : p[Math.max(0, p.length - 3)]; return Math.atan2(q.x - n.x, q.z - n.z); });
  const spot = (n) => ({ id: n.id, x: n.x, z: n.z, types: deg(n), legs: legsOf(n) });
  const found = {};
  const sorted = nodes.slice().sort(near);
  found.four = sorted.find((n) => deg(n) === 'twoLane,twoLane,twoLane,twoLane' && n.segs.every((id) => net.segs.get(id).length > 40));
  found.stroad = sorted.find((n) => deg(n) === 'stroad4,stroad4,twoLane,twoLane');
  found.strT = sorted.find((n) => deg(n) === 'stroad4,stroad4,twoLane');
  found.mid = sorted.find((n) => deg(n) === 'stroad4,stroad4' && n.segs.every((id) => net.segs.get(id).length > 60));
  found.zebra = found.four;
  // open flat land for the synthetic ones: nothing built within 200 m, gentle ground
  const sites = [];
  const free = (x, z) => net.segsNear(x - 200, z - 200, x + 200, z + 200).length === 0 && ![...g.buildings.list.values()].some((b) => Math.hypot(b.x - x, b.z - z) < 220);
  for (let r = 420; r <= 1400 && sites.length < 4; r += 40) for (let k = 0; k < 24 && sites.length < 4; k++) {
    const x = Math.round(center.x + Math.cos((k / 24) * 6.283) * r), z = Math.round(center.z + Math.sin((k / 24) * 6.283) * r);
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 380)) continue;
    let lo = 1e9, hi = -1e9;
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const h = g.terrain.h(x + i * 25, z + j * 25); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (lo < 1.5 || hi - lo > 4 || !free(x, z)) continue;
    sites.push({ x, z, lo, hi });
  }
  // (a third site with looser rules, found after the first two so they stay where they always were)
  if (sites.length < 3) for (let r = 420; r <= 1400 && sites.length < 3; r += 40) for (let k = 0; k < 24 && sites.length < 3; k++) {
    const x = Math.round(center.x + Math.cos((k / 24 + 0.02) * 6.283) * r), z = Math.round(center.z + Math.sin((k / 24 + 0.02) * 6.283) * r);
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 300)) continue;
    let lo = 1e9, hi = -1e9;
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const h = g.terrain.h(x + i * 25, z + j * 25); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (lo < 1.5 || hi - lo > 5 || net.segsNear(x - 150, z - 150, x + 150, z + 150).length || [...g.buildings.list.values()].some((b) => Math.hypot(b.x - x, b.z - z) < 160)) continue;
    sites.push({ x, z, lo, hi });
  }
  const at = (p, dx, dz) => ({ x: p.x + dx, z: p.z + dz });
  const line = (a, b, t) => d.road(a.x, a.z, b.x, b.z, t);
  const make = {};
  const S = (i) => sites[i % Math.max(1, sites.length)];
  if (sites.length) {
    if (scenes.includes('tee')) { const s = S(0); make.tee = [line(at(s, -110, 0), at(s, 110, 0), 'twoLane'), line(at(s, 0, 110), s, 'twoLane')]; make.teeAt = s; }
    if (scenes.includes('skew')) {
      const s = sites.length > 1 ? S(1) : at(S(0), 0, 0), a = (60 * Math.PI) / 180;
      make.skew = [line(at(s, -110, 0), at(s, 110, 0), 'twoLane'), line(at(s, -110 * Math.cos(a), -110 * Math.sin(a)), at(s, 110 * Math.cos(a), 110 * Math.sin(a)), 'twoLane')]; make.skewAt = s;
    }
    if (scenes.includes('oneway')) {
      const s = sites.length > 2 ? S(2) : S(0);
      make.oneway = [line(at(s, -110, 0), at(s, 110, 0), 'oneWay2'), line(at(s, 0, 110), at(s, 0, -110), 'twoLane')]; make.onewayAt = s;
    }
  }
  g.roads.update();
  const nodeAt = (p) => nodes.length && [...net.nodes.values()].filter((n) => n.segs.length >= 3 && Math.hypot(n.x - p.x, n.z - p.z) < 3)[0];
  if (make.teeAt) found.tee = nodeAt(make.teeAt);
  if (make.skewAt) found.skew = nodeAt(make.skewAt);
  if (make.onewayAt) found.oneway = nodeAt(make.onewayAt);
  const res = {};
  for (const [k, n] of Object.entries(found)) if (n) res[k] = spot(n);
  return { res, sites, make: Object.fromEntries(Object.entries(make).filter(([k]) => !k.endsWith('At'))) };
}, { center, scenes });
console.log('spots', JSON.stringify(spots).slice(0, 1500));

const TIME = { day: [12.5, 0.5], night: [22, 0.25] };
let shots = 0;
const only = process.env.ONLY ? process.env.ONLY.split(',').map((x) => x.split(':')) : null;
for (const sc of only ? [...new Set(only.map(([a]) => a))] : scenes) {
  const sp = spots.res[sc];
  if (!sp) { console.log('no junction for', sc); continue; }
  for (const tm of only ? only.filter(([a]) => a === sc).map(([, b]) => b) : times) {
    const [hour, moon] = TIME[tm];
    // the camera looks at the junction from over the corner between the first two legs
    const yaw0 = sp.legs[0] + (sc === 'strT' ? 2.3 : sc === 'zebra' ? 0.5 : 0.7);
    // the zebra scene looks at the crosswalk of leg 0, 8 m out from the node, from 15 m
    const focus = sc === 'zebra' ? { x: sp.x + Math.sin(sp.legs[0]) * 8, z: sp.z + Math.cos(sp.legs[0]) * 8, dist: 15, pitch: 0.75 } : { x: sp.x, z: sp.z, dist: sc === 'mid' ? 40 : 52, pitch: 0.8 };
    await page.evaluate(({ focus, hour, moon, yaw0, FRAMES }) => {
      const g = window.__game, d = window.__dbg;
      g.env.moonPhaseOverride = moon;
      g.weather.force('clear', 30); g.weather.settle(); g.weather.snowCover = 0;
      d.hour(hour);
      d.view(focus.x, focus.z, focus.dist, yaw0, focus.pitch);
      for (let i = 0; i < FRAMES; i++) g.frame(0.016);
    }, { focus, hour, moon, yaw0, FRAMES });
    const file = `${out}-${sc}-${tm}-${tag}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 85, timeout: 420000 });
    shots++;
    console.log('shot', file);
  }
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await browser.close();
console.log(`${shots} shots`);
