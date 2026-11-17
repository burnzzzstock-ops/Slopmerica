// The drawn HUD icons are on the controls. Opens the game on a desktop window and on a 390 x 844 phone, opens the toolbar,
// the More grid and the Roads, Zoning, Services and Views drawers, and checks that every control with a drawn icon in
// src/art/hudIcons.ts (HUD_CONTROLS) shows it as inline SVG, that each such control still has its name in text, and that a
// control with no drawn icon still shows something. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/hudicons.mjs
import { launch } from './lib/browser.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await launch();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };

for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
  await page.evaluate(() => { cancelAnimationFrame(window.__game.raf); window.__dbg.unlockAll(); });
  const settle = () => page.evaluate(async () => { const g = window.__game; for (let i = 0; i < 6; i++) { g.frame(0.1, false); await new Promise((r) => setTimeout(r, 20)); } });
  // per control: has it a drawn icon to show, does it show one, and does it say its name
  const read = (sel, group, attr) => page.evaluate(async ({ sel, group, attr }) => {
    const { HUD_CONTROLS } = await import('/src/art/hudIcons.ts');
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const id = el.getAttribute(attr);
      const svg = el.querySelector('svg');
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      out.push({ id, drawn: Object.prototype.hasOwnProperty.call(HUD_CONTROLS[group], id), svg: !!svg, w: svg ? Math.round(svg.getBoundingClientRect().width) : 0, named: text.length > 1 || !!el.title || !!el.getAttribute('aria-label'), blank: !svg && text.length === 0 });
    }
    return out;
  }, { sel, group, attr });
  const verdict = (what, rows, min) => {
    const drawn = rows.filter((r) => r.drawn);
    const missing = drawn.filter((r) => !r.svg).map((r) => r.id), unnamed = rows.filter((r) => !r.named).map((r) => r.id), blank = rows.filter((r) => r.blank).map((r) => r.id);
    const small = drawn.filter((r) => r.svg && r.w < 18).map((r) => `${r.id} ${r.w}px`);
    check(`${name}: ${what}: ${drawn.length - missing.length} of ${drawn.length} controls with a drawn icon show it (${rows.length} controls in all)`, rows.length >= min && missing.length === 0, { rows: rows.length, missing });
    check(`${name}: ${what}: every one keeps its name, none is blank, and no icon is under 18 px`, unnamed.length === 0 && blank.length === 0 && small.length === 0, { unnamed, blank, small });
  };

  await settle();
  verdict('toolbar', await read('.toolbar .tbtn', 'toolbar', 'data-t'), 5);
  // More (phones keep most tools there; a desktop window has it when the toolbar is short)
  if (await page.$('.tbtn[data-t="more"]')) {
    await page.click('.tbtn[data-t="more"]'); await settle();
    verdict('More', await read('.more-btn', 'toolbar', 'data-more'), 3);
  }
  await page.click('.tbtn[data-t="roads"]'); await settle();
  verdict('road types', await read('.subpanel [data-road]', 'road', 'data-road'), 5);
  verdict('road modes', await read('.subpanel [data-mode]', 'roadMode', 'data-mode'), 4);
  await page.click('.tbtn[data-t="zones"]'); await settle();
  verdict('zones', await read('.subpanel [data-zone]', 'zone', 'data-zone'), 6);
  await page.click('.tbtn[data-t="ext:services"]'); await settle();
  verdict('service categories', await read('.subpanel [data-cat]', 'category', 'data-cat'), 9);
  verdict('service buildings', await read('.subpanel [data-svc]', 'facility', 'data-svc'), 2);
  if (await page.$('.tbtn[data-t="views"]')) {
    await page.click('.tbtn[data-t="views"]'); await settle();
    verdict('info views', await read('.subpanel [data-view]', 'view', 'data-view'), 3);
  }
  const wx = await page.evaluate(() => !!document.querySelector('#tb-weather svg'));
  check(`${name}: the weather badge is drawn`, wx);
  check(`${name}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
