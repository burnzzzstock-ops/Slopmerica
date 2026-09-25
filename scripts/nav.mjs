import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const t0 = Date.now();
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('nav', ((Date.now() - t0) / 1000).toFixed(1), f.url()); });
page.on('console', (m) => { const t = m.text(); if (t.includes('boot') || t.includes('vite')) console.log(((Date.now() - t0) / 1000).toFixed(1), t); });
await page.goto('http://127.0.0.1:5173/#skip&map=florida&mode=sandbox', { waitUntil: 'load' });
await page.waitForTimeout(20000);
await browser.close();
