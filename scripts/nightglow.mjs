// Night keeps lights as lights: a close night street and a wide night view
// during wildfire smoke. Measures blown-out pixels (lamps blooming into white
// discs, review F2 at 02:55) and bright amber specks over open country
// (embers, 08:45), and that the town stays readable (mean brightness).
// Exits nonzero on failure. `--shots` saves the frames to /tmp.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shots = process.argv.includes('--shots');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'high'); localStorage.setItem('slopmerica.onboarded', '1'); });
await page.goto(`${base}/#skip&map=norcal&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  cancelAnimationFrame(g.raf);
  document.querySelector('.hud').style.visibility = 'hidden';
  d.road(S.x - 150, S.z + 60, S.x + 150, S.z + 60, 'twoLane');
  d.road(S.x, S.z - 60, S.x, S.z + 200, 'twoLane');
  d.zone(S.x - 70, S.z + 90, 60, 'resLow'); d.zone(S.x + 70, S.z + 90, 60, 'comLow');
  g.sim.demand.res = 80; g.sim.demand.com = 80;
  d.run(30);
  window.__S = S;
});
const stats = async (setup) => {
  await page.evaluate(setup);
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (png) => {
    const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + png; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const D = x.getImageData(0, 0, im.width, im.height).data;
    let white = 0, amber = 0, sum = 0; const n = D.length / 4;
    for (let i = 0; i < D.length; i += 4) {
      const r = D[i], g = D[i + 1], b = D[i + 2], L = 0.2126 * r + 0.7152 * g + 0.0722 * b; sum += L;
      if (r > 235 && g > 235 && b > 220) white++;
      if (r > 170 && r > g * 1.3 && g > b * 1.4 && L > 110) amber++;
    }
    return { whitePct: +(white / n * 100).toFixed(2), amberPct: +(amber / n * 100).toFixed(2), mean: +(sum / n).toFixed(1) };
  }, png);
};
const street = await stats(() => { const g = window.__game, S = window.__S; g.weather.force('clear', 30); g.hour = 22.5; g.rts.setView(S.x, S.z + 80, 90, 0.5, 0.75, true); for (let i = 0; i < 30; i++) g.frame(0.05, false); g.frame(0.016, true); window.__dbgNight = { night: g.env.night, hour: g.hour, elev: g.env.sunElevation, speed: g.sim.speed }; });
console.log('street state', JSON.stringify(await page.evaluate(() => window.__dbgNight)));
if (shots) await page.screenshot({ path: '/tmp/nightglow-street.png' });
const noon = await stats(() => { const g = window.__game, S = window.__S; g.weather.force('clear', 30); g.hour = 12.5; g.rts.setView(S.x, S.z + 80, 90, 0.5, 0.75, true); for (let i = 0; i < 30; i++) g.frame(0.05, false); g.frame(0.016, true); });
const wide = await stats(() => { const g = window.__game, S = window.__S; g.weather.force('wildfireSmoke', 30); g.hour = 22; g.rts.setView(S.x, S.z + 80, 1500, 0.5, 0.95, true); for (let i = 0; i < 40; i++) g.frame(0.05, false); g.frame(0.016, true); });
if (shots) await page.screenshot({ path: '/tmp/nightglow-wide.png' });
check(`close night street: under 0.5% of the frame blown to white (${street.whitePct}%), town readable (mean ${street.mean})`, street.whitePct < 0.5 && street.mean > 18, street);
check(`night reads as night: the street at ${street.mean} vs ${noon.mean} at noon (under 70%)`, street.mean < noon.mean * 0.7, { street, noon });
check(`wide night view in wildfire smoke: under 0.3% bright amber specks (${wide.amberPct}%)`, wide.amberPct < 0.3, wide);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
