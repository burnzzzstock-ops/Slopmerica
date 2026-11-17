import { identifyRenderer, fixtureHash, openScene, percentile, preflight, presets, saveReport, scenes, seed, selection, setCamera } from './measure.mjs';
import { timePasses } from './pass-times.mjs';
import { readFileSync } from 'node:fs';

function enforceFrameBudget(report, phone) {
  const target = phone
    ? report.scene === 'reference' && report.quality === 'low' && report.size === '390x844' && report.cpuThrottle === 4
    : report.scene === 'reference' && report.quality === 'high' && report.size === '1920x1080' && report.cpuThrottle === 1;
  if (!target) throw Error('Frame-budget check requires the reference High 1080p or Low phone 4× case');
  const software = /swiftshader|llvmpipe|basic render|softpipe|software rasterizer|\bwarp\b/i;
  if (!report.renderer || software.test(report.renderer) || report.fixture !== fixtureHash() || report.frames !== 300 ||
    !report.gpuMs || report.pageErrors?.length || !Number.isFinite(report.frameMs?.p95)) {
    throw Error('Frame-budget check requires a complete hardware run on the current fixture');
  }
  const limit = phone ? 16 : 8;
  const pass = report.frameMs.p95 < limit;
  console.log(`${pass ? 'OK' : 'FAIL'} reference ${phone ? 'Low 4×' : 'High 1080p'} p95 ${report.frameMs.p95} ms, required <${limit} ms`);
  if (!pass) process.exitCode = 1;
}

function sampleFrames() {
  const g = window.__game;
  const gl = g.renderer.getContext();
  const intervals = [], work = [], calls = [], tris = [];
  return new Promise((resolve, reject) => {
    let warmStart, last;
    function tick() {
      try {
        const start = performance.now();
        if (gl.isContextLost()) throw Error('WebGL context lost during frame measurement');
        warmStart ??= start;
        if (start - warmStart < 5000) {
          g.frame(1 / 60);
        } else if (intervals.length < 300) {
          if (last !== undefined) intervals.push(start - last);
          if (intervals.length === 300) {
            resolve({ intervals, work, calls, tris });
            return;
          }
          g.sim.speed = 1;
          last = start;
          g.frame(1 / 60);
          work.push(performance.now() - start);
          calls.push(g.renderer.info.render.calls);
          tris.push(g.renderer.info.render.triangles);
        }
        requestAnimationFrame(tick);
      } catch (e) { reject(e); }
    }
    requestAnimationFrame(tick);
  });
}

function stats(samples) {
  if (!samples.length || samples.some(v => !Number.isFinite(v))) throw Error('Empty or nonfinite measurement');
  return { median: +percentile(samples, 0.5).toFixed(2), p95: +percentile(samples, 0.95).toFixed(2), peak: Math.max(...samples) };
}

export async function runFrames(browser, phone) {
  try {
    const renderer = await preflight(browser, true);
    const qualities = phone ? ['low'] : selection('PRESETS', presets);
    const sizes = phone ? ['390x844'] : selection('SIZES', ['1920x1080', '2560x1440']);
    const maps = selection('SCENES', scenes);
    const rates = phone ? selection('RATES', ['4', '6']).map(Number) : [1];
    const enforce = process.argv.includes('--enforce');
    if (enforce && (!maps.includes('reference') || (!phone && (!qualities.includes('high') || !sizes.includes('1920x1080'))) || (phone && !rates.includes(4)))) {
      throw Error('--enforce needs the reference High 1080p or Low phone 4× case in the selected matrix');
    }
    for (const quality of qualities) for (const size of sizes) for (const scene of maps) for (const rate of rates) {
      const [width, height] = size.split('x').map(Number);
      const camera = scene === 'reference' ? 'middle' : 'overview';
      const report = {
        date: new Date().toISOString(), chrome: browser.version(), renderer, seed, quality,
        size, scene, camera, dpr: phone ? 3 : 1, cpuThrottle: rate, phoneProxy: phone,
        fixture: scene === 'reference' ? fixtureHash() : null,
      };
      const { page, center, town, errs } = await openScene(browser, { scene, quality, width, height, phone });
      try {
        report.renderer = await page.evaluate(identifyRenderer, true);
        if (phone) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        }
        await setCamera(page, center, camera);
        report.buffer = await page.evaluate(() => {
          const gl = window.__game.renderer.getContext();
          return [gl.drawingBufferWidth, gl.drawingBufferHeight];
        });
        const samples = await page.evaluate(sampleFrames);
        report.frames = samples.intervals.length;
        report.frameMs = stats(samples.intervals);
        report.cpuWorkMs = stats(samples.work);
        report.calls = stats(samples.calls);
        report.triangles = stats(samples.tris);
        if (report.calls.median === 0 || report.triangles.median === 0) throw Error('Empty rendering sample');
        report.town = town ?? null;
        const out = `${process.env.OUT_DIR ?? 'shots/perf/look'}/${scene}-${quality}-${size}-${rate}x.json`;
        report.pageErrors = errs;
        saveReport(out, report);
        if (errs.length) throw Error(errs.join('\n'));
        const timings = await page.evaluate(timePasses, 12);
        const labels = new Set(timings.flatMap(frame => Object.keys(frame)));
        report.passMs = Object.fromEntries([...labels].map(label => [label, stats(timings.map(frame => frame[label] ?? 0))]));
        report.gpuMs = stats(timings.map(frame => Object.values(frame).reduce((sum, ms) => sum + ms, 0)));
        if (errs.length) throw Error(errs.join('\n'));
        saveReport(out, report);
        const target = scene === 'reference' && (phone ? rate === 4 : quality === 'high' && size === '1920x1080');
        if (enforce && target) enforceFrameBudget(report, phone);
        console.log(`${out} | frame ${report.frameMs.median}/${report.frameMs.p95} ms | GPU ${report.gpuMs.median} ms | calls ${report.calls.median} | tris ${report.triangles.median}`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}

export function checkSavedFrames(phone) {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === '--enforce')) return false;
  if (args.length !== 2 || args[0] !== '--check') throw Error('Usage: [--enforce | --check <hardware-report.json>]');
  enforceFrameBudget(JSON.parse(readFileSync(args[1], 'utf8')), phone);
  return true;
}
