// Civic Foundry in the game: the asset pack streams in, commercial streets
// get street trees in grates, benches, bike racks and planters, homes get
// street trees on the verge, bus stops get the library's shelter (and the
// box shelter steps aside), and it all draws as instanced LODs. Low keeps
// about half the sites with vertex-coloured LOD2. SHOTS=prefix saves pictures.
import { launch } from './lib/browser.mjs';
import { seededInit, seededRandom } from './refblock.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await launch();
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const open = async (quality) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(seededInit, { seed: Number(process.env.SEED ?? 271828), rng: seededRandom.toString() });
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
  // the town goes on the town site (flat, dry and roomy by construction), where the county road ends
  const S = g.startView(), cx = Math.round(S.x), cz = Math.round(S.z);
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
  g.rts.setView(cx, cz, 420, undefined, undefined, true);
  for (let i = 0; i < 80; i++) g.frame(0.05, i % 10 === 0);
  const c = g.civic;
  const meshes = c.group.children.filter((m) => m.visible && m.count > 0);
  const shelters = [...t.renderer.group.children].filter((n) => n.userData.stopId !== undefined);
  return {
    cx, cz, status: c.status, counts: c.counts, visibleMeshes: meshes.length, instances: meshes.reduce((a, m) => a + m.count, 0),
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
  const { cx, cz } = r;
  for (const [i, v] of [[cx - 55, cz - 110 + 12, 38, 0.4, 0.42], [cx + 30, cz + 4, 30, 2.6, 0.35], [cx + 55, cz + 110 - 12, 45, 3.6, 0.5]].entries()) {
    await page.evaluate((v) => { const g = window.__game; document.querySelector('.hud').style.visibility = 'hidden'; g.rts.setView(v[0], v[1], v[2], v[3], v[4], true); for (let k = 0; k < 12; k++) g.frame(0.05, false); g.frame(0.016, true); }, v);
    await page.screenshot({ path: `${process.env.SHOTS}-${i}.png`, timeout: 240000 });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
const switched = await page.evaluate(({ cx, cz }) => {
  const g = window.__game, c = g.civic;
  const propCount = () => Object.entries(c.counts).reduce((n, [id, count]) => n + (id === 'street-bus-shelter' ? 0 : count), 0);
  g.sim.speed = 0;
  const full = propCount();
  g.rts.setView(cx, cz, 75, 2.4, 0.42, true);
  g.frame(0.016);
  g.requestQuality('low');
  c.update(2);
  const reduced = propCount();
  const meshes = c.group.children.filter(m => m.visible && m.count);
  const cheap = meshes.length > 0 && meshes.every(m => m.name.endsWith('-lod2') && !m.castShadow && !m.material.map);
  const allStops = c.counts['street-bus-shelter'] === g.transit.stops.size;
  g.requestQuality('high');
  c.update(2);
  return { full, reduced, ratio: reduced / full, cheap, allStops, restored: propCount() };
}, r);
check('live Low keeps approximately half the same street sites', switched.ratio > 0.25 && switched.ratio < 0.75, switched);
check('Low uses vertex-coloured LOD2 and skips furniture shadow draws', switched.cheap, switched);
check('all stops retain their shelter at Low', switched.allStops, switched);
check('switching back restores all high-detail sites', switched.full === switched.restored, switched);
await page.close();

const low = await open('low');
await low.page.waitForFunction(() => window.__game.civic.status !== 'loading', null, { timeout: 60000 });
const lr = await low.page.evaluate(() => ({
  status: window.__game.civic.status,
  textures: performance.getEntriesByType('resource').filter(e => e.name.includes('/civic/textures/')).length,
}));
check('Low streams geometry with zero civic texture requests', lr.status === 'ready' && lr.textures === 0, lr);
await browser.close();
process.exit(bad ? 1 : 0);
