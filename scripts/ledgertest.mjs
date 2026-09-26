// The recording's late-game money sequence, replayed: a Golden Coast town
// of ~100 people places six services inside one week, then runs two more.
// Every half day it samples cash, the HUD's weekly figure and the ledger.
//
// Checks (exit nonzero on failure):
//  - the HUD's "/wk" is the recurring forecast and never includes one-time
//    construction (the recording showed -$41,659/wk right after a spree);
//  - every closed week reconciles: cash change = sum of that week's lines;
//  - every transaction is labelled and the log adds up to the cash change;
//  - service placement previews state the cash after and the weekly change.
// `--trace` prints the full sample table.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const trace = process.argv.includes('--trace');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });

const out = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, SV = window.__services, s = g.sim;
  cancelAnimationFrame(g.raf);
  const S = g.startView();
  d.road(S.x - 160, S.z + 40, S.x + 160, S.z + 40, 'twoLane');
  d.road(S.x - 160, S.z - 60, S.x + 160, S.z - 60, 'twoLane');
  d.road(S.x - 160, S.z + 40, S.x - 160, S.z - 60, 'twoLane');
  d.zone(S.x - 60, S.z + 75, 70, 'resLow');
  d.zone(S.x + 60, S.z + 75, 60, 'resLow');
  d.zone(S.x - 40, S.z - 10, 40, 'comLow');
  d.zone(S.x + 80, S.z - 95, 50, 'industry');
  // grow to roughly the recording's starting size, then line up on a week start
  for (let i = 0; i < 60 && s.population < 95; i++) d.run(1);
  while (Math.floor(s.day) % 7 !== 1) d.run(0.25);
  // cash at every weekly close, straight from the close itself
  const closes = [];
  s.events.on('week', (L) => closes.push({ day: Math.floor(s.day), cash: Math.round(s.money), sum: Math.round(Object.values(L).reduce((a, b) => a + b, 0)), lastWeek: Object.fromEntries(Object.entries(L).filter(([, v]) => Math.round(v)).map(([k, v]) => [k, Math.round(v)])) }));
  const hudNet = () => document.getElementById('tb-net')?.textContent ?? '';
  const sample = (label) => ({
    label, day: +s.day.toFixed(2), pop: s.population, cash: Math.round(s.money),
    hud: (window.__game.ui?.refreshNow?.(), hudNet()),
    weeklyNet: Math.round(s.weeklyNet()),
    forecast: s.forecastWeek ? Math.round(s.forecastWeek().net) : null,
    construction: Math.round(s.ledger.construction ?? 0),
  });
  const rows = [sample('start')];
  const tryPlace = (id, water) => {
    for (let r = 60; r < 900; r += 30) for (let a = 0; a < 24; a++) {
      const x = S.x + Math.cos(a * 0.26) * r, z = S.z + Math.sin(a * 0.26) * r;
      if (water && !g.terrain.nearWater?.(x, z, 40)) { /* try anyway: canPlace checks shore */ }
      const c = SV.canPlace(g, id, x, z);
      if (c.ok) { const b = SV.place(g, id, x, z); if (b) return id; }
    }
    return null;
  };
  // the recording's spree: a well, the sheriff, fire, garbage, a clinic, a school
  const placed = [];
  for (const id of ['wellTower', 'sheriff', 'fireStation', 'landfill', 'clinic', 'school']) {
    const before = Math.round(s.money);
    const got = tryPlace(id, false);
    placed.push({ id, ok: !!got, cost: before - Math.round(s.money) });
    d.run(0.5);
    rows.push(sample(`after ${id}`));
  }
  // three more weekly closes
  const target = closes.length + 3;
  while (closes.length < target) { d.run(0.5); rows.push(sample('')); }
  const weeks = [];
  for (let i = 1; i < closes.length; i++) weeks.push({ day: closes[i].day, from: closes[i - 1].cash, to: closes[i].cash, change: closes[i].cash - closes[i - 1].cash, ledgerSum: closes[i].sum, lastWeek: closes[i].lastWeek });
  const tx = s.transactions ? s.transactions.slice(-40) : null;
  return { rows, placed, weeks, tx, unlabelled: tx ? tx.filter((t) => !t.label).length : null };
});
if (trace) {
  console.log('day    pop   cash       HUD            weeklyNet  forecast  constr  label');
  for (const r of out.rows) console.log(`${String(r.day).padEnd(6)} ${String(r.pop).padEnd(5)} ${String(r.cash).padEnd(10)} ${r.hud.padEnd(14)} ${String(r.weeklyNet).padEnd(10)} ${String(r.forecast).padEnd(9)} ${String(r.construction).padEnd(7)} ${r.label}`);
  console.log(JSON.stringify(out.placed));
  for (const w of out.weeks) console.log(JSON.stringify(w));
}
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const spree = out.placed.filter((p) => p.ok);
check(`the spree placed services (${spree.map((p) => `${p.id} $${p.cost}`).join(', ')})`, spree.length >= 4, out.placed);
const parse = (t) => { const m = t.replace(/[,\s]/g, '').match(/([+−-])?\$?(\d+)\/wk/); return m ? (m[1] === '−' || m[1] === '-' ? -1 : 1) * Number(m[2]) : NaN; };
const hudVsForecast = out.rows.filter((r) => r.forecast !== null && Math.abs(parse(r.hud) - r.forecast) > 1);
check('HUD /wk shows the recurring forecast at every sample', out.rows[0].forecast !== null && hudVsForecast.length === 0, hudVsForecast.slice(0, 3));
const swing = Math.max(...out.rows.map((r) => Math.abs(parse(r.hud) - parse(out.rows[0].hud))));
const spent = spree.reduce((a, p) => a + p.cost, 0);
check(`HUD /wk never absorbs the $${spent} of construction (largest swing $${swing})`, swing < spent * 0.25, { swing, spent });
for (const [i, w] of out.weeks.entries()) check(`week ${i + 1} reconciles: cash ${w.from} → ${w.to} (${w.change}) = ledger ${w.ledgerSum}`, Math.abs(w.change - w.ledgerSum) <= 2, w);
check('every transaction is labelled', out.unlabelled === 0, out.unlabelled);

