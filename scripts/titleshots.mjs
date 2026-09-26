// Title screen screenshots: home, New City and loading, on desktop and phone.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errs = [];
for (const [name, opts] of [['desk', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  if (process.env.WITH_SAVE) await page.addInitScript(() => localStorage.setItem('slopmerica.save.v1', JSON.stringify({ v: 1, savedAt: Date.now() - 3600e3 * 3, map: 'appalachia', mode: 'ponzi', city: 'Holler County', day: 42, hour: 9, money: 1, tax: 0.09, loans: [], pop: 1234, nature: 1, sprawl: 0, roads: {}, zones: {}, buildings: [], communes: [] })));
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('.title.aaa.art-ready', { timeout: 60000 });
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `shots/title-${name}.png` });
  await page.click('#new');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/title-${name}-setup.png` });
  if (name === 'phone') { await page.evaluate(() => document.querySelector('.aaa-setup').scrollTo(0, 9999)); await page.waitForTimeout(300); await page.screenshot({ path: `shots/title-${name}-setup-2.png` }); }
  await page.click('[data-map="florida"]');
  await page.click('#go');
  // the loader can be gone in a blink on a fast machine
  if (await page.waitForSelector('.loading.aaa', { timeout: 3000 }).catch(() => null)) await page.screenshot({ path: `shots/title-${name}-loading.png` });
  await ctx.close();
}
console.log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
