// The reference block (docs/ART_DIRECTION.md): a stroad with a side-street
// grid, strip retail, shopfronts, offices, apartments, houses, a factory yard
// and the civic buildings, on the Redwood Coast. The town is a committed fixture
// (scripts/fixtures/refblock-town.json.gz), so every capture on every machine shows the
// same one and the node-only junction checks need no browser to have run first.
// Delete the file to grow a fresh one (then every number measured on it moves: say so
// in the commit). Shared by lookbook.mjs, nighttest.mjs and the traffic tests.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OLD_TOWN, readSave, REFBLOCK, REFBLOCK_CENTER, writeSave } from './lib/fixtures.mjs';

export const SAVE = REFBLOCK;
export { EXE, ARGS } from './lib/browser.mjs';

/**
 * Grow the reference town (only when the fixture is missing). The block is laid out from the end of the county road, square to
 * the map: the stroad carries on from where the county road stops (drawn across the site, as it used to be, it overlapped the
 * county road and was refused, and the town grew without its main street). Beyond the stroad's far end a works road has the
 * power plants and the landfill, wells stand by it, and a road runs to the nearest shore for the sewage outfall. Every road and
 * every service must go in, and the town must be running (power, water, sewage for everyone, few abandoned) or nothing is saved.
 */
async function grow(browser, base) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox&start=best&seed=1`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 300000 });
  const out = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, SV = window.__services, T = g.terrain;
    cancelAnimationFrame(g.raf);
    d.unlockAll();
    const S = g.startView();
    // where the county road stops, exactly (the stroad starts on that node), and which way it was heading
    const end = [...g.net.nodes.values()].filter((n) => n.segs.length === 1).sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[0];
    if (!end || Math.hypot(end.x - S.x, end.z - S.z) > 60) throw new Error('refblock: the county road does not end at the town site');
    const from = S.route && S.route.length > 1 ? S.route[S.route.length - 2] : S.edge;
    const hx = S.x - from.x, hz = S.z - from.z;
    const ax = Math.abs(hx) >= Math.abs(hz) ? { x: Math.sign(hx), z: 0 } : { x: 0, z: Math.sign(hz) }, nx = { x: -ax.z, z: ax.x };
    const C = { x: end.x + ax.x * 330, z: end.z + ax.z * 330 };
    // (u along the stroad from the block's middle, v across it)
    const P = (u, v) => ({ x: C.x + ax.x * u + nx.x * v, z: C.z + ax.z * u + nx.z * v });
    const road = (u1, v1, u2, v2, type) => { const a = P(u1, v1), b = P(u2, v2), r = d.road(a.x, a.z, b.x, b.z, type); if (typeof r !== 'number' || r < 1) throw new Error(`refblock: the road (${u1}, ${v1}) to (${u2}, ${v2}) was not built: ${r}`); };
    const zone = (u, v, r, z) => { const p = P(u, v); if (!d.zone(p.x, p.z, r, z)) throw new Error(`refblock: no ${z} lots at (${u}, ${v})`); };
    road(-330, 0, 330, 0, 'stroad4');
    road(0, -300, 0, 300, 'twoLane');
    for (const k of [-2, -1, 1, 2]) { road(-260, k * 95, 260, k * 95, 'twoLane'); road(k * 95, -230, k * 95, 230, 'twoLane'); }
    road(330, 0, 700, 0, 'twoLane');   // the works road
    zone(-50, -45, 60, 'comLow'); zone(50, 45, 60, 'comHigh');
    zone(50, -45, 60, 'office'); zone(-50, 45, 38, 'resHigh');
    zone(-190, -150, 66, 'resLow'); zone(190, 150, 66, 'resLow'); zone(-190, 150, 66, 'resLow');
    zone(190, -150, 90, 'industry');
    zone(-200, 0, 60, 'comLow'); zone(200, 0, 60, 'comLow');
    // the nearest free spot for a service around a point (the game's own finder, on a widening spiral)
    const near = (id, u, v, maxR = 500) => {
      const t = P(u, v);
      for (let rr = 0; rr <= maxR; rr += 40) for (let k = 0, n = rr === 0 ? 1 : 16; k < n; k++) {
        const sp = SV.findSpot(g, id, t.x + Math.cos(k * 0.39 + rr) * rr, t.z + Math.sin(k * 0.39 + rr) * rr);
        if (sp.reason || !SV.canPlace(g, id, sp.x, sp.z, sp.yaw).ok) continue;
        const b = SV.place(g, id, sp.x, sp.z, sp.yaw);
        if (b) return b;
      }
      throw new Error(`refblock: nowhere for a ${id} near (${u}, ${v})`);
    };
    for (const id of ['school', 'clinic', 'fireStation', 'sheriff', 'park']) near(id, 0, 0, 300);
    near('gasPeaker', 440, -40); near('gasPeaker', 520, 40);
    near('landfill', 620, -60); near('landfill', -150, 250, 300);
    near('wellTower', 380, 40); near('wellTower', 470, 60); near('wellTower', 400, -60);
    // the shore nearest the block, and a road to it from the nearest street end: the sewage outfall must touch water
    let shore = null;
    for (let r = 100; r < 2500 && !shore; r += 40) for (let k = 0; k < 48; k++) { const x = C.x + Math.cos(k * 0.131) * r, z = C.z + Math.sin(k * 0.131) * r; if (T.h(x, z) < -0.5) { shore = { x, z }; break; } }
    if (!shore) throw new Error('refblock: no shore within 2.5 km of the block');
    const ends = [...g.net.nodes.values()].filter((n) => n.segs.length === 1 && n.id !== end.id && Math.hypot(n.x - C.x, n.z - C.z) < 420).sort((a, b) => Math.hypot(a.x - shore.x, a.z - shore.z) - Math.hypot(b.x - shore.x, b.z - shore.z));
    let reached = false;
    for (const n of ends.slice(0, 6)) {
      const L = Math.hypot(shore.x - n.x, shore.z - n.z), r = d.road(n.x, n.z, n.x + ((shore.x - n.x) * (L - 28)) / L, n.z + ((shore.z - n.z) * (L - 28)) / L, 'twoLane');
      if (typeof r === 'number' && r > 0) { reached = true; break; }
    }
    if (!reached) throw new Error('refblock: no street end could be joined to the shore');
    { const u = (shore.x - C.x) * ax.x + (shore.z - C.z) * ax.z, v = (shore.x - C.x) * nx.x + (shore.z - C.z) * nx.z; near('sewageOutfall', u, v, 240); }
    g.sim.growthMul = 3;
    // a year and 120 days: a grown town, saved in mid-summer (day 0 is March 20), so it opens in summer light with no clock set by hand
    for (let i = 0; i < 20; i++) d.run(20);
    // over the last 85 days (about three and a half minutes of traffic), how long each car on the road has stood still: the
    // first town grown this way was saved with its main street locked for good behind three cars, and every traffic test
    // then measured a jam
    const stood = new Map();
    let stoodMost = 0;
    const watch = () => {
      const live = new Set();
      for (const c of g.traffic.cars) {
        live.add(c.id);
        if (c.parked || c.thru || c.crashed !== 0 || c.dep > 0 || c.v >= 0.05) stood.delete(c.id);
        else { const s = (stood.get(c.id) ?? 0) + 0.078125; stood.set(c.id, s); if (s > stoodMost) stoodMost = s; }
      }
      for (const id of stood.keys()) if (!live.has(id)) stood.delete(id);
    };
    g.onStep.push(watch);
    for (let i = 0; i < 4; i++) d.run(20);
    d.run(5);
    g.onStep.splice(g.onStep.indexOf(watch), 1);
    const standing = [...stood.values()].filter((s) => s > 60).length;
    // a town worth looking at, or no fixture
    const all = [...g.buildings.list.values()], zoned = all.filter((b) => b.zone !== 'service' && b.zone !== 'landmark');
    const U = SV.snapshot().util, off = all.filter((b) => b.offNet).map((b) => b.label);
    const abandoned = zoned.filter((b) => b.abandoned !== undefined).length;
    const facts = { people: g.sim.population, buildings: all.length, zoned: zoned.length, abandoned, roads: g.net.segs.size, junctions: g.net.nodes.size, cars: g.traffic.cars.length, standingOver60s: standing, longestStand: Math.round(stoodMost), day: Math.round(g.sim.day), cutOff: { power: U.power.unserved, water: U.water.unserved, sewage: U.sewage.unserved }, notLinked: off };
    if (off.length || U.power.unserved || U.water.unserved || U.sewage.unserved || abandoned > zoned.length * 0.05 || g.sim.population < 500) throw new Error(`refblock: the town is not running: ${JSON.stringify(facts)}`);
    if (standing > 0 || stoodMost > 120) throw new Error(`refblock: the town's traffic is jammed (cars standing on the road for over a minute at the save, or one that stood over two): ${JSON.stringify(facts)}`);
    return { center: { x: Math.round(C.x), z: Math.round(C.z) }, facts, save: d.snapshot() };
  });
  await page.close();
  console.error(`refblock: no fixture at ${SAVE}; grew a new reference town (commit it, or every run grows another): ${JSON.stringify(out.facts)}`);
  mkdirSync(dirname(SAVE), { recursive: true });
  writeSave(SAVE, out.save);
  writeFileSync(REFBLOCK_CENTER, JSON.stringify(out.center));
}

