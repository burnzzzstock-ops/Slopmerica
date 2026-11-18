// BASE_URL selects the frozen candidate. NEXT_URL enables a separate A/B
// capture run with BASE_URL as its baseline, using the pinned town and camera.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { comparePixels } from './golden-diff.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('shots/pinned-browser');
const { launch } = await import('../lib/browser.mjs');
const { capture, shots } = await import('./golden-scenes.mjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:5197';
const next = process.env.NEXT_URL;
const out = process.env.OUT || 'shots/look/low-grade';
const backend = process.env.GPU === '1' ? 'hardware' : 'swiftshader';
mkdirSync(out, { recursive: true });
const browser = await launch({ args: ['--force-color-profile=srgb'] });
const rows = [];

async function entryPoints(page) {
  return page.evaluate(async () => {
    const g = window.__game, r = g.renderer, mat = g.terrain.material;
    const originalCompile = mat.onBeforeCompile;
    let compiled;
    mat.onBeforeCompile = function (...args) {
      originalCompile.apply(this, args);
      compiled = args[0];
    };
    mat.customProgramCacheKey = () => 'low-grade-entry-point-check';
    mat.needsUpdate = true;
    const source = await (await fetch('/src/render/gradeLite.ts')).text();
    const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const fingerprint = JSON.stringify(window.__dbg.fingerprint());
    const rows = [];
    for (const preset of ['low', 'high', 'low']) {
      g.requestQuality(preset);
      g.frame(0, true);
      const low = preset === 'low';
      const resolution = compiled?.uniforms.uLowResolution?.value.toArray();
      rows.push({ preset, post: g.post.active, tone: r.toneMapping,
        resolution, buffer: [r.domElement.width, r.domElement.height] });
      if (g.post.active === low || r.toneMapping !== (low ? THREE.CustomToneMapping : THREE.ACESFilmicToneMapping)) {
        throw Error('Live preset did not select its grading path');
      }
      if (low && JSON.stringify(resolution) !== JSON.stringify(rows.at(-1).buffer)) throw Error('Wrong grade resolution');
    }
    const originalDraw = g.post.render;
    const exports = [];
    try {
      g.post.render = function (...args) {
        const result = originalDraw.apply(this, args);
        exports.push({ resolution: compiled.uniforms.uLowResolution.value.toArray(),
          buffer: [r.domElement.width, r.domElement.height] });
        return result;
      };
      for (const active of [false, true]) {
        if (active) g.photo.enter();
        const image = await createImageBitmap(await g.photo.capture(false, { width: 3840, height: 2160 }));
        if (image.width !== 3840 || image.height !== 2160) throw Error('Wrong photo size');
        image.close();
        if (active) g.photo.exit();
      }
    } finally { g.post.render = originalDraw; }
    if (!exports.some(row => row.buffer[0] === 3840) || exports.some(row => JSON.stringify(row.resolution) !== JSON.stringify(row.buffer))) {
      throw Error('Photo grade retained the live canvas dimensions');
    }
    if (r.getContext().getError() !== 0) throw Error('GL error after grade changes');
    if (JSON.stringify(window.__dbg.fingerprint()) !== fingerprint) throw Error('Grading changed the simulation');
    return { rows, exports, simulationUnchanged: true };
  });
}

try {
  if (next) {
    const selected = shots.filter(shot => shot.scene === 'block' && /-junction-(noon|golden|moonless)$/.test(shot.id));
    for (const shot of selected) {
      const frames = [];
      const images = [];
      for (const [label, url] of [['before', base], ['after', next]]) {
        const frame = await capture(browser, shot, url, false, undefined, backend);
        writeFileSync(`${out}/${shot.id}-${label}.png`, frame.png);
        images.push(frame.png.toString('base64'));
        frames.push({ calls: frame.calls, triangles: frame.triangles, camera: frame.camera,
          hash: createHash('sha256').update(frame.png).digest('hex'), renderer: frame.renderer });
      }
      const [before, after] = frames;
      assert.equal(before.calls, after.calls);
      assert.equal(before.triangles, after.triangles);
      assert.deepEqual(before.camera, after.camera);
      assert.equal(before.renderer, after.renderer);
      let comparison;
      if (shot.quality === 'high') {
        const page = await browser.newPage();
        try {
          await page.addScriptTag({ content: 'window.comparePixels = ' + comparePixels.toString() });
          comparison = await page.evaluate(async images => {
            const pixels = [];
            for (const data of images) {
              const image = new Image(); image.src = 'data:image/png;base64,' + data;
              await image.decode();
              const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
              const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
              pixels.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
            }
            const { diff, ...score } = window.comparePixels(...pixels);
            return score;
          }, images);
          assert.equal(comparison.failed, false);
        } finally { await page.close(); }
      } else assert.notEqual(before.hash, after.hash);
      rows.push({ id: shot.id, before, after, comparison });
      console.log('OK', shot.id, JSON.stringify(rows.at(-1)));
    }
  } else {
    for (const quality of ['low', 'high']) {
      const shot = shots.find(shot => shot.id === `block-${quality}-junction-noon`);
      const frame = await capture(browser, shot, base, false, entryPoints, backend);
      rows.push({ initialPreset: quality, renderer: frame.renderer, ...frame.measurement });
      console.log('OK', quality, JSON.stringify(frame.measurement));
    }
  }
  writeFileSync(`${out}/result.json`, JSON.stringify({ backend, rows }, null, 2));
} finally { await browser.close(); }
