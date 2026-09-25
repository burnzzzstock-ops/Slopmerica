// Key art for the cover: grow a showcase town in the real engine (ultra
// preset, HUD hidden, fixed resolution) and shoot cinematic angles.
// usage: node scripts/keyart.mjs [map] [town|land] [w] [h]
//   town = build and grow a town first (the hero shot); land = just the county
// Writes shots/keyart/<map>-<n>.png; encode picks with scripts/encodeart.mjs.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const map = process.argv[2] || 'norcal';
const mode = process.argv[3] || 'town';
const W = Number(process.argv[4]) || 1920, H = Number(process.argv[5]) || 1080;
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
mkdirSync('shots/keyart', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const savePath = `shots/keyart/${map}-town-save.json`;
const savedTown = mode === 'resume' && existsSync(savePath) ? readFileSync(savePath, 'utf8') : null;
await page.addInitScript((save) => {
  try {
    localStorage.setItem('slopmerica.quality', 'ultra');
    localStorage.setItem('slopmerica.onboarded', '1');
    if (save) localStorage.setItem('slopmerica.save.v1', save);
  } catch { /* */ }
}, savedTown);
if (savedTown) {
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('#continue', { timeout: 120000 });
  await page.click('#continue');
} else await page.goto(`${base}/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 600000 });

const info = await page.evaluate(async ({ mode, resumed }) => {
  const g = window.__game, d = window.__dbg, SV = window.__services;
  cancelAnimationFrame(g.raf);
  document.querySelector('.hud')?.style.setProperty('display', 'none');
  const S = g.startView();
  const cx = Math.round(S.x), cz = Math.round(S.z);
  if (mode === 'town' && !resumed) {
    // a stroad spine with a grid of side streets: the American dream
    d.road(cx - 420, cz, cx + 420, cz, 'stroad6');
    d.road(cx, cz - 380, cx, cz + 380, 'stroad4');
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      d.road(cx - 330, cz + k * 95, cx + 330, cz + k * 95, 'twoLane');
      d.road(cx + k * 95, cz - 300, cx + k * 95, cz + 300, 'twoLane');
    }
    d.zone(cx - 60, cz - 60, 70, 'comHigh'); d.zone(cx + 60, cz + 60, 70, 'office');
    d.zone(cx + 60, cz - 60, 70, 'comLow'); d.zone(cx - 60, cz + 60, 70, 'resHigh');
    d.zone(cx - 220, cz - 200, 130, 'resLow'); d.zone(cx + 220, cz + 200, 130, 'resLow');
    d.zone(cx + 230, cz - 210, 110, 'industry'); d.zone(cx - 230, cz + 210, 110, 'resHigh');
    const place = (id, R) => {
      for (const r of R) for (let a = 0; a < 48; a++) {
        const x = cx + Math.cos((a / 48) * Math.PI * 2) * r, z = cz + Math.sin((a / 48) * Math.PI * 2) * r;
        if (SV.canPlace(g, id, x, z).ok && SV.place(g, id, x, z)) return true;
      }
      return false;
    };
    for (const id of ['school', 'clinic', 'fireStation', 'sheriff', 'park', 'park', 'college']) place(id, [140, 200, 260, 320]);
    for (const [id, x, z] of [['slopCannon', 150, 40], ['fillErUpMegaStation', -150, -45], ['waterTower', 45, 150]]) {
      const p = g.rts.target.clone().set(cx + x, 0, cz + z);
      for (let k = 0; k < 12 && !g.placeLandmark(id, p); k++) p.x += 12;
    }
    g.sim.growthMul = 3;
    for (let i = 0; i < 12; i++) d.run(20);
  }
  g.weather.force('clear', 30);
  g.sim.speed = 1;
  for (let i = 0; i < 160; i++) g.frame(0.1, false); // cars out on the roads
  return { cx, cz, pop: g.sim.population, bld: g.buildings.list.size, levels: [...g.buildings.list.values()].reduce((a, b) => { a[b.level] = (a[b.level] ?? 0) + 1; return a; }, {}) };
}, { mode: mode === 'resume' ? 'town' : mode, resumed: !!savedTown });
console.log(JSON.stringify(info));
if (mode === 'town') writeFileSync(savePath, await page.evaluate(() => { window.__dbg.save(); return localStorage.getItem('slopmerica.save.v1'); }));

// yaw, pitch, distance, hour, look-at offset
const shots = mode !== 'land'
  ? [[0.7, 0.3, 430, 18.3, 0, 0], [2.3, 0.26, 480, 18.1, 0, 0], [3.9, 0.34, 520, 7.4, 0, 0], [5.4, 0.28, 460, 18.5, 0, 0], [1.4, 0.5, 950, 17.6, 0, 0], [0.2, 0.2, 300, 18.4, 40, 20]]
  : [[0.7, 0.32, 1400, 17.9, 0, 0], [2.4, 0.3, 1600, 18.2, 0, 0], [4.0, 0.36, 1500, 7.6, 0, 0], [5.5, 0.3, 1400, 18.0, 0, 0]];
let n = 0;
for (const [yaw, pitch, dist, hour, ox, oz] of shots) {
  const png = await page.evaluate(({ yaw, pitch, dist, hour, ox, oz, cx, cz }) => {
    const g = window.__game;
    g.rts.setView(cx + ox, cz + oz, dist, yaw, pitch, true);
    g.sim.speed = 1;
    for (let i = 0; i < 6; i++) { g.hour = hour; g.frame(0.05, true); }
    // read the drawing buffer in the same task it was rendered
    return g.renderer.domElement.toDataURL('image/png');
  }, { yaw, pitch, dist, hour, ox, oz, cx: info.cx, cz: info.cz });
  const file = `shots/keyart/${map}-${mode === 'resume' ? 'town' : mode}-${n++}.png`;
  writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  console.log(file, JSON.stringify({ yaw, pitch, dist, hour }));
}
writeFileSync(`shots/keyart/${map}-${mode}.json`, JSON.stringify({ info, shots }));
await browser.close();
