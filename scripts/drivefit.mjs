// Drive Mode fits a phone (src/tools/driveMode.ts builds its own buttons and panels). On a 390 x 844 touch screen: a
// car's card has Drive and Then and Now buttons 44 px tall, with no key hints in their words; Drive puts the card away (it
// is a sheet over the half of the screen the driving panel goes on) and starts driving; the camera's "Following a car"
// pill is not shown while driving; the driving panel is inside the screen and its four buttons are 44 px tall, without
// "(H)" or "(Esc)"; Exit stops driving, and the card does not come back. On a desktop the key hints are there, the card
// stays beside the map, and Esc leaves Drive Mode without opening the pause menu. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/drivefit.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();
for (const who of ['phone', 'desktop']) {
  const phone = who === 'phone';
  const W = phone ? 390 : 1280, H = phone ? 844 : 800;
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__drive, null, { timeout: 180000 });
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const frames = (n = 6) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { g.frame(1 / 60); g.ui.update(0.3); } }, n);
  // what a button is: its box, and the words a person sees on it (hidden spans left out)
  const buttons = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || [...el.attributes].find((a) => a.name.startsWith('data-'))?.name || '', says: el.innerText.replace(/\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }), sel);
  const state = () => page.evaluate(() => {
    const pill = document.querySelector('.follow-pill'), hud = document.querySelector('#slop-drive-hud'), r = hud?.getBoundingClientRect();
    return { driving: !!window.__drive.active, card: !document.querySelector('.inspector').hidden, pill: !!pill && !pill.hidden && getComputedStyle(pill).visibility !== 'hidden', panel: r ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null, pause: !!document.querySelector('.pause'), following: !!window.__game.rts.following };
  });

  await page.evaluate(() => {
    const g = window.__game, seg = [...g.net.segs.values()].sort((a, b) => b.length - a.length)[0];
    cancelAnimationFrame(g.raf);
    g.sim.speed = 1;
    const c = g.traffic.launch({ seg, s: seg.length * 0.05 }, { seg, s: seg.length * 0.95 }, null, null, 'sedan', 'a fitting', 'the far end', true, 12, true);
    for (let i = 0; i < 20; i++) { g.frame(1 / 60); g.ui.update(0.3); }
    g.rts.setView(c.x, c.z, 150, 0.6, 0.85, true);
    g.select({ kind: 'car', c });
  });
  await frames();
  await page.waitForTimeout(700);   // (a card that has just opened under a finger does not take a tap for a moment)
  const card = await buttons('.inspector [data-drive-car], .inspector [data-then-now]');
  if (phone) check(`phone: a car's card has Drive and Then and Now at ${card.map((b) => b.h).join(' and ')} px tall, with no key hints ("${card.map((b) => b.says).join('", "')}")`, card.length === 2 && card.every((b) => b.h >= 44 && !/\([A-Z][a-z]*\)/.test(b.says)), card);
  else check(`desktop: the card's buttons keep their key hints ("${card.map((b) => b.says).join('", "')}")`, card.length === 2 && /\(V\)/.test(card[0].says) && /\(N\)/.test(card[1].says), card);

  await press('.inspector [data-drive-car]');
  await frames(20);
  let s = await state();
  const panel = await buttons('#slop-drive-hud button');
  check(`${who}: Drive on the card starts Drive Mode`, s.driving && s.following && !!s.panel, s);
  if (phone) {
    check('phone: the card is put away, and the "Following a car" pill is not shown while driving', !s.card && !s.pill, s);
    check(`phone: the driving panel is inside the screen (${s.panel?.left} to ${s.panel?.right} px, ${s.panel?.top} to ${s.panel?.bottom}), its buttons ${panel.map((b) => b.h).join(', ')} px tall`, !!s.panel && s.panel.left >= 0 && s.panel.right <= W && s.panel.top >= 0 && s.panel.bottom <= H && panel.length === 4 && panel.every((b) => b.h >= 44 && b.left >= 0 && b.right <= W), { panel: s.panel, buttons: panel });
    check(`phone: and they say what they do without key hints ("${panel.map((b) => b.says).join('", "')}")`, panel.every((b) => !/\((H|Esc)\)/.test(b.says)) && panel.some((b) => /Honk/.test(b.says)) && panel.some((b) => /Exit/.test(b.says)), panel);
    await press('#drive-exit');
    await frames(20);
    s = await state();
    check('phone: Exit stops driving, and the card does not come back', !s.driving && !s.panel && !s.card && !s.following, s);
    const pillAfter = await page.evaluate(() => document.querySelector('.follow-pill').style.visibility);
    check(`phone: the pill is its own again afterwards (its visibility is "${pillAfter}")`, pillAfter !== 'hidden', { pillAfter });
  } else {
    check(`desktop: the card stays beside the map, and the panel's buttons keep their key hints ("${panel.map((b) => b.says).join('", "')}")`, s.card && panel.some((b) => /\(H\)/.test(b.says)) && panel.some((b) => /\(Esc\)/.test(b.says)), { s, panel });
    await page.keyboard.press('Escape');
    await frames(20);
    s = await state();
    check('desktop: Esc leaves Drive Mode and does not open the pause menu', !s.driving && !s.panel && !s.pause, s);
  }
  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
