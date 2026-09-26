// How much of the map the HUD leaves visible: measures the top bar, the
// toolbar and any open drawer at the playtest's window size, with no tool,
// the road tool, zoning, services and a selected building. The playtest
// recording (2536x1420 at 150%: ~1690x946 CSS px) had the road drawer and top
// bar covering ~40% of the height. Exits nonzero on failure. `--shots` saves
// screenshots to /tmp.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots');
const W = Number(process.env.W || 1690), H = Number(process.env.H || 946);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); const d = window.__dbg, S = g.startView(); d.road(S.x - 100, S.z, S.x + 100, S.z, 'twoLane'); d.zone(S.x, S.z + 30, 40, 'resLow'); d.run(8); });
const settle = () => page.evaluate(() => { const g = window.__game; g.frame(0.05, false); g.ui.update(0.3); g.ui.refreshNow?.(); });
// the clear strip of map between whatever covers the top and whatever covers the bottom
const measure = () => page.evaluate(() => {
  const H = innerHeight, W = innerWidth;
  const vis = (el) => { if (!el) return null; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
  let top = 0, bottom = H;
  const parts = {};
  for (const el of document.querySelectorAll('#hud > *, .topbar, .toolbar, .subpanel, .inspector, .placing, .feed, .minimap, .toasts, .banner, .tool-tip, .hud-bottom, .hud-top')) {
    const r = vis(el); if (!r) continue;
    // only things that span a real part of the width block the view
    if (r.width < W * 0.25) continue;
    const name = el.id ? '#' + el.id : '.' + [...el.classList].join('.');
    if (r.top < H * 0.35) { top = Math.max(top, r.bottom); parts[name] = Math.round(r.height); }
    else if (r.bottom > H * 0.65) { bottom = Math.min(bottom, r.top); parts[name] = Math.round(r.height); }
  }
  return { top: Math.round(top), bottom: Math.round(H - bottom), clear: Math.round(((bottom - top) / H) * 100), parts };
});
const results = {};
const take = async (name, fn) => { await fn(); await settle(); results[name] = await measure(); if (shots) await page.screenshot({ path: `/tmp/hud-${name}-${W}.png` }); console.log(name.padEnd(9), JSON.stringify(results[name])); };
await take('none', () => page.evaluate(() => window.__game.tools.set('inspect')));
await take('road', () => page.click('button.tbtn[data-t="roads"]'));
await page.keyboard.press('Escape');
await take('zoning', () => page.click('button.tbtn[data-t="zones"]'));
await page.keyboard.press('Escape');
await take('services', () => page.click('button.tbtn[data-t="ext:services"]'));
await page.keyboard.press('Escape');
await take('selected', () => page.evaluate(() => { const g = window.__game; g.tools.set('inspect'); const b = [...g.buildings.list.values()][0]; if (b) g.select({ kind: 'building', b }); }));
const worst = Math.min(...Object.values(results).map((r) => r.clear));
check(`no tool: at least 80% of the height is map (${results.none.clear}%)`, results.none.clear >= 80, results.none);
check(`roads and zoning: at least 70% of the height is map (${results.road.clear}%, ${results.zoning.clear}%)`, results.road.clear >= 70 && results.zoning.clear >= 70, results);
check(`any drawer open: at least 60% of the height is map (worst ${worst}%)`, worst >= 60, results);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
