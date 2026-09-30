// Yellow flashing at night (owner, 2026-09-30: "work on the yellow flashing again on Ultra"). Opens the
// reference block on Ultra, steps traffic, sets a night (moonless and full moon, clear and rain), and renders
// consecutive frames at a realistic dt, with the camera still (4 s of game time: what blinks) and panning
// ~2 m/s with a slow orbit (1 s at 30 fps: what shimmers). Each frame is read back and compared with the one
// before: a "flash" pixel is a bright, saturated yellow-to-amber pixel (hue 25-75 deg, max >= 150) at least
// 45 luma brighter than anything within 5 px of it in the previous frame (the camera moves a few px a frame,
// so a steady light never counts). Fails if any case flashes more than MAX_POPS pixels in one frame (default
// 40 at 640x360) or MEAN_POPS a frame on average (default 4).
// Found: every prop flame (burn barrels, dumpster and tire fires, flare stacks, the Liberty waver's torch)
// was an HDR particle puff 3 m across, lifted 1.85x by the night exposure and blooming; its emitter skipped
// half its ticks, so each one flashed on and off every 0.6-1.2 s. Fireflies (blinking HDR yellow, also lifted)
// drifted over the lit town.
// env: BASE_URL, Q (ultra), W/H (640x360), DPR (1), OUT (dir for annotated JPEG frames),
//      CASES="move=static&w=clear&moon=0&frames=40&dt=0.1&hide=fire+fireflies&ff=1;..." (keys: move pan|static,
//      view street|overview|houses, w weather, moon phase, frames, dt, hide (see __hide), ff firefly amount)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE, openBlock } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const Q = process.env.Q || 'ultra';
const W = +(process.env.W || 640), H = +(process.env.H || 360), DPR = +(process.env.DPR || 1);
const FRAMES = +(process.env.FRAMES || 30);
const DT = +(process.env.DT || 1 / 30);
const VIEWS = { street: [-40, -30, 110, 2.4, 0.38], overview: [0, 0, 320, 0.7, 0.6], houses: [-170, -130, 120, 4.0, 0.42] };
// CASES="move=static&w=clear&moon=0&hide=fireflies+particles&frames=60&dt=0.1;..." (defaults from the env vars)
const DEF = { ...(process.env.FF ? { ff: process.env.FF } : {}), move: process.env.MOVE || 'pan', view: process.env.VIEW || 'street', hide: (process.env.HIDE || '').replace(/,/g, '+'), frames: FRAMES, dt: DT };
const STILL = 'move=static&w=clear&moon=0&frames=40&dt=0.1';
const CASES = (process.env.CASES || `${STILL};${STILL}&ff=1;w=clear&moon=0;w=clear&moon=0.5;w=rain&moon=0;w=rain&moon=0.5`).split(';').filter(Boolean)
  .map((c) => ({ ...DEF, ...Object.fromEntries(c.split('&').map((kv) => kv.split('='))) }));
const OUT = process.env.OUT;
const MAX_POPS = +(process.env.MAX_POPS || 40 * (W * H * DPR * DPR) / (640 * 360)), MEAN_POPS = +(process.env.MEAN_POPS || 4 * (W * H * DPR * DPR) / (640 * 360));
if (OUT) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const { page, errs, center } = await openBlock(browser, { base, quality: Q, width: W, height: H, dpr: DPR });
console.log('open', JSON.stringify(await page.evaluate(() => ({ pr: window.__game.renderer.getPixelRatio(), buf: window.__game.renderer.domElement.width + 'x' + window.__game.renderer.domElement.height, q: window.__game.q.name }))));

