// Shoot the pedestrian models on the no-game lineup page (dev/people.html): the whole cast at true 8 / 30 / 100 m, by day and
// by night, plus close-up sheets of every action and the walk / run / idle cycles frame by frame. The page needs no town, so a
// capture takes seconds, not the minute a game load costs. Same camera on the old and the new code: run once against the frozen
// old server and once against a snapshot of your work, then compare the two folders.
//
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5181 OUT=shots/people/after node scripts/peoplelineup.mjs [sheet ...]
//   sheets (default: all): row8 row8n grid30 grid30n grid100 grid100n actions walk run idle idle2 near1..near6
//   env: JPEG=1 to write JPEG (quality 85, what docs/screenshots wants), else PNG; W, H = viewport (default 1280x720)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = process.env.OUT || 'shots/people/out';
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const jpeg = !!process.env.JPEG;
mkdirSync(out, { recursive: true });
const want = new Set(process.argv.slice(2));
const on = (n) => want.size === 0 || want.has(n);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
const noise = (t) => /WebSocket|\[vite\]|Vite server|status of 404/.test(t); // a frozen snapshot has no HMR socket, and the page has no favicon
page.on('pageerror', (e) => { if (!noise(e.message)) errs.push(e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errs.push(m.text()); });
await page.goto(`${base}/dev/people.html`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__people?.ready, null, { timeout: 180000 });
const roster = await page.evaluate(() => window.__people.archetypes);
const N = roster.length;
// one person per archetype (colours come from the seed, the same on every run), plus spares for the sheets that repeat one
const hands = await page.evaluate((n) => Array.from({ length: n }, (_, i) => window.__people.spawn(i, i * 3761 + 17)), N);
const spare = async (arch, count) => page.evaluate(([a, c]) => Array.from({ length: c }, () => window.__people.spawn(a, a * 3761 + 17)), [arch, count]);
const byId = Object.fromEntries(roster.map((r) => [r.id, r.i]));
const KNOWN = new Set(['walk', 'run', 'idle', 'smoke', 'drink', 'vape', 'phone', 'protest', 'dance', 'drum', 'yoga', 'sit', 'lie', 'fight']);
const naturalAction = (i) => (roster[i].vices.find((v) => KNOWN.has(v) && v !== 'lie' && v !== 'run') ?? 'idle');

async function shot(name, tiles, zoom) {
  await page.evaluate((t) => window.__people.render(t), tiles);
  const file = `${out}/${name}.${jpeg ? 'jpg' : 'png'}`;
  const buf = await page.screenshot(jpeg ? { path: file, type: 'jpeg', quality: 85, timeout: 180000 } : { path: file, timeout: 180000 });
  console.log('wrote', file);
  // a second picture of the same pixels, cut out and enlarged without smoothing: what a person 100 m away really is on screen
  if (zoom) {
    const z = await browser.newPage({ viewport: { width: zoom.w * zoom.k, height: zoom.h * zoom.k } });
    await z.setContent(`<body style="margin:0;background:#000;overflow:hidden"><img id="i" src="data:image/${jpeg ? 'jpeg' : 'png'};base64,${buf.toString('base64')}" style="position:absolute;left:${-zoom.x * zoom.k}px;top:${-zoom.y * zoom.k}px;width:${W * zoom.k}px;image-rendering:pixelated"></body>`);
    await z.waitForFunction(() => document.getElementById('i').complete);
    const zf = `${out}/${name}-zoom.${jpeg ? 'jpg' : 'png'}`;
    await z.screenshot(jpeg ? { path: zf, type: 'jpeg', quality: 85, timeout: 180000 } : { path: zf, timeout: 180000 });
    console.log('wrote', zf);
    await z.close();
  }
}
const eyeAt = (x, y, z) => [x, y, z];

// true-distance rows and grids ------------------------------------------------------------------------------------------
function rowSheet(ids, dist, night, t = 3.1) {
  const sp = 1.0, poses = [], labels = [];
  ids.forEach((id, k) => {
    const x = (k - (ids.length - 1) / 2) * sp;
    poses.push({ h: hands[id], x, z: 0, yaw: 0, action: naturalAction(id) === 'walk' ? 'idle' : naturalAction(id), phase: t + k * 0.37 });
    labels.push({ text: roster[id].name, x, y: 2.05, z: 0 });
  });
  return [{ x: 0, y: 0, w: W, h: H, eye: eyeAt(0, 1.45, dist), target: [0, 0.98, 0], fov: 36, poses, night, labels, labelPx: 11, shadow: 9 }];
}
function gridSheet(dist, night, cols = 14, t = 2.2) {
  const rows = Math.ceil(N / cols), sx = 2.5, sz = 3.2, poses = [], labels = [];
  for (let i = 0; i < N; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * sx, z = -r * sz;
    const a = naturalAction(i);
    poses.push({ h: hands[i], x, z, yaw: 0, action: a, phase: t + i * 0.29 });
    if (dist <= 40) labels.push({ text: roster[i].name.split(' ').slice(0, 2).join(' '), x, y: 2.0, z });
  }
  const zMid = -((rows - 1) * sz) / 2;
  const hCam = dist * 0.32;
  return [{ x: 0, y: 0, w: W, h: H, eye: eyeAt(0, hCam, dist + 0), target: [0, 0.9, zMid], fov: 40, poses, night, labels, labelPx: 8, shadow: dist > 60 ? 45 : 26 }];
}

if (on('row8')) await shot('row8', rowSheet(['floridaMan', 'communeHippie', 'hoaPresident', 'developerChad', 'trucker', 'gymBro', 'egirl', 'streetPreacher'].map((k) => byId[k]), 8, false));
if (on('row8n')) await shot('row8n', rowSheet(['fireworksNeighbor', 'sovereignCitizen', 'karen', 'techBro', 'lineman', 'doorDashDriver', 'goth', 'roadsidePhilosopher'].map((k) => byId[k]), 8, true));
if (on('grid30')) await shot('grid30', gridSheet(30, false));
if (on('grid30n')) await shot('grid30n', gridSheet(30, true));
const ZOOM100 = { x: 480, y: 322, w: 320, h: 80, k: 4 };
if (on('grid100')) await shot('grid100', gridSheet(100, false), ZOOM100);
if (on('grid100n')) await shot('grid100n', gridSheet(100, true), ZOOM100);

// magnified sheets: 12 people a sheet, six a row, each in its own tile, close enough to judge the near model --------------------
for (let s = 1; s <= 6; s++) {
  if (!on('near' + s)) continue;
  const tiles = [], ids = Array.from({ length: 12 }, (_, k) => (s - 1) * 12 + k).filter((i) => i < N);
  ids.forEach((id, k) => {
    const c = k % 6, r = Math.floor(k / 6), tw = Math.floor(W / 6), th = Math.floor(H / 2);
    const x = 20 * k, z = 0;
    tiles.push({ x: c * tw, y: r * th, w: tw, h: th, eye: eyeAt(x, 1.15, 5.6), target: [x, 0.9, 0], fov: 30, poses: [{ h: hands[id], x, z, yaw: 0, action: naturalAction(id) === 'walk' ? 'idle' : naturalAction(id), phase: 2.3 + id * 0.41 }], labels: [{ text: roster[id].name, x, y: 2.1, z }], labelPx: 10, shadow: 5 });
  });
  await shot('near' + s, tiles);
}

// one person doing every action, tile by tile ---------------------------------------------------------------------------------
if (on('actions')) {
  const acts = ['walk', 'run', 'idle', 'smoke', 'drink', 'vape', 'phone', 'protest', 'dance', 'drum', 'yoga', 'sit', 'lie', 'fight'];
  const who = byId[process.env.WHO || 'developerChad'];
  const extra = await spare(who, acts.length);
  const tiles = acts.map((a, k) => {
    const c = k % 7, r = Math.floor(k / 7), tw = Math.floor(W / 7), th = Math.floor(H / 2), x = 12 * k;
    return { x: c * tw, y: r * th, w: tw, h: th, eye: eyeAt(x + 2.6, 1.3, 4.6), target: [x, 0.95, 0], fov: 32, poses: [{ h: extra[k], x, z: 0, yaw: 0.25, action: a, phase: 1.7 + k * 0.13 }], labels: [{ text: a, x, y: 2.05, z: 0 }], labelPx: 11, shadow: 5 };
  });
  await shot('actions', tiles);
}

// gait cycles, frame by frame: the person walks, the camera and the pavement grid go with them, so a planted foot stays on its joint
async function cycle(name, action, stride, arch, frames = 12, sideYaw = Math.PI / 2, cycles = 1) {
  const [h] = await spare(arch, 1);
  const tiles = [];
  for (let k = 0; k < frames; k++) {
    const c = k % 6, r = Math.floor(k / 6), tw = Math.floor(W / 6), th = Math.floor(H / (frames / 6));
    const ph = 0.37 + (k / frames) * cycles, Z = ph * stride;
    tiles.push({ x: c * tw, y: r * th, w: tw, h: th, eye: eyeAt(4.3, 1.05, Z), target: [0, 0.9, Z], fov: 34, groundZ: 0, poses: [{ h, x: 0, z: Z, yaw: 0, action, phase: ph }], shadow: 4, labels: [{ text: `${(ph % 1).toFixed(2)}`, x: 0, y: 2.0, z: Z }], labelPx: 10 });
  }
  await shot(name, tiles);
}
if (on('walk')) await cycle('walk', 'walk', 1.42, byId[process.env.WHO || 'developerChad']);
if (on('run')) await cycle('run', 'run', 2.2, byId[process.env.WHO || 'gymBro']);
// front-on walk (arm swing, hip drop, shoulder twist)
if (on('walkfront')) {
  const [h] = await spare(byId[process.env.WHO || 'developerChad'], 1);
  const tiles = [];
  for (let k = 0; k < 12; k++) {
    const c = k % 6, r = Math.floor(k / 6), tw = Math.floor(W / 6), th = Math.floor(H / 2), ph = 0.37 + k / 12, Z = ph * 1.42;
    tiles.push({ x: c * tw, y: r * th, w: tw, h: th, eye: eyeAt(0.4, 1.15, Z + 4.4), target: [0, 0.9, Z], fov: 34, poses: [{ h, x: 0, z: Z, yaw: 0, action: 'walk', phase: ph }], shadow: 4 });
  }
  await shot('walkfront', tiles);
}
// standing about: the same standing action at different moments and for different people (weight shift, look-around, arms)
if (on('idle')) {
  const ids = ['developerChad', 'hoaPresident', 'karen', 'bigDale', 'zoningLawyer', 'techBro', 'trucker', 'communeHippie', 'egirl', 'oldTimerEarl', 'gymBro', 'goth'].map((k) => byId[k]);
  const tiles = ids.map((id, k) => {
    const c = k % 6, r = Math.floor(k / 6), tw = Math.floor(W / 6), th = Math.floor(H / 2), x = 10 * k;
    return { x: c * tw, y: r * th, w: tw, h: th, eye: eyeAt(x + 1.4, 1.2, 5.2), target: [x, 0.95, 0], fov: 30, poses: [{ h: hands[id], x, z: 0, yaw: 0.35, action: 'idle', phase: 7.3 + k * 2.9 }], labels: [{ text: roster[id].name, x, y: 2.05, z: 0 }], labelPx: 10, shadow: 5 };
  });
  await shot('idle', tiles);
}
// one person standing, sampled over ~40 seconds
if (on('idle2')) {
  const who = byId[process.env.WHO || 'developerChad'];
  const extra = await spare(who, 12);
  const tiles = extra.map((h, k) => {
    const c = k % 6, r = Math.floor(k / 6), tw = Math.floor(W / 6), th = Math.floor(H / 2), x = 10 * k;
    return { x: c * tw, y: r * th, w: tw, h: th, eye: eyeAt(x + 1.6, 1.2, 5.0), target: [x, 0.95, 0], fov: 30, poses: [{ h, x, z: 0, yaw: 0.3, action: 'idle', phase: 1 + k * 3.4 }], labels: [{ text: `t=${(1 + k * 3.4).toFixed(1)}s`, x, y: 2.05, z: 0 }], labelPx: 10, shadow: 5 };
  });
  await shot('idle2', tiles);
}

// feet on the ground: the model's own vertex shader run on the GPU for one person, every deformed vertex read back, and how far
// the lowest vertices of each shoe move over the pavement while they are on it (0% = planted, 100% = skating with the body)
if (on('feet')) {
  const rows = [];
  for (const who of (process.env.WHOS || 'karen,cryptoBro,floridaMan,bigDale,influencer,brainrotKid,granny').split(',')) {
    const arch = byId[who === 'granny' ? 'golfCartGrandma' : who];
    if (arch === undefined) continue;
    const [h] = await spare(arch, 1);
    for (const [action, stride, speed] of [['walk', 1.42, 1.4], ['run', 2.2, 3]]) {
      const cyc = 4, step = 0.02;
      const r = await page.evaluate(([a]) => window.__people.probe(a), [{ h, action, step, samples: Math.round((cyc * stride) / step), stride }]);
      rows.push({ who, action, ...r });
      const b = r['band0.012'], c = r['band0.03'];
      console.log(`${who.padEnd(14)} ${action.padEnd(4)} sole y ${String(r.sole).padStart(7)}  slide mean ${String(c.slideMeanPct).padStart(5)}% p95 ${String(c.slideP95Pct).padStart(5)}% max ${String(c.slideMaxPct).padStart(5)}% (3 cm band)   ${String(b.slideMeanPct).padStart(5)}% / ${String(b.slideP95Pct).padStart(5)}% (1.2 cm)   contact L ${c.contactFracL} R ${c.contactFracR} airborne ${c.airborneFrac}   top ${r.topRange}`);
    }
  }
  writeFileSync(`${out}/feet.json`, JSON.stringify(rows, null, 1));
  // the check: a foot that is on the ground (its lowest vertices within 1.2 cm of the sole level) stays put - mean slide under 12% of the
  // ground speed, in every walk and run sampled - and the sole touches the pavement (the lowest shoe vertex within 1 cm of y = 0). The old
  // model floated 3-6 cm up and its feet moved at 120-160% of the ground speed. The 3 cm band and the 95th percentile are printed but not
  // held to a limit: they also catch the toe-off and heel-strike frames and the low swing of the shuffling elder walk.
  const worst = (f) => Math.max(...rows.map(f));
  const slide = worst((r) => r['band0.012'].slideMeanPct), p95 = worst((r) => r['band0.012'].slideP95Pct), sole = worst((r) => Math.abs(r.sole));
  const ok = (label, good, extra) => { console.log(good ? 'OK  ' : 'FAIL', label, extra); if (!good) errs.push('feet check: ' + label); };
  ok('feet stay put while planted', slide < 12, `(worst mean slide ${slide}% of the ground speed within 1.2 cm of the sole; worst p95 ${p95}%)`);
  ok('feet touch the ground', sole < 0.01, `(lowest shoe vertex ${sole} m from the pavement in the worst case)`);
}


// what a crowd costs: the same frame with the people group shown and hidden (setVisible), alternated so the drift of a shared machine
// cancels, the GL queue drained after every frame (the software GPU's time is in it). The scene is only the pavement, the sun's shadow map and
// the people, so the difference is the people group alone: 2 draw calls plus the shadow pass, every allocated instance included. Three crowds,
// each built and removed in turn so the instance count is 120 in all of them: 120 people on the near figure, 120 on the far one, and a street
// of 40 near + 80 far. Run it on the old code and on the new one (BASE_URL=.../old, .../new; W=640 H=360 is enough).
if (on('bench')) {
  const mk = (n, seed) => Array.from({ length: n }, (_, i) => ({ arch: (i * 7 + seed) % N, action: i % 3 === 2 ? 'idle' : 'walk', phase: (i * 0.173) % 1 }));
  const place = (hs, list, xr, zr) => hs.map((h, i) => ({ h, x: xr[0] + ((i * 0.618) % 1) * (xr[1] - xr[0]), z: zr[0] + ((i * 0.381 + 0.13) % 1) * (zr[1] - zr[0]), yaw: 0.4 + i * 0.37, action: list[i].action, phase: list[i].phase }));
  const scenes = [
    { name: 'near crowd (120 people, 30-55 m)', parts: [[120, 0, [-16, 16], [-6, 14]]], eye: [0, 8, 42], target: [0, 1, 0], shadow: 30 },
    { name: 'far crowd (120 people, 150-200 m)', parts: [[120, 3, [-45, 45], [-150, -100]]], eye: [0, 14, 60], target: [0, 1, -125], shadow: 80 },
    { name: 'street (40 near + 80 far)', parts: [[40, 5, [-12, 12], [-8, 8]], [80, 9, [-40, 40], [-150, -100]]], eye: [0, 10, 45], target: [0, 1, -40], shadow: 60 },
  ];
  const rows = [];
  await page.evaluate((hs) => hs.forEach((h) => window.__people.remove(h)), hands); // the lineup's own 69 would be drawn too: 120 instances in every crowd
  for (const sc of scenes) {
    const poses = [];
    for (const [n, seed, xr, zr] of sc.parts) {
      const list = mk(n, seed);
      const hs = await page.evaluate((l) => l.map((r) => window.__people.spawn(r.arch, r.arch * 3761 + 17)), list);
      poses.push(...place(hs, list, xr, zr));
    }
    const res = await page.evaluate(({ sc, poses, W, H, rounds, frames }) => {
      const api = window.__people;
      const gl = document.querySelector('canvas').getContext('webgl2');
      const tiles = [{ x: 0, y: 0, w: W, h: H, eye: sc.eye, target: sc.target, fov: 40, poses, shadow: sc.shadow }];
      const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
      const px = new Uint8Array(4);
      // readPixels of one pixel is what really waits for the software GPU (finish() alone returned in 0.3 ms with 300 k triangles queued)
      const runs = (show) => { api.setVisible(show); const a = []; for (let k = 0; k < frames; k++) { const t0 = performance.now(); api.render(tiles); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); a.push(performance.now() - t0); } return { ms: med(a), ...api.info() }; };
      runs(true); runs(false);
      const on = [], off = [], delta = [];
      let a, b;
      for (let r = 0; r < rounds; r++) { a = runs(false); b = runs(true); off.push(a.ms); on.push(b.ms); delta.push(b.ms - a.ms); }
      api.setVisible(true);
      const d = delta.slice().sort((p, q) => p - q);
      return { on: med(on), off: med(off), delta: med(delta), lo: d[0], hi: d[d.length - 1], calls: b.calls - a.calls, tris: b.triangles - a.triangles };
    }, { sc, poses, W, H, rounds: +(process.env.ROUNDS || 9), frames: +(process.env.FRAMES || 3) });
    await page.evaluate((hs) => hs.forEach((h) => window.__people.remove(h)), poses.map((p) => p.h));
    rows.push({ scene: sc.name, people: poses.length, ...res });
    console.log(`${sc.name.padEnd(36)} people group: ${res.delta.toFixed(1)} ms per frame (range ${res.lo.toFixed(1)} .. ${res.hi.toFixed(1)}; ${res.on.toFixed(1)} with, ${res.off.toFixed(1)} without) = ${(1000 * res.delta / poses.length).toFixed(0)} us per person, ${res.calls} draw calls, ${res.tris} triangles`);
  }
  writeFileSync(`${out}/bench.json`, JSON.stringify(rows, null, 1));
}

const info = await page.evaluate(() => window.__people.info());
console.log('renderer', JSON.stringify(info), 'errors', JSON.stringify(errs.slice(0, 5)));
await browser.close();
process.exit(errs.length ? 1 : 0);
