// BASE_URL is read by measure.openScene for the frozen game under test.
import { launch, preflight, openScene, seed, fixtureHash } from './measure.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.OUT || 'shots/look/construction/budget';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const hardware = await preflight(browser, true);
  const { page, errs, town, center } = await openScene(browser, { scene: 'reference', quality: 'high', width: 1280, height: 720 });
  const result = await page.evaluate(({ center }) => {
    const g = window.__game;
    g.sim.speed = 0;
    g.rts.setView(center.x, center.z, 350, .7, .7, true);
    g.frame(0, true);
    const memory = () => {
      const b = g.buildings;
      const attributes = [b.mesh, b.kitMesh].reduce((sum, mesh) => sum + Object.values(mesh.geometry.attributes).reduce((n, attribute) => n + attribute.array.byteLength, 0) + (mesh.geometry.index?.array.byteLength ?? 0), 0);
      const clip = (b.main.clip?.data.byteLength ?? 0) + (b.kit.clip?.data.byteLength ?? 0);
      return { attributes, clip, positions: b.main.usedVerts + b.kit.usedVerts };
    };
    const initial = memory();
    const state = () => JSON.stringify({ day: g.sim.day, money: g.sim.money, population: g.sim.population, buildings: g.buildings.serialize() });
    const fx = g.constructionEffects;
    let globalDraws = 0, restored = true;
    if (fx) {
      const original = fx.demolished.bind(fx);
      fx.demolished = event => {
        const random = Math.random;
        const watched = () => { globalDraws++; return random(); };
        Math.random = watched;
        try { original(event); } finally { restored &&= Math.random === watched; Math.random = random; }
      };
    }
    const buildings = [...g.buildings.list.values()]
      .filter(b => b.state === 'active' && b.zone !== 'service' && b.zone !== 'landmark')
      .sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z))
      .slice(0, 32);
    for (const building of buildings) g.buildings.demolish(building, 'bulldozed');
    const afterAction = state();
    const ghosts = () => (g.buildings.main.ghosts?.length ?? 0) + (g.buildings.kit.ghosts?.length ?? 0);
    const pending = { ghosts: ghosts(), piles: fx?.piles.length ?? 0 };
    g.frame(.8, true);
    const shown = { ghosts: ghosts(), pieces: fx?.rubble.count ?? 0, calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles };
    g.frame(6, true);
    const cleared = { ghosts: ghosts(), pieces: fx?.rubble.count ?? 0, stateKept: state() === afterAction };
    return { initial, after: memory(), demolished: buildings.length, pending, shown, cleared, globalDraws, restored };
  }, { center });
  const pass = !errs.length && result.demolished === 32 && result.pending.ghosts === 16 && result.pending.piles === 16
    && result.shown.ghosts === 0 && result.shown.pieces === 96 && result.shown.calls <= 600
    && result.cleared.ghosts === 0 && result.cleared.pieces === 0 && result.cleared.stateKept
    && result.globalDraws === 0 && result.restored && result.after.attributes + result.after.clip < 160 * 2 ** 20;
  writeFileSync(out + '/budget.json', JSON.stringify({ hardware, seed, fixtureSHA256: fixtureHash(), town, result, errors: errs, pass }, null, 2));
  console.log(pass ? 'OK' : 'FAIL', JSON.stringify(result));
  if (!pass) process.exitCode = 1;
} finally {
  await browser.close();
}
