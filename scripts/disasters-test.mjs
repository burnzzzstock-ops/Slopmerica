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
await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:5173'}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const result = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  d.road(30, 30, 300, 30, 'twoLane');
  if (!g.net.segs.size) throw new Error('Test road could not be built');
  const { triggerDisaster, disasterState, setDisasters } = await import('/src/sim/disasters.ts');
  const EXT = window.__ext; // the game's own registry (a fresh import can be a different module copy after HMR)
  const sys = EXT.systems.find(s => s.id === 'disasters');
  setDisasters(true);
  const day = Math.floor(g.sim.day);
  triggerDisaster(g, 'floridaMan');
  const warning = disasterState().event?.phase;
  sys.daily(g, day + 1);
  const response = disasterState().event?.phase;
  const blocked = [...g.net.segs.values()].filter(s => s.blocked > 0).length;
  const saved = sys.save(g);
  sys.daily(g, day + 4);
  const recovered = [...g.net.segs.values()].every(s => s.blocked === 0);
  return { warning, response, blocked, recovered, saved };
});
console.log(JSON.stringify(result));
if (result.warning !== 'warning' || result.response !== 'response' || result.blocked < 1 || !result.recovered) throw new Error('Disaster consequence loop failed');
if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
await browser.close();
