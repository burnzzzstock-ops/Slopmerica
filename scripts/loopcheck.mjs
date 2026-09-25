// Count live render-loop frames in N seconds, optionally after running setup JS.
import { chromium } from 'playwright-core';
const setup = process.argv[2] || '';
const secs = +(process.argv[3] || 25);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://127.0.0.1:5173/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
await page.evaluate(`(() => { const g = window.__game; ${setup}; window.__fc = 0; g.onFrame.push(() => window.__fc++); })()`);
await page.waitForTimeout(secs * 1000);
console.log(JSON.stringify(setup).slice(0, 70), `frames in ${secs}s:`, await page.evaluate(() => window.__fc));
await browser.close();
