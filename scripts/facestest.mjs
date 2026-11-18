// The advisors have faces (src/art/advisors.ts; the owner's yes of 17 Nov is in docs/aaa/DECISIONS_FABLE.md). On a desktop
// and a 390 x 844 phone: the welcome card, which is a message from Chad, has his portrait beside it and still fits the
// screen; the first steps that follow are his too, with a small portrait on the desktop that makes the step card no taller
// (a phone's card has none: beside it the words took a line more) and is gone when the steps are done; the step card is
// written once and left alone, not drawn afresh four times a second; and in the feed the five regulars who are advisors (Chad, Big Dale,
// Deb, Earl, Skyler) post under their portraits while everyone else keeps a plain avatar. Every picture has loaded and has
// the advisor's name as its text. Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/facestest.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); if (!ok) bad++; };
const browser = await launch();
// runs in the page: what a picture is
const face = (sel) => {
  const im = document.querySelector(sel);
  if (!im) return null;
  const r = im.getBoundingClientRect();
  return { alt: im.alt, loaded: im.complete && im.naturalWidth > 0, natural: im.naturalWidth, w: Math.round(r.width), h: Math.round(r.height), src: im.currentSrc.slice(-40) };
};
for (const who of ['desktop', 'phone']) {
  const phone = who === 'phone';
  const W = phone ? 390 : 1280, H = phone ? 844 : 800;
  const open = async (seen) => {
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript((seen) => { try { localStorage.setItem('slopmerica.quality', 'low'); if (seen) { localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } } catch { /* */ } }, seen);
    await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
    return { ctx, page, errs };
  };
  const press = (page, sel) => (phone ? page.tap(sel) : page.click(sel));

  // ---- a new player: the welcome card, then the first steps ----
  {
    const { ctx, page, errs } = await open(false);
    await page.waitForSelector('.onboard', { timeout: 30000 });
    await page.waitForFunction(() => { const im = document.querySelector('.onboard .advisor-sticker'); return !im || im.complete; }, null, { timeout: 15000 });
    const card = await page.evaluate(() => { const r = document.querySelector('.onboard').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), kicker: document.querySelector('.onboard .ob-kicker')?.textContent ?? '' }; });
    const chad = await page.evaluate(face, '.onboard .advisor-sticker');
    check(`${who}: the welcome card (${card.kicker.slice(0, 22)}...) has Chad's portrait: "${chad?.alt}", ${chad?.w} x ${chad?.h} px, loaded`, !!chad && chad.alt === 'Chad Brokowski' && chad.loaded && chad.natural === 256 && chad.w === 64 && chad.h === 64, chad);
    check(`${who}: the card still fits the screen (${card.left} to ${card.right} px, ${card.top} to ${card.bottom})`, card.left >= 0 && card.right <= W && card.top >= 0 && card.bottom <= H, card);
    await press(page, '#ob-go');
    await page.waitForTimeout(500);
    const step = await page.evaluate(() => {
      const g = window.__game, bar = document.querySelector('.next-bar');
      cancelAnimationFrame(g.raf);
      g.ui.openPanel(null); g.tools.set('inspect'); g.ui.update(0.3);
      const im = bar.querySelector('.advisor-sticker'), btn = bar.querySelector('button.chip');
      const words = bar.querySelector('.nb-step')?.textContent ?? '';
      const tall = bar.getBoundingClientRect().height;
      if (im) im.style.display = 'none';
      const without = bar.getBoundingClientRect().height;
      if (im) im.style.display = 'inline-block';
      // eight of the HUD's quarter-second ticks: the card is the same card
      for (let i = 0; i < 8; i++) g.ui.update(0.3);
      return { words: words.slice(0, 30), hidden: bar.hidden, tall: Math.round(tall), without: Math.round(without), sameFace: !!im && im.isConnected, sameButton: !!btn && btn.isConnected };
    });
    const small = await page.evaluate(face, '.next-bar .advisor-sticker');
    if (!phone) {
      check(`the first steps ("${step.words}") are Chad's: "${small?.alt}", ${small?.w} x ${small?.h} px, loaded`, !step.hidden && /^Step 1\/5/.test(step.words) && !!small && small.alt === 'Chad Brokowski' && small.loaded && small.w === 30 && small.h === 30, { step, small });
      check(`his face makes the step card no taller (${step.tall} px with it, ${step.without} px without)`, step.tall <= step.without, step);
    } else check(`phone: the step card ("${step.words}") has no face, and is as tall as it was (${step.tall} px)`, !step.hidden && /^Step 1\/5/.test(step.words) && !small && step.tall === step.without && step.tall <= 64, { step, small });
    check(`${who}: the step card is written once and left alone (after eight ticks its ${phone ? 'button is the same one' : 'picture and its button are the same ones'})`, (phone || step.sameFace) && step.sameButton, step);
    if (phone) {
      await press(page, '.tbtn[data-t="roads"]');
      await page.waitForTimeout(300);
      const one = await page.evaluate(() => { const g = window.__game; g.ui.update(0.3); const bar = document.querySelector('.next-bar'); return { compact: bar.classList.contains('compact'), face: !!bar.querySelector('.advisor-sticker'), h: Math.round(bar.getBoundingClientRect().height) }; });
      check(`phone: over an open drawer the step is its one-line form (${one.h} px tall)`, one.compact && !one.face, one);
    }
    check(`${who}: no page errors for a new player`, errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }

  // ---- a player past the first steps: the Next line has no face; the feed's regulars have theirs ----
  {
    const { ctx, page, errs } = await open(true);
    const r = await page.evaluate(async () => {
      const g = window.__game, feed = g.feed;
      cancelAnimationFrame(g.raf);
      g.ui.openPanel(null); g.tools.set('inspect'); g.ui.update(0.3);
      const bar = document.querySelector('.next-bar');
      const next = { words: bar?.querySelector('.nb-step')?.textContent.slice(0, 12) ?? '', face: !!bar?.querySelector('.advisor-sticker') };
      feed.setCollapsed(false); feed.setExpanded(true);
      const list = document.querySelector('.xfeed .xfeed-list');
      list.innerHTML = '';
      const who = [['Developer Chad', 'ShovelReady'], ['Big Dale', 'OneMoreLane'], ['HOA President Deb', 'CovenantsFirst'], ['Old-Timer Earl', 'BeforeTheBypass'], ['Urbanist Skyler', 'BollardEnjoyer'], ['Randy Pines', 'alpha_pinesfan'], ['SLOP County Chamber', 'SLOPChamber']];
      for (const [name, handle] of who) feed.render({ name, handle, badge: null, avatar: { bg: '#7b61ff', emoji: '🧢' }, text: 'One more lane.', likes: 1, reposts: 0, views: 10 });
      const imgs = [...list.querySelectorAll('.xav img')];
      await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((ok) => { im.onload = im.onerror = ok; }))));
      const posts = [...list.querySelectorAll('.xpost')].reverse().map((li) => {
        const im = li.querySelector('.xav img'), av = li.querySelector('.xav'), b = av.getBoundingClientRect();
        return { handle: li.querySelector('.xhandle').textContent, alt: im?.alt ?? null, loaded: im ? im.complete && im.naturalWidth > 0 : null, src: im?.currentSrc.split('/').pop() ?? null, w: Math.round(b.width), h: Math.round(b.height), emoji: im ? null : av.textContent.trim() };
      });
      return { next, posts };
    });
    check(`${who}: past the first steps the Next line ("${r.next.words}") has no face`, /^Next/.test(r.next.words) && !r.next.face, r.next);
    const faces = r.posts.slice(0, 5), plain = r.posts.slice(5);
    check(`${who}: the feed's five advisors post under their portraits (${faces.map((p) => p.alt).join(', ')}), 34 px, loaded`, faces.length === 5 && ['Chad Brokowski', 'Big Dale', 'Deb', 'Earl', 'Skyler'].every((n, i) => faces[i].alt === n) && faces.every((p) => p.loaded && p.w === 34 && p.h === 34), faces);
    check(`${who}: each has a picture of their own (${new Set(faces.map((p) => p.src)).size} files)`, new Set(faces.map((p) => p.src)).size === 5, faces.map((p) => p.src));
    check(`${who}: everyone else keeps a plain avatar (${plain.map((p) => `${p.handle} ${p.emoji}`).join(', ')})`, plain.length === 2 && plain.every((p) => p.alt === null && !!p.emoji && p.w === 34), plain);
    check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
