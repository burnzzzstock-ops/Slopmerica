// Where does a frame at night go? (docs/HANDOFF_ROUND8_SONNET.md item 6: "High at night takes ~3.8 s in the render pass".)
// Opens the saved reference block (scripts/refblock.mjs) at a preset, shoots the street camera, and prints, as the median of K frames:
//   passes    every GPU pass of one frame, timed one at a time (each is followed by a 1x1 readPixels from a scratch framebuffer,
//             which on the software GPU waits for everything drawn so far; renderer.info gives the draw calls and triangles per pass):
//             the shadow map, the scene, AO, AO blur, composite, bloom, grade, the water mirror; and "rest" = the frame minus
//             those (the JavaScript update)
//   toggles   the whole frame with one feature switched off at a time (shadows, the sun/moon light, the sky light, the lamp
//             pools, each post pass, MSAA, post altogether, the sky dome, stars, clouds, water, particles, traffic, trees...), so a
//             pass's cost can be told from its dependencies
//   scale     the same pass table at several window sizes: if the time follows the pixel count (and the draw calls stay put) it is a
//             per-pixel cost; a flat time that does not follow the pixels is per-draw
//   ab        a toggle against no toggle, alternating frame by frame (the campfire and lightning lights by default; ONLY=names): small effects
//   children  each direct child of the scene hidden one at a time (cost of every layer)
// usage: BASE_URL=http://127.0.0.1:5210 node scripts/nightcost.mjs [quality, default high]
//   MODES=passes,toggles,ab,scale,children (default passes)   HOURS=23,12.5 (default 23; passes are run at each hour)   MOON=0
//   K=5 frames per measurement (median)   W=1280 H=720 (window; the preset's pixel ratio multiplies it)   SIZE=320x180 (shrink the window after opening)   SIZES=320x180,640x360,1280x720
//   ONLY=shadows,bloom (toggles by name; default all)   WEATHER=clear   PHONE=1 (390x844 @3x touch)   OUT=file.json (appends a JSON line)
// One page load costs minutes on the software GPU, and each frame seconds: run one job at a time through scripts/withslot.sh.
import { chromium } from 'playwright-core';
import { appendFileSync } from 'node:fs';
import { ARGS, EXE, openBlock, shoot } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const quality = process.argv[2] || 'high';
const modes = (process.env.MODES || 'passes').split(',');
const hours = (process.env.HOURS || '23').split(',').map(Number);
const moon = Number(process.env.MOON ?? 0);
const K = Number(process.env.K || 5);
const W = Number(process.env.W || 1280), H = Number(process.env.H || 720);
const weather = process.env.WEATHER || 'clear';
const phone = !!process.env.PHONE;
const VIEW = [-40, -30, 110, 2.4, 0.38]; // the lookbook's street camera
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
// (the game's Continue button is off screen in a tiny window: open at the usual size, SIZE=320x180 shrinks it afterwards)
const { page, errs, center } = await openBlock(browser, phone ? { base, quality, width: 390, height: 844, phone: true } : { base, quality, width: process.env.SIZE ? 1280 : W, height: process.env.SIZE ? 720 : H });
const result = { quality, base, K, window: phone ? '390x844@3x' : `${W}x${H}`, runs: [] };
const log = (...a) => console.log(...a);

