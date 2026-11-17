import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launch as launchBrowser } from '../lib/browser.mjs';
import { SAVE, openBlock, seededInit, seededRandom, shoot } from '../refblock.mjs';

export const presets = ['low', 'medium', 'high', 'ultra'];
export const scenes = ['reference', 'appalachia', 'norcal', 'florida'];
export const views = {
  street: [-40, -30, 110, 2.4, 0.38],
  middle: [0, 0, 320, 0.7, 0.6],
  overview: [0, 0, 1050, 0.7, 0.56],
};
export const seed = Number(process.env.SEED ?? 271828);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('SEED must be a uint32');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

export function selection(name, options) {
  const list = process.env[name]?.split(',') ?? options;
  if (list.some(x => !options.includes(x)) || new Set(list).size !== list.length) {
    throw Error(`${name} accepts ${options.join(', ')}`);
  }
  return list;
}

export function fixtureHash() {
  const path = 'scripts/fixtures/refblock-town.json';
  if (resolve(SAVE) !== resolve(path) || !existsSync(path)) throw Error(`Reference loader must use committed town: ${path}`);
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function saveReport(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}

export async function launch(software = false) {
  const args = software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl-developer-extensions',
    '--disable-frame-rate-limit', '--disable-gpu-vsync',
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
  ];
  return launchBrowser({ gl: false, headless: true, args: ['--headless=new', ...args] });
}

export function identifyRenderer(hardware) {
  const gl = window.__game?.renderer.getContext() ?? document.createElement('canvas').getContext('webgl2');
  if (!gl || gl.isContextLost()) throw Error('WebGL2 context unavailable');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) throw Error('Unable to identify WebGL adapter (WEBGL_debug_renderer_info missing)');
  const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  if (!renderer || (hardware && /swiftshader|llvmpipe|basic render|softpipe|software rasterizer|\bwarp\b/i.test(renderer))) {
    throw Error(`Hardware GPU required; received ${renderer}`);
  }
  return renderer;
}

export async function preflight(browser, hardware) {
  const page = await browser.newPage();
  try {
    const renderer = await page.evaluate(identifyRenderer, hardware);
    console.log(`Chrome ${browser.version()} | ${renderer}`);
    return renderer;
  } finally { await page.close(); }
}

export async function openScene(browser, { scene, quality, width, height, phone = false }) {
  let page, center, town, errs;
  if (scene === 'reference') {
    fixtureHash();
    ({ page, center, town, errs } = await openBlock(browser, { base, quality, width, height, phone, seed }));
  } else {
    page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
    errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(seededInit, { seed, rng: seededRandom.toString() });
    await page.addInitScript(q => {
      localStorage.setItem('slopmerica.quality', q);
      localStorage.setItem('slopmerica.onboarded', '1');
      localStorage.setItem('slopmerica.firstSteps', '1');
    }, quality);
    await page.goto(`${base}/#skip&map=${scene}&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
    center = await page.evaluate(seed => {
      const g = window.__game;
      g.stop();
      window.__reseed(seed);
      const { x, z } = g.startView();
      return { x, z };
    }, seed);
  }
  await page.waitForFunction(() => window.__game.civic.status !== 'loading', null, { timeout: 180000 });
  await page.evaluate(expected => {
    const g = window.__game;
    if (g.q.name !== expected) throw Error(`Requested ${expected} but running ${g.q.name}`);
    if (window.__vault.status() !== 'ready' || g.civic.status === 'failed') throw Error('Asset pack missing from measured scene');
    g.sim.speed = 0;
    g.civic.update(2); g.civic.update(2);
  }, quality);
  return { page, center, town, errs };
}

export async function setCamera(page, center, camera) {
  await shoot(page, center, { hour: 12.5, view: views[camera] });
}

export function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
