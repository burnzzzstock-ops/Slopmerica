// A scripted play session for the round-8 UI audit (docs/HANDOFF_ROUND8_SONNET.md, item 0): on the phone (390x844, touch) or the desktop,
// start a NEW game on a county through the title screen, build and zone a little town, place a service, open every panel, the demand
// cards, an inspector and Settings, try the tools, save and resume, and look at the town at night, in rain and at 35 / 50 / 75 / 110
// degrees field of view. Every step is screenshotted to shots/r8/audit/<ctx>-<map>/NN-name.png and logged to log.json with page errors,
// controls that spill off the screen, and touch targets under 44 px. A step that throws is logged and the session carries on.
// usage: scripts/withslot.sh env BASE_URL=http://127.0.0.1:5210 node scripts/audit8.mjs <phone|desk> <appalachia|norcal|florida>
//   env: DPR=2 (phone pixel ratio, default 2), QUALITY=low|medium|high|ultra (desktop default high; phone is always the touch default)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ARGS, EXE } from './refblock.mjs';

const [kind = 'phone', map = 'appalachia'] = process.argv.slice(2);
const phone = kind === 'phone';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = `shots/r8/audit/${kind}-${map}${process.env.OUT_SUFFIX ?? ''}`;
mkdirSync(out, { recursive: true });
// the first county (appalachia) gets the whole tour; the others a shorter one (the panels are the same code on every map): LITE=0 forces the whole tour
const LITE = process.env.LITE ? process.env.LITE !== '0' : map !== 'appalachia';
const log = { ctx: kind, map, base, lite: LITE, steps: [], errors: [], small: {}, spills: {} };
let n = 0;
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const ctx = await browser.newContext(phone
  ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: Number(process.env.DPR || 2) }
  : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => log.errors.push('pageerror ' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') log.errors.push('console ' + m.text().slice(0, 200)); });
if (!phone) await page.addInitScript((q) => { try { localStorage.setItem('slopmerica.quality', q); } catch { /* */ } }, process.env.QUALITY || 'high');
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
// a real touch (or click) at the middle of the element, without waiting for Playwright's "stable" check: the software GPU draws a frame every few
// seconds, which makes that check time out on a perfectly good button
const tap = async (sel) => {
  // (a panel redraws a few times a second: a handle taken a moment ago can be detached by the time its box is asked for, so look again)
  let box = null;
  for (let tries = 0; tries < 6 && !box; tries++) {
    const el = await page.waitForSelector(sel, { state: 'attached', timeout: 120000 });
    await el.scrollIntoViewIfNeeded({ timeout: 30000 }).catch(() => {});
    box = await el.boundingBox().catch(() => null);
    if (!box) await sleep(400);
  }
  if (!box) throw new Error('no box for ' + sel);
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  if (phone) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await sleep(150);
};
const sleep = (ms) => page.waitForTimeout(ms);

/** controls spilling off-screen and touch targets under 44 px, for what is on screen now */
const measure = () => page.evaluate((isPhone) => {
  const W = innerWidth, H = innerHeight, spill = [], small = [];
  for (const el of document.querySelectorAll('.hud *, .title *, .boot-fail *, .bug-sheet *')) {
    if (el.closest('[hidden]')) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    let p = el.parentElement, scroll = false;
    while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) { scroll = true; break; } p = p.parentElement; }
    const label = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].slice(0, 2).join('.')} "${(el.textContent || '').trim().slice(0, 24)}"`;
    if (!scroll && (r.right > W + 1 || r.left < -1 || r.bottom > H + 1)) spill.push(`${label} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
    if (isPhone && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT' || el.getAttribute('role') === 'button') && (r.width < 44 || r.height < 44) && !el.closest('.floating')) small.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { spill: [...new Set(spill)].slice(0, 12), small: [...new Set(small)].slice(0, 20), docW: document.documentElement.scrollWidth, W };
}, phone);

