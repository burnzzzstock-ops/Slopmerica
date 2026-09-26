// Player actions share one command: ONE MORE LANE from the inspector and the
// map tool cost the same, reject when unaffordable without changing anything,
// and undo. Road bulldoze salvages the same from both. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=ponzi`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  const S = g.startView();
  d.road(S.x - 150, S.z + 40, S.x + 150, S.z + 40, 'twoLane');
  const seg = g.net.pickSeg(S.x, S.z + 40, 5).seg;
  const out = {};
  // 1. broke: the inspector button is disabled and the command rejects cleanly
  g.sim.money = -20000;
  g.select({ kind: 'road', s: seg });
  const btn = document.querySelector('#in-lane');
  out.brokeButtonDisabled = !!btn?.disabled;
  const before = { type: seg.type, money: g.sim.money, undo: g.canUndo };
  const res = g.upgradeRoads([seg]);
  out.brokeRejected = !res.ok && seg.type === before.type && g.sim.money === before.money && g.canUndo === before.undo;
  // 2. funded: inspector click == quoted price, with undo
  g.sim.money = 100000;
  g.select({ kind: 'road', s: seg });
  const quote = g.quoteUpgrade([seg], 'stroad4');
  const m0 = g.sim.money;
  document.querySelector('#in-lane').click();
  out.upgraded = seg.type === 'stroad4';
  out.chargedQuote = Math.round(m0 - g.sim.money) === quote.net;
  out.quote = quote;
  out.undoable = g.canUndo;
  g.undo();
  out.undoRestored = seg.type === 'twoLane' && Math.round(g.sim.money) === Math.round(m0);
  // 3. bulldoze salvage is the same from the inspector as from the tool
  const salvage = Math.round(seg.length * 8 * 0.2);
  const m1 = g.sim.money;
  g.select({ kind: 'road', s: seg });
  document.querySelector('#in-bulldoze').click();
  out.bulldozed = !g.net.segs.has(seg.id);
  out.salvage = Math.round(g.sim.money - m1) === salvage;
  return out;
});
let bad = 0;
for (const [k, v] of Object.entries(r)) {
  const ok = typeof v !== 'boolean' || v;
  if (!ok) bad++;
  console.log(ok ? 'OK  ' : 'FAIL', k, typeof v === 'boolean' ? '' : JSON.stringify(v));
}
if (errs.length) { bad++; console.log('FAIL page errors', errs.slice(0, 3).join(' | ')); }
await browser.close();
process.exit(bad ? 1 : 0);
