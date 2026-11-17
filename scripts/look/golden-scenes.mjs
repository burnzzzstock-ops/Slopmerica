import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { SAVE, seededInit, seededRandom } from '../refblock.mjs';
import { readSave, REFBLOCK_CENTER } from '../lib/fixtures.mjs';

export const seed = 1776;
const times = {
  noon: [12.5, 0.5, 'clear'],
  golden: [19.9, 0.5, 'clear'],
  moonless: [23, 0, 'clear'],
  rain: [16.5, 0.25, 'rain'],
};
// [x, z, distance, yaw, pitch], in metres and radians. Block poses are relative to
// the fixture centre. Landscape poses are absolute so moving a tree cannot move the camera.
const cameras = {
  block: {
    junction: [-40, -30, 110, 2.4, 0.38],
    mid: [15, 10, 245, 0.95, 0.54],
    overview: [0, 0, 600, 0.7, 0.63],
  },
  appalachia: {
    overview: [10, -170, 1440, 0.48, 0.53],
    water: [7, -170, 220, 1.26, 0.39],
    forest: [140, 380, 180, Math.PI, 0.43],
  },
  norcal: {
    overview: [480, 100, 1670, 1.04, 0.49],
    water: [-1672, 550, 240, 1.19, 0.42],
    forest: [1540, -220, 195, -Math.PI / 2, 0.42],
  },
  florida: {
    overview: [300, 950, 1440, -2.45, 0.57],
    water: [450, 1552, 220, -2.8, 0.4],
    forest: [900, -860, 175, Math.PI, 0.4],
  },
};
export const shots = [];
for (const [scene, views] of Object.entries(cameras)) {
  for (const quality of ['low', 'high']) {
    for (const [view, camera] of Object.entries(views)) {
      for (const [time, conditions] of Object.entries(times)) {
        shots.push({ id: [scene, quality, view, time].join('-'), scene, quality, camera, conditions });
      }
    }
  }
}

