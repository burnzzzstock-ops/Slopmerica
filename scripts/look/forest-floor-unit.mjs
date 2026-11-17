import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { ForestFloor } = await server.ssrLoadModule('/src/world/forestFloor.ts');
  const { RedFormat } = await import('three');
  let draws = 0;
  const random = Math.random;
  Math.random = () => { draws++; return random(); };
  let floor;
  try { floor = new ForestFloor(); } finally { Math.random = random; }
  assert.equal(draws, 0, 'new render textures must leave the global stream alone');
  assert.equal(floor.texture.format, RedFormat);
  assert.equal(floor.clearedTexture.format, RedFormat);
  assert.equal(floor.texture.image.data.length, 512 * 512);
  assert.equal(floor.clearedTexture.image.data.length, 512 * 512);
  console.log('OK two R8 textures use 512 KiB and consume no global random draws');

  floor.bake(new Float32Array(5), new Float32Array(5));
  const before = floor.texture.image.data.slice();
  const version = floor.version;
  const coverage = floor.densityAt(6, 6);
  assert.ok(coverage > .2 && coverage < 1);
  assert.equal(floor.densityAt(24, 24), 0, 'one crown must not shade broad open ground');
  floor.edit(0, 0, -1);
  assert.ok(Math.abs(floor.densityAt(6, 6) - coverage * .8) < 1 / 255);
  assert.ok(Math.abs(floor.clearedAt(6, 6) - coverage * .2) < 1 / 255);
  assert.equal(floor.texture.image.data.filter((value, i) => value !== before[i]).length, 4);
  assert.equal(floor.version, version + 1);
  floor.edit(0, 0, 1);
  assert.deepEqual(floor.texture.image.data, before);
  assert.ok(floor.clearedTexture.image.data.every(value => value === 0));
  console.log('OK a cut touches only its crown footprint; CPU samples and undo preserve exact counts');

  floor.bake(new Float32Array(20000), new Float32Array(20000));
  for (let i = 0; i < 20000; i++) floor.edit(0, 0, -1);
  assert.ok(floor.texture.image.data.every(value => value === 0));
  assert.equal(floor.clearedAt(6, 6), 1);
  for (let i = 0; i < 20000; i++) floor.edit(0, 0, 1);
  assert.equal(floor.densityAt(6, 6), 1);
  assert.ok(floor.clearedTexture.image.data.every(value => value === 0));
  assert.equal(floor.densityAt(4000, 0), 0);
  assert.equal(floor.clearedAt(0, -4000), 0);
  floor.bake(new Float32Array(), new Float32Array());
  assert.equal(floor.densityAt(6, 6), 0);
  assert.equal(floor.clearedAt(6, 6), 0);
  console.log('OK saturated stands retain unsaturated counts; empty and outside samples stay clear');
} finally {
  await server.close();
}
