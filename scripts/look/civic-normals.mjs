// BASE_URL points to the frozen game. Check the actual THREE attributes
// feeding the shader against packed XYZ bytes.
// WebGL normalizes signed int8 normals; the fourth byte in each record is padding.
import { launch } from '../lib/browser.mjs';
import { openScene } from './measure.mjs';
const browser = await launch();
try {
  const { page } = await openScene(browser, { quality: 'high', scene: 'norcal', width: 960, height: 540 });
  const result = await page.evaluate(async () => {
    const pack = await (await fetch('civic/pack.json')).json();
    const bin = await (await fetch('civic/pack.bin')).arrayBuffer();
    const batches = window.__game.civic.batches;
    let vertices = 0, mismatches = 0, lengthErrors = 0;
    for (const [id, asset] of Object.entries(pack.assets)) {
      const batch = batches.get(id);
      for (const [level, lod] of asset.lods.entries()) for (const [index, prim] of lod.prims.entries()) {
        const normal = batch.geos[level][index].geo.getAttribute('normal');
        if (normal.count !== prim.count) lengthErrors++;
        const packed = new Int8Array(bin, prim.nrm, prim.count * 4);
        for (let i = 0; i < prim.count; i++) {
          const at = i * 4;
          const error = Math.max(Math.abs(normal.getX(i) - packed[at] / 127),
            Math.abs(normal.getY(i) - packed[at + 1] / 127), Math.abs(normal.getZ(i) - packed[at + 2] / 127));
          if (error > 1e-6) mismatches++;
          vertices++;
        }
      }
    }
    return { assets: batches.size, vertices, mismatches, lengthErrors };
  });
  console.log('Civic normal buffer', result);
  if (!result.vertices || result.mismatches || result.lengthErrors) process.exitCode = 1;
} finally { await browser.close(); }
