// Edge scrolling: the mouse against a window edge slides the map that way;
// it stops in the middle of the screen, over a panel, when the setting is
// off, and when the mouse leaves the window. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.removeItem('slopmerica.edgeScroll'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.waitForTimeout(1500);
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// software rendering takes seconds per frame, so step 1.5 s of game frames by hand
await page.evaluate(() => cancelAnimationFrame(window.__game.raf));
const step = (sec) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) g.frame(0.05, false); }, Math.round(sec / 0.05));
// how far the camera's goal moved along screen-right and screen-up while the mouse sat at (x, y)
const drift = async (x, y, ms = 1500) => {
  const a = await page.evaluate(() => { const r = window.__game.rts; return { x: r.goal.target.x, z: r.goal.target.z, yaw: r.yaw }; });
  await page.mouse.move(x, y, { steps: 2 });
  await step(ms / 1000);
  const b = await page.evaluate(() => { const r = window.__game.rts; return { x: r.goal.target.x, z: r.goal.target.z }; });
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), dx = b.x - a.x, dz = b.z - a.z;
  return { right: Math.round(dx * fz - dz * fx), up: Math.round(-dx * fx - dz * fz) };
};
const W = 1100, H = 700;
await page.mouse.move(W / 2, H / 2);
const still = await drift(W / 2, H / 2);
check(`mouse in the middle: map stays put (${JSON.stringify(still)})`, Math.abs(still.right) < 2 && Math.abs(still.up) < 2, still);
const right = await drift(W - 2, H / 2);
check(`mouse at the right edge scrolls right (${right.right} m)`, right.right > 50 && Math.abs(right.up) < right.right * 0.2, right);
const left = await drift(2, H * 0.72);
check(`mouse at the left edge scrolls left (${left.right} m)`, left.right < -50, left);
const top = await drift(W * 0.8, 2);
check(`mouse at the top edge scrolls up (${top.up} m)`, top.up > 50, top);
await page.mouse.move(W / 2, H / 2);
const stop = await drift(W / 2, H / 2, 800);
check('back in the middle it stops', Math.abs(stop.right) < 5 && Math.abs(stop.up) < 5, stop);
// over the toolbar at the bottom edge: that's a panel, not the map
const bar = await page.evaluate(() => { const r = document.querySelector('.toolbar').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 3, h: innerHeight }; });
const overBar = bar.y > H - 18 ? await drift(bar.x, bar.y) : { right: 0, up: 0, skipped: true };
check('over the toolbar near the bottom edge it does not scroll', Math.abs(overBar.up) < 5 && Math.abs(overBar.right) < 5, overBar);
// the mouse leaves the window
await page.mouse.move(W - 2, H / 2);
await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null })));
const gone = await drift(W - 2, H / 2, 0).then(async () => {
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null })));
  const a = await page.evaluate(() => window.__game.rts.goal.target.x);
  await step(1);
  const b = await page.evaluate(() => window.__game.rts.goal.target.x);
  return Math.abs(b - a);
});
check(`leaving the window stops it (moved ${Math.round(gone)} m)`, gone < 5, gone);
// Settings → Edge scrolling: off
await page.mouse.move(W / 2, H / 2);
await page.click('button.tbtn[data-t="help"]');
await page.click('#edge-toggle');
const saved = await page.evaluate(() => localStorage.getItem('slopmerica.edgeScroll'));
const off = await drift(W - 2, H / 2);
check(`turned off in Settings, the edge does nothing (${off.right} m) and it's remembered (${saved})`, Math.abs(off.right) < 5 && saved === '0', { off, saved });
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
