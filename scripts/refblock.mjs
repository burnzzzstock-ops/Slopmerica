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

/**
 * Open the block at a quality preset. Returns { page, errs, center }; the game
 * loop is stopped (drive it with g.frame), the HUD hidden, the date mid-summer
 * (and whole days tick from there).
 */
export async function openBlock(browser, { base, quality = 'high', width = 1280, height = 720, phone = false, dpr = 1 }) {
  if (!existsSync(SAVE)) await grow(browser, base);
  const save = readFileSync(SAVE, 'utf8');
  const center = JSON.parse(readFileSync(SAVE.replace('.json', '.center.json'), 'utf8'));
  // phone: a real touch context (3x screen, touch, mobile UA), which is what makes the game pick the phone's pixel ratio and MSAA
  const page = await browser.newPage(phone ? { viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width, height }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(({ save, quality }) => { try { localStorage.setItem('slopmerica.quality', quality); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.setItem('slopmerica.save.v1', save); } catch { /* */ } }, { save, quality });
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('#continue', { timeout: 180000 });
  await page.click('#continue', { timeout: 240000 }); // (a Medium or High page under load draws a frame in seconds, and the click waits for the button to stand still over two of them)
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
  await page.evaluate(() => {
    const g = window.__game;
    cancelAnimationFrame(g.raf);
    for (const e of document.querySelectorAll('.hud, .xfeed, .toast, .next-bar, .side-cards')) e.style.display = 'none';
    // mid-summer: the block was saved later in the year, so count whole days from here too, or
    // no day ticks (services, freight, demand, growth) until the old date comes round
    g.sim.day = 120;
    g.sim.lastWhole = Math.floor(g.sim.day);
    g.frame(0.016); g.frame(0.016);
  });
  return { page, errs, center };
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
