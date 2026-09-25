// Capture repeatable commune views from a running Vite dev server.
// PORT=5174 MAPS=appalachia,norcal,florida MODES=day,night,rain,snow node scripts/communeQa.mjs
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const port = process.env.PORT || '5173';
const maps = (process.env.MAPS || 'appalachia,norcal,florida').split(',');
const modes = (process.env.MODES || 'day,night,rain,snow').split(',');
const distances = (process.env.DISTS || '15,40,150').split(',').map(Number);
const out = process.env.OUT || 'shots/communes';
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const errors = [];
for (const map of maps) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'high'); } catch { /* private */ } });
  page.on('pageerror', e => errors.push(`${map}: ${e.stack || e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${map}: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${port}/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
  console.log(map, 'page loaded');
  try {
    await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  } catch (e) {
    console.log('boot failure', await page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 1500) })), errors);
    await page.screenshot({ path: `${out}/${map}-boot-failure.png`, timeout: 30000 });
    throw e;
  }
  await page.evaluate(() => { document.querySelector('.onboard button, .onboarding button')?.click(); window.__game.stop(); window.__game.sim.speed = 0; document.querySelector('.hud')?.style.setProperty('display', 'none'); });
  const c = await page.evaluate(() => { const c = window.__game.communes.list[0]; return { id: c.id, x: c.x, z: c.z, name: c.name, r: c.r }; });
  console.log(map, JSON.stringify(c));
  for (const mode of modes) {
    await page.evaluate(mode => {
      const g = window.__game;
      g.hour = mode === 'night' ? 22 : 11;
      g.env.hour = g.hour;
      g.weather.force(mode === 'rain' ? 'rain' : mode === 'snow' ? 'snow' : 'clear', 4);
      for (let i = 0; i < 60; i++) g.frame(0.1, false);
    }, mode);
    for (const dist of distances) {
      const result = await page.evaluate(({ dist, c }) => {
        const g = window.__game, d = window.__dbg;
        d.view(c.x, c.z, dist, 0.7, dist === 15 ? 0.36 : dist === 40 ? 0.52 : 0.68);
        const t0 = performance.now();
        g.frame(0.016);
        const ms = performance.now() - t0;
        return { perf: { ms: +ms.toFixed(1), calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles },
          png: g.renderer.domElement.toDataURL('image/png').split(',')[1] };
      }, { dist, c });
      const file = `${out}/${map}-${mode}-${dist}.png`;
      await writeFile(file, Buffer.from(result.png, 'base64'));
      console.log(file, JSON.stringify(result.perf));
    }
  }
  await page.close();
}
console.log('errors', JSON.stringify(errors));
await browser.close();
