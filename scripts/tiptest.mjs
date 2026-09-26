// The cursor tip stays inside the game at every edge and corner, with long
// text (the playtest review saw a placement message run off the right edge).
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const W = 1265, H = 594;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); g.tools.set('road'); });
const long = '🩺 Urgent Care (Out of Network) · $14,000 now + $95/wk · sandbox: money is no object · 📍 snapped to the nearest good spot · click to place';
for (const [name, x, y] of [['right edge', W - 30, H / 2], ['bottom-right corner', W - 20, H - 70], ['left edge', 12, H / 2], ['top edge', W / 2, 60], ['middle', W / 2, H / 2]]) {
  const r = await page.evaluate(([x, y, long]) => {
    const g = window.__game, c = g.renderer.domElement;
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }));
    g.tools.update = () => {}; g.tools.tip = { text: long };
    g.ui.update(0.3);
    const t = document.querySelector('.cursor-tip'), b = t.getBoundingClientRect();
    const covers = b.left <= x && x <= b.right && b.top <= y && y <= b.bottom;
    return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), covers, hidden: t.hidden };
  }, [x, y, long]);
  check(`${name}: the whole tip is on screen and clear of the cursor (${JSON.stringify(r)})`, !r.hidden && r.l >= 0 && r.t >= 0 && r.r <= W && r.b <= H && !r.covers, r);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