const step = async (name, fn, { shot = true } = {}) => {
  const id = String(++n).padStart(2, '0');
  const t0 = Date.now();
  const rec = { id, name, ok: true };
  try {
    const r = await fn();
    if (r !== undefined) rec.result = r;
  } catch (e) { rec.ok = false; rec.error = String(e.message).split('\n')[0].slice(0, 220); }
  try {
    const m = await measure();
    if (m.spill.length) { rec.spill = m.spill; log.spills[name] = m.spill; }
    if (m.small.length) { rec.small = m.small; log.small[name] = m.small; }
    if (m.docW > m.W) rec.docWider = `${m.docW}>${m.W}`;
  } catch { /* the page may be mid-navigation */ }
  if (shot) {
    try { await page.screenshot({ path: `${out}/${id}-${name.replace(/[^a-z0-9]+/gi, '_')}.png`, timeout: 420000 }); rec.shot = `${id}-${name.replace(/[^a-z0-9]+/gi, '_')}.png`; } catch (e) { rec.shotError = String(e.message).split('\n')[0]; }
  }
  rec.secs = Math.round((Date.now() - t0) / 1000);
  log.steps.push(rec);
  console.log(id, name, rec.ok ? 'ok' : 'FAILED ' + rec.error, rec.spill ? 'SPILL ' + rec.spill.length : '', rec.small ? 'small ' + rec.small.length : '', `${rec.secs}s`);
  writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 1));
};
const game = (fn, arg) => page.evaluate(fn, arg);

// ---------------------------------------------------------------------------------------------------------------- the title
await step('title', async () => {
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('.title .aaa-nav', { timeout: 180000 });
  await sleep(1500);
});
await step('title-new-city', async () => { await tap('#new'); await sleep(900); });
await step(`title-pick-${map}`, async () => { await tap(`.aaa-map[data-map="${map}"]`); await sleep(500); return await game(() => document.querySelector('#cityname')?.value); });
await step('title-mode-sandbox', async () => { await tap('.aaa-mode[data-mode="sandbox"]'); await sleep(400); }, { shot: false });
await step('start-paving', async () => {
  await tap('#go');
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 420000 });
  await sleep(2500);
  return await game(() => ({ q: window.__game.q.name, touch: window.__game.isTouch, fov: Math.round(window.__game.camera.fov), pop: window.__game.sim.population }));
});
await step('first-view', async () => { await sleep(1500); });
await step('onboarding-dismiss', async () => {
  const go = await page.$('#ob-go');
  if (go) { await tap('#ob-go'); await sleep(600); return 'tapped ob-go'; }
  return 'no onboarding card';
});

// ---------------------------------------------------------------------------------------------------------------- a town
const S = await game(() => { const g = window.__game, s = g.startView(); return { x: s.x, z: s.z }; });
// ("Let's pave" already opens the Roads panel: tapping the Roads button again would close it, so only tap when it is not open)
await step('roads-panel', async () => { if (!(await page.$('button.card[data-road]'))) { await tap('button.tbtn[data-t="roads"]'); await sleep(700); return 'opened'; } return 'already open after Let\'s pave'; });
await step('draw-road-by-hand', async () => {
  // a real road: pick the first road card, drag across the view, then Build (phone) or click-click (desktop)
  const card = await page.$('button.card[data-road]');
  if (card) { await tap('button.card[data-road]'); await sleep(400); }
  const W = page.viewportSize().width, H = page.viewportSize().height;
  const y = Math.round(H * 0.45), x0 = Math.round(W * 0.25), x1 = Math.round(W * 0.75);
  if (phone) {
    await touch('touchStart', x0, y);
    for (let i = 1; i <= 12; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / 12, y - i * 3); await sleep(35); }
    await touch('touchEnd', 0, 0);
    await sleep(700);
    const pending = await game(() => ({ pending: window.__game.tools.pending, cost: window.__game.tools.pendingCost }));
    await page.screenshot({ path: `${out}/${String(n).padStart(2, '0')}a-planned.png`, timeout: 420000 });
    if (await page.$('#ta-build')) { await tap('#ta-build'); await sleep(700); }
    return pending;
  }
  await page.mouse.click(x0, y); await sleep(300); await page.mouse.move(x1, y - 20, { steps: 8 }); await sleep(400);
  await page.screenshot({ path: `${out}/${String(n).padStart(2, '0')}a-planned.png`, timeout: 420000 });
  await page.mouse.click(x1, y - 20); await sleep(700);
  await page.keyboard.press('Escape');
  return await game(() => window.__game.net.segs.size);
});
await step('finish-tool', async () => {
  const done = await page.$('#ta-done');
  if (done) await tap('#ta-done'); else await page.keyboard.press('Escape');
  await sleep(400);
  return await game(() => ({ tool: window.__game.tools.active, segs: window.__game.net.segs.size }));
}, { shot: false });
await step('build-town-by-hook', async () => {
  return await game(({ x, z }) => {
    const d = window.__dbg, g = window.__game;
    const r = [];
    r.push(d.road(x - 260, z, x + 260, z, 'twoLane'), d.road(x, z - 200, x, z + 200, 'twoLane'), d.road(x - 260, z + 120, x + 260, z + 120, 'twoLane'));
    d.zone(x - 120, z + 50, 55, 'resLow'); d.zone(x + 120, z + 50, 55, 'resLow'); d.zone(x - 40, z - 70, 50, 'comLow'); d.zone(x + 140, z - 70, 45, 'industry'); d.zone(x - 140, z + 175, 45, 'resHigh');
    return { r, segs: g.net.segs.size };
  }, S);
});
await step('place-service', async () => {
  // a fire station next to the road: pick it in the Services panel, tap the map (the phone plans it, Build buys it; a click places it on the desktop)
  await game(({ x, z }) => window.__dbg.view(x, z, 380, 0.6, 0.5), S);
  await sleep(600);
  await tap('button.tbtn[data-t="ext:services"]');
  await sleep(500);
  await tap('[data-cat="fire"]');
  await sleep(400);
  await page.screenshot({ path: `${out}/${String(n).padStart(2, '0')}a-service-cards.png`, timeout: 420000 });
  await tap('[data-svc="fireStation"]');
  await sleep(500);
  const W = page.viewportSize().width, H = page.viewportSize().height;
  const before = await game(() => [...window.__game.buildings.list.values()].filter((b) => b.zone === 'service').length);
  if (phone) await page.touchscreen.tap(Math.round(W * 0.5), Math.round(H * 0.4)); else await page.mouse.click(Math.round(W * 0.5), Math.round(H * 0.4));
  await sleep(900);
  await page.screenshot({ path: `${out}/${String(n).padStart(2, '0')}b-service-planned.png`, timeout: 420000 });
  if (phone && (await page.$('#ta-build'))) { await tap('#ta-build').catch(() => {}); await sleep(900); }
  const after = await game(() => ({ n: [...window.__game.buildings.list.values()].filter((b) => b.zone === 'service').length, tool: window.__game.tools.active, money: Math.round(window.__game.sim.money) }));
  await tap('button.tbtn[data-t="inspect"]').catch(() => {});
  return { before, ...after };
});
await step('run-5-days', async () => { return await game(() => window.__dbg.run(5)); });
await step('town-view', async () => { await game(({ x, z }) => window.__dbg.view(x, z, 380, 0.5, 0.75), S); await sleep(800); });

