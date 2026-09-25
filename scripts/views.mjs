// Multi-view screenshots in one session: node scripts/views.mjs <map> <prefix> [w h] [touch]
// Each view: [name, js] — js runs with window.__dbg / window.__game available.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const [map = 'appalachia', prefix = 'shots/v', w = '1280', h = '800', touch = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: !!touch, isMobile: !!touch });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!t.includes('CERT') && !t.includes('404') && !t.includes('[vite]')) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=${process.env.MODE || "sandbox"}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 120000 });
await page.evaluate(() => document.querySelector('.onboard button, .onboarding button')?.click());
// Pause the live rAF loop: software GL is too slow to keep up, and screenshots
// need an idle compositor. Views render frames explicitly instead.
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
await page.waitForTimeout(3000);
const views = JSON.parse(process.env.VIEWS || '[]');
const g = await page.evaluate(() => { const g = window.__game; const s = g.startView(); return { x: s.x, z: s.z, yaw: s.yaw }; });
console.log('start', JSON.stringify(g));
for (const [name, js] of views) {
  const r = await page.evaluate(`(async () => { const g = window.__game, d = window.__dbg, S = g.startView(); ${js}; const t0 = performance.now(); for (let i = 0; i < 6; i++) { g.frame(0.016); } return "frame ms " + ((performance.now() - t0) / 6).toFixed(0) + " q=" + g.q.name; })()`).catch((e) => 'ERR ' + e.message);
  if (r) console.log(name, r);
  if (process.env.PAGE_SHOT) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${prefix}-${name}.png`, timeout: 120000 });
  } else {
    // grab the WebGL canvas right after a frame (no compositor round trip, no HUD)
    const url = await page.evaluate(() => { const g = window.__game; g.frame(0.016); return g.renderer.domElement.toDataURL('image/png'); });
    writeFileSync(`${prefix}-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
}
const fps = await page.evaluate(() => { const g = window.__game; const t0 = performance.now(); for (let i = 0; i < 3; i++) { g.frame(0.016); g.renderer.getContext().finish(); } return 3000 / (performance.now() - t0); });
console.log('fps(headless swiftshader, manual frames)', fps.toFixed(1));
console.log(logs.filter((l) => !l.includes("useProgram")).slice(-30).join('\n'));
await browser.close();