export async function capture(browser, shot, base, probeMaterial = false, afterCapture, backend = 'swiftshader') {
  if (!['swiftshader', 'hardware'].includes(backend)) throw Error('Unknown capture backend ' + backend);
  const { scene, quality, camera, conditions } = shot;
  const phone = quality === 'low';
  let save = null;
  let centre = { x: 0, z: 0 };
  if (scene === 'block') {
    if (!resolve(SAVE).startsWith(resolve('scripts/fixtures') + sep)) {
      throw new Error('The reference-block harness must point SAVE at its committed fixture before capturing the block');
    }
    save = readSave(SAVE);
    centre = JSON.parse(readFileSync(REFBLOCK_CENTER, 'utf8'));
    if (!Number.isFinite(centre.x) || !Number.isFinite(centre.z)) throw Error('Invalid reference-block centre');
  }
  const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 720 };
  const page = await browser.newPage({
    viewport, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce',
  });
  try {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (/THREE\.WebGLProgram: Shader Error|GL_INVALID/.test(msg.text())) errors.push(msg.text()); });
    page.on('response', response => {
      if (response.status() >= 400 && ['image', 'font'].includes(response.request().resourceType())) {
        errors.push('Missing visual asset ' + response.status() + ' ' + response.url());
      }
    });
    await page.addInitScript(seededInit, { seed, rng: seededRandom.toString() });
    await page.addInitScript(({ quality, save, seed }) => {
      localStorage.setItem('slopmerica.quality', quality);
      localStorage.setItem('slopmerica.firstSteps', '1');
      localStorage.setItem('slopmerica.onboarded', '1');
      localStorage.setItem('slopmerica.resolution', 'full');
      if (save) localStorage.setItem('slopmerica.save.v1', save);
      // The two atlas loaders run concurrently before the renderer is built.
      // UUID allocation there also draws from Math.random; restart the gameplay
      // stream when the first WebGL context opens, before procedural road paint.
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type === 'webgl2') {
          window.__reseed(seed);
          HTMLCanvasElement.prototype.getContext = getContext;
        }
        return getContext.call(this, type, ...args);
      };
      // Sky baking, ground-cover slicing and vehicle beacons use the wall clock.
      // Advance it only between game frames. Browser I/O timers still run normally.
      window.__goldenTime = 10000;
      performance.now = () => window.__goldenTime;
      Date.now = () => Date.UTC(2026, 6, 18) + window.__goldenTime;
    }, { quality, save, seed });
    await page.goto(save ? base : base + '/#skip&mode=sandbox&map=' + scene, { waitUntil: 'load', timeout: 180000 });
    if (save) await page.locator('#continue').click({ timeout: 180000 });
    await page.waitForFunction(() => window.__dbg && window.__game && window.__game.civic.status !== 'loading', null, { timeout: 300000 });
    await page.waitForLoadState('networkidle', { timeout: 120000 });
    const result = await page.evaluate(({ quality, scene, camera, conditions, seed, probeMaterial, viewport, backend, centre }) => {
      const g = window.__game;
      cancelAnimationFrame(g.raf);
      if (innerWidth !== viewport.width || innerHeight !== viewport.height || devicePixelRatio !== (quality === 'low' ? 3 : 1)) {
        throw Error('Capture device viewport changed: ' + [innerWidth, innerHeight, devicePixelRatio].join(' × '));
      }
      if (g.q.name !== quality || g.map.def.id !== (scene === 'block' ? 'norcal' : scene)) throw Error('Wrong map or preset');
      if (scene === 'block' && !g.buildings.list.size) throw Error('Reference block loaded without buildings');
      if (window.__vault.status() !== 'ready' || g.civic.status === 'failed') throw Error('Asset packs failed to load');
      const gl = g.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
      if (backend === 'swiftshader' && !/swiftshader/i.test(renderer)) throw Error('Expected SwiftShader, got ' + renderer);
      if (backend === 'hardware' && (!renderer || /swiftshader|llvmpipe|basic render|software raster|softpipe|WARP/i.test(renderer))) {
        throw Error('Expected a hardware GPU, got ' + renderer);
      }
      window.__reseed(seed);
      g.sim.day = g.sim.lastWhole = 120;
      g.sim.speed = 0;
      if (g.post.aaMode === 'taa') g.post.setAA('msaa4');
      const [hour, moon, weather] = conditions;
      const [dx, dz, distance, yaw, pitch] = camera;
      const x = Math.round(centre.x) + dx, z = Math.round(centre.z) + dz;
      g.env.moonPhaseOverride = moon;
      // The initial cloud deck consumes the global RNG during construction, after
      // concurrent asset loads. Pin its origin independently of their completion order.
      g.weather.cloudOff.set(0.31, 0.73);
      window.__dbg.hour(hour);
      g.weather.force(weather, 30);
      g.weather.settle();
      g.weather.snowCover = 0;
      g.rts.setView(x, z, distance, yaw, pitch, true);
      if (probeMaterial) g.terrain.group.traverse(mesh => { if (mesh.material?.color) mesh.material.color.set(0x733c66); });
      for (let i = 0; i < 4; i++) {
        window.__goldenTime += (i === 0 ? 1500 : 1000 / 60);
        g.frame(1 / 60);
      }
      if (gl.isContextLost()) throw Error('WebGL context lost');
      // Read in the same task as render: the default WebGL framebuffer need not be
      // preserved after compositing. Match its on-screen extent at the actual device DPR.
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width * devicePixelRatio;
      canvas.height = viewport.height * devicePixelRatio;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(g.renderer.domElement, 0, 0, canvas.width, canvas.height);
      const sample = document.createElement('canvas');
      sample.width = sample.height = 16;
      const s = sample.getContext('2d');
      s.drawImage(canvas, 0, 0, 16, 16);
      const samples = s.getImageData(0, 0, 16, 16).data;
      const red = samples.filter((_, i) => i % 4 === 0);
      if (Math.max(...red) - Math.min(...red) < 4) throw Error('Blank or uniform frame');
      return { png: canvas.toDataURL().split(',')[1], renderer, camera: [x, z, distance, yaw, pitch],
        viewport, dpr: devicePixelRatio, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        calls: g.perf.calls, triangles: g.perf.triangles };
    }, { quality, scene, camera, conditions, seed, probeMaterial, viewport, backend, centre });
    if (errors.length) throw Error(errors.join('\n'));
    const frame = { ...result, png: Buffer.from(result.png, 'base64') };
    if (afterCapture) frame.measurement = await afterCapture(page, frame);
    return frame;
  } finally {
    await page.close();
  }
}
