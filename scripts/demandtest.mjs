// Demand explainer: every bar opens a card whose numbers add up to the bar,
// negative demand draws below zero, locked zones say when they unlock, the
// action button starts zoning the right thing, and the card closes on Esc
// or a tap on the map. Runs desktop and phone. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.env.SHOTS || '';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

for (const phone of [false, true]) {
  const tag = phone ? 'phone' : 'desk';
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const sums = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg;
    const S = g.startView();
    d.road(S.x - 120, S.z + 40, S.x + 120, S.z + 40, 'twoLane');
    d.zone(S.x - 40, S.z + 70, 50, 'resLow');
    d.run(12);
    g.sim.speed = 0;
    const s = g.sim, out = {};
    for (const k of ['res', 'com', 'ind', 'off']) {
      const parts = s.demandParts[k];
      out[k] = { raw: s.demandRaw[k], sum: parts.reduce((a, p) => a + (p.v ?? 0), 0), unmeasured: parts.filter((p) => p.v === null).length, hist: s.demandHistory[k].length };
    }
    return out;
  });
  for (const [k, v] of Object.entries(sums)) check(`${tag}: ${k} reasons add up to the bar (raw ${v.raw.toFixed(1)}, sum ${v.sum.toFixed(1)})`, v.unmeasured > 0 || Math.abs(v.raw - v.sum) < 0.01, v);
  check(`${tag}: a week of trend is kept`, sums.res.hist >= 8, sums.res);
  // the HUD refreshes every quarter second of game frames (slow under SwiftShader)
  await page.waitForFunction(() => {
    const s = window.__game.sim;
    return ['res', 'com', 'ind', 'off'].every((k) => Math.abs(parseFloat(document.getElementById(`d-${k}`).style.height) - Math.max(2, Math.min(100, Math.abs(s.demand[k])))) < 0.5);
  }, null, { timeout: 20000 }).catch(() => {});

  // bars: height is |demand|, negative ones hang from the top
  const bars = await page.evaluate(() => {
    const s = window.__game.sim;
    return ['res', 'com', 'ind', 'off'].map((k) => {
      const b = document.querySelector(`[data-dem="${k}"]`), f = document.getElementById(`d-${k}`);
      return { k, v: s.demand[k], neg: b.classList.contains('neg'), h: parseFloat(f.style.height), label: b.getAttribute('aria-label') };
    });
  });
  for (const b of bars) check(`${tag}: ${b.k} bar draws ${Math.round(b.v)} (${b.neg ? 'below' : 'above'} zero, ${b.h}%)`, b.neg === (b.v < 0) && Math.abs(b.h - Math.max(2, Math.min(100, Math.abs(b.v)))) < 0.5 && /demand/.test(b.label), b);

  // open residential
  await page.click('[data-dem="res"]');
  await page.waitForTimeout(150);
  const card = await page.evaluate(() => {
    const p = document.querySelector('.demand-pop'), r = p.getBoundingClientRect();
    const s = window.__game.sim;
    return { hidden: p.hidden, val: p.querySelector('.dp-val')?.textContent, want: Math.round(s.demand.res), rows: p.querySelectorAll('li').length, go: p.querySelector('.dp-go')?.textContent ?? null, status: p.querySelector('.dp-status')?.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, expanded: document.querySelector('[data-dem="res"]').getAttribute('aria-expanded') };
  });
  const sgn = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  check(`${tag}: tapping R opens the card`, !card.hidden && card.expanded === 'true', card);
  check(`${tag}: card shows the signed value (${card.val})`, card.val === sgn(card.want), card);
  check(`${tag}: card lists reasons (${card.rows})`, card.rows >= 1, card);
  check(`${tag}: card says what the value means`, !!card.status && card.status.length > 10, card);
  check(`${tag}: card fits on screen`, card.left >= 15 && card.right <= card.vw - 15 && card.bottom <= card.vh, card);
  if (shots) await page.screenshot({ path: `${shots}/demand-${tag}-res.png` });

  // office is locked at the start of a Ponzi city
  await page.click('.dp-tab[data-k="off"]');
  await page.waitForTimeout(100);
  const off = await page.evaluate(() => ({ status: document.querySelector('.dp-status')?.textContent, name: document.querySelector('.dp-name')?.textContent, on: document.querySelector('[data-dem="off"]').classList.contains('on') }));
  check(`${tag}: office tab explains its lock ("${off.status}")`, off.name === 'Office' && /unlock at 700/.test(off.status ?? '') && off.on, off);

  // a positive bar's action starts zoning it
  const target = await page.evaluate(() => {
    const s = window.__game.sim;
    return ['res', 'com', 'ind'].find((k) => s.demand[k] >= 5) ?? null;
  });
  if (target) {
    await page.click(`.dp-tab[data-k="${target}"]`);
    await page.waitForTimeout(100);
    const label = await page.$eval('.dp-go', (b) => b.textContent).catch(() => null);
    await page.click('.dp-go');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ tool: window.__game.tools.active, zone: window.__game.tools.zoneType, hidden: document.querySelector('.demand-pop').hidden, panel: !document.querySelector('.subpanel').hidden && document.querySelector('.subpanel .sp-title')?.textContent }));
    const want = { res: /^res/, com: /^com/, ind: /^industry$/ }[target];
    check(`${tag}: "${label}" starts zoning ${target} (${after.zone})`, after.tool === 'zone' && want.test(after.zone) && after.hidden && /Zoning/.test(after.panel || ''), after);
    await page.evaluate(() => { window.__game.tools.set('inspect'); });
    await page.keyboard.press('Escape');
  } else check(`${tag}: some demand is positive after 12 days`, false);

  // Esc and map taps close it
  await page.click('[data-dem="com"]');
  await page.waitForTimeout(100);
  if (!phone) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const esc = await page.evaluate(() => ({ hidden: document.querySelector('.demand-pop').hidden, focus: document.activeElement?.dataset?.dem }));
    check(`${tag}: Esc closes the card and returns focus to the bar`, esc.hidden && esc.focus === 'com', esc);
    await page.click('[data-dem="com"]');
    await page.waitForTimeout(100);
  }
  const vp = page.viewportSize();
  if (phone) await page.touchscreen.tap(vp.width / 2, vp.height * 0.6); else await page.mouse.click(vp.width / 2, vp.height * 0.6);
  await page.waitForTimeout(150);
  check(`${tag}: a tap on the map closes the card`, await page.evaluate(() => document.querySelector('.demand-pop').hidden));
  // live refresh while open doesn't throw
  await page.click('[data-dem="ind"]');
  await page.evaluate(() => { window.__game.sim.speed = 3; });
  await page.waitForTimeout(1500);
  if (shots) await page.screenshot({ path: `${shots}/demand-${tag}-ind.png` });
  check(`${tag}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
