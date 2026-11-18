// BASE_URL selects frozen source. This isolated fixture makes two existing
// neighboring lots request the SAME supported brand, size and saved variant.
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';
import { readSave } from '../lib/fixtures.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const city = process.env.CITY || 'shots/fixtures/large-town-downtown-healthy/town.json.gz';
const original = readSave(city), saved = JSON.parse(original);
for (const id of [138, 146]) {
  const row = saved.buildings.find(row => row[14] === id);
  if (!row) throw Error(`Fixture has no building ${id}`);
  row[9] = row[22] = 'blackrack';
  row[15] = 6;
}
const save = JSON.stringify(saved);
const out = process.env.OUT || 'shots/look/skyline/instance';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const results = [];
  for (const quality of (process.env.QUALITIES || 'low,high').split(',')) {
    const page = await browser.newPage({ viewport: { width: quality === 'low' ? 390 : 1440, height: quality === 'low' ? 844 : 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(seededInit, { seed: 1776, rng: seededRandom.toString() });
    await page.addInitScript(({ save, quality }) => {
      localStorage.setItem('slopmerica.quality', quality);
      localStorage.setItem('slopmerica.onboarded', '1');
      localStorage.setItem('slopmerica.firstSteps', '1');
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) { return key === 'slopmerica.save.v1' ? save : get.call(this, key); };
    }, { save, quality });
    const open = async () => {
      await page.goto(base, { waitUntil: 'load', timeout: 180000 });
      await page.locator('#continue').click({ timeout: 180000 });
      await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 240000 });
      await page.evaluate(() => { window.__game.sim.speed = 0; });
    };
    await open();
    const result = await page.evaluate(async () => {
      const g = window.__game, blds = g.buildings, mesh = blds.mesh, batch = blds.main;
      const module = await (await fetch('/src/sim/buildings.ts')).text();
      const THREE = await import(module.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
      const { brandFits } = await import('/src/buildings/archetypes.ts');
      const { constructionHeight } = await import('/src/render/buildingClip.ts');
      const { Rng } = await import('/src/core/rng.ts');
      const { generateBuilding, variantsFor } = await import('/src/buildings/generator.ts');
      const pair = [138, 146].map(id => blds.list.get(id));
      const before = JSON.stringify({ rows: blds.serialize(), state: blds.serializeState() });
      const source = [...blds.geoIds.values()].find(entry => entry.model.geometry === pair[0].model.geometry).model;
      const sourceHeight = source.height, sourcePositions = Array.from(source.geometry.getAttribute('position').array);
      const random = Math.random;
      let draws = 0;
      Math.random = () => { draws++; return random(); };
      try {
        pair[0].model = source;
        blds.writeMatrix(pair[0], 1);
      } finally { Math.random = random; }
      const finishUpdate = g.finishes.update;
      g.finishes.update = () => {};
      const wanted = new THREE.Vector4(.23, .41, .67, .19);
      pair.forEach(b => mesh.setColorAt(b.inst, wanted));
      const values = [];
      for (const distance of [180, 1800, 180]) {
        g.rts.setView((pair[0].x + pair[1].x) / 2, (pair[0].z + pair[1].z) / 2, distance, .7, .4, true);
        for (let i = 0; i < 3; i++) g.frame(0, true);
        for (const b of pair) {
          const matrix = new THREE.Matrix4(), color = new THREE.Vector4();
          mesh.getMatrixAt(b.inst, matrix); mesh.getColorAt(b.inst, color);
          const state = batch.instances.get(b.inst), scale = matrix.elements[5];
          const ray = new THREE.Ray(new THREE.Vector3(b.x, b.y + b.model.height + 10, b.z), new THREE.Vector3(0, -1, 0));
          values.push({ id: b.id, distance, height: b.model.height, scale,
            correctHeight: Math.abs(b.model.height - source.height * scale) < 1e-4,
            sourceShared: b.model.geometry === source.geometry, parkingShared: b.model.spots === source.spots,
            emittersAligned: b.model.emitters.every((e, i) => Math.abs(e.pos[1] - source.emitters[i].pos[1] * scale) < 1e-4),
            colorKept: color.toArray().every((v, i) => Math.abs(v - wanted.toArray()[i]) < 1e-6),
            switched: (mesh.getGeometryIdAt(b.inst) !== state.original) === (distance > 1000), picked: blds.pickRay(ray)?.id === b.id });
        }
      }
      const canonicalKept = source.height === sourceHeight && sourcePositions.every((v, i) => v === source.geometry.getAttribute('position').array[i]);
      const stateKept = before === JSON.stringify({ rows: blds.serialize(), state: blds.serializeState() });
      const bytes = [blds.mesh, blds.kitMesh].reduce((n, m) => n + Object.values(m.geometry.attributes).reduce((sum, a) => sum + a.array.byteLength, 0) + (m.geometry.index?.array.byteLength ?? 0), 0);
      window.__towerTest = { THREE, pair, finishUpdate, constructionHeight, Rng, generateBuilding, variantsFor };
      return { supported: brandFits('office', 4, 2, 2, 'blackrack'),
        sameIdentity: pair.every(b => b.ask === 'blackrack' && b.variant === 6 && b.w === 2 && b.d === 2 && b.level === 4),
        separation: Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z),
        distinct: Math.abs(pair[0].model.height - pair[1].model.height) >= 3,
        heights: pair.map(b => b.model.height), values, canonicalKept, stateKept, draws, bytes };
    });
    await page.screenshot({ path: `${out}/${quality}-neighbors.jpg`, type: 'jpeg', quality: 92 });
    result.construction = await page.evaluate(() => {
      const g = window.__game, blds = g.buildings, { THREE, pair } = window.__towerTest, b = pair[0];
      const handle = b.inst;
      // Pin the diagnostic upgrade to a real procedural tower rather than a
      // short vault model. The public level-up still performs the actual swap.
      const { Rng, generateBuilding, variantsFor } = window.__towerTest;
      let upgradeSeed = 1;
      for (; upgradeSeed < 100; upgradeSeed++) {
        const variant = new Rng(upgradeSeed).int(0, variantsFor(b.zone) - 1);
        const model = generateBuilding({ zone: b.zone, level: b.level + 1, widthCells: b.w, depthCells: b.d,
          seed: variant * 7919 + (b.level + 1) * 131 + b.w * 17 + b.d, brand: b.brand });
        const tower = model.height > 35;
        model.geometry.dispose();
        if (tower) break;
      }
      if (upgradeSeed >= 100) throw Error('No procedural tower upgrade found');
      blds.rng.state = upgradeSeed;
      blds.levelUp(b);
      const matrix = new THREE.Matrix4(), scaffold = new THREE.Matrix4();
      blds.mesh.getMatrixAt(b.inst, matrix); blds.kitMesh.getMatrixAt(b.buildInst, scaffold);
      const scale = matrix.elements[5], grown = 1 - (1 - b.progress) ** 2;
      const mainClip = blds.main.clip.get(b.inst) * scale;
      const scaffoldClip = blds.kit.clip.get(b.buildInst) * scaffold.elements[5];
      const expected = window.__towerTest.constructionHeight(b.model.height, grown);
      const constructing = b.state === 'building' && b.inst === handle && Math.abs(mainClip - scaffoldClip) < .01 && Math.abs(mainClip - expected) < .01;
      blds.tickConstruction(b.buildDays, 1);
      const completed = b.state === 'active' && b.buildInst < 0 && blds.main.clip.get(b.inst) > 1e8;
      const expectedHeight = b.model.height;
      blds.demolish(b, 'bulldozed');
      const ghost = blds.main.ghosts.at(-1);
      const initial = new THREE.Matrix4();
      if (ghost) blds.mesh.getMatrixAt(ghost.handle, initial);
      blds.updateVisuals(.2);
      const collapsed = new THREE.Matrix4();
      if (ghost) blds.mesh.getMatrixAt(ghost.handle, collapsed);
      const ghostMatches = !!ghost && Math.abs(initial.elements[5] - scale) < 1e-6;
      const collapseMatches = !!ghost && Math.abs(collapsed.elements[5] - scale * (1 - (.2 / .65) ** 2)) < 1e-6;
      blds.updateVisuals(1);
      return { upgradeSeed, scale, mainClip, scaffoldClip, expected, expectedHeight, constructing, completed, ghostMatches, collapseMatches, ghostRemoved: !blds.main.ghosts.includes(ghost) };
    });
    // Recreate the same logical save from scratch. Instance height must not
    // depend on insertion history, camera, previous upgrades or demolition.
    await open();
    result.reloadedHeights = await page.evaluate(() => [138, 146].map(id => window.__game.buildings.list.get(id).model.height));
    result.reloadKept = result.heights.every((h, i) => h === result.reloadedHeights[i]);
    result.pass = !errors.length && result.supported && result.sameIdentity && result.distinct && result.separation < 160
      && result.canonicalKept && result.stateKept && result.reloadKept && result.draws === 0 && result.bytes <= 160 * 2 ** 20
      && result.values.every(v => v.correctHeight && v.sourceShared && v.parkingShared && v.emittersAligned && v.colorKept && v.switched && v.picked)
      && ['constructing', 'completed', 'ghostMatches', 'collapseMatches', 'ghostRemoved'].every(k => result.construction[k]);
    results.push({ quality, ...result, errors });
    console.log(result.pass ? 'OK' : 'FAIL', quality, JSON.stringify(result));
    await page.close();
  }
  const pass = results.every(result => result.pass);
  writeFileSync(out + '/result.json', JSON.stringify({ base, city, seed: 1776,
    originalFixtureSHA256: createHash('sha256').update(original).digest('hex'),
    controlledFixtureSHA256: createHash('sha256').update(save).digest('hex'), results, pass }, null, 2));
  if (!pass) process.exitCode = 1;
} finally { await browser.close(); }
