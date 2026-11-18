// The interface and the audio engine tell each other what is going on. A banner (a milestone, a landmark) asks the engine
// to duck the music and the street once, when it is put on screen; when a tool is in hand the banner is a toast instead and
// asks for nothing. The radio's ad is a jingle with no voice: when the engine says one has started, its words come up as a
// caption, whole and inside the screen on a 390 x 844 phone too, and stay out of a bug report's recent actions. The zoning
// brush tells the engine every time it changes lots during a stroke, with how many, so the brush is heard for as long as
// it paints; a stroke over land it leaves as it was says nothing, and the stroke's one completed event (zonePainted) is
// still one. The engine's calls are counted in the page; what a duck, a jingle or the brush sounds like, and when the
// engine plays an ad, is the audio tests' business (scripts/look/action-audio.mjs, score.mjs). Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/soundhooks.mjs
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
// the ads as the score has them (src/audio/score.ts)
const ADS = [...readFileSync(new URL('../src/audio/score.ts', import.meta.url), 'utf8').match(/export const RADIO_ADS = \[([\s\S]*?)\] as const/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
check(`the score has its radio ads (${ADS.length})`, ADS.length >= 3, ADS);

const browser = await launch();
for (const who of ['desktop', 'phone']) {
  const phone = who === 'phone';
  const W = phone ? 390 : 1280;
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  // frames by hand from here on, and every call the interface makes to the engine written down
  await page.evaluate(() => {
    const g = window.__game, a = g.audio;
    cancelAnimationFrame(g.raf);
    window.__calls = { duck: [], zonePaint: [] };
    const duck = a.duck.bind(a), zonePaint = a.zonePaint.bind(a);
    a.duck = (s) => { window.__calls.duck.push(s ?? null); duck(s); };
    a.zonePaint = (x, z, n) => { window.__calls.zonePaint.push({ x, z, n }); zonePaint(x, z, n); };
  });

  // ---- a banner ducks the music once; a banner that is shown as a toast does not ----
  if (!phone) {
    const s = await page.evaluate(() => {
      const g = window.__game, c = window.__calls;
      g.tools.set('inspect');
      const d0 = c.duck.length;
      g.ui.banner('Boomburb', 'the county has a name for itself');
      const one = { ducks: c.duck.length - d0, banners: document.querySelectorAll('.banner').length, text: document.querySelector('.banner')?.textContent ?? '' };
      g.ui.banner('Second', 'another one');
      const two = { ducks: c.duck.length - d0, banners: document.querySelectorAll('.banner').length };
      g.tools.set('zone');
      const d1 = c.duck.length, b1 = document.querySelectorAll('.banner').length;
      g.ui.banner('While zoning', 'this one is a toast');
      const toast = [...document.querySelectorAll('.toasts .toast')].at(-1)?.textContent ?? '';
      const tool = { ducks: c.duck.length - d1, banners: document.querySelectorAll('.banner').length - b1, toast };
      g.tools.set('inspect');
      document.querySelectorAll('.banner, .toasts .toast').forEach((el) => el.remove());
      return { one, two, tool };
    });
    check(`a banner on screen asks the engine to duck, once (${s.one.ducks} call, "${s.one.text.slice(0, 24)}")`, s.one.banners === 1 && s.one.ducks === 1, s.one);
    check(`a second banner asks once more (${s.two.ducks} calls for ${s.two.banners} banners)`, s.two.banners === 2 && s.two.ducks === 2, s.two);
    check(`with a tool in hand the banner is a toast, and asks for nothing (${s.tool.ducks} calls, "${s.tool.toast.slice(0, 30)}")`, s.tool.banners === 0 && s.tool.ducks === 0 && /While zoning/.test(s.tool.toast), s.tool);
  }

  // ---- the radio's ad is captioned when the engine says its jingle has started ----
  {
    const r = await page.evaluate((ADS) => {
      const g = window.__game, a = g.audio;
      const wired = typeof a.onRadioAd === 'function';
      const toasts = () => [...document.querySelectorAll('.toasts .toast')].filter((t) => !t.classList.contains('out'));
      const d0 = window.__calls.duck.length;
      const shown = [];
      for (const ad of ADS) {
        a.onRadioAd?.(ad);
        const t = toasts().find((x) => x.textContent.includes(ad));
        const b = t?.getBoundingClientRect();
        shown.push(t ? { text: t.textContent, left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), spill: t.scrollWidth > t.clientWidth + 1, px: parseFloat(getComputedStyle(t).fontSize) } : null);
      }
      // the same ad again while its caption is up: still one caption for it
      a.onRadioAd?.(ADS[ADS.length - 1]);
      const twice = toasts().filter((x) => x.textContent.includes(ADS[ADS.length - 1])).length;
      const ducks = window.__calls.duck.length - d0;
      // and none of it in a bug report's recent actions
      g.ui.reportBug();
      const report = document.querySelector('#bug-preview')?.value ?? null;
      document.querySelector('.bug')?.remove();
      document.querySelectorAll('.toasts .toast').forEach((el) => el.remove());
      return { wired, shown, twice, ducks, inReport: report === null ? null : ADS.filter((ad) => report.includes(ad.slice(0, 20))).length, reportHasActions: report?.includes('Recent actions:') ?? false };
    }, ADS);
    check(`${who}: the interface listens for the radio's ad`, r.wired, r);
    check(`${who}: each ad's words come up as a caption, whole (${r.shown.filter(Boolean).length} of ${ADS.length}: "${(r.shown[0]?.text ?? '').slice(0, 34)}...")`, r.shown.every((s, i) => s && s.text.includes(ADS[i])), r.shown);
    check(`${who}: the caption is inside the screen and nothing is cut off (${r.shown.map((s) => s ? `${s.left} to ${s.right} px` : 'none').join(', ')}; ${r.shown[0]?.px} px text)`, r.shown.every((s) => s && s.left >= 0 && s.right <= W && !s.spill && s.px >= 12), r.shown);
    check(`${who}: the same ad again while its caption is up keeps one caption (${r.twice})`, r.twice === 1, r);
    check(`${who}: a caption does not duck the jingle it is the words of (${r.ducks} calls)`, r.ducks === 0, r);
    check(`${who}: the ads stay out of a bug report's recent actions (${r.inReport} of ${ADS.length} in it)`, r.inReport === 0 && r.reportHasActions, { inReport: r.inReport, actions: r.reportHasActions });
  }

  // ---- the zoning brush is heard while it lays zone down, and only then ----
  if (!phone) {
    const z = await page.evaluate(() => {
      const g = window.__game, d = window.__dbg, t = g.tools, c = window.__calls, S0 = g.startView();
      // a new street on open land beside the starting town (the town's own streets are where the camera starts)
      let S = null, why = [];
      for (const dz of [200, -200, 320, -320, 440, -440]) {
        const r = d.road(S0.x - 160, S0.z + dz, S0.x + 160, S0.z + dz, 'twoLane');
        if (typeof r === 'number') { S = { x: S0.x, z: S0.z + dz }; break; }
        why.push(r);
      }
      if (!S) return { err: 'no street', why };
      g.zones.update();
      const done = [];
      g.sim.events.on('zonePainted', (p) => done.push(p.cells));
      const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now(), type });
      const V = g.camera.position.constructor;
      const stroke = (tool, zone, xs) => {
        t.zoneType = zone; t.brush = 1; t.set(tool);
        const P = xs.map((dx) => new V(S.x + dx, g.terrain.h(S.x + dx, S.z), S.z));
        const c0 = c.zonePaint.length, e0 = done.length;
        t.down(P[0], ev('pointerdown'));
        for (const p of P.slice(1)) t.move(p, ev('pointermove'), true);
        const held = c.zonePaint.slice(c0);
        t.up(P[P.length - 1], ev('pointerup'), true);
        return { points: P.length, held: held.length, cells: held.map((h) => h.n), at: held.every((h) => P.some((p) => p.x === h.x && p.z === h.z)), after: c.zonePaint.length - c0 - held.length, events: done.slice(e0) };
      };
      const xs = [-120, -90, -60, -30, 0, 30, 60, 90, 120];
      const first = stroke('zone', 'resLow', xs);
      const again = stroke('zone', 'resLow', xs);
      const dez = stroke('dezone', 'resLow', xs.slice(0, 4));
      t.set('inspect');
      return { first, again, dez };
    });
    const f = z.first, a = z.again, dz = z.dez;
    check(`a brush stroke over open lots is heard as it goes (${f?.held} calls over ${f?.points} points, ${f?.cells?.join(' ')} lots), each at the brush`, !z.err && f.held >= 4 && f.cells.every((n) => n > 0) && f.at, z);
    check(`the stroke still ends with its one completed event (${f?.events?.length}: ${f?.events?.[0]} lots, the ${f?.cells?.reduce((s, n) => s + n, 0)} it was heard laying)`, !z.err && f.events.length === 1 && f.events[0] === f.cells.reduce((s, n) => s + n, 0) && f.after === 1, f);
    check(`the same stroke again changes nothing and is silent (${a?.held} calls, ${a?.events?.length} events)`, !z.err && a.held === 0 && a.after === 0 && a.events.length === 0, a);
    check(`taking zone off is heard the same way (${dz?.held} calls, ${dz?.events?.length} event)`, !z.err && dz.held >= 2 && dz.cells.every((n) => n > 0) && dz.events.length === 1, dz);
  }

  check(`${who}: no page errors`, errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
