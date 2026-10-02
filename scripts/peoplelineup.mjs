// Shoot the pedestrian models on the no-game lineup page (dev/people.html): the whole cast at true 8 / 30 / 100 m, by day and
// by night, plus close-up sheets of every action and the walk / run / idle cycles frame by frame. The page needs no town, so a
// capture takes seconds, not the minute a game load costs. Same camera on the old and the new code: run once against the frozen
// old server and once against a snapshot of your work, then compare the two folders.
//
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5181 OUT=shots/people/after node scripts/peoplelineup.mjs [sheet ...]
//   sheets (default: all; `lists` and `bench` and `feet` are checks, not sheets): row8 row8n grid30 grid30n grid100 grid100n crowd60 crowd24 actions walk run idle idle2 near1..near6
//   env: JPEG=1 to write JPEG (quality 85, what docs/screenshots wants), else PNG; W, H = viewport (default 1280x720)
//        PRESET=low|medium|high|ultra loads the page with that quality preset's people knobs and shadow map (default: none, the renderer's own defaults = High)
//        bench: N=120 people per crowd, SCENE=0,1 picks crowds (default 0,1,2; 0 near 30-55 m, 1 far, 2 street, 3 close 12-30 m, 4 play view: 60 m camera,
//        people spread round the target, 5 and 6 a phone canvas, W=585 H=1266: 40 people, a 24 m and a 60 m camera), BREAKDOWN=1 (PARTS="shadows off" ...)
//        BASES=old=url,base=url#q=low&near=64&lite=0,new=url compares builds (and single knobs of a preset: #q=low&near=&max=&shadow=&lite=) in one run, alternately
//        lists: the draw lists against the preset's knobs, OK/FAIL lines (PRESETS=low,medium,high,ultra for each on its own page)
//        crowd60, crowd24 (with BASES, one JPEG per build): 40 people on the pavement seen from the game's camera at 60 m / 24 m
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.BASE_URL || (process.env.BASES ? process.env.BASES.split(',')[0].split('=').slice(1).join('=').split('#')[0] : 'http://127.0.0.1:5173');
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
await page.goto(`${base}/dev/people.html${process.env.PRESET ? `?q=${process.env.PRESET}` : ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__people?.ready, null, { timeout: 180000 });
const roster = await page.evaluate(() => window.__people.archetypes);
const N = roster.length;
// one person per archetype (colours come from the seed, the same on every run), plus spares for the sheets that repeat one
const hands = await page.evaluate((n) => Array.from({ length: n }, (_, i) => window.__people.spawn(i, i * 3761 + 17)), N);
const spare = async (arch, count) => page.evaluate(([a, c]) => Array.from({ length: c }, () => window.__people.spawn(a, a * 3761 + 17)), [arch, count]);
const byId = Object.fromEntries(roster.map((r) => [r.id, r.i]));
const KNOWN = new Set(['walk', 'run', 'idle', 'smoke', 'drink', 'vape', 'phone', 'protest', 'dance', 'drum', 'yoga', 'sit', 'lie', 'fight']);
const naturalAction = (i) => (roster[i].vices.find((v) => KNOWN.has(v) && v !== 'lie' && v !== 'run') ?? 'idle');

async function shot(name, tiles, zoom, pg = page) {
  await pg.evaluate((t) => window.__people.render(t), tiles);
  const file = `${out}/${name}.${jpeg ? 'jpg' : 'png'}`;
  const buf = await pg.screenshot(jpeg ? { path: file, type: 'jpeg', quality: 85, timeout: 180000 } : { path: file, timeout: 180000 });
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

// a crowd on the pavement as the game's camera sees it: 40 people spread over the ground the camera looks at, 60 m (the usual play height) or 24 m out at the
// game's 50 degrees and a 0.5 / 0.35 rad pitch, the same people and places on every build (W=585 H=1266 is the Low phone's canvas; PRESET=low gives the Low knobs)
function crowdSheet(dist, pitch, crowd) {
  const poses = [], n = crowd.length;
  const halton = (i, b) => { let f = 1, r = 0; for (i += 1; i > 0; i = Math.floor(i / b)) { f /= b; r += f * (i % b); } return r; };
  const wx = dist * 0.2, zf = dist * 0.45, zb = dist * 0.3; // half the width of the view at the target, the depth in front of and behind it
  for (let i = 0; i < n; i++) {
    const act = i % 5 === 4 ? 'idle' : 'walk';
    poses.push({ h: crowd[i], x: (halton(i, 2) * 2 - 1) * wx, z: halton(i, 3) * (zf + zb) - zf, yaw: (i * 2.399) % (2 * Math.PI), action: act, phase: 0.31 + i * 0.173 });
  }
  const c = Math.cos(pitch), sn = Math.sin(pitch);
  return [{ x: 0, y: 0, w: W, h: H, eye: [0, 1 + sn * dist, c * dist], target: [0, 1, 0], fov: 50, poses, night: false, shadow: dist * 1.2 }];
}
if (on('crowd60') || on('crowd24')) {
  // BASES=old=url,base=url,new=url#q=low: the same crowd on each build, one picture each (crowd60-old.jpg ...)
  const targets = process.env.BASES
    ? process.env.BASES.split(',').map((t) => { const i = t.indexOf('='), rest = t.slice(i + 1), j = rest.indexOf('#'); return { label: t.slice(0, i), url: j < 0 ? rest : rest.slice(0, j), query: j < 0 ? '' : rest.slice(j + 1) }; })
    : [{ label: '', url: base, query: '' }];
  for (const t of targets) {
    let pg = page;
    if (t.label) {
      pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      pg.on('pageerror', (e) => { if (!noise(e.message)) errs.push(`${t.label}: ${e.message}`); });
      await pg.goto(`${t.url}/dev/people.html${t.query ? `?${t.query}` : process.env.PRESET ? `?q=${process.env.PRESET}` : ''}`, { waitUntil: 'load', timeout: 180000 });
      await pg.waitForFunction(() => window.__people?.ready, null, { timeout: 180000 });
    }
    const crowd = await pg.evaluate((n) => Array.from({ length: 40 }, (_, i) => window.__people.spawn((i * 7) % n, ((i * 7) % n) * 3761 + 17)), N);
    if (on('crowd60')) await shot('crowd60' + (t.label ? '-' + t.label : ''), crowdSheet(60, 0.5, crowd), undefined, pg);
    if (on('crowd24')) await shot('crowd24' + (t.label ? '-' + t.label : ''), crowdSheet(24, 0.35, crowd), undefined, pg);
  }
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

// the switch between the near and the far figure: 13 people every 2.5 m from 50 to 80 m ahead of the camera, side by side across the picture;
// every one of them must be drawn (the near figure up to 64 m, the far one beyond) - nobody may vanish between the two
if (on('lod')) {
  const poses = [], labels = [];
  for (let k = 0; k < 13; k++) {
    const dist = 50 + 2.5 * k, x = (k - 6) * 3.4;
    poses.push({ h: hands[(k * 5) % N], x, z: -dist, yaw: 0.3, action: 'idle', phase: 2 + k });
    labels.push({ text: `${dist} m`, x, y: 2.2, z: -dist });
  }
  await shot('lod', [{ x: 0, y: 0, w: W, h: H, eye: [0, 1.7, 0], target: [0, 1.0, -65], fov: 26, poses, night: false, labels, labelPx: 11, shadow: 60 }]);
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


// who is on which draw list (new model only): people placed round a camera by distance and bearing, the lists read back and compared with what the
// preset's knobs say (PRESET=low: near 40 m, at most 12 near figures, shadows within 120 m). In view = within +-12 degrees of the camera's line (the
// frustum, widened, is +-38 degrees); out of view = to the side or behind; a person out of view casts a shadow only when within a shadow's reach (24 m)
// of the frustum: the close groups (8 to 14 m from a camera that sees nothing behind or beside it) do, the mid and far ones do not.
// PRESETS=low,medium,high checks each preset's knobs, on a page of its own.
if (on('lists')) {
  const groups = [ // [name, count, r0, r1, bearing in degrees (from the camera's forward), spread, in view, shadow reach]
    ['near, in view', 8, 12, 30, 0, 12, true], ['crowd, in view', 14, 15, 36, 6, 6, true], ['far, in view', 6, 90, 110, 0, 12, true], ['very far, in view', 6, 160, 200, 0, 8, true],
    ['behind, close', 6, 8, 12, 180, 10, false, true], ['behind, mid', 6, 60, 70, 180, 10, false, false], ['behind, far', 6, 300, 340, 180, 10, false, false],
    ['side, close', 6, 10, 14, 90, 10, false, true], ['side, mid', 6, 60, 70, 90, 10, false, false], ['side, far', 6, 160, 200, 90, 10, false, false],
  ];
  const presets = process.env.PRESETS ? process.env.PRESETS.split(',') : [process.env.PRESET || ''];
  for (const [pi, presetName] of presets.entries()) {
    let pg = page;
    if (presetName !== (process.env.PRESET || '') || pi > 0) {
      pg = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
      pg.on('pageerror', (e) => { if (!noise(e.message)) errs.push(`${presetName}: ${e.message}`); });
      await pg.goto(`${base}/dev/people.html${presetName ? `?q=${presetName}` : ''}`, { waitUntil: 'load', timeout: 180000 });
      await pg.waitForFunction(() => window.__people?.ready, null, { timeout: 180000 });
    }
    const make = (arch, count) => pg.evaluate(([a, c]) => Array.from({ length: c }, () => window.__people.spawn(a, a * 3761 + 17)), [arch, count]);
    const det = await pg.evaluate(() => window.__people.detail());
    await pg.evaluate(() => window.__people.parkAll?.());
    const people = [];
    let k = 0;
    for (const [name, count, r0, r1, bearing, spread, view, reach] of groups) {
      const hs = await make(k % N, count);
      hs.forEach((h, i) => {
        const r = r0 + ((i * 0.618) % 1) * (r1 - r0), a = ((bearing + (((i * 0.37) % 1) - 0.5) * 2 * spread) * Math.PI) / 180;
        people.push({ h, name, r, d: Math.hypot(r, 1), view, reach: view || reach, x: r * Math.sin(a), z: -r * Math.cos(a) }); // (d: from the camera, 2 m up, to the middle of a person, 1 m up)
      });
      k++;
    }
    await pg.evaluate((poses) => window.__people.render([{ x: 0, y: 0, w: 320, h: 180, eye: [0, 2, 0], target: [0, 1.5, -50], fov: 40, poses: poses.map((p) => ({ h: p.h, x: p.x, z: p.z, yaw: 0, action: 'walk', phase: 0.3 + p.h * 0.1 })), shadow: 30 }]), people);
    const got = await pg.evaluate(() => ({ counts: window.__people.lists(), handles: window.__people.listHandles() }));
    const set = (a) => [...a].sort((x, y) => x - y).join(',');
    const cands = people.filter((p) => p.view && p.d <= det.near).sort((a, b) => a.d - b.d);
    const nearWant = cands.slice(0, det.nearMax).map((p) => p.h);
    const farWant = people.filter((p) => p.view && p.d < 1500 && !nearWant.includes(p.h)).map((p) => p.h);
    const castWant = people.filter((p) => p.reach && p.d <= Math.max(det.shadow, det.near * 1.1)).map((p) => p.h);
    const poseWant = new Set([...nearWant, ...farWant, ...castWant]);
    const tag = presetName || '(default)';
    const ok = (label, good, extra) => { console.log(good ? 'OK  ' : 'FAIL', `[${tag}]`, label, extra); if (!good) errs.push(`lists check [${tag}]: ${label}`); };
    console.log(`preset ${tag}: near ${det.near} m, at most ${det.nearMax}, shadow ${det.shadow} m; ${people.length} people placed, counts ${JSON.stringify(got.counts)}`);
    if (!got.handles) console.log('(the old renderer has no lists)');
    else {
      ok('near list = the nearest people in view within the near range', set(got.handles.near) === set(nearWant), `(want ${nearWant.length}, got ${got.handles.near.length})`);
      ok('far list = everybody else in view', set(got.handles.far) === set(farWant), `(want ${farWant.length}, got ${got.handles.far.length})`);
      ok('shadow list = everybody within the shadow range who is in view or within a shadow\'s reach of it', set(got.handles.shadow) === set(castWant), `(want ${castWant.length}, got ${got.handles.shadow.length})`);
      ok('pose list = everybody on any list', got.counts.pose === poseWant.size, `(want ${poseWant.size}, got ${got.counts.pose})`);
      ok('nobody behind or beside the camera is drawn in the view', people.filter((p) => !p.view).every((p) => !got.handles.near.includes(p.h) && !got.handles.far.includes(p.h)), '');
    }
  }
}

// what a crowd costs: the same frame with the people group shown and hidden (setVisible), alternated so the drift of a shared machine
// cancels, the GL queue drained after every frame (the software GPU's time is in it). The scene is only the pavement, the sun's shadow map and
// the people, so the difference is the people group alone: its draws in the view and in the shadow map, plus the pose pass (hidden switches it
// off too). Crowds of N (120) people, each built and removed in turn: 0 all near (30-55 m), 1 all far (150-200 m), 2 a street (a third near, the
// rest far), 3 all close (12-30 m), 4 the play view (a 60 m camera over people spread across 140 x 140 m, about half of them inside the frustum).
// Several builds can be measured in one run, alternating round by round (the machine's load changes from minute to minute, and a ratio between
// two runs made at different times measures the load): BASES=old=http://...:5231,base=http://...:5232,new=http://...:5234 (W=640 H=360 is enough).
if (on('bench')) {
  const NP = +(process.env.N || 120);
  const mk = (n, seed) => Array.from({ length: n }, (_, i) => ({ arch: (i * 7 + seed) % N, action: i % 3 === 2 ? 'idle' : 'walk', phase: (i * 0.173) % 1 }));
  const place = (hs, list, xr, zr) => hs.map((h, i) => ({ h, x: xr[0] + ((i * 0.618) % 1) * (xr[1] - xr[0]), z: zr[0] + ((i * 0.381 + 0.13) % 1) * (zr[1] - zr[0]), yaw: 0.4 + i * 0.37, action: list[i].action, phase: list[i].phase }));
  const scenes = [
    { name: `near crowd (${NP} people, 30-55 m)`, parts: [[NP, 0, [-16, 16], [-6, 14]]], eye: [0, 8, 42], target: [0, 1, 0], shadow: 30 },
    { name: `far crowd (${NP} people, 150-200 m)`, parts: [[NP, 3, [-45, 45], [-150, -100]]], eye: [0, 14, 60], target: [0, 1, -125], shadow: 80 },
    { name: `street (${Math.round(NP / 3)} near + ${NP - Math.round(NP / 3)} far)`, parts: [[Math.round(NP / 3), 5, [-12, 12], [-8, 8]], [NP - Math.round(NP / 3), 9, [-40, 40], [-150, -100]]], eye: [0, 10, 45], target: [0, 1, -40], shadow: 60 },
    { name: `close crowd (${NP} people, 12-30 m)`, parts: [[NP, 2, [-12, 12], [-2, 8]]], eye: [0, 5, 22], target: [0, 1, 0], shadow: 30 },
    // the usual play view: 60 m from the target at a 0.5 rad pitch, people spread over 140 x 140 m round it (about half of them inside the frustum)
    { name: `play view (${NP} people over 140 x 140 m, camera 60 m out)`, parts: [[NP, 4, [-70, 70], [-70, 70]]], eye: [0, 29, 53], target: [0, 1, 0], fov: 50, shadow: 90 },
    // what a phone's tall canvas (W=585 H=1266) sees of a street: 40 people on the ground the 24 m (5) and the 60 m (6) camera looks at
    { name: 'phone close (40 people, camera 24 m out)', parts: [[40, 6, [-4.8, 4.8], [-10.8, 7.2]]], eye: [0, 9.2, 22.5], target: [0, 1, 0], fov: 50, shadow: 30 },
    { name: 'phone play (40 people, camera 60 m out)', parts: [[40, 7, [-12, 12], [-27, 18]]], eye: [0, 29.8, 52.7], target: [0, 1, 0], fov: 50, shadow: 72 },
  ];
  const only = process.env.SCENE ? process.env.SCENE.split(',').map(Number) : [0, 1, 2]; // e.g. SCENE=1 for the far crowd alone, SCENE=0,1,2,3,4 for all five
  const targets = process.env.BASES
    ? process.env.BASES.split(',').map((t) => { const i = t.indexOf('='), rest = t.slice(i + 1), j = rest.indexOf('#'); return { label: t.slice(0, i), url: j < 0 ? rest : rest.slice(0, j), query: j < 0 ? '' : rest.slice(j + 1) }; })
    : [{ label: 'build', url: base }];
  const pgs = [];
  for (const [i, t] of targets.entries()) {
    let pg = page;
    if (i > 0 || t.query) {
      pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      pg.on('pageerror', (e) => { if (!noise(e.message)) errs.push(`${t.label}: ${e.message}`); });
      pg.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errs.push(`${t.label}: ${m.text()}`); });
      await pg.goto(`${t.url}/dev/people.html${t.query ? `?${t.query}` : process.env.PRESET ? `?q=${process.env.PRESET}` : ''}`, { waitUntil: 'load', timeout: 180000 });
      await pg.waitForFunction(() => window.__people?.ready, null, { timeout: 180000 });
    }
    pgs.push({ ...t, page: pg });
  }
  const rows = [];
  const rounds = +(process.env.ROUNDS || 9), frames = +(process.env.FRAMES || 3);
  // one alternation of hidden / shown in the page, with the parts of the figure switched as `cfg` says
  const round = ({ sc, poses, W, H, frames, cfg }) => {
    const api = window.__people;
    api.parts({ near: true, far: true, shadows: true, plain: 'off', flat: false, ...cfg });
    const gl = document.querySelector('canvas').getContext('webgl2');
    const tiles = [{ x: 0, y: 0, w: W, h: H, eye: sc.eye, target: sc.target, fov: sc.fov ?? 40, poses, shadow: sc.shadow }];
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    const px = new Uint8Array(4);
    // readPixels of one pixel is what really waits for the software GPU (finish() alone returned in 0.3 ms with 300 k triangles queued)
    const runs = (show) => { api.setVisible(show); const a = []; for (let k = 0; k < frames; k++) { const t0 = performance.now(); api.render(tiles); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); a.push(performance.now() - t0); } return { ms: med(a), ...api.info() }; };
    const a = runs(false), b = runs(true);
    api.setVisible(true); api.parts({ near: true, far: true, shadows: true, plain: 'off', flat: false });
    return { off: a.ms, on: b.ms, delta: b.ms - a.ms, calls: b.calls - a.calls, tris: b.triangles - a.triangles, lists: window.__people.lists() };
  };
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const measureAll = async (sc, cfg) => {
    for (const g of pgs) { await g.page.evaluate(round, { sc, poses: g.poses, W, H, frames, cfg }); g.r = []; } // (a warm-up round, thrown away)
    for (let k = 0; k < rounds; k++) for (const g of pgs) g.r.push(await g.page.evaluate(round, { sc, poses: g.poses, W, H, frames, cfg }));
    return pgs.map((g) => {
      const d = g.r.map((x) => x.delta).sort((p, q) => p - q), last = g.r[g.r.length - 1];
      return { build: g.label, delta: med(d), lo: d[0], hi: d[d.length - 1], on: med(g.r.map((x) => x.on)), off: med(g.r.map((x) => x.off)), calls: last.calls, tris: last.tris, lists: last.lists };
    });
  };
  for (const g of pgs) if (g.page === page) await page.evaluate((hs) => hs.forEach((h) => window.__people.remove(h)), hands); // the lineup's own 69 would be drawn too: 120 instances in every crowd
  for (const g of pgs) await g.page.evaluate(() => window.__people.parkAll?.()); // (and so would anybody an earlier sheet left standing)
  for (const sc of scenes.filter((_, i) => !only || only.includes(i))) {
    for (const g of pgs) {
      g.poses = [];
      for (const [n, seed, xr, zr] of sc.parts) {
        const list = mk(n, seed);
        const hs = await g.page.evaluate((l) => l.map((r) => window.__people.spawn(r.arch, r.arch * 3761 + 17)), list);
        g.poses.push(...place(hs, list, xr, zr));
      }
    }
    const res = await measureAll(sc, {});
    const want = process.env.PARTS ? process.env.PARTS.split(',') : null; // e.g. PARTS=plain limits the breakdown to the labels containing it
    const parts = {};
    if (process.env.BREAKDOWN) for (const [label, cfg] of [['shadows off', { shadows: false }], ['far figure hidden', { far: false }], ['near figure hidden', { near: false }], ['near, no shadows', { far: false, shadows: false }], ['far, no shadows', { near: false, shadows: false }], ['near, plain basic material', { far: false, shadows: false, plain: 'basic' }], ['near, plain standard material', { far: false, shadows: false, plain: 'standard' }], ['near, plain basic, not indexed', { far: false, shadows: false, plain: 'basic', flat: true }]].filter(([label]) => !want || want.some((w) => label.includes(w)))) {
      const b = await measureAll(sc, cfg);
      console.log(`    ${label.padEnd(30)} ${b.map((x) => `${x.build} ${x.delta.toFixed(0)} ms (range ${x.lo.toFixed(0)} .. ${x.hi.toFixed(0)})`).join('   ')}`);
      parts[label] = b.map((x) => ({ build: x.build, delta: x.delta }));
    }
    for (const g of pgs) await g.page.evaluate((hs) => hs.forEach((h) => window.__people.remove(h)), g.poses.map((p) => p.h));
    for (const x of res) {
      rows.push({ scene: sc.name, people: pgs[0].poses.length, ...x, parts });
      console.log(`${sc.name.padEnd(44)} ${x.build.padEnd(6)} people group: ${x.delta.toFixed(1)} ms per frame (range ${x.lo.toFixed(1)} .. ${x.hi.toFixed(1)}; ${x.on.toFixed(1)} with, ${x.off.toFixed(1)} without) = ${(1000 * x.delta / pgs[0].poses.length).toFixed(0)} us per person, ${x.calls} draw calls, ${x.tris} triangles${x.lists ? `, lists ${JSON.stringify(x.lists)}` : ''}; ${(100 * x.delta / Math.max(1e-9, res[0].delta)).toFixed(0)}% of ${res[0].build}, hidden-scene ${x.off.toFixed(0)} ms`);
    }
  }
  writeFileSync(`${out}/bench.json`, JSON.stringify(rows, null, 1));
}

const info = await page.evaluate(() => window.__people.info());
console.log('renderer', JSON.stringify(info), 'errors', JSON.stringify(errs.slice(0, 5)));
await browser.close();
process.exit(errs.length ? 1 : 0);
