// Open every toolbar panel (and every More item on phones), screenshot it, and
// flag page errors, content spilling off-screen, and tools left armed.
// usage: node scripts/uisweep.mjs [phone|desk]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const kind = process.argv[2] || 'phone';
const phone = kind === 'phone';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = `shots/sweep-${kind}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: Number(process.env.W) || 1280, height: 800 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
// give it a little town so panels have content
await page.evaluate(() => { const d = window.__dbg, g = window.__game; const S = g.startView(); d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane'); d.zone(S.x, S.z + 40, 60, 'resLow'); d.zone(S.x, S.z - 40, 50, 'comLow'); d.run(20); });
const spill = () => page.evaluate(() => {
  const W = window.innerWidth, H = window.innerHeight, bad = [];
  for (const el of document.querySelectorAll('.hud *')) {
    if (el.closest('[hidden]') || el.closest('.xfeed .xf-list') || el.closest('.floating')) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.position === 'fixed' && st.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // inside a scroller is fine
    let p = el.parentElement, scroll = false;
    while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) { scroll = true; break; } p = p.parentElement; }
    if (scroll) continue;
    if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
  }
  return { bad: [...new Set(bad)].slice(0, 6), docW: document.documentElement.scrollWidth, W };
});
const tool = () => page.evaluate(() => window.__game.tools.active);
const ids = await page.evaluate(() => [...document.querySelectorAll('.toolbar button.tbtn')].map((b) => b.dataset.t));
console.log('toolbar', ids.join(' '));
const visit = async (label, open) => {
  await open();
  await page.waitForTimeout(700);
  const s = await spill();
  await page.screenshot({ path: `${out}/${label.replace(/[^a-z0-9]+/gi, '_')}.png` });
  console.log(label, 'tool', await tool(), s.bad.length ? 'SPILL ' + JSON.stringify(s.bad) : 'ok', s.docW > s.W ? `docW ${s.docW}>${s.W}` : '');
};
for (const id of ids) {
  if (id === 'more') continue;
  await visit(id, () => page.tap ? (phone ? page.tap(`button.tbtn[data-t="${id}"]`) : page.click(`button.tbtn[data-t="${id}"]`)) : null);
  // close it again with the same button and make sure nothing stays armed
  if (phone) await page.tap(`button.tbtn[data-t="${id}"]`); else await page.click(`button.tbtn[data-t="${id}"]`);
  await page.waitForTimeout(300);
  const t = await tool();
  if (t !== 'inspect') console.log('  !! after closing', id, 'tool is still', t);
}
if (ids.includes('more')) {
  await page.tap('button.tbtn[data-t="more"]');
  await page.waitForTimeout(400);
  const more = await page.evaluate(() => [...document.querySelectorAll('[data-more]')].map((b) => b.dataset.more));
  await page.tap('button.tbtn[data-t="more"]');
  for (const id of more) {
    if (id === 'feed') continue;
    await visit('more_' + id, async () => { await page.tap('button.tbtn[data-t="more"]'); await page.waitForTimeout(300); await page.tap(`[data-more="${id}"]`); });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__game.tools.set('inspect'));
  }
}
console.log('ERRORS', errs.length);
for (const e of [...new Set(errs)].slice(0, 12)) console.log(e);
await browser.close();
