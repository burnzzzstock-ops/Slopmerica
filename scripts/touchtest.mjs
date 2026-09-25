// Simulated phone: drag-to-draw a road with one finger, then Done, then Undo.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); } catch { /* private */ } });
await page.goto(`http://127.0.0.1:${process.env.PORT || '5173'}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const cdp = await ctx.newCDPSession(page);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const segs = () => page.evaluate(() => window.__game.net.segs.size);
console.log('segs start', await segs(), 'touch?', await page.evaluate(() => window.__game.isTouch));
await page.tap('#ob-go');
await page.waitForTimeout(300);
await page.tap('button.card[data-road="stroad4"]');
await page.waitForTimeout(300);
await touch('touchStart', 120, 380);
for (let i = 1; i <= 10; i++) { await touch('touchMove', 120 + i * 18, 380 - i * 10); await page.waitForTimeout(40); }
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/touch-drag.png' });
await touch('touchEnd', 0, 0);
await page.waitForTimeout(600);
console.log('segs after drag (planned, not built)', await segs(), 'pending', await page.evaluate(() => window.__game.tools.pending));
await page.screenshot({ path: 'shots/touch-after.png' });
await page.tap('#ta-build');
await page.waitForTimeout(600);
console.log('segs after Build', await segs(), 'drawing', await page.evaluate(() => window.__game.tools.drawing));
// the first point lands under the finger (not 64 px above it)
{
  await page.tap('#ta-done').catch(() => {});
  await page.waitForTimeout(200);
  const want = await page.evaluate(() => { const p = window.__game.rts.groundAt(200, 520); return p && [Math.round(p.x), Math.round(p.z)]; });
  await touch('touchStart', 200, 520); await touch('touchEnd', 0, 0);
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => { const s = window.__game.tools.start; return s && [Math.round(s.x), Math.round(s.z)]; });
  console.log('start under finger', JSON.stringify(want), '->', JSON.stringify(got));
  // a second tap somewhere else must plan a road from that start, not move the start
  await touch('touchStart', 300, 380); await touch('touchEnd', 0, 0);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => { const t = window.__game.tools; return { pending: t.pending, start: t.start && [Math.round(t.start.x), Math.round(t.start.z)] }; });
  console.log('tap start then tap end: pending', after.pending, 'start kept', JSON.stringify(after.start) === JSON.stringify(got));
  const tip = await page.evaluate(() => ({ tip: window.__game.tools.tip?.text, cost: window.__game.tools.pendingCost }));
  console.log('planned road:', JSON.stringify(tip));
  if (tip.cost !== null) { await page.tap('#ta-build'); await page.waitForTimeout(600); console.log('segs after tap-tap-Build', await segs()); }
  await page.tap('#ta-done').catch(() => {});
  await page.waitForTimeout(200);
}
// a stray tap far from the road's end starts a new road instead of building one
await touch('touchStart', 130, 200); await touch('touchEnd', 0, 0);
await page.waitForTimeout(600);
console.log('segs after stray tap', await segs(), 'pending', await page.evaluate(() => window.__game.tools.pending), 'drawing', await page.evaluate(() => window.__game.tools.drawing));
await page.tap('#ta-done'); // Stop
await page.waitForTimeout(200);
console.log('drawing after done', await page.evaluate(() => window.__game.tools.drawing));
await page.tap('#ta-undo');
await page.waitForTimeout(400);
console.log('segs after undo', await segs());
// double-tap ends a road: draw again, then tap twice quickly on one spot
await touch('touchStart', 120, 380);
for (let i = 1; i <= 10; i++) { await touch('touchMove', 120 + i * 18, 380 - i * 10); await page.waitForTimeout(40); }
await touch('touchEnd', 0, 0);
await page.waitForTimeout(600);
await page.tap('#ta-build');
await page.waitForTimeout(600);
console.log('drawing again', await page.evaluate(() => window.__game.tools.drawing), 'segs', await segs());
// Software GL here delivers CDP touches seconds apart (input waits for slow
// frames), so feed the tool two real-time taps directly: 60 ms apart, like a phone.
await page.evaluate(async () => {
  const g = window.__game, t = g.tools;
  const S = g.startView();
  const p = { x: S.x + 60, y: 0, z: S.z + 40 };
  const tap = () => { const e = new PointerEvent('pointerup', { pointerType: 'touch', button: 0 }); t.down(p, e); t.up(p, e, false); };
  tap();
  await new Promise((r) => setTimeout(r, 60));
  tap();
});
await page.waitForTimeout(300);
console.log('after double-tap: drawing', await page.evaluate(() => window.__game.tools.drawing), 'segs', await segs());
await browser.close();
