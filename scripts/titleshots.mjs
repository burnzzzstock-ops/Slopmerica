// Title screen screenshots (desktop + phone), top and scrolled.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errs = [];
for (const [name, opts] of [['desk', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
  await page.waitForSelector('.title.rm', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `shots/title-${name}.png` });
  await page.evaluate(() => { const t = document.querySelector('.title'); t.scrollTop = t.scrollHeight; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `shots/title-${name}-2.png` });
  await ctx.close();
}
console.log(errs.join('\n') || 'no errors');
await browser.close();
