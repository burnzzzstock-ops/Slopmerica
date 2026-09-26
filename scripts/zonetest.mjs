// Zoning says what it did: a brush stroke reports the lots it zoned and the
// lots it refused, by reason (outside your land, zoned something else), and
// whether builders want that zone right now. The overlay dims zoned lots
// that are waiting for demand. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=norcal&mode=ponzi`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

// a street along the edge of the land a Ponzi city owns (owned north of it, not south)
const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg, t = g.tools, S = g.startView();
  cancelAnimationFrame(g.raf);
  d.road(S.x - 160, S.z + 40, S.x + 160, S.z + 40, 'twoLane');
  g.zones.update();
  const ev = (type) => ({ button: 0, pointerType: 'mouse', timeStamp: performance.now(), type });
  const V = g.camera.position.constructor;
  const stroke = (zone, pts) => {
    t.zoneType = zone; t.brush = 1; t.set('zone');
    const P = pts.map(([x, z]) => new V(x, g.terrain.h(x, z), z));
    t.down(P[0], ev('pointerdown'));
    for (const p of P.slice(1)) t.move(p, ev('pointermove'), true);
    t.up(P[P.length - 1], ev('pointerup'), true);
    const toasts = [...document.querySelectorAll('.toasts .toast')];
    return toasts[toasts.length - 1]?.textContent ?? '';
  };
  // shops on the west end first
  const shops = stroke('comLow', [[S.x - 120, S.z + 40], [S.x - 90, S.z + 40]]);
  // then homes along the whole street, both sides: the south side isn't ours, the west end is shops
  const homes = stroke('resLow', [[S.x - 140, S.z + 40], [S.x - 60, S.z + 40], [S.x + 20, S.z + 40], [S.x + 100, S.z + 40], [S.x + 140, S.z + 40]]);
  // the overlay: zoned lots dim while their zone waits for demand
  g.sim.demand.res = -20;
  g.zones.markOverlayDirty(); g.zones.update();
  const m = g.zones.overlayMesh;
  const shade = () => { const a = m.instanceColor.array; let n = 0, dim = 0; for (let i = 0; i < m.count; i++) { n++; if (a[i * 3] < 0.5 && a[i * 3 + 1] < 0.5) dim++; } return { n, dim }; };
  const dimRes = shade();
  g.sim.demand.res = 40;
  g.zones.markOverlayDirty(); g.zones.update();
  const brightRes = shade();
  return { shops, homes, dimRes, brightRes };
});
check(`a stroke says what it zoned ("${r.shops}")`, /^Zoned \d+ lots? Strip Mall \(Low Com\)/.test(r.shops) && /(builders want it|waiting for demand) \(C /.test(r.shops), r.shops);
check(`and what it refused, by reason ("${r.homes}")`, /^Zoned \d+ lots? /.test(r.homes) && /\d+ outside your land \(buy it in 🏞️ Land\)/.test(r.homes) && /\d+ already zoned something else \(Dezone first\)/.test(r.homes), r.homes);
check(`zoned lots dim while waiting for demand (${r.dimRes.dim}/${r.dimRes.n} dim at R −20, ${r.brightRes.dim}/${r.brightRes.n} at R +40)`, r.dimRes.dim > r.brightRes.dim, r);
// clicking an empty zoned lot says why nothing has grown there
const lot = await page.evaluate(() => {
  const g = window.__game;
  const cells = [...g.zones.cells.values()].filter((c) => c.valid && c.zone === 'resLow' && !c.bld);
  const front = cells.find((c) => c.row === 0), back = cells.find((c) => c.row > 0);
  const text = (cell) => { g.select({ kind: 'lot', cell }); g.ui.update(0.3); return document.querySelector('.inspector')?.textContent ?? ''; };
  g.sim.demand.res = -20;
  const waiting = text(front);
  document.querySelector('#in-why')?.click();
  const card = document.querySelector('.demand-pop') && !document.querySelector('.demand-pop').hidden ? document.querySelector('.dp-name')?.textContent : null;
  g.sim.demand.res = 40;
  const inLine = text(front);
  const backLot = back ? text(back) : 'no back lot';
  return { waiting, card, inLine, backLot };
});
check(`a lot waiting for demand says so ("${lot.waiting.slice(0, 90)}")`, /Waiting for demand\. R demand is -20; builders start at \+5/.test(lot.waiting), lot.waiting);
check(`and its "why?" button opens the Residential demand card (${lot.card})`, lot.card === 'Residential', lot.card);
check(`a lot with demand says it's in line ("${lot.inLine.slice(0, 120)}")`, /In line\. Builders want this zone \(R \+40\) and start about [\d.]+ buildings a day across \d+ empty/.test(lot.inLine), lot.inLine);
check(`a back lot says only street-front lots start buildings`, /Back lot\. Only lots facing the street/.test(lot.backLot), lot.backLot);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
