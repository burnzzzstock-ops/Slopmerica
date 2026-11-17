import { launch, preflight, openScene, seed, fixtureHash } from './measure.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.OUT || 'shots/look/building-lod/state'; mkdirSync(out, { recursive: true });
const source = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await launch();
try {
  const hardware = await preflight(browser, true);
  const { page, errs, town, center } = await openScene(browser, { scene: 'reference', quality: 'high', width: 1920, height: 1080 });
  const result = await page.evaluate(async ({ center }) => {
    const g = window.__game, blds = g.buildings, main = blds.main, mesh = blds.mesh;
    const module = await (await fetch('/src/sim/buildings.ts')).text();
    const THREE = await import(module.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const b = [...blds.list.values()].find(b => b.state === 'active' && b.zone === 'resLow' && b.level < 5 && main.lods.has(main.instances.get(b.inst)?.original));
    if (!b) throw Error('No eligible fixture house');
    const state = JSON.stringify(blds.serialize()), inst = b.inst, model = b.model;
    const geometry = main.instances.get(inst).original;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(inst, matrix); const beforeMatrix = matrix.toArray();
    const original = new THREE.Vector4(); mesh.getColorAt(inst, original);
    const wanted = new THREE.Vector4(0.23, 0.41, 0.67, 0.19); mesh.setColorAt(inst, wanted);
    const values = [];
    const pose = distance => { g.rts.setView(b.x, b.z, distance, .7, .56, true); g.frame(0, true); };
    for (const distance of [1800, 110, 1800, 110]) {
      pose(distance); const color = new THREE.Vector4(); mesh.getColorAt(inst, color); mesh.getMatrixAt(inst, matrix);
      const ray = new THREE.Ray(new THREE.Vector3(b.x, b.y + b.model.height + 30, b.z), new THREE.Vector3(0, -1, 0));
      values.push({ distance, switched: (mesh.getGeometryIdAt(inst) !== geometry) === (distance > 1000), rgba: color.toArray(), colorKept: color.toArray().every((v, i) => Math.abs(v - wanted.toArray()[i]) < 1e-6),
        matrixKept: JSON.stringify(matrix.toArray()) === JSON.stringify(beforeMatrix), picked: blds.pickRay(ray)?.id === b.id, handleKept: b.inst === inst, modelKept: b.model === model });
    }
    blds.setTint(b, new THREE.Color(.7, .3, .2)); pose(1800);
    const infoTint = new THREE.Vector4(); mesh.getColorAt(inst, infoTint);
    const infoTintKept = infoTint.toArray().every((v, i) => Math.abs(v - [.7, .3, .2, .19][i]) < 1e-6);
    mesh.setColorAt(inst, original);
    const stateKept = state === JSON.stringify(blds.serialize());
    // GPU query covers the ENTIRE frame, interleaved within one context.
    g.rts.setView(center.x, center.z, 1600, .7, .56, true);
    const renderer = g.renderer, gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) throw Error('GPU timer unavailable');
    const timings = [];
    for (const enabled of [false, true, true, false, true, false, false, true]) {
      blds.setLodEnabled(enabled);
      for (let i = 0; i < 16; i++) g.frame(0, true);
      const queries = [];
      for (let i = 0; i < 8; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); g.frame(0, true); gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); }
      gl.flush(); const deadline = performance.now() + 60000;
      while (!gl.getQueryParameter(queries.at(-1), gl.QUERY_RESULT_AVAILABLE)) { if (performance.now() > deadline || gl.isContextLost()) throw Error('GPU timer timeout'); await new Promise(r => setTimeout(r, 10)); }
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw Error('Disjoint GPU timer');
      const ms = queries.map(q => { const n = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); return n; });
      timings.push({ enabled, ms, meanMs: ms.reduce((a, b) => a + b) / ms.length, totalTriangles: renderer.info.render.triangles });
    }
    blds.setLodEnabled(true);
    // Exercise the real level-up path: it writes a new geometry directly to
    // the existing handle, then constructs/scales a separate scaffold.
    blds.levelUp(b); pose(1800);
    const newGeometry = main.instances.get(inst).original;
    const construction = { state: b.state, handleKept: b.inst === inst, changedModel: b.model !== model, fullGeometry: mesh.getGeometryIdAt(inst) === newGeometry,
      scaffold: b.buildInst >= 0 && !blds.kit.lods.has(blds.kitMesh.getGeometryIdAt(b.buildInst)) };
    blds.tickConstruction(b.buildDays, 1); pose(1800);
    const completed = b.state === 'active' && b.buildInst < 0 && mesh.getGeometryIdAt(inst) !== newGeometry;

    const rng = [];
    for (const enabled of [false, true]) {
      // Fit the original but force proxy upload to grow the batch buffer.
      const count = model.geometry.getAttribute('position').count;
      const batch = new main.constructor(new THREE.Scene(), mesh.material, count + 1, 8);
      batch.lodEnabled = enabled;
      let draws = 0; const random = Math.random, watched = () => { draws++; return random(); };
      Math.random = watched;
      try { batch.addGeometry(model.geometry); } finally { const restored = Math.random === watched; Math.random = random; rng.push({ enabled, draws, restored, resized: batch.maxVerts > count + 1 }); }
      batch.mesh.dispose();
    }
    return { values, infoTintKept, stateKept, construction, completed, timings, lod: blds.lodStats(), rng };
  }, { center });
  const pass = !errs.length && result.values.every(r => r.switched && r.colorKept && r.matrixKept && r.picked && r.handleKept && r.modelKept)
    && result.infoTintKept && result.stateKept && result.construction.state === 'building' && result.construction.handleKept && result.construction.changedModel && result.construction.fullGeometry && result.construction.scaffold && result.completed
    && result.rng.every(r => r.draws === 0 && r.restored && r.resized);
  writeFileSync(out + '/state.json', JSON.stringify({ source, hardware, seed, fixtureSHA256: fixtureHash(), town, result, errors: errs, pass }, null, 2));
  console.log(pass ? 'OK' : 'FAIL', JSON.stringify(result)); if (!pass) process.exitCode = 1;
} finally { await browser.close(); }
