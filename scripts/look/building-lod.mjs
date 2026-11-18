// Whole-frame and actual building-batch draws on the committed reference town.
// OUT=... BASE_URL=frozen-server GPU=1 node scripts/look/building-lod.mjs
import { launch, preflight, openScene, seed, fixtureHash } from './measure.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.OUT || 'shots/look/building-lod/current';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const renderer = await preflight(browser, true), results = [];
  for (const quality of ['low', 'high']) {
    const phone = quality === 'low';
    const { page, center, town, errs } = await openScene(browser, { scene: 'reference', quality, width: phone ? 390 : 1920, height: phone ? 844 : 1080, phone });
    await page.evaluate(() => {
      const g = window.__game;
      g.sim.speed = 0; g.hour = 12.5;
      window.__lodCounts = {};
      for (const [name, mesh] of [['main', g.buildings.mesh], ['kit', g.buildings.kitMesh]]) {
        const before = mesh.onBeforeRender, after = mesh.onAfterRender, shadowBefore = mesh.onBeforeShadow, shadowAfter = mesh.onAfterShadow;
        let start = 0, shadowStart = 0, shadow = false;
        const add = (kind, count) => { const key = name + '/' + kind; window.__lodCounts[key] = (window.__lodCounts[key] || 0) + count; };
        mesh.onBeforeRender = function(...args) { before.apply(this, args); if (!shadow) start = g.renderer.info.render.triangles; };
        mesh.onAfterRender = function(...args) { add(g.renderer.getRenderTarget() === g.water.reflection?.rt ? 'reflection' : 'scene', g.renderer.info.render.triangles - start); after.apply(this, args); };
        mesh.onBeforeShadow = function(...args) { shadow = true; shadowBefore.apply(this, args); shadowStart = g.renderer.info.render.triangles; };
        mesh.onAfterShadow = function(...args) { add('shadow', g.renderer.info.render.triangles - shadowStart); shadowAfter.apply(this, args); shadow = false; };
      }
    });
    const rows = [];
    for (let i = 0; i <= 60; i++) {
      const distance = 110 * (1600 / 110) ** (i / 60);
      const row = await page.evaluate(({ center, distance }) => {
        const g = window.__game;
        g.rts.setView(center.x, center.z, distance, 0.7, 0.56, true);
        for (let k = 0; k < 2; k++) g.frame(0, true);
        window.__lodCounts = {}; g.frame(0, true);
        const b = g.buildings;
        return { distance, total: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls, buildings: { ...window.__lodCounts },
          uploaded: { main: b.main.usedVerts, kit: b.kit.usedVerts }, allocated: { main: b.main.maxVerts, kit: b.kit.maxVerts },
          attributeBytes: [b.mesh, b.kitMesh].reduce((n, m) => n + Object.values(m.geometry.attributes).reduce((sum, a) => sum + a.array.byteLength, 0) + (m.geometry.index?.array.byteLength ?? 0), 0),
          camera: g.camera.position.toArray(), lod: b.lodStats?.() ?? null };
      }, { center, distance });
      rows.push(row);
      if (process.env.FRAMES === '1' || [0, 20, 40, 60].includes(i)) {
        // Only the visual proof hides problem bubbles. Counted frames above
        // retain the full scene; the next warmup restores these meshes.
        await page.evaluate(() => {
          const g = window.__game; window.__lodHidden = [];
          g.scene.traverse(o => { if (o.visible && o.material?.uniforms?.tIcons && o.material?.uniforms?.tDigits) { window.__lodHidden.push(o); o.visible = false; } });
          g.frame(0, true);
        });
        await page.screenshot({ path: `${out}/${quality}-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
        await page.evaluate(() => { for (const o of window.__lodHidden) o.visible = true; });
      }
    }
    const state = await page.evaluate(() => ({ population: window.__game.sim.population, buildings: window.__game.buildings.serialize() }));
    results.push({ quality, town, state, rows, errors: errs });
    await page.close();
  }
  writeFileSync(out + '/result.json', JSON.stringify({ renderer, chrome: browser.version(), seed, fixtureSHA256: fixtureHash(), results }, null, 2));
  console.log(JSON.stringify({ renderer, rows: results.map(r => ({ quality: r.quality, population: r.state.population, models: r.state.buildings.length,
    views: [r.rows[0], r.rows[40], r.rows[60]] })) }));
  if (results.some(r => r.errors.length)) process.exitCode = 1;
} finally { await browser.close(); }
