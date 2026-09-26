// Long soak: build a full town with services, run a simulated year in ponzi
// mode, bulldoze and upgrade mid-run, save/continue, and flag anything odd
// (page errors, NaN/Infinity state, runaway counts, heap or GPU leaks).
// usage: node scripts/soak.mjs [map] [days]
import { chromium } from 'playwright-core';
const map = process.argv[2] || 'norcal';
const DAYS = Number(process.argv[3]) || 360;
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 300)); });
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=${map}&mode=ponzi`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });

// shared in-page helpers (reinstalled after the save/continue reload)
const install = () => {
  const g = window.__game;
  cancelAnimationFrame(g.raf);
  window.__soak = {
    check() {
      const bad = [];
      const fin = (v, n) => { if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${n}=${v}`); };
      const s = g.sim;
      fin(s.money, 'money'); fin(s.population, 'pop'); fin(s.day, 'day');
      for (const [k, v] of Object.entries(s.demand ?? {})) fin(v, 'demand.' + k);
      fin(s.weeklyNet(), 'weeklyNet');
      let nb = 0;
      for (const b of g.buildings.list.values()) {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) { nb++; if (nb < 3) bad.push(`bld ${b.id} pos ${b.x},${b.y},${b.z}`); }
        if (!Number.isFinite(b.occ) || b.occ < 0 || b.occ > b.cap + 1e-6) { nb++; if (nb < 6) bad.push(`bld ${b.id} ${b.kind} occ ${b.occ}/${b.cap}`); }
      }
      for (const seg of g.net.segs.values()) {
        const c = seg.curve;
        for (const p of [c.p0, c.p1, c.p2, c.p3]) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { bad.push(`seg ${seg.id} NaN`); break; }
      }
      return bad;
    },
    snap(label) {
      const s = g.sim, SV = window.__services, sv = SV.snapshot();
      const st = {};
      for (const b of g.buildings.list.values()) st[b.state] = (st[b.state] ?? 0) + 1;
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
      const info = g.renderer.info;
      return {
        label, day: Math.round(s.day), pop: s.population, money: Math.round(s.money), net: Math.round(s.weeklyNet()),
        bld: g.buildings.list.size, st, segs: g.net.segs.size, cars: g.traffic.count, peds: g.peds.count ?? g.peds.list?.length,
        power: `${sv.util.power.supply.toFixed(0)}/${sv.util.power.served.toFixed(0)} off${sv.util.power.unserved}`,
        water: `${sv.util.water.supply.toFixed(0)}/${sv.util.water.served.toFixed(0)} off${sv.util.water.unserved}`,
        garbage: Math.round(sv.garbage.stored), gar: `${sv.garbage.made.toFixed(1)}/${sv.garbage.collected.toFixed(1)}/${sv.garbage.exported.toFixed(1)}`, counts: sv.counts,
        indWhy: (s.demandWhy?.ind ?? []).slice(0, 3), resWhy: (s.demandWhy?.res ?? []).slice(0, 3),
        heapMB: mem, geo: info.memory.geometries, tex: info.memory.textures,
        demand: Object.fromEntries(Object.entries(s.demand ?? {}).map(([k, v]) => [k, Math.round(v)])),
        bad: this.check(),
      };
    },
  };
};
await page.evaluate(install);

