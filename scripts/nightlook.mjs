// Night close-ups of the two things that stayed dark (docs/HANDOFF_ROUND8_SONNET.md item 3): street tree crowns and dark paint.
// Opens the saved reference block (scripts/refblock.mjs) at a preset, sets a night, and for each case frames a FIXED close-up
// (the same camera on every build: the tree is the civic street tree nearest the block's centre, or on Low, which has no civic
// layer, the forest tree nearest to it; the cars are three dark ones set in the lane under the nearest street lamp) and reports the
// median display luma (0..255, 0.2126 R + 0.7152 G + 0.0722 B of what reaches the canvas) of just those pixels.
//
// How the pixels are picked (a mask, not a guess): after the real frame is drawn and read back, the scene is drawn once more straight
// to the canvas with every mask object in a flat colour and everything else writing depth only (colorWrite off, so a branch or a lamp
// post in front still hides what is behind it), and read back again. A pixel is "tree" or "car" when its mask colour says so:
//   crowns   the civic foliage material (street trees), or on Low the forest trees' instanced meshes (leaf cards, cut by their own alpha)
//   cars     a private VehicleRenderer with three dark cars (black sedan, charcoal pickup, dark blue sedan; COLORS= for others), made with
//            add(kind, colour, { exact: true }) and flushed each frame; the town's own traffic is hidden for the shot
//   road     the road meshes, for scale (what a lamp-lit road reads at in the same frame)
// usage: BASE_URL=http://127.0.0.1:5210 node scripts/nightlook.mjs [quality, default high]
//   URLS=before=http://127.0.0.1:5210,after=http://127.0.0.1:5220  runs the builds one after the other in this one job (a slot, one wait)
//   CASES=trees,cars,lightcars (default trees,cars; lightcars = the cars case with white, silver and red paint)   MOON=0 (moonless; 0.5 is a full moon)   HOUR=23   OUT=dir (writes <quality>-<case>-<build>.jpg, 1280x720 q85)
//   TAG=before|after (the build's name when BASE_URL is used)   PHONE=1 (390x844 @3x touch)   JSON=file (appends one JSON line per frame)
//   SWEEP_TREE=0,0.5,1  SWEEP_CAR=0/0/0,0.6/0.3/0.1 (a number, or top/rim/side for the car sheen) also draw the close-up at each value of the build's tuning uniform
//   COLORS=e0e0e0,9aa0a6,b3202a  paint of the three cars in the cars case (hex; default three dark ones)
//   MIN_TREE / MIN_CAR: exit 1 when the last build's median luma is under the number (a gate once a fix is in)
import { chromium } from 'playwright-core';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const quality = process.argv[2] || 'high';
const cases = (process.env.CASES || 'trees,cars').split(',');
const moon = Number(process.env.MOON ?? 0);
const hour = Number(process.env.HOUR ?? 23);
const phone = !!process.env.PHONE;
// BASE_URL=url, or URLS=before=url,after=url to run several builds one after the other in this one job (one slot, one wait in the queue)
const builds = process.env.URLS ? process.env.URLS.split(',').map((x) => x.split(/=(.*)/s).slice(0, 2)) : [[process.env.TAG || 'run', process.env.BASE_URL || 'http://127.0.0.1:5173']];
// SWEEP_TREE=0,0.4,0.8 / SWEEP_CAR=0,0.2,0.4: also render the close-up at each value of the build's tuning uniform (TREE_LAMP, CAR_SHEEN in src/world/nightLights.ts)
const sweeps = { trees: process.env.SWEEP_TREE ? { uniform: 'TREE_LAMP', values: process.env.SWEEP_TREE.split(',') } : null, cars: process.env.SWEEP_CAR ? { uniform: 'CAR_SHEEN', values: process.env.SWEEP_CAR.split(',') } : null };
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const results = [];
let bad = 0;

