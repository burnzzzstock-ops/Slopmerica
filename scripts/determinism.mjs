// Determinism: the same seed and the same inputs give the same city, however it is run.
// One seeded town with a scripted build order is grown several ways and the full-state fingerprint (window.__dbg.fingerprint():
// one hash per system) is compared at fixed days:
//   stepped   the debug hook's run(days)
//   again     the same a second time (a run must at least agree with itself)
//   f30       real frames of 1/30 s at top speed
//   f144      real frames of 1/144 s at top speed
//   reload    stepped, with a save and a full page reload from that save every RELOAD days       (MODES=...,reload)
//   low/ultra stepped on another graphics preset                                              (MODES=...,low,ultra)
// Every mode must agree with `stepped` on every system at every checkpoint. The table shows, per system, the first day a mode
// disagrees; "-" is agreement to the end.
// usage: BASE_URL=http://127.0.0.1:5173 node scripts/determinism.mjs [map]
//   env: SEED (default 1), DAYS (default 60), MODES (default stepped,again,f30,f144), RELOAD (default 30), QUALITY (default low),
//        TOWN=block|player (block: a fixed street grid, zones and services laid at day 0; player: the scripted commissioner of
//        scripts/lib/latePlayer.mjs acting every 5 days, in Ponzi mode), OUT=file.json (every fingerprint, for diffing two builds)
import { writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { installLatePlayer } from './lib/latePlayer.mjs';
import { seededInit, seededRandom, testSeed } from './refblock.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const map = process.argv[2] || process.env.MAP || 'norcal';
const DAYS = Number(process.env.DAYS || 60), RELOAD = Number(process.env.RELOAD || 30);
const MODES = (process.env.MODES || 'stepped,again,f30,f144').split(',').filter(Boolean);
const TOWN = process.env.TOWN || 'block', QUALITY = process.env.QUALITY || 'low';
const seed = testSeed();
const marks = [1, 2, 3, 5, 7, 10, 14, 20, 30, 45, 60, 90, 120, 180, 270, 365, 545, 730].filter((d) => d <= DAYS);
if (marks[marks.length - 1] !== DAYS) marks.push(DAYS);

const browser = await launch();
const pageErrors = [];

async function open(quality, save) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(({ quality, save }) => {
    try {
      localStorage.setItem('slopmerica.quality', quality); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1');
      localStorage.setItem('slopmerica.emergencySpeed', 'off');
      localStorage.setItem('slopmerica.packFrom', '0');   // every save in this test goes through the packer, however small the town
      if (save) localStorage.setItem('slopmerica.save.v1', save);
    } catch { /* */ }
  }, { quality, save: save ?? null });
  if (!save) await page.addInitScript(seededInit, { seed, rng: seededRandom.toString() });
  else await page.addInitScript(() => { let game; Object.defineProperty(window, '__game', { configurable: true, get: () => game, set: (g) => { game = g; g.start = () => {}; } }); });
  if (save) {
    await page.goto(`${base}/`, { waitUntil: 'load', timeout: 180000 });   // (no seed on the address: the save carries it)
    await page.waitForSelector('#continue', { timeout: 180000 });
    await page.click('#continue', { timeout: 240000 });
  } else {
    await page.goto(`${base}/#skip&map=${map}&mode=${TOWN === 'player' ? 'ponzi' : 'sandbox'}&start=best&seed=${seed}`, { waitUntil: 'load', timeout: 180000 });
  }
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 300000 });
  // (a county opened from a save keeps the dice the save carries: seeding them again would be a different county)
  await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
  return page;
}