await page.evaluate(() => {
  const g = window.__game;
  // cars on the road, with lights
  g.hour = 22.5;
  for (let i = 0; i < 1200; i++) g.traffic.update(1 / 20, 1, 22.5, g.sim.population, g.sim.jobsFilled, g.rts.target);
  // hiding a candidate: layer 31 is never rendered (visibility is rewritten every frame by its owner)
  const hidden = [];
  const hideObj = (o) => o && o.traverse((c) => { hidden.push([c, c.layers.mask]); c.layers.set(31); });
  const byKey = (key) => { const out = []; g.scene.traverse((o) => { const m = o.material; if (m && !Array.isArray(m) && m.customProgramCacheKey && String(m.customProgramCacheKey()).includes(key)) out.push(o); }); return out; };
  const ao0 = g.post.ao;
  // FF=1: firefly density of an Appalachian or Florida summer (the reference block is NorCal, ~0.1)
  { const W = g.weather, ct = W.computeTarget.bind(W); W.computeTarget = (h) => { ct(h); if (window.__FF != null) W.fireflies = window.__FF * THREE_smooth(g.env.night); }; }
  function THREE_smooth(n) { const t = Math.min(1, Math.max(0, (n - 0.4) / 0.4)); return t * t * (3 - 2 * t); }
  window.__hide = (list) => {
    for (const [o, m] of hidden.splice(0)) o.layers.mask = m;
    g.post.bloomOn = true; g.post.ao = ao0;
    for (const h of list) {
      if (h === 'fireflies') hideObj(g.weather.flies);
      else if (h === 'rain') hideObj(g.weather.rain);
      else if (h === 'lampHeads') hideObj(g.roads.lampHeads);
      else if (h === 'vehLights') byKey('vehicle-lights').forEach(hideObj);
      else if (h === 'vehicles') byKey('aa-vehicle').forEach(hideObj);
      else if (h === 'signals') { const d = g.roads.details; hideObj(d.signalBulbs); hideObj(d.pedestrianBulbs); }
      else if (h === 'particles') { hideObj(g.particles.normal.mesh); hideObj(g.particles.additive.mesh); }
      else if (h === 'fire') hideObj(g.particles.additive.mesh);
      else if (h === 'groundDetail') hideObj(g.groundDetail.group);
      else if (h === 'trees') hideObj(g.trees.group);
      else if (h === 'bloom') g.post.bloomOn = false;
      else if (h === 'ao') g.post.ao = false;
      else if (h === 'water') hideObj(g.water.mesh);
      else if (h === 'buildings') { hideObj(g.buildings.mesh); hideObj(g.buildings.kitMesh); }
      else if (h === 'peds') byKey('person').forEach(hideObj);
      else console.warn('unknown hide', h);
    }
  };
});

