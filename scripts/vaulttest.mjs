// The Asset Vault (PR #7) in the game: the pack of all 4,000 models streams
// in with the art; zoned lots grow vault buildings (shops, homes, yards,
// offices) that fit their lots, carry their family's name and sign, and never
// take a SLOP merch brand's lot; the roadside attractions are in Services >
// Parks, get built, cover their neighbours like parks and come back from a
// save; city services with a vault version wear it (Looks: Classic switches
// them back); the road furniture (gantries, an overpass, pine cell towers, a
// substation, the bus stop to nowhere) stands where it should. Without the pack the town grows as before, the attractions are hidden
// and a saved one stands as a plain park. SHOTS=prefix saves pictures. Exits
// nonzero on failure.
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };
const open = async (blockVault) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (blockVault) await page.route('**/vault/pack.*', (r) => r.abort());
  await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
  await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services && window.__vault, null, { timeout: 180000 });
  return { page, errs };
};

// a town across every zone, grown to the edges
const grow = () => {
  const g = window.__game, d = window.__dbg;
  cancelAnimationFrame(g.raf);
  for (const c of g.communes.list) { c.state = 'gone'; c.group.removeFromParent(); }
  g.syncBlockers();
  g.sim.earn(600000, 'other', 'Test funds');
  const cx = 60, cz = 60;
  for (let k = -3; k <= 3; k++) { d.road(cx - 330, cz + k * 110, cx + 330, cz + k * 110, 'twoLane'); d.road(cx + k * 110, cz - 330, cx + k * 110, cz + 330, 'twoLane'); }
  g.zones.update();
  for (const [z, x, y] of [['resLow', -220, -220], ['resLow', 0, -220], ['comLow', 220, -220], ['comLow', -220, 0], ['industry', 0, 0], ['office', 220, 0], ['resHigh', -220, 220], ['comHigh', 0, 220], ['comLow', 220, 220]]) d.zone(cx + x, cz + y, 100, z);
  const cand = [];
  const t0 = performance.now();
  for (let k = 0; k < 500; k++) for (const z of ['resLow', 'comLow', 'industry', 'office', 'resHigh', 'comHigh']) { g.zones.candidates(z, cand); if (cand.length) g.buildings.tryGrow(z, cand); }
  return performance.now() - t0;
};

const survey = () => {
  const g = window.__game, V = window.__vault;
  const labels = new Set(V.families.map((f) => f.label));
  const merch = new Set(['slop', 'slopLightning', 'slopCannon', 'imagineSupply', 'fillErUp', 'myOwnPropane', 'propaneParadise', 'pigCabana', 'smokeshow', 'smokeSignal', 'badLuckClub', 'cabinetAfterHours', 'neuralFly', 'slop69', 'slopEnergy']);
  const by = {}, fams = new Set(), over = [], broken = [], branded = [];
  let total = 0, vault = 0, merchLots = 0, merchVault = 0;
  for (const b of g.buildings.list.values()) {
    if (b.zone === 'service' || b.zone === 'landmark') continue;
    const v = labels.has(b.label);
    const e = (by[b.zone] ??= { n: 0, vault: 0 });
    e.n++; total++;
    if (b.brand && merch.has(b.brand)) { merchLots++; if (v) merchVault++; }
    if (!v) continue;
    e.vault++; vault++; fams.add(b.label);
    if (b.brand) branded.push({ l: b.label, brand: b.brand });
    const geo = b.model.geometry, pos = geo.getAttribute('position');
    let nan = 0;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) nan++;
    if (nan || pos.count < 150) broken.push({ l: b.label, nan, verts: pos.count });
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (bb.min.x < -b.hw - 0.05 || bb.max.x > b.hw + 0.05 || bb.min.z < -b.hd - 0.05 || bb.max.z > b.hd + 0.05 || bb.min.y < -0.3) over.push({ l: b.label, lot: [b.w, b.d], bb: [bb.min.x, bb.max.x, bb.min.z, bb.max.z].map((x) => +x.toFixed(1)) });
  }
  return { status: V.status(), count: V.count(), total, vault, by, fams: fams.size, over: over.slice(0, 5), overN: over.length, broken: broken.slice(0, 5), branded: branded.slice(0, 5), merchLots, merchVault };
};

