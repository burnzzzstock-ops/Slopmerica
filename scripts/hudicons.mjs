// The drawn HUD icons are on the controls. Opens the game on a desktop window and on a 390 x 844 phone, opens the toolbar,
// the More grid and the Roads, Zoning, Services and Views drawers, and checks that every control with a drawn icon in
// src/art/hudIcons.ts (HUD_CONTROLS) shows it as inline SVG, that each such control still has its name in text, and that a
// control with no drawn icon still shows something. Then the places that are not a list of controls: the tool badge (Build,
// Done or Stop, Undo), the top bar's nature and sprawl meters and the phone's population stat, and a home's inspector (its
// utility row is a sign for the utility and a sign for yes or no, with the words for a screen reader; its service rows; its
// Bulldoze button), and the buttons on the cards: the Next card's, the demand card's, an emergency's and the in-the-red
// card's, Settings' sound, save and report chips, the city-wide policies and a milestone's medal. Exits nonzero on failure.
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

  // ---- the places that are not a list of controls: each is a drawing 14 px or more, with no emoji left beside it
  const spots = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null).map((el) => {
    const svg = el.querySelector('.ui-icon svg'), r = svg?.getBoundingClientRect();
    // (an emoji left where the drawing should stand: before the first word. One inside the words, "slow to ▶", is text)
    return { text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), svg: !!svg, w: r ? Math.round(r.width) : 0, emoji: /^[^\p{L}\p{N}]*\p{Extended_Pictographic}/u.test(el.textContent ?? '') };
  }), sel);
  const drawnAll = (what, rows, n) => check(`${name}: ${what}: ${rows.filter((r) => r.svg).length} of ${rows.length} drawn, 14 px or more, no emoji`, rows.length >= n && rows.every((r) => r.svg && r.w >= 14 && !r.emoji), rows);
  drawnAll('the top bar\'s nature and sprawl meters', await spots('.tb-meters .meter > span'), 2);
  if (name === 'phone') drawnAll('the population stat leads with its icon', await spots('#tb-popstat .tb-ico'), 1);
  await page.keyboard.press('Escape');
  await page.click('.tbtn[data-t="roads"]'); await settle();
  await page.evaluate(() => window.__game.ui.update(0.3));
  const badge = await spots('.tool-actions button');
  drawnAll('the tool badge', badge, name === 'phone' ? 2 : 1);
  check(`${name}: the tool badge's words are plain (${badge.map((b) => b.text).join(' | ')})`, badge.every((b) => /^(Build|Done|Stop|Undo)/.test(b.text)), badge);
  await page.keyboard.press('Escape');
  // a home, grown by script, and its inspector
  const home = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, S = g.startView();
    d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane'); d.zone(S.x, S.z + 40, 60, 'resLow'); d.run(25);
    g.tools.set('inspect');
    const b = [...g.buildings.list.values()].find((x) => x.zone === 'resLow' && x.state === 'active');
    if (b) g.select({ kind: 'building', b });
    return !!b;
  });
  check(`${name}: a home grew to inspect`, home);
  const util = await page.evaluate(() => [...document.querySelectorAll('.inspector .svc-util > span')].map((s) => ({ label: s.getAttribute('aria-label'), img: s.getAttribute('role') === 'img', n: s.querySelectorAll('.ui-icon svg').length, emoji: /\p{Extended_Pictographic}/u.test(s.textContent ?? '') })));
  check(`${name}: the inspector's four utilities are each a utility sign and a yes/no sign, with the words for a screen reader`, util.length === 4 && util.every((u) => u.img && u.n === 2 && !u.emoji && /^(Power|Water|Sewage|Garbage): /.test(u.label ?? '')), util);
  drawnAll('the inspector\'s fire, police, health and education rows', await spots('.inspector .svc-covs > div:nth-child(-n+4) > span'), 4);
  drawnAll('the inspector\'s Bulldoze button', await spots('.inspector #in-bulldoze'), 1);

  // ---- the buttons on the cards: each shows the drawing for what it does in front of its words
  const openTool = async (id) => {
    if (await page.$(`.tbtn[data-t="${id}"]`)) await page.click(`.tbtn[data-t="${id}"]`);
    else { await page.click('.tbtn[data-t="more"]'); await settle(); await page.click(`[data-more="${id}"]`); }
    await settle();
  };
  await page.evaluate(() => { const g = window.__game; g.select(null); g.ui.nextHidden = ''; g.sim.demand.res = 60; g.time += 2; g.ui.refreshNow(); });
  drawnAll('the Next card\'s button', await spots('.next-bar .chip[data-act]'), 1);
  await page.click('.dbar[data-dem="res"]'); await settle();
  await page.evaluate(() => { window.__game.sim.demand.res = 60; window.__game.ui.refreshNow(); });
  drawnAll('the demand card\'s buttons', await spots('.demand-pop .dp-acts button'), 1);
  await page.keyboard.press('Escape');
  await openTool('help');
  drawnAll('Settings: emergencies, music, sound, save and report', await spots('#emergency-toggle, #music-toggle, #sound-toggle, #save-now, #report-bug'), 5);
  await page.keyboard.press('Escape');
  await openTool('ext:districts');
  await page.click('.subpanel [data-tab="city"]'); await settle();
  verdict('city-wide policies', await read('.subpanel [data-policy]', 'policy', 'data-policy'), 10);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.ui.milestone(1));
  drawnAll('a milestone\'s medal', await spots('.toast.milestone span > b:first-child'), 1);
  // an emergency and a town in the red, both made up: their cards and what the cards offer
  await page.evaluate(() => {
    const g = window.__game, home = [...g.buildings.list.values()][0];
    g.emergency = () => ({ level: 'crit', needs: [{ need: 'power', cat: 'power', icon: '⚡', label: 'Power', failing: 'without power', buildings: 14, residents: 65, eta: [6, 18], why: 'Demand 2.3 MW against a 2.2 MW import cap.' }], atRisk: 14, residents: 65, hot: [{ x: home.x, z: home.z, n: 14, residents: 65, id: home.id }], forecast: '', forecastDays: 90, crisis: { since: g.sim.day - 3, cause: 'power', peakAtRisk: 14, peakTrash: 0, lowPop: 0, popAtStart: 0, endedAt: -1 }, trash: 0, abandoned: 2, day: g.sim.day });
    g.sim.money = -5000; g.sim.speed = 1;
    g.ui.refreshNow();
  });
  drawnAll('the emergency card\'s heading', await spots('.emergency .em-head > b'), 1);
  drawnAll('the emergency card\'s Fix, Worst area and Pause', await spots('.emergency .em-acts .chip'), 3);
  drawnAll('the in-the-red card\'s Budget and Pause', await spots('.crisis .crisis-acts .chip'), 2);
  check(`${name}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