const all = [];
for (const C of CASES) {
  const weather = C.w || 'clear', moon = C.moon || '0', VIEW = VIEWS[C.view], FRAMES = +C.frames, DT = +C.dt, MOVE = C.move;
  const res = await page.evaluate(async ({ center, weather, moon, VIEW, FRAMES, MOVE, save, DT, hide, ff }) => {
    const g = window.__game;
    window.__hide(hide);
    window.__FF = ff;
    g.env.moonPhaseOverride = +moon;
    g.weather.force(weather, 30); g.weather.settle(); g.weather.snowCover = 0;
    g.hour = 23;
    const [dx, dz, dist, yaw, pitch] = VIEW;
    const at = (i) => MOVE === 'static' ? [center.x + dx, center.z + dz, dist, yaw, pitch]
      // ~2 m/s pan plus a slow orbit: what a player does while looking round the town
      : [center.x + dx + i * 0.9, center.z + dz + i * 0.35, dist, yaw + i * 0.004, pitch];
    const R = g.renderer, gl = R.getContext();
    let prev = null, prevW = 0;
    const out = { frames: [], saved: [] };
    const cv = document.createElement('canvas');
    for (let i = -6; i < FRAMES; i++) {
      const v = at(Math.max(0, i));
      g.rts.setView(v[0], v[1], v[2], v[3], v[4], true);
      g.frame(DT);
      if (i === 0) {
        // where the flames are: every fire emitter the game ticks (buildings within 450 m of the view), on screen
        const V = new g.camera.position.constructor();
        out.fires = [];
        for (const b of g.buildings.near(g.rts.target.x, g.rts.target.z, 450)) {
          if (b.state !== 'active') continue;
          const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
          for (const em of b.model.emitters) {
            if (em.kind !== 'fire') continue;
            const [lx, ly, lz] = em.pos;
            V.set(b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c).project(g.camera);
            if (Math.abs(V.x) < 1 && Math.abs(V.y) < 1 && V.z < 1) out.fires.push([b.label, b.zone, Math.round((V.x + 1) / 2 * gl.drawingBufferWidth), Math.round((1 - V.y) / 2 * gl.drawingBufferHeight)]);
          }
        }
      }
      if (i < 0) continue; // settle the weather, TAA/exposure etc.
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // luma, and bright saturated yellow-to-amber pixels (hue 25..75 deg)
      const Lm = new Uint8Array(w * h), Y = new Uint8Array(w * h);
      let ycount = 0;
      for (let p = 0, k = 0; p < w * h; p++, k += 4) {
        const r = px[k], gg = px[k + 1], b = px[k + 2];
        Lm[p] = Math.round(0.2126 * r + 0.7152 * gg + 0.0722 * b);
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        if (mx < 150 || mx - mn < mx * 0.35) continue;
        let hue;
        if (mx === r) hue = 60 * (((gg - b) / (mx - mn)) % 6); else if (mx === gg) hue = 60 * ((b - r) / (mx - mn) + 2); else hue = 60 * ((r - gg) / (mx - mn) + 4);
        if (hue < 0) hue += 360;
        if (hue >= 25 && hue <= 75) { Y[p] = 1; ycount++; }
      }
      const f = { i, ycount, pops: 0, popBlobs: 0, drops: 0, dropBlobs: 0, blobs: [] };
      if (prev && prevW === w) {
        // a flash: a bright yellow pixel at least JUMP luma brighter than anything within R px of it in the
        // previous frame (the camera moves a few px a frame, so a steady light never counts); a drop is the reverse
        const Rr = 5, M = 14, JUMP = 45;
        const maxf = (A) => {
          const T = new Uint8Array(w * h), D = new Uint8Array(w * h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let d = -Rr; d <= Rr; d++) { const xx = x + d; if (xx >= 0 && xx < w && A[y * w + xx] > m) m = A[y * w + xx]; } T[y * w + x] = m; }
          for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let m = 0; for (let d = -Rr; d <= Rr; d++) { const yy = y + d; if (yy >= 0 && yy < h && T[yy * w + x] > m) m = T[yy * w + x]; } D[y * w + x] = m; }
          return D;
        };
        const Mp = maxf(prev.L), Mc = maxf(Lm);
        const P = new Uint8Array(w * h), Dr = new Uint8Array(w * h);
        for (let y = M; y < h - M; y++) for (let x = M; x < w - M; x++) {
          const p = y * w + x;
          if (Y[p] && Lm[p] > Mp[p] + JUMP) { P[p] = 1; f.pops++; }
          if (prev.Y[p] && prev.L[p] > Mc[p] + JUMP) { Dr[p] = 1; f.drops++; }
        }
        // blobs (4-connected), with their centroid and mean colour
        const blobs = (Mk, keep) => {
          const seen = new Uint8Array(w * h), st = [];
          let nb = 0;
          for (let p = 0; p < w * h; p++) {
            if (!Mk[p] || seen[p]) continue;
            let n = 0, sx = 0, sy = 0, sr = 0, sg = 0, sb = 0;
            st.push(p); seen[p] = 1;
            while (st.length) {
              const q = st.pop(), qx = q % w, qy = (q / w) | 0;
              n++; sx += qx; sy += qy; sr += px[q * 4]; sg += px[q * 4 + 1]; sb += px[q * 4 + 2];
              for (const o of [q - 1, q + 1, q - w, q + w]) if (o >= 0 && o < w * h && Mk[o] && !seen[o]) { seen[o] = 1; st.push(o); }
            }
            nb++;
            if (keep && f.blobs.length < 12) f.blobs.push([Math.round(sx / n), h - 1 - Math.round(sy / n), n, Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)]);
          }
          return nb;
        };
        f.popBlobs = blobs(P, true);
        f.dropBlobs = blobs(Dr, false);
      }
      out.frames.push(f);
      if (save && (i % save === 0 || i < 4 || f.pops > 20)) {
        cv.width = w; cv.height = h;
        const c2 = cv.getContext('2d'), im = c2.createImageData(w, h);
        for (let y = 0; y < h; y++) im.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        c2.putImageData(im, 0, 0);
        c2.strokeStyle = '#ff00ff'; c2.lineWidth = 1;
        for (const b of f.blobs) { c2.strokeRect(b[0] - 6, b[1] - 6, 12, 12); }
        out.saved.push([i, cv.toDataURL('image/jpeg', 0.85).split(',')[1]]);
      }
      prev = { Y, L: Lm }; prevW = w;
    }
    out.state = { night: +g.env.night.toFixed(2), moon: +g.env.moonLight.toFixed(2), weather: g.weather.kind, rain: g.weather.cur.rain, ff: +(g.weather.fireflies || 0).toFixed(3), wet: +g.weather.wet.toFixed(2), speed: g.sim.speed, cars: g.traffic.count, flies: +g.weather.flyU.uAmount.value.toFixed(3), fliesOn: g.weather.flies.visible, fireAlive: (() => { const P = g.particles, A = P.additive; let n = 0; for (let i = 0; i < A.size; i++) if (P.time - A.p0[i * 4 + 3] < A.v[i * 4 + 3]) n++; return n; })() };
    return out;
  }, { center, weather, moon, VIEW, FRAMES, MOVE, save: OUT ? 6 : 0, DT, hide: C.hide.split('+').filter(Boolean), ff: C.ff === undefined ? null : +C.ff });
  const F = res.frames.slice(1);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const px = W * H * DPR * DPR / 1e6;
  const summary = { cond: `${C.move} ${C.view} ${weather} moon ${moon} dt ${DT}${C.hide ? ' hide ' + C.hide : ''}${C.ff ? ' ff ' + C.ff : ''}`, ...res.state, yellowPx: Math.round(mean(res.frames.map((f) => f.ycount))), popsPerFrame: +mean(F.map((f) => f.pops)).toFixed(1), popBlobsPerFrame: +mean(F.map((f) => f.popBlobs)).toFixed(2), popsPerMpx: +(mean(F.map((f) => f.pops)) / px).toFixed(1), maxPops: Math.max(...F.map((f) => f.pops)), dropsPerFrame: +mean(F.map((f) => f.drops)).toFixed(1), dropBlobsPerFrame: +mean(F.map((f) => f.dropBlobs)).toFixed(2) };
  console.log(JSON.stringify(summary));
  if (res.fires) console.log('  fire emitters on screen [label, zone, x, y]:', JSON.stringify(res.fires));
  console.log('  per frame ycount:', res.frames.map((f) => f.ycount).join(' '));
  console.log('  per frame pops:  ', res.frames.map((f) => f.pops).join(' '));
  const blobs = res.frames.flatMap((f) => f.blobs.map((b) => [f.i, ...b]));
  console.log('  pop blobs [frame,x,y,n,r,g,b]:', JSON.stringify(blobs.slice(0, 30)));
  if (OUT) for (const [i, b64] of res.saved) writeFileSync(`${OUT}/${Q}-${C.move}-${C.view}-${weather}-${moon}${C.hide ? '-' + C.hide : ''}${C.ff ? '-ff' + C.ff : ''}-${String(i).padStart(3, '0')}.jpg`, Buffer.from(b64, 'base64'));
  all.push(summary);
}
console.log('SUMMARY', JSON.stringify(all));
let bad = 0;
for (const r of all) {
  const ok = r.maxPops <= MAX_POPS && r.popsPerFrame <= MEAN_POPS;
  console.log(ok ? 'OK  ' : 'FAIL', `${r.cond}: flash pixels ${r.popsPerFrame}/frame, at most ${r.maxPops} in one frame (limits ${MEAN_POPS.toFixed(1)}, ${MAX_POPS.toFixed(0)})`);
  if (!ok) bad++;
}
if (errs.length) { console.log('FAIL page errors:', errs.slice(0, 3)); bad++; }
await browser.close();
process.exit(bad ? 1 : 0);
