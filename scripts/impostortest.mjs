// Distant trees on phones ("We're getting no trees on mobile unless zoomed in
// closer"). Far trees are billboards baked at load into one sheet: a side view
// and a from-above view per species. The bake set each tile with
// renderer.setViewport, which three scales by the screen's pixel ratio, so on
// a 2-3x phone every tile came out 2-3x too big and the whole from-above row
// fell off the sheet: looking down, distant trees were invisible. Bakes the
// sheet on a 1x desktop and on a 3x touch phone and checks every species has
// both views on the phone, and the phone's sheet is the desktop's. Exits
// nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });

async function sheet(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.quality', 'low'); } catch { /* */ } });
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game, null, { timeout: 300000 });
  const r = await page.evaluate(() => {
    const g = window.__game, T = g.trees;
    cancelAnimationFrame(g.raf);
    const tex = T.far[0].material.map, { data, width: W, height: H } = tex.image;
    const kinds = T.far.length, cw = W / kinds, ch = H / 2;
    // share of opaque texels in each species' side (row 0) and top (row 1) cell
    const cover = [];
    for (let row = 0; row < 2; row++) for (let k = 0; k < kinds; k++) {
      let n = 0;
      for (let y = row * ch; y < (row + 1) * ch; y++) for (let x = k * cw; x < (k + 1) * cw; x++) if (data[(y * W + x) * 4 + 3] > 128) n++;
      cover.push(+(n / (cw * ch)).toFixed(3));
    }
    return { ratio: g.renderer.getPixelRatio(), kinds, cover };
  });
  await ctx.close();
  return { ...r, errs };
}

const desk = await sheet({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
const phone = await sheet({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
console.log(JSON.stringify({ desk, phone }));
const n = desk.kinds;
check(`the phone renders above 1x (${phone.ratio}x), the desktop at 1x`, phone.ratio > 1.4 && desk.ratio === 1, { phone: phone.ratio, desk: desk.ratio });
check(`every species has a side and a from-above billboard on the phone (least covered: side ${Math.min(...phone.cover.slice(0, n))}, top ${Math.min(...phone.cover.slice(n))})`, phone.cover.every((c) => c > 0.03), phone.cover);
check('the phone bakes the same billboards as the desktop', phone.cover.every((c, i) => Math.abs(c - desk.cover[i]) < 0.03), { phone: phone.cover, desk: desk.cover });
check('no page errors', !desk.errs.length && !phone.errs.length, [...desk.errs, ...phone.errs].slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
