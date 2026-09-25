// Build a repeatable 7x7 town, advance 270 days and capture stable F3 metrics.
// PORT=5174 PRESET=high node scripts/perfTown.mjs
// PRESET=both runs high desktop followed by low mobile.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

const requestedPreset = (process.env.PRESET || 'high').toLowerCase();
const presets = requestedPreset === 'both' || requestedPreset === 'all' ? ['high', 'low'] : [requestedPreset];
const port = process.env.PORT || '5173';
const out = process.env.OUT || 'shots/perf';
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const swiftshader = process.env.SWIFTSHADER !== '0';
await mkdir(out, { recursive: true });

const machine = {
  platform: `${process.platform} ${process.arch}`,
  cpu: os.cpus()[0]?.model || 'unknown',
  logicalCpus: os.cpus().length,
  memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
};
const report = { machine, chrome, browserVersion: null, runs: [], fatal: null };
let browser;

async function runPreset(preset) {
  const mobile = preset === 'low';
  const width = mobile ? 390 : 1280;
  const height = mobile ? 844 : 800;
  const errors = [];
  const run = { preset, viewport: `${width}x${height}`, build: null, renderer: null, result: null, profiles: null, groundDetailSamples: null, errors };
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  page.on('pageerror', e => errors.push(`pageerror: ${e.stack || e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  try {
    await page.addInitScript(n => {
      try {
        localStorage.setItem('slopmerica.quality', n);
        localStorage.setItem('slopmerica.qualityAuto', '1');
        localStorage.setItem('slopmerica.onboarded', '1');
      } catch { /* private mode */ }
    }, preset);
    await page.goto(`http://127.0.0.1:${port}/#skip&map=appalachia&mode=sandbox`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 180000 });
    await page.evaluate(() => {
      window.__game.stop();
      window.__game.sim.speed = 0;
      // The harness deliberately selects a preset; suppress the automatic startup benchmark/reload.
      window.__game.qualityBenchmarkDone = true;
    });

    run.renderer = await page.evaluate(() => {
      const g = window.__game;
      const gl = g.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        webgl2: g.renderer.capabilities.isWebGL2,
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        maxTextureSize: g.renderer.capabilities.maxTextureSize,
      };
    });

    run.build = await page.evaluate(() => {
      const g = window.__game, d = window.__dbg, S = g.startView();
      const T = g.terrain;
      const candidates = [];
      const sx = Math.round(S.x / 100) * 100, sz = Math.round(S.z / 100) * 100;
      for (let dz = -1500; dz <= 1500; dz += 100) for (let dx = -1500; dx <= 1500; dx += 100) {
        const x = sx + dx, z = sz + dz;
        if (!T.inBounds(x, z, 390)) continue;
        let minH = Infinity, maxH = -Infinity, maxSlope = 0, sumSlope = 0, samples = 0, dry = true;
        // Sample more densely than the road grid so a narrow creek cannot hide between streets.
        for (let gz = -350; gz <= 350 && dry; gz += 50) for (let gx = -350; gx <= 350; gx += 50) {
          const h = T.h(x + gx, z + gz), slope = T.slope(x + gx, z + gz);
          if (h < 1.2) { dry = false; break; }
          minH = Math.min(minH, h); maxH = Math.max(maxH, h);
          maxSlope = Math.max(maxSlope, slope); sumSlope += slope; samples++;
        }
        if (!dry) continue;
        const existingRoad = [...g.net.segs.values()].some(seg => seg.samp.pts.some(p => Math.abs(p.x - x) < 360 && Math.abs(p.z - z) < 360));
        if (existingRoad) continue;
        const commune = g.communes.list.find(c => {
          if (c.state === 'gone') return false;
          const ex = Math.max(Math.abs(c.x - x) - 370, 0);
          const ez = Math.max(Math.abs(c.z - z) - 370, 0);
          return Math.hypot(ex, ez) < c.r + 20;
        });
        if (commune) continue;
        const relief = maxH - minH, avgSlope = sumSlope / samples;
        const score = relief * 4 + avgSlope * 300 + maxSlope * 80 + Math.hypot(dx, dz) / 300;
        candidates.push({ x, z, minH, maxH, relief, avgSlope, maxSlope, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      const site = candidates[0];
      if (!site) throw new Error('No dry, commune-free 7x7 site found within 1.5 km of the start');

      const roads = [];
      for (let i = -3; i <= 3; i++) roads.push(d.road(site.x - 300, site.z + i * 100, site.x + 300, site.z + i * 100, i === 0 ? 'stroad4' : 'twoLane'));
      for (let i = -3; i <= 3; i++) roads.push(d.road(site.x + i * 100, site.z - 300, site.x + i * 100, site.z + 300, i === 0 ? 'stroad4' : 'twoLane'));
      const roadErrors = roads.filter(r => typeof r !== 'number');
      if (roadErrors.length) throw new Error(`Road build failed: ${roadErrors.join('; ')}`);
      let zoned = 0;
      const types = ['resLow', 'resHigh', 'comLow', 'industry', 'office', 'comHigh'];
      for (let row = -3; row < 3; row++) for (let col = -3; col < 3; col++) {
        const n = d.zone(site.x + col * 100 + 50, site.z + row * 100 + 50, 47, types[(row + col + 12) % types.length]);
        if (typeof n === 'number') zoned += n;
      }
      return { x: site.x, z: site.z, site: { minH: site.minH, maxH: site.maxH, relief: site.relief, avgSlope: site.avgSlope, maxSlope: site.maxSlope }, roads, zoned, candidates: candidates.length };
    });
    console.log(`[${preset}] built`, JSON.stringify(run.build));

    for (let i = 0; i < 9; i++) {
      const sim = await page.evaluate(() => window.__dbg.run(30));
      console.log(`[${preset}] day ${(i + 1) * 30}`, JSON.stringify(sim));
    }
    await page.evaluate(({ x, z }) => {
      const g = window.__game, d = window.__dbg;
      g.stop(); g.sim.speed = 0; g.hour = 13;
      d.view(x, z, 650, 0.65, 0.72);
      // Browser-level F3 can be intercepted. Dispatch to the same window listener as a real key event.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', code: 'F3', bubbles: true, cancelable: true }));
    }, run.build);

    // Measure after shader compilation and the resolution controller settle.
    // A frame-count warmup is much shorter in wall time on fast GPUs and can
    // accidentally capture the scale while it is still climbing back to 100%.
    await page.evaluate(async () => {
      const g = window.__game;
      const originalFrame = g.frame.bind(g);
      g.frame = (...args) => {
        const t0 = performance.now();
        const value = originalFrame(...args);
        g.__perfHarnessWorkMs = performance.now() - t0;
        return value;
      };
      g.start();
      await new Promise(resolve => {
        const began = performance.now();
        let stableSince = began;
        let lastScale = g.perf.resolution;
        const warm = now => {
          const scale = g.perf.resolution;
          if (Math.abs(scale - lastScale) > 0.005) stableSince = now;
          lastScale = scale;
          const elapsed = now - began;
          const settled = scale >= 0.99 ? now - stableSince >= 3000 : now - stableSince >= 8000;
          if ((elapsed >= 20000 && settled) || elapsed >= 45000) {
            g.__perfHarnessWarmMs = elapsed;
            resolve();
          } else requestAnimationFrame(warm);
        };
        requestAnimationFrame(warm);
      });
      g.perfWindowMs = 0; g.perfWindowFrames = 0;
      g.perf.fps = 0; g.perf.frameMs = 0;
      const samples = [];
      let last = performance.now();
      await new Promise(resolve => {
        const sample = now => {
          samples.push({ intervalMs: now - last, workMs: g.__perfHarnessWorkMs });
          last = now;
          if (samples.length >= 30) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      g.__perfHarnessSamples = samples;
    });

    run.result = await page.evaluate(() => {
      const g = window.__game, el = document.querySelector('.perf-overlay');
      g.stop();
      const samples = g.__perfHarnessSamples;
      const frameMs = samples.reduce((n, s) => n + s.intervalMs, 0) / samples.length;
      const workMs = samples.reduce((n, s) => n + s.workMs, 0) / samples.length;
      const ordered = samples.map(s => s.intervalMs).sort((a, b) => a - b);
      g.perf.fps = 1000 / frameMs; g.perf.frameMs = frameMs; g.perf.renderMs = workMs;
      if (el) el.textContent = `${g.perf.fps.toFixed(1)} fps · ${frameMs.toFixed(1)} ms frame · ${workMs.toFixed(1)} ms work\n${g.perf.calls.toLocaleString()} calls · ${g.perf.triangles.toLocaleString()} tris · ${g.perf.quality.toUpperCase()} · ${Math.round(g.perf.resolution * 100)}% res`;
      return {
        preset: g.q.name, fps: g.perf.fps, frameMs, medianFrameMs: ordered[Math.floor(ordered.length / 2)], workMs,
        calls: g.perf.calls, triangles: g.perf.triangles, resolution: g.perf.resolution,
        buildings: g.buildings.list.size, usedVerts: g.buildings.usedVerts, sampledFrames: samples.length,
        totalGameSamples: g.perfSamples, warmMs: g.__perfHarnessWarmMs, overlay: el?.textContent || null,
        overlayVisible: !!el && !el.hidden && getComputedStyle(el).display !== 'none',
        groundRefillMs: g.groundDetail.lastRefillMs,
      };
    });
    if (!run.result.overlayVisible || !run.result.overlay) errors.push('F3 overlay did not become visible or populate');

    // Small pass-isolation profile. Each row is one timed rendered frame with its calls/tris.
    run.profiles = await page.evaluate(() => {
      const g = window.__game;
      g.stop();
      const reflection = g.water.reflection;
      const original = { reflection: reflection?.enabled, shadows: g.renderer.shadowMap.enabled, post: g.post.enabled, ao: g.post.ao };
      const measure = (name, set) => {
        set();
        const t0 = performance.now();
        g.frame(0.016);
        return { name, workMs: performance.now() - t0, calls: g.perf.calls, triangles: g.perf.triangles };
      };
      const rows = [measure('baseline', () => {})];
      if (reflection) rows.push(measure('reflectionOff', () => { reflection.enabled = false; }));
      if (original.shadows) rows.push(measure('shadowsOff', () => { if (reflection) reflection.enabled = original.reflection; g.renderer.shadowMap.enabled = false; }));
      if (g.post.enabled) {
        rows.push(measure('aoOff', () => { g.renderer.shadowMap.enabled = original.shadows; g.post.ao = false; }));
        rows.push(measure('postOff', () => { g.post.enabled = false; }));
      }
      if (reflection) reflection.enabled = original.reflection;
      g.renderer.shadowMap.enabled = original.shadows; g.post.enabled = original.post; g.post.ao = original.ao;
      g.frame(0.016);
      return rows;
    });

    run.groundDetailSamples = await page.evaluate(({ x, z }) => {
      const g = window.__game, d = window.__dbg;
      const offsets = [[0, 0], [80, 0], [80, 80], [-80, 80], [-80, -80], [80, -80], [0, 0]];
      const samples = [];
      for (const [dx, dz] of offsets) {
        g.rts.setView(x + dx, z + dz, 650, 0.65, 0.72, true);
        g.frame(0.2, false);
        samples.push(g.groundDetail.lastRefillMs);
      }
      d.view(x, z, 650, 0.65, 0.72);
      const sorted = samples.slice().sort((a, b) => a - b);
      return {
        samples,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        maxMs: Math.max(...samples),
      };
    }, run.build);

    const canvasPng = await page.evaluate(() => window.__game.renderer.domElement.toDataURL('image/png').split(',')[1]);
    await writeFile(`${out}/town-${preset}-${width}x${height}.png`, Buffer.from(canvasPng, 'base64'));
    await page.evaluate(() => document.querySelector('.xfeed')?.classList.add('collapsed'));
    await page.screenshot({ path: `${out}/town-${preset}-${width}x${height}-overlay.png`, timeout: 30000 });
    await writeFile(`${out}/town-${preset}-${width}x${height}-overlay.txt`, `${run.result.overlay || ''}\n`);
    console.log(`[${preset}] result`, JSON.stringify(run.result));
    console.log(`[${preset}] renderer`, JSON.stringify(run.renderer));
    console.log(`[${preset}] profiles`, JSON.stringify(run.profiles));
    console.log(`[${preset}] ground detail`, JSON.stringify(run.groundDetailSamples));
    console.log(`[${preset}] errors`, JSON.stringify(errors));
  } catch (e) {
    errors.push(`fatal: ${e.stack || e.message}`);
    console.error(`[${preset}] failed`, e);
  } finally {
    await page.close().catch(() => {});
  }
  return run;
}

try {
  browser = await chromium.launch({ executablePath: chrome,
    args: swiftshader
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
      : ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--no-sandbox'] });
  report.browserVersion = browser.version();
  for (const preset of presets) report.runs.push(await runPreset(preset));
} catch (e) {
  report.fatal = e.stack || e.message;
  console.error('fatal', e);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await writeFile(`${out}/report-${requestedPreset}.json`, JSON.stringify(report, null, 2));
  console.log('machine', JSON.stringify(machine));
  console.log('report', `${out}/report-${requestedPreset}.json`);
}

if (report.fatal || report.runs.some(r => r.errors.some(e => e.startsWith('fatal:')))) process.exitCode = 1;
