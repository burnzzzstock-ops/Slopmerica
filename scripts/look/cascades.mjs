import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('shots/pinned-browser');
const { launch } = await import('../lib/browser.mjs');
const { capture, shots } = await import('./golden-scenes.mjs');
const out = process.env.OUT || 'shots/look/cascades';
mkdirSync(out, { recursive: true });
const browser = await launch();
const rows = [];
try {
  for (const quality of ['low', 'high', 'ultra']) {
    const shot = { ...shots.find(s => s.id === `block-${quality === 'ultra' ? 'high' : quality}-junction-noon`), quality };
    const frame = await capture(browser, shot, process.env.BASE_URL || 'http://127.0.0.1:5197', false, page => page.evaluate(async () => {
      const g = window.__game, r = g.renderer;
      const source = await (await fetch('/src/render/cascadeShadows.ts')).text();
      const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
      const { CascadeShadows } = await import('/src/render/cascadeShadows.ts');
      const { QUALITY } = await import('/src/config.ts');
      const main = g.shadows.stats();
      const fingerprint = JSON.stringify(window.__dbg.fingerprint());
      const target = new THREE.WebGLRenderTarget(64, 64);
      const camera = new THREE.PerspectiveCamera(50, 1, .5, 20000);
      camera.position.set(0, 8, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      const scene = new THREE.Scene();
      const material = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material);
      floor.rotation.x = -Math.PI / 2;
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(3, 10, 5); sun.target.position.set(0, 0, 0);
      scene.add(floor, sun, sun.target);
      const oldTarget = r.getRenderTarget(), oldTone = r.toneMapping;
      r.toneMapping = THREE.NoToneMapping;
      const pixels = new Uint8Array(64 * 64 * 4);
      const read = () => {
        r.setRenderTarget(target); r.render(scene, camera);
        r.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
        return pixels.slice();
      };
      const control = read();
      const shadows = new CascadeShadows(scene, camera, sun, QUALITY.low);
      const energy = [];
      for (const quality of ['low', 'high', 'ultra', 'low']) {
        shadows.setQuality(QUALITY[quality]);
        const result = read();
        let maximum = 0;
        for (let i = 0; i < result.length; i++) maximum = Math.max(maximum, Math.abs(result[i] - control[i]));
        energy.push({ quality, maximum, stats: shadows.stats() });
      }
      // Tiny pans remain aligned to the shadow texel grid. Translation along
      // the light's depth axis does not move projected shadow edges.
      const positions = shadows.csm.lights.map(l => l.position.clone());
      camera.position.x += .00001; camera.updateMatrixWorld(); read();
      const stability = shadows.csm.lights.map((light, i) => {
        const before = positions[i].applyMatrix4(shadows.inverseLightFrame);
        const after = light.position.clone().applyMatrix4(shadows.inverseLightFrame);
        const camera = light.shadow.camera;
        const texel = new THREE.Vector2((camera.right - camera.left) / light.shadow.mapSize.x, (camera.top - camera.bottom) / light.shadow.mapSize.y);
        return { drift: [Math.abs(after.x - before.x) / texel.x, Math.abs(after.y - before.y) / texel.y],
          alignment: [Math.abs(after.x / texel.x - Math.round(after.x / texel.x)), Math.abs(after.y / texel.y - Math.round(after.y / texel.y))] };
      });
      // Export lenses rebuild frustums, and returning to the game restores them.
      const photo = camera.clone(); photo.fov = 35; photo.aspect = 16 / 9; photo.updateProjectionMatrix();
      r.render(scene, photo);
      const photoProjection = shadows.projection.equals(photo.projectionMatrix);
      r.render(scene, camera);
      const gameProjection = shadows.projection.equals(camera.projectionMatrix);
      r.setRenderTarget(oldTarget); r.toneMapping = oldTone;
      floor.geometry.dispose(); material.dispose(); target.dispose();
      for (const light of shadows.csm.lights) light.shadow.dispose();
      shadows.csm.remove();
      return { main, energy, stability, photoProjection, gameProjection, unchanged: fingerprint === JSON.stringify(window.__dbg.fingerprint()), error: r.getContext().getError() };
    }), process.env.GPU === '1' ? 'hardware' : 'swiftshader');
    const probe = frame.measurement;
    writeFileSync(`${out}/${quality}-probe.json`, JSON.stringify(probe, null, 2));
    assert.ok(probe, 'Cascade shader probe must be returned');
    assert.equal(probe.main.cascades, quality === 'low' ? 2 : 3);
    assert.deepEqual(probe.main.maps, quality === 'low' ? [[1024, 1024], [512, 512]] : Array.from({ length: 3 }, () => [quality === 'ultra' ? 4096 : 2048, quality === 'ultra' ? 4096 : 2048]));
    for (const row of probe.energy) assert.ok(row.maximum <= 1, `Direct sun energy changed on ${row.quality} by ${row.maximum}`);
    for (const row of probe.stability) {
      assert.ok(row.drift.every(d => d <= 1.00001), 'Tiny pan moves a shadow by more than one texel');
      assert.ok(row.alignment.every(d => d < 1e-6), 'Shadow camera left its texel grid');
    }
    assert.ok(probe.photoProjection && probe.gameProjection && probe.unchanged);
    assert.equal(probe.error, 0);
    writeFileSync(`${out}/${quality}.png`, frame.png); delete frame.png;
    rows.push(frame);
    console.log('PASS', quality, JSON.stringify(probe));
  }
  writeFileSync(`${out}/result.json`, JSON.stringify(rows, null, 2));
} finally { await browser.close(); }
