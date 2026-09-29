// Phone tap targets: on an iPhone-sized touch screen, opens every panel a
// player uses in the first ten minutes (Roads, Zoning, Services, Views, and
// every More item), finds each visible control and measures the area a finger
// really reaches: how many CSS px in a row and in a column still land on that
// control (elementFromPoint), so a wide invisible hit area counts and a small
// button that is covered doesn't. Apple's guideline is 44 px. A control under
// it fails, except the few listed in TIGHT: one-row top-bar controls that
// can't be 44 wide without a second top-bar row (proposed in PLAYTEST_6.md),
// which still must reach the smaller size listed for them.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/phonetargets.mjs
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const MIN = 44;
// selector -> [min width, min height] where 44 x 44 isn't possible in one row
const TIGHT = [
  ['.tb-speed button', 30, 43],
  ['.tb-popstat', 32, 40],
  ['.tb-money', 44, 40],
  ['.tb-meters', 40, 40],
  ['.dbar', 15, 40], // four bars 15 px apart; wider would push into their neighbours
  ['.land-cell', 30, 30], // a selectable map of tiles: a wrong tap just selects the neighbour, and Buy confirms
];
const PANELS = [
  ['roads'], ['zones'], ['ext:services'], ['views'],
  ['more', 'ext:land'], ['more', 'upgrade'], ['more', 'ext:transit'], ['more', 'ext:districts'], ['more', 'landmarks'],
  ['more', 'budget'], ['more', 'ext:terraform'], ['more', 'communes'], ['more', 'feed'], ['more', 'ext:disasters'], ['more', 'help'],
];

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=ponzi`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
await page.evaluate(() => { cancelAnimationFrame(window.__game.raf); window.__dbg.unlockAll(); });

// what a finger reaches, per visible control, measured in the page
const measure = (tight) => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const label = (el) => (el.getAttribute('aria-label') || el.title || el.textContent || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 26);
  const seen = new Set();
  for (const el0 of document.querySelectorAll('button, [role=button], input, select, summary, a[href], .land-cell')) {
    if (el0.disabled) continue;
    const el = el0.matches('input[type=checkbox], input[type=radio]') ? el0.closest('label') || el0 : el0;
    if (seen.has(el)) continue;
    seen.add(el);
    if (document.querySelector('.bug') && !el.closest('.bug')) continue; // a dialog covers the rest, by design
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none' || el.closest('[hidden]')) continue;
    if (el.closest('.subpanel, .inspector, .xfeed, .bug, .budget-panel, .card-list')) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
    const cx = Math.round(Math.min(vw - 1, Math.max(0, r.left + r.width / 2))), cy = Math.round(Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
    const hit = (x, y) => { if (x < 0 || y < 0 || x >= vw || y >= vh) return false; const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
    if (!hit(cx, cy)) { out.push({ k: `${el.tagName}.${String(el.className).split(' ')[0]}:${label(el)}`, covered: true, w: 0, h: 0 }); continue; }
    const run = (dx, dy) => { let n = 0; while (n < 60 && hit(cx + dx * (n + 1), cy + dy * (n + 1))) n++; return n; };
    const w = run(-1, 0) + run(1, 0) + 1, h = run(0, -1) + run(0, 1) + 1;
    const t = tight.find(([sel]) => el.matches(sel));
    out.push({ k: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}:${label(el)}`, w, h, need: t ? [t[1], t[2]] : null });
  }
  return out;
};

const seenKeys = new Set(), fails = [], stats = { checked: 0 };
const scan = async (where) => {
  const rows = await page.evaluate(measure, TIGHT);
  for (const r of rows) {
    const key = r.k;
    if (seenKeys.has(key)) continue; // the top bar and the Next bar show up under every panel: report them once
    seenKeys.add(key);
    stats.checked++;
    const [nw, nh] = r.need || [MIN, MIN];
    if (r.covered) fails.push(`${where}: ${r.k} is covered by something else at its centre`);
    else if (r.w < nw || r.h < nh) fails.push(`${where}: ${r.k} reaches ${r.w}x${r.h} px (needs ${nw}x${nh})`);
  }
};

await scan('top bar and toolbar');
for (const [t, m] of PANELS) {
  await page.tap('button.tbtn[data-t="inspect"]'); await page.waitForTimeout(200);
  await page.tap(`button.tbtn[data-t="${t}"]`); await page.waitForTimeout(350);
  if (m) { await page.tap(`button.more-btn[data-more="${m}"]`); await page.waitForTimeout(500); }
  await scan(m || t);
}
await page.tap('button.tbtn[data-t="inspect"]');
// the bug reporter (a full-screen dialog on a phone)
await page.tap('button.tbtn[data-t="more"]'); await page.waitForTimeout(300);
await page.tap('button.more-btn[data-more="bug"]'); await page.waitForTimeout(500);
await scan('bug reporter');
await browser.close();

console.log(`${stats.checked} controls measured on a 390x844 touch screen`);
for (const f of fails) console.log('  ✗', f);
if (errs.length) console.log('page errors', JSON.stringify(errs.slice(0, 3)));
if (fails.length || errs.length) { console.log(`FAIL: ${fails.length} controls under 44 px${errs.length ? `, ${errs.length} page errors` : ''}`); process.exit(1); }
console.log('OK: every control a finger has to hit is at least 44 px (top-bar controls at their one-row minimum)');
