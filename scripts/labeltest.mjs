// Every control has a name. A screen reader, a voice-control user and a switch user know a button by its accessible
// name; a button whose whole content is a drawing, a symbol or an emoji has none unless it is given one. On a desktop
// and a 390 x 844 phone this opens every state of the interface (the title screen and its New city screen, the welcome
// card, the bar at rest, every toolbar drawer and More item, the cards for a road, a home, an open lot and a car, the
// Roads tool in hand, photo mode with Adjust open, the bug report, the pause menu) and, in each, lists the visible
// controls with no name: no aria-label, no labelling element, no title, no words of their own. Exits nonzero if there
// is one.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/labeltest.mjs [--list]     --list prints every control and its name
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const LIST = process.argv.includes('--list');
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 900)); if (!ok) bad++; };

// runs in the page: the visible controls, each with the name it would be announced by ('' when it has none)
const controls = () => {
  const words = (s) => /[\p{L}\p{N}]{2,}|^\s*[\p{L}\p{N}]\s*$/u.test(s ?? '');
  const shown = (el) => {
    if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const text = (el) => {
    // the words a control carries itself: its text, and the alt or label of a picture inside it
    let s = '';
    const walk = (n) => {
      if (n.nodeType === 3) { s += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.getAttribute('aria-hidden') === 'true' || n.hidden) return;
      const st = getComputedStyle(n);
      if (st.display === 'none') return;
      if (n.getAttribute('aria-label')) { s += ' ' + n.getAttribute('aria-label') + ' '; return; }
      if (n.tagName === 'IMG') { s += ' ' + (n.getAttribute('alt') ?? '') + ' '; return; }
      if (n.tagName === 'svg' || n.tagName === 'SVG') { s += ' ' + (n.querySelector('title')?.textContent ?? '') + ' '; return; }
      for (const c of n.childNodes) walk(c);
    };
    for (const c of el.childNodes) walk(c);
    return s.replace(/\s+/g, ' ').trim();
  };
  const nameOf = (el) => {
    const al = el.getAttribute('aria-label');
    if (words(al)) return al.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (words(t)) return t; }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const lab = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (lab && words(text(lab))) return text(lab);
      if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) && words(el.value)) return el.value;
    } else {
      const t = text(el);
      if (words(t)) return t;
    }
    if (words(el.getAttribute('title'))) return el.getAttribute('title').trim();
    if (words(el.getAttribute('placeholder'))) return el.getAttribute('placeholder').trim();
    return '';
  };
  const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="checkbox"], [role="switch"], [role="tab"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.tagName === 'CANVAS' || !shown(el)) continue;
    const data = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}="${a.value.slice(0, 24)}"]`).join('');
    const where = el.closest('.subpanel, .inspector, .toolbar, .topbar, .tool-actions, .photo-bar, .bug, .onboard, .title, .next-bar, .follow-pill, .more-grid, .xfeed, .card')?.className.split(' ')[0] ?? '';
    out.push({ what: `${where ? '.' + where + ' ' : ''}${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}${data}`, shows: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 16), name: nameOf(el) });
  }
  return out;
};

const browser = await launch();
const nameless = new Map();   // what -> the states it was seen in
let seen = 0;
for (const who of ['desktop', 'phone']) {
  const phone = who === 'phone';
  const open = async (hash, first) => {
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript((first) => { try { localStorage.setItem('slopmerica.quality', 'low'); if (!first) { localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } } catch { /* */ } }, first);
    await page.goto(`${base}/${hash}`, { waitUntil: 'load', timeout: 120000 });
    return { ctx, page, errs };
  };
  const look = async (page, state) => {
    await page.waitForTimeout(250);
    const list = await page.evaluate(controls);
    seen += list.length;
    const none = list.filter((c) => !c.name);
    for (const c of none) { const k = `${who}: ${c.what}${c.shows ? ` "${c.shows}"` : ''}`; nameless.set(k, [...(nameless.get(k) ?? []), state]); }
    if (LIST) for (const c of list) console.log(`  ${who} ${state}: ${c.what} = ${c.name ? `"${c.name.slice(0, 40)}"` : 'NO NAME'}`);
    console.log(`${who} ${state}: ${list.length} controls, ${none.length} with no name`);
    return list.length;
  };

  // ---- a new player's first screens: the title, the New city screen, then the welcome card over a new game ----
  {
    const { ctx, page, errs } = await open('', true);
    await page.waitForSelector('.title .aaa-nav', { timeout: 180000 });
    await page.waitForTimeout(600);
    const n = await look(page, 'title');
    check(`${who}: the title screen has controls to look at (${n})`, n > 0);
    await (phone ? page.tap('.title #new') : page.click('.title #new'));
    await look(page, 'title: new city');
    check(`${who}: no page errors on the title screen`, errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
  {
    const { ctx, page, errs } = await open('#skip&map=norcal&mode=sandbox', true);
    await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
    const card = await page.waitForSelector('.onboard', { timeout: 30000 }).then(() => true, () => false);
    await look(page, 'welcome');
    check(`${who}: the welcome card is up over a new game`, card);
    check(`${who}: no page errors on the first screen`, errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }

  const { ctx, page, errs } = await open('#skip&map=norcal&mode=ponzi', false);
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const made = await page.evaluate(() => {
    const d = window.__dbg, g = window.__game, S = g.startView();
    let z = null;
    for (const dz of [0, 200, -200, 320, -320]) if (typeof d.road(S.x - 150, S.z + dz, S.x + 150, S.z + dz, 'twoLane') === 'number') { z = S.z + dz; break; }
    if (z === null) return { err: 'no street' };
    d.zone(S.x, z + 40, 60, 'resLow'); d.zone(S.x, z - 40, 50, 'comLow'); d.run(25);
    return { z };
  });
  check(`${who}: a small town to open cards on`, !made.err, made);
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  // (not Esc: with nothing open Esc is the pause menu)
  const rest = async () => { await page.evaluate(() => { const g = window.__game; g.select(null); g.ui.openPanel(null); g.tools.set('inspect'); document.querySelector('.bug')?.remove(); }); await page.waitForTimeout(150); };

  await look(page, 'at rest');
  const ids = await page.evaluate(() => [...document.querySelectorAll('.toolbar button.tbtn')].map((b) => b.dataset.t));
  for (const id of ids) {
    if (id === 'more' || id === 'photo') continue;
    await press(`button.tbtn[data-t="${id}"]`);
    await look(page, id);
    await rest();
  }
  if (ids.includes('more')) {
    await press('button.tbtn[data-t="more"]');
    await look(page, 'more');
    const more = await page.evaluate(() => [...document.querySelectorAll('[data-more]')].map((b) => b.dataset.more));
    await rest();
    for (const id of more) {
      if (id === 'photo') continue;
      await press('button.tbtn[data-t="more"]');
      await page.waitForTimeout(200);
      await press(`[data-more="${id}"]`);
      await look(page, `more: ${id}`);
      await rest();
    }
  }
  // the cards
  for (const kind of ['road', 'building', 'lot', 'car']) {
    const ok = await page.evaluate((kind) => {
      const g = window.__game;
      if (kind === 'road') { const s = [...g.net.segs.values()].at(-1); if (s) g.select({ kind, s }); return !!s; }
      if (kind === 'building') { const b = [...g.buildings.list.values()][0] ?? null; if (b) g.select({ kind, b }); return !!b; }
      if (kind === 'lot') { let cell = null; for (const c of g.zones.cells.values()) if (c.valid && c.zone && !c.bld) { cell = c; break; } if (cell) g.select({ kind, cell }); return !!cell; }
      const c = g.traffic.cars.find((c) => c && !c.dead) ?? null; if (c) g.select({ kind, c }); return !!c;
    }, kind);
    if (!ok) { console.log(`${who} card ${kind}: nothing to select (skipped)`); continue; }
    await page.evaluate(() => window.__game.ui.update(0.3));
    await look(page, `card: ${kind}`);
    await rest();
  }
  // a road being planned: the badge with Build, Undo and Done
  await press('button.tbtn[data-t="roads"]');
  await look(page, 'roads in hand');
  await rest();
  // photo mode, with Adjust open
  await page.evaluate(() => window.__game.photo.enter());
  await page.waitForTimeout(300);
  if (await page.$('.photo-bar [data-pb="adjust"]')) await press('.photo-bar [data-pb="adjust"]');
  await look(page, 'photo mode');
  await page.evaluate(() => window.__game.photo.exit());
  await page.waitForTimeout(200);
  // the bug report
  await page.evaluate(() => window.__game.ui.reportBug());
  await look(page, 'bug report');
  await rest();
  // the pause menu
  await page.evaluate(() => window.__game.ui.openMenu());
  await page.waitForSelector('.pause', { timeout: 15000 });
  await look(page, 'pause menu');
  await page.keyboard.press('Escape');
  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
const list = [...nameless.entries()];
for (const [k, states] of list) console.log(`NO NAME  ${k}   (${[...new Set(states)].slice(0, 4).join(', ')}${new Set(states).size > 4 ? ', ...' : ''})`);
check(`every control has a name (${seen} looked at across the states, ${list.length} different controls with none)`, list.length === 0);
process.exit(bad ? 1 : 0);