// ---- the player's view of the same numbers
await page.evaluate(() => { window.__game.start(); window.__game.ui.refreshNow(); });
await page.click('#tb-treasury');
await page.waitForTimeout(200);
const budget = await page.evaluate(() => {
  const g = window.__game, s = g.sim, sub = document.querySelector('.subpanel');
  g.ui.refreshNow();
  const txt = sub.textContent;
  const total = [...sub.querySelectorAll('tr.total td b')].map((b) => b.textContent)[0] ?? '';
  return { open: !sub.hidden && /Budget/.test(sub.querySelector('.sp-title')?.textContent ?? ''), every: /Every week, at today's rates/.test(txt), total, forecast: s.forecastWeek().net, rules: /spend down to −\$20,000/.test(txt) && /bankrupt/.test(txt), thisWeek: /This week so far/.test(txt), log: /Recent transactions/.test(txt) };
});
const num = (t) => { const m = (t || '').replace(/[,\s]/g, '').match(/([+−-])?\$(\d+)/); return m ? (m[1] === '−' || m[1] === '-' ? -1 : 1) * Number(m[2]) : NaN; };
check('clicking the treasury opens the budget', budget.open, budget);
if (process.env.SHOTS) { await page.evaluate(() => { const d = document.querySelectorAll('.bg-more'); d.forEach((x) => { x.open = true; }); }); await page.screenshot({ path: `${process.env.SHOTS}/budget.png` }); }
check(`budget's weekly balance (${budget.total}) is the HUD forecast (${budget.forecast})`, Math.abs(num(budget.total) - budget.forecast) <= 1, budget);
check('budget states the credit line and the bankruptcy rule', budget.rules, budget);
check("budget separates this week's one-time money and keeps a transaction log", budget.thisWeek && budget.log, budget);

// placement preview: the tip projects cash and the weekly rate before the click
await page.click('button.tbtn[data-t="ext:services"]');
await page.waitForTimeout(200);
await page.click('[data-cat="police"]');
await page.click('[data-svc="sheriff"]');
// aim at a spot where a sheriff's office fits, as a player would
const aim = await page.evaluate(() => {
  const g = window.__game, SV = window.__services, S = g.startView();
  for (let r = 60; r < 900; r += 30) for (let a = 0; a < 24; a++) {
    const x = S.x + Math.cos(a * 0.26) * r, z = S.z + Math.sin(a * 0.26) * r;
    if (!SV.canPlace(g, 'sheriff', x, z).ok) continue;
    g.rts.setView(x, z, 320, undefined, undefined, true);
    g.frame(0.016);
    const v = { x, y: g.terrain.h(x, z), z };
    const p = new (g.camera.position.constructor)(v.x, v.y, v.z).project(g.camera);
    const r2 = g.renderer.domElement.getBoundingClientRect();
    return { x: r2.left + ((p.x + 1) / 2) * r2.width, y: r2.top + ((1 - p.y) / 2) * r2.height };
  }
  return null;
});
if (aim) { await page.mouse.move(aim.x - 20, aim.y); await page.mouse.move(aim.x, aim.y); }
await page.waitForFunction(() => /\S/.test(window.__game.tools.tip?.text ?? ''), null, { timeout: 15000 }).catch(() => {});
const tip = await page.evaluate(() => window.__game.tools.tip?.text ?? '');
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/svc-preview.png` });
check(`service preview projects the budget ("${tip.slice(0, 120)}")`, /cash after/.test(tip) && /\/wk/.test(tip), tip);
await page.keyboard.press('Escape');

// in the red: a card says why and what to do, without blocking
const crisis = await page.evaluate(() => {
  const g = window.__game, s = g.sim;
  s.spend(s.money + 7040, 'Test: Sheriff’s Office', 'construction');
  g.ui.refreshNow();
  const c = document.querySelector('.crisis');
  return { shown: !!c && !c.hidden, text: c?.textContent ?? '', blocks: c ? getComputedStyle(c).position : '' };
});
if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/crisis.png` }); }
check('going into debt shows the in-the-red card with causes and actions', crisis.shown && /In the red/.test(crisis.text) && /Recent spending: .*Sheriff/.test(crisis.text) && /Budget/.test(crisis.text) && /Credit left/.test(crisis.text), crisis.text.slice(0, 300));
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