/** the build order at day 0: the same calls in every mode */
const layBlock = () => {
  const g = window.__game, d = window.__dbg, SV = window.__services;
  d.unlockAll();
  const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z);
  d.road(cx - 330, cz, cx + 330, cz, 'stroad4');
  d.road(cx, cz - 300, cx, cz + 300, 'twoLane');
  for (const k of [-2, -1, 1, 2]) { d.road(cx - 260, cz + k * 95, cx + 260, cz + k * 95, 'twoLane'); d.road(cx + k * 95, cz - 230, cx + k * 95, cz + 230, 'twoLane'); }
  d.zone(cx - 50, cz - 45, 60, 'comLow'); d.zone(cx + 50, cz + 45, 60, 'comHigh');
  d.zone(cx + 50, cz - 45, 60, 'office'); d.zone(cx - 50, cz + 45, 60, 'resHigh');
  d.zone(cx - 190, cz - 150, 100, 'resLow'); d.zone(cx + 190, cz + 150, 100, 'resLow'); d.zone(cx - 190, cz + 150, 100, 'resLow');
  d.zone(cx + 190, cz - 150, 90, 'industry');
  d.zone(cx - 200, cz, 60, 'comLow'); d.zone(cx + 200, cz, 60, 'comLow');
  const place = (id, R) => { for (const r of R) for (let a = 0; a < 48; a++) { const x = cx + Math.cos((a / 48) * 6.283) * r, z = cz + Math.sin((a / 48) * 6.283) * r; if (SV.canPlace(g, id, x, z).ok && SV.place(g, id, x, z)) return true; } return false; };
  for (const id of ['school', 'clinic', 'fireStation', 'sheriff', 'park']) place(id, [120, 170, 230]);
  for (const id of ['coalPlant', 'wellTower', 'wellTower', 'wellTower', 'treatmentPlant', 'landfill']) { if (place(id, [420, 520, 640])) continue; for (const r of [420, 600, 800]) { const s = SV.findSpot?.(g, id, cx + r, cz); if (s && !s.reason && SV.place(g, id, s.x, s.z)) break; } }
  g.sim.growthMul = 3;
  g.rts.setView(cx, cz, 420, 0.6, 0.9, true);   // the same camera in every mode: people only exist near it today
};

/**
 * Advance to day `to` (counted in fixed steps from the start of the run) the way the mode says, and return the fingerprint after
 * exactly that many steps. Everything scripted happens inside the game's onStep hook at a set step number, so it is the same step
 * in every mode: a frame of 1/30 s at top speed covers more than one step, and a loop of frames would overshoot.
 */
const advance = ({ to, how, player }) => {
  const g = window.__game, d = window.__dbg;
  // (days are counted from step 0 of the county, which a save carries: a reloaded page goes on counting from where the save was)
  const D = (window.__det ??= { base: 0, want: new Map(), prints: {}, hooked: false });
  const at = (day) => D.base + g.stepsFor(day);
  if (!D.hooked) {
    D.hooked = true;
    g.onStep.push((n) => {
      const w = D.want.get(n);
      if (!w) return;
      D.want.delete(n);
      if (w.mark !== undefined) D.prints[w.mark] = d.fingerprint();
      if (w.act) window.__player.step(0);   // the scripted commissioner looks at the county and builds (no time passes: run(0))
    });
  }
  const from = Math.floor((g.steps - D.base) / g.stepsFor(1));
  D.want.set(at(to), { ...(D.want.get(at(to)) ?? {}), mark: to });
  if (player) for (let day = Math.floor(from / 5) * 5 + 5; day <= to; day += 5) D.want.set(at(day), { ...(D.want.get(at(day)) ?? {}), act: true });
  const speed = g.sim.speed;
  g.sim.speed = 3;
  if (how === 'f30' || how === 'f144') {
    const dt = how === 'f30' ? 1 / 30 : 1 / 144;
    for (let i = 0; i < 5e6 && !(to in D.prints); i++) g.frame(dt, false);
  } else {
    // by hand: the steps up to the mark, then one more so the hook at the mark fires (as it does in the frame modes)
    g.runSteps(at(to) - g.steps + 1);
  }
  g.sim.speed = speed;
  return D.prints[to];
};