// ---- in-page instrumentation ------------------------------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__game, r = g.renderer, gl = r.getContext();
  // a scratch 1x1 framebuffer: reading it back waits for every command queued before it
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  const px = new Uint8Array(4);
  const sync = () => {
    const d = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), rd = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), t = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rd);
    gl.bindTexture(gl.TEXTURE_2D, t);
  };
  const T = { rec: [], phase: 'scene', on: false, shadow: 0, sync };
  window.__T = T;
  const orig = r.render.bind(r);
  const post = g.post, names = new Map([[post.aoM, 'ao'], [post.blurM, 'ao blur'], [post.compM, 'composite'], [post.gradeM, 'grade'], [post.taaM, 'taa'], [post.copyM, 'copy']]);
  r.render = (scene, camera) => {
    if (!T.on) return orig(scene, camera);
    const c0 = r.info.render.calls, t0 = r.info.render.triangles, s0 = T.shadow, t = performance.now();
    orig(scene, camera);
    sync();
    const ms = performance.now() - t - (T.shadow - s0);
    const rt = r.getRenderTarget();
    const label = T.phase !== 'scene' ? T.phase : scene.isMesh ? names.get(scene.material) ?? 'quad' : rt && rt !== post.sceneRT ? (rt.width < 64 ? 'people pose' : `scene into ${rt.width}x${rt.height}`) : 'scene';
    T.rec.push({ label, ms, calls: r.info.render.calls - c0, tris: r.info.render.triangles - t0, w: rt ? rt.width : gl.drawingBufferWidth, h: rt ? rt.height : gl.drawingBufferHeight });
  };
  // the shadow map renders inside renderer.render: time it apart
  const sm = r.shadowMap, smRender = sm.render.bind(sm);
  sm.render = (...a) => {
    if (!T.on) return smRender(...a);
    sync();
    const t = performance.now();
    smRender(...a);
    sync();
    const ms = performance.now() - t;
    T.shadow += ms;
    T.rec.push({ label: 'shadow map', ms, calls: 0, tris: 0, w: sm.shadowMap?.width ?? 0, h: 0 });
  };
  const bloom = post.bloom; // (undefined on Low: no post)
  if (bloom) { const bRender = bloom.render.bind(bloom); bloom.render = (...a) => { const p = T.phase; T.phase = 'bloom'; bRender(...a); T.phase = p; }; }
  if (g.water.reflection) {
    const wr = g.water.reflection, wRender = wr.render.bind(wr);
    wr.render = (...a) => { const p = T.phase; T.phase = 'water mirror'; wRender(...a); T.phase = p; };
  }
});

if (process.env.SIZE) { const [w, h] = process.env.SIZE.split('x').map(Number); await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500); await page.evaluate(() => window.__game.resize()); }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const round = (v) => Math.round(v);

