import { launch } from './lib/browser.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const t0 = Date.now();
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('nav', ((Date.now() - t0) / 1000).toFixed(1), f.url()); });
page.on('console', (m) => { const t = m.text(); if (t.includes('boot') || t.includes('vite')) console.log(((Date.now() - t0) / 1000).toFixed(1), t); });
await page.goto('http://127.0.0.1:5173/#skip&map=florida&mode=sandbox', { waitUntil: 'load' });
await page.waitForTimeout(20000);
await browser.close();
