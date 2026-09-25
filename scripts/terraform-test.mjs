import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tmp = resolve('..', 'playwright-tmp');
mkdirSync(tmp, { recursive: true });
process.env.TEMP = tmp; process.env.TMP = tmp;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:5173'}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg);
const result = await page.evaluate(async () => {
  const g = window.__game;
  cancelAnimationFrame(g.raf);
  const { terraformAt } = await import('/src/tools/terraform.ts');
  const { EXT } = await import('/src/ext/registry.ts');
  const { HM_N, HM_STEP, HALF } = await import('/src/config.ts');
  const system = EXT.systems.find(s => s.id === 'terraform');
  let spot = null;
  for (let z = -200; z < 600 && !spot; z += 32)
    for (let x = -200; x < 600; x += 32)
      if (g.terrain.h(x, z) > 5 && g.terrain.slope(x, z) < 0.2 && !g.net.pickSeg(x, z, 45)
        && !g.buildings.near(x, z, 45).length && !g.communes.at(x, z)) { spot = { x, z }; break; }
  if (!spot) throw new Error('No safe test location');
  const i = Math.round((spot.x + HALF) / HM_STEP), j = Math.round((spot.z + HALF) / HM_STEP);
  const id = j * HM_N + i, before = g.terrain.heights[id];
  const action = terraformAt(g, spot.x, spot.z, 'raise');
  const raised = g.terrain.heights[id];
  const saved = system.save(g);
  g.terrain.editHeights([{ id, height: before }]);
  system.load(g, saved);
  const restored = g.terrain.heights[id];
  window.__dbg.road(spot.x + 60, spot.z + 80, spot.x + 180, spot.z + 80, 'twoLane');
  const road = g.net.segs.values().next().value;
  let roadResult = null;
  if (road) {
    const p = road.samp.pts[Math.floor(road.samp.pts.length / 2)];
    const h = g.terrain.h(p.x, p.z);
    const attempted = terraformAt(g, p.x, p.z, 'raise');
    roadResult = { before: h, after: g.terrain.h(p.x, p.z), reason: attempted.reason };
  }
  return { spot, action, before, raised, restored, roadResult, savedCells: saved.length };
});
console.log(JSON.stringify(result));
if (!(result.raised > result.before && Math.abs(result.restored - result.raised) < 0.02)) throw new Error('Terraform save/load failed');
if (result.roadResult && Math.abs(result.roadResult.after - result.roadResult.before) > 0.001) throw new Error('Road moved');
if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
await browser.close();
