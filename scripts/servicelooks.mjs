// How the service buildings look (the Asset Vault's versions or the classic ones) is chosen in Settings, not in the
// Services drawer. The row stood under the drawer's cards, the tallest drawer on a phone. On a phone and on the
// desktop, once the vault's pack has loaded: the Services drawer has no such row; Settings has the two choices, a
// finger can hit them, and the one in use is lit; choosing Classic puts a standing fire station in its classic
// model at once and is remembered, and Asset Vault puts it back: the same building both times. Exits nonzero on
// failure.
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
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); localStorage.removeItem('slopmerica.svcLook'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
  const ready = await page.waitForFunction(() => window.__vault?.status() === 'ready', null, { timeout: 90000 }).then(() => true).catch(() => false);
  check(`${kind}: the vault's pack has loaded (there is a choice to make)`, ready, await page.evaluate(() => window.__vault?.status()));
  if (!ready) { await ctx.close(); continue; }
  // a street and a fire station on it, open
  const station = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, SV = window.__services, S = g.startView();
    cancelAnimationFrame(g.raf); d.unlockAll();
    d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane');
    let b = null;
    for (let t = 0; t < 12 && !b; t++) { const spot = SV.findSpot(g, 'fireStation', S.x - 100 + t * 20, S.z + 30); b = spot && spot.ok !== false ? SV.place(g, 'fireStation', spot.x, spot.z, spot.yaw) : null; }
    if (!b) return null;
    b.state = 'active'; b.progress = 1; g.buildings.dropScaffold(b); g.buildings.writeMatrix(b, 1);
    g.frame(0.05, false); g.ui.update(0.3);
    return b.id;
  });
  check(`${kind}: a fire station stands on the test street`, station !== null, station);
  if (station === null) { await ctx.close(); continue; }
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const openTool = async (id) => { if (await page.$(`.tbtn[data-t="${id}"]`)) await press(`.tbtn[data-t="${id}"]`); else { await press('.tbtn[data-t="more"]'); await press(`[data-more="${id}"]`); } await page.waitForTimeout(150); };
  const read = () => page.evaluate((id) => {
    const g = window.__game, b = g.buildings.list.get(id), chips = [...document.querySelectorAll('.subpanel [data-look]')];
    return { chips: chips.map((c) => ({ look: c.dataset.look, on: c.classList.contains('on'), h: Math.round(c.getBoundingClientRect().height), w: Math.round(c.getBoundingClientRect().width) })), stored: localStorage.getItem('slopmerica.svcLook'), vault: !!b?.onMain, standing: !!b && b.state === 'active', drawer: Math.round(document.querySelector('.subpanel').getBoundingClientRect().height) };
  }, station);

  await openTool('ext:services');
  let s = await read();
  check(`${kind}: the Services drawer has no Looks row (the drawer is ${s.drawer} px tall)`, s.chips.length === 0, s);
  await page.keyboard.press('Escape');
  await openTool('help');
  s = await read();
  check(`${kind}: Settings has the two looks, the one in use lit${phone ? ', each finger-sized' : ''}`, s.chips.length === 2 && s.chips.find((c) => c.look === 'vault')?.on === true && s.chips.find((c) => c.look === 'classic')?.on === false && s.vault && (!phone || s.chips.every((c) => c.h >= 44 && c.w >= 44)), s);
  await press('.subpanel [data-look="classic"]');
  await page.waitForTimeout(150);
  s = await read();
  check(`${kind}: Classic puts the standing fire station in its classic model at once, and is remembered`, s.standing && !s.vault && s.stored === 'classic' && s.chips.find((c) => c.look === 'classic')?.on === true, s);
  await press('.subpanel [data-look="vault"]');
  await page.waitForTimeout(150);
  s = await read();
  check(`${kind}: Asset Vault puts it back: the same building`, s.standing && s.vault && s.stored === 'vault' && s.chips.find((c) => c.look === 'vault')?.on === true, s);
  check(`${kind}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
