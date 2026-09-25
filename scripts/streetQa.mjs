// PORT=5174 node scripts/streetQa.mjs
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.env.OUT || 'shots/street-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'high'); });
await page.goto(`http://127.0.0.1:${process.env.PORT || '5173'}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
await page.evaluate(() => { document.querySelector('#ob-go')?.click(); window.__game.stop(); window.__game.sim.speed = 0; document.querySelector('.hud').style.display = 'none'; });
const result = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  const roads = [d.road(-940, -300, -660, -300, 'stroad4'), d.road(-800, -440, -800, -300, 'twoLane'), d.road(-800, -300, -800, -160, 'twoLane')];
  g.frame(0.016, false);
  d.view(-800, -300, 45, 0.7, 0.5);
  g.hour = 11; g.env.hour = 11; g.frame(0.016);
  return { roads, nodes: g.net.nodes.size, signals: g.roads.details.signalPlacements.length,
    png: g.renderer.domElement.toDataURL('image/png').split(',')[1] };
});
await writeFile(`${out}/street-signal-day.png`, Buffer.from(result.png, 'base64'));
const night = await page.evaluate(() => {
  const g = window.__game;
  g.hour = 22; g.env.hour = 22;
  g.frame(0.1, false); g.frame(0.016);
  return g.renderer.domElement.toDataURL('image/png').split(',')[1];
});
await writeFile(`${out}/street-signal-night.png`, Buffer.from(night, 'base64'));
console.log(JSON.stringify({ roads: result.roads, nodes: result.nodes, signals: result.signals, errors }));
await browser.close();
