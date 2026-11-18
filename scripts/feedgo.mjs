// A feed post about something that happened somewhere takes the camera there. The simulation hands a place with the news
// (FeedPost.at, scripts/feedplace.mjs); this is the panel. On a desktop and a 390 x 844 phone: a post pushed with a place,
// through the feed's own push, has a Show button with a name; a click or a tap on the post flies the camera to the place,
// at a height to see it from (120 to 420 m, and 420 m from a ride with a car); the Show button works from the keyboard; a
// post with no place has no button and leaves the camera alone, and in the feed's peek it opens the whole feed as before; a
// link inside a post is still a link, not a flight; and on the phone the open feed goes back to its newest post so the
// place can be seen. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/feedgo.mjs
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
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const made = await page.evaluate(() => {
    const g = window.__game, feed = g.feed, S = g.startView();
    cancelAnimationFrame(g.raf);
    g.sim.speed = 0;
    feed.ambientT = 1e9; feed.queue.length = 0;   // none of the feed's own small talk or waiting news in between
    feed.setCollapsed(false); feed.setExpanded(true);
    const list = document.querySelector('.xfeed .xfeed-list');
    list.innerHTML = '';
    const place = { x: S.x + 420, z: S.z - 360 };
    // a post with no place, then news with one through the feed's own push (the newest is first in the list)
    feed.render({ name: 'County Weather Desk', handle: 'CountyWXDesk', badge: 'gray', avatar: { bg: '#287c9f', emoji: '🌪️' }, text: 'Clear skies over the county.', likes: 3, reposts: 0, views: 80 });
    feed.push('crash', { road: 'Whispering Pines Stroad', at: place });
    feed.update(30);
    const posts = [...list.querySelectorAll('.xpost')];
    const withPlace = posts.find((p) => p.dataset.x !== undefined), without = posts.find((p) => p.dataset.x === undefined);
    const go = withPlace?.querySelector('.xgo'), r = go?.getBoundingClientRect();
    return { place, posts: posts.length, withPlace: withPlace ? { x: Number(withPlace.dataset.x), z: Number(withPlace.dataset.z), text: withPlace.querySelector('.xtext').textContent.slice(0, 40), go: go ? { name: go.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), drawn: !!go.querySelector('svg') } : null } : null, without: without ? { go: !!without.querySelector('.xgo') } : null, start: { x: g.rts.target.x, z: g.rts.target.z } };
  });
  check(`${who}: news pushed with a place is a post that keeps it ("${made.withPlace?.text}...")`, !!made.withPlace && Math.abs(made.withPlace.x - made.place.x) < 0.01 && Math.abs(made.withPlace.z - made.place.z) < 0.01, made);
  check(`${who}: it has a Show button with a name ("${made.withPlace?.go?.name}", ${made.withPlace?.go?.w} x ${made.withPlace?.go?.h} px); a post with no place has none`, !!made.withPlace?.go && /where/i.test(made.withPlace.go.name ?? '') && made.withPlace.go.w >= 24 && made.withPlace.go.h >= 24 && made.without?.go === false, made);
  const view = (from) => page.evaluate(({ from, place }) => { const g = window.__game; if (from) g.rts.setView(from.x, from.z, from.d, 0.6, 0.85, true); for (let i = 0; i < 200; i++) { g.frame(1 / 60); g.ui.update(1 / 60); } return { off: Math.hypot(g.rts.target.x - place.x, g.rts.target.z - place.z), d: g.rts.distance, expanded: g.feed.expanded }; }, { from, place: made.place });
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));

  // a click on the post's words, from far out
  await page.evaluate(({ x, z }) => window.__game.rts.setView(x, z, 2400, 0.6, 0.85, true), made.start);
  await press('.xpost.has-place .xtext');
  let v = await view(null);
  check(`${who}: a ${phone ? 'tap' : 'click'} on the post takes the camera to the place (${v.off.toFixed(0)} m from it), down from 2,400 m to ${v.d.toFixed(0)} m`, v.off < 25 && v.d >= 120 && v.d <= 425, v);
  if (phone) check('phone: the open feed goes back to its newest post, so the place can be seen', v.expanded === false, v);
  if (phone) await page.evaluate(() => window.__game.feed.setExpanded(true));

  // from close in, the height is kept; from very close, it is raised to 120 m
  await page.evaluate(({ x, z }) => window.__game.rts.setView(x, z, 60, 0.6, 0.85, true), made.start);
  await press('.xpost.has-place .xtext');
  v = await view(null);
  check(`${who}: from 60 m it comes up to see the place (${v.d.toFixed(0)} m)`, v.off < 25 && Math.abs(v.d - 120) < 8, v);
  if (phone) await page.evaluate(() => window.__game.feed.setExpanded(true));

  if (!phone) {
    // the Show button, from the keyboard
    await page.evaluate(({ x, z }) => window.__game.rts.setView(x, z, 300, 0.6, 0.85, true), made.start);
    await page.focus('.xpost.has-place .xgo');
    await page.keyboard.press('Enter');
    v = await view(null);
    check(`the Show button works from the keyboard (${v.off.toFixed(0)} m from the place, at ${v.d.toFixed(0)} m)`, v.off < 25 && Math.abs(v.d - 300) < 12, v);
  }

  // a post with no place leaves the camera alone; in the peek it opens the feed, as before
  await page.evaluate(({ x, z }) => { const g = window.__game; g.rts.setView(x, z, 300, 0.6, 0.85, true); g.feed.setExpanded(true); }, made.start);
  await press('.xpost:not(.has-place) .xtext');
  const still = await page.evaluate(({ x, z }) => { const g = window.__game; for (let i = 0; i < 30; i++) g.frame(1 / 60); return { moved: Math.hypot(g.rts.target.x - x, g.rts.target.z - z), expanded: g.feed.expanded }; }, made.start);
  check(`${who}: a post with no place leaves the camera where it was (${still.moved.toFixed(1)} m)`, still.moved < 1 && still.expanded, still);
  const peek = await page.evaluate(() => {
    const g = window.__game, feed = g.feed, list = document.querySelector('.xfeed .xfeed-list');
    // the newest post is the one the peek shows: make it one with no place
    feed.render({ name: 'County Weather Desk', handle: 'CountyWXDesk', badge: 'gray', avatar: { bg: '#287c9f', emoji: '🌪️' }, text: 'Still clear.', likes: 1, reposts: 0, views: 20 });
    feed.setExpanded(false);
    list.firstElementChild.querySelector('.xtext').click();
    return { expanded: feed.expanded };
  });
  check(`${who}: in the feed's peek a post with no place opens the whole feed, as before`, peek.expanded === true, peek);

  // a link inside a post is a link, not a flight
  const link = await page.evaluate(({ x, z }) => {
    const g = window.__game, feed = g.feed, list = document.querySelector('.xfeed .xfeed-list');
    g.rts.setView(x, z, 300, 0.6, 0.85, true);
    feed.render({ name: 'SLOP', handle: 'SLOPofficial', badge: 'gold', avatar: { bg: '#111111', emoji: '💥' }, text: 'New drop.', image: { kind: 'merch', caption: 'One More Lane tee' }, at: { x: x + 500, z: z + 500 }, likes: 9, reposts: 2, views: 300 });
    const a = list.firstElementChild.querySelector('a');
    if (!a) return { err: 'no link in the post' };
    a.addEventListener('click', (e) => e.preventDefault());   // (do not open the shop from a test)
    a.click();
    for (let i = 0; i < 30; i++) g.frame(1 / 60);
    return { moved: Math.hypot(g.rts.target.x - x, g.rts.target.z - z), href: a.getAttribute('href') };
  }, made.start);
  check(`${who}: a link inside a post with a place is still a link (the camera moved ${link.moved?.toFixed(1)} m)`, !link.err && link.moved < 1 && !!link.href, link);
  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
