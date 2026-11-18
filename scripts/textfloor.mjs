// The smallest text on the HUD. On a 390 x 844 phone and a 1280 x 800 desktop this walks the top bar, the toolbar,
// the Next card, every drawer, the More grid, Settings, the demand card and a building's inspector, and lists every
// run of visible text by its drawn size: what is under the floor (FLOOR=12, the brief's type scale), where, and how
// many characters of it. Exits nonzero when anything is under the floor. `--list` prints every size found.
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const FLOOR = Number(process.env.FLOOR || 12);
const list = process.argv.includes('--list');
let bad = 0;
const browser = await launch();
for (const kind of ['phone', 'desk']) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game, d = window.__dbg, S = g.startView(); cancelAnimationFrame(g.raf); d.unlockAll(); d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane'); d.zone(S.x, S.z + 40, 60, 'resLow'); d.zone(S.x, S.z - 40, 50, 'comLow'); d.run(25); });
  const settle = () => page.evaluate(async () => { const g = window.__game; document.querySelectorAll('.toast').forEach((t) => t.remove()); for (let i = 0; i < 4; i++) { g.frame(0.1, false); await new Promise((r) => setTimeout(r, 15)); } g.time += 2; g.ui.refreshNow(); });
  // every visible text node under .hud: its size, and the nearest thing with a class to name it by
  const read = (where) => page.evaluate((where) => {
    const out = [];
    const walk = document.createTreeWalker(document.querySelector('.hud'), NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.textContent.replace(/\s+/g, ' ').trim(), el = n.parentElement;
      if (!text || !el || el.closest('[hidden], .xfeed, .toasts, svg, .perf-overlay')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      let name = el; while (name && !name.className && !name.id) name = name.parentElement;
      const tag = name ? (name.id ? `#${name.id}` : `.${String(name.className).split(' ')[0]}`) : el.tagName.toLowerCase();
      out.push({ where, px: Math.round(parseFloat(cs.fontSize) * 10) / 10, tag: el === name ? tag : `${tag} ${el.tagName.toLowerCase()}`, text: text.slice(0, 28), n: text.length });
    }
    return out;
  }, where);
  const rows = [];
  const take = async (where, fn) => { if (fn) await fn(); await settle(); rows.push(...await read(where)); };
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const openTool = async (id) => { if (await page.$(`.tbtn[data-t="${id}"]`)) await press(`.tbtn[data-t="${id}"]`); else { await press('.tbtn[data-t="more"]'); await settle(); await press(`[data-more="${id}"]`); } };
  const close = () => page.evaluate(() => { const g = window.__game; g.ui.openPanel(null); g.tools.set('inspect'); g.select(null); });
  await take('idle');
  for (const id of ['roads', 'zones', 'ext:services', 'views', 'landmarks', 'budget', 'help', 'communes', 'ext:districts', 'ext:transit', 'ext:land', 'ext:terraform']) { await take(id, () => openTool(id)); await close(); }
  if (await page.$('.tbtn[data-t="more"]')) { await take('more', () => press('.tbtn[data-t="more"]')); await close(); }
  await take('demand', () => press('.dbar[data-dem="res"]'));
  await page.keyboard.press('Escape');
  await take('inspector', () => page.evaluate(() => { const g = window.__game; const b = [...g.buildings.list.values()].find((x) => x.zone === 'resLow' && x.state === 'active'); if (b) g.select({ kind: 'building', b }); }));
  await close();
  await take('road tool', () => openTool('roads'));
  await close();

  // the same text is counted once per place it stands (a toolbar label shows in every state)
  const seen = new Map();
  for (const r of rows) { const k = `${r.px}|${r.tag}|${r.text}`; if (!seen.has(k)) seen.set(k, r); }
  const uniq = [...seen.values()];
  const under = uniq.filter((r) => r.px < FLOOR);
  const byTag = new Map();
  for (const r of under) { const k = `${r.px} px  ${r.tag}`; const e = byTag.get(k) ?? { n: 0, chars: 0, eg: r.text, where: new Set() }; e.n++; e.chars += r.n; e.where.add(r.where); byTag.set(k, e); }
  const sizes = [...new Set(uniq.map((r) => r.px))].sort((a, b) => a - b);
  console.log(`${kind}: ${uniq.length} runs of text, sizes ${sizes.join(', ')} px; smallest ${sizes[0]} px; ${under.length} under ${FLOOR} px (${under.reduce((a, r) => a + r.n, 0)} characters)`);
  for (const [k, e] of [...byTag].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]) || b[1].chars - a[1].chars)) console.log(`  ${k.padEnd(34)} ${String(e.n).padStart(3)} runs, ${String(e.chars).padStart(4)} chars, e.g. "${e.eg}" (${[...e.where].slice(0, 3).join(', ')})`);
  if (list) for (const s of sizes) console.log(`  ${s} px: ${uniq.filter((r) => r.px === s).length}`);
  console.log(under.length === 0 ? `OK   ${kind}: no text under ${FLOOR} px` : `FAIL ${kind}: ${under.length} runs of text under ${FLOOR} px`);
  if (under.length) bad++;
  if (errs.length) { console.log(`FAIL ${kind}: page errors`, errs.slice(0, 3)); bad++; }
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
