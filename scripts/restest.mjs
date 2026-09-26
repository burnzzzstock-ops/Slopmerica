// Dynamic resolution only trades sharpness for speed when it gets speed: a
// drop that doesn't make frames faster (the time goes to the simulation, not
// to pixels) is undone, one that does is kept, and Settings → Resolution:
// always full never drops. Drives the frame sampler directly. Exits nonzero
// on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.removeItem('slopmerica.resolution'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const r = await page.evaluate(() => {
  const g = window.__game;
  cancelAnimationFrame(g.raf);
  g.qualityBenchmarkDone = true; // keep the preset where it is
  // feed `sec` seconds of frames of `ms` each; return the render scale after
  const feed = (ms, sec) => { for (let t = 0; t < sec * 1000; t += ms) g.sampleFrame(ms, ms * 0.5); return +g.perf.resolution.toFixed(2); };
  const out = {};
  feed(16, 3);
  out.start = +g.perf.resolution.toFixed(2);
  // slow frames that resolution can't fix (CPU-bound): it tries once, then gives it back
  out.tried = feed(30, 3.5);
  out.afterNoGain = feed(30, 4);
  out.later = feed(30, 20);
  // after the pause, slow frames that a lower resolution does fix: it keeps the drop
  g.resNoGain = 0;
  let dropped = null;
  for (let i = 0; i < 40 && dropped === null; i++) { feed(30, 0.5); if (g.perf.resolution < 0.99) dropped = +g.perf.resolution.toFixed(2); }
  out.dropped = dropped;
  out.kept = feed(20, 4);
  // always full: back to 100% and it stays there
  g.setResolutionMode('full');
  out.full = feed(40, 10);
  out.info = g.renderInfo();
  g.setResolutionMode('auto');
  return out;
});
check(`starts at full resolution (${r.start})`, r.start === 1, r);
check(`a slow CPU-bound spell tries a lower resolution (${r.tried}) then gives it back when frames don't speed up (${r.afterNoGain}) and doesn't retry for a while (${r.later})`, r.tried < 1 && r.afterNoGain === 1 && r.later === 1, r);
check(`a drop that makes frames faster is kept (${r.dropped} -> ${r.kept})`, r.dropped !== null && r.kept < 1 && r.kept >= 0.75, r);
check(`Resolution: always full never drops (${r.full}; ${r.info.buffer} of ${r.info.screen}, ${r.info.share}%)`, r.full === 1 && r.info.share === 100, r);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
