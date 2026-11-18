// src/core/math.ts, SpatialHash: each() hands over exactly what query() holds, each item once and in the same order, through
// inserts, removals and moves; any() agrees with both; clear() empties it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpatialHash } from '../../src/core/math.ts';

const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const viaEach = (h, b) => { const out = []; h.each(b[0], b[1], b[2], b[3], (it) => out.push(it)); return out; };
const viaQuery = (h, b) => [...h.query(b[0], b[1], b[2], b[3])];
const ids = (a) => a.map((it) => it.id).join(',');

for (const [size, span, big] of [[32, 3000, 90], [64, 3000, 200], [8, 400, 60]]) {
  test(`cells of ${size} m: each() is query(), item for item, in order`, () => {
    const r = rng(size * 7 + 1), h = new SpatialHash(size);
    const box = (w) => { const x = (r() - 0.5) * span, z = (r() - 0.5) * span, a = 1 + r() * w, b = 1 + r() * w; return [x - a, z - b, x + a, z + b]; };
    const live = new Map();
    let id = 0, compared = 0, shared = 0, most = 0;
    for (let round = 0; round < 60; round++) {
      // a batch of items in, some out, some moved (out with the box they went in with, back in with a new one)
      for (let k = 0; k < 40; k++) { const it = { id: id++ }, b = box(big); h.insert(it, ...b); live.set(it, b); }
      const all = [...live.keys()];
      for (let k = 0; k < 12 && all.length; k++) { const it = all.splice(Math.floor(r() * all.length), 1)[0]; h.remove(it, ...live.get(it)); live.delete(it); }
      for (let k = 0; k < 12 && all.length; k++) { const it = all[Math.floor(r() * all.length)], b = box(big); h.remove(it, ...live.get(it)); h.insert(it, ...b); live.set(it, b); }
      for (let q = 0; q < 25; q++) {
        // a point, a small box, a wide one, and one far outside
        const b = q % 5 === 0 ? (() => { const x = (r() - 0.5) * span, z = (r() - 0.5) * span; return [x, z, x, z]; })() : q % 5 === 4 ? [span * 3, span * 3, span * 3 + 50, span * 3 + 50] : box(q % 2 ? 30 : 300);
        const A = viaQuery(h, b), B = viaEach(h, b);
        assert.equal(ids(B), ids(A), `round ${round}, box ${b.map((v) => v.toFixed(1))}`);
        if (A.length) assert.ok(h.any(...b), 'any() is true where query() finds something');
        compared++; most = Math.max(most, A.length);
        // every live item whose box overlaps the query's cells is there
        for (const it of A) assert.ok(live.has(it), 'nothing removed comes back');
        if (A.length > 1) shared++;
      }
    }
    assert.ok(compared === 1500 && shared > 300 && most > 20, `the comparison saw real overlap (${shared} of ${compared} boxes with more than one item, ${most} at most)`);
    // every item once, however many cells it is filed under
    const whole = viaEach(h, [-span * 2, -span * 2, span * 2, span * 2]);
    assert.equal(whole.length, live.size);
    assert.equal(new Set(whole).size, live.size);
    h.clear();
    assert.equal(viaEach(h, [-span, -span, span, span]).length, 0);
    assert.equal(h.any(-span, -span, span, span), false);
  });
}
