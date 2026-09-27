// Economy curve: a Growth Ponzi town grown the way a player grows one (a
// street grid, homes first, then shops, industry, offices and density, and
// the services its warnings ask for as it grows), with the weekly bill
// logged against population for two game years. Checks the curve has a
// shape: survivable early, tight in the middle (services eat most of the
// taxes), and never a money printer at 2,000 people.
//   node scripts/econtest.mjs [map] [days]     (LOG=1 prints every line)
import { chromium } from 'playwright-core';
const map = process.argv[2] || 'florida';
const DAYS = Number(process.argv[3]) || 720;
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=${map}&mode=ponzi`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 180000 });
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra)); if (!ok) bad++; };

const setup = await page.evaluate(async () => {
  const { SERVICE_DEFS } = await import('/src/sim/services.ts');
  const d = window.__dbg, g = window.__game, SV = window.__services, LD = window.__land;
  cancelAnimationFrame(g.raf);
  const S0 = g.startView();
  // the grid sits past the end of the county road, away from the map edge
  const ex = S0.x - S0.edge.x, ez = S0.z - S0.edge.z, el = Math.hypot(ex, ez) || 1;
  const cx = Math.round(S0.x + (ex / el) * 300), cz = Math.round(S0.z + (ez / el) * 300);
  // land is bought outside the ledger we measure: the curve is about running costs
  const m0 = g.sim.money;
  g.sim.money += 5000000;
  const N = 8;
  for (let pass = 0; pass < 4; pass++)
    for (const [x, z] of [[-340, -340], [340, -340], [-340, 340], [340, 340], [0, -340], [0, 340], [-340, 0], [340, 0], [-900, 0], [900, 0], [0, -900], [0, 900]]) {
      const [i, j] = LD.tileOf(cx + x, cz + z);
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const t = j * N + i;
      if (!LD.L.owned[t]) LD.buy(g, t);
    }
  g.sim.money = m0;
  // the balance curve, not hurricane luck: storms off unless DISASTERS=1 (set below)
  window.__econDisasters = false;
  window.__econ = {
    cx, cz, placed: {}, cap: Object.fromEntries([...SERVICE_DEFS.values()].map((d) => [d.id, d.capacity ?? 0])),
    place(id) {
      for (const r of [60, 120, 200, 300, 450, 600, 800, 1000]) for (let a = 0; a < 48; a++) {
        const ang = (a / 48) * Math.PI * 2;
        const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
        const spot = SV.findSpot ? SV.findSpot(g, id, x, z) : null;
        const px = spot && !spot.reason ? spot.x : x, pz = spot && !spot.reason ? spot.z : z;
        const yaw = spot && !spot.reason ? spot.yaw : undefined;
        if (!SV.canPlace(g, id, px, pz, yaw).ok) continue;
        // short of cash, a player borrows (a year's loan) rather than go without
        if (g.sim.money < 15000 && g.sim.loans.filter((L) => L.weeksLeft > 0).length < 3) { g.sim.takeLoan(25000); this.loans = (this.loans ?? 0) + 1; }
        if (SV.place(g, id, px, pz, yaw)) { this.placed[id] = (this.placed[id] ?? 0) + 1; return true; }
      }
      return false;
    },
    // what a player does about the warnings they see
    respond() {
      const S = SV.S, added = [], pop = g.sim.population;
      const has = (id) => (this.placed[id] ?? 0) > 0;
      const add = (id, why) => { if (this.place(id)) added.push(`${id}(${why})`); };
      // another station when the town as a whole outgrows the ones it has
      // (not whenever one is busy: a new one far away doesn't relieve it), at most one per kind every 60 days
      const load = {}, cap = {};
      for (const b of g.buildings.list.values()) {
        if (b.zone !== 'service' || b.state !== 'active' || !['fireStation', 'sheriff', 'clinic', 'school'].includes(b.kind)) continue;
        load[b.kind] = (load[b.kind] ?? 0) + (S.f.get(b.id)?.load ?? 0);
        cap[b.kind] = (cap[b.kind] ?? 0) + this.cap[b.kind];
      }
      this.lastAdd = this.lastAdd ?? {};
      for (const id of Object.keys(load)) if (load[id] > cap[id] * 0.9 && g.sim.day - (this.lastAdd[id] ?? -999) > 60) { this.lastAdd[id] = g.sim.day; add(id, 'outgrown'); }
      const U = S.util, C = S.counts, n = Math.max(1, S.b.size);
      if (U.power.demand > U.power.supply * 0.9) add(pop > 1500 ? 'coalPlant' : 'gasPeaker', 'power');
      if (U.water.demand > U.water.supply * 0.9) add(has('waterPump') || pop > 800 ? 'waterPump' : 'wellTower', 'water');
      if (U.sewage.demand > U.sewage.supply * 0.9) add('sewageOutfall', 'sewage');
      if (S.garbage.made > S.garbage.collected + 3.5) add('landfill', 'trash');
      if (!has('sheriff') && C.crime / n > 0.08) add('sheriff', 'crime');
      if (!has('clinic') && C.sick / n > 0.08) add('clinic', 'sick');
      if (!has('fireStation') && (C.burned > 0 || pop > 700)) add('fireStation', 'fires');
      if (!has('school') && pop > 600) add('school', 'levels');
      return added;
    },
    snap() {
      const s = g.sim, f = s.forecastWeek(), sv = SV.snapshot();
      const by = {};
      for (const l of f.lines) by[l.label] = (by[l.label] ?? 0) + l.amount;
      const tax = f.lines.filter((l) => /Tax$/.test(l.kind)).reduce((a, l) => a + l.amount, 0);
      const svc = -f.lines.filter((l) => l.kind === 'services').reduce((a, l) => a + l.amount, 0);
      const roads = -f.lines.filter((l) => l.kind === 'roads').reduce((a, l) => a + l.amount, 0);
      const loans = -f.lines.filter((l) => l.kind === 'loans').reduce((a, l) => a + l.amount, 0);
      return { day: Math.round(s.day), pop: s.population, jobs: s.workers, money: Math.round(s.money), net: f.net, op: f.net + loans, loans: this.loans ?? 0, tax, svc, roads, lines: by,
        power: `${sv.util.power.supply.toFixed(0)}/${sv.util.power.served.toFixed(0)}`, water: `${sv.util.water.supply.toFixed(0)}/${sv.util.water.served.toFixed(0)}`,
        counts: sv.counts, placed: { ...this.placed },
        zones: (() => { const z = {}; for (const b of g.buildings.list.values()) if (b.zone !== 'service' && b.zone !== 'landmark') { const k = b.zone; z[k] = z[k] ?? [0, 0, 0]; z[k][0]++; z[k][1] += b.occ; z[k][2] += b.cap; } return z; })(),
        demand: Object.fromEntries(Object.entries(s.demand).map(([k, v]) => [k, Math.round(v)])), why: (s.demandWhy?.com ?? []).slice(0, 4) };
    },
  };
  return { cx, cz };
});

if (!process.env.DISASTERS) await page.evaluate(() => {
  const sys = window.__ext.systems.find((x) => x.id === 'disasters');
  sys?.load?.(window.__game, { enabled: false, event: null, scars: [] });
});

// the player's build order: a first street of homes, more streets as they
// fill, then jobs, then density; services when the warnings ask (respond)
const stage = (n) => page.evaluate((n) => {
  const d = window.__dbg, g = window.__game, { cx, cz } = window.__econ;
  const out = [];
  if (n === 0) {
    d.road(g.startView().x, g.startView().z, cx - 180, cz, 'twoLane');
    out.push(d.road(cx - 180, cz, cx + 180, cz, 'twoLane'), d.road(cx - 180, cz - 90, cx + 180, cz - 90, 'twoLane'));
    for (const k of [-2, 0, 2]) out.push(d.road(cx + k * 90, cz - 90, cx + k * 90, cz, 'twoLane'));
    d.zone(cx - 90, cz - 45, 60, 'resLow'); d.zone(cx + 90, cz - 45, 60, 'resLow');
    d.zone(cx, cz + 25, 30, 'comLow');
    for (const id of ['gasPeaker', 'wellTower', 'sewageOutfall']) window.__econ.place(id);
  } else if (n === 1) {
    out.push(d.road(cx - 180, cz + 90, cx + 180, cz + 90, 'twoLane'), d.road(cx - 180, cz - 180, cx + 180, cz - 180, 'twoLane'));
    for (const k of [-2, 0, 2]) { out.push(d.road(cx + k * 90, cz - 180, cx + k * 90, cz - 90, 'twoLane'), d.road(cx + k * 90, cz, cx + k * 90, cz + 90, 'twoLane')); }
    d.zone(cx - 90, cz - 135, 60, 'resLow'); d.zone(cx + 90, cz - 135, 60, 'resLow');
    d.zone(cx + 90, cz + 50, 50, 'industry'); d.zone(cx - 90, cz + 45, 45, 'comLow');
  } else if (n === 2) {
    for (const k of [-3, 3]) out.push(d.road(cx + k * 90, cz - 270, cx + k * 90, cz + 270, 'twoLane'));
    for (const k of [-3, 2, 3]) out.push(d.road(cx - 270, cz + k * 90, cx + 270, cz + k * 90, 'twoLane'));
    d.zone(cx - 225, cz - 90, 60, 'resLow'); d.zone(cx + 225, cz - 90, 60, 'resLow');
    d.zone(cx + 200, cz + 200, 70, 'industry'); d.zone(cx - 200, cz + 200, 70, 'resLow');
  } else if (n === 3) {
    d.zone(cx - 90, cz + 220, 60, 'resHigh'); d.zone(cx, cz - 225, 50, 'office'); d.zone(cx - 225, cz + 45, 40, 'comHigh');
  } else if (n === 4) {
    for (const k of [-3, 3]) out.push(d.road(cx - 270, cz + k * 90, cx - 450, cz + k * 90, 'twoLane'), d.road(cx + 270, cz + k * 90, cx + 450, cz + k * 90, 'twoLane'));
    out.push(d.road(cx - 450, cz - 270, cx - 450, cz + 270, 'twoLane'), d.road(cx + 450, cz - 270, cx + 450, cz + 270, 'twoLane'));
    d.zone(cx - 360, cz - 150, 90, 'resLow'); d.zone(cx + 360, cz - 150, 90, 'resLow'); d.zone(cx - 360, cz + 150, 80, 'resHigh');
    d.zone(cx + 360, cz + 150, 70, 'industry'); d.zone(cx + 225, cz + 45, 40, 'comLow');
  } else if (n === 5) {
    d.zone(cx + 90, cz + 220, 50, 'resHigh'); d.zone(cx - 360, cz + 20, 50, 'office'); d.zone(cx + 360, cz + 20, 45, 'comHigh');
  }
  return out;
}, n);

const rows = [];
const run = (days) => page.evaluate((days) => { window.__dbg.run(days); return window.__econ.snap(); }, days);
await stage(0);
let staged = 1;
const STAGE_AT = [0, 250, 700, 1500, 1800, 2800];
for (let day = 0; day < DAYS; day += 30) {
  const r = await run(30);
  rows.push(r);
  // the player lays out more town as the last lots fill
  const prev = rows[rows.length - 2];
  if (staged < STAGE_AT.length && (r.pop > STAGE_AT[staged] || (prev && r.pop - prev.pop < r.pop * 0.03))) { await stage(staged); staged++; }
  r.added = await page.evaluate(() => window.__econ.respond());
  const L = process.env.LOG ? `\n   ${JSON.stringify(r.lines)}\n   ${JSON.stringify(r.zones)} ${JSON.stringify(r.demand)} ${JSON.stringify(r.why)} ${r.power} ${r.water}` : '';
  console.log(`day ${String(r.day).padStart(4)} pop ${String(r.pop).padStart(5)} tax ${String(r.tax).padStart(6)} svc ${String(r.svc).padStart(6)} roads ${String(r.roads).padStart(5)} net ${String(r.op).padStart(6)}${r.op !== r.net ? ` (${r.net} after loans)` : ''} money ${String(r.money).padStart(8)} crime ${r.counts.crime} sick ${r.counts.sick} fires ${r.counts.burned}${r.added?.length ? ` +${r.added.join(',')}` : ''}${L}`);
}
const last = rows[rows.length - 1];
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(rows));
console.log(JSON.stringify(last.lines));
console.log(JSON.stringify(last.placed));
// the curve: per resident, what a town nets at each size
const at = (p) => rows.find((r) => r.pop >= p);
for (const p of [300, 1000, 1800, 2000, 3000]) { const r = at(p); if (r) console.log(`~${p}: day ${r.day}, pop ${r.pop}, net ${r.op}/wk before loan payments (${(r.op / r.pop).toFixed(2)}/resident), services ${Math.round((r.svc / Math.max(1, r.tax)) * 100)}% of taxes`); }
if (process.env.CHECK) {
  // growth wanders run to run: judge the curve from 1,800 people up
  const r2 = at(1800);
  check(`the town grows past 1,800 people (${last.pop})`, !!r2, last.pop);
  if (r2) check(`there it nets under $1/resident a week (${r2.op}/wk at ${r2.pop})`, r2.op < r2.pop * 1.0, r2);
  if (r2) check(`and services take most of the taxes (${Math.round((r2.svc / r2.tax) * 100)}%)`, r2.svc / r2.tax > 0.45, r2);
  const low = Math.min(...rows.map((r) => r.money));
  check(`it never goes broke along the way (lowest cash $${low})`, low > -20000, low);
}
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
