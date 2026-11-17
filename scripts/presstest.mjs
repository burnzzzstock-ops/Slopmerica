// A slow press on an inspector button still counts. The card of a building, car or lot is redrawn four times a
// second for its live numbers; a press still down at a redraw lost its button from under it, and the click with
// it (Bulldoze held for 400 ms did nothing). With the game running at normal speed this holds the mouse, and on a
// phone a finger, on Bulldoze for 30, 400 and 700 ms and expects the building gone each time; then checks the card
// still follows its numbers once the press is over. The mouse was what broke: a finger's click goes to whatever is
// under it when it lifts, so the phone half passed before the fix and is here to keep it so. On the phone it also looks at
// every home's card: Bulldoze inside the sheet, finger-sized and under the finger. Exits nonzero on failure.
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); if (!ok) bad++; };
const browser = await launch();
for (const kind of ['desk', 'phone']) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  // a street of homes, and the game left running live: the redraws come from its own frames
  await page.evaluate(() => { const g = window.__game, d = window.__dbg, S = g.startView(); d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane'); d.zone(S.x, S.z + 40, 60, 'resLow'); d.run(25); g.sim.speed = 1; });
  const cdp = phone ? await ctx.newCDPSession(page) : null;
  const pick = () => page.evaluate(() => { const g = window.__game; g.tools.set('inspect'); const b = [...g.buildings.list.values()].find((x) => x.zone === 'resLow' && x.state === 'active'); if (b) g.select({ kind: 'building', b }); return b?.id ?? -1; });
  for (const hold of [30, 400, 700]) {
    const id = await pick();
    await page.waitForTimeout(450); // past the guard against the tap that opened the sheet
    // (read in one go inside the page: the card is redrawn four times a second, and a locator that found the button and then
    // asked for its box could find it replaced in between and get nothing, which is how this test crashed twice under load)
    const box = await page.evaluate(() => { const r = document.querySelector('#in-bulldoze')?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; });
    if (!box) {
      // no button to press: say what is on screen instead (the card may have been put away, or be another thing's)
      const seen = await page.evaluate((id) => { const g = window.__game, i = document.querySelector('.inspector'); return { selected: g.selection ? `${g.selection.kind}:${g.selection.b?.id ?? ''}` : null, wanted: id, sheet: i.hidden ? 'hidden' : (i.querySelector('h3')?.textContent ?? 'no heading'), tool: g.tools.active, following: !!g.rts.following, standing: g.buildings.list.has(id) }; }, id);
      check(`${kind}: the card of home ${id} has a Bulldoze button to press for ${hold} ms`, false, seen);
      await page.evaluate(() => window.__game.select(null));
      continue;
    }
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(hold);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(hold);
      await page.mouse.up();
    }
    await page.waitForTimeout(250);
    const gone = await page.evaluate((id) => !window.__game.buildings.list.has(id), id);
    check(`${kind}: Bulldoze pressed for ${hold} ms bulldozes the building`, id >= 0 && gone, { id, gone });
    await page.evaluate(() => window.__game.select(null));
  }
  if (phone) {
    // Every home on the street, not the three that were pressed: its card's Bulldoze is whole inside the sheet, as tall as a
    // finger needs, and what a finger at its middle lands on. A card taller than the sheet once put it under the fold on one
    // home in seven, and three presses on three homes found that only by luck.
    const reach = await page.evaluate(() => {
      const g = window.__game, out = [];
      for (const b of [...g.buildings.list.values()].filter((x) => x.zone === 'resLow' && x.state === 'active')) {
        g.select({ kind: 'building', b });
        g.ui.update(0.3);
        const sheet = document.querySelector('.inspector'), btn = document.querySelector('#in-bulldoze'), r = btn.getBoundingClientRect(), s = sheet.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out.push({ id: b.id, h: Math.round(r.height), over: Math.max(0, sheet.scrollHeight - sheet.clientHeight), inside: r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5, hit: !!hit && (hit === btn || btn.contains(hit)) });
      }
      g.select(null);
      return out;
    });
    const wrong = reach.filter((r) => !r.inside || !r.hit || r.h < 44);
    check(`${kind}: on every home's card (${reach.length} homes, the tallest card ${Math.max(0, ...reach.map((r) => r.over))} px taller than its sheet) Bulldoze is inside the sheet, 44 px tall and under the finger`, reach.length >= 3 && wrong.length === 0, wrong.length ? wrong : reach);
  }
  // with nothing pressed the card keeps up with the building
  const id = await pick();
  await page.evaluate((id) => { const g = window.__game; g.sim.speed = 0; g.buildings.list.get(id).lv = 77; }, id);
  await page.waitForTimeout(700);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.inspector .in-stats div')].find((d) => d.querySelector('span')?.textContent === 'Land value')?.querySelector('b')?.textContent);
  check(`${kind}: the card still follows its numbers once the press is over (land value reads ${shown})`, shown === '77', shown);
  check(`${kind}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
