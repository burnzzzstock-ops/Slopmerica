// BASE_URL is read by measure.openScene for the frozen game under test.
import { launch, preflight, openScene, seed, fixtureHash } from './measure.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.OUT || 'shots/look/construction/current';
mkdirSync(out, { recursive: true });
const browser = await launch();
const consoleErrors = [];
async function capture(page, path, ground = false) {
  const saved = await page.evaluate(ground => {
    const g = window.__game, b = window.__construction.b, rts = g.rts;
    const view = [rts.target.x, rts.target.z, rts.distance, rts.yaw, rts.pitch, rts.target.y];
    rts.setView(b.x, b.z, ground ? 60 : Math.max(100, b.model.height * 1.9), 3.7, ground ? 1.48 : .36, true);
    rts.target.y = ground ? b.y : b.y + b.model.height / 3;
    window.__constructionHidden = [];
    g.scene.traverse(object => {
      if (object.visible && object.material?.uniforms?.tIcons && object.material?.uniforms?.tDigits) {
        window.__constructionHidden.push(object);
        object.visible = false;
      }
    });
    g.frame(0, true);
    return view;
  }, ground);
  await page.screenshot({ path, type: 'jpeg', quality: 90, scale: 'css' });
  await page.evaluate(view => {
    const g = window.__game;
    g.rts.setView(view[0], view[1], view[2], view[3], view[4], true);
    g.rts.target.y = view[5];
    for (const object of window.__constructionHidden) object.visible = true;
  }, saved);
}
browser.on('page', page => page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
}));
try {
  const hardware = await preflight(browser, true);
  const results = [];
  for (const quality of ['low', 'high']) {
    const phone = quality === 'low';
    const { page, errs, town } = await openScene(browser, { scene: 'reference', quality, width: phone ? 390 : 1280, height: phone ? 844 : 720, phone });
    const setup = await page.evaluate(async () => {
      const g = window.__game;
      const source = await (await fetch('/src/sim/buildings.ts')).text();
      const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
      const candidates = [...g.buildings.list.values()].filter(b => ['office', 'comHigh', 'resHigh'].includes(b.zone) && b.level < 5 && b.state === 'active');
      candidates.sort((a, b) => b.model.height - a.model.height);
      const b = candidates[0];
      if (!b) throw Error('Fixture needs an upgradeable mid-rise');
      g.sim.speed = 0;
      g.hour = 12.5;
      g.rts.setView(b.x, b.z, Math.max(110, b.model.height * 4), .7, .45, true);
      const events = [];
      for (const kind of ['construction', 'levelUp', 'demolished']) g.sim.events.on(kind, data => { if (data.bldId === b.id) events.push({ kind, ...data }); });
      g.buildings.levelUp(b);
      g.buildings.mesh.setColorAt(b.inst, new THREE.Vector4(.21, .33, .57, .18));
      window.__construction = { THREE, b, events, handle: b.inst, model: b.model, position: Array.from(b.model.geometry.getAttribute('position').array) };
      return { id: b.id, zone: b.zone, level: b.level, height: b.model.height, buildHeight: b.buildH };
    });
    const stages = [];
    for (const progress of [.35, .5, .75, .95, 1]) {
      stages.push(await page.evaluate(progress => {
        const g = window.__game, { THREE, b, handle, model, position } = window.__construction;
        g.buildings.tickConstruction(Math.max(0, progress - b.progress) * b.buildDays + 1e-8, 1);
        g.frame(0, true);
        const matrix = new THREE.Matrix4(), rgba = new THREE.Vector4();
        g.buildings.mesh.getMatrixAt(b.inst, matrix);
        g.buildings.mesh.getColorAt(b.inst, rgba);
        const scaffold = new THREE.Matrix4();
        if (b.buildInst >= 0) g.buildings.kitMesh.getMatrixAt(b.buildInst, scaffold);
        return {
          progress: b.progress, state: b.state, scaleY: matrix.elements[5], scaffoldScaleY: b.buildInst < 0 ? null : scaffold.elements[5],
          clip: g.buildings.main.clip?.get(b.inst) ?? null, rgba: rgba.toArray(),
          handleKept: b.inst === handle, modelKept: b.model === model,
          sourceKept: position.every((v, i) => v === b.model.geometry.getAttribute('position').array[i]),
          triangles: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls,
        };
      }, progress));
      await capture(page, `${out}/${quality}-${Math.round(progress * 100)}.jpg`);
    }
    const demolition = await page.evaluate(() => {
      const g = window.__game, { THREE, b, events } = window.__construction;
      g.buildings.tickConstruction(1, 1);
      const before = { x: b.x, z: b.z, w: 2 * b.hw, d: 2 * b.hd, height: b.model.height };
      g.buildings.demolish(b, 'bulldozed');
      g.buildings.demolish(b, 'bulldozed');
      const state = JSON.stringify({ day: g.sim.day, money: g.sim.money, population: g.sim.population, buildings: g.buildings.serialize() });
      window.__construction.state = state;
      const ghost = g.buildings.main.ghosts?.[0];
      const rgba = new THREE.Vector4();
      if (ghost) g.buildings.mesh.getColorAt(ghost.handle, rgba);
      return { before, events, gone: !g.buildings.list.has(b.id), ghosts: (g.buildings.main.ghosts?.length ?? 0) + (g.buildings.kit.ghosts?.length ?? 0), ghostRgba: ghost ? rgba.toArray() : null };
    });
    const effects = [];
    for (const [label, dt] of [['collapse', .2], ['rubble', .6], ['cleared', 5.5]]) {
      effects.push(await page.evaluate(({ label, dt }) => {
        const g = window.__game;
        g.frame(dt, true);
        const ghost = g.buildings.main.ghosts?.[0];
        const matrix = new window.__construction.THREE.Matrix4();
        if (ghost) g.buildings.mesh.getMatrixAt(ghost.handle, matrix);
        return {
          label,
          ghosts: (g.buildings.main.ghosts?.length ?? 0) + (g.buildings.kit.ghosts?.length ?? 0),
          rubble: g.constructionEffects?.rubble.count ?? 0,
          ghostScaleY: ghost ? matrix.elements[5] : null,
          stateKept: window.__construction.state === JSON.stringify({ day: g.sim.day, money: g.sim.money, population: g.sim.population, buildings: g.buildings.serialize() }),
          triangles: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls,
        };
      }, { label, dt }));
      await capture(page, `${out}/${quality}-${label}.jpg`, label !== 'collapse');
    }
    const counts = kind => demolition.events.filter(e => e.kind === kind).length;
    const progress = demolition.events.filter(e => e.kind === 'construction').map(e => e.progress);
    const progressKept = progress.length === 7 && progress.every((value, i) => Math.abs(value - (.4 + i * .1)) < 1e-8);
    const removed = demolition.events.find(e => e.kind === 'demolished');
    const dimensionsKept = removed && Object.entries(demolition.before).every(([key, value]) => removed[key] === value);
    const pass = !errs.length && stages.every(s => Math.abs(s.scaleY - 1) < 1e-6 && s.handleKept && s.modelKept && s.sourceKept
      && s.rgba.every((v, i) => Math.abs(v - [.21, .33, .57, .18][i]) < 1e-6))
      && stages.slice(0, -1).every(s => s.clip !== null && s.clip < setup.height)
      && stages.at(-1).clip > 1e8 && progressKept && counts('levelUp') === 1 && counts('demolished') === 1
      && dimensionsKept && removed.cause === 'bulldoze'
      && demolition.gone && demolition.ghosts === 1 && effects.every(e => e.stateKept)
      && demolition.ghostRgba?.every((v, i) => Math.abs(v - [.21, .33, .57, .18][i]) < 1e-6)
      && effects[0].ghostScaleY > 0 && effects[0].ghostScaleY < 1
      && effects[0].ghosts === 1 && effects[1].ghosts === 0 && effects[1].rubble === 6 && effects[2].rubble === 0;
    results.push({ quality, town, setup, stages, demolition, effects, errors: errs, pass });
    console.log(pass ? 'OK' : 'FAIL', quality, JSON.stringify({ setup, stages, demolition, effects }));
    await page.close();
  }
  const pass = results.every(r => r.pass) && !consoleErrors.length;
  writeFileSync(out + '/result.json', JSON.stringify({ hardware, seed, fixtureSHA256: fixtureHash(), results, consoleErrors, pass }, null, 2));
  if (!pass) process.exitCode = 1;
} finally { await browser.close(); }
