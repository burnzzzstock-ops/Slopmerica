// Roads stand on the ground: a road across a dip deeper than 4.5 m used to
// get no fill and hang in the air as a slab (a playtest screenshot showed
// its underside and shadow); now it gets an embankment. SHOTS=file saves a
// picture. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'medium'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, T = g.terrain, S = g.startView();
  cancelAnimationFrame(g.raf);
  const WATER = 0;
  // a dry dip: both ends on the same level, the middle 7-14 m lower, no water, no roads near
  let best = null;
  for (let k = 0; k < 4000 && !best; k++) {
    const x = S.x + (Math.random() - 0.5) * 2600, z = S.z + (Math.random() - 0.5) * 2600, a = Math.random() * Math.PI;
    const dx = Math.cos(a) * 110, dz = Math.sin(a) * 110;
    if (!T.inBounds(x, z, 200) || g.net.segsNear(x - 150, z - 150, x + 150, z + 150).length) continue;
    const h0 = T.h(x - dx, z - dz), h1 = T.h(x + dx, z + dz);
    if (Math.abs(h0 - h1) > 5 || Math.min(h0, h1) < 6) continue;
    let low = Infinity;
    for (let t = 0.25; t <= 0.75; t += 0.05) low = Math.min(low, T.h(x - dx + 2 * dx * t, z - dz + 2 * dz * t));
    const depth = Math.min(h0, h1) - low;
    if (depth > 7 && depth < 14 && low > 3) best = { x0: x - dx, z0: z - dz, x1: x + dx, z1: z + dz, depth };
  }
  if (!best) return null;
  const built = d.road(best.x0, best.z0, best.x1, best.z1, 'twoLane');
  const seg = [...g.net.segs.values()].pop();
  let gap = 0, over = 0, n = 0;
  if (seg) for (let i = 0; i < seg.samp.pts.length; i++) {
    const p = seg.samp.pts[i];
    const e = seg.hs[i] - T.h(p.x, p.z);
    gap = Math.max(gap, e); n++;
    if (e > 1.2) over++;
    // the road's shoulders: ground beside the pavement stays close too
  }
  let shoulder = 0;
  if (seg) for (let i = 2; i < seg.samp.pts.length - 2; i += 2) {
    const p = seg.samp.pts[i], q = seg.samp.pts[i + 1];
    const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
    for (const side of [1, -1]) {
      const sx = p.x - (tz / tl) * side * 6, sz = p.z + (tx / tl) * side * 6;
      shoulder = Math.max(shoulder, seg.hs[i] - T.h(sx, sz));
    }
  }
  for (let i = 0; i < 6; i++) g.frame(0.05, false);
  return { best, built, gap: +gap.toFixed(2), over, n, shoulder: +shoulder.toFixed(2), mid: seg ? { x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2 } : null };
});
console.log(JSON.stringify(r));
check(`found a dry dip ${r?.best?.depth?.toFixed(1)} m deep`, !!r, r);
if (r) {
  check(`the road across it was built (${r.built})`, typeof r.built === 'number', r);
  check(`it stands on ground all the way (worst gap under the road ${r.gap} m, ${r.over}/${r.n} points over 1.2 m)`, r.gap < 1.2, r);
  check(`with an embankment beside the pavement (worst drop 6 m out ${r.shoulder} m)`, r.shoulder < 3, r);
  if (process.env.SHOTS && r.mid) {
    await page.evaluate(({ x, z }) => { const g = window.__game; g.hour = 15; document.querySelector('.hud').style.visibility = 'hidden'; g.rts.setView(x, z, 140, 0.9, 0.3, true); for (let i = 0; i < 20; i++) g.frame(0.05, false); g.frame(0.016, true); }, r.mid);
    await page.screenshot({ path: process.env.SHOTS });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
