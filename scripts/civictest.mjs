// Civic Foundry in the game: the asset pack streams in, commercial streets
// get street trees in grates, benches, bike racks and planters, homes get
// street trees on the verge, bus stops get the library's shelter (and the
// box shelter steps aside), and it all draws as instanced LODs. Low quality
// never loads it. SHOTS=prefix saves pictures. Exits nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const open = async (quality) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((q) => { localStorage.setItem('slopmerica.quality', q); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); }, quality);
  await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game?.transit && window.__dbg, null, { timeout: 180000 });
  return { page, errs };
};

const { page, errs } = await open('high');
await page.waitForFunction(() => window.__game.civic.status !== 'loading', null, { timeout: 60000 });
const r = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  for (let k = -1; k <= 1; k++) { d.road(cx - 200, cz + k * 110, cx + 200, cz + k * 110, 'twoLane'); d.road(cx + k * 110, cz - 200, cx + k * 110, cz + 200, 'twoLane'); }
  g.zones.update();
  d.zone(cx - 55, cz - 55, 50, 'comLow'); d.zone(cx + 55, cz + 55, 50, 'resLow'); d.zone(cx + 55, cz - 55, 50, 'comLow'); d.zone(cx - 55, cz + 55, 50, 'resLow');
  const cand = [];
  for (let k = 0; k < 120; k++) for (const z of ['comLow', 'resLow']) { g.zones.candidates(z, cand); if (cand.length) g.buildings.tryGrow(z, cand); }
  for (const b of g.buildings.list.values()) { b.state = 'active'; b.progress = 1; g.buildings.dropScaffold(b); g.buildings.writeMatrix(b, 1); }
  g.sim.population = 400;
  const t = g.transit;
  t.placeDepot(cx + 230, cz + 25);
  for (const b of g.buildings.list.values()) if (b.kind === 'busDepot') { b.state = 'active'; b.progress = 1; }
  [[cx - 80, cz], [cx + 30, cz], [cx + 80, cz]].forEach(([x, z]) => t.addDraftPoint(x, z + 6));
  t.finishDraft();
  g.hour = 14;
  for (let i = 0; i < 80; i++) g.frame(0.05, i % 10 === 0);
  const c = g.civic;
  const meshes = c.group.children.filter((m) => m.visible && m.count > 0);
  const shelters = [...t.renderer.group.children].filter((n) => n.userData.stopId !== undefined);
  return {
    status: c.status, counts: c.counts, visibleMeshes: meshes.length, instances: meshes.reduce((a, m) => a + m.count, 0),
    boxShelterHidden: shelters.length > 0 && shelters.every((n) => n.getObjectByName('box-shelter')?.visible === false), stops: t.stops.size,
    tris: g.renderer.info.render.triangles,
  };
});
console.log(JSON.stringify(r));
check(`the Civic Foundry pack streamed in (${r.status})`, r.status === 'ready', r);
const trees = Object.entries(r.counts).filter(([k]) => k.startsWith('tree-')).reduce((a, [, v]) => a + v, 0);
const furniture = ['street-bench-slat', 'street-bike-rack', 'street-newspaper-boxes', 'planter-raised-urban', 'street-bollard-row', 'street-tree-grate'].reduce((a, k) => a + (r.counts[k] ?? 0), 0);
check(`street trees line the blocks (${trees})`, trees >= 20, r.counts);
check(`shop streets get benches, bike racks, papers, planters, grates (${furniture})`, furniture >= 15, r.counts);
check(`every bus stop gets the library's shelter (${r.counts['street-bus-shelter'] ?? 0} for ${r.stops} stops), the box one steps aside`, (r.counts['street-bus-shelter'] ?? 0) === r.stops && r.stops > 0 && r.boxShelterHidden, r);
check(`it draws as instanced LODs (${r.visibleMeshes} meshes, ${r.instances} instances)`, r.visibleMeshes > 5 && r.instances > 40, r);
if (process.env.SHOTS) {
  for (const [i, v] of [[60 - 55, 60 - 110 + 12, 38, 0.4, 0.42], [60 + 30, 60 + 4, 30, 2.6, 0.35], [60 + 55, 60 + 110 - 12, 45, 3.6, 0.5]].entries()) {
    await page.evaluate((v) => { const g = window.__game; document.querySelector('.hud').style.visibility = 'hidden'; g.rts.setView(v[0], v[1], v[2], v[3], v[4], true); for (let k = 0; k < 12; k++) g.frame(0.05, false); g.frame(0.016, true); }, v);
    await page.screenshot({ path: `${process.env.SHOTS}-${i}.png`, timeout: 240000 });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await page.close();

const low = await open('low');
const lr = await low.page.evaluate(async () => { await new Promise((res) => setTimeout(res, 1500)); return window.__game.civic.status; });
check(`low quality never loads it (${lr})`, lr === 'off', lr);
await browser.close();
process.exit(bad ? 1 : 0);
