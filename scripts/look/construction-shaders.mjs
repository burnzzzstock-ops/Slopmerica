// BASE_URL is read by measure.openScene for the frozen game under test.
import { launch, preflight, openScene, seed, fixtureHash } from './measure.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.OUT || 'shots/look/construction/shaders';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const hardware = await preflight(browser, true);
  const { page, errs, town } = await openScene(browser, { scene: 'reference', quality: 'high', width: 1280, height: 720 });
  const result = await page.evaluate(async () => {
    const game = window.__game;
    const source = await (await fetch('/src/sim/buildings.ts')).text();
    const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const renderer = game.renderer;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, .1, 50);
    camera.position.set(0, 5, 20);
    camera.lookAt(0, 5, 0);
    const target = new THREE.WebGLRenderTarget(256, 192);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const Batch = game.buildings.main.constructor;
    const batches = [new Batch(scene, material, 1000, 8), new Batch(scene, material, 1000, 8)];
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const geometry = new THREE.BoxGeometry(2, 10, 2).translate(0, 5, 0);
      const handle = batch.addInstance(batch.addGeometry(geometry));
      batch.mesh.setMatrixAt(handle, new THREE.Matrix4().makeTranslation(i ? 3 : -3, 0, 0));
      batch.clip.set(handle, i ? 7 : 3);
      geometry.dispose();
    }
    const materials = [
      ['visible', material],
      ['depth', new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })],
      ['distance', new THREE.MeshDistanceMaterial()],
    ];
    const oldTarget = renderer.getRenderTarget();
    const oldAlpha = renderer.getClearAlpha();
    const oldColor = renderer.getClearColor(new THREE.Color());
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setClearColor(0, 0);
    const rows = [];
    const pixels = new Uint8Array(256 * 192 * 4);
    const measure = () => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 256, 192, pixels);
      const occupied = [new Set(), new Set()];
      for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
        const at = (y * 256 + x) * 4;
        if (pixels[at] || pixels[at + 1] || pixels[at + 2] || pixels[at + 3]) occupied[x < 128 ? 0 : 1].add(y);
      }
      return occupied.map(set => set.size);
    };
    try {
      for (const [name, shared] of materials) {
        if (name === 'distance') {
          // WebGLShadowMap normally supplies this point-light metadata.
          const light = new THREE.PointLight();
          light.position.set(0, 5, 20);
          light.updateMatrixWorld();
          renderer.properties.get(shared).light = light;
        }
        for (const batch of batches) {
          batch.clip.bind(shared);
          batch.mesh.material = shared;
        }
        for (const reverse of [false, true]) {
          batches[0].mesh.renderOrder = reverse ? 1 : 0;
          batches[1].mesh.renderOrder = reverse ? 0 : 1;
          rows.push({ material: name, reverse, heights: measure(), expected: [48, 112] });
        }
      }
      batches[0].clip.set(1000, 1);
      batches[0].clip.set(0, 8);
      rows.push({ material: 'distance-resized', heights: measure(), expected: [128, 112] });
      batches[0].clip.set(0, null);
      rows.push({ material: 'distance-cleared', heights: measure(), expected: [160, 112] });
      return { rows, glError: renderer.getContext().getError(), pass: rows.every(row => row.heights.every((n, i) => Math.abs(n - row.expected[i]) <= 1)) };
    } finally {
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(oldColor, oldAlpha);
      renderer.autoClear = oldAutoClear;
      for (const batch of batches) batch.mesh.dispose();
      for (const [, shared] of materials) shared.dispose();
      target.dispose();
    }
  });
  const pass = result.pass && result.glError === 0 && !errs.length;
  writeFileSync(out + '/shaders.json', JSON.stringify({ hardware, seed, fixtureSHA256: fixtureHash(), town, result, errors: errs, pass }, null, 2));
  console.log(pass ? 'OK' : 'FAIL', JSON.stringify(result));
  if (!pass) process.exitCode = 1;
} finally {
  await browser.close();
}
