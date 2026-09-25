// Measure average frame ms for a view (headless). node scripts/frametime.mjs map "js-setup"
import { chromium } from 'playwright-core';
const [map = 'appalachia', setup = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://127.0.0.1:5173/#skip&map=${map}&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(`(() => { const g = window.__game, d = window.__dbg, S = g.startView(); cancelAnimationFrame(g.raf); ${setup}; const t = []; for (let i = 0; i < 4; i++) { const t0 = performance.now(); g.frame(0.016); g.renderer.getContext().finish(); t.push(performance.now() - t0); } return t.map(x => x.toFixed(0)).join(' ') + ' | calls ' + g.renderer.info.render.calls + ' tris ' + g.renderer.info.render.triangles; })()`);
console.log(map, r);
await browser.close();
