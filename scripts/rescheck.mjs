// What resolution the game actually renders at: the canvas's drawing buffer
// against its displayed size and the screen's pixel ratio, over time (dynamic
// resolution lowers it when frames are slow). Defaults to the playtest's
// screen: 1268x595 CSS px at 2x. Usage: node scripts/rescheck.mjs [quality...]
// (W=, H=, DPR=, SECONDS=). Prints a table; exits nonzero on page errors.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const W = Number(process.env.W || 1268), H = Number(process.env.H || 595), DPR = Number(process.env.DPR || 2), SECONDS = Number(process.env.SECONDS || 14);
const qs = process.argv.slice(2).length ? process.argv.slice(2) : ['low', 'high', 'ultra'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let errs = 0;
for (const q of qs) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  page.on('pageerror', () => errs++);
  await page.addInitScript((q) => { localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); }, q);
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
  const rows = [];
  for (let t = 0; t < SECONDS; t += 2) {
    await page.waitForTimeout(2000);
    rows.push(await page.evaluate(() => {
      const g = window.__game, c = g.renderer.domElement;
      const want = c.clientWidth * devicePixelRatio;
      return { t: Math.round(performance.now() / 1000), css: `${c.clientWidth}x${c.clientHeight}`, dpr: devicePixelRatio, pr: +g.renderer.getPixelRatio().toFixed(2), buffer: `${c.width}x${c.height}`, share: Math.round((c.width / want) * 100), dyn: +g.perf.resolution.toFixed(2), fps: +g.perf.fps.toFixed(1), post: g.post.active };
    }));
  }
  console.log(`\n${q}  (screen ${W}x${H} CSS @ ${DPR}x = ${W * DPR}x${H * DPR} device px)`);
  for (const r of rows) console.log(`  buffer ${r.buffer.padEnd(10)} = ${String(r.share).padStart(3)}% of the screen's pixels · pixelRatio ${r.pr} (dynamic ${r.dyn}) · ${r.fps} fps${r.post ? ' · post' : ''}`);
  await page.close();
}
await browser.close();
process.exit(errs ? 1 : 0);
