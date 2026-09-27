// Weather keeps to the calendar (playtest: rain "from June 2030 through
// February 2032", and snow in summer). Weather spells used to be timed on
// the day/night clock (a 6-minute "day") while the calendar runs a day every
// 2.5 s, so three weather days were a year of rain. Runs two game years at
// top speed on Appalachia (rain and snow) and checks: no rain or snow spell
// outlasts two months of calendar, no snow falls in summer, the weather
// changes often, and it still holds long enough on screen not to strobe.
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.emergencySpeed', 'off'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = window.__game, s = g.sim, W = g.weather;
  cancelAnimationFrame(g.raf);
  s.speed = 3;
  const wet = (k) => k === 'rain' || k === 'storm' || k === 'snow' || k === 'blizzard' || k === 'hurricane';
  const spells = [];
  let cur = null, realT = 0, summerSnow = 0;
  const day0 = s.day;
  while (s.day - day0 < 730) {
    g.frame(0.1, false);
    realT += 0.1;
    const k = W.kind, doy = ((s.time(g.hour).dayOfYear % 365) + 365) % 365;
    if (!cur || cur.kind !== k) { if (cur) spells.push(cur); cur = { kind: k, from: s.day, to: s.day, real: 0 }; }
    cur.to = s.day; cur.real += 0.1;
    // summer: days 92-183 after Mar 20 (late June to late September)
    if ((k === 'snow' || k === 'blizzard') && doy >= 100 && doy < 176 && W.intensity > 0.2) summerSnow++;
  }
  if (cur) spells.push(cur);
  const wetSpells = spells.filter((x) => wet(x.kind));
  const longestWet = wetSpells.reduce((m, x) => Math.max(m, x.to - x.from), 0);
  const kinds = [...new Set(spells.map((x) => x.kind))];
  const shortest = spells.slice(1, -1).reduce((m, x) => Math.min(m, x.real), Infinity);
  // then a season at normal speed: spells are days long, not weeks
  s.speed = 1;
  const slow = [];
  let sc = null;
  const d1 = s.day;
  while (s.day - d1 < 90) {
    g.frame(0.1, false);
    const k = W.kind;
    if (!sc || sc.kind !== k) { if (sc) slow.push(sc); sc = { kind: k, from: s.day, to: s.day }; }
    sc.to = s.day;
  }
  const slowWet = slow.filter((x) => wet(x.kind)).reduce((m, x) => Math.max(m, x.to - x.from), 0);
  return { spells: spells.length, kinds, longestWet: Math.round(longestWet), summerSnow, shortestReal: +shortest.toFixed(1), realT: Math.round(realT), sample: spells.slice(0, 8).map((x) => `${x.kind} ${Math.round(x.to - x.from)}d`), slowSpells: slow.length, slowWet: Math.round(slowWet), slowSample: slow.slice(0, 8).map((x) => `${x.kind} ${Math.round(x.to - x.from)}d`) };
});
console.log(JSON.stringify(r));
check(`no rain or snow spell outlasts a month of calendar, even at top speed (longest ${r.longestWet} days)`, r.longestWet <= 31, r);
check(`no snow falls in summer (${r.summerSnow} summer frames of snow)`, r.summerSnow === 0, r);
check(`the weather changes (${r.spells} spells over two years at top speed: ${r.kinds.join(', ')})`, r.spells >= 12 && r.kinds.length >= 3, r);
check(`at normal speed a rainy spell is days, not weeks (longest ${r.slowWet} days; ${r.slowSpells} spells in 90 days: ${r.slowSample.join(', ')})`, r.slowWet <= 16 && r.slowSpells >= 5, r);
check(`and holds long enough on screen not to strobe at top speed (shortest ${r.shortestReal} s)`, r.shortestReal >= 11.5, r);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
