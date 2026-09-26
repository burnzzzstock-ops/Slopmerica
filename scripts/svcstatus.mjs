// Services read as choices: each category says whether it's covered by your
// own buildings, by a paid fallback (imports, the county contract), or short;
// what the fallback costs per week; and what the cheapest local building
// would save. The line follows the city while the panel stays open (the
// recording showed "130 kL/day" frozen while the town grew 142 → 243).
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.edgeScroll', '0'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  // a cross street off Old County Road (which runs to the highway), inside
  // the land a Ponzi city starts with (north of the town centre)
  const S = g.startView();
  d.road(S.x, S.z - 100, S.x - 200, S.z - 100, 'twoLane');
  d.road(S.x, S.z - 100, S.x + 200, S.z - 100, 'twoLane');
  d.zone(S.x - 100, S.z - 70, 50, 'resLow');
  d.zone(S.x + 100, S.z - 70, 50, 'resLow');
  d.zone(S.x - 100, S.z - 130, 40, 'comLow');
  d.run(12);
});
const line = () => page.evaluate(() => { const g = window.__game; g.ui.refreshNow(); return document.querySelector('.svc-live')?.textContent ?? ''; });
await page.click('button.tbtn[data-t="ext:services"]');
await page.click('[data-cat="water"]');
const w1 = await line();
check(`water: supplied by imports, with the weekly price ("${w1.slice(0, 110)}…")`, /Everyone supplied · \d+% imported/.test(w1) && /imported [\d,]+ kL\/day \(\$[\d,]+\/wk/.test(w1), w1);
check('water: compares the cheapest local option', /A Groundwater Well Tower \(\$7,000 \+ \$30\/wk\) makes 800 kL\/day: (saves about|costs about)/.test(w1), w1);
const need1 = Number((w1.match(/Needed ([\d,]+) kL/) || [])[1]?.replace(/,/g, ''));
// the city grows while the panel stays open
await page.evaluate(() => window.__dbg.run(14));
const w2 = await line();
const need2 = Number((w2.match(/Needed ([\d,]+) kL/) || [])[1]?.replace(/,/g, ''));
check(`the open panel follows the city (needed ${need1} → ${need2} kL/day)`, need2 > need1, { need1, need2 });
await page.click('[data-cat="garbage"]');
const gb = await line();
check(`garbage: the county contract is a paid fallback ("${gb.slice(0, 100)}…")`, /county contract [\d.]+ t\/day \(\$[\d,]+\/wk/.test(gb) && /(All trash handled|piling up)/.test(gb), gb);
await page.click('[data-cat="fire"]');
const fire = await line();
check(`fire: no coverage says what that risks ("${fire}")`, /No fire coverage yet/.test(fire) && /catch fire/.test(fire), fire);
const card = await page.evaluate(() => document.querySelector('[data-svc="fireStation"] small')?.textContent ?? '');
check(`cards say what a building does (${card})`, /\$12,000 · \$80\/wk · [\d.]+ min reach/.test(card), card);
// bulldoze the county road just outside town: the homes lose their route to the highway
await page.click('[data-cat="water"]');
const cut = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, S = g.startView();
  // the Old County Road segment that meets the cross street, on the highway side
  // (the highway is at the south edge: lower z)
  const segs = [...g.net.segs.values()];
  const cross = segs.filter((sg) => sg.type === 'twoLane');
  let seg = null;
  for (const o of segs.filter((sg) => sg.name === 'Old County Road')) for (const c of cross) {
    const shared = [o.a, o.b].find((n) => n === c.a || n === c.b);
    if (shared === undefined) continue;
    const pts = o.samp.pts, here = o.a === shared ? pts[0] : pts[pts.length - 1], other = o.a === shared ? pts[pts.length - 1] : pts[0];
    if (other.z < here.z) seg = o;
  }
  if (!seg) return 'no segment';
  g.bulldozeRoad(seg);
  d.run(3);
  return 'ok';
});
const w3 = await line();
check(`cut off from the highway, the line says why and what fixes it ("${w3.slice(0, 130)}…")`, cut === 'ok' && /cut off: .*no route to the highway, where imports come in/.test(w3) && !/import limit/.test(w3) && /connect those roads to the highway/.test(w3), { cut, w3 });
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
