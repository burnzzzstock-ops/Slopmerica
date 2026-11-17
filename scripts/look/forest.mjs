// BASE_URL is the original frozen game, NEXT_URL the candidate. Both renders
// use the golden camera, seed, resolution and pinned software renderer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('shots/pinned-browser');
const { chromium } = await import('playwright-core');
const { launch } = await import('../lib/browser.mjs');
const { capture, shots } = await import('./golden-scenes.mjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:5192';
const next = process.env.NEXT_URL || 'http://127.0.0.1:5197';
const backend = process.env.GPU === '1' ? 'hardware' : 'swiftshader';
const out = process.env.OUT_DIR || 'shots/look/forest-' + backend;
const cameras = shots.filter(s => s.scene !== 'block' && s.id.endsWith('-overview-noon') && (!process.env.MAP || s.scene === process.env.MAP));
if (!cameras.length) throw Error('No matching map');
mkdirSync(out, { recursive: true });
const browser = await launch({ gl: false, executablePath: chromium.executablePath(),
  args: backend === 'hardware' ? ['--use-angle=' + (process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'), '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force-color-profile=srgb'] :
    ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });

async function forestStats(page, frame, before, fixedMask) {
  return page.evaluate(async ([baseline, candidate, maskData]) => {
    const g = window.__game, terrain = g.terrain;
    const texture = terrain.forestFloor.texture.image;
    const calls = g.renderer.info.render.calls, triangles = g.renderer.info.render.triangles;
    async function pixels(data) {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height);
    }
    const [a, b] = await Promise.all([pixels(baseline), pixels(candidate)]);
    if (a.width !== b.width || a.height !== b.height) throw Error('Mismatched viewports');
    const width = 120, height = Math.round(width * a.height / a.width);
    const fixed = maskData ? await pixels(maskData) : null;
    if (fixed && (fixed.width !== width || fixed.height !== height)) throw Error('Fixed mask dimensions differ');
    const mask = document.createElement('canvas');
    mask.width = width; mask.height = height;
    const ctx = mask.getContext('2d');
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    const camera = g.camera, dir = camera.position.clone();
    let n = 0;
    const included = new Uint8Array(a.width * a.height);
    const channels = texture.data.length / (texture.width * texture.height);
    const sums = [0, 0], squares = [0, 0];
    const luma = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      if (fixed) {
        if (fixed.data[(row * width + col) * 4] < 128) continue;
      } else {
        dir.set((col + 0.5) / width * 2 - 1, 1 - (row + 0.5) / height * 2, 0.5);
        dir.unproject(camera).sub(camera.position).normalize();
        const p = terrain.raycast(camera.position, dir, 8000);
        if (!p || p.y < 0.3 || !terrain.inBounds(p.x, p.z, 24)) continue;
        const x = Math.floor((p.x / 6144 + 0.5) * texture.width);
        const z = Math.floor((p.z / 6144 + 0.5) * texture.height);
        if (texture.data[(z * texture.width + x) * channels] < 90) continue;
      }
      ctx.fillRect(col, row, 1, 1);
      for (let y = Math.floor(row * a.height / height); y < Math.floor((row + 1) * a.height / height); y++) {
        for (let x = Math.floor(col * a.width / width); x < Math.floor((col + 1) * a.width / width); x++) {
          const i = (y * a.width + x) * 4;
          included[y * a.width + x] = 1;
          const v0 = luma(a.data, i), v1 = luma(b.data, i);
          n++;
          sums[0] += v0; squares[0] += v0 * v0;
          sums[1] += v1; squares[1] += v1 * v1;
        }
      }
    }
    if (n < 1000) throw Error('Camera contains fewer than 1,000 forest pixels');
    const mean = sums.map(v => v/n);
    const sd = squares.map((v, i) => Math.sqrt(Math.max(0, v/n - mean[i] ** 2)));
    const reduction = 1 - (sd[1] / mean[1]) / (sd[0] / mean[0]);
    // Local contrast is diagnostic only. Include every complete 32/64 px tile
    // with at least 50% mask coverage, retain equal-mean comparison per tile,
    // and pool variance by pixel count. Global acceptance remains unchanged.
    const regional = [];
    for (const side of [32, 64]) {
      let regions = 0, pixels = 0, variance0 = 0, variance1 = 0;
      for (let top = 0; top + side <= a.height; top += side) for (let left = 0; left + side <= a.width; left += side) {
        let count = 0, sum0 = 0, sum1 = 0, square0 = 0, square1 = 0;
        for (let y = top; y < top + side; y++) for (let x = left; x < left + side; x++) {
          const pixel = y * a.width + x;
          if (!included[pixel]) continue;
          const v0 = luma(a.data, pixel * 4), v1 = luma(b.data, pixel * 4);
          count++; sum0 += v0; sum1 += v1; square0 += v0 * v0; square1 += v1 * v1;
        }
        if (count < side * side * 0.5 || sum0 <= 0 || sum1 <= 0) continue;
        const m0 = sum0 / count, m1 = sum1 / count;
        regions++; pixels += count;
        variance0 += Math.max(0, square0 / count - m0 * m0) * count;
        variance1 += Math.max(0, square1 / count - m1 * m1) * (m0 / m1) ** 2 * count;
      }
      regional.push({ side, regions, pixels, beforeSD: Math.sqrt(variance0 / pixels), afterEqualMeanSD: Math.sqrt(variance1 / pixels), reduction: 1 - Math.sqrt(variance1 / variance0) });
    }
    // Separate calibration: measure the displayed ground under fully closed
    // canopy, with trees hidden and the same lighting/material in both draws.
    // This never changes the fixed global forest mask or its acceptance.
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = a.width; groundCanvas.height = a.height;
    const groundContext = groundCanvas.getContext('2d', { alpha: false });
    const savedDensity = texture.data.slice(), treesVisible = g.trees.group.visible;
    const groundPixels = () => {
      g.frame(0, true);
      groundContext.drawImage(g.renderer.domElement, 0, 0, a.width, a.height);
      return groundContext.getImageData(0, 0, a.width, a.height).data;
    };
    let shaded, unshaded;
    try {
      g.trees.group.visible = false;
      shaded = groundPixels();
      texture.data.fill(0); terrain.forestFloor.texture.needsUpdate = true;
      unshaded = groundPixels();
    } finally {
      texture.data.set(savedDensity); terrain.forestFloor.texture.needsUpdate = true;
      g.trees.group.visible = treesVisible;
    }
    let groundN = 0, groundOn = 0, groundOff = 0;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      dir.set((col + .5) / width * 2 - 1, 1 - (row + .5) / height * 2, .5);
      dir.unproject(camera).sub(camera.position).normalize();
      const p = terrain.raycast(camera.position, dir, 8000);
      if (!p || p.y < .3 || !terrain.inBounds(p.x, p.z, 48) || terrain.paintAt(p.x, p.z) !== 0) continue;
      const u = (p.x / 6144 + .5) * texture.width - .5, v = (p.z / 6144 + .5) * texture.height - .5;
      const tx = Math.floor(u), tz = Math.floor(v), fx = u - tx, fz = v - tz;
      const read = (x, z) => savedDensity[(z * texture.width + x) * channels] / 255;
      const density = (read(tx, tz) * (1 - fx) + read(tx + 1, tz) * fx) * (1 - fz)
        + (read(tx, tz + 1) * (1 - fx) + read(tx + 1, tz + 1) * fx) * fz;
      if (density < .9) continue;
      for (let y = Math.floor(row * a.height / height); y < Math.floor((row + 1) * a.height / height); y++) {
        for (let x = Math.floor(col * a.width / width); x < Math.floor((col + 1) * a.width / width); x++) {
          const i = (y * a.width + x) * 4;
          groundN++; groundOn += luma(shaded, i); groundOff += luma(unshaded, i);
        }
      }
    }
    const ground = { pixels: groundN, shadedMean: groundOn / groundN, unshadedMean: groundOff / groundN, reduction: 1 - groundOn / groundOff };
    return { n, mean, sd, reduction, rawReduction: 1 - sd[1] / sd[0], regional, ground, calls, triangles, mask: mask.toDataURL().split(',')[1] };
  }, [before.toString('base64'), frame.png.toString('base64'), fixedMask?.toString('base64')]);
}