const runs = {};
const roundTrips = [];
for (const mode of MODES) {
  const how = mode === 'f30' || mode === 'f144' ? mode : 'stepped';
  const quality = mode === 'low' || mode === 'ultra' ? mode : QUALITY;
  const t0 = Date.now();
  let page = await open(quality);
  if (TOWN === 'player') await page.evaluate(installLatePlayer, {});
  else await page.evaluate(layBlock);
  const prints = { 0: await page.evaluate(() => window.__dbg.fingerprint()) };
  let lastReload = 0;
  for (const to of marks) {
    if (mode === 'reload' && to - lastReload >= RELOAD) {
      const before = await page.evaluate(() => window.__dbg.fingerprint());
      const partsBefore = await page.evaluate(() => window.__dbg.dump());
      const save = await page.evaluate(() => { window.__dbg.save(); return localStorage.getItem('slopmerica.save.v1'); });
      const view = await page.evaluate(() => { const r = window.__game.rts; return [r.target.x, r.target.z, r.distance, r.yaw, r.pitch]; });
      await page.close();
      page = await open(quality, save);
      await page.evaluate(([x, z, dist, yaw, pitch]) => window.__game.rts.setView(x, z, dist, yaw, pitch, true), view);
      if (TOWN === 'player') await page.evaluate(installLatePlayer, { resume: true });
      // what came back different, before a single step: state the save did not carry (or did not put back)
      const after = await page.evaluate(() => window.__dbg.fingerprint());
      const lost = Object.keys(before).filter((k) => before[k] !== after[k]);
      const diffs = [];
      if (lost.length) {
        const partsAfter = await page.evaluate(() => window.__dbg.dump());
        for (const sys of lost) {
          const A = partsBefore[sys], B = partsAfter[sys];
          if (!A || !B) continue;
          const at = [];
          for (let i = 0; i < Math.max(A.length, B.length) && at.length < 6; i++) if (A[i] !== B[i]) at.push(`[${i}] ${String(A[i]).slice(0, 60)} -> ${String(B[i]).slice(0, 60)}`);
          diffs.push(`    ${sys} (${A.length} values before, ${B.length} after): ${at.join('; ')}`);
          // DUMP=dir: every value of each differing system, before and after, one a line (diff the two files)
          if (process.env.DUMP) { writeFileSync(`${process.env.DUMP}/${sys}.before.txt`, A.join('\n')); writeFileSync(`${process.env.DUMP}/${sys}.after.txt`, B.join('\n')); }
        }
      }
      roundTrips.push({ day: before.day, bytes: save.length, lost, diffs });
      lastReload = to;
    }
    prints[to] = await page.evaluate(advance, { to, how, player: TOWN === 'player' });
  }
  runs[mode] = prints;
  const last = prints[marks[marks.length - 1]];
  console.log(`${mode.padEnd(8)} day ${String(last.day).slice(0, 9).padEnd(9)} ${last.nBuildings} buildings, ${last.nCars} cars, ${last.nPeople} people  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await page.close();
}
await browser.close();
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ seed, map, town: TOWN, marks, runs }, null, 1));

// ---- compare every mode with the first
const ref = MODES[0], systems = Object.keys(runs[ref][0]).filter((k) => !/^n[A-Z]/.test(k));
let bad = 0;
console.log(`\nfirst day each system differs from "${ref}" (seed ${seed}, ${map}, ${TOWN}; "-" = the same to day ${DAYS}):`);
console.log(`${'system'.padEnd(16)}${MODES.slice(1).map((m) => m.padEnd(9)).join('')}`);
for (const sys of systems) {
  const cells = MODES.slice(1).map((m) => {
    const at = [0, ...marks].find((d) => runs[m][d][sys] !== runs[ref][d][sys]);
    if (at !== undefined) bad++;
    return String(at ?? '-').padEnd(9);
  });
  console.log(`${sys.padEnd(16)}${cells.join('')}`);
}
for (const r of roundTrips) {
  console.log(`save at day ${r.day} (${(r.bytes / 1024).toFixed(0)} kB): ${r.lost.length ? `came back different in ${r.lost.join(', ')}` : 'every system came back the same'}`);
  for (const d of r.diffs ?? []) console.log(d);
  if (r.lost.length) bad++;
}
if (pageErrors.length) { bad++; console.log(`page errors: ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}`); }
console.log(bad ? `FAIL ${bad} system/mode pairs differ` : `OK   every mode gives the same city as "${ref}" on every system to day ${DAYS}`);
process.exit(bad ? 1 : 0);
