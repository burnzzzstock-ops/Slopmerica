// Phone-sized screenshots of the HUD (390x844, DPR 3) for layout review.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); } catch { /* */ } });
await page.goto('http://127.0.0.1:5173/#skip&map=florida&mode=ponzi', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
await page.tap('#ob-go').catch(() => {});
await page.evaluate(() => { const g = window.__game, S = g.startView(); cancelAnimationFrame(g.raf); window.__dbg.view(S.x, S.z, 420, 0.6, 0.8); window.__dbg.hour(11); for (let i = 0; i < 3; i++) g.frame(0.016); });
const shot = async (name) => { await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 2; i++) g.frame(0.016); }); await page.waitForTimeout(700); await page.screenshot({ path: `shots/m-${name}.png`, timeout: 120000 }); };
console.log('pr', await page.evaluate(() => window.__game.renderer.getPixelRatio()), 'aa', await page.evaluate(() => window.__game.renderer.getContext().getContextAttributes().antialias));
await shot('idle');
if (await page.evaluate(() => document.querySelector('.subpanel')?.hidden !== false)) await page.tap('button.tbtn[data-t="roads"]');
await page.waitForTimeout(300);
await shot('roads');
// touching the map shrinks the panel to a pill
await page.evaluate(() => { const c = window.__game.renderer.domElement; c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, clientX: 200, clientY: 400 })); c.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, clientX: 200, clientY: 400 })); });
await page.waitForTimeout(300);
await shot('roads-min');
await page.tap('button.tbtn[data-t="more"]');
await page.waitForTimeout(300);
await shot('more');
console.log(errs.join('\n'));
await browser.close();
