import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tmp = resolve('..', 'playwright-tmp'); mkdirSync(tmp, { recursive: true });
process.env.TEMP = tmp; process.env.TMP = tmp;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const before = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  const { terraformAt } = await import('/src/tools/terraform.ts');
  const ds = g.districts;
  let p;
  for (let z = -200; z < 500 && !p; z += 32) for (let x = -200; x < 500; x += 32) {
    if (g.terrain.h(x, z) > 5 && g.terrain.slope(x, z) < 0.2 && !g.communes.at(x, z) && !g.net.pickSeg(x, z, 50)) { p = { x, z }; break; }
  }
  if (!p) throw new Error('No safe terrain location');
  const district = ds.create();
  ds.paint(p.x, p.z, district.id, 50);
  ds.setDistrictPolicy(district.id, 'solarMandate', true);
  const oldHeight = g.terrain.h(p.x, p.z);
  terraformAt(g, p.x, p.z, 'raise');
  const height = g.terrain.h(p.x, p.z);
  if (!d.save()) throw new Error('Save failed');
  return { ...p, oldHeight, height, district: district.name, policy: ds.at(p.x, p.z)?.overrides.solarMandate };
});
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.locator('#continue').click();
await page.waitForFunction(() => window.__game?.districts && window.__dbg, null, { timeout: 120000 });
const after = await page.evaluate(({ x, z }) => {
  const g = window.__game; cancelAnimationFrame(g.raf);
  return { height: g.terrain.h(x, z), district: g.districts.at(x, z)?.name, policy: g.districts.at(x, z)?.overrides.solarMandate };
}, before);
console.log(JSON.stringify({ before, after }));
if (!(before.height > before.oldHeight && Math.abs(after.height - before.height) < 0.02
  && after.district === before.district && after.policy === true)) throw new Error('Continue did not restore system state');
if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
await browser.close();