// ---------------------------------------------------------------------------------------------------------------- every panel
const ids = await game(() => [...document.querySelectorAll('.toolbar button.tbtn')].map((b) => b.dataset.t));
log.toolbar = ids;
await page.keyboard.press('Escape').catch(() => {});
for (const id of ids.filter((i) => i !== 'more' && (!LITE || ['inspect', 'roads', 'zones', 'ext:services', 'views'].includes(i)))) {
  await step(`panel-${id}`, async () => { await tap(`button.tbtn[data-t="${id}"]`); await sleep(900); }).catch(() => {});
  if (id === 'bug') await page.keyboard.press('Escape');
  else await tap(`button.tbtn[data-t="${id}"]`).catch(() => {});
  await sleep(300);
}
if (ids.includes('more') && !LITE) {
  await tap('button.tbtn[data-t="more"]').catch(() => {}); await sleep(600);
  const items = await game(() => [...document.querySelectorAll('.more-menu [data-t], .more-grid [data-t], .moresheet [data-t]')].map((b) => b.dataset.t));
  log.more = items;
  await step('more-menu', async () => items, {});
  for (const id of items) {
    await step(`more-${id}`, async () => {
      if (!(await page.$(`[data-t="${id}"]`))) { await tap('button.tbtn[data-t="more"]'); await sleep(500); }
      await tap(`[data-t="${id}"]`); await sleep(900);
    }).catch(() => {});
    if (id === 'bug') await page.keyboard.press('Escape');
    await page.keyboard.press('Escape').catch(() => {});
    await game(() => window.__game.tools.cancel?.());
    await sleep(300);
  }
}

