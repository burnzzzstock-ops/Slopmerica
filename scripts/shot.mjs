// Headless screenshot harness: node scripts/shot.mjs <url> <out.png> [evalJs] [waitMs] [w] [h]
import { chromium } from 'playwright-core';

const [url, out, evalJs = '', waitMs = '4000', w = '1280', h = '800'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(+waitMs);
if (evalJs) {
  try {
    const r = await page.evaluate(evalJs);
    if (r !== undefined) console.log('eval:', JSON.stringify(r).slice(0, 2000));
  } catch (e) {
    console.log('eval error', e.message);
  }
  await page.waitForTimeout(2500);
}
await page.screenshot({ path: out });
console.log(logs.slice(-40).join('\n'));
await browser.close();
