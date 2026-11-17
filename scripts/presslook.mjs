// Every control answers a press. The page switches the browser's tap highlight off, and no button in the HUD had a
// pressed look: a finger on a toolbar button, a chip or a card changed nothing until whatever the control did had
// happened. On a phone (a finger held down through the debugger's touch events) and on the desktop (the mouse held
// down), for a toolbar button, a speed button, the population stat, a drawer's chip and card, a More tile, the tool
// badge and the inspector's Bulldoze: held, the control is brighter than at rest (and the plain buttons a little
// smaller); a mouse over it is brighter too; a locked card does neither. Each press is let go off the control, so
// nothing is clicked. Exits nonzero on failure.
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
  await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game, d = window.__dbg, S = g.startView(); cancelAnimationFrame(g.raf); d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane'); d.zone(S.x, S.z + 40, 60, 'resLow'); d.run(25); g.frame(0.05, false); g.ui.update(0.3); document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  const cdp = phone ? await ctx.newCDPSession(page) : null;
  const tap = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const look = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { filter: cs.filter, transform: cs.transform }; }, sel);
  const brightness = (s) => Number(/brightness\(([\d.]+)\)/.exec(s?.filter ?? '')?.[1] ?? 1);
  // hold the pointer down on a control, look at it, and let go somewhere else: no click
  const held = async (sel) => {
    const box = await page.locator(sel).first().boundingBox();
    if (!box) return null;
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    const rest = await look(sel);
    let over = null;
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    else { await page.mouse.move(x, y); await page.waitForTimeout(60); over = await look(sel); await page.mouse.down(); }
    await page.waitForTimeout(150);
    const down = await look(sel);
    if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 300, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); }
    else { await page.mouse.move(640, 300); await page.mouse.up(); }
    await page.waitForTimeout(60);
    return { rest, over, down, after: await look(sel) };
  };
  const answers = async (what, sel, sinks) => {
    const h = await held(sel);
    const b = brightness(h?.down), s = h?.down.transform !== 'none';
    check(`${kind}: ${what}: held, it is brighter (${b}x)${sinks ? ' and a little smaller' : ''}; at rest and once let go it is as it was`, !!h && brightness(h.rest) === 1 && b >= 1.3 && (!sinks || s) && brightness(h.after) === 1 && h.after.transform === h.rest.transform, h);
    if (!phone) check(`${kind}: ${what}: under the mouse it is brighter too (${brightness(h?.over)}x), less than when pressed`, !!h && brightness(h.over) > 1 && brightness(h.over) < b, h);
  };

  await answers('a toolbar button', '.tbtn[data-t="views"]', true);
  await answers('a speed button', '.tb-speed [data-speed="2"]', false);
  await answers('the population stat', '#tb-popstat', false);
  await tap('.tbtn[data-t="roads"]');
  await page.evaluate(() => { const g = window.__game; g.frame(0.05, false); g.ui.update(0.3); });
  await answers('a chip in a drawer (Curved)', '.subpanel [data-mode="curve"]', true);
  await answers('a card in a drawer (the gravel road)', '.subpanel .card[data-road="gravel"]', true);
  if (phone) await answers('the tool badge\'s Done', '#ta-done', true);
  // a road this new county has not earned: a locked card answers nothing
  const locked = await held('.subpanel .card:disabled');
  check(`${kind}: a locked card does not answer a press`, !!locked && brightness(locked.down) === 1 && locked.down.transform === 'none', locked);
  await page.keyboard.press('Escape');
  if (await page.$('.tbtn[data-t="more"]')) { await tap('.tbtn[data-t="more"]'); await answers('a More tile', '.more-btn[data-more="communes"]', true); await page.keyboard.press('Escape'); }
  const home = await page.evaluate(() => { const g = window.__game; g.tools.set('inspect'); const b = [...g.buildings.list.values()].find((x) => x.zone === 'resLow' && x.state === 'active'); if (b) g.select({ kind: 'building', b }); return b?.id ?? -1; });
  await page.waitForTimeout(450);
  await answers('the inspector\'s Bulldoze', '#in-bulldoze', true);
  check(`${kind}: and the home still stands (the press was let go off the button)`, await page.evaluate((id) => window.__game.buildings.list.has(id), home));
  check(`${kind}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
