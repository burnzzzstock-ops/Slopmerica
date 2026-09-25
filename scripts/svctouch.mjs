// Phone: services and bus depot are planned by a tap and only bought on Build.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`http://127.0.0.1:${process.env.PORT || '5173'}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
const cdp = await ctx.newCDPSession(page);
const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(500); };
const state = () => page.evaluate(() => {
  const g = window.__game, t = g.tools, bar = document.querySelector('.tool-actions'), b = document.querySelector('#ta-build');
  return { tool: t.active, ext: t.extTool, svc: [...g.buildings.list.values()].filter((x) => x.zone === 'service').length, bar: !bar.hidden, tip: document.querySelector('#ta-tip').textContent, build: b.hidden ? 'hidden' : `${b.textContent}${b.disabled ? ' (disabled)' : ''}`, undo: !document.querySelector('#ta-undo').hidden };
});
// a road to sit the building next to, centered on screen
await page.evaluate(() => { const g = window.__game, d = window.__dbg; const S = g.startView(); d.road(S.x - 200, S.z + 60, S.x + 200, S.z + 60, 'twoLane'); d.view(S.x, S.z + 60, 420); });
await page.tap('button.tbtn[data-t="ext:services"]');
await page.waitForTimeout(400);
await page.tap('[data-cat="fire"]');
await page.waitForTimeout(300);
await page.tap('[data-svc="fireStation"]');
await page.waitForTimeout(400);
console.log('picked fire station', JSON.stringify(await state()));
await tap(195, 380);
await page.waitForFunction(() => !document.querySelector('#ta-build').hidden, null, { timeout: 30000 }).catch(() => {});
const planned = await state();
console.log('after one tap (planned, not bought)', JSON.stringify(planned), planned.svc === 0 && planned.build.startsWith('🔨 Build $') ? 'OK' : 'FAIL');
if (planned.build.startsWith('🔨 Build $') && !planned.build.includes('disabled')) {
  await page.tap('#ta-build');
  await page.waitForFunction(() => [...window.__game.buildings.list.values()].some((x) => x.zone === 'service') && document.querySelector('#ta-build').hidden, null, { timeout: 30000 }).catch(() => {});
}
const built = await state();
console.log('after Build', JSON.stringify(built), built.svc === 1 && built.build === 'hidden' ? 'OK' : 'FAIL');
await page.tap('#ta-done');
await page.waitForFunction(() => document.querySelector('.tool-actions').hidden, null, { timeout: 30000 }).catch(() => {});
const done = await state();
console.log('after Done', JSON.stringify(done), done.tool === 'inspect' && !done.bar ? 'OK' : 'FAIL');
await tap(195, 380);
await page.waitForTimeout(1500);
const after = await state();
console.log('tap after Done', JSON.stringify(after), after.svc === 1 && !after.bar ? 'OK' : 'FAIL');
// landmarks: a tap plans (under the finger), Build buys
const lmCount = () => page.evaluate(() => [...window.__game.buildings.list.values()].filter((b) => b.zone === 'landmark' || b.kind?.startsWith?.('landmark') || b.landmark).length);
console.log('rects', JSON.stringify(await page.evaluate(() => { const r = (q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; }; return { insp: r('.inspector'), bar: r('.toolbar'), more: r('button.tbtn[data-t="more"]'), scrollY: window.scrollY, docH: document.documentElement.scrollHeight }; })));
await page.evaluate(() => window.__game.ui.select(null));
await page.waitForTimeout(300);
await page.tap('button.tbtn[data-t="more"]');
await page.waitForTimeout(300);
await page.tap('[data-more="landmarks"]');
await page.waitForTimeout(300);
await page.tap('[data-lm="waterTower"]');
await page.waitForFunction(() => window.__game.tools.active === 'landmark' && !document.querySelector('.tool-actions').hidden, null, { timeout: 30000 }).catch(() => {});
const lm0 = await state(), n0 = await lmCount(), money0 = await page.evaluate(() => window.__game.sim.money);
console.log('landmark picked', JSON.stringify({ tip: lm0.tip, build: lm0.build, bar: lm0.bar }), lm0.bar && lm0.build === 'hidden' ? 'OK' : 'FAIL');
await tap(120, 560);
await page.waitForFunction(() => !document.querySelector('#ta-build').hidden, null, { timeout: 30000 }).catch(() => {});
const lm1 = await state();
console.log('landmark after tap', JSON.stringify({ tip: lm1.tip, build: lm1.build, placed: (await lmCount()) - n0 }), (await lmCount()) === n0 && lm1.build !== 'hidden' ? 'OK (planned, not bought)' : 'FAIL');
if (lm1.build.startsWith('🔨 Build $') && !lm1.build.includes('disabled')) {
  await page.tap('#ta-build');
  await page.waitForFunction(() => window.__game.tools.active === 'inspect', null, { timeout: 30000 }).catch(() => {});
  console.log('landmark after Build', JSON.stringify({ tool: await page.evaluate(() => window.__game.tools.active), spent: await page.evaluate((m) => Math.round(m - window.__game.sim.money), money0) }));
}
// bulldoze gets the bar with a hint and Done
await page.tap('button.tbtn[data-t="bulldoze"]');
await page.waitForFunction(() => !document.querySelector('.tool-actions').hidden, null, { timeout: 30000 }).catch(() => {});
const bz = await state();
console.log('bulldoze bar', JSON.stringify({ bar: bz.bar, tip: bz.tip, undo: bz.undo }), bz.bar && bz.tip ? 'OK' : 'FAIL');
await page.tap('#ta-done');
await page.waitForFunction(() => document.querySelector('.tool-actions').hidden, null, { timeout: 30000 }).catch(() => {});
console.log('bulldoze Done ->', await page.evaluate(() => window.__game.tools.active));
console.log(errs.slice(0, 5).join('\n'));
await browser.close();
