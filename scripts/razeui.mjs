// The bulldozer's Undo, from the interface. The simulation's command (game.bulldozeBuilding, scripts/razeundo.mjs) puts a
// bulldozed home back as it stood; this is the buttons. On a desktop and a 390 x 844 phone, on a street of grown homes:
// Bulldoze on a home's card leaves an Undo for it and offers it there and then (a toast with an Undo button, 44 px on the
// phone: the card has closed, no tool is in hand, and a phone has no Ctrl+Z), and the button puts the same home back; on the
// desktop Ctrl+Z does the same; with the bulldozer in hand the tool badge has its Undo button; one drag of the bulldozer
// over several homes is one Undo ("bulldozing 3 buildings") that puts them all back; and two separate presses are two Undos.
// Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/razeui.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();
for (const who of ['desktop', 'phone']) {
  const phone = who === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const town = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, S = g.startView();
    cancelAnimationFrame(g.raf);
    for (const c of g.communes.list) { c.state = 'gone'; c.group?.removeFromParent(); }
    g.sim.money += 5e6;
    d.road(S.x - 220, S.z, S.x + 220, S.z, 'twoLane');
    d.zone(S.x, S.z + 40, 230, 'resLow'); d.zone(S.x, S.z - 40, 230, 'resLow');
    d.run(40);
    g.sim.speed = 0;
    const homes = [...g.buildings.list.values()].filter((b) => b.state === 'active' && (b.zone === 'resLow')).sort((a, b) => a.x - b.x);
    return { homes: homes.length, undo: g.undoLabel };
  });
  check(`${who}: a street of grown homes (${town.homes})`, town.homes >= 8, town);
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const frames = () => page.evaluate(() => { const g = window.__game; for (let i = 0; i < 3; i++) { g.frame(1 / 30, false); g.ui.update(0.3); } });
  const home = (skip = []) => page.evaluate((skip) => {
    const g = window.__game, b = [...g.buildings.list.values()].filter((b) => b.state === 'active' && b.zone === 'resLow' && !skip.includes(b.id)).sort((a, b) => a.x - b.x)[0];
    return b ? { id: b.id, label: b.label, level: b.level, x: b.x, z: b.z } : null;
  }, skip);
  const there = (id) => page.evaluate((id) => { const b = window.__game.buildings.list.get(id); return b ? { level: b.level, label: b.label, state: b.state } : null; }, id);
  const offer = () => page.evaluate(() => { const t = document.querySelector('.toasts .toast.undo-offer'), b = t?.querySelector('button'), r = b?.getBoundingClientRect(); return t && !t.classList.contains('out') ? { text: t.textContent.replace(/\s+/g, ' ').trim(), h: r ? Math.round(r.height) : 0, w: r ? Math.round(r.width) : 0 } : null; });

  // ---- Bulldoze on a home's card: an Undo, offered there and then ----
  const a = await home();
  await page.evaluate((id) => { const g = window.__game; g.tools.set('inspect'); g.select({ kind: 'building', b: g.buildings.list.get(id) }); }, a.id);
  await frames();
  // (a card that has just opened under a finger does not take a tap for a moment: the HUD's guard against ghost taps)
  await page.waitForTimeout(700);
  await press('.inspector #in-bulldoze');
  await frames();
  let st = await page.evaluate(() => ({ undo: window.__game.undoLabel, card: !document.querySelector('.inspector').hidden }));
  let off = await offer();
  check(`${who}: Bulldoze on a home's card takes it down and leaves an Undo for it ("${st.undo}")`, (await there(a.id)) === null && st.undo === `bulldozing ${a.label}`, st);
  check(`${who}: and offers it there and then ("${off?.text}"${phone ? `, the button ${off?.w} x ${off?.h} px` : ''})`, !!off && off.text.includes(a.label) && /Undo/.test(off.text) && (!phone || off.h >= 44), off);
  await press('.toasts .toast.undo-offer button');
  await frames();
  let back = await there(a.id);
  check(`${who}: its Undo button puts the same home back as it stood (level ${back?.level}, it was ${a.level}) and the offer goes`, !!back && back.level === a.level && back.label === a.label && (await offer()) === null, back);

  if (!phone) {
    await page.evaluate((id) => { const g = window.__game; g.select({ kind: 'building', b: g.buildings.list.get(id) }); }, a.id);
    await frames();
    await press('.inspector #in-bulldoze');
    await frames();
    await page.keyboard.press('Control+z');
    await frames();
    back = await there(a.id);
    check('Ctrl+Z after a card\'s Bulldoze puts the home back too', !!back && back.level === a.level, back);
  }

  // ---- the bulldozer in hand: its badge has Undo, and one drag is one Undo ----
  const drag = await page.evaluate(() => {
    const g = window.__game, t = g.tools;
    const homes = [...g.buildings.list.values()].filter((b) => b.state === 'active' && b.zone === 'resLow').sort((a, b) => a.x - b.x).slice(2, 5);
    const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now(), type, shiftKey: false });
    const V = g.camera.position.constructor, P = homes.map((b) => new V(b.x, b.y, b.z));
    t.set('bulldoze');
    t.down(P[0], ev('pointerdown'));
    for (const p of P) t.move(p, ev('pointermove'), true);
    t.up(P[P.length - 1], ev('pointerup'), true);
    g.ui.update(0.3);
    const u = document.querySelector('#ta-undo');
    return { ids: homes.map((b) => b.id), gone: homes.filter((b) => !g.buildings.list.has(b.id)).length, undo: g.undoLabel, button: { shown: !!u && !u.hidden && u.offsetParent !== null, enabled: !!u && !u.disabled, title: u?.title ?? '', h: u ? Math.round(u.getBoundingClientRect().height) : 0 } };
  });
  check(`${who}: one drag of the bulldozer over three homes takes them down as one Undo ("${drag.undo}")`, drag.gone === 3 && drag.undo === 'bulldozing 3 buildings', drag);
  // (its size for a finger is phonetargets' business, with the badge's other buttons)
  check(`${who}: with the bulldozer in hand the badge has its Undo button ("${drag.button.title}")`, drag.button.shown && drag.button.enabled && drag.button.title === 'Undo bulldozing 3 buildings (Ctrl+Z)', drag.button);
  await press('#ta-undo');
  await frames();
  const all = await page.evaluate((ids) => ids.filter((id) => window.__game.buildings.list.has(id)).length, drag.ids);
  check(`${who}: that Undo puts all three back (${all} of 3)`, all === 3, { all });

  // ---- two separate presses are two Undos ----
  const two = await page.evaluate(() => {
    const g = window.__game, t = g.tools;
    const homes = [...g.buildings.list.values()].filter((b) => b.state === 'active' && b.zone === 'resLow').sort((a, b) => a.x - b.x).slice(5, 7);
    const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now(), type, shiftKey: false });
    const V = g.camera.position.constructor;
    t.set('bulldoze');
    const labels = [];
    for (const b of homes) { const p = new V(b.x, b.y, b.z); t.down(p, ev('pointerdown')); t.up(p, ev('pointerup'), false); labels.push(g.undoLabel); }
    const ids = homes.map((b) => b.id), has = () => ids.map((id) => g.buildings.list.has(id));
    const gone = has();
    g.undo(); const one = has();
    g.undo(); const both = has();
    t.set('inspect');
    return { names: homes.map((b) => b.label), labels, gone, one, both };
  });
  check(`${who}: two presses on two homes are two Undos (${two.labels.join(' | ')}): the first Undo puts the second home back, the next the first`, two.labels[0] === `bulldozing ${two.names[0]}` && two.labels[1] === `bulldozing ${two.names[1]}` && !two.gone[0] && !two.gone[1] && !two.one[0] && two.one[1] && two.both[0] && two.both[1], two);
  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
