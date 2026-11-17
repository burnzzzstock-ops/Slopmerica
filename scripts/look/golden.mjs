// From the repo root: node scripts/look/golden.mjs --install-browser, then run
// against a frozen BASE_URL. --update captures each camera twice and applies
// the same 0.5% / deltaE 3 gate to the replay. --exact also checks byte identity.
// --filter=appalachia-low-forest-noon selects a subset. --probe-material applies
// a deliberate ground-material regression for testing without touching the game.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { releaseSlot } from '../lib/slots.mjs';
import { comparePixels } from './golden-diff.mjs';

// The shared reference harness may import Playwright while resolving its own
// browser. Set the revision cache before either module is loaded.
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('shots/pinned-browser');
const { chromium } = await import('playwright-core');
const executablePath = chromium.executablePath();
process.env.CHROME = executablePath;
const { capture, seed, shots } = await import('./golden-scenes.mjs');
const { launch } = await import('../lib/browser.mjs');

const { values: options } = parseArgs({ options: {
  update: { type: 'boolean' }, exact: { type: 'boolean' }, list: { type: 'boolean' },
  'self-test': { type: 'boolean' }, 'install-browser': { type: 'boolean' },
  'probe-material': { type: 'boolean' }, filter: { type: 'string' },
} });
if (options.update && options['probe-material']) throw Error('A regression probe cannot update fixtures');
const filter = new RegExp(options.filter ?? '.');
const selected = shots.filter(s => filter.test(s.id));
if (!selected.length) throw Error('No matching golden cameras');
if (options.list) {
  console.log(selected.map(s => s.id).join('\n'));
  process.exit(0);
}
if (options['self-test']) {
  await import('./golden-self-test.mjs');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const playwrightRoot = dirname(require.resolve('playwright-core/package.json'));
const pin = JSON.parse(readFileSync(join(playwrightRoot, 'browsers.json'))).browsers.find(b => b.name === 'chromium');
const version = '153.0.8010.12', revision = '1243';
if (pin.browserVersion !== version || pin.revision !== revision) throw Error('Playwright revision changed: review the golden browser pin and recapture');
if (options['install-browser']) {
  execFileSync(process.execPath, [join(playwrightRoot, 'cli.js'), 'install', '--no-shell', 'chromium'], { stdio: 'inherit' });
  process.exit(0);
}
if (!existsSync(executablePath)) throw Error('Run node scripts/look/golden.mjs --install-browser');
const base = (process.env.BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const out = resolve(process.env.GOLDEN_OUT || 'shots/golden');
const fixtures = resolve('scripts/fixtures/golden');
const manifestPath = join(fixtures, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { browser: version, revision, seed, viewport: { low: [390,844,3], high: [1280,720,1] }, shots: {} };
assert.equal(manifest.browser, version, 'goldens use a different browser version');
assert.equal(manifest.revision, revision, 'goldens use a different browser revision');
assert.equal(manifest.seed, seed, 'goldens use a different seed');
mkdirSync(out, { recursive: true });
if (options.update) mkdirSync(fixtures, { recursive: true });
const browser = await launch({ executablePath, headless: true, gl: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
const results = [], groups = new Map();
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
let failures = 0;
try {
  assert.equal(browser.version(), version, 'unexpected browser executable');
  for (const shot of selected) {
    console.log('render', shot.id);
    const file = join(fixtures, shot.id + '.png');
    const hadBaseline = existsSync(file);
    if (!options.update && !hadBaseline) throw Error('Missing fixture ' + file + ' (seed an inspected baseline with --update)');
    const { png, ...details } = await capture(browser, shot, base, options['probe-material']);
    const afterFile = join(out, shot.id + '-after.png');
    writeFileSync(afterFile, png);
    let replay = null;
    if (options.update) {
      const repeat = await capture(browser, shot, base, false);
      if (!png.equals(repeat.png)) {
        writeFileSync(join(out, shot.id + '-repeat.png'), repeat.png);
      }
      replay = repeat.png;
    }
    const before = hadBaseline ? readFileSync(file) : replay;
    if (!options.update) {
      const recorded = manifest.shots[shot.id];
      assert.ok(recorded, 'Missing reviewed manifest entry for ' + shot.id);
      assert.equal(sha(before), recorded.sha256, 'Fixture changed without a reviewed update: ' + shot.id);
    }
    const beforeFile = join(out, shot.id + '-before.png'), diffFile = join(out, shot.id + '-diff.png');
    writeFileSync(beforeFile, before);
    const pixels = await browser.newPage();
    await pixels.addScriptTag({ content: 'window.comparePixels = ' + comparePixels.toString() });
    const compare = (first, second) => pixels.evaluate(async ([before, after]) => {
      async function load(data) {
        const image = new Image();
        image.src = 'data:image/png;base64,' + data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx;
      }
      const [first, second] = await Promise.all([load(before), load(after)]);
      const { width, height } = first.canvas;
      if (width !== second.canvas.width || height !== second.canvas.height) throw Error('Golden dimensions changed');
      const a = first.getImageData(0, 0, width, height), b = second.getImageData(0, 0, width, height);
      const { diff, ...score } = window.comparePixels(a.data, b.data);
      first.putImageData(new ImageData(diff, width, height), 0, 0);
      return { ...score, diff: first.canvas.toDataURL().split(',')[1] };
    }, [first.toString('base64'), second.toString('base64')]);
    const { diff, ...comparison } = await compare(before, png);
    let replayScore = null;
    if (replay) {
      const { diff: replayDiff, ...score } = await compare(replay, png);
      replayScore = { exact: png.equals(replay), ...score };
      if (!replayScore.exact) writeFileSync(join(out, shot.id + '-replay-diff.png'), Buffer.from(replayDiff, 'base64'));
    }
    await pixels.close();
    writeFileSync(diffFile, Buffer.from(diff, 'base64'));
    if (replayScore?.failed || (options.exact && replayScore && !replayScore.exact)) {
      throw Error(shot.id + ' failed replay: ' + JSON.stringify(replayScore));
    }
    const exact = before.equals(png);
    if (options.update) {
      const tmp = file + '.' + process.pid + '.tmp';
      writeFileSync(tmp, png);
      renameSync(tmp, file);
    } else if (comparison.failed || (options.exact && !exact)) failures++;
    const result = { id: shot.id, ...details, seed, browser: version, revision, sha256: sha(png),
      hadBaseline, replayVerified: !!replay, replay: replayScore, exact, ...comparison };
    results.push(result);
    writeFileSync(join(out, shot.id + '.json'), JSON.stringify(result, null, 2) + '\n');
    writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    if (options.update) {
      manifest.shots[shot.id] = { sha256: result.sha256, camera: result.camera, conditions: shot.conditions,
        renderBuffer: result.buffer, replayVerified: true, replay: replayScore };
      writeFileSync(manifestPath + '.tmp', JSON.stringify(manifest, null, 2) + '\n');
      renameSync(manifestPath + '.tmp', manifestPath);
    }
    const group = shot.scene + '-' + shot.quality;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(beforeFile, afterFile, diffFile);
    console.log(shot.id, comparison.changed + '/' + comparison.total + ' pixels over deltaE 3', exact ? 'byte-identical' : 'changed');
    if (replayScore) console.log('replay', JSON.stringify(replayScore));
  }
} finally {
  await browser.close();
  releaseSlot();
}
for (const [group, images] of groups) {
  execFileSync(process.execPath, ['scripts/sheet.mjs', join(out, group + '.jpg'), '3', '240', ...images], {
    stdio: 'inherit', env: { ...process.env, CHROME: executablePath },
  });
}
console.log(results.length + ' captures, ' + failures + ' regressions; ' + join(out, 'results.json'));
if (failures) process.exitCode = 1;
