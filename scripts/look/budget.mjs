// Run from the game root with BASE_URL pointing to its frozen server.
// --record writes a newly measured full baseline;
// --check <saved report> replays the same comparisons without another browser.
import { existsSync, readFileSync } from 'node:fs';
import { fixtureHash, identifyRenderer, launch, openScene, preflight, presets, saveReport, seed, setCamera, views } from './measure.mjs';

const limitsPath = 'scripts/look/budgets.json';
const resultPath = `${process.env.OUT_DIR ?? 'shots/perf/look'}/counters.json`;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const cameras = Object.keys(views);
const expected = presets.flatMap(preset => cameras.map(camera => preset + '/' + camera));
const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 1 && args[0] === '--record') || (args.length === 2 && args[0] === '--check'))) {
  throw Error('Usage: node scripts/look/budget.mjs [--record | --check <saved report>]');
}

async function measure() {
  const report = { fixture: fixtureHash(), seed, framesPerView: 12, rows: {} };
  const software = process.env.HARDWARE !== '1' && process.env.GPU !== '1';
  const browser = await launch(software);
  try {
    report.chrome = browser.version();
    report.renderer = await preflight(browser, !software);
    for (const quality of presets) {
      const phone = quality === 'low', width = phone ? 390 : 1920, height = phone ? 844 : 1080;
      const { page, center, errs, town } = await openScene(browser, { scene: 'reference', quality, width, height, phone });
      try {
        await page.evaluate(identifyRenderer, !software);
        for (const camera of cameras) {
          await setCamera(page, center, camera);
          const counts = await page.evaluate(frameCount => {
            const g = window.__game;
            let calls = 0, triangles = 0;
            for (let i = 0; i < frameCount; i++) {
              g.frame(1 / 60);
              const info = g.renderer.info.render;
              calls = Math.max(calls, info.calls);
              triangles = Math.max(triangles, info.triangles);
            }
            return { calls, triangles };
          }, report.framesPerView);
          const key = quality + '/' + camera;
          report.rows[key] = { ...counts, town, width, height, dpr: phone ? 3 : 1 };
          console.log(`${key} | ${counts.calls} calls | ${counts.triangles} triangles`);
          saveReport(resultPath, report);
        }
        if (errs.length) throw Error(errs.join('\n'));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  return report;
}

function validCounters(rows) {
  if (!rows || Object.keys(rows).length !== expected.length) throw Error('Incomplete counter matrix');
  for (const key of expected) for (const field of ['calls', 'triangles']) {
    if (!Number.isInteger(rows[key]?.[field]) || rows[key][field] <= 0) throw Error(`Invalid ${key} ${field}`);
  }
}

const report = args[0] === '--check' ? read(args[1]) : await measure();
validCounters(report.rows);
if (!report.fixture || !Number.isInteger(report.seed) || report.framesPerView !== 12) throw Error('Invalid counter report identity');
if (args[0] === '--record') {
  const limits = Object.fromEntries(expected.map(key => {
    const row = report.rows[key];
    const preset = key.split('/')[0];
    const callTarget = { low: 250, high: 600 }[preset] ?? Infinity;
    return [key, { calls: Math.min(callTarget, Math.ceil(row.calls * 1.05)), triangles: Math.ceil(row.triangles * 1.05) }];
  }));
  saveReport(limitsPath, { fixture: report.fixture, seed: report.seed, framesPerView: 12, limits, targetFrameMs: { desktopHigh: 8, phoneLow4x: 16 } });
}
const budgets = read(limitsPath);
validCounters(budgets.limits);
if (report.seed !== budgets.seed || report.fixture !== budgets.fixture || report.framesPerView !== budgets.framesPerView) {
  throw Error('Counter report and budget must use the same save, seed and number of frames');
}
let failures = 0;
for (const key of expected) for (const field of ['calls', 'triangles']) {
  const actual = report.rows[key][field], limit = budgets.limits[key][field];
  if (actual > limit) {
    console.error(`FAIL ${key}: ${actual} ${field} exceeds ${limit}`);
    failures++;
  }
}
for (const [name, file] of [['desktopHigh', 'reference-high-1920x1080-1x.json'], ['phoneLow4x', 'reference-low-390x844-4x.json']]) {
  const path = `${process.env.OUT_DIR ?? 'shots/perf/look'}/${file}`;
  if (!existsSync(path)) { console.warn(`WARN ${name}: no hardware frame report available`); continue; }
  const gpu = read(path);
  if (gpu.fixture !== report.fixture || gpu.seed !== report.seed || gpu.frames !== 300 || !Number.isFinite(gpu.frameMs?.p95)) {
    console.warn(`WARN ${name}: no matching hardware frame report`); continue;
  }
  const limit = budgets.targetFrameMs[name];
  console.log(`${gpu.frameMs.p95 >= limit ? 'WARN' : 'OK'} ${name}: p95 ${gpu.frameMs.p95} ms, target <${limit} ms`);
}
console.log(`${expected.length} cameras, ${failures} counter violations`);
if (failures) process.exitCode = 1;
