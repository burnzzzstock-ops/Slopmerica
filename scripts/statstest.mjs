// The Statistics drawer (src/ui/statsPanel.ts, loaded when first opened). On a phone and on the desktop, in a
// county grown for 70 days: Statistics under More opens five charts (population, the treasury, the weekly balance,
// nature and sprawl, moved in and left); each is drawn from data (a line of a point for every two days, a pair of bars
// for every closed week, or a bar for a day somebody moved), headed by today's figure, which is the simulation's own;
// the weekly balance is the simulation's rows (game.sim.weeks), and a pointer across it reads off that week's income,
// costs, balance and one-time money; a pointer across the population chart reads off
// the day under it, and that reading is the simulation's row for that day; ten days on, the charts have moved on;
// nothing spills off the screen and no text in it is under 12 px. Exits nonzero on failure. `--shots` saves
// pictures to shots/stats.
import { mkdirSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots');
if (shots) mkdirSync('shots/stats', { recursive: true });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 320)); if (!ok) bad++; };
const browser = await launch();
for (const kind of ['phone', 'desk']) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  // a street with homes, shops and a works, and seventy days of it
  await page.evaluate(() => { const g = window.__game, d = window.__dbg, S = g.startView(); cancelAnimationFrame(g.raf); d.road(S.x - 150, S.z, S.x + 150, S.z, 'twoLane'); d.zone(S.x, S.z + 40, 60, 'resLow'); d.zone(S.x - 60, S.z - 40, 40, 'comLow'); d.zone(S.x + 80, S.z - 40, 40, 'industry'); d.run(70); g.frame(0.05, false); g.ui.update(0.3); document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  await press('.tbtn[data-t="more"]');
  await press('.subpanel [data-more="stats"]');
  await page.waitForSelector('.stats .st-chart', { timeout: 30000 });
  const read = () => page.evaluate(() => {
    const g = window.__game, s = g.sim, W = innerWidth;
    const charts = [...document.querySelectorAll('.stats .st-chart')].map((f) => {
      const paths = [...f.querySelectorAll('.st-plot path[stroke]')].filter((p) => p.getAttribute('stroke') !== 'none' && p.getAttribute('stroke') !== 'var(--line)');
      const bars = [...f.querySelectorAll('.st-plot rect')].filter((r) => Number(r.getAttribute('height')) > 0);
      const r = f.getBoundingClientRect(), plot = f.querySelector('.st-plot')?.getBoundingClientRect();
      return { id: f.dataset.chart, title: f.querySelector('.st-head b')?.textContent, now: f.querySelector('.st-now')?.textContent ?? '', points: Math.max(0, ...paths.map((p) => (p.getAttribute('d').match(/[ML]/g) ?? []).length)), lines: paths.length, bars: bars.length, from: f.querySelector('.st-foot span')?.textContent, to: f.querySelector('.st-foot span:last-child')?.textContent, label: f.getAttribute('aria-label'), inside: r.left >= 0 && r.right <= W + 0.5, plotH: plot ? Math.round(plot.height) : 0 };
    });
    let small = [];
    const walk = document.createTreeWalker(document.querySelector('.subpanel'), NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { const el = n.parentElement; if (!n.textContent.trim() || el.closest('svg') || el.offsetParent === null) continue; const px = parseFloat(getComputedStyle(el).fontSize); if (px < 12) small.push(`${px} ${n.textContent.trim().slice(0, 20)}`); }
    return { charts, small, rows: s.history.length, pop: s.population.toLocaleString(), money: Math.round(s.money), day: Math.floor(s.day), lastRow: s.history[s.history.length - 1], docW: document.documentElement.scrollWidth, W, weeks: s.weeks.map((w) => ({ ...w })) };
  });
  let s = await read();
  const by = (id) => s.charts.find((c) => c.id === id);
  check(`${kind}: Statistics under More opens five charts (${s.charts.map((c) => c.title).join(', ')})`, s.charts.map((c) => c.id).join(' ') === 'pop money weeks land flow', s.charts.map((c) => c.id));
  // the weekly balance: a bar up for a week's income and a bar down for its costs, from the simulation's rows
  const usd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`, signed = (v) => `${v < 0 ? '−' : '+'}${usd(Math.abs(v))}`;
  const wk = s.weeks, lastWk = wk[wk.length - 1], wantBars = wk.filter((w) => w.income > 0).length + wk.filter((w) => w.expense > 0).length;
  check(`${kind}: the weekly balance has a bar up and a bar down for each of the ${wk.length} closed weeks (${by('weeks')?.bars} bars) and is headed by the last one's balance ("${by('weeks')?.now}")`, wk.length >= 9 && by('weeks')?.bars === wantBars && wantBars >= wk.length && by('weeks')?.now === `${signed(lastWk.net)} last week`, { bars: by('weeks')?.bars, wantBars, now: by('weeks')?.now, lastWk });
  check(`${kind}: each line chart has a point for every row the simulation keeps (${s.rows} rows: population ${by('pop')?.points}, treasury ${by('money')?.points}, nature and sprawl ${by('land')?.points} on ${by('land')?.lines} lines)`, s.rows >= 30 && by('pop')?.points === s.rows && by('money')?.points === s.rows && by('land')?.points === s.rows && by('land')?.lines === 2, s.charts);
  check(`${kind}: moved in and left has a bar for a day somebody moved (${by('flow')?.bars} bars) and says how many ("${by('flow')?.now}")`, (by('flow')?.bars ?? 0) > 0 && /^\+[\d,]+ · −[\d,]+$/.test(by('flow')?.now ?? ''), by('flow'));
  check(`${kind}: the population chart is headed by today's population (${by('pop')?.now}, the simulation's ${s.pop}) and the treasury's last point is its last row ($${s.lastRow.money.toLocaleString()})`, by('pop')?.now === s.lastRow.pop.toLocaleString() && (by('money')?.now ?? '').replace(/[^\d]/g, '') === String(Math.abs(Math.round(s.lastRow.money))), { pop: by('pop')?.now, money: by('money')?.now, lastRow: s.lastRow });
  const today = await page.evaluate(() => window.__game.sim.dateOf(Math.floor(window.__game.sim.day), false));
  check(`${kind}: moved in and left runs to today (${by('flow')?.to}), a column for every day whether or not anybody moved`, by('flow')?.to === today, { to: by('flow')?.to, today });
  check(`${kind}: every chart says in words what it shows`, s.charts.every((c) => (c.label ?? '').length > 20 && c.from && c.to && c.plotH >= 60), s.charts.map((c) => c.label));
  check(`${kind}: nothing spills off the screen and no text is under 12 px`, s.charts.every((c) => c.inside) && s.docW <= s.W && s.small.length === 0, { small: s.small, docW: s.docW });
  if (shots) await page.screenshot({ path: `shots/stats/${kind}.png` });

  // a pointer three quarters of the way across the population chart reads off that day
  const probe = await page.evaluate(() => {
    const g = window.__game, H = g.sim.history, plot = document.querySelector('.st-chart[data-chart="pop"] .st-plot'), r = plot.getBoundingClientRect();
    const f = 0.75, i = Math.round(f * (H.length - 1));
    plot.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * f, clientY: r.top + r.height / 2 }));
    const fig = plot.closest('.st-chart'), guide = fig.querySelector('.st-guide'), gr = guide.getBoundingClientRect();
    return { says: fig.querySelector('.st-at').textContent, want: `${g.sim.dateOf(H[i].day, false)}: ${H[i].pop.toLocaleString()}`, guide: !guide.hidden, at: Math.round(((gr.left - r.left) / r.width) * 100) };
  });
  check(`${kind}: a pointer three quarters across the population chart reads that day ("${probe.says}") with a line under it at ${probe.at}%`, probe.says === probe.want && probe.guide && Math.abs(probe.at - 75) <= 3, probe);

  // a pointer over the middle of the weekly balance reads that week
  const wprobe = await page.evaluate(() => {
    const g = window.__game, W = g.sim.weeks, plot = document.querySelector('.st-chart[data-chart="weeks"] .st-plot'), r = plot.getBoundingClientRect();
    const i = Math.floor(W.length / 2), f = (i + 0.5) / W.length;
    plot.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * f, clientY: r.top + r.height / 2 }));
    return { says: plot.closest('.st-chart').querySelector('.st-at').textContent, row: { ...W[i] }, date: g.sim.dateOf(W[i].day, false) };
  });
  const wr = wprobe.row, wantWeek = `${wprobe.date}: +${usd(wr.income)} · −${usd(wr.expense)} · balance ${signed(wr.net)}${Math.round(wr.oneTime) ? ` · one-time ${signed(wr.oneTime)}` : ''}`;
  check(`${kind}: a pointer over the middle week reads it ("${wprobe.says}")`, wprobe.says === wantWeek && Math.round(wr.net) === Math.round(wr.income - wr.expense), { says: wprobe.says, want: wantWeek });

  // ten days on, the open drawer has moved on with the county
  const weeksBefore = wk.length;
  const before = by('pop')?.points;
  await page.evaluate(() => { const g = window.__game; window.__dbg.run(10); g.frame(0.05, false); g.ui.refreshNow(); });
  s = await read();
  check(`${kind}: ten days on, the charts have ${by('pop')?.points} points (they had ${before}) and end on the county's latest row`, by('pop')?.points === s.rows && by('pop')?.points > before && by('pop')?.now === s.lastRow.pop.toLocaleString(), { points: by('pop')?.points, rows: s.rows });
  check(`${kind}: and the weekly balance has the week that closed since (${s.weeks.length} weeks, ${weeksBefore} before)`, s.weeks.length > weeksBefore && by('weeks')?.to === (await page.evaluate(() => { const s = window.__game.sim; return s.dateOf(s.weeks[s.weeks.length - 1].day, false); })), { weeks: s.weeks.length, to: by('weeks')?.to });
  await page.keyboard.press('Escape');
  check(`${kind}: Esc puts the drawer away`, await page.evaluate(() => document.querySelector('.subpanel').hidden));
  check(`${kind}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