// ------------------------------------------------------------------ with the vault
const { page, errs } = await open(false);
const ms = await page.evaluate(grow);
const r = await page.evaluate(survey);
console.log(JSON.stringify(r));
check(`the vault pack streamed in (${r.status}, ${r.count} models)`, r.status === 'ready' && r.count === 4000, r);
const zonesWith = Object.values(r.by).filter((e) => e.vault > 0).length;
check(`zoned lots grow vault buildings (${r.vault} of ${r.total}, in ${zonesWith} zones)`, r.vault / r.total > 0.12 && r.vault / r.total < 0.6 && zonesWith >= 4, r.by);
check(`many different families show up (${r.fams})`, r.fams >= 15, r);
check('every vault building fits its lot', r.overN === 0, r.over);
check('every vault building is whole geometry', r.broken.length === 0, r.broken);
check(`vault buildings don't claim a brand, and the SLOP merch brands keep their lots (${r.merchLots} merch lots, ${r.merchVault} vault)`, r.branded.length === 0 && r.merchVault === 0 && r.merchLots > 0, r);
check(`growing the town stayed quick (${Math.round(ms)} ms for ${r.total} buildings)`, ms / r.total < 25, { ms });

// roadside attractions
const a = await page.evaluate(async () => {
  const g = window.__game, SV = window.__services, d = window.__dbg;
  g.ui.openPanel?.('ext:services');
  document.querySelector('[data-cat="parks"]')?.click();
  await new Promise((res) => setTimeout(res, 200));
  const listed = [...document.querySelectorAll('[data-svc]')].map((e) => e.dataset.svc).filter((id) => id.startsWith('va:'));
  // three beside homes (the nearest free spot that fronts a road)
  const homes = [...g.buildings.list.values()].filter((b) => b.zone === 'resLow');
  const placed = [];
  for (const [k, id] of ['va:worlds-largest-fork', 'va:miracle-twine-ball', 'va:suburban-history-museum'].entries()) {
    let b = null, spot = null;
    for (let t = 0; t < 12 && !b; t++) {
      const h = homes[(k * 17 + t * 5) % homes.length];
      spot = SV.findSpot(g, id, h.x + 20, h.z + 20);
      b = spot && spot.ok !== false ? SV.place(g, id, spot.x, spot.z, spot.yaw) : null;
    }
    if (b) { b.state = 'active'; b.progress = 1; g.buildings.dropScaffold(b); g.buildings.writeMatrix(b, 1); }
    placed.push({ id, ok: !!b, onMain: !!b?.onMain, label: b?.label ?? spot?.reason });
  }
  d.run(3);
  // coverage: buildings around the attractions
  const S = SV.S;
  const attr = [...g.buildings.list.values()].filter((b) => b.kind?.startsWith('va:'));
  const near = [...g.buildings.list.values()].filter((b) => b.zone !== 'service' && attr.some((a) => Math.hypot(b.x - a.x, b.z - a.z) < 50));
  const covered = near.filter((b) => (S.b.get(b.id)?.cov.parks ?? 0) > 0).length;
  // a saved one comes back the way a load rebuilds it
  const re = g.buildings.placeCustom('va:roadside-cross', 60 + 250, 60 + 330 + 30, 0);
  return { listed: listed.length, placed, near: near.length, covered, restored: re ? { label: re.label, onMain: !!re.onMain } : null };
});
console.log(JSON.stringify(a));
check(`Services > Parks lists the ${a.listed} roadside attractions`, a.listed === 16, a);
check('they get built, as vault models', a.placed.every((p) => p.ok && p.onMain), a.placed);
check(`they cover their neighbours like a park (${a.covered}/${a.near} nearby buildings)`, a.near > 0 && a.covered > 0, a);
check(`a saved one comes back (${a.restored?.label})`, a.restored?.label === 'Two-Hundred-Foot Roadside Cross' && a.restored.onMain, a.restored);
// city services in their vault versions, and the Looks toggle
const sv = await page.evaluate(async () => {
  const g = window.__game, SV = window.__services;
  const out = {};
  const lots = [...g.buildings.list.values()].filter((b) => b.zone === 'industry' || b.zone === 'comLow');
  for (const [k, id] of ['coalPlant', 'wellTower', 'fireStation', 'clinic'].entries()) {
    let b = null, spot = null;
    for (let t = 0; t < 16 && !b; t++) {
      const h = lots[(k * 23 + t * 7) % lots.length];
      spot = SV.findSpot(g, id, h.x + 30, h.z - 30);
      b = spot && spot.ok !== false ? SV.place(g, id, spot.x, spot.z, spot.yaw) : null;
    }
    if (b) { b.state = 'active'; b.progress = 1; g.buildings.dropScaffold(b); g.buildings.writeMatrix(b, 1); }
    out[id] = b ? { main: !!b.onMain, smoke: b.model.emitters.filter((e) => e.kind === 'smoke').length, label: b.label } : { why: spot?.reason };
  }
  g.ui.openPanel?.('ext:services');
  await new Promise((r) => setTimeout(r, 150));
  const lookChip = !!document.querySelector('[data-look="vault"].on');
  document.querySelector('[data-look="classic"]')?.click();
  await new Promise((r) => setTimeout(r, 150));
  const services = () => [...g.buildings.list.values()].filter((b) => b.zone === 'service' && ['coalPlant', 'wellTower', 'fireStation', 'clinic'].includes(b.kind));
  const classic = services().every((b) => !b.onMain) && services().find((b) => b.kind === 'coalPlant')?.model.emitters.length > 0;
  document.querySelector('[data-look="vault"]')?.click();
  await new Promise((r) => setTimeout(r, 150));
  const back = services().every((b) => b.onMain);
  return { out, lookChip, classic, back, n: services().length };
});
console.log(JSON.stringify(sv));
check('services with a vault version wear it (coal plant, water tower, fire station, urgent care), keeping their names', Object.values(sv.out).every((o) => o.main) && sv.out.coalPlant?.label === 'Clean Coal™ Plant', sv.out);
check(`the coal plant's stacks still smoke (${sv.out.coalPlant?.smoke})`, sv.out.coalPlant?.smoke > 0, sv.out);
check('Services > Looks switches every one to Classic and back, live', sv.lookChip && sv.classic && sv.back && sv.n === 4, sv);
// road furniture: a stroad through shops, a dead end, the map's own highway, the coal plant above
const sc = await page.evaluate(() => {
  const g = window.__game, d = window.__dbg;
  const cx = 60, cz = 60 + 430;
  d.road(cx - 330, cz, cx + 330, cz, 'stroad4');
  d.road(cx + 200, cz, cx + 200, cz + 150, 'twoLane'); // a dead end
  g.zones.update();
  d.zone(cx - 120, cz + 30, 70, 'comLow'); d.zone(cx - 120, cz - 30, 70, 'comLow');
  const cand = [];
  for (let k = 0; k < 150; k++) { g.zones.candidates('comLow', cand); if (cand.length) g.buildings.tryGrow('comLow', cand); }
  g.sim.population = 400; // bus depots unlock at 300
  let depot = false;
  for (const [dx, dz] of [[60, 25], [60, -25], [120, 25], [120, -25], [260, 25], [260, -25], [-280, 25]]) if (!depot) depot = g.transit.placeDepot(cx + dx, cz + dz);
  for (const b of g.buildings.list.values()) if (b.kind === 'busDepot') { b.state = 'active'; b.progress = 1; }
  for (let i = 0; i < 80; i++) g.frame(0.05, false);
  const V = g.vaultScenery, items = V.items;
  const segs = [...g.net.segs.values()];
  // gantries run across their road: the model's span (x) along the road's normal
  const across = items.filter((i) => i.family === 'express-lane-gantry').every((i) => {
    let best = null, bd = Infinity;
    for (const s of segs) for (let k = 0; k + 1 < s.samp.pts.length; k++) { const p = s.samp.pts[k], dd = Math.hypot(p.x - i.x, p.z - i.z); if (dd < bd) { bd = dd; best = { s, k }; } }
    const a = best.s.samp.pts[best.k], b = best.s.samp.pts[best.k + 1];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz);
    const sx = Math.cos(i.yaw), sz = -Math.sin(i.yaw);
    return bd < 2 && Math.abs((sx * tx + sz * tz) / tl) < 0.1;
  });
  // standing things keep off buildings and out of the water
  const clash = items.filter((i) => ['frankenpine-cell-tower', 'bus-stop-nowhere', 'grid-substation', 'fiber-hut', 'transit-token-kiosk'].includes(i.family)).filter((i) =>
    g.terrain.h(i.x, i.z) < 0.3 || [...g.buildings.list.values()].some((b) => Math.abs(b.x - i.x) < b.hw && Math.abs(b.z - i.z) < b.hd)).map((i) => i.family);
  return { counts: V.counts, across, clash, depot, meshes: V.group.children.filter((m) => m.visible).length };
});
console.log(JSON.stringify(sc));
const c = sc.counts;
check(`road furniture: ${c['express-lane-gantry'] ?? 0} express-lane gantries, ${c['pedestrian-overpass'] ?? 0} overpass, ${c['frankenpine-cell-tower'] ?? 0} pine cell towers, ${c['grid-substation'] ?? 0} substation, ${c['bus-stop-nowhere'] ?? 0} bus stop to nowhere, ${c['fiber-hut'] ?? 0} fiber huts, ${c['transit-token-kiosk'] ?? 0} token kiosk`,
  ['express-lane-gantry', 'pedestrian-overpass', 'frankenpine-cell-tower', 'grid-substation', 'bus-stop-nowhere', 'fiber-hut', 'transit-token-kiosk'].every((k) => c[k] > 0) && sc.meshes > 0, sc);
