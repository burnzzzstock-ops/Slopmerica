// The interface tells the audio engine what it is showing. A banner (a milestone, a landmark) asks the engine to duck the
// music and the street once, when it is put on screen; when a tool is in hand the banner is a toast instead and asks for
// nothing. The engine's calls are counted in the page; what a duck sounds like is the audio tests' business
// (scripts/look/audio-*.mjs). Exits nonzero on failure.
//
//   BASE_URL=http://127.0.0.1:5173 node scripts/soundhooks.mjs
import { launch } from './lib/browser.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); if (!ok) bad++; };
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
const calls = () => page.evaluate(() => ({ duck: window.__calls.duck.length, zonePaint: window.__calls.zonePaint.length }));

// ---- a banner ducks the music once; a banner that is shown as a toast does not ----
{
  const s = await page.evaluate(() => {
    const g = window.__game, c = window.__calls;
    g.tools.set('inspect');
    const d0 = c.duck.length;
    g.ui.banner('Boomburb', 'the county has a name for itself');
    const one = { ducks: c.duck.length - d0, banners: document.querySelectorAll('.hud .banner, .banner').length, text: document.querySelector('.banner')?.textContent ?? '' };
    g.ui.banner('Second', 'another one');
    const two = { ducks: c.duck.length - d0, banners: document.querySelectorAll('.banner').length };
    g.tools.set('zone');
    const d1 = c.duck.length, b1 = document.querySelectorAll('.banner').length;
    g.ui.banner('While zoning', 'this one is a toast');
    const toast = [...document.querySelectorAll('.toasts .toast')].at(-1)?.textContent ?? '';
    const tool = { ducks: c.duck.length - d1, banners: document.querySelectorAll('.banner').length - b1, toast };
    g.tools.set('inspect');
    return { one, two, tool };
  });
  check(`a banner on screen asks the engine to duck, once (${s.one.ducks} call, "${s.one.text.slice(0, 24)}")`, s.one.banners === 1 && s.one.ducks === 1, s.one);
  check(`a second banner asks once more (${s.two.ducks} calls for ${s.two.banners} banners)`, s.two.banners === 2 && s.two.ducks === 2, s.two);
  check(`with a tool in hand the banner is a toast, and asks for nothing (${s.tool.ducks} calls, "${s.tool.toast.slice(0, 30)}")`, s.tool.banners === 0 && s.tool.ducks === 0 && /While zoning/.test(s.tool.toast), s.tool);
}

void calls;
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
