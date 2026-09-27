// A dense town of every house style and level, forced to grow: measures the
// cost of fifty-odd house styles and the satire props (model generation,
// unique geometry in the building batch, frame time) and screenshots a
// street. SHOTS=prefix saves pictures. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'medium'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const cx = 60, cz = 60, N = 5, step = 96;
  for (let k = 0; k <= N; k++) {
    d.road(cx - 20, cz + k * step, cx + N * step + 20, cz + k * step, 'twoLane');
    d.road(cx + k * step, cz - 20, cx + k * step, cz + N * step + 20, 'twoLane');
  }
  g.zones.update();
  const zoneAt = (x, z, zone) => d.zone(x, z, 40, zone);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const zone = (i + j) % 5 === 4 ? 'comLow' : (i * j) % 7 === 3 ? 'industry' : 'resLow';
    zoneAt(cx + i * step + step / 2, cz + j * step + step / 2, zone);
  }
  window.__genMs = 0;
  const t0 = performance.now();
  const cand = [];
  let grown = 0;
  for (let k = 0; k < 900; k++) {
    for (const z of ['resLow', 'resLow', 'resLow', 'comLow', 'industry']) {
      g.zones.candidates(z, cand);
      if (cand.length && g.buildings.tryGrow(z, cand)) grown++;
    }
  }
  // every level: walk each building up a random number of levels
  let ups = 0;
  for (const b of g.buildings.list.values()) {
    if (b.zone === 'landmark' || b.zone === 'service') continue;
    const n = Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) { g.buildings.levelUp(b); ups++; }
    b.state = 'active'; b.progress = 1;
    g.buildings.dropScaffold(b);
    g.buildings.writeMatrix(b, 1);
  }
  for (let i = 0; i < 30; i++) g.frame(0.05, false);
  const genTotal = window.__genMs;
  const growMs = performance.now() - t0;
  const main = g.buildings.main;
  const labels = new Map();
  for (const b of g.buildings.list.values()) if (b.zone === 'resLow') labels.set(b.label, (labels.get(b.label) ?? 0) + 1);
  // frame time with everything in view
  g.hour = 15;
  g.rts.setView(cx + (N * step) / 2, cz + (N * step) / 2, 420, 0.8, 0.9, true);
  for (let i = 0; i < 5; i++) g.frame(0.016, true);
  const f0 = performance.now();
  for (let i = 0; i < 10; i++) g.frame(0.016, true);
  const frameMs = (performance.now() - f0) / 10;
  const info = g.renderer.info;
  return {
    bld: g.buildings.list.size, grown, ups, genTotal: Math.round(genTotal), growMs: Math.round(growMs),
    uniqueGeo: g.buildings.geoIds.size, batchVerts: main.usedVerts, batchMB: +((main.usedVerts * 44) / 2 ** 20).toFixed(1),
    houseLabels: labels.size, homes: [...labels.values()].reduce((a, b) => a + b, 0), frameMs: +frameMs.toFixed(1), tris: info.render.triangles, calls: info.render.calls,
  };
});
console.log(JSON.stringify(r));
check(`a town grew (${r.bld} buildings, ${r.ups} level-ups)`, r.bld > 150, r);
check(`homes come in many styles (${r.houseLabels} names across ${r.homes} homes)`, r.houseLabels >= 40, r);
check(`model generation stays cheap (${r.genTotal} ms for ${r.uniqueGeo} unique models)`, r.genTotal / Math.max(1, r.uniqueGeo) < 12, r);
check(`the building batch stays within budget (${r.batchVerts} verts, ~${r.batchMB} MB)`, r.batchMB < 160, r);
if (process.env.SHOTS) {
  for (const [i, v] of [[60 + 96 * 1.5, 60 + 96 * 1.5, 70, 0.7, 0.55], [60 + 96 * 2.5, 60 + 96 * 0.5, 55, 2.2, 0.45], [60 + 96 * 0.5, 60 + 96 * 3.5, 60, 4, 0.5]].entries()) {
    await page.evaluate((v) => { const g = window.__game; document.querySelector('.hud').style.visibility = 'hidden'; g.rts.setView(v[0], v[1], v[2], v[3], v[4], true); for (let k = 0; k < 12; k++) g.frame(0.05, false); g.frame(0.016, true); }, v);
    await page.screenshot({ path: `${process.env.SHOTS}-${i}.png`, timeout: 240000 });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