check('gantries span their roads, and nothing stands in a building or the water', sc.across && sc.clash.length === 0, sc);
if (process.env.SHOTS) {
  for (const [i, v] of [[60 + 220, 60 - 220, 120, 0.7, 0.5], [60 - 110, 60 - 220, 120, 2.2, 0.5], [60 - 240, 60 - 96, 90, 0.4, 0.45], [60, 60, 130, 3.6, 0.55]].entries()) {
    await page.evaluate((v) => { const g = window.__game; document.querySelector('.hud').style.visibility = 'hidden'; for (const b of g.buildings.list.values()) { b.state = 'active'; b.progress = 1; g.buildings.dropScaffold(b); g.buildings.writeMatrix(b, 1); } g.hour = 15; g.rts.setView(v[0], v[1], v[2], v[3], v[4], true); for (let k = 0; k < 12; k++) g.frame(0.05, false); g.frame(0.016, true); }, v);
    await page.screenshot({ path: `${process.env.SHOTS}-${i}.png`, timeout: 240000 });
  }
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await page.close();

// ------------------------------------------------------------------ without it
const off = await open(true);
await off.page.evaluate(grow);
const f = await off.page.evaluate(survey);
const fa = await off.page.evaluate(async () => {
  const g = window.__game;
  g.ui.openPanel?.('ext:services');
  document.querySelector('[data-cat="parks"]')?.click();
  await new Promise((res) => setTimeout(res, 200));
  const listed = [...document.querySelectorAll('[data-svc]')].map((e) => e.dataset.svc).filter((id) => id.startsWith('va:')).length;
  const re = g.buildings.placeCustom('va:worlds-largest-fork', 60 + 250, 60 + 330 + 30, 0);
  return { listed, restored: re ? { label: re.label, onMain: !!re.onMain } : null };
});
console.log(JSON.stringify({ ...f, ...fa }));
check(`without the pack the town grows as before (${f.status}: ${f.total} buildings, ${f.vault} vault)`, f.status === 'failed' && f.vault === 0 && f.total > 100, f);
check('the attractions are hidden, and a saved one stands as a plain park', fa.listed === 0 && fa.restored && !fa.restored.onMain, fa);
check('no page errors without it', off.errs.length === 0, off.errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
