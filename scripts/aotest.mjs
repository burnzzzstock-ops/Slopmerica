// Ambient occlusion leaves open ground alone. The playtest saw "spotting" at
// every preset: AO blotched flat grass (terrain facets read as creases) and,
// at half resolution, laid moire stripes over everything (depth read on
// texel edges). Renders bare ground with AO on and off at a few window sizes
// and zooms and measures how much AO darkens / mottles it. Exits nonzero on
// failure. `--shots` saves the frames to /tmp.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const errs = [];
for (const q of ['high', 'ultra']) for (const [W, H] of [[1268, 700], [1268, 595]]) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((q) => { localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); }, q);
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game, S = g.startView(); cancelAnimationFrame(g.raf); document.querySelector('.hud').style.visibility = 'hidden'; g.hour = 11; window.__S = S; g.trees.cut(S.x + 100, S.z + 100, S.x + 700, S.z + 700, () => true); g.weather.kind = 'clear'; });
  for (const [dist, pitch] of [[150, 0.9], [420, 1.1]]) {
    const grab = async (ao) => {
      await page.evaluate(([dist, pitch, ao]) => { const g = window.__game, S = window.__S; g.post.ao = ao; g.rts.setView(S.x + 400, S.z + 400, dist, 0, pitch, true); for (let i = 0; i < 4; i++) g.frame(0.05, false); g.frame(0.016, true); }, [dist, pitch, ao]);
      const buf = await page.screenshot();
      if (shots) await page.screenshot({ path: `/tmp/ao-${q}-${W}x${H}-${dist}-${ao ? 'on' : 'off'}.png` });
      return buf.toString('base64');
    };
    const on = await grab(true), off = await grab(false);
    const r = await page.evaluate(async ([a, b]) => {
      const load = (s) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
      const A = px(ia), B = px(ib), w = ia.width, h = ia.height;
      // the middle of the frame: bare ground only
      const x0 = Math.round(w * 0.3), x1 = Math.round(w * 0.7), y0 = Math.round(h * 0.3), y1 = Math.round(h * 0.7);
      const L = (D, i) => 0.2126 * D[i] + 0.7152 * D[i + 1] + 0.0722 * D[i + 2];
      let sum = 0, n = 0; const rows = [];
      for (let y = y0; y < y1; y++) { let rs = 0; for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; const d = L(B, i) - L(A, i); sum += Math.abs(d); rs += d; n++; } rows.push(rs / (x1 - x0)); }
      // striping: how much the AO darkening varies from row to row
      const m = rows.reduce((s, v) => s + v, 0) / rows.length;
      const sd = Math.sqrt(rows.reduce((s, v) => s + (v - m) ** 2, 0) / rows.length);
      return { mean: +(sum / n).toFixed(2), rowSpread: +sd.toFixed(2) };
    }, [on, off]);
    const tag = `${q} ${W}x${H} at ${dist} m`;
    check(`${tag}: AO barely touches open ground (mean ${r.mean}/255, ≤ 4)`, r.mean <= 4, r);
    check(`${tag}: and lays no stripes (row spread ${r.rowSpread}, ≤ 1.5)`, r.rowSpread <= 1.5, r);
  }
  await page.close();
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