const build = await page.evaluate(() => {
  const d = window.__dbg, g = window.__game, SV = window.__services, LD = window.__land;
  const S0 = g.startView();
  const cx = Math.round(S0.x), cz = Math.round(S0.z);
  g.sim.money += 2000000; // enough to buy the land and build the whole test town in ponzi mode
  // buy every tile the test town touches (neighbors first, so each purchase is allowed)
  const N = 8;
  for (let pass = 0; pass < 4; pass++)
    for (const [x, z] of [[-340, -340], [340, -340], [-340, 340], [340, 340], [0, -340], [0, 340], [-340, 0], [340, 0], [-900, 0], [900, 0], [0, -900], [0, 900]]) {
      const [i, j] = LD.tileOf(cx + x, cz + z);
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const t = j * N + i;
      if (!LD.L.owned[t]) LD.buy(g, t);
    }
  const roads = [];
  for (let k = -3; k <= 3; k++) {
    roads.push(d.road(cx - 290, cz + k * 90, cx + 290, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'));
    roads.push(d.road(cx + k * 90, cz - 290, cx + k * 90, cz + 290, k === 0 ? 'stroad4' : 'twoLane'));
  }
  const zones = [
    d.zone(cx - 150, cz - 150, 120, 'resLow'), d.zone(cx + 150, cz + 150, 120, 'resLow'),
    d.zone(cx, cz, 70, 'comLow'), d.zone(cx + 170, cz - 170, 100, 'industry'),
    d.zone(cx - 170, cz + 170, 100, 'resHigh'), d.zone(cx + 60, cz - 220, 60, 'office'), d.zone(cx - 220, cz + 20, 60, 'comHigh'),
  ];
  const tryPlace = (id, R) => {
    for (const r of R) for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
      const spot = SV.findSpot ? SV.findSpot(g, id, x, z) : null;
      const px = spot && !spot.reason ? spot.x : x, pz = spot && !spot.reason ? spot.z : z;
      if (SV.canPlace(g, id, px, pz).ok && SV.place(g, id, px, pz)) return [Math.round(px), Math.round(pz)];
    }
    return null;
  };
  const placed = {};
  for (const id of ['gasPeaker', 'wellTower', 'fireStation', 'sheriff', 'clinic', 'school', 'park']) placed[id] = tryPlace(id, [60, 120, 200, 300]);
  for (const id of ['landfill', 'waterPump', 'sewageOutfall']) placed[id] = tryPlace(id, [120, 250, 400, 600, 800, 1000]);
  return { cx, cz, roads, zones, placed, owned: LD.L.owned.reduce((a, b) => a + b, 0) };
});
console.log(JSON.stringify(build));

const log = (o) => console.log(JSON.stringify(o));
const run = async (days) => page.evaluate(async (days) => {
  const t0 = performance.now();
  window.__dbg.run(days);
  return Math.round(performance.now() - t0);
}, days);

let day = 0, badSeen = 0;
const CH = 30;
while (day < DAYS) {
  const ms = await run(CH);
  day += CH;
  const s = await page.evaluate((l) => window.__soak.snap(l), `+${CH}d`);
  s.ms = ms;
  if (s.bad?.length) badSeen++;
  log(s);
  if (day === 120) {
    // bulldoze a grid street (splits the network), upgrade another
    const r = await page.evaluate(({ cx, cz }) => {
      const g = window.__game, t = g.tools;
      const a = g.net.pickSeg(cx + 180, cz + 45, 20), b = g.net.pickSeg(cx - 180, cz - 90, 20);
      const out = { bulldozed: null, upgraded: null };
      if (a) { t.set('bulldoze'); t.bulldozeAt(g.rts.target.clone().set(a.seg.curve.p0.x * 0.5 + a.seg.curve.p3.x * 0.5, 0, a.seg.curve.p0.z * 0.5 + a.seg.curve.p3.z * 0.5)); out.bulldozed = a.seg.id; }
      if (b) { t.set('upgrade'); t.upgradeAt(g.rts.target.clone().set(b.seg.curve.p0.x * 0.5 + b.seg.curve.p3.x * 0.5, 0, b.seg.curve.p0.z * 0.5 + b.seg.curve.p3.z * 0.5), false); out.upgraded = b.seg.id; }
      t.set('inspect');
      return { ...out, segs: g.net.segs.size };
    }, build);
    log({ edit: r });
  }
  if (day === 180) {
    const before = await page.evaluate(() => { const g = window.__game; return { saved: window.__dbg.save(), day: Math.round(g.sim.day), pop: g.sim.population, money: Math.round(g.sim.money), bld: g.buildings.list.size, segs: g.net.segs.size }; });
    await page.goto(`${base}/`, { waitUntil: 'load' });
    await page.locator('#continue').click();
    await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
    const after = await page.evaluate(() => { const g = window.__game; cancelAnimationFrame(g.raf); return { day: Math.round(g.sim.day), pop: g.sim.population, money: Math.round(g.sim.money), bld: g.buildings.list.size, segs: g.net.segs.size }; });
    log({ reload: { before, after } });
    await page.evaluate(install);
  }
}
// render a few real frames at the end to catch render-path errors
const frames = await page.evaluate(() => { const g = window.__game; const t0 = performance.now(); for (let i = 0; i < 20; i++) g.frame(0.033, true); return Math.round((performance.now() - t0) / 20); });
log({ renderMsPerFrame: frames });
console.log('ERRORS', errs.length);
for (const e of [...new Set(errs)].slice(0, 15)) console.log(e);
await browser.close();
// a gate, not just a log: invalid state or page errors fail the run
const pageErrors = errs.filter((e) => e.startsWith('pageerror'));
if (badSeen || pageErrors.length) { console.log(`FAIL soak: ${badSeen} snapshots with invalid state, ${pageErrors.length} page errors`); process.exit(1); }
console.log('OK soak');
