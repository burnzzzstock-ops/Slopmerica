// Eight neighboring real tower models, rendered through one BatchedMesh.
// BASE_URL selects frozen code. OUT selects the evidence directory.
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const out = process.env.OUT || 'shots/look/skyline/rows';
mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(seededInit, { seed: 1776, rng: seededRandom.toString() });
  await page.addInitScript(() => { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); localStorage.setItem('slopmerica.firstSteps', '1'); });
  await page.goto(base + '/#skip&map=florida&mode=sandbox', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
  const rows = [];
  for (const [zone, level, brand] of [['office', 4, 'blackrack'], ['office', 5, 'slopHQ'], ['comHigh', 5, 'timesSlop'], ['resHigh', 4, undefined]]) {
    const r = await page.evaluate(async ({ zone, level, brand }) => {
      const source = await (await fetch('/src/buildings/mesh.ts')).text();
      const threePath = source.match(/from\s+["']([^"']*three[^"']*)["']/)?.[1];
      if (!threePath) throw Error('Could not locate the game’s Three.js module');
      const THREE = await import(threePath);
      const { MB } = await import('/src/buildings/mesh.ts');
      const { Rng } = await import('/src/core/rng.ts');
      const { buildingMaterial } = await import('/src/buildings/material.ts');
      const { genOffice } = await import('/src/buildings/office.ts');
      const { genComHigh } = await import('/src/buildings/comHigh.ts');
      const { genResHigh } = await import('/src/buildings/resHigh.ts');
      const gen = { office: genOffice, comHigh: genComHigh, resHigh: genResHigh }[zone];
      const renderer = window.__game.renderer;
      document.body.replaceChildren(renderer.domElement);
      document.body.style.cssText = 'margin:0;background:#efe6cf';
      renderer.setPixelRatio(1); renderer.setSize(1440, 720); renderer.toneMappingExposure = 1;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd5e3e5);
      scene.add(new THREE.HemisphereLight(0xe7f1ff, 0x9a9177, 2));
      const sun = new THREE.DirectionalLight(0xfff3df, 3); sun.position.set(-160, 260, 130); scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: 0xbeb8a8, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
      const models = [];
      for (let i = 0; i < 8; i++) {
        const seed = 1776 + i * 7919;
        const g = { mb: new MB(), rng: new Rng(seed), spec: { zone, level, widthCells: 3, depthCells: 3, seed, brand }, W: 24, D: 24, em: [], label: '' };
        gen(g); models.push({ geometry: g.mb.build(), height: g.mb.maxY(), seed });
      }
      const vertices = models.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
      const batch = new THREE.BatchedMesh(8, vertices, vertices, buildingMaterial());
      batch.sortObjects = false; batch.perObjectFrustumCulled = false;
      models.forEach((m, i) => {
        const id = batch.addInstance(batch.addGeometry(m.geometry));
        batch.setMatrixAt(id, new THREE.Matrix4().makeTranslation((i - 3.5) * 46, 0, 0));
      });
      scene.add(batch);
      const camera = new THREE.PerspectiveCamera(42, 2, 0.5, 3000);
      const mega = zone === 'office' && level === 5;
      camera.position.set(30, mega ? 140 : 100, 480);
      camera.lookAt(0, mega ? 75 : 38, 0); camera.updateMatrixWorld(true);
      window.__skyline?.dispose();
      window.__skyline = { render: () => renderer.render(scene, camera), clay: () => { batch.material = new THREE.MeshStandardMaterial({ color: 0xc2b9a8, roughness: 1 }); renderer.render(scene, camera); },
        dispose: () => { batch.dispose(); models.forEach(m => m.geometry.dispose()); ground.geometry.dispose(); ground.material.dispose(); } };
      renderer.info.reset(); renderer.render(scene, camera);
      return { zone, level, models: models.map(m => ({ seed: m.seed, height: m.height })), vertices, batchMB: vertices * 44 / 2 ** 20,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }, { zone, level, brand });
    await page.screenshot({ path: `${out}/${zone}-${level}.jpg`, type: 'jpeg', quality: 92 });
    await page.evaluate(() => window.__skyline.clay());
    await page.screenshot({ path: `${out}/${zone}-${level}-clay.jpg`, type: 'jpeg', quality: 92 });
    rows.push(r);
  }
  const result = { rows, errors };
  writeFileSync(out + '/rows.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (errors.length || rows.some(r => r.calls !== 2)) process.exitCode = 1;
} finally { await browser.close(); }
