import assert from 'node:assert/strict';
import { comparePixels } from './golden-diff.mjs';
import { shots } from './golden-scenes.mjs';

const image = new Uint8ClampedArray(1000 * 4).fill(255);
const next = image.slice();
assert.equal(comparePixels(image, next).exactDifferences, 0);
next[0] = 254;
assert.equal(comparePixels(image, next).changed, 0, 'subthreshold colour');
for (let i = 0; i < 5; i++) next[i * 4] = 0;
assert.equal(comparePixels(image, next).failed, false, 'exactly 0.5%');
next[20] = 0;
assert.equal(comparePixels(image, next).failed, true, 'more than 0.5%');
const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
assert.equal(comparePixels(black, white, 99.99).changed, 1, 'black to white has deltaE 100');
assert.equal(comparePixels(black, white, 100.01).changed, 0);
assert.equal(shots.length, 96);
assert.equal(new Set(shots.map(s => s.id)).size, 96);
console.log('Passed colour conversion threshold, coverage boundaries and 96 distinct shot IDs');
