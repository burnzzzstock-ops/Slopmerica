// BASE_URL serves the lineup. Read only the requested surface zone so glass,
// headlights and a neighbouring painted panel cannot satisfy the assertion.
import { launch, saveReport } from './measure.mjs';
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL ?? 'http://127.0.0.1:5173') + '/dev/vehicles.html?w=640&h=430');
  await page.waitForFunction(() => window.__lineup?.ready);
  const rows = await page.evaluate(async () => {
    const T = await import('/@id/three');
    const { LAMPS } = await import('/src/world/nightLights.ts');
    const l = window.__lineup, r = l.renderer;
    const map = new T.DataTexture(new Uint8Array([255, 122, 40, 255]), 1, 1);
    map.needsUpdate = true;
    LAMPS.uLampMap.value = map;
    LAMPS.uLampRect.value.set(-50, -50, 0.01, 0.01);
    const result = [];
    for (const [model, color, zone, label] of [
      ['sedan', 0xeaeaea, 0, 'pale paint'], ['sedan', 0x16181a, 0, 'dark paint'],
      ['garbageTruck', 0xeaeaea, 12, 'livery panel'], ['cyberslop', 0xbababa, 15, 'stainless steel'],
    ]) {
      l.show(model, { night: 1, lod: 1, seed: 17, color, dist: 12, az: 48, el: 24 });
      const source = l.vr.batches.get(model).variants.get(model).near.mesh;
      const mesh = source.clone();
      const scene = new T.Scene();
      scene.background = new T.Color(0);
      scene.environment = l.scene.environment;
      scene.environmentIntensity = 0.18;
      scene.add(mesh, new T.HemisphereLight(0x839ac2, 0x4a4031, 0.12));
      const gl = r.getContext();
      const draw = () => {
        r.setRenderTarget(null); r.clear(); r.render(scene, l.camera);
        const pixels = new Uint8Array(640 * 430 * 4);
        gl.readPixels(0, 0, 640, 430, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const maskMaterial = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      maskMaterial.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aInfo; varying float poolZone;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\npoolZone = aInfo.x;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float poolZone;')
          .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = vec3(abs(poolZone - ${zone}.0) < 0.1 ? 1.0 : 0.0);`);
      };
      maskMaterial.customProgramCacheKey = () => `pool-zone-${zone}`;
      mesh.material = maskMaterial;
      const mask = draw();
      mesh.material = source.material;
      const luma = [];
      let count = 0;
      for (const on of [0, 1.25]) {
        LAMPS.uLampOn.value = on;
        const pixels = draw();
        let sum = 0; count = 0;
        for (let i = 0; i < mask.length; i += 4) if (mask[i] > 200) {
          sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
          count++;
        }
        luma.push(sum / count);
      }
      // A wheel, body and lamp update to this single visible vehicle should
      // reach the GPU in one transfer. Count native calls after shader warmup.
      const originalUpload = gl.bufferSubData;
      let motionUploads = 0;
      gl.bufferSubData = function (...args) { motionUploads++; return originalUpload.apply(this, args); };
      try {
        for (const name of ['iWheel', 'iBody', 'iMisc']) mesh.geometry.getAttribute(name).needsUpdate = true;
        draw();
      } finally { gl.bufferSubData = originalUpload; }
      result.push({ model, label, zone, pixels: count, off: luma[0], on: luma[1], delta: luma[1] - luma[0], motionUploads });
      maskMaterial.dispose(); mesh.dispose();
    }
    map.dispose();
    return result;
  });
  console.log(JSON.stringify(rows));
  saveReport(`shots/look/vehicle-pools-${process.env.TAG ?? 'current'}.json`, rows);
  if (rows.some(row => row.pixels < 100 || !Number.isFinite(row.delta) || row.delta < 10 || row.motionUploads !== 1)) process.exitCode = 1;
} finally { await browser.close(); }
