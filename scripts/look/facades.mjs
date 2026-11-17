// Compare interior wall gradients on two frozen versions of the same street.
// Exclude wall silhouettes, windows looking onto the sky, roads and roofs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { maskPass } from '../lib/towermask.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('shots/pinned-browser');
const { launch, chromium } = await import('../lib/browser.mjs');
const { capture, shots } = await import('./golden-scenes.mjs');
const baseline = process.env.BASE_URL, candidate = process.env.NEXT_URL;
if (!baseline || !candidate || baseline === candidate) throw Error('Set BASE_URL and NEXT_URL to separate frozen builds');
const backend = process.env.GPU === '1' ? 'hardware' : 'swiftshader';
const dir = process.env.OUT_DIR || 'shots/look/facades';
mkdirSync(dir, { recursive: true });

async function wallMetrics(page, frame) {
  await maskPass(page, 0.6);
  return page.evaluate(async data => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const { w, h, cls } = window.__cls;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    const luma = i => 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
    let sum = 0, gradient = 0, count = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if ([i, i-1, i+1, i-w, i+w].some(j => cls[j] !== 1)) continue;
      sum += luma(i);
      gradient += Math.hypot(luma(i+1) - luma(i-1), luma(i+w) - luma(i-w)) / 2;
      count++;
    }
    if (count < 1000) throw Error('Insufficient exposed facade area: ' + count);
    return { count, mean: sum / count, energy: gradient / count, normalized: gradient / sum };
  }, frame.png.toString('base64'));
}

const browser = await launch({ executablePath: chromium.executablePath(), args: ['--force-color-profile=srgb'] });
try {
  for (const shot of shots.filter(s => s.scene === 'block' && s.id.endsWith('-junction-noon'))) {
    const frames = [];
    for (const [label, base] of [['before', baseline], ['after', candidate]]) {
      const f = await capture(browser, shot, base, false, wallMetrics, backend);
      writeFileSync(join(dir, shot.id + '-' + label + '.png'), f.png);
      frames.push({ ...f.measurement, calls: f.calls, triangles: f.triangles, renderer: f.renderer, camera: f.camera });
    }
    const [original, revised] = frames;
    if (original.renderer !== revised.renderer || original.count !== revised.count) throw Error('Facade masks or hardware differ');
    const gain = revised.normalized / original.normalized - 1;
    const result = { original, revised, gain };
    writeFileSync(join(dir, shot.id + '.json'), JSON.stringify(result, null, 2));
    console.log(shot.id, JSON.stringify(result));
    if (gain < 0.25 || revised.calls > original.calls) process.exitCode = 1;
  }
} finally { await browser.close(); }
