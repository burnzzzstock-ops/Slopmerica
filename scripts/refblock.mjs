// The reference block (docs/ART_DIRECTION.md): a stroad with a side-street
// grid, strip retail, shopfronts, offices, apartments, houses, a factory yard
// and the civic buildings, on the Redwood Coast. Grown once and saved to
// shots/lookbook/town.json so every capture after that shows the same town;
// delete the file to grow a fresh one. Shared by lookbook.mjs and nighttest.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const SAVE = 'shots/lookbook/town.json';
export const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

async function grow(browser, base) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 300000 });
  const center = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, SV = window.__services;
    cancelAnimationFrame(g.raf);
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
    for (let i = 0; i < 10; i++) d.run(20);
    return { x: cx, z: cz };
  });
  const save = await page.evaluate(() => { window.__dbg.save(); return localStorage.getItem('slopmerica.save.v1'); });
  await page.close();
  mkdirSync('shots/lookbook', { recursive: true });
  writeFileSync(SAVE, save);
  writeFileSync(SAVE.replace('.json', '.center.json'), JSON.stringify(center));
}

/** The tests' Math.random: mulberry32, the same numbers for the same seed. */
export const seededRandom = (seed) => {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
/** SEED from the environment, or a fresh one; print it so a run can be replayed */
export function testSeed() {
  const seed = process.env.SEED !== undefined ? Number(process.env.SEED) >>> 0 : (Math.random() * 2 ** 31) >>> 0;
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
export async function openBlock(browser, { base, quality = 'high', width = 1280, height = 720, phone = false, dpr = 1, seed }) {
  if (!existsSync(SAVE)) await grow(browser, base);
  const save = readFileSync(SAVE, 'utf8');
  const center = JSON.parse(readFileSync(SAVE.replace('.json', '.center.json'), 'utf8'));
  // phone: a real touch context (3x screen, touch, mobile UA), which is what makes the game pick the phone's pixel ratio and MSAA
  const page = await browser.newPage(phone ? { viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width, height }, deviceScaleFactor: dpr });
  const errs = [], vault = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // (the asset pack gives up after 15 s: on a busy machine a run can build the town
  // without it, and a different town gives different numbers from the same seed)
  page.on('console', (m) => { if (m.text().startsWith('[vault]')) vault.push(m.text()); });
  await page.addInitScript(({ save, quality }) => { try { localStorage.setItem('slopmerica.quality', quality); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, { save, quality });
  if (seed !== undefined) {
    await page.addInitScript(({ seed, rng }) => {
      const make = new Function(`return (${rng})`)();
      window.__reseed = (s) => { Math.random = make(s); };
      window.__reseed(seed);
      // the game sets window.__game, then starts its loop in the same tick: keep the loop from ever starting
      let game;
      Object.defineProperty(window, '__game', { configurable: true, get: () => game, set: (g) => { game = g; g.start = () => {}; } });
    }, { seed, rng: seededRandom.toString() });
  }
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('#continue', { timeout: 180000 });
  await page.click('#continue');
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
  const town = await page.evaluate((seed) => {
    const g = window.__game;
    cancelAnimationFrame(g.raf);
    if (seed !== undefined) window.__reseed(seed);
    for (const e of document.querySelectorAll('.hud, .xfeed, .toast, .next-bar, .side-cards')) e.style.display = 'none';
    // mid-summer: the block was saved later in the year, so count whole days from here too, or
    // no day ticks (services, freight, demand, growth) until the old date comes round
    g.sim.day = 120;
    g.sim.lastWhole = Math.floor(g.sim.day);
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
