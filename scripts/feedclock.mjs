// A feed post says how long ago it was posted. Every post said "now" for as long as it stayed in the list. On a desktop and
// a 390 x 844 phone: a post that has just arrived says "now"; the same post five minutes, three hours and two days old says
// 5m, 3h and 2d (its stamp is moved back and the feed's own clock, which writes the ages every ten seconds, is run); the
// edges are 59 s "now", 60 s "1m", 59 min "59m", 60 min "1h", 23 h "23h", 24 h "1d"; a newer post above it says "now"; and a
// handle too long for the line is cut short without taking the age with it. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/feedclock.mjs
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
  const r = await page.evaluate(() => {
    const g = window.__game, feed = g.feed;
    cancelAnimationFrame(g.raf);
    feed.setCollapsed(false); feed.setExpanded(true);
    feed.ambientT = 1e9;   // no small talk of the feed's own while the clock is run forward
    feed.queue.length = 0;  // nor the news the game itself had waiting (its start-of-game post, under load)
    const list = document.querySelector('.xfeed .xfeed-list');
    list.innerHTML = '';
    const post = (kind, extra) => { feed.push(kind, extra); feed.update(30); return list.firstElementChild; };
    const when = (li) => li?.querySelector('.xwhen')?.textContent ?? null;
    const aged = (li, ms) => { li.dataset.at = String(performance.now() - ms); feed.update(11); return when(li); };
    const first = post('populationMilestone', { count: 350 });
    if (!first) return { err: 'no post arrived' };
    const out = { fresh: when(first), meta: first.querySelector('.xmeta')?.textContent.replace(/\s+/g, ' ').trim() ?? '' };
    const S = 1000, M = 60 * S, H = 60 * M;
    out.ages = { '5 min': aged(first, 5 * M + S), '3 h': aged(first, 3 * H + S), '2 days': aged(first, 49 * H) };
    out.edges = [[59 * S, 'now'], [60 * S + 50, '1m'], [59 * M + 59 * S, '59m'], [60 * M + 50, '1h'], [23 * H + 59 * M, '23h'], [24 * H + 50, '1d']].map(([ms, want]) => ({ want, got: aged(first, ms) }));
    aged(first, 12 * M + S);
    const second = post('bankrupt');
    out.two = second && second !== first ? { newer: when(second), older: when(first), posts: list.children.length } : null;
    // a handle too long for the line
    const li = second ?? first, handle = li.querySelector('.xhandle'), age = li.querySelector('.xage'), meta = li.querySelector('.xmeta');
    if (handle) handle.textContent = '@county_commissioner_of_whispering_pines_stroad_estates_official';
    const a = age?.getBoundingClientRect(), m = meta?.getBoundingClientRect(), h = handle?.getBoundingClientRect();
    out.long = a && m && h ? { ageRight: Math.round(a.right), metaRight: Math.round(m.right), ageW: Math.round(a.width), cut: handle.scrollWidth > handle.clientWidth + 1, text: age.textContent.replace(/\s+/g, ' ').trim(), px: parseFloat(getComputedStyle(age).fontSize) } : null;
    return out;
  });
  check(`${who}: a post that has just arrived says "now" ("${(r.meta ?? '').slice(0, 50)}")`, !r.err && r.fresh === 'now', r);
  check(`${who}: five minutes, three hours and two days old it says ${Object.values(r.ages ?? {}).join(', ')}`, !r.err && r.ages['5 min'] === '5m' && r.ages['3 h'] === '3h' && r.ages['2 days'] === '2d', r.ages);
  check(`${who}: the edges (${(r.edges ?? []).map((e) => e.got).join(', ')})`, !r.err && r.edges.every((e) => e.got === e.want), r.edges);
  check(`${who}: a newer post above it says "${r.two?.newer}" while it says "${r.two?.older}"`, !!r.two && r.two.newer === 'now' && r.two.older === '12m' && r.two.posts === 2, r.two);
  check(`${who}: a handle too long for the line is cut short and the age stays whole ("${r.long?.text}", ${r.long?.ageW} px wide, ending at ${r.long?.ageRight} of ${r.long?.metaRight} px)`, !!r.long && r.long.cut && r.long.ageW > 10 && r.long.ageRight <= r.long.metaRight + 1 && /^· now$/.test(r.long.text) && r.long.px >= 12, r.long);
  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