/** one close-up: place the camera, draw, read the frame, draw the mask, return luma stats per mask class (and a JPEG of each frame) */
async function closeUp(page, name, setup, sweep) {
  const res = await page.evaluate(async ({ setupSrc, sweep }) => {
    const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera, gl = R.getContext();
    const MBM = g.tools.grade.mesh.material.constructor;
    const info = await (0, eval)(`(${setupSrc})`)(g);
    // let the camera, the tree LOD and the cars settle (frames without drawing, then one drawn)
    for (let i = 0; i < 6; i++) { info.tick?.(0.05); g.frame(0.05, false); }
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const draw = () => { info.tick?.(0.016); g.frame(0.016); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const frames = [{ label: null, shot: draw() }];
    // ---- the mask (read once: the camera does not move between the frames): class 1 = what the case measures, 2 = road
    const roadSet = new Set([...g.roads.typeMeshes.values(), g.roads.junctionMesh]);
    const colors = [null, 0xff0000, 0x00ff00];
    const saved = [], cw = new Map(), made = [];
    sc.traverse((o) => {
      if (!o.material || !o.visible) return;
      const c = info.classify(o) ? 1 : roadSet.has(o) ? 2 : 0;
      if (c) {
        const orig = Array.isArray(o.material) ? o.material[0] : o.material, am = !!info.alphaMasked?.(o);
        const m = new MBM({ color: colors[c], toneMapped: false, fog: false, map: am ? orig.map ?? null : null, alphaTest: am ? orig.alphaTest || 0.42 : 0, side: am ? 2 : 0 });
        made.push(m); saved.push([o, o.material]); o.material = m;
        return;
      }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!cw.has(m)) cw.set(m, m.colorWrite); m.colorWrite = false; }
    });
    const bg = sc.background; sc.background = null;
    const cc = R.getClearColor(new (new MBM().color.constructor)()), ca = R.getClearAlpha();
    R.setRenderTarget(null); R.setClearColor(0x000000, 1); R.clear();
    R.render(sc, cam);
    const mask = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    for (const [o, m] of saved) o.material = m;
    for (const [m, v] of cw) m.colorWrite = v;
    sc.background = bg; R.setClearColor(cc, ca);
    for (const m of made) m.dispose();
    // ---- a sweep of the build's tuning uniform: the same camera and mask, one more frame per value
    if (sweep) {
      const NL = await import('/src/world/nightLights.ts');
      if (NL[sweep.uniform]) {
        const keep = NL[sweep.uniform].value;
        // (a number, or "a/b" for the car sheen's two terms)
        const set = (v) => { const u = NL[sweep.uniform]; if (u.value.set) u.value.set(...String(v).split('/').map(Number)); else u.value = Number(v); };
        const was = keep.clone ? keep.clone() : keep;
        for (const v of sweep.values) { set(v); frames.push({ label: `k${String(v).replaceAll('/', '_')}`, shot: draw() }); }
        if (was.clone) NL[sweep.uniform].value.copy(was); else NL[sweep.uniform].value = was;
      }
    }
    const q = (a, p) => { if (!a.length) return null; a.sort((x, y) => x - y); return Math.round(a[Math.floor(p * (a.length - 1))] * 10) / 10; };
    const stat = (a) => ({ n: a.length, pct: Math.round((a.length / (w * h)) * 1000) / 10, p10: q(a, 0.1), median: q(a, 0.5), p75: q(a, 0.75), p90: q(a, 0.9), readable: a.length ? Math.round((a.filter((v) => v >= 20).length / a.length) * 1000) / 10 : null, mean: a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null });
    const outFrames = frames.map(({ label, shot }) => {
      const L = [[], [], []]; let sum = 0;
      for (let i = 0; i < w * h; i++) {
        const o = i * 4, cls = mask[o] > 128 ? 1 : mask[o + 1] > 128 ? 2 : 0, l = 0.2126 * shot[o] + 0.7152 * shot[o + 1] + 0.0722 * shot[o + 2];
        L[cls].push(l); sum += l;
      }
      // a JPEG of the frame (the readback is bottom-up), 1280 wide at most
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'), im = cx.createImageData(w, h);
      for (let y = 0; y < h; y++) im.data.set(shot.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
      cx.putImageData(im, 0, 0);
      const k = Math.min(1, 1280 / w), sm = document.createElement('canvas'); sm.width = Math.round(w * k); sm.height = Math.round(h * k);
      sm.getContext('2d').drawImage(cv, 0, 0, sm.width, sm.height);
      return { label, target: stat(L[1]), road: stat(L[2]), frameMean: Math.round((sum / (w * h)) * 10) / 10, jpg: sm.toDataURL('image/jpeg', 0.85).split(',')[1] };
    });
    info.cleanup?.();
    return { size: `${w}x${h}`, where: info.where, frames: outFrames };
  }, { setupSrc: setup.toString(), sweep });
  return res;
}

