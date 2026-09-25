// Multi-view screenshots in one session: node scripts/views.mjs <map> <prefix> [w h] [touch]
// Each view: [name, js] — js runs with window.__dbg / window.__game available.
import { chromium } from 'playwright-core';
const [map = 'appalachia', prefix = 'shots/v', w = '1280', h = '800', touch = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: !!touch, isMobile: !!touch });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!t.includes('CERT') && !t.includes('404') && !t.includes('[vite]')) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 120000 });
await page.evaluate(() => document.querySelector('.onboard button, .onboarding button')?.click());
await page.waitForTimeout(3000);
const views = JSON.parse(process.env.VIEWS || '[]');
const g = await page.evaluate(() => { const g = window.__game; const s = g.startView(); return { x: s.x, z: s.z, yaw: s.yaw }; });
console.log('start', JSON.stringify(g));
for (const [name, js] of views) {
  const r = await page.evaluate(`(async () => { const g = window.__game, d = window.__dbg, S = g.startView(); ${js}; const t0 = performance.now(); for (let i = 0; i < 6; i++) { g.frame(0.016); } return "frame ms " + ((performance.now() - t0) / 6).toFixed(0) + " q=" + g.q.name; })()`).catch((e) => 'ERR ' + e.message);
  if (r) console.log(name, r);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${prefix}-${name}.png`, timeout: 120000 });
}
const fps = await page.evaluate(async () => { const t0 = performance.now(); let n = 0; await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(0); }; requestAnimationFrame(f); }); return n / 3; });
console.log('fps(headless swiftshader)', fps.toFixed(1));
console.log(logs.filter((l) => !l.includes("useProgram")).slice(-30).join('\n'));
await browser.close();
