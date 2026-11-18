// Whole-scene triangle counts for the original overview cameras, seed 1776.
// Original counts are from 93ee555, in fourth-frame / settled order.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { capture, shots } from './golden-scenes.mjs';
import { launch, saveReport } from './measure.mjs';

const baseline = JSON.parse(readFileSync(new URL('./overview-original.json', import.meta.url), 'utf8'));
const overviews = shots.filter(shot => shot.id.includes('-overview-'));
const { values } = parseArgs({ options: { check: { type: 'string' } } });

function settled() {
  const g = window.__game;
  let previous;
  for (let frames = 0; frames < 90; frames++) {
    g.frame(0, true); // Direct draws refresh all shadow maps.
    const levels = g.terrain.chunks.map(chunk => chunk.lod).join(',');
    if (frames >= 8 && levels === previous) return {
      triangles: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls,
      population: g.sim.population, buildings: g.buildings.list.size, frames,
    };
    previous = levels;
  }
  throw Error('Terrain LOD did not settle in 90 frames');
}

let rows;
if (values.check) {
  rows = JSON.parse(readFileSync(values.check, 'utf8'));
} else {
  assert.equal(process.env.REFTOWN, 'v1', 'The original Block camera requires REFTOWN=v1');
  const browser = await launch();
  rows = [];
  try {
    for (const shot of overviews) {
      const { png, ...frame } = await capture(browser, shot, process.env.BASE_URL || 'http://127.0.0.1:5173',
        false, page => page.evaluate(settled), 'hardware');
      rows.push({ id: shot.id, ...frame });
      console.log(shot.id, frame.triangles, frame.measurement.triangles);
    }
  } finally { await browser.close(); }
  saveReport(process.env.OUT || 'shots/look/overview-budget.json', rows);
}

assert.deepEqual(rows.map(row => row.id).sort(), overviews.map(shot => shot.id).sort());
assert.deepEqual(Object.keys(baseline).sort(), overviews.map(shot => shot.id).sort());
let passed = 0;
for (const row of rows) {
  const shot = overviews.find(shot => shot.id === row.id);
  const camera = [...shot.camera];
  if (shot.scene === 'block') {
    camera[0] += 195; camera[1] += 45;
    assert.equal(row.measurement.population, 781);
    assert.equal(row.measurement.buildings, 262);
  }
  assert.deepEqual(row.camera, camera);
  assert.deepEqual(row.buffer, shot.quality === 'low' ? [585, 1266] : [1280, 720]);
  assert.ok(row.renderer && !/swiftshader|llvmpipe|basic render|software raster|softpipe|WARP/i.test(row.renderer));
  assert.ok(Number.isInteger(row.measurement.frames) && row.measurement.frames >= 8 && row.measurement.frames < 90);
  const counts = [row.triangles, row.measurement.triangles];
  const ok = counts.every((n, i) => Number.isSafeInteger(n) && n > 0 && n * 10 <= 7 * baseline[row.id][i]);
  if (ok) passed++;
  else console.error('FAIL', row.id, 'original', baseline[row.id], 'measured', counts);
}
console.log(passed + '/' + rows.length + ' overview cameras meet both 30% reductions');
if (passed !== rows.length) process.exitCode = 1;