// ---- street tree crowns -------------------------------------------------------------------------------------------------
const treeSetup = async (g) => {
  const C = window.__center;
  let tree = null, kind = '';
  if (g.q.name !== 'low' && g.civic.status === 'ready') {
    // the civic street tree nearest the block's centre (a crown and trunk from the pack's tree assets)
    let best = 1e18;
    for (const [id, b] of g.civic.batches) {
      if (!id.startsWith('tree-')) continue;
      for (const it of b.items) { const d = Math.hypot(it.x - C.x, it.z - C.z); if (d < best) { best = d; tree = { x: it.x, y: it.y, z: it.z, id }; } }
    }
    kind = 'civic street tree';
  }
  if (!tree) {
    // Low has no civic layer: the forest tree nearest the centre (drawn near, as instanced meshes with leaf cards)
    g.rts.setView(C.x, C.z, 60, 2.4, 0.4, true);
    for (let i = 0; i < 6; i++) g.frame(0.05, false);
    // (a tree that counts: full size, not under a building or on a road, with some lamp light on the ground at its foot: the pool texture's
    // red channel is read back from the canvas it was painted on)
    const NL = await import('/src/world/nightLights.ts'), R4 = NL.LAMPS.uLampRect.value, cvs = g.nightLights.canvas, c2 = cvs.getContext('2d');
    const pool = (x, z) => { const u = (x - R4.x) * R4.z, v = (z - R4.y) * R4.w; if (u < 0 || v < 0 || u > 1 || v > 1) return 0; return c2.getImageData(Math.min(cvs.width - 1, Math.floor(u * cvs.width)), Math.min(cvs.height - 1, Math.floor(v * cvs.height)), 1, 1).data[0]; };
    g.nightLights.paint();
    const m = new (g.camera.matrixWorld.constructor)();
    for (const lit of [40, 10, 0]) { // (relaxed only when no tree stands in a lamp's light)
      let best = 1e18;
      for (const im of g.trees.near) {
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m);
          const e = m.elements, sc = Math.hypot(e[0], e[1], e[2]), x = e[12], z = e[14], d = Math.hypot(x - C.x, z - C.z);
          if (sc < 0.6 || d >= best || g.buildings.near(x, z, 8).length || g.net.pickSeg(x, z, 10) || pool(x, z) < lit) continue;
          best = d; tree = { x, y: e[13], z, id: `forest (pool ${pool(x, z)})` };
        }
      }
      if (tree) break;
    }
    kind = 'forest tree (near mesh)';
  }
  g.rts.setView(tree.x, tree.z, 20, 2.4, 0.3, true);
  const near = new Set(g.trees.near);
  return {
    where: { kind, id: tree.id, x: Math.round(tree.x), z: Math.round(tree.z), view: '20 m, yaw 2.4, pitch 0.3' },
    // crowns: the pack's foliage material; or the forest tree meshes
    classify: (o) => (o.material && !Array.isArray(o.material) && o.material.name === 'civic-foliage') || near.has(o),
    alphaMasked: (o) => near.has(o),
  };
};

// ---- dark cars ----------------------------------------------------------------------------------------------------------
const carSetup = async (g) => {
  const C = window.__center;
  const { VehicleRenderer } = await import('/src/agents/vehicles.ts');
  // the street lamp nearest the block's centre, and its pool on the road
  let lamp = null, best = 1e18;
  for (const L of g.roads.lampSpots) { const d = Math.hypot(L.x - C.x, L.z - C.z); if (d < best) { best = d; lamp = L; } }
  const px = lamp.x - 3.5 * Math.sin(lamp.yaw), pz = lamp.z - 3.5 * Math.cos(lamp.yaw); // the pool's centre (src/world/nightLights.ts)
  const ax = Math.cos(lamp.yaw), az = -Math.sin(lamp.yaw); // along the road
  const R = new VehicleRenderer(g.scene, 8);
  const yaw = Math.atan2(ax, az);
  // COLORS=e0e0e0,9aa0a6,b3202a puts pale and coloured paint under the same lamp (a check that a fix does not change them)
  const hex = (window.__colors || '050505,1d1f22,0b1426').split(',').map((h) => parseInt(h, 16));
  const cars = [['sedan', hex[0], 0], ['pickup', hex[1], 6.5], ['sedan', hex[2], -6.5]].map(([kind, color, off]) => {
    const x = px + ax * off, z = pz + az * off, y = g.terrain.h(x, z) + 0.1;
    const h = R.add(kind, color, { exact: true, seed: 7 });
    R.set(h, x, y, z, yaw);
    return { h, x, y, z };
  });
  const hidden = g.traffic.renderer.object.visible;
  g.traffic.renderer.object.visible = false; // the town's own cars out of the shot
  const tick = () => { R.updateLod(g.camera); R.setNight(g.env.night); for (const c of cars) R.set(c.h, c.x, c.y, c.z, yaw); R.flush(0.016); };
  // the camera on the lamp post's side of the road, a little off square, looking at the middle car
  g.rts.setView(px, pz, 15, lamp.yaw + 0.5, 0.3, true);
  const mine = (o) => { for (let p = o; p; p = p.parent) if (p === R.object) return true; return false; }; // (models are built on demand: test the parent chain)
  return {
    where: { kind: 'dark cars under the nearest street lamp', lamp: [Math.round(lamp.x), Math.round(lamp.z)], pool: [Math.round(px), Math.round(pz)], view: '15 m' },
    tick,
    classify: (o) => mine(o) && o.name?.startsWith('vehicle-') && !o.name.endsWith('-pick'),
    cleanup: () => { g.traffic.renderer.object.visible = hidden; R.dispose(); },
  };
};