/** warm up (shader builds after a toggle), then K frames; per-pass medians and the whole-frame median */
async function measure(label, warm = 2) {
  const frames = await page.evaluate(async ({ K, warm }) => {
    const g = window.__game, T = window.__T, gl = g.renderer.getContext();
    T.on = false;
    for (let i = 0; i < warm; i++) { g.frame(0.016); T.sync(); }
    const out = [];
    T.on = true;
    for (let i = 0; i < K; i++) {
      T.rec = []; T.shadow = 0;
      T.sync();
      const t = performance.now();
      g.frame(0.016);
      T.sync();
      out.push({ total: performance.now() - t, rec: T.rec, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, buf: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` });
    }
    T.on = false;
    return out;
  }, { K, warm });
  const labels = [...new Set(frames.flatMap((f) => f.rec.map((x) => x.label)))];
  const rows = labels.map((l) => {
    const per = frames.map((f) => f.rec.filter((x) => x.label === l));
    const w = per[0][0] ?? {};
    return { label: l, ms: med(per.map((p) => p.reduce((s, x) => s + x.ms, 0))), calls: per[0].reduce((s, x) => s + x.calls, 0), tris: per[0].reduce((s, x) => s + x.tris, 0), n: per[0].length, size: w.w ? `${w.w}x${w.h}` : '' };
  });
  const total = med(frames.map((f) => f.total));
  const gpu = med(frames.map((f) => f.rec.reduce((s, x) => s + x.ms, 0)));
  return { label, total, rest: total - gpu, rows, buf: frames[0].buf, calls: frames[0].calls, tris: frames[0].tris, all: frames.map((f) => round(f.total)) };
}
const show = (m, full = false) => {
  log(`${m.label.padEnd(34)} frame ${String(round(m.total)).padStart(6)} ms  (js+rest ${String(round(m.rest)).padStart(5)})  calls ${m.calls}  tris ${m.tris}  buf ${m.buf}  [${m.all.join(' ')}]`);
  if (full) for (const r of m.rows) log(`    ${r.label.padEnd(14)} ${String(round(r.ms)).padStart(6)} ms  ${String(r.calls).padStart(5)} calls ${String(r.tris).padStart(9)} tris  ${r.n > 1 ? r.n + ' passes ' : ''}${r.size}`);
  result.runs.push(m);
};
const setup = (hour) => shoot(page, center, { hour, moon, weather, view: VIEW });

// each toggle: its function returns the function that undoes it (run in the page)
const TOG = {
  baseline: () => () => {},
  shadows: () => { const g = window.__game, s = g.env.sun, e = g.renderer.shadowMap.enabled, c = s.castShadow; g.renderer.shadowMap.enabled = false; s.castShadow = false; return () => { g.renderer.shadowMap.enabled = e; s.castShadow = c; }; },
  'sun/moon light off (visible)': () => { const s = window.__game.env.sun, v = s.visible; s.visible = false; return () => { s.visible = v; }; },
  'sun/moon light intensity 0': () => { const s = window.__game.env.sun, d = Object.getOwnPropertyDescriptor(s, 'intensity'); Object.defineProperty(s, 'intensity', { get: () => 0, set: () => {}, configurable: true }); return () => { delete s.intensity; Object.defineProperty(s, 'intensity', d); }; },
  'sky light (hemisphere) off': () => { const s = window.__game.env.hemi, v = s.visible; s.visible = false; return () => { s.visible = v; }; },
  'environment map off': () => { const sc = window.__game.scene, e = sc.environment; sc.environment = null; return () => { sc.environment = e; }; },
  'lamp pools off': () => { const g = window.__game, nl = g.nightLights, u = nl.update; let L; import('/src/world/nightLights.ts').then((m) => { L = m.LAMPS; L.uLampOn.value = 0; }); nl.update = () => { if (L) L.uLampOn.value = 0; }; return () => { nl.update = u; }; },
  bloom: () => { const p = window.__game.post, v = p.bloomOn; p.bloomOn = false; return () => { p.bloomOn = v; }; },
  ao: () => { const p = window.__game.post, v = p.ao; p.ao = false; return () => { p.ao = v; }; },
  'msaa off': () => { const p = window.__game.post; p.setAA('none'); return () => p.setAA('msaa4'); },
  'post off (straight to canvas)': () => { const p = window.__game.post; p.offReason = 'test'; return () => { p.offReason = null; }; },
  'sky dome': () => { const o = window.__game.env.sky, v = o.visible; o.visible = false; return () => { o.visible = v; }; },
  stars: () => { const o = window.__game.env.stars, v = o.visible; o.visible = false; return () => { o.visible = v; }; },
  'water (mesh)': () => { const o = window.__game.water.mesh, v = o.visible; o.visible = false; return () => { o.visible = v; }; },
  'water mirror': () => { const w = window.__game.water, rf = w.reflection, s = rf?.shouldRender; if (rf) rf.shouldRender = () => false; return () => { if (rf) rf.shouldRender = s; }; },
  'shadow casters (traffic + trees + buildings off the map)': () => { const g = window.__game, saved = []; g.scene.traverse((o) => { if (o.castShadow) { saved.push(o); o.castShadow = false; } }); return () => { for (const o of saved) o.castShadow = true; }; },
  'campfire point light off (the idle light every shader carries)': () => { const c = window.__game.communes.campfire, v = c.visible; c.visible = false; return () => { c.visible = v; }; },
  'lightning fill light off (the other idle light)': () => { const c = window.__game.weather.flashLight, v = c.visible; c.visible = false; return () => { c.visible = v; }; },
  'both idle lights off': () => { const g = window.__game, c = g.communes.campfire, f = g.weather.flashLight, v = [c.visible, f.visible]; c.visible = f.visible = false; return () => { c.visible = v[0]; f.visible = v[1]; }; },
};

for (const hour of hours) {
  await setup(hour);
  const hh = `${hour}h`;
  if (modes.includes('passes')) { log(`\n== passes, ${quality}, ${hh}, moon ${moon}`); show(await measure(`${quality} ${hh} passes`), true); }
}

if (modes.includes('toggles')) {
  const hour = hours[0];
  await setup(hour);
  log(`\n== toggles, ${quality}, ${hour}h, moon ${moon} (each on its own, then restored)`);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const names = Object.keys(TOG).filter((n) => n === 'baseline' || !only || only.some((o) => n.includes(o)));
  // a baseline first and last: the box's load drifts
  for (const name of names.concat('baseline (again)')) {
    const key = name.startsWith('baseline') ? 'baseline' : name;
    const src = TOG[key].toString();
    await page.evaluate(({ src }) => { window.__undo = (0, eval)(`(${src})`)(); }, { src });
    if (key === 'lamp pools off') await page.waitForTimeout(500);
    show(await measure(name, key === 'baseline' ? 1 : 2));
    await page.evaluate(() => { window.__undo?.(); window.__undo = null; });
  }
}

// ab: a toggle against no toggle, frame by frame, alternating (both shader variants are built first, so the switch itself costs nothing):
// the box's load drifts by tens of percent over a minute, which a baseline-then-toggle run cannot tell from a small effect
if (modes.includes('ab')) {
  const hour = hours[0];
  await setup(hour);
  log(`\n== A/B, ${quality}, ${hour}h, moon ${moon}: alternating frames, K=${K} each`);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : ['campfire', 'lightning', 'both idle'];
  for (const name of Object.keys(TOG).filter((n) => n !== 'baseline' && only.some((o) => n.includes(o)))) {
    const r = await page.evaluate(async ({ src, K }) => {
      const g = window.__game, T = window.__T, apply = (0, eval)(`(${src})`);
      T.on = false;
      const one = () => { T.sync(); const t = performance.now(); g.frame(0.016); T.sync(); return performance.now() - t; };
      let undo = apply(); one(); one(); undo(); one(); one(); // build both variants
      const off = [], on = [];
      for (let i = 0; i < K; i++) {
        if (i % 2) { undo = apply(); on.push(one()); undo(); off.push(one()); } else { off.push(one()); undo = apply(); on.push(one()); undo(); }
      }
      return { off, on, calls: [0, 0] };
    }, { src: TOG[name].toString(), K });
    const m = med(r.off), n = med(r.on), d = med(r.on.map((v, i) => v - r.off[i]));
    log(`${name.padEnd(60)} off ${round(m)} ms  toggled ${round(n)} ms  ratio ${(n / m).toFixed(3)} (${((n / m - 1) * 100).toFixed(1)}%)  median pair diff ${round(d)} ms  [${r.off.map(round).join(' ')}] -> [${r.on.map(round).join(' ')}]`);
    result.runs.push({ label: `ab ${name}`, off: r.off, on: r.on });
  }
}

if (modes.includes('scale')) {
  const hour = hours[0];
  await setup(hour);
  const sizes = (process.env.SIZES || '320x180,640x360,1280x720').split(',').map((s) => s.split('x').map(Number));
  log(`\n== scale, ${quality}, ${hour}h: the same camera at several window sizes`);
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__game.resize(); });
    show(await measure(`${quality} ${w}x${h}`, 2), true);
  }
}

if (modes.includes('children')) {
  const hour = hours[0];
  await setup(hour);
  log(`\n== scene children, ${quality}, ${hour}h: each hidden on its own`);
  const kids = await page.evaluate(() => window.__game.scene.children.map((o, i) => {
    let tris = 0, meshes = 0;
    o.traverse((m) => { if (m.isMesh || m.isPoints || m.isLine) { meshes++; const gm = m.geometry; tris += (gm?.index ? gm.index.count : gm?.attributes?.position?.count ?? 0) / 3 * (m.count ?? 1); } });
    return { i, type: o.type, name: o.name || o.constructor.name, children: o.children.length, meshes, tris: Math.round(tris), visible: o.visible };
  }));
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  show(await measure('all visible', 1));
  for (const k of kids) {
    if (!k.visible || (k.type !== 'Group' && k.type !== 'Mesh' && k.type !== 'Points' && k.type !== 'InstancedMesh' && k.type !== 'Object3D' && k.type !== 'LineSegments') || !k.meshes) continue;
    if (only && !only.some((o) => `${k.name}`.includes(o))) continue;
    await page.evaluate((i) => { const o = window.__game.scene.children[i]; window.__prevVis = o.visible; o.visible = false; }, k.i);
    show(await measure(`hide #${k.i} ${k.type} ${k.name} (${k.meshes} meshes ~${k.tris} tris)`, 1));
    await page.evaluate((i) => { window.__game.scene.children[i].visible = window.__prevVis; }, k.i);
  }
}

if (errs.length) log('page errors:', errs.slice(0, 3));
if (process.env.OUT) appendFileSync(process.env.OUT, JSON.stringify(result) + '\n');
await browser.close();
