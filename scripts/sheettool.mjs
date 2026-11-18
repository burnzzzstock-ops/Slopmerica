// A card that opens on a phone puts the tool in hand away. A phone's inspector is a sheet over the lower half of the
// screen; a card can open while a tool is in hand (the worst area of an emergency, a commune in a road's way, a
// site picked from a list, anything that calls game.select). The tool's Done badge then stayed up over the card,
// its toolbar button stayed lit and the map under the sheet still took strokes. On a 390 x 844 phone, with the
// Zoning tool and then the Roads tool in hand, a road's card and a car's card are opened as those callers do: the
// tool is Select, the badge and the drawer are gone and only Select is lit; closing the card leaves it so. On the
// desktop, where the card is a panel at the side, the tool stays in hand. Exits nonzero on failure.
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); if (!ok) bad++; };
const browser = await launch();
for (const kind of ['phone', 'desk']) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  // a street, homes on it and a car sent down it; frames by hand
  const made = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, S = g.startView();
    cancelAnimationFrame(g.raf);
    d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane'); d.zone(S.x, S.z + 40, 60, 'resLow'); d.run(20);
    const seg = [...g.net.segs.values()].at(-1);
    const c = g.traffic.launch({ seg, s: seg.length * 0.1 }, { seg, s: seg.length * 0.9 }, null, null, 'sedan', 'sheet test', 'the far end', true, 12, true);
    return { seg: seg.id, car: c?.id ?? null };
  });
  const frames = (n = 4) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { g.frame(1 / 30, false); g.ui.update(0.3); } }, n);
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const state = () => page.evaluate(() => {
    const g = window.__game, vis = (el) => !!el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
    return { tool: g.tools.active, badge: vis(document.querySelector('.tool-actions')), drawer: vis(document.querySelector('.subpanel')), sheet: vis(document.querySelector('.inspector')), lit: [...document.querySelectorAll('.toolbar .tbtn.on')].map((b) => b.dataset.t), selected: g.selection?.kind ?? null };
  });
  const open = (what) => page.evaluate(({ what, made }) => { const g = window.__game; if (what === 'road') g.select({ kind: 'road', s: g.net.segs.get(made.seg) }); else g.select({ kind: 'car', c: g.traffic.cars.find((c) => c.id === made.car) }); }, { what, made });

  for (const [tool, button, card] of [['zone', 'zones', 'road'], ['road', 'roads', 'car']]) {
    await press(`.tbtn[data-t="${button}"]`);
    await frames();
    let s = await state();
    check(`${kind}: ${button} tapped: the ${tool} tool is in hand${phone ? ' with its Done badge up' : ''}`, s.tool === tool && (!phone || s.badge) && s.lit.includes(button), s);
    await open(card);
    await frames();
    s = await state();
    if (phone) check(`${kind}: a ${card}'s card opened with it in hand: the tool is put away (${s.tool}), no Done badge, no drawer, only Select lit (${s.lit.join(', ')})`, s.sheet && s.selected === card && s.tool === 'inspect' && !s.badge && !s.drawer && s.lit.join() === 'inspect', s);
    else check(`${kind}: a ${card}'s card opened with it in hand: the card is beside the map and the tool stays (${s.tool})`, s.sheet && s.selected === card && s.tool === tool && s.lit.includes(button), s);
    await page.evaluate(() => window.__game.select(null));
    await frames();
    s = await state();
    if (phone) check(`${kind}: with the card closed nothing is in hand and no badge comes back`, !s.sheet && s.tool === 'inspect' && !s.badge && !s.drawer, s);
    // (not Esc: on the phone nothing is open by now, and Esc with nothing open is the pause menu)
    await page.evaluate(() => { const g = window.__game; g.ui.openPanel(null); g.tools.set('inspect'); });
    await frames();
  }
  check(`${kind}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