for (const [label, base] of builds) {
  const { page, errs, center } = await openBlock(browser, phone ? { base, quality, width: 390, height: 844, phone: true } : { base, quality });
  // night, clear, the street camera first so the town streams in around the block
  await shoot(page, center, { hour, moon, weather: 'clear', view: [-40, -30, 110, 2.4, 0.38] });
  // the civic layer (street trees) streams in after the town: wait for it, where the preset loads it
  const civic = await page.evaluate(async () => {
    const g = window.__game;
    if (g.q.name === 'low') return 'off';
    for (let i = 0; i < 400 && g.civic.status === 'loading'; i++) await new Promise((r) => setTimeout(r, 500));
    for (let i = 0; i < 6; i++) g.frame(0.5, false);
    return g.civic.status;
  });
  console.log(`[${label}] ${base} civic layer: ${civic}`);
  await page.evaluate((c) => { window.__center = c[0]; window.__colors = c[1]; }, [center, process.env.COLORS || '']);
  const spec = { trees: treeSetup, cars: carSetup, lightcars: carSetup };
  for (const c of cases) {
    // (lightcars: the same shot with pale and coloured paint, to see what a fix does to the cars that were never the problem)
    await page.evaluate((col) => { window.__colors = col; }, c === 'lightcars' ? 'e0e0e0,9aa0a6,b3202a' : process.env.COLORS || '');
    let r;
    try { r = await closeUp(page, c, spec[c], c === 'lightcars' ? sweeps.cars : sweeps[c]); } catch (e) { console.log(`[${label}] ${c}: FAILED`, String(e.message).split('\n')[0]); bad++; continue; }
    for (const f of r.frames) {
      const suffix = f.label ? `-${f.label}` : '';
      if (process.env.OUT) { mkdirSync(process.env.OUT, { recursive: true }); writeFileSync(`${process.env.OUT}/${quality}-${c}-${label}${suffix}.jpg`, Buffer.from(f.jpg, 'base64')); }
      delete f.jpg;
      console.log(`[${label}] ${quality} ${c}${f.label ? ' ' + f.label : ''}: ${r.size}  target median ${f.target.median}  (p10 ${f.target.p10}, p75 ${f.target.p75}, p90 ${f.target.p90}, mean ${f.target.mean}, ${f.target.readable}% of its pixels at luma 20+; ${f.target.n} px = ${f.target.pct}% of the frame)  road median ${f.road.median}  frame mean ${f.frameMean}`);
      if (process.env.JSON) appendFileSync(process.env.JSON, JSON.stringify({ quality, case: c, build: label, sweep: f.label, moon, hour, size: r.size, where: r.where, ...f }) + '\n');
    }
    console.log(`   where: ${JSON.stringify(r.where)}`);
    results.push({ label, case: c, frame0: r.frames[0] });
  }
  if (errs.length) console.log(`[${label}] page errors:`, errs.slice(0, 3));
  await page.close();
}
const gate = { trees: Number(process.env.MIN_TREE), cars: Number(process.env.MIN_CAR) };
for (const r of results.filter((x) => x.label === builds[builds.length - 1][0])) if (gate[r.case] && !(r.frame0.target.median >= gate[r.case])) { console.log(`FAIL ${r.case}: median ${r.frame0.target.median} < ${gate[r.case]}`); bad++; }
await browser.close();
process.exit(bad ? 1 : 0);
