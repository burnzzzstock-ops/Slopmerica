import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.env.OUT || 'shots/commune-leave';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('slopmerica.quality', 'high'));
await page.goto(`http://127.0.0.1:${process.env.PORT || '5173'}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const result = await page.evaluate(() => {
  const g = window.__game, c = g.communes.list[0];
  document.querySelector('#ob-go')?.click(); g.stop(); g.sim.speed = 0;
  document.querySelector('.hud').style.display = 'none';
  c.state = 'leaving';
  g.communes.update(4.1, 0, 0, g.camera.position);
  window.__dbg.view(c.x, c.z, 30, 0.7, 0.5);
  g.frame(0.016);
  return { state: c.state, remainsAttached: c.remains?.parent === g.communes.group,
    paint: g.terrain.paintAt(c.x, c.z), png: g.renderer.domElement.toDataURL('image/png').split(',')[1] };
});
await writeFile(`${out}/burnt-remains.png`, Buffer.from(result.png, 'base64'));
console.log(JSON.stringify({ state: result.state, remainsAttached: result.remainsAttached, paint: result.paint, errors }));
await browser.close();
