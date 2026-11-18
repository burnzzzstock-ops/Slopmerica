// The pause menu. Esc closes what is open (a drawer, the tool in hand, a card), lets go of a followed car, and with nothing
// left to put away opens a menu: Resume, Save, Settings, Quit to title. While it is up the game waits and the game's own
// keys do nothing; Esc, Resume or a press outside it goes on at the speed the game had. Tab and the arrows stay inside it.
// Save saves; Settings opens the drawer; Quit to title saves and goes to the title screen, where the city is there to
// resume; when the browser will not store the city, the first press says so and the second leaves. On a 390 x 844 phone
// the menu fits and every button is 44 px or more. An ending's card is not interrupted.
// Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/menutest.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const browser = await launch();

for (const who of ['desktop', 'phone']) {
  const phone = who === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); g.sim.speed = 2; g.ui.refreshNow(); });
  const state = () => page.evaluate(() => {
    const g = window.__game, m = document.querySelector('.pause'), sheet = m?.querySelector('.pm-sheet'), r = sheet?.getBoundingClientRect();
    const btns = m ? [...m.querySelectorAll('button')] : [];
    return {
      up: !!m, speed: g.sim.speed, tool: g.tools.active, panel: g.ui.panel ?? null,
      card: !(document.querySelector('.inspector')?.hidden ?? true), following: !!g.rts.following,
      role: m?.getAttribute('role') ?? null, modal: m?.getAttribute('aria-modal') ?? null, title: m ? document.getElementById(m.getAttribute('aria-labelledby') ?? '')?.textContent ?? null : null,
      labels: btns.map((b) => b.textContent.trim()), focus: document.activeElement?.closest?.('.pause') ? document.activeElement.textContent.trim() : (document.activeElement?.tagName ?? null),
      box: r ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
      minH: btns.length ? Math.min(...btns.map((b) => Math.round(b.getBoundingClientRect().height))) : 0,
      minPx: m ? Math.min(...[...m.querySelectorAll('h2, p, button, .pm-status')].map((e) => parseFloat(getComputedStyle(e).fontSize))) : 0,
      status: m?.querySelector('.pm-status')?.textContent ?? '', paused: document.querySelector('[data-speed="0"]')?.classList.contains('on') ?? null,
    };
  });
  const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(120); };
  const menuUp = () => page.waitForSelector('.pause', { timeout: 15000 }).then(() => true, () => false);
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const W = phone ? 390 : 1280, H = phone ? 844 : 800;

  // ---- Esc puts away what is open first, and only then opens the menu ----
  if (!phone) {
    await press('.tbtn[data-t="roads"]');
    await esc();
    let s = await state();
    check(`Esc with the Roads drawer open closes the drawer and puts the tool away, and there is no menu (tool ${s.tool})`, !s.up && s.tool === 'inspect' && s.panel === null && s.speed === 2, s);
    await page.evaluate(() => { const g = window.__game; g.select({ kind: 'road', s: [...g.net.segs.values()][0] }); });
    await esc();
    s = await state();
    check('Esc with a card open closes the card, and there is no menu', !s.up && !s.card && s.speed === 2, s);
    const followed = await page.evaluate(() => {
      const g = window.__game, seg = [...g.net.segs.values()].sort((a, b) => b.length - a.length)[0];
      const c = g.traffic.launch({ seg, s: seg.length * 0.1 }, { seg, s: seg.length * 0.9 }, null, null, 'sedan', 'menu test', 'the far end', true, 12, true);
      if (!c) return false;
      for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
      g.rts.follow({ kind: 'car', id: c.id });
      g.frame(1 / 30, false); g.ui.update(0.3);
      return !!g.rts.following && !document.querySelector('.follow-pill').hidden;
    });
    if (followed) {
      await esc();
      s = await state();
      check('Esc while the camera follows a car lets go of it, and there is no menu', !s.up && !s.following && s.speed === 2, s);
      await page.evaluate(() => { const g = window.__game; g.frame(1 / 30, false); g.ui.update(0.3); });
    } else console.log('(no car could be followed here: that check is skipped)');
  }

  // ---- with nothing to put away, Esc opens the menu and the game waits ----
  if (phone) await page.evaluate(() => window.__game.ui.openMenu()); else await esc();
  let up = await menuUp();
  let s = await state();
  check(`${who}: ${phone ? 'openMenu()' : 'Esc with nothing open'} brings up the pause menu (${s.labels.join(', ')})`, up && s.up && ['Resume', 'Save', 'Settings', 'Quit to title'].every((l) => s.labels.includes(l)), s);
  check(`${who}: the game waits while it is up (speed ${s.speed}), and the top bar shows it paused`, s.speed === 0 && s.paused !== false, s);
  check(`${who}: it is a dialog with a name ("${s.title}"), and Resume has the focus`, s.role === 'dialog' && s.modal === 'true' && s.title === 'Paused' && s.focus === 'Resume', s);
  check(`${who}: it fits the screen (${s.box?.left} to ${s.box?.right} px, ${s.box?.top} to ${s.box?.bottom}); buttons ${s.minH} px or more, text ${s.minPx} px or more`, !!s.box && s.box.left >= 0 && s.box.right <= W && s.box.top >= 0 && s.box.bottom <= H && s.minH >= 44 && s.minPx >= 12, s);

  if (!phone) {
    // the game's own keys stay out of it
    await page.keyboard.press('b'); await page.keyboard.press('3'); await page.keyboard.press('u'); await page.keyboard.press('p');
    s = await state();
    const photo = await page.evaluate(() => window.__game.photo.active);
    check(`the game's keys (B, 3, U, P) do nothing while it is up (tool ${s.tool}, speed ${s.speed}, photo mode ${photo ? 'on' : 'off'})`, s.up && s.tool === 'inspect' && s.speed === 0 && !photo, s);
    // Tab and the arrows go round inside it
    const seen = [];
    for (let i = 0; i < s.labels.length; i++) { await page.keyboard.press('Tab'); seen.push((await state()).focus); }
    await page.keyboard.press('Shift+Tab');
    const back = (await state()).focus;
    await page.keyboard.press('ArrowUp');
    const upKey = (await state()).focus;
    check(`Tab goes round inside the menu (${seen.join(' > ')}), Shift+Tab back (${back}), the up arrow before that (${upKey})`, seen.join('|') === [...s.labels.slice(1), s.labels[0]].join('|') && back === s.labels.at(-1) && upKey === s.labels.at(-2), { seen, back, upKey });
    // a click on the map behind it does not reach the map
    const sel0 = (await state()).card;
    await esc();
    s = await state();
    check(`Esc again closes it and the game goes on at the speed it had (${s.speed})`, !s.up && s.speed === 2 && s.tool === 'inspect' && !sel0, s);
    // Space pauses, then the menu: Resume leaves it paused, as it was
    await page.evaluate(() => { window.__game.sim.speed = 0; });
    await esc(); await menuUp();
    await press('.pause [data-pm="resume"]');
    s = await state();
    check(`opened on a paused game, Resume leaves it paused (speed ${s.speed})`, !s.up && s.speed === 0, s);
    await page.evaluate(() => { window.__game.sim.speed = 2; });
    // a press outside the sheet is Resume
    await esc(); await menuUp();
    await page.mouse.click(40, 400);
    await page.waitForTimeout(120);
    s = await state();
    check(`a press outside the sheet closes it too, and nothing on the map was picked (speed ${s.speed})`, !s.up && s.speed === 2 && !s.card && s.tool === 'inspect', s);
    await esc(); await menuUp();
  }

  // ---- Save ----
  const before = await page.evaluate(() => (localStorage.getItem('slopmerica.save.v1') ?? '').length);
  await page.evaluate(() => localStorage.removeItem('slopmerica.save.v1'));
  await press('.pause [data-pm="save"]');
  s = await state();
  const saved = await page.evaluate(() => (localStorage.getItem('slopmerica.save.v1') ?? '').length);
  check(`${who}: Save saves the city (${saved} characters stored) and says so ("${s.status}"); the menu stays`, s.up && saved > 1000 && s.status === 'Saved.', { before, saved, status: s.status });

  // ---- Settings ----
  await press('.pause [data-pm="settings"]');
  await page.waitForTimeout(150);
  s = await state();
  const settings = await page.evaluate(() => { const b = document.querySelector('.subpanel #save-now'); return window.__game.ui.panel === 'help' && !!b && b.offsetParent !== null; });
  check(`${who}: Settings closes the menu and opens the Settings drawer; the game goes on (speed ${s.speed})`, !s.up && settings && s.speed === 2, { ...s, settings });
  await page.evaluate(() => { const g = window.__game; g.ui.openPanel(null); g.tools.set('inspect'); });

  // ---- an ending's card is not interrupted ----
  if (!phone) {
    await page.evaluate(() => { const g = window.__game; g.ui.ending('sprawl'); });
    await esc();
    await page.waitForTimeout(200);
    s = await state();
    const ending = await page.evaluate(() => !!document.querySelector('.ending'));
    check('with an ending card up, Esc does not open the menu over it', ending && !s.up, s);
    await page.evaluate(() => { document.querySelector('.ending')?.remove(); window.__game.sim.speed = 2; });
  }

  // ---- Quit to title: the city is saved and the title screen offers it ----
  await page.evaluate(() => localStorage.removeItem('slopmerica.save.v1'));
  if (phone) await page.evaluate(() => window.__game.ui.openMenu()); else await esc();
  await menuUp();
  const city = await page.evaluate(() => window.__game.cityName);
  await Promise.all([page.waitForSelector('.title #continue', { timeout: 120000 }).catch(() => null), press('.pause [data-pm="quit"]')]);
  const title = await page.evaluate(() => ({ title: !!document.querySelector('.title'), resume: document.querySelector('.title #continue')?.textContent.replace(/\s+/g, ' ').trim() ?? null, game: !!window.__game }));
  check(`${who}: Quit to title goes to the title screen, with the city there to resume ("${(title.resume ?? '').slice(0, 44)}")`, title.title && !!title.resume && title.resume.includes(city), title);

  // ---- a browser that will not store the city: the first press says so, the second leaves ----
  if (!phone && title.resume) {
    await page.click('.title #continue');
    await page.waitForFunction(() => window.__game && window.__dbg && !document.querySelector('.loading'), null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const g = window.__game, real = Storage.prototype.setItem;
      cancelAnimationFrame(g.raf);
      Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('slopmerica.save')) throw new DOMException('no room', 'QuotaExceededError'); return real.call(this, k, v); };
      document.querySelector('.onboard')?.remove();
      g.ui.openPanel(null); g.tools.set('inspect'); g.ui.select(null);
      g.ui.openMenu();
    });
    await menuUp();
    await press('.pause [data-pm="quit"]');
    await page.waitForTimeout(300);
    s = await state();
    const still = await page.evaluate(() => !!window.__game && !document.querySelector('.title'));
    check(`when the browser will not store the city, Quit to title says so first and stays ("${s.status}")`, still && s.up && /Could not save in this browser/.test(s.status) && /again/.test(s.status), { still, ...s });
    await Promise.all([page.waitForSelector('.title', { timeout: 120000 }).catch(() => null), press('.pause [data-pm="quit"]')]);
    const left = await page.evaluate(() => !!document.querySelector('.title'));
    check('the second press leaves for the title screen', left);
  }

  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
