// BASE_URL serves the game assets. A constant sodium pool isolates furniture
// material response from camera, terrain and the town's lamp placement.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, openScene, saveReport } from './measure.mjs';
const browser = await launch();
try {
  const { page } = await openScene(browser, { quality: 'high', scene: 'norcal', width: 640, height: 430 });
  await page.waitForFunction(() => {
    const b = window.__game.civic.batches;
    return ['street-bench-slat', 'service-pad-transformer'].every(id =>
      b.get(id).geos[0].every(p => ['map', 'normalMap', 'roughnessMap'].every(key => p.mat[key]?.image?.complete)));
  });
  const rows = await page.evaluate(async () => {
    const T = await import('/@id/three');
    const { LAMPS } = await import('/src/world/nightLights.ts');
    const g = window.__game, r = g.renderer;
    const pool = new T.DataTexture(new Uint8Array([255, 122, 40, 255]), 1, 1);
    pool.needsUpdate = true;
    const original = [LAMPS.uLampMap.value, LAMPS.uLampRect.value.clone(), LAMPS.uLampOn.value];
    LAMPS.uLampMap.value = pool;
    LAMPS.uLampRect.value.set(-50, -50, 0.01, 0.01);
    const results = [];
    try {
      for (const id of ['street-bench-slat', 'service-pad-transformer']) {
        const scene = new T.Scene(), group = new T.Group();
        scene.background = new T.Color(0x080b10);
        scene.environment = g.scene.environment;
        scene.environmentIntensity = 0.08;
        for (const p of g.civic.batches.get(id).geos[0]) group.add(new T.Mesh(p.geo, p.mat));
        scene.add(group, new T.HemisphereLight(0x839ac2, 0x4a4031, 0.12));
        const box = new T.Box3().setFromObject(group);
        const center = box.getCenter(new T.Vector3()), dims = box.getSize(new T.Vector3());
        const radius = Math.max(dims.y * 0.66, Math.hypot(dims.x, dims.z) * 0.48);
        const camera = new T.OrthographicCamera(-radius * 640 / 430, radius * 640 / 430, radius, -radius, 0.01, 250);
        camera.position.copy(center).add(new T.Vector3(4, 2.1, 5).normalize().multiplyScalar(radius * 6));
        camera.lookAt(center);
        r.setPixelRatio(1); r.setSize(640, 430, false); r.setRenderTarget(null);
        const gl = r.getContext();
        const render = () => {
          r.clear(); r.render(scene, camera);
          const pixels = new Uint8Array(640 * 430 * 4);
          gl.readPixels(0, 0, 640, 430, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels;
        };
        const maskMaterial = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        scene.overrideMaterial = maskMaterial;
        scene.background.set(0);
        const mask = render();
        scene.overrideMaterial = null;
        scene.background.set(0x080b10);
        const luma = [];
        let image;
        for (const on of [0, 1.25]) {
          LAMPS.uLampOn.value = on;
          const pixels = render();
          let sum = 0, count = 0;
          for (let i = 0; i < mask.length; i += 4) if (mask[i] > 200) {
            sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
            count++;
          }
          luma.push(sum / count);
          if (on) image = r.domElement.toDataURL('image/png').split(',')[1];
        }
        results.push({ id, off: luma[0], on: luma[1], delta: luma[1] - luma[0], image });
        maskMaterial.dispose();
      }
    } finally {
      LAMPS.uLampMap.value = original[0]; LAMPS.uLampRect.value.copy(original[1]); LAMPS.uLampOn.value = original[2];
      pool.dispose();
    }
    return results;
  });
  const directory = 'shots/look/civic-pools';
  mkdirSync(directory, { recursive: true });
  for (const row of rows) {
    if (process.env.TAG) writeFileSync(`${directory}/${row.id}-${process.env.TAG}.png`, Buffer.from(row.image, 'base64'));
    delete row.image;
  }
  console.log(JSON.stringify(rows));
  saveReport(`${directory}/${process.env.TAG ?? 'current'}.json`, rows);
  if (rows.some(row => !Number.isFinite(row.delta) || row.delta < 15)) process.exitCode = 1;
} finally { await browser.close(); }
