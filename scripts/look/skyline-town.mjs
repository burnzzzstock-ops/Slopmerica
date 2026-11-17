// BASE_URL serves frozen art. CITY is a normally grown exact save, never the
// canonical fixture. Every nearest-neighbour tower pair is audited.
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';
import { readSave } from '../lib/fixtures.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const city = process.env.CITY || 'shots/fixtures/large-town-downtown-healthy/town.json.gz';
const save = readSave(city), saved = JSON.parse(save);
const out = process.env.OUT || 'shots/look/skyline/town';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const results = [];
  for (const quality of ['low', 'high']) {
    const page = await browser.newPage({ viewport: { width: quality === 'low' ? 390 : 1440, height: quality === 'low' ? 844 : 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(seededInit, { seed: 1776, rng: seededRandom.toString() });
    await page.addInitScript(({ save, quality }) => {
      localStorage.setItem('slopmerica.quality', quality);
      localStorage.setItem('slopmerica.onboarded', '1');
      localStorage.setItem('slopmerica.firstSteps', '1');
      // The exact save can exceed browser storage quota. Continue still reads
      // the same text through its normal loader in this temporary test context.
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) { return key === 'slopmerica.save.v1' ? save : get.call(this, key); };
    }, { save, quality });
    await page.goto(base, { waitUntil: 'load', timeout: 180000 });
    await page.locator('#continue').click({ timeout: 180000 });
    await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 240000 });
    const audit = await page.evaluate(() => {
      const g = window.__game;
      g.sim.speed = 0;
      document.querySelectorAll('.hud,.xfeed,.toast,.next-bar,.side-cards').forEach(element => { element.style.display = 'none'; });
      window.__skylineState = JSON.stringify(g.buildings.serialize());
      const towers = [...g.buildings.list.values()].filter(b => ['office', 'comHigh', 'resHigh'].includes(b.zone) && b.level >= 4 && b.model.height > 35 && b.state === 'active');
      const section = (geometry, y, scale) => {
        const p = geometry.getAttribute('position'), index = geometry.index;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < (index?.count ?? p.count); i += 3) {
          const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
          for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
            const ya = p.getY(a) * scale, yb = p.getY(b) * scale;
            if (Math.abs(ya - yb) < 1e-5 || y < Math.min(ya, yb) || y > Math.max(ya, yb)) continue;
            const t = (y - ya) / (yb - ya), x = p.getX(a) + t * (p.getX(b) - p.getX(a)), z = p.getZ(a) + t * (p.getZ(b) - p.getZ(a));
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
          }
        }
        return Number.isFinite(x0) ? [x0, x1, z0, z1] : [0, 0, 0, 0];
      };
      const profiles = towers.map(b => {
        const width = b.hw * 2, depth = b.hd * 2;
        const matrix = { elements: [], fromArray(array, offset) {
          for (let i = 0; i < 16; i++) this.elements[i] = array[offset + i];
          return this;
        } };
        g.buildings.mesh.getMatrixAt(b.inst, matrix);
        const scale = matrix.elements[5];
        let bodyHeight = b.model.height;
        for (; bodyHeight > 4; bodyHeight -= .25) {
          const p = section(b.model.geometry, bodyHeight - .01, scale);
          if (p[1] - p[0] > width * .22 && p[3] - p[2] > depth * .22) break;
        }
        const profile = Array.from({ length: 15 }, (_, j) => section(b.model.geometry, bodyHeight * (.15 + j * .055), scale));
        const shape = profile.flatMap(p => p.map((v, i) => Math.round(v / (i < 2 ? width : depth) * 20))).join(',');
        return { id: b.id, zone: b.zone, level: b.level, label: b.label, x: b.x, z: b.z, width, depth, height: b.model.height, scale,
          profile, shape, signature: Math.round(bodyHeight * 2) + '/' + shape };
      });
      const seen = new Set(), pairs = [];
      for (const a of profiles) {
        const neighbors = profiles.filter(b => b !== a).map(b => ({ b, distance: Math.hypot(b.x - a.x, b.z - a.z) }))
          .filter(item => item.distance <= 160).sort((a, b) => a.distance - b.distance).slice(0, 3);
        for (const { b, distance } of neighbors) {
          const key = [a.id, b.id].sort((a, b) => a - b).join('/');
          if (seen.has(key)) continue;
          seen.add(key); pairs.push({ ids: [a.id, b.id], distance, identical: a.signature === b.signature, sameShape: a.shape === b.shape });
        }
      }
      const center = { x: profiles.reduce((sum, b) => sum + b.x, 0) / profiles.length, z: profiles.reduce((sum, b) => sum + b.z, 0) / profiles.length };
      return { population: g.sim.population, buildings: g.buildings.list.size, profiles, pairs, center,
        uniqueProfiles: new Set(profiles.map(p => p.signature)).size, duplicates: pairs.filter(p => p.identical), identicalShapes: pairs.filter(p => p.sameShape) };
    });
    const views = [];
    for (const [name, distance, yaw, pitch] of [['overview', 900, .7, .6], ['middle', 450, .7, .4], ['street', 180, 2.4, .3]]) {
      const measurement = await page.evaluate(({ center, distance, yaw, pitch }) => {
        const g = window.__game;
        g.rts.setView(center.x, center.z, distance, yaw, pitch, true);
        g.hour = 12.5; g.weather.force('clear', 30); g.weather.settle();
        for (let i = 0; i < 5; i++) g.frame(0, true);
        const batches = [g.buildings.mesh, g.buildings.kitMesh];
        const bytes = batches.reduce((sum, mesh) => sum + Object.values(mesh.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (mesh.geometry.index?.array.byteLength ?? 0), 0);
        return { calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles, bytes,
          stateKept: window.__skylineState === JSON.stringify(g.buildings.serialize()), png: g.renderer.domElement.toDataURL().split(',')[1] };
      }, { center: audit.center, distance, yaw, pitch });
      const { png, ...counts } = measurement;
      writeFileSync(`${out}/${quality}-${name}.png`, Buffer.from(png, 'base64'));
      views.push({ name, distance, ...counts });
    }
    const pass = audit.population >= 4000 && audit.profiles.length >= 12 && audit.pairs.length >= 12 && !audit.duplicates.length
      && !errors.length && views.every(v => v.stateKept && v.bytes <= 160 * 2 ** 20 && v.calls <= (quality === 'low' ? 250 : 600));
    results.push({ quality, ...audit, views, errors, pass });
    console.log(pass ? 'OK' : 'FAIL', quality, JSON.stringify({ population: audit.population, towers: audit.profiles.length, pairs: audit.pairs.length, duplicates: audit.duplicates, identicalShapes: audit.identicalShapes, views, errors }));
    await page.close();
  }
  let pass = results.every(result => result.pass);
  if (process.env.TOWN_BASE) {
    const before = JSON.parse(readFileSync(process.env.TOWN_BASE, 'utf8'));
    const sameCity = before.fixtureSHA256 === createHash('sha256').update(save).digest('hex');
    const budgetKept = results.every((r, i) => r.views.every((v, j) => v.calls <= before.results[i].views[j].calls && v.triangles <= before.results[i].views[j].triangles));
    console.log(sameCity && budgetKept ? 'OK' : 'FAIL', 'same city and whole-scene budgets', { sameCity, budgetKept });
    pass &&= sameCity && budgetKept;
  }
  writeFileSync(out + '/result.json', JSON.stringify({ source: base, city, seed: saved.seed, fixtureSHA256: createHash('sha256').update(save).digest('hex'), results, pass }, null, 2));
  if (!pass) process.exitCode = 1;
} finally { await browser.close(); }