// ---------------------------------------------------------------------------------------------------------------- demand, inspector, Settings
await step('demand-bar', async () => {
  await tap('button.tbtn[data-t="inspect"]').catch(() => {});   // (puts any open panel away)
  await sleep(300);
  const bar = await page.$('.tb-demand .dbar');
  if (bar) { await tap('.tb-demand .dbar'); await sleep(900); return 'tapped the first demand bar'; }
  return 'no demand bar found';
});
await page.keyboard.press('Escape').catch(() => {});
await step('inspect-building', async () => {
  return await game(() => {
    const g = window.__game, b = [...g.buildings.list.values()].find((x) => x.state === 'active') ?? [...g.buildings.list.values()][0];
    if (!b) return 'no building yet';
    g.select({ kind: 'building', b });
    g.rts.setView(b.x, b.z, 90);
    for (let i = 0; i < 4; i++) g.frame(0.3);
    return b.label ?? b.zone;
  });
});
await game(() => window.__game.select?.(null));
// Settings is a toolbar button on the desktop and an item under More on the phone
const openSettings = async () => {
  if (await page.isVisible('#fov-range')) return;
  if (phone) {
    if (!(await page.$('button.more-btn[data-more="help"]'))) { await tap('button.tbtn[data-t="more"]'); await sleep(500); }
    await tap('button.more-btn[data-more="help"]');
  } else await tap('button.tbtn[data-t="help"]');
  await sleep(900);
};
const closeSettings = async () => { await tap('button.tbtn[data-t="inspect"]').catch(() => {}); await sleep(400); };
await step('settings', openSettings);
for (const fov of LITE ? [110] : [35, 50, 75, 110]) {
  await step(`settings-fov-${fov}`, async () => {
    await page.evaluate((v) => { const r = document.querySelector('#fov-range'); if (r) { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); } }, fov);
    await sleep(900);
    return await game(() => ({ fov: Math.round(window.__game.camera.fov), label: document.querySelector('#fov-v')?.textContent }));
  });
  await step(`world-fov-${fov}`, async () => {
    await closeSettings();
    await game(({ x, z }) => window.__dbg.view(x, z, 160, 0.6, 0.6), S); await sleep(900);
  });
  await openSettings();
}
await page.evaluate(() => { const r = document.querySelector('#fov-range'); if (r) { r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true })); } });
await step('settings-music-toggle', async () => { await tap('#music-toggle'); await sleep(500); });
await step('settings-audio-controls', async () => game(() => [...document.querySelectorAll('.subpanel button, .subpanel label, .subpanel input')].map((e) => (e.textContent || e.id || e.type).trim().slice(0, 40))), { shot: false });
await closeSettings();

// ---------------------------------------------------------------------------------------------------------------- night, rain, high view
await step('night-street', async () => {
  await game(({ x, z }) => { const g = window.__game; g.weather.force('clear', 30); g.weather.settle(); window.__dbg.hour(22); window.__dbg.view(x, z, 90, 0.4, 0.45); for (let i = 0; i < 6; i++) g.frame(0.016); }, S);
  await sleep(600);
});
await step('rain-street', async () => {
  await game(({ x, z }) => { const g = window.__game; g.weather.force('rain', 30); g.weather.settle(); window.__dbg.hour(15); window.__dbg.view(x, z, 90, 0.4, 0.45); for (let i = 0; i < 6; i++) g.frame(0.016); }, S);
  await sleep(600);
});
await step('rain-night-overview', async () => {
  await game(({ x, z }) => { window.__dbg.hour(22.5); window.__dbg.view(x, z, 320, 0.7, 0.6); for (let i = 0; i < 6; i++) window.__game.frame(0.016); }, S);
  await sleep(600);
});
await game(() => { const g = window.__game; g.weather.force('clear', 30); g.weather.settle(); window.__dbg.hour(12); });

// ---------------------------------------------------------------------------------------------------------------- save and resume
await step('save-now', async () => { await openSettings(); await tap('#save-now'); await sleep(700); });
await step('bug-sheet-save-city', async () => {
  await page.keyboard.press('Escape');
  if (phone) { await tap('button.tbtn[data-t="more"]'); await sleep(500); await tap('button.more-btn[data-more="bug"]'); } else await tap('button.tbtn[data-t="bug"]');
  await sleep(900);
  const b = await page.$('#bug-city');
  if (b) { await b.scrollIntoViewIfNeeded().catch(() => {}); await tap('#bug-city'); await sleep(900); }
  return await game(() => document.querySelector('.bug-say, .bug-msg, [role="status"]')?.textContent ?? '(no message)');
});
await page.keyboard.press('Escape').catch(() => {});
await step('reload-resume', async () => {
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('.title .aaa-nav', { timeout: 180000 });
  await sleep(1200);
  return await game(() => document.querySelector('#continue')?.textContent?.replace(/\s+/g, ' ') ?? 'no resume button');
});
await step('resume-trip', async () => {
  await tap('#continue');
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 420000 });
  await sleep(2000);
  return await game(() => ({ pop: window.__game.sim.population, segs: window.__game.net.segs.size, bld: window.__game.buildings.list.size, day: Math.floor(window.__game.sim.day) }));
});
writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 1));
console.log('errors:', [...new Set(log.errors)].slice(0, 6));
await browser.close();
