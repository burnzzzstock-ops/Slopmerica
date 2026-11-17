// Grow isolated acceptance evidence through the game's road, zone, service and
// fixed-step debug APIs. BASE_URL must serve frozen code; canonical fixtures stay unchanged.
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const out = process.env.OUT || 'shots/fixtures/large-town';
const seed = Number(process.env.SEED || 1776);
const minimumDays = Number(process.env.MIN_DAYS || 0);
const minimumTowers = Number(process.env.MIN_TOWERS || 0);
mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(seededInit, { seed, rng: seededRandom.toString() });
  await page.addInitScript(() => {
    localStorage.setItem('slopmerica.quality', 'low');
    localStorage.setItem('slopmerica.onboarded', '1');
    localStorage.setItem('slopmerica.firstSteps', '1');
  });
  await page.goto(`${base}/#skip&map=norcal&mode=sandbox&start=best&seed=${seed}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg && window.__services, null, { timeout: 240000 });
  const layout = await page.evaluate(() => {
    const g = window.__game, d = window.__dbg, services = window.__services;
    d.unlockAll();
    const start = g.startView();
    const end = [...g.net.nodes.values()].filter(n => n.segs.length === 1)
      .sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z))[0];
    if (!end) throw Error('No county-road end');
    const from = start.route?.at(-2) || start.edge;
    const hx = start.x - from.x, hz = start.z - from.z;
    const axis = Math.abs(hx) >= Math.abs(hz) ? { x: Math.sign(hx), z: 0 } : { x: 0, z: Math.sign(hz) };
    const normal = { x: -axis.z, z: axis.x };
    const center = { x: end.x + axis.x * 560, z: end.z + axis.z * 560 };
    const point = (u, v) => ({ x: center.x + axis.x * u + normal.x * v, z: center.z + axis.z * u + normal.z * v });
    const road = (u0, v0, u1, v1, type = 'twoLane') => {
      const a = point(u0, v0), b = point(u1, v1);
      return d.road(a.x, a.z, b.x, b.z, type);
    };
    const roads = [];
    roads.push(road(-560, 0, 950, 0, 'stroad4'));
    for (const u of [-475, -380, -285, -190, -95, 0, 95, 190, 285, 380, 475]) roads.push(road(u, -475, u, 475));
    for (const v of [-475, -380, -285, -190, -95, 95, 190, 285, 380, 475]) roads.push(road(-475, v, 475, v));
    for (const v of [-190, -95, 95, 190]) roads.push(road(475, v, 950, v));
    for (const u of [665, 855, 950]) roads.push(road(u, -190, u, 190));
    const zone = (u, v, radius, kind) => { const p = point(u, v); return d.zone(p.x, p.z, radius, kind); };
    // Paint the downtown first; the normal brush never overwrites another zone.
    const zoning = [zone(0, 0, 155, 'comHigh'), zone(-190, 0, 90, 'office'),
      zone(190, 0, 90, 'office'), zone(0, 285, 100, 'comLow'), zone(0, -285, 100, 'comLow'),
      zone(720, 0, 235, 'industry'), zone(0, 0, 690, 'resHigh')];
    const placed = [], rejected = [];
    const near = (id, u, v, limit = 450) => {
      const p = point(u, v);
      for (let radius = 0; radius <= limit; radius += 40) {
        for (let k = 0, n = radius ? 16 : 1; k < n; k++) {
          const spot = services.findSpot(g, id, p.x + Math.cos(k * Math.PI / 8) * radius, p.z + Math.sin(k * Math.PI / 8) * radius);
          if (spot.reason || !services.canPlace(g, id, spot.x, spot.z, spot.yaw).ok) continue;
          const b = services.place(g, id, spot.x, spot.z, spot.yaw);
          if (b) { placed.push({ id, x: b.x, z: b.z }); return true; }
        }
      }
      rejected.push(id); return false;
    };
    for (const [u, v] of [[-285, -285], [285, 285], [-285, 285], [285, -285]]) {
      for (const id of ['school', 'clinic', 'fireStation', 'sheriff', 'park']) near(id, u, v, 180);
    }
    for (const id of ['hospital', 'college', 'park', 'park']) near(id, 0, 95, 250);
    near('coalPlant', 800, -150);
    near('gasPeaker', 900, 150);
    near('landfill', 850, -100);
    near('incinerator', 850, 100);
    for (let i = 0; i < 12; i++) near('wellTower', -380 + (i % 4) * 250, i < 4 ? -400 : i < 8 ? 400 : 100, 180);
    let shore;
    for (let radius = 100; radius < 2500 && !shore; radius += 40) {
      for (let k = 0; k < 48; k++) {
        const p = { x: center.x + Math.cos(k * Math.PI / 24) * radius, z: center.z + Math.sin(k * Math.PI / 24) * radius };
        if (g.terrain.h(p.x, p.z) < -0.5) { shore = p; break; }
      }
    }
    if (!shore) throw Error('No accessible shore for sewage');
    const ends = [...g.net.nodes.values()].filter(n => n.segs.length === 1)
      .sort((a, b) => Math.hypot(a.x - shore.x, a.z - shore.z) - Math.hypot(b.x - shore.x, b.z - shore.z));
    for (const n of ends.slice(0, 12)) {
      const distance = Math.hypot(shore.x - n.x, shore.z - n.z);
      if (distance < 30) break;
      const result = d.road(n.x, n.z, n.x + (shore.x - n.x) * (distance - 28) / distance, n.z + (shore.z - n.z) * (distance - 28) / distance, 'twoLane');
      if (typeof result === 'number' && result > 0) break;
    }
    const u = (shore.x - center.x) * axis.x + (shore.z - center.z) * axis.z;
    const v = (shore.x - center.x) * normal.x + (shore.z - center.z) * normal.z;
    near('treatmentPlant', u, v, 300); near('sewageOutfall', u, v, 300); near('sewageOutfall', u, v, 300);
    g.sim.growthMul = 3; // Existing sandbox showcase speed; population/occupancy are never assigned.
    window.__largeTown = { center, axis, normal };
    return { center, axis, normal, roads, zoning, placed, rejected, seed: g.seed };
  });
  console.log('layout', JSON.stringify(layout));
  writeFileSync(out + '/layout.json', JSON.stringify(layout, null, 2));
  const history = [];
  for (let i = 0; i < 60; i++) {
    const state = await page.evaluate(() => {
      const g = window.__game;
      window.__dbg.run(20);
      const buildings = [...g.buildings.list.values()];
      return { day: g.sim.day, population: g.sim.population, buildings: buildings.length, demand: g.sim.demand,
        towers: buildings.filter(b => ['resHigh', 'comHigh', 'office'].includes(b.zone) && b.level >= 4).length,
        levels: buildings.reduce((all, b) => { all[b.level] = (all[b.level] || 0) + 1; return all; }, {}),
        utility: window.__services.snapshot().util, abandoned: buildings.filter(b => b.abandoned !== undefined).length };
    });
    history.push(state); console.log('growth', JSON.stringify(state));
    const save = await page.evaluate(() => window.__dbg.snapshot());
    writeFileSync(out + '/town.json.gz', gzipSync(save));
    const source = await page.evaluate(async () => Promise.all(['/src/game.ts', '/src/sim/sim.ts', '/src/sim/buildings.ts'].map(async path => [path, await (await fetch(path)).text()])));
    const metadata = { seed, base, layout, history, errors, sourceSHA256: source.map(([path, text]) => [path, createHash('sha256').update(text).digest('hex')]),
      saveSHA256: createHash('sha256').update(save).digest('hex'), center: layout.center, fingerprint: await page.evaluate(() => window.__dbg.fingerprint()) };
    writeFileSync(out + '/manifest.json', JSON.stringify(metadata, null, 2));
    if (state.population >= 5000 && state.day >= minimumDays && state.towers >= minimumTowers) break;
  }
  const final = history.at(-1);
  console.log('final', JSON.stringify(final));
  if (final.population < 5000 || final.day < minimumDays || final.towers < minimumTowers || errors.length) {
    process.exitCode = 1;
  }
} finally { await browser.close(); }