try {
  for (const shot of cameras) {
    const file = suffix => join(out, shot.id + '-' + suffix);
    if (!existsSync(file('before.png'))) {
      const frame = await capture(browser, shot, base, false, page =>
        page.evaluate(() => ({ calls: __game.renderer.info.render.calls, triangles: __game.renderer.info.render.triangles })), backend);
      writeFileSync(file('before.png'), frame.png);
      writeFileSync(file('before.json'), JSON.stringify({ url: base, backend, renderer: frame.renderer, ...frame.measurement }));
    }
    const original = JSON.parse(readFileSync(file('before.json')));
    if (original.url !== base || original.backend !== backend) throw Error('Choose a new OUT_DIR for this baseline');
    if (process.env.BEFORE_ONLY === '1') { console.log(shot.id, 'baseline captured'); continue; }
    const before = readFileSync(file('before.png'));
    const maskPath = process.env.MASK_DIR ? join(process.env.MASK_DIR, shot.id + '-mask.png') : null;
    const fixedMask = maskPath ? readFileSync(maskPath) : null;
    const after = await capture(browser, shot, next, false, (page, frame) => forestStats(page, frame, before, fixedMask), backend);
    if (after.renderer !== original.renderer) throw Error('Before/after renderers differ');
    writeFileSync(file('after.png'), after.png);
    const { mask, ...stats } = after.measurement;
    writeFileSync(file('mask.png'), Buffer.from(mask, 'base64'));
    writeFileSync(file('metrics.json'), JSON.stringify({ camera: after.camera, original, maskSource: maskPath, ...stats }, null, 2));
    console.log(shot.id, 'equal-mean contrast reduction', (100 * stats.reduction).toFixed(1) + '%',
      'luma', stats.mean.map(x => x.toFixed(1)), 'calls', original.calls, stats.calls, 'triangles', original.triangles, stats.triangles);
    if (stats.reduction < 0.4 || stats.calls > original.calls || stats.triangles > original.triangles) process.exitCode = 1;
  }
} finally { await browser.close(); }