/** The tests' Math.random: mulberry32, the same numbers for the same seed. */
export const seededRandom = (seed) => {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
/**
 * The page side of a seeded run (pass to page.addInitScript with { seed, rng: seededRandom.toString() }):
 * Math.random seeded before the page's own code runs, window.__reseed(n) to seed it again, and the
 * game's real-time loop kept from ever starting (the game sets window.__game, then starts its loop in
 * the same tick). The feed draws from a stream of its own: it lets a kind of post through only so
 * often by the wall clock, so on a slower machine more posts got through, each one drew from
 * Math.random, and every number after that changed (same seed, 8x slower CPU: the traffic parted
 * within 10 s of game time).
 */
export function seededInit({ seed, rng }) {
  const make = new Function(`return (${rng})`)();
  // the county's own dice (what the simulation rolls) start from the seed too: a new county reads window.__seed, and a town
  // opened from a save is reseeded once it is up (window.__reseed, below and in openBlock)
  window.__seed = seed;
  window.__reseed = (s) => { Math.random = make(s); window.__game?.reseed?.(s); };
  window.__reseed(seed);
  let game;
  Object.defineProperty(window, '__game', {
    configurable: true,
    get: () => game,
    set: (g) => {
      game = g;
      g.start = () => {};
      const feed = g.feed, own = make((seed ^ 0x5f3759df) >>> 0);
      for (const k of ['push', 'update']) {
        const fn = typeof feed?.[k] === 'function' ? feed[k].bind(feed) : null;
        if (fn) feed[k] = (...a) => { const r = Math.random; Math.random = own; try { return fn(...a); } finally { Math.random = r; } };
      }
    },
  });
}
/** The run's seed: SEED from the environment, else 1 (so two runs of a test agree), else a fresh one with FUZZ=1; printed so a run can be replayed */
export function testSeed() {
  const seed = process.env.SEED !== undefined ? Number(process.env.SEED) >>> 0 : process.env.FUZZ === '1' ? (Math.random() * 2 ** 31) >>> 0 : 1;
  console.log(`seed ${seed} (replay with SEED=${seed})`);
  return seed;
}

/**
 * Open the block at a quality preset. Returns { page, errs, center, town }; the
 * game loop is stopped (drive it with g.frame), the HUD hidden, the date
 * mid-summer (and whole days tick from there).
 *
 * `seed` (a number): the same seed gives the same run on the same town. Math.random
 * is seeded before the page's own code runs, the game's real-time loop never
 * starts (it would advance the town by however long loading took), and
 * Math.random is seeded again once the game exists, so nothing that happened
 * while loading shifts the sequence. Everything after that is driven by the
 * test. `town` fingerprints the buildings as loaded (printed with a seed): a
 * run whose asset pack timed out builds other models, and isn't a replay.
 */
export async function openBlock(browser, { base, quality = 'high', width = 1280, height = 720, phone = false, dpr = 1, seed, save: other, center: otherCenter }) {
  // (save and center: another saved town to open the same way, for a test about one particular town)
  if (!other && !existsSync(SAVE)) {
    if (OLD_TOWN) throw new Error(`refblock: REFTOWN=v1 asks for the old reference town and ${SAVE} is missing (it is a committed file; it is never grown again)`);
    await grow(browser, base);
  }
  const save = readSave(other ?? SAVE);
  const center = other ? otherCenter ?? { x: 0, z: 0 } : JSON.parse(readFileSync(REFBLOCK_CENTER, 'utf8'));
  // phone: a real touch context (3x screen, touch, mobile UA), which is what makes the game pick the phone's pixel ratio and MSAA
  const page = await browser.newPage(phone ? { viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width, height }, deviceScaleFactor: dpr });
  const errs = [], vault = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // (the asset pack gives up after 15 s: on a busy machine a run can build the town
  // without it, and a different town gives different numbers from the same seed)
  page.on('console', (m) => { if (m.text().startsWith('[vault]')) vault.push(m.text()); });
  await page.addInitScript(({ save, quality }) => { try { localStorage.setItem('slopmerica.quality', quality); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, { save, quality });
  if (seed !== undefined) {
    await page.addInitScript(seededInit, { seed, rng: seededRandom.toString() });
  }
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('#continue', { timeout: 180000 });
  await page.click('#continue', { timeout: 240000 }); // (a Medium or High page under load draws a frame in seconds, and the click waits for the button to stand still over two of them)
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
  const town = await page.evaluate((seed) => {
    const g = window.__game;
    cancelAnimationFrame(g.raf);
    if (seed !== undefined) window.__reseed(seed);
    for (const e of document.querySelectorAll('.hud, .xfeed, .toast, .next-bar, .side-cards')) e.style.display = 'none';
    // (the town was saved in mid-summer, and opens there: its calendar, weather and every clock are the save's)
    g.frame(0.016); g.frame(0.016);
    // what the town was built from: the same seed only replays a run on the same town
    let h = 2166136261;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    for (const b of g.buildings.list.values()) {
      mix(b.id); mix(b.model.geometry?.attributes?.position?.count ?? 0); mix(b.model.spots?.length ?? 0);
      for (let i = 0; i < b.label.length; i++) mix(b.label.charCodeAt(i));
    }
    return h.toString(16);
  }, seed);
  if (seed !== undefined) console.log(`town ${town}${vault.length ? ` (${vault.join('; ')}: not the usual town, so not a replay)` : ''}`);
  return { page, errs, center, town };
}

/**
 * Set the hour, moon and weather, frame the camera, render. `view` is
 * [dx, dz, distance, yaw, pitch] from the block's centre.
 */
export async function shoot(page, center, { hour, moon = 0.5, weather = 'clear', view }) {
  await page.evaluate(({ center, hour, moon, weather, view }) => {
    const g = window.__game, d = window.__dbg;
    g.env.moonPhaseOverride = moon;
    g.weather.force(weather, 30); g.weather.settle(); g.weather.snowCover = 0;
    d.hour(hour);
    d.view(center.x + view[0], center.z + view[1], view[2], view[3], view[4]);
    for (let i = 0; i < 8; i++) g.frame(0.016);
  }, { center, hour, moon, weather, view });
}
